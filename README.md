# Charon — Multi-Chain Trading Bot

Charon is a Telegram trench agent for screening noisy token flow with overlap signals, strategy gates, LLM selection, and dry-run/confirm/live execution.

**Supported Chains:** Solana, Base, BSC, Ethereum, Arbitrum

> **ALERT:** This codebase is on testing-period. Developer doesn't guarantee any result.

## Flow

1. Charon polls signal sources (GMGN trending, DexScreener, Pump.fun for Solana)
2. The active strategy gates source count, fee requirement, token age, market cap, holders, fees, trend quality, ATH distance, and position caps
3. Passing candidates are enriched with token info, holder data, chart context, and social narrative
4. The LLM screens up to `LLM_CANDIDATE_PICK_COUNT` recent candidates and may pick one `BUY`
5. Charon routes approved buys through `dry_run`, `confirm`, or `live`
6. Open positions are monitored every `POSITION_CHECK_MS` for TP, SL, trailing TP, max hold, and partial TP rules

## Quick Start

```bash
git clone https://github.com/MCNGN/charon.git
cd charon
npm install
cp .env.example .env
```

Edit `.env` with your credentials, then run:

```bash
# Solana (default)
npm start

# Base
npm run start:base

# BSC
npm run start:bsc

# Ethereum
npm run start:eth

# Arbitrum
npm run start:arb
```

Or set `CHAIN=base` in `.env` and use `npm start`.

## Chain Configuration

### Solana (default)

```env
CHAIN=solana
SOLANA_PRIVATE_KEY=<base58 private key>
HELIUS_API_KEY=<your key>
JUPITER_API_KEY=<your key>
```

- Uses **Jupiter Ultra** for swaps
- Uses **Pump.fun** signals (fee claims, graduated tokens)
- Uses **Helius** RPC by default

### Base

```env
CHAIN=base
EVM_PRIVATE_KEY=<hex private key>
ONEINCH_API_KEY=<your key>
# Optional: BASE_RPC_URL=https://mainnet.base.org
```

- Uses **1inch** (or Odos) for swaps
- Uses **DexScreener + GMGN** for signals
- Default RPC: `https://mainnet.base.org`

### BSC

```env
CHAIN=bsc
EVM_PRIVATE_KEY=<hex private key>
ONEINCH_API_KEY=<your key>
```

### Ethereum

```env
CHAIN=ethereum
EVM_PRIVATE_KEY=<hex private key>
ONEINCH_API_KEY=<your key>
```

### Arbitrum

```env
CHAIN=arbitrum
EVM_PRIVATE_KEY=<hex private key>
ONEINCH_API_KEY=<your key>
```

## Architecture

```
src/
├── chain/                  # Multi-chain abstraction layer
│   ├── config.js           # Chain registry (RPC, explorer, tokens)
│   ├── index.js            # Unified interface (buy, sell, balance)
│   ├── utils.js            # Chain-agnostic formatters
│   ├── dexscreener.js      # DexScreener API (all chains)
│   ├── signals.js          # Cross-chain signal sources
│   ├── evm/
│   │   ├── provider.js     # viem provider + wallet
│   │   └── swap.js         # 1inch/Odos swap execution
│   └── solana/
│       └── adapter.js      # Jupiter swap + Solana wallet
├── signals/                # Signal sources (Pump.fun = Solana only)
├── enrichment/             # GMGN, Twitter, wallet tracking
├── execution/              # Trade routing + position monitoring
├── pipeline/               # Candidate builder + LLM screening
├── telegram/               # Bot interface
├── learning/               # PnL analysis + lessons
└── db/                     # SQLite storage
```

## Required Config

```env
TELEGRAM_BOT_TOKEN=
TELEGRAM_CHAT_ID=
CHAIN=solana
GMGN_API_KEY=
```

`TELEGRAM_CHAT_ID` is the chat or group ID where Charon sends alerts and accepts commands.

## GMGN Enrichment

```env
GMGN_ENABLED=true
GMGN_API_KEY=
```

GMGN enriches candidates with holder count, liquidity, fee data, and social links across all chains. Set `GMGN_ENABLED=false` to skip it.

## LLM Config

```env
ENABLE_LLM=true
LLM_BASE_URL=https://api.minimax.io/v1
LLM_API_KEY=
LLM_MODEL=MiniMax-M2.7
LLM_TIMEOUT_MS=60000
LLM_CANDIDATE_PICK_COUNT=10
LLM_CANDIDATE_MAX_AGE_MS=600000
```

`LLM_BASE_URL` accepts any OpenAI-compatible endpoint. Set `ENABLE_LLM=false` to disable LLM globally.

## Execution Modes

```env
TRADING_MODE=dry_run
```

- `dry_run`: stores simulated buys/sells in SQLite. No wallet needed.
- `confirm`: sends a Telegram trade intent with approve/reject buttons.
- `live`: executes swaps immediately after strategy and LLM approval.

### Live Execution Requirements

**Solana:**
```env
SOLANA_PRIVATE_KEY=
JUPITER_API_KEY=
LIVE_MIN_SOL_RESERVE=0.02
```

**EVM chains:**
```env
EVM_PRIVATE_KEY=
ONEINCH_API_KEY=
LIVE_MIN_ETH_RESERVE=0.001
EVM_SLIPPAGE=1
```

## Strategies

Use `/menu → Strategy` or commands:

```
/strategy
/strategy sniper
/strategy dip_buy
/strategy smart_money
/strategy degen
/stratset sniper tp_percent 75
```

Default strategies:
- `sniper`: fee-claim overlap, immediate entry, LLM on.
- `dip_buy`: waits for ATH-distance dip alerts.
- `smart_money`: stricter holder/trending quality, partial TP support.
- `degen`: lower source threshold, rule-based (no LLM).

## Telegram Commands

```
/menu
/strategy
/stratset <strategy_id> <key> <value>
/positions
/candidate <mint>
/filters
/pnl
/learn <window>
/lessons
/walletadd <label> <address>
/walletremove <label>
/wallets
```

## Swap Providers

| Chain    | Provider     | API Key Required | Notes                    |
|----------|-------------|------------------|--------------------------|
| Solana   | Jupiter Ultra | Yes            | Best for Solana          |
| Base     | 1inch / Odos  | Yes / No       | 1inch recommended        |
| BSC      | 1inch         | Yes            |                          |
| Ethereum | 1inch         | Yes            |                          |
| Arbitrum | 1inch         | Yes            |                          |

## Signal Sources

| Chain    | Sources                              |
|----------|--------------------------------------|
| Solana   | Pump.fun (fee/graduated), GMGN, Jupiter trending |
| Base     | DexScreener trending, GMGN trending  |
| BSC      | DexScreener trending, GMGN trending  |
| Ethereum | DexScreener trending, GMGN trending  |
| Arbitrum | DexScreener trending, GMGN trending  |

## Storage

Charon uses `charon.sqlite` as source of truth. It stores:
- candidates and filter results
- LLM decisions and batches
- dry-run/live positions and trades
- trade intents
- saved wallets
- strategy configs
- learning runs and lessons

## API Usage Notes

- **GMGN**: Rate-limited. Keep `GMGN_REQUEST_DELAY_MS=2500` or higher.
- **1inch**: Free tier = 10 req/sec, $500K monthly volume.
- **DexScreener**: Free, no API key needed. Rate limits apply.
- **LLM**: One API call per batch cycle.

## Verification

```bash
npm run check
```

## License

Private — see upstream repository.
