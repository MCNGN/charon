// src/chain/evm/swap.js
// EVM swap execution via DEX aggregators (1inch, Odos, 0x)
// Replaces Jupiter Ultra for EVM chains

import { parseUnits, formatUnits, encodeFunctionData } from 'viem';
import { getActiveChain } from '../config.js';
import { getWalletAccount, getWalletAddress, sendTransaction, waitForTx, getPublicClient } from './provider.js';

const ERC20_ABI = {
  approve: {
    name: 'approve',
    type: 'function',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint256' },
    ],
    outputs: [{ name: '', type: 'bool' }],
  },
  allowance: {
    name: 'allowance',
    type: 'function',
    stateMutability: 'view',
    inputs: [
      { name: 'owner', type: 'address' },
      { name: 'spender', type: 'address' },
    ],
    outputs: [{ name: '', type: 'uint256' }],
  },
  decimals: {
    name: 'decimals',
    type: 'function',
    stateMutability: 'view',
    inputs: [],
    outputs: [{ name: '', type: 'uint8' }],
  },
};

/**
 * Check and approve ERC-20 token spending if needed
 */
async function ensureApproval(tokenAddress, spender, amount) {
  const client = getPublicClient();
  const wallet = getWalletAccount();
  
  if (tokenAddress.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
    return; // Native token, no approval needed
  }

  const currentAllowance = await client.readContract({
    address: tokenAddress,
    abi: [ERC20_ABI.allowance],
    functionName: 'allowance',
    args: [wallet.address, spender],
  });

  if (currentAllowance >= amount) {
    return; // Already approved
  }

  console.log(`[swap] Approving ${tokenAddress} for ${spender}...`);
  const hash = await sendTransaction({
    to: tokenAddress,
    data: encodeFunctionData({
      abi: [ERC20_ABI.approve],
      functionName: 'approve',
      args: [spender, amount],
    }),
  });
  
  const receipt = await waitForTx(hash);
  console.log(`[swap] Approval confirmed: ${hash} (gas: ${receipt.gasUsed})`);
}

// ============================================================
// 1inch Swap API
// ============================================================

async function fetch1inchQuote(sellToken, buyToken, amount) {
  const chain = getActiveChain();
  const apiKey = process.env.ONEINCH_API_KEY;
  if (!apiKey) throw new Error('ONEINCH_API_KEY not set');

  const url = `${chain.swap['1inchBaseUrl']}/${chain.chainId}/quote?src=${sellToken}&dst=${buyToken}&amount=${amount}`;
  
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`1inch quote failed: ${res.status} ${text}`);
  }
  
  return res.json();
}

async function fetch1inchSwap(sellToken, buyToken, amount, slippage = 1) {
  const chain = getActiveChain();
  const apiKey = process.env.ONEINCH_API_KEY;
  if (!apiKey) throw new Error('ONEINCH_API_KEY not set');

  const wallet = getWalletAddress();
  const url = `${chain.swap['1inchBaseUrl']}/${chain.chainId}/swap?src=${sellToken}&dst=${buyToken}&amount=${amount}&from=${wallet}&slippage=${slippage}`;
  
  const res = await fetch(url, {
    headers: { 'Authorization': `Bearer ${apiKey}` },
  });
  
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`1inch swap failed: ${res.status} ${text}`);
  }
  
  return res.json();
}

// ============================================================
// Odos Swap API
// ============================================================

async function fetchOdosQuote(sellToken, buyToken, amount) {
  const chain = getActiveChain();
  const wallet = getWalletAddress();

  const res = await fetch(`${chain.swap.odosBaseUrl}/quote/v2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chainId: chain.chainId,
      inputTokens: [{ tokenAddress: sellToken, amount: amount.toString() }],
      outputTokens: [{ tokenAddress: buyToken, proportion: 1 }],
      userAddr: wallet,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Odos quote failed: ${res.status} ${text}`);
  }

  return res.json();
}

async function fetchOdosAssemble(pathId) {
  const res = await fetch('https://api.odos.xyz/sor/assemble', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ pathId }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Odos assemble failed: ${res.status} ${text}`);
  }

  return res.json();
}

// ============================================================
// Unified swap interface
// ============================================================

/**
 * Get a swap quote (no execution)
 * Returns: { inputAmount, outputAmount, priceImpact, gasEstimate, route }
 */
export async function getSwapQuote(inputToken, outputToken, amount, decimals = 18) {
  const chain = getActiveChain();
  const provider = chain.swap.provider;

  if (provider === '1inch') {
    const result = await fetch1inchQuote(inputToken, outputToken, amount.toString());
    return {
      inputAmount: amount.toString(),
      outputAmount: result.dstAmount,
      priceImpact: result.estimatedPriceImpact || 0,
      gasEstimate: result.gas || 0,
      provider: '1inch',
    };
  }

  if (provider === 'odos') {
    const result = await fetchOdosQuote(inputToken, outputToken, amount);
    const outAmount = result.outAmounts?.[0] || '0';
    return {
      inputAmount: amount.toString(),
      outputAmount: outAmount,
      priceImpact: 0,
      gasEstimate: result.gasEstimate || 0,
      provider: 'odos',
    };
  }

  throw new Error(`Unsupported swap provider: ${provider}`);
}

/**
 * Execute a swap
 * Returns: { txHash, inputAmount, outputAmount, gasUsed }
 */
export async function executeSwap(inputToken, outputToken, amount, slippage = 1, decimals = 18) {
  const chain = getActiveChain();
  const provider = chain.swap.provider;

  console.log(`[swap] Executing ${provider} swap: ${amount} ${inputToken} → ${outputToken} (slippage: ${slippage}%)`);

  if (provider === '1inch') {
    const swapData = await fetch1inchSwap(inputToken, outputToken, amount.toString(), slippage);
    
    // Ensure approval for ERC-20 tokens
    if (inputToken.toLowerCase() !== '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
      await ensureApproval(inputToken, swapData.to, BigInt(amount));
    }

    const txHash = await sendTransaction({
      to: swapData.to,
      data: swapData.data,
      value: inputToken.toLowerCase() === '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee' ? BigInt(amount) : 0n,
    });

    const receipt = await waitForTx(txHash);
    return {
      txHash,
      inputAmount: amount.toString(),
      outputAmount: swapData.dstAmount,
      gasUsed: receipt.gasUsed.toString(),
      success: receipt.status === 'success',
    };
  }

  if (provider === 'odos') {
    const quote = await fetchOdosQuote(inputToken, outputToken, amount);
    const assembled = await fetchOdosAssemble(quote.pathId);

    // Ensure approval
    if (inputToken.toLowerCase() !== '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee') {
      await ensureApproval(inputToken, assembled.transaction.to, BigInt(amount));
    }

    const txHash = await sendTransaction({
      to: assembled.transaction.to,
      data: assembled.transaction.data,
      value: BigInt(assembled.transaction.value || '0'),
    });

    const receipt = await waitForTx(txHash);
    return {
      txHash,
      inputAmount: amount.toString(),
      outputAmount: quote.outAmounts?.[0] || '0',
      gasUsed: receipt.gasUsed.toString(),
      success: receipt.status === 'success',
    };
  }

  throw new Error(`Unsupported swap provider: ${provider}`);
}

/**
 * Buy token with native currency (ETH/BNB)
 */
export async function buyWithNative(outputToken, nativeAmount, slippage = 1) {
  const chain = getActiveChain();
  const wrappedNative = chain.wrappedNative;
  
  return executeSwap(
    '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE', // 1inch native sentinel
    outputToken,
    nativeAmount,
    slippage,
  );
}

/**
 * Sell token for native currency (ETH/BNB)
 */
export async function sellForNative(inputToken, tokenAmount, slippage = 1, decimals = 18) {
  return executeSwap(
    inputToken,
    '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE',
    tokenAmount,
    slippage,
    decimals,
  );
}

export default {
  getSwapQuote,
  executeSwap,
  buyWithNative,
  sellForNative,
};
