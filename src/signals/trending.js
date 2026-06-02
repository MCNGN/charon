import axios from 'axios';
import { JUPITER_API_KEY, JSON_HEADERS, TRENDING_LOOKBACK_MS } from '../config.js';
import { now, json } from '../utils.js';
import { numSetting, boolSetting, setting } from '../db/settings.js';
import { db } from '../db/connection.js';
import { gmgnBackoffActive, setGmgnBackoff, gmgnFetch, normalizedTrendingRows } from '../enrichment/gmgn.js';
import { normalizeJupiterTrendingRow } from '../enrichment/jupiter.js';
import { getActiveChain } from '../chain/config.js';
import { fetchCombinedTrending } from '../chain/signals.js';

export const trending = new Map();
let degenHandler = null;
let candidateHandler = null;

export function setDegenHandler(fn) {
  degenHandler = fn;
}

export function setCandidateHandler(fn) {
  candidateHandler = fn;
}

export function storeSignalEvent(mint, kind, source, payload) {
  db.prepare(`
    INSERT INTO signal_events (mint, kind, at_ms, source, payload_json)
    VALUES (?, ?, ?, ?, ?)
  `).run(mint, kind, now(), source, json(payload));
}

export function trendingSignalPass(row) {
  const volume = Number(row?.volume ?? 0);
  const swaps = Number(row?.swaps ?? 0);
  const rugRatio = Number(row?.rug_ratio ?? 0);
  const bundlerRate = Number(row?.bundler_rate ?? 0);
  const minVolume = numSetting('trending_min_volume_usd', 0);
  const minSwaps = numSetting('trending_min_swaps', 0);
  const maxRugRatio = numSetting('trending_max_rug_ratio', 0.3);
  const maxBundlerRate = numSetting('trending_max_bundler_rate', 0.5);
  if (minVolume > 0 && (!Number.isFinite(volume) || volume < minVolume)) return false;
  if (minSwaps > 0 && (!Number.isFinite(swaps) || swaps < minSwaps)) return false;
  if (maxRugRatio > 0 && Number.isFinite(rugRatio) && rugRatio > maxRugRatio) return false;
  if (maxBundlerRate > 0 && Number.isFinite(bundlerRate) && bundlerRate > maxBundlerRate) return false;
  if (row?.is_wash_trading === true || row?.is_wash_trading === 1) return false;
  return true;
}

export async function fetchJupiterTrendingRows(interval, limit) {
  const chain = getActiveChain();
  if (chain.type !== 'solana') {
    console.log(`[trending:jupiter] Jupiter not available on ${chain.name}`);
    return [];
  }
  if (!JUPITER_API_KEY) {
    console.log('[trending:jupiter] JUPITER_API_KEY missing');
    return [];
  }
  const supported = new Set(['5m', '1h', '6h', '24h']);
  const window = supported.has(interval) ? interval : '5m';
  const url = new URL(`https://api.jup.ag/tokens/v2/toptrending/${window}`);
  url.searchParams.set('limit', String(limit));
  const res = await axios.get(url.toString(), {
    timeout: 10_000,
    headers: { ...JSON_HEADERS, 'x-api-key': JUPITER_API_KEY },
  });
  const rows = Array.isArray(res.data) ? res.data : [];
  return rows.map((row, index) => normalizeJupiterTrendingRow(row, window, index + 1));
}

export async function fetchGmgnTrendingRows(interval, limit) {
  const chain = getActiveChain();
  if (gmgnBackoffActive('trending')) return [];

  // Build platform filter: Pump.fun only on Solana
  const isSolana = chain.type === 'solana';
  const platforms = isSolana
    ? ['Pump.fun', 'meteora_virtual_curve', 'pool_pump_amm']
    : undefined; // undefined = let GMGN use chain-appropriate defaults

  const params = {
    chain: chain.gmgn.chain,
    interval,
    limit,
    order_by: setting('trending_order_by', 'volume'),
    direction: 'desc',
    filters: ['renounced', 'frozen', 'not_wash_trading'],
  };
  if (platforms) params.platforms = platforms;

  const payload = await gmgnFetch('/v1/market/rank', { params });
  return normalizedTrendingRows(payload).map((row, index) => ({
    ...row,
    interval,
    rank: index + 1,
    source: 'gmgn_market_rank',
  }));
}

export async function fetchGmgnTrending() {
  if (!boolSetting('trending_enabled', true)) {
    trending.clear();
    return;
  }
  const chain = getActiveChain();
  const interval = setting('trending_interval', '5m');
  const limit = Math.max(1, Math.min(200, Math.floor(numSetting('trending_limit', 100))));
  const source = setting('trending_source', 'jupiter');

  try {
    let rows;
    if (chain.type !== 'solana') {
      // EVM chains: use combined DexScreener + GMGN trending from chain/signals
      const combined = await fetchCombinedTrending(limit);
      rows = combined.map((row, index) => ({
        ...row,
        interval,
        rank: index + 1,
        source: row.sources?.includes('dexscreener') && row.sources?.includes('gmgn')
          ? 'dexscreener+gmgn'
          : row.sources?.[0] || 'combined',
        swaps: row.swaps ?? row.gmgnData?.swaps ?? 0,
        volume: row.volume24h ?? row.gmgnData?.volume24h ?? 0,
        rug_ratio: row.rug_ratio ?? 0,
        bundler_rate: row.bundler_rate ?? 0,
      }));
    } else {
      // Solana: Jupiter or GMGN
      rows = source === 'gmgn'
        ? await fetchGmgnTrendingRows(interval, Math.min(100, limit))
        : await fetchJupiterTrendingRows(interval, limit);
    }

    const seenAt = now();
    const cutoff = seenAt - TRENDING_LOOKBACK_MS;
    for (const [mint, token] of trending) {
      if (Number(token.seenAt || 0) < cutoff) trending.delete(mint);
    }
    let tracked = 0;
    const isSolana = chain.type === 'solana';
    for (const [index, row] of rows.entries()) {
      const mint = row?.address || row?.mint;
      if (!mint) continue;
      // Only apply .endsWith('pump') filter on Solana
      if (isSolana && !String(mint).endsWith('pump')) continue;
      if (!trendingSignalPass(row)) continue;
      const token = { ...row, address: mint, interval, rank: index + 1, seenAt };
      trending.set(mint, token);
      tracked += 1;
      storeSignalEvent(mint, 'trending', token.source || source, token);
      // Process trending tokens as candidates
      if (candidateHandler) {
        await candidateHandler({ mint, trendingToken: token, route: 'trending' });
      } else if (degenHandler) {
        await degenHandler(mint, token);
      }
    }
    console.log(`[trending:${source}] loaded ${rows.length}, accepted ${tracked}, tracking ${trending.size}`);
  } catch (err) {
    if (source === 'gmgn') setGmgnBackoff('trending', err);
    const status = err.response?.status || '';
    const body = err.response?.data;
    const resetAt = body?.reset_at ? ` reset_at=${body.reset_at}` : '';
    if (source !== 'gmgn' || (status !== 403 && status !== 429)) console.log(`[trending:${source}] ${status} ${body?.code || ''} ${body?.message || err.message}${resetAt}`);
  }
}
