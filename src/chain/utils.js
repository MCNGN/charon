// src/chain/utils.js
// Chain-agnostic utility functions

import { getActiveChain } from './config.js';

/**
 * Format native token amount (lamports → SOL, wei → ETH, etc.)
 */
export function formatNative(lamportsOrWei) {
  const chain = getActiveChain();
  const { decimals, symbol } = chain.nativeToken;
  const amount = Number(lamportsOrWei) / 10 ** decimals;
  return `${amount.toFixed(4)} ${symbol}`;
}

/**
 * Convert native token amount to smallest unit
 * e.g. SOL → lamports (1e9), ETH → wei (1e18)
 */
export function toSmallestUnit(amount) {
  const chain = getActiveChain();
  return BigInt(Math.round(amount * 10 ** chain.nativeToken.decimals));
}

/**
 * Convert smallest unit to native token amount
 */
export function fromSmallestUnit(smallest) {
  const chain = getActiveChain();
  return Number(smallest) / 10 ** chain.nativeToken.decimals;
}

/**
 * Get explorer links
 */
export function txLink(hash) {
  return getActiveChain().explorer.tx(hash);
}

export function accountLink(addr) {
  return getActiveChain().explorer.account(addr);
}

export function tokenLink(addr) {
  return getActiveChain().explorer.token(addr);
}

/**
 * Get GMGN link for token
 */
export function gmgnLink(addr) {
  const chain = getActiveChain();
  return chain.gmgn.link(addr);
}

/**
 * Format display amount with native symbol
 */
export function fmtNative(amount) {
  const chain = getActiveChain();
  return `${amount.toFixed(4)} ${chain.nativeToken.symbol}`;
}

/**
 * Format price in USD
 */
export function fmtUsd(amount) {
  if (amount >= 1e6) return `$${(amount / 1e6).toFixed(2)}M`;
  if (amount >= 1e3) return `$${(amount / 1e3).toFixed(2)}K`;
  return `$${amount.toFixed(2)}`;
}

/**
 * Normalize token address for current chain
 * Solana: base58 string
 * EVM: lowercase 0x address
 */
export function normalizeAddress(addr) {
  const chain = getActiveChain();
  if (chain.type === 'solana') return addr; // base58, case-sensitive
  return addr?.toLowerCase(); // EVM addresses are case-insensitive
}

/**
 * Check if an address is the wrapped native token
 */
export function isWrappedNative(address) {
  const chain = getActiveChain();
  if (chain.type === 'solana') return address === chain.wrappedNative;
  return address?.toLowerCase() === chain.wrappedNative.toLowerCase();
}
