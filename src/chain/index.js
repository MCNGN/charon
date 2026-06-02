// src/chain/index.js
// Main chain abstraction entry point
// Provides a unified interface regardless of active chain

import { getActiveChain, getChain, listChains } from './config.js';
import { formatNative, fromSmallestUnit, toSmallestUnit, txLink, accountLink, tokenLink, gmgnLink, fmtNative, fmtUsd, normalizeAddress, isWrappedNative } from './utils.js';
import * as dexscreener from './dexscreener.js';

// Lazy-loaded chain-specific modules
let solanaModule = null;
let evmProvider = null;
let evmSwap = null;

async function getSolana() {
  if (!solanaModule) {
    solanaModule = await import('./solana/adapter.js');
  }
  return solanaModule;
}

async function getEvmProvider() {
  if (!evmProvider) {
    evmProvider = await import('./evm/provider.js');
  }
  return evmProvider;
}

async function getEvmSwap() {
  if (!evmSwap) {
    evmSwap = await import('./evm/swap.js');
  }
  return evmSwap;
}

/**
 * Initialize the chain provider for the active chain
 */
export async function initChain() {
  const chain = getActiveChain();
  console.log(`[chain] Initializing ${chain.name} (${chain.type})...`);

  if (chain.type === 'solana') {
    const sol = await getSolana();
    return sol.initSolanaAdapter();
  } else {
    const evm = await getEvmProvider();
    return evm.initEvmProvider();
  }
}

/**
 * Get wallet balance in native token (SOL/ETH/BNB)
 * Returns: { balance, formatted, symbol }
 */
export async function getWalletBalance(address) {
  const chain = getActiveChain();

  if (chain.type === 'solana') {
    const sol = await getSolana();
    return sol.getWalletBalance(address);
  } else {
    const evm = await getEvmProvider();
    const balance = await evm.getNativeBalance(address);
    return {
      balance: balance.toString(),
      formatted: formatNative(balance),
      symbol: chain.nativeToken.symbol,
    };
  }
}

/**
 * Get token balance
 * Returns: { balance, formatted }
 */
export async function getTokenBalance(tokenAddress, walletAddress, decimals = 18) {
  const chain = getActiveChain();

  if (chain.type === 'solana') {
    const sol = await getSolana();
    return sol.getTokenBalance(tokenAddress, walletAddress);
  } else {
    const evm = await getEvmProvider();
    const balance = await evm.getTokenBalance(tokenAddress, walletAddress);
    return {
      balance: balance.toString(),
      formatted: formatNative(balance), // needs decimals param
    };
  }
}

/**
 * Execute a buy: spend native token to buy a token
 * Returns: { txHash, outputAmount, gasUsed, success }
 */
export async function buyToken(tokenAddress, nativeAmount, slippage = 1) {
  const chain = getActiveChain();

  if (chain.type === 'solana') {
    const sol = await getSolana();
    return sol.buyToken(tokenAddress, nativeAmount, slippage);
  } else {
    const swap = await getEvmSwap();
    return swap.buyWithNative(tokenAddress, nativeAmount, slippage);
  }
}

/**
 * Execute a sell: sell token for native token
 * Returns: { txHash, outputAmount, gasUsed, success }
 */
export async function sellToken(tokenAddress, tokenAmount, slippage = 1, decimals = 18) {
  const chain = getActiveChain();

  if (chain.type === 'solana') {
    const sol = await getSolana();
    return sol.sellToken(tokenAddress, tokenAmount, slippage);
  } else {
    const swap = await getEvmSwap();
    return swap.sellForNative(tokenAddress, tokenAmount, slippage, decimals);
  }
}

/**
 * Get a swap quote without executing
 */
export async function getSwapQuote(inputToken, outputToken, amount, decimals = 18) {
  const chain = getActiveChain();

  if (chain.type === 'solana') {
    const sol = await getSolana();
    return sol.getSwapQuote(inputToken, outputToken, amount);
  } else {
    const swap = await getEvmSwap();
    return swap.getSwapQuote(inputToken, outputToken, amount, decimals);
  }
}

/**
 * Get native token price in USD
 */
export async function getNativePrice() {
  const chain = getActiveChain();

  if (chain.type === 'solana') {
    // Use Jupiter price for Solana
    try {
      const res = await fetch(`https://lite-api.jup.ag/price/v3?ids=${chain.wrappedNative}`);
      const data = await res.json();
      return data[chain.wrappedNative]?.usdPrice || 0;
    } catch { return 0; }
  } else {
    // Use DexScreener for EVM chains
    try {
      const info = await dexscreener.fetchTokenInfo(chain.wrappedNative);
      return info?.price || 0;
    } catch { return 0; }
  }
}

// Re-export everything
export {
  getActiveChain,
  getChain,
  listChains,

  formatNative,
  fromSmallestUnit,
  toSmallestUnit,
  txLink,
  accountLink,
  tokenLink,
  gmgnLink,
  fmtNative,
  fmtUsd,
  normalizeAddress,
  isWrappedNative,
  dexscreener,
};
