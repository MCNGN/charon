import { now, firstPositiveNumber, marketCapFromGmgn, tokenPriceFromGmgn, toNative } from '../utils.js';
import { getActiveChain } from '../chain/config.js';
import * as dexscreener from '../chain/dexscreener.js';
import { activeStrategy } from '../db/settings.js';
import { fetchGmgnTokenInfo } from '../enrichment/gmgn.js';
import { fetchSavedWalletExposure } from '../enrichment/wallets.js';
import { fetchTwitterNarrative } from '../enrichment/twitter.js';
import { gmgnLink } from '../format.js';

// Lazy-loaded Jupiter module (Solana only)
let jupiter = null;
async function getJupiter() {
  if (!jupiter) {
    jupiter = await import('../enrichment/jupiter.js');
  }
  return jupiter;
}

/**
 * Normalize DexScreener token info to a shape compatible with Jupiter asset
 * so downstream code (buildCandidate) doesn't need chain-specific branches.
 */
function normalizeDexScreenerToken(info) {
  if (!info) return null;
  return {
    id: info.address,
    name: info.name,
    symbol: info.symbol,
    usdPrice: info.price,
    mcap: info.marketCap,
    fdv: info.marketCap,
    liquidity: info.liquidity,
    holderCount: null, // DexScreener doesn't provide holder data
    fees: null,        // DexScreener doesn't provide fee data
    twitter: null,
    website: null,
    telegram: null,
    // pass through pair info for chart lookups
    pairAddress: info.pairAddress,
  };
}

/**
 * DexScreener has no holder endpoint — return an empty stub matching Jupiter shape.
 */
function emptyHolders() {
  return { count: 0, holders: [], top20: [], top20Percent: null, maxHolderPercent: null };
}

/**
 * Compute ATH/range context from DexScreener OHLCV candles (GeckoTerminal).
 * Adapts to the same shape as fetchJupiterChartContext.
 */
function chartContextFromCandles(candles, label) {
  if (!candles || !candles.length) return { label, available: false };
  const first = candles[0];
  const last = candles[candles.length - 1];
  const high = Math.max(...candles.map(c => Number(c.high || 0)));
  const low = Math.min(...candles.map(c => Number(c.low || Infinity)));
  const volumeNative = candles.reduce((sum, c) => sum + Number(c.volume || 0), 0);
  const current = Number(last.close);
  const start = Number(first.open);
  return {
    label,
    available: true,
    purpose: label === 'ath_context_24h_5m' ? 'ath_context' : 'range_context',
    candles: candles.length,
    fromTime: first.timestamp,
    toTime: last.timestamp,
    current,
    high,
    low,
    volumeNative,
    changePercent: start > 0 ? (current / start - 1) * 100 : null,
    belowHighPercent: high > 0 ? (current / high - 1) * 100 : null,
    aboveLowPercent: low > 0 && Number.isFinite(low) ? (current / low - 1) * 100 : null,
  };
}

async function fetchDexScreenerChartContext(pairAddress) {
  if (!pairAddress) return null;

  const timeframes = [
    ['1h', 24, 'ath_context_24h_5m'],   // 24 × 1h candles ≈ 24h
    ['1h', 168, 'swing_7d_1h'],          // 168 × 1h candles ≈ 7d
    ['4h', 180, 'long_30d_4h'],          // 180 × 4h candles ≈ 30d
  ];

  const results = await Promise.all(timeframes.map(([interval, , label]) =>
    dexscreener.fetchChart(pairAddress, interval)
      .then(candles => chartContextFromCandles(candles, label))
      .catch((err) => {
        console.log(`[chart-dex] ${pairAddress.slice(0, 8)}... ${interval} ${err.message}`);
        return { label, available: false, error: err.message };
      })
  ));

  const available = results.filter(row => row.available);
  const currentNative = available[0]?.current ?? null;
  const rangeHigh = available.length ? Math.max(...available.map(row => Number(row.high || 0))) : null;
  const topBlastRisk = Number.isFinite(Number(currentNative)) && Number.isFinite(Number(rangeHigh)) && rangeHigh > 0
    ? currentNative / rangeHigh >= 0.85
    : null;

  return {
    quote: 'native',
    purpose: 'ATH/range context, not momentum scoring',
    currentNative,
    rangeHighNative: rangeHigh,
    belowRangeHighPercent: currentNative && rangeHigh ? (currentNative / rangeHigh - 1) * 100 : null,
    distanceFromAthPercent: currentNative && rangeHigh ? (currentNative / rangeHigh - 1) * 100 : null,
    topBlastRisk,
    windows: results,
  };
}

/**
 * Chain-agnostic fetch wrappers.
 * On Solana: use Jupiter Data API.
 * On EVM chains: use DexScreener / GeckoTerminal.
 */
async function fetchTokenData(mint) {
  const chain = getActiveChain();
  if (chain.type === 'solana') {
    const jup = await getJupiter();
    return jup.fetchJupiterAsset(mint);
  }
  const info = await dexscreener.fetchTokenInfo(mint);
  return normalizeDexScreenerToken(info);
}

async function fetchHolderData(mint) {
  const chain = getActiveChain();
  if (chain.type === 'solana') {
    const jup = await getJupiter();
    return jup.fetchJupiterHolders(mint);
  }
  // DexScreener has no holder endpoint
  return emptyHolders();
}

async function fetchChartData(mint, tokenData) {
  const chain = getActiveChain();
  if (chain.type === 'solana') {
    const jup = await getJupiter();
    return jup.fetchJupiterChartContext(mint);
  }
  // For EVM: use DexScreener chart via the pair address from token info
  const pairAddress = tokenData?.pairAddress;
  return fetchDexScreenerChartContext(pairAddress);
}

export function buildFeeSnapshot(fee, signature) {
  return {
    mint: fee.mint,
    signature,
    // DB field kept as distributedSol for backward compatibility
    distributedSol: toNative(fee.distributed),
    recipients: fee.shareholders.map(holder => ({
      address: holder.pubkey,
      bps: holder.bps,
      percent: holder.bps / 100,
    })),
  };
}

export function signalLabel(signals = {}) {
  return [
    signals.hasFeeClaim ? 'fees' : null,
    signals.hasGraduated ? 'graduated' : null,
    signals.hasTrending ? 'trending' : null,
  ].filter(Boolean).join(' + ') || signals.route || 'unknown';
}

export function filterCandidate(candidate) {
  const strat = activeStrategy();
  const chain = getActiveChain();
  const nativeSymbol = chain.nativeToken.symbol;
  const failures = [];
  const mcap = candidate.metrics.marketCapUsd;
  const totalFees = candidate.metrics.gmgnTotalFeesSol;
  const gradVolume = candidate.metrics.graduatedVolumeUsd;
  const maxHolder = candidate.holders.maxHolderPercent;
  const savedCount = candidate.savedWalletExposure.holderCount;
  const feeNative = candidate.feeClaim?.distributedSol; // DB field kept as-is
  const holderCount = Number(candidate.metrics.holderCount || 0);
  const trendingVolume = Number(candidate.trending?.volume ?? 0);
  const trendingSwaps = Number(candidate.trending?.swaps ?? 0);
  const rugRatio = Number(candidate.trending?.rug_ratio ?? 0);
  const bundlerRate = Number(candidate.trending?.bundler_rate ?? 0);

  // Fee claim check
  if (candidate.feeClaim) {
    const minFee = strat.min_fee_claim_sol ?? 0.5;
    if (minFee > 0 && feeNative < minFee) {
      failures.push(`fee claim: ${feeNative} ${nativeSymbol} < min ${minFee} ${nativeSymbol}`);
    }
  } else if (strat.require_fee_claim) {
    failures.push('fee claim: missing (required by strategy)');
  }

  // Market cap checks
  if (strat.min_mcap_usd > 0 && (!Number.isFinite(mcap) || mcap < strat.min_mcap_usd)) {
    failures.push(`market cap min: ${mcap} < ${strat.min_mcap_usd}`);
  }
  if (strat.max_mcap_usd > 0 && Number.isFinite(mcap) && mcap > strat.max_mcap_usd) {
    failures.push(`market cap max: ${mcap} > ${strat.max_mcap_usd}`);
  }

  // GMGN fees — only enforce when GMGN data is available; Jupiter/DexScreener has no equivalent
  if (strat.min_gmgn_total_fee_sol > 0 && candidate.gmgn !== null && totalFees < strat.min_gmgn_total_fee_sol) {
    failures.push(`GMGN total fees: ${totalFees} < ${strat.min_gmgn_total_fee_sol}`);
  }

  // Graduated volume — only enforce when the token actually has graduated data
  if (strat.min_graduated_volume_usd > 0 && candidate.graduation && gradVolume < strat.min_graduated_volume_usd) {
    failures.push(`graduated volume: ${gradVolume} < ${strat.min_graduated_volume_usd}`);
  }

  // Holder count
  if (strat.min_holders > 0 && holderCount < strat.min_holders) {
    failures.push(`holders: ${holderCount} < ${strat.min_holders}`);
  }

  // Top holder concentration
  if (strat.max_top20_holder_percent < 100 && Number.isFinite(maxHolder) && maxHolder > strat.max_top20_holder_percent) {
    failures.push(`max top holder: ${maxHolder}% > ${strat.max_top20_holder_percent}%`);
  }

  // Saved wallet holders
  if (strat.min_saved_wallet_holders > 0 && savedCount < strat.min_saved_wallet_holders) {
    failures.push(`saved wallet holders: ${savedCount} < ${strat.min_saved_wallet_holders}`);
  }

  // ATH distance (dip buy strategy)
  if (strat.max_ath_distance_pct < 0) {
    const athDist = candidate.chart?.distanceFromAthPercent;
    if (athDist != null && athDist > strat.max_ath_distance_pct) {
      failures.push(`ATH distance: ${athDist.toFixed(0)}% > target ${strat.max_ath_distance_pct}%`);
    }
  }

  // Trending filters
  if (candidate.trending) {
    if (strat.trending_min_volume_usd > 0 && trendingVolume < strat.trending_min_volume_usd) {
      failures.push(`trending volume: ${trendingVolume} < ${strat.trending_min_volume_usd}`);
    }
    if (strat.trending_min_swaps > 0 && trendingSwaps < strat.trending_min_swaps) {
      failures.push(`trending swaps: ${trendingSwaps} < ${strat.trending_min_swaps}`);
    }
    if (strat.trending_max_rug_ratio > 0 && Number.isFinite(rugRatio) && rugRatio > strat.trending_max_rug_ratio) {
      failures.push(`trending rug ratio: ${rugRatio} > ${strat.trending_max_rug_ratio}`);
    }
    if (strat.trending_max_bundler_rate > 0 && Number.isFinite(bundlerRate) && bundlerRate > strat.trending_max_bundler_rate) {
      failures.push(`trending bundler rate: ${bundlerRate} > ${strat.trending_max_bundler_rate}`);
    }
    if (candidate.trending.is_wash_trading === true || candidate.trending.is_wash_trading === 1) {
      failures.push('trending wash trading');
    }
  }

  return { passed: failures.length === 0, failures, strategy: strat.id };
}

export async function buildCandidate({ mint, fee = null, signature = null, graduatedCoin = null, trendingToken = null, route }) {
  const strat = activeStrategy();
  const gmgn = await fetchGmgnTokenInfo(mint);
  const tokenData = await fetchTokenData(mint);
  const holders = await fetchHolderData(mint);
  const chart = await fetchChartData(mint, tokenData);
  const savedWalletExposure = await fetchSavedWalletExposure(mint, holders);
  const twitterNarrative = await fetchTwitterNarrative(graduatedCoin || tokenData, gmgn);
  const priceUsd = firstPositiveNumber(tokenPriceFromGmgn(gmgn), tokenData?.usdPrice, trendingToken?.price);
  const marketCapUsd = firstPositiveNumber(
    marketCapFromGmgn(gmgn),
    tokenData?.mcap,
    tokenData?.fdv,
    trendingToken?.market_cap,
    graduatedCoin?.marketCap,
    graduatedCoin?.usd_market_cap,
  );
  const signalRoute = route || [
    fee ? 'fee' : null,
    graduatedCoin ? 'graduated' : null,
    trendingToken ? 'trending' : null,
  ].filter(Boolean).join('_');

  const candidate = {
    token: {
      mint,
      name: gmgn?.name || tokenData?.name || trendingToken?.name || graduatedCoin?.name || '',
      symbol: gmgn?.symbol || tokenData?.symbol || trendingToken?.symbol || graduatedCoin?.ticker || '',
      gmgnUrl: gmgn?.link?.gmgn || gmgnLink(mint),
      twitter: graduatedCoin?.twitter || tokenData?.twitter || gmgn?.link?.twitter_username || trendingToken?.twitter || '',
      website: graduatedCoin?.website || tokenData?.website || gmgn?.link?.website || '',
      telegram: graduatedCoin?.telegram || gmgn?.link?.telegram || '',
    },
    metrics: {
      priceUsd,
      marketCapUsd,
      liquidityUsd: Number(gmgn?.liquidity ?? tokenData?.liquidity ?? trendingToken?.liquidity ?? 0),
      holderCount: Number(gmgn?.holder_count ?? tokenData?.holderCount ?? trendingToken?.holder_count ?? graduatedCoin?.numHolders ?? 0),
      gmgnTotalFeesSol: Number(gmgn?.total_fee ?? tokenData?.fees ?? 0),
      gmgnTradeFeesSol: Number(gmgn?.trade_fee ?? 0),
      graduatedVolumeUsd: Number(graduatedCoin?.volume ?? 0),
      graduatedMarketCapUsd: Number(graduatedCoin?.marketCap ?? 0),
      trendingVolumeUsd: Number(trendingToken?.volume ?? 0),
      trendingSwaps: Number(trendingToken?.swaps ?? 0),
      trendingHotLevel: Number(trendingToken?.hot_level ?? 0),
      trendingSmartDegenCount: Number(trendingToken?.smart_degen_count ?? 0),
    },
    signals: {
      route: signalRoute,
      label: signalLabel({
        hasFeeClaim: Boolean(fee),
        hasGraduated: Boolean(graduatedCoin),
        hasTrending: Boolean(trendingToken),
      }),
      hasFeeClaim: Boolean(fee),
      hasGraduated: Boolean(graduatedCoin),
      hasTrending: Boolean(trendingToken),
      triggerSignature: signature,
      strategy: strat.id,
    },
    graduation: graduatedCoin,
    trending: trendingToken,
    feeClaim: fee ? buildFeeSnapshot(fee, signature) : null,
    gmgn,
    jupiterAsset: tokenData, // field kept for backward compat; on EVM contains normalized DexScreener data
    holders,
    chart,
    savedWalletExposure,
    twitterNarrative,
    createdAtMs: now(),
  };
  candidate.filters = filterCandidate(candidate);
  return candidate;
}
