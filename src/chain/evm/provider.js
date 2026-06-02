// src/chain/evm/provider.js
// EVM chain provider (viem-based) for Base, BSC, Ethereum, Arbitrum

import { createPublicClient, http, formatEther, parseEther, parseUnits, formatUnits } from 'viem';
import { base, bsc, mainnet, arbitrum } from 'viem/chains';
import { privateKeyToAccount } from 'viem/accounts';
import { getActiveChain } from '../config.js';

const CHAIN_MAP = {
  base: base,
  bsc: bsc,
  ethereum: mainnet,
  arbitrum: arbitrum,
};

let client = null;
let walletAccount = null;
let currentChainId = null;

/**
 * Initialize EVM provider for the active chain
 */
export function initEvmProvider() {
  const chain = getActiveChain();
  if (chain.type !== 'evm') throw new Error('Not an EVM chain');

  const viemChain = CHAIN_MAP[chain.id];
  if (!viemChain) throw new Error(`No viem chain mapping for ${chain.id}`);

  const privateKey = process.env.EVM_PRIVATE_KEY || process.env.SOLANA_PRIVATE_KEY;
  if (!privateKey) throw new Error('EVM_PRIVATE_KEY not set');

  // viem expects 0x-prefixed hex key
  const hexKey = privateKey.startsWith('0x') ? privateKey : `0x${privateKey}`;
  walletAccount = privateKeyToAccount(hexKey);

  client = createPublicClient({
    chain: viemChain,
    transport: http(chain.rpc.http),
  });

  currentChainId = chain.chainId;
  console.log(`[evm] Initialized for ${chain.name} (chain ${chain.chainId}), wallet: ${walletAccount.address}`);
  return { client, account: walletAccount };
}

/**
 * Get the public client
 */
export function getPublicClient() {
  if (!client) initEvmProvider();
  return client;
}

/**
 * Get the wallet account
 */
export function getWalletAccount() {
  if (!walletAccount) initEvmProvider();
  return walletAccount;
}

/**
 * Get wallet address
 */
export function getWalletAddress() {
  return getWalletAccount().address;
}

/**
 * Get native balance (ETH/BNB) in wei
 */
export async function getNativeBalance(address) {
  const c = getPublicClient();
  const addr = address || getWalletAddress();
  const balance = await c.getBalance({ address: addr });
  return balance; // BigInt in wei
}

/**
 * Get ERC-20 token balance
 */
export async function getTokenBalance(tokenAddress, walletAddress) {
  const c = getPublicClient();
  const addr = walletAddress || getWalletAddress();
  
  const balance = await c.readContract({
    address: tokenAddress,
    abi: [{
      name: 'balanceOf',
      type: 'function',
      stateMutability: 'view',
      inputs: [{ name: 'account', type: 'address' }],
      outputs: [{ name: '', type: 'uint256' }],
    }],
    functionName: 'balanceOf',
    args: [addr],
  });
  return balance; // BigInt in smallest unit
}

/**
 * Get ERC-20 token balance formatted
 */
export async function getTokenBalanceFormatted(tokenAddress, decimals = 18) {
  const balance = await getTokenBalance(tokenAddress);
  return formatUnits(balance, decimals);
}

/**
 * Send a raw transaction
 */
export async function sendTransaction(txParams) {
  const c = getPublicClient();
  const account = getWalletAccount();
  
  // For sending transactions, we need a wallet client
  const { createWalletClient } = await import('viem');
  const chain = getActiveChain();
  const viemChain = CHAIN_MAP[chain.id];
  
  const walletClient = createWalletClient({
    account,
    chain: viemChain,
    transport: http(chain.rpc.http),
  });
  
  const hash = await walletClient.sendTransaction(txParams);
  console.log(`[evm] TX sent: ${hash}`);
  return hash;
}

/**
 * Wait for transaction receipt
 */
export async function waitForTx(hash, timeout = 60000) {
  const c = getPublicClient();
  const receipt = await c.waitForTransactionReceipt({ 
    hash, 
    timeout,
    confirmations: 1,
  });
  return receipt;
}

/**
 * Estimate gas for a transaction
 */
export async function estimateGas(txParams) {
  const c = getPublicClient();
  return c.estimateGas(txParams);
}

/**
 * Get current gas price
 */
export async function getGasPrice() {
  const c = getPublicClient();
  return c.getGasPrice();
}

export default {
  initEvmProvider,
  getPublicClient,
  getWalletAccount,
  getWalletAddress,
  getNativeBalance,
  getTokenBalance,
  getTokenBalanceFormatted,
  sendTransaction,
  waitForTx,
  estimateGas,
  getGasPrice,
};
