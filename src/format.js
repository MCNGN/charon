import { getActiveChain } from './chain/config.js';

export function escapeHtml(value) {
  return String(value ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function short(address) {
  return `${address.slice(0, 6)}...${address.slice(-4)}`;
}

/**
 * Format native token amount (SOL/ETH/BNB)
 * Backward compatible: still works as fmtSol() for Solana
 */
export function fmtSol(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(4) : '?';
}

/**
 * Format native token amount with symbol
 */
export function fmtNative(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '?';
  try {
    const chain = getActiveChain();
    return `${n.toFixed(4)} ${chain.nativeToken.symbol}`;
  } catch {
    return `${n.toFixed(4)}`;
  }
}

export function fmtUsd(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return '?';
  if (n >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(1)}K`;
  return `$${n.toFixed(0)}`;
}

export function fmtPct(value) {
  const n = Number(value);
  return Number.isFinite(n) ? `${n.toFixed(1)}%` : '?';
}

/**
 * GMGN link for token
 * Works across all supported chains
 */
export function gmgnLink(address) {
  try {
    const chain = getActiveChain();
    return chain.gmgn.link(address);
  } catch {
    return `https://gmgn.ai/sol/token/${address}`;
  }
}

/**
 * Transaction explorer link
 * Works across all supported chains
 */
export function txLink(hash) {
  try {
    const chain = getActiveChain();
    return chain.explorer.tx(hash);
  } catch {
    return `https://solscan.io/tx/${hash}`;
  }
}

/**
 * Account/address explorer link
 * Works across all supported chains
 */
export function accountLink(address) {
  try {
    const chain = getActiveChain();
    return chain.explorer.account(address);
  } catch {
    return `https://solscan.io/account/${address}`;
  }
}

/**
 * Token explorer link
 */
export function tokenExplorerLink(address) {
  try {
    const chain = getActiveChain();
    return chain.explorer.token(address);
  } catch {
    return `https://solscan.io/token/${address}`;
  }
}
