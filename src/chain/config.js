// src/chain/config.js
// Chain-specific configuration registry.
// Each chain defines: RPC, explorer, native token, wrapped token, DEX endpoints, etc.

export const CHAINS = {
  solana: {
    id: 'solana',
    name: 'Solana',
    type: 'solana', // solana vs evm
    nativeToken: { symbol: 'SOL', decimals: 9 },
    wrappedNative: 'So11111111111111111111111111111111111111112',
    explorer: {
      tx: (hash) => `https://solscan.io/tx/${hash}`,
      account: (addr) => `https://solscan.io/account/${addr}`,
      token: (addr) => `https://solscan.io/token/${addr}`,
    },
    gmgn: {
      chain: 'sol',
      link: (addr) => `https://gmgn.ai/sol/token/${addr}`,
    },
    dexscreener: {
      chainId: 'solana',
    },
    // Pump.fun specific (Solana only)
    pumpfun: {
      program: '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P',
      amm: 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA',
      discDistFees: Buffer.from([0xe4, 0x45, 0xa5, 0x2e, 0x51, 0xcb, 0x9a, 0x1d]),
    },
    swap: {
      provider: 'jupiter', // jupiter | 1inch | odos | 0x
      jupiterBaseUrl: 'https://api.jup.ag/ultra/v2',
      jupiterDataUrl: 'https://datapi.jup.ag',
      jupiterPriceUrl: 'https://lite-api.jup.ag/price/v3',
    },
    rpc: {
      http: process.env.SOLANA_RPC_URL || `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY || ''}`,
      ws: process.env.SOLANA_WS_URL || `wss://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY || ''}`,
    },
  },

  base: {
    id: 'base',
    name: 'Base',
    type: 'evm',
    chainId: 8453,
    nativeToken: { symbol: 'ETH', decimals: 18 },
    wrappedNative: '0x4200000000000000000000000000000000000006', // WETH on Base
    explorer: {
      tx: (hash) => `https://basescan.org/tx/${hash}`,
      account: (addr) => `https://basescan.org/address/${addr}`,
      token: (addr) => `https://basescan.org/token/${addr}`,
    },
    gmgn: {
      chain: 'base',
      link: (addr) => `https://gmgn.ai/base/token/${addr}`,
    },
    dexscreener: {
      chainId: 'base',
    },
    pumpfun: null, // no pump.fun on Base
    swap: {
      provider: '1inch', // 1inch | odos | 0x | uniswap
      '1inchBaseUrl': 'https://api.1inch.dev/swap/v6.0',
      odosBaseUrl: 'https://api.odos.xyz/sor',
      '0xBaseUrl': 'https://api.0x.org/swap/v2',
    },
    rpc: {
      http: process.env.BASE_RPC_URL || 'https://mainnet.base.org',
      ws: process.env.BASE_WS_URL || null,
    },
  },

  bsc: {
    id: 'bsc',
    name: 'BNB Smart Chain',
    type: 'evm',
    chainId: 56,
    nativeToken: { symbol: 'BNB', decimals: 18 },
    wrappedNative: '0xbb4CdB9CBd36B01bD1cBaEBF2De08d9173bc095c', // WBNB
    explorer: {
      tx: (hash) => `https://bscscan.com/tx/${hash}`,
      account: (addr) => `https://bscscan.com/address/${addr}`,
      token: (addr) => `https://bscscan.com/token/${addr}`,
    },
    gmgn: {
      chain: 'bsc',
      link: (addr) => `https://gmgn.ai/bsc/token/${addr}`,
    },
    dexscreener: {
      chainId: 'bsc',
    },
    pumpfun: null,
    swap: {
      provider: '1inch',
      '1inchBaseUrl': 'https://api.1inch.dev/swap/v6.0',
      odosBaseUrl: 'https://api.odos.xyz/sor',
    },
    rpc: {
      http: process.env.BSC_RPC_URL || 'https://bsc-dataseed1.binance.org',
      ws: process.env.BSC_WS_URL || null,
    },
  },

  ethereum: {
    id: 'ethereum',
    name: 'Ethereum',
    type: 'evm',
    chainId: 1,
    nativeToken: { symbol: 'ETH', decimals: 18 },
    wrappedNative: '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2', // WETH
    explorer: {
      tx: (hash) => `https://etherscan.io/tx/${hash}`,
      account: (addr) => `https://etherscan.io/address/${addr}`,
      token: (addr) => `https://etherscan.io/token/${addr}`,
    },
    gmgn: {
      chain: 'eth',
      link: (addr) => `https://gmgn.ai/eth/token/${addr}`,
    },
    dexscreener: {
      chainId: 'ethereum',
    },
    pumpfun: null,
    swap: {
      provider: '1inch',
      '1inchBaseUrl': 'https://api.1inch.dev/swap/v6.0',
      odosBaseUrl: 'https://api.odos.xyz/sor',
    },
    rpc: {
      http: process.env.ETH_RPC_URL || 'https://eth.llamarpc.com',
      ws: process.env.ETH_WS_URL || null,
    },
  },

  arbitrum: {
    id: 'arbitrum',
    name: 'Arbitrum',
    type: 'evm',
    chainId: 42161,
    nativeToken: { symbol: 'ETH', decimals: 18 },
    wrappedNative: '0x82aF49447D8a07e3bd95BD0d56f35241523fBab1', // WETH
    explorer: {
      tx: (hash) => `https://arbiscan.io/tx/${hash}`,
      account: (addr) => `https://arbiscan.io/address/${addr}`,
      token: (addr) => `https://arbiscan.io/token/${addr}`,
    },
    gmgn: {
      chain: 'arb',
      link: (addr) => `https://gmgn.ai/arb/token/${addr}`,
    },
    dexscreener: {
      chainId: 'arbitrum',
    },
    pumpfun: null,
    swap: {
      provider: '1inch',
      '1inchBaseUrl': 'https://api.1inch.dev/swap/v6.0',
      odosBaseUrl: 'https://api.odos.xyz/sor',
    },
    rpc: {
      http: process.env.ARB_RPC_URL || 'https://arb1.arbitrum.io/rpc',
      ws: process.env.ARB_WS_URL || null,
    },
  },
};

// Get active chain from env
export function getActiveChain() {
  const chainId = (process.env.CHAIN || 'solana').toLowerCase();
  const chain = CHAINS[chainId];
  if (!chain) {
    throw new Error(`Unsupported chain: ${chainId}. Supported: ${Object.keys(CHAINS).join(', ')}`);
  }
  return chain;
}

// Get chain by ID
export function getChain(chainId) {
  const chain = CHAINS[chainId?.toLowerCase()];
  if (!chain) throw new Error(`Unknown chain: ${chainId}`);
  return chain;
}

// List available chains
export function listChains() {
  return Object.values(CHAINS).map(c => ({ id: c.id, name: c.name, type: c.type }));
}

export default CHAINS;
