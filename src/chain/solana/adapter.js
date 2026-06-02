// src/chain/solana/adapter.js
// Solana adapter — wraps existing Solana code into chain-agnostic interface

import { Connection, Keypair, PublicKey, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { getActiveChain } from '../config.js';

let connection = null;
let wallet = null;

/**
 * Initialize Solana connection and wallet
 */
export function initSolanaAdapter() {
  const chain = getActiveChain();
  if (chain.type !== 'solana') throw new Error('Not Solana chain');

  const rpcUrl = chain.rpc.http;
  const wsUrl = chain.rpc.ws;

  connection = new Connection(rpcUrl, {
    wsEndpoint: wsUrl,
    commitment: 'confirmed',
  });

  const privateKey = process.env.SOLANA_PRIVATE_KEY;
  if (!privateKey) throw new Error('SOLANA_PRIVATE_KEY not set');

  const decoded = bs58.decode(privateKey);
  wallet = Keypair.fromSecretKey(decoded);

  console.log(`[solana] Initialized, wallet: ${wallet.publicKey.toBase58()}`);
  return { connection, wallet };
}

/**
 * Get wallet balance in SOL
 */
export async function getWalletBalance(address) {
  const conn = connection || initSolanaAdapter().connection;
  const pubkey = address ? new PublicKey(address) : wallet.publicKey;
  const lamports = await conn.getBalance(pubkey);
  return {
    balance: lamports.toString(),
    formatted: `${(lamports / 1e9).toFixed(4)} SOL`,
    symbol: 'SOL',
  };
}

/**
 * Get SPL token balance
 */
export async function getTokenBalance(mintAddress, walletAddress) {
  const conn = connection || initSolanaAdapter().connection;
  const mint = new PublicKey(mintAddress);
  const owner = walletAddress ? new PublicKey(walletAddress) : wallet.publicKey;

  const accounts = await conn.getParsedTokenAccountsByOwner(owner, { mint });
  const balance = accounts.value[0]?.account?.data?.parsed?.info?.tokenAmount;
  
  if (!balance) {
    return { balance: '0', formatted: '0', uiAmount: 0 };
  }

  return {
    balance: balance.amount,
    formatted: balance.uiAmountString || '0',
    uiAmount: balance.uiAmount || 0,
    decimals: balance.decimals,
  };
}

/**
 * Execute Jupiter Ultra swap
 */
async function executeJupiterSwap(inputMint, outputMint, amount, slippage = 50) {
  const chain = getActiveChain();
  const apiKey = process.env.JUPITER_API_KEY;
  if (!apiKey) throw new Error('JUPITER_API_KEY not set');

  // Step 1: Get order
  const orderUrl = `${chain.swap.jupiterBaseUrl}/order`;
  const orderRes = await fetch(orderUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      inputMint,
      outputMint,
      amount: amount.toString(),
      slippageBps: slippage,
      taker: wallet.publicKey.toBase58(),
    }),
  });

  if (!orderRes.ok) {
    const text = await orderRes.text();
    throw new Error(`Jupiter order failed: ${orderRes.status} ${text}`);
  }

  const order = await orderRes.json();

  // Step 2: Sign and execute
  const txBuf = Buffer.from(order.swapTransaction, 'base64');
  const tx = VersionedTransaction.deserialize(txBuf);
  tx.sign([wallet]);

  const executeRes = await fetch(`${chain.swap.jupiterBaseUrl}/execute`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      signedTransaction: Buffer.from(tx.serialize()).toString('base64'),
      requestId: order.requestId,
    }),
  });

  if (!executeRes.ok) {
    const text = await executeRes.text();
    throw new Error(`Jupiter execute failed: ${executeRes.status} ${text}`);
  }

  return executeRes.json();
}

/**
 * Buy token with SOL
 */
export async function buyToken(tokenAddress, solAmount, slippage = 50) {
  const chain = getActiveChain();
  const lamports = Math.round(solAmount * 1e9);

  console.log(`[solana] Buying ${tokenAddress} with ${solAmount} SOL (slippage: ${slippage}bps)...`);

  const result = await executeJupiterSwap(
    chain.wrappedNative, // WSOL
    tokenAddress,
    lamports,
    slippage,
  );

  return {
    txHash: result.txid || result.signature,
    inputAmount: solAmount.toString(),
    outputAmount: result.outputAmount || '0',
    success: !result.error,
    gasUsed: '0', // Solana doesn't expose gas in the same way
  };
}

/**
 * Sell token for SOL
 */
export async function sellToken(tokenAddress, tokenAmount, slippage = 50) {
  const chain = getActiveChain();

  // Get token decimals first
  const balance = await getTokenBalance(tokenAddress);
  const rawAmount = Math.round(tokenAmount * (10 ** (balance.decimals || 6)));

  console.log(`[solana] Selling ${tokenAmount} of ${tokenAddress} for SOL (slippage: ${slippage}bps)...`);

  const result = await executeJupiterSwap(
    tokenAddress,
    chain.wrappedNative, // WSOL
    rawAmount,
    slippage,
  );

  return {
    txHash: result.txid || result.signature,
    inputAmount: tokenAmount.toString(),
    outputAmount: result.outputAmount || '0',
    success: !result.error,
    gasUsed: '0',
  };
}

/**
 * Get swap quote from Jupiter
 */
export async function getSwapQuote(inputMint, outputMint, amount) {
  const chain = getActiveChain();
  const apiKey = process.env.JUPITER_API_KEY;
  if (!apiKey) throw new Error('JUPITER_API_KEY not set');

  const res = await fetch(`${chain.swap.jupiterBaseUrl}/quote`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ inputMint, outputMint, amount: amount.toString() }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Jupiter quote failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  return {
    inputAmount: amount.toString(),
    outputAmount: data.outAmount || '0',
    priceImpact: data.priceImpactPct || 0,
    route: data.routePlan || [],
    provider: 'jupiter',
  };
}

export default {
  initSolanaAdapter,
  getWalletBalance,
  getTokenBalance,
  buyToken,
  sellToken,
  getSwapQuote,
};
