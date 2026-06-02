// src/liveExecutor.js
// Chain-agnostic live execution layer.
// Delegates to the chain abstraction (src/chain/index.js) so swaps work
// on both Solana (Jupiter) and EVM chains (1inch/Odos).

import {
  initChain,
  buyToken,
  sellToken,
  getWalletBalance,
  getTokenBalance,
  getActiveChain,
} from './chain/index.js';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------
let _initialized = false;
let _walletAddress = null; // base58 (Solana) or 0x… (EVM)

// ---------------------------------------------------------------------------
// initLiveExecution — replaces old Solana-only Connection + Keypair setup
// ---------------------------------------------------------------------------
export async function initLiveExecution() {
  try {
    const chain = getActiveChain();
    const result = await initChain();

    // Solana adapter returns { connection, wallet }, EVM returns { client, account }
    if (chain.type === 'solana') {
      _walletAddress = result.wallet.publicKey.toBase58();
    } else {
      _walletAddress = result.account.address;
    }

    _initialized = true;
    console.log(`[live] wallet loaded ${_walletAddress} (${chain.name})`);
  } catch (err) {
    _initialized = false;
    _walletAddress = null;
    console.log(`[live] wallet load failed: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// liveWalletPubkey — works for both Solana (base58) and EVM (0x…)
// ---------------------------------------------------------------------------
export function liveWalletPubkey() {
  return _walletAddress || null;
}

// ---------------------------------------------------------------------------
// fetchLiveTokenBalance — returns raw balance string (smallest unit)
// ---------------------------------------------------------------------------
export async function fetchLiveTokenBalance(mint) {
  if (!_initialized) return null;
  try {
    const chain = getActiveChain();
    const decimals = chain.type === 'solana' ? 6 : 18; // default; overridden by adapter
    const result = await getTokenBalance(mint, _walletAddress, decimals);
    return result.balance || null;
  } catch (err) {
    console.log(`[live] token balance ${String(mint).slice(0, 8)}... ${err.message}`);
    return null;
  }
}

// ---------------------------------------------------------------------------
// requireLiveExecution — guard for functions that need an active wallet
// ---------------------------------------------------------------------------
export function requireLiveExecution() {
  if (!_initialized) {
    const chain = (() => { try { return getActiveChain(); } catch { return null; } })();
    const keyEnv = chain?.type === 'evm' ? 'EVM_PRIVATE_KEY' : 'SOLANA_PRIVATE_KEY';
    throw new Error(`${keyEnv} is required for live execution.`);
  }
}

// ---------------------------------------------------------------------------
// liveWalletBalanceLamports — returns native balance in smallest unit (number)
// ---------------------------------------------------------------------------
export async function liveWalletBalanceLamports() {
  requireLiveExecution();
  const result = await getWalletBalance(_walletAddress);
  return Number(result.balance);
}

// ---------------------------------------------------------------------------
// executeSwap — unified swap that works across chains
//
// The callers pass { inputMint, outputMint, amount } (Solana naming).
// We detect buy vs sell by comparing against the chain's wrapped native token.
//
// Returns the same shape callers expect: { signature, outputAmount, inputAmount, … }
// ---------------------------------------------------------------------------
export async function executeSwap({ inputMint, outputMint, amount }) {
  requireLiveExecution();

  const chain = getActiveChain();
  const wrappedNative = chain.wrappedNative;
  const isBuy = String(inputMint).toLowerCase() === String(wrappedNative).toLowerCase();

  let result;
  if (isBuy) {
    // Buy: spending native token to buy outputMint
    // chain abstraction buyToken expects nativeAmount in native units (SOL / ETH)
    // but callers pass amount in smallest units (lamports / wei), so convert
    const nativeAmount = Number(amount) / (10 ** chain.nativeToken.decimals);
    const slippage = chain.type === 'solana' ? 50 : 1; // bps for Solana, % for EVM
    result = await buyToken(outputMint, nativeAmount, slippage);
  } else {
    // Sell: selling inputMint for native token
    const slippage = chain.type === 'solana' ? 50 : 1;
    result = await sellToken(inputMint, Number(amount), slippage);
  }

  // Normalise return shape so callers (router, positions) work unchanged
  return {
    // keep old fields for backward compat
    order: null,
    executed: null,
    signature: result.txHash || result.signature || null,
    inputAmount: result.inputAmount || String(amount),
    outputAmount: result.outputAmount || '0',
    // new fields
    txHash: result.txHash || result.signature || null,
    success: result.success !== false,
  };
}

// ---------------------------------------------------------------------------
// Backward-compat alias: executeJupiterSwap delegates to executeSwap
// ---------------------------------------------------------------------------
export { executeSwap as executeJupiterSwap };
