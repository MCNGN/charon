// src/chain/dexscreener.js
// DexScreener API integration — works across all chains
// Replaces Jupiter Data API for non-Solana chains

import { getActiveChain } from './config.js';

const BASE_URL = 'https://api.dexscreener.com';
const CACHE_TTL = 60_000; // 1 min cache
const cache = new Map();

function getCached(key) {
  const entry = cache.get(key);
  if (entry && Date.now() - entry.ts < CACHE_TTL) return entry.data;
  return null;
}

function setCache(key, data) {
  cache.set(key, { data, ts: Date.now() });
  // Cleanup old entries
  if (cache.size > 500) {
    const now = Date.now();
    for (const [k, v] of cache) {
      if (now - v.ts > CACHE_TTL * 5) cache.delete(k);
    }
  }
}

async function dexFetch(path) {
  const url = `${BASE_URL}${path}`;
  const cached = getCached(url);
  if (cached) return cached;

  const res = await fetch(url);
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`DexScreener ${path} failed: ${res.status} ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  setCache(url, data);
  return data;
}

/**
 * Get token info by address
 * Returns: { name, symbol, price, priceUsd, volume24h, liquidity, marketCap, ... }
 */
export async function fetchTokenInfo(tokenAddress) {
  const chain = getActiveChain();
  const data = await dexFetch(`/latest/dex/tokens/${tokenAddress}`);
  const pairs = (data.pairs || []).filter(p => p.chainId === chain.dexscreener.chainId);
  
  if (!pairs.length) return null;

  // Pick the pair with highest liquidity
  const best = pairs.sort((a, b) => (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0))[0];
  
  return {
    name: best.baseToken?.name,
    symbol: best.baseToken?.symbol,
    address: best.baseToken?.address,
    price: best.priceUsd ? parseFloat(best.priceUsd) : null,
    priceNative: best.priceNative ? parseFloat(best.priceNative) : null,
    volume24h: best.volume?.h24 || 0,
    volume6h: best.volume?.h6 || 0,
    volume1h: best.volume?.h1 || 0,
    liquidity: best.liquidity?.usd || 0,
    marketCap: best.marketCap || best.fdv || 0,
    priceChange24h: best.priceChange?.h24 || 0,
    priceChange6h: best.priceChange?.h6 || 0,
    priceChange1h: best.priceChange?.h1 || 0,
    txns24h: best.txns?.h24 ? (best.txns.h24.buys + best.txns.h24.sells) : 0,
    buys24h: best.txns?.h24?.buys || 0,
    sells24h: best.txns?.h24?.sells || 0,
    pairAddress: best.pairAddress,
    dexId: best.dexId,
    url: best.url,
    chainId: best.chainId,
    createdAt: best.pairCreatedAt,
  };
}

/**
 * Search tokens by query
 */
export async function searchTokens(query) {
  const chain = getActiveChain();
  const data = await dexFetch(`/latest/dex/search?q=${encodeURIComponent(query)}`);
  const pairs = (data.pairs || []).filter(p => p.chainId === chain.dexscreener.chainId);
  
  return pairs.slice(0, 20).map(p => ({
    name: p.baseToken?.name,
    symbol: p.baseToken?.symbol,
    address: p.baseToken?.address,
    price: p.priceUsd ? parseFloat(p.priceUsd) : null,
    volume24h: p.volume?.h24 || 0,
    liquidity: p.liquidity?.usd || 0,
    marketCap: p.marketCap || p.fdv || 0,
    pairAddress: p.pairAddress,
    dexId: p.dexId,
  }));
}

/**
 * Get trending/boosted tokens
 */
export async function fetchTrendingTokens() {
  const chain = getActiveChain();
  const data = await dexFetch('/token-boosts/top/v1');
  
  return (data || [])
    .filter(t => t.chainId === chain.dexscreener.chainId)
    .slice(0, 20)
    .map(t => ({
      address: t.tokenAddress,
      description: t.description?.slice(0, 100),
      url: t.url,
      totalBoosts: t.totalAmount,
    }));
}

/**
 * Get token profiles (latest)
 */
export async function fetchTokenProfiles() {
  const chain = getActiveChain();
  const data = await dexFetch('/token-profiles/latest/v1');
  
  return (data || [])
    .filter(t => t.chainId === chain.dexscreener.chainId)
    .slice(0, 20)
    .map(t => ({
      address: t.tokenAddress,
      description: t.description?.slice(0, 100),
      url: t.url,
      links: t.links || [],
    }));
}

/**
 * Get pairs for a token (multiple DEXes)
 */
export async function fetchTokenPairs(tokenAddress) {
  const chain = getActiveChain();
  const data = await dexFetch(`/latest/dex/tokens/${tokenAddress}`);
  
  return (data.pairs || [])
    .filter(p => p.chainId === chain.dexscreener.chainId)
    .map(p => ({
      pairAddress: p.pairAddress,
      dexId: p.dexId,
      baseToken: p.baseToken,
      quoteToken: p.quoteToken,
      price: p.priceUsd ? parseFloat(p.priceUsd) : null,
      volume24h: p.volume?.h24 || 0,
      liquidity: p.liquidity?.usd || 0,
      priceChange24h: p.priceChange?.h24 || 0,
    }))
    .sort((a, b) => b.liquidity - a.liquidity);
}

/**
 * Get chart data for a pair
 * Note: DexScreener doesn't have a public chart API, use GeckoTerminal as fallback
 */
export async function fetchChart(pairAddress, timeframe = '1h') {
  // GeckoTerminal API (free, no key needed)
  const chain = getActiveChain();
  const gtChain = chain.id === 'bsc' ? 'bsc' : chain.id;
  
  try {
    const url = `https://api.geckoterminal.com/api/v2/networks/${gtChain}/pools/${pairAddress}/ohlcv/${timeframe}?limit=100`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    
    const ohlcv = data.data?.attributes?.ohlcv_list || [];
    return ohlcv.map(c => ({
      timestamp: c[0],
      open: c[1],
      high: c[2],
      low: c[3],
      close: c[4],
      volume: c[5],
    }));
  } catch (e) {
    console.error(`[dexscreener] Chart fetch failed: ${e.message}`);
    return null;
  }
}

export default {
  fetchTokenInfo,
  searchTokens,
  fetchTrendingTokens,
  fetchTokenProfiles,
  fetchTokenPairs,
  fetchChart,
};
