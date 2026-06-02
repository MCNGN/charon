// src/chain/signals.js
// Chain-agnostic signal sources
// Solana: Pump.fun (feeClaim, graduated) + Jupiter trending + GMGN
// EVM: DexScreener trending + GMGN trending + new token monitoring

import { getActiveChain } from './config.js';
import { randomUUID } from 'node:crypto';
import * as dexscreener from './dexscreener.js';

const GMGN_BASE = 'https://openapi.gmgn.ai';

/**
 * Fetch GMGN token rank/trending for current chain
 */
export async function fetchGmgnTrending(limit = 20, orderby = 'swaps', timeframe = '1h') {
  const chain = getActiveChain();
  const apiKey = process.env.GMGN_API_KEY;
  if (!apiKey) throw new Error('GMGN_API_KEY not set');

  const url = new URL(`${GMGN_BASE}/v1/market/rank`);
  url.searchParams.set('chain', chain.gmgn.chain);
  url.searchParams.set('limit', limit.toString());
  url.searchParams.set('orderby', orderby);
  url.searchParams.set('direction', 'desc');
  url.searchParams.set('period', timeframe);
  url.searchParams.set('timestamp', Math.floor(Date.now() / 1000).toString());
  url.searchParams.set('client_id', randomUUID());

  const res = await fetch(url, {
    headers: {
      'X-APIKEY': apiKey,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GMGN trending failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  return (data.data?.data?.rank || data.data?.rank || []).map(t => ({
    address: t.address,
    symbol: t.symbol,
    name: t.name,
    price: t.price,
    priceChange1h: t.price_change_percent,
    volume24h: t.volume_24h,
    liquidity: t.liquidity,
    marketCap: t.market_cap,
    holders: t.holder_count,
    swaps: t.swap_count,
    buys: t.buy_count,
    sells: t.sell_count,
    top10HolderRate: t.top_10_holder_rate,
    source: 'gmgn',
  }));
}

/**
 * Fetch GMGN token info
 */
export async function fetchGmgnTokenInfo(address) {
  const chain = getActiveChain();
  const apiKey = process.env.GMGN_API_KEY;
  if (!apiKey) throw new Error('GMGN_API_KEY not set');

  const url = new URL(`${GMGN_BASE}/v1/token/info`);
  url.searchParams.set('chain', chain.gmgn.chain);
  url.searchParams.set('address', address);
  url.searchParams.set('timestamp', Math.floor(Date.now() / 1000).toString());
  url.searchParams.set('client_id', randomUUID());

  const res = await fetch(url, {
    headers: {
      'X-APIKEY': apiKey,
      'Content-Type': 'application/json',
    },
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`GMGN token info failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  const t = data.data;
  if (!t) return null;

  return {
    address: t.address,
    symbol: t.symbol,
    name: t.name,
    price: t.price,
    priceChange1h: t.price_change_percent_1h,
    priceChange24h: t.price_change_percent_24h,
    volume24h: t.volume_24h,
    liquidity: t.liquidity,
    marketCap: t.market_cap,
    holders: t.holder_count,
    top10HolderRate: t.top_10_holder_rate,
    creator: t.creator,
    createdAt: t.creation_timestamp,
    social: {
      twitter: t.twitter_username,
      website: t.website,
      telegram: t.telegram,
    },
    source: 'gmgn',
  };
}

/**
 * Fetch DexScreener trending tokens for current chain
 */
export async function fetchDexscreenerTrending() {
  return dexscreener.fetchTrendingTokens();
}

/**
 * Fetch combined trending tokens from all sources
 * Deduplicates by address and merges data
 */
export async function fetchCombinedTrending(limit = 30) {
  const chain = getActiveChain();
  const results = new Map();

  // DexScreener trending
  try {
    const dsTrending = await dexscreener.fetchTrendingTokens();
    for (const t of dsTrending) {
      results.set(t.address.toLowerCase(), {
        ...t,
        sources: ['dexscreener'],
      });
    }
  } catch (e) {
    console.error(`[signals] DexScreener trending failed: ${e.message}`);
  }

  // GMGN trending
  try {
    const gmgnTrending = await fetchGmgnTrending(limit);
    for (const t of gmgnTrending) {
      const key = t.address.toLowerCase();
      if (results.has(key)) {
        const existing = results.get(key);
        existing.sources.push('gmgn');
        existing.gmgnData = t;
      } else {
        results.set(key, {
          address: t.address,
          symbol: t.symbol,
          name: t.name,
          volume24h: t.volume24h,
          liquidity: t.liquidity,
          marketCap: t.marketCap,
          sources: ['gmgn'],
          gmgnData: t,
        });
      }
    }
  } catch (e) {
    console.error(`[signals] GMGN trending failed: ${e.message}`);
  }

  // Sort by source count (multi-source = more reliable) then by volume
  return Array.from(results.values())
    .sort((a, b) => {
      if (a.sources.length !== b.sources.length) return b.sources.length - a.sources.length;
      return (b.volume24h || 0) - (a.volume24h || 0);
    })
    .slice(0, limit);
}

/**
 * Solana-only: Start Pump.fun fee claim WebSocket monitor
 * Returns null for EVM chains
 */
export async function startPumpFunMonitor(onSignal) {
  const chain = getActiveChain();
  if (!chain.pumpfun) {
    console.log(`[signals] Pump.fun not available on ${chain.name}, skipping`);
    return null;
  }

  // Dynamic import to avoid loading Solana deps on EVM chains
  const { startWebsocket } = await import('../signals/feeClaim.js');
  return startWebsocket(onSignal);
}

/**
 * Solana-only: Fetch Pump.fun graduated coins
 * Returns empty for EVM chains
 */
export async function fetchGraduated() {
  const chain = getActiveChain();
  if (!chain.pumpfun) {
    console.log(`[signals] Pump.fun graduated not available on ${chain.name}`);
    return [];
  }

  const { fetchGraduatedCoins } = await import('../signals/graduated.js');
  return fetchGraduatedCoins();
}

export default {
  fetchGmgnTrending,
  fetchGmgnTokenInfo,
  fetchDexscreenerTrending,
  fetchCombinedTrending,
  startPumpFunMonitor,
  fetchGraduated,
};
