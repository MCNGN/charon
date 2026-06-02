import dotenv from 'dotenv';

dotenv.config();

// ============================================================
// CHAIN CONFIGURATION
// ============================================================
export const CHAIN = (process.env.CHAIN || 'solana').toLowerCase();

// ============================================================
// APP CONFIGURATION
// ============================================================
export const APP_NAME = 'Charon';
export const DB_PATH = process.env.DB_PATH || './charon.sqlite';

// ============================================================
// CHAIN-SPECIFIC CONSTANTS (backward compatible)
// ============================================================
// Solana-only constants (kept for backward compat)
export const PUMP_PROGRAM = '6EF8rrecthR5Dkzon8Nwu78hRvfCKubJ14M5uBEwF6P';
export const PUMP_AMM = 'pAMMBay6oceH9fJKBRHGP5D4bD4sWpmSwMn52FMfXEA';
export const DISC_DIST_FEES = Buffer.from('a537817004b3ca28', 'hex');
export const WSOL_MINT = 'So11111111111111111111111111111111111111112';
export const SOL_MINT = 'So11111111111111111111111111111111111111111';

// Wrapped native token for current chain
import { getActiveChain as _getActiveChain } from './chain/config.js';

let _chainConfig = null;
function _chain() {
  if (!_chainConfig) {
    try { _chainConfig = _getActiveChain(); } catch { _chainConfig = null; }
  }
  return _chainConfig;
}

// Dynamic wrapped native token
export function getWrappedNative() {
  const c = _chain();
  return c ? c.wrappedNative : WSOL_MINT;
}

// ============================================================
// TELEGRAM
// ============================================================
export const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
export const TELEGRAM_CHAT_ID = process.env.TELEGRAM_CHAT_ID;
export const TELEGRAM_TOPIC_ID = process.env.TELEGRAM_TOPIC_ID;

// ============================================================
// API KEYS
// ============================================================
export const HELIUS_API_KEY = process.env.HELIUS_API_KEY;
export const GMGN_API_KEY = process.env.GMGN_API_KEY;
export const GMGN_ENABLED = process.env.GMGN_ENABLED !== 'false';
export const JUPITER_API_KEY = process.env.JUPITER_API_KEY || '';
export const ONEINCH_API_KEY = process.env.ONEINCH_API_KEY || '';
export const ODOS_API_KEY = process.env.ODOS_API_KEY || '';

// ============================================================
// WALLET (chain-agnostic)
// ============================================================
export const SOLANA_PRIVATE_KEY = process.env.SOLANA_PRIVATE_KEY || process.env.PRIVATE_KEY || '';
export const EVM_PRIVATE_KEY = process.env.EVM_PRIVATE_KEY || process.env.PRIVATE_KEY || '';

// ============================================================
// RPC (Solana-specific, kept for backward compat)
// ============================================================
export const SOLANA_RPC_URL = process.env.SOLANA_RPC_URL || `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;
export const SOLANA_WS_URL = process.env.SOLANA_WS_URL || `wss://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

// EVM RPC (Base, BSC, ETH, Arbitrum)
export const BASE_RPC_URL = process.env.BASE_RPC_URL || 'https://mainnet.base.org';
export const BSC_RPC_URL = process.env.BSC_RPC_URL || 'https://bsc-dataseed1.binance.org';
export const ETH_RPC_URL = process.env.ETH_RPC_URL || 'https://eth.llamarpc.com';
export const ARB_RPC_URL = process.env.ARB_RPC_URL || 'https://arb1.arbitrum.io/rpc';

// ============================================================
// DEX CONFIGURATION
// ============================================================
export const JUPITER_SWAP_BASE_URL = process.env.JUPITER_SWAP_BASE_URL || 'https://api.jup.ag/ultra/v2';
export const JUPITER_SLIPPAGE_BPS = Number(process.env.JUPITER_SLIPPAGE_BPS || 300);
export const EVM_SLIPPAGE = Number(process.env.EVM_SLIPPAGE || 1); // percentage

// ============================================================
// RESERVES
// ============================================================
export const LIVE_MIN_SOL_RESERVE_LAMPORTS = Math.floor(Number(process.env.LIVE_MIN_SOL_RESERVE || 0.02) * 1_000_000_000);
export const LIVE_MIN_ETH_RESERVE_WEI = BigInt(Math.floor(Number(process.env.LIVE_MIN_ETH_RESERVE || 0.001) * 1e18));

// Get min reserve for current chain
export function getMinReserve() {
  const c = _chain();
  if (!c || c.type === 'solana') return LIVE_MIN_SOL_RESERVE_LAMPORTS;
  return Number(LIVE_MIN_ETH_RESERVE_WEI);
}

// ============================================================
// LLM
// ============================================================
export const LLM_BASE_URL = process.env.LLM_BASE_URL || 'https://api.minimax.io/v1';
export const LLM_API_KEY = process.env.LLM_API_KEY || '';
export const LLM_MODEL = process.env.LLM_MODEL || 'MiniMax-M2.7';

// ============================================================
// POLLING INTERVALS
// ============================================================
export const GRADUATED_POLL_MS = Number(process.env.GRADUATED_POLL_MS || 30_000);
export const GRADUATED_LOOKBACK_MS = Number(process.env.GRADUATED_LOOKBACK_MS || 2 * 60 * 60 * 1000);
export const TRENDING_POLL_MS = Number(process.env.TRENDING_POLL_MS || 60_000);
export const TRENDING_LOOKBACK_MS = Number(process.env.TRENDING_LOOKBACK_MS || 10 * 60 * 1000);
export const GMGN_CACHE_TTL_MS = Number(process.env.GMGN_CACHE_TTL_MS || 5 * 60 * 1000);
export const POSITION_CHECK_MS = Number(process.env.POSITION_CHECK_MS || 10_000);
export const LLM_TIMEOUT_MS = Number(process.env.LLM_TIMEOUT_MS || 60_000);
export const ENABLE_LLM = process.env.ENABLE_LLM !== 'false';

// ============================================================
// SIGNAL SERVER
// ============================================================
export const SIGNAL_SERVER_URL = process.env.SIGNAL_SERVER_URL || 'http://localhost:3456';
export const SIGNAL_SERVER_KEY = process.env.SIGNAL_SERVER_KEY || '';
export const SIGNAL_POLL_MS = Number(process.env.SIGNAL_POLL_MS || 30_000);

// ============================================================
// HTTP
// ============================================================
export const JSON_HEADERS = {
  Accept: 'application/json, text/plain, */*',
  'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
};

// ============================================================
// VALIDATION
// ============================================================
export function validateConfig() {
  if (!TELEGRAM_BOT_TOKEN) throw new Error('TELEGRAM_BOT_TOKEN is required.');
  if (!TELEGRAM_CHAT_ID) throw new Error('TELEGRAM_CHAT_ID is required.');
  
  const c = _chain();
  
  if (c && c.type === 'evm') {
    // EVM chain validation
    if (!EVM_PRIVATE_KEY) throw new Error('EVM_PRIVATE_KEY is required for EVM chains.');
    if (c.swap.provider === '1inch' && !ONEINCH_API_KEY) {
      console.warn('[config] WARNING: ONEINCH_API_KEY not set. 1inch swaps will fail.');
    }
  } else {
    // Solana validation (backward compat)
    if (HELIUS_API_KEY && (!process.env.SOLANA_RPC_URL || !process.env.SOLANA_WS_URL)) {
      // Helius key is set, that's fine
    } else if (!process.env.SOLANA_RPC_URL) {
      throw new Error('HELIUS_API_KEY is required unless SOLANA_RPC_URL and SOLANA_WS_URL are set.');
    }
  }
  
  if (GMGN_ENABLED && !GMGN_API_KEY) throw new Error('GMGN_API_KEY is required unless GMGN_ENABLED=false.');
}
