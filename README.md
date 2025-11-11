# Oracle V3 - Multi-Source Price Oracle for Solana/X1

A scalable, multi-source price oracle system designed for X1 blockchain (SVM-compatible) with real-time monitoring dashboard.

## Overview

Oracle V3 is a complete rewrite of the oracle system, transforming it from a hardcoded 5-asset oracle into a scalable platform supporting unlimited tokens with multiple free price sources.

### Key Features

- **Unlimited Asset Support**: Per-Asset PDA architecture allows dynamic registration of any Solana token
- **Multi-Source Aggregation**: Combines prices from 5 free sources (Jupiter, DexScreener, Birdeye, Pyth, CEX)
- **Advanced Price Reliability**: Weighted median calculation with IQR outlier detection
- **Real-Time Dashboard**: WebSocket-based monitoring console with X1 blue theme
- **100% Free**: No API key costs - all price sources are free to use
- **Quality Control**: Tier-based weighting, confidence scoring, and stale data filtering

## Architecture

### On-Chain Program (Rust/Anchor)

```
programs/oracle-v3/
├── src/
│   ├── lib.rs                    # Main program logic
│   ├── instructions/
│   │   ├── admin.rs              # Registry & asset registration
│   │   └── price_update.rs       # Batch price updates
│   └── state/
│       ├── registry.rs           # Global registry PDA
│       └── price_data.rs         # Per-asset price PDAs
```

**Program ID:** `8gLZV8k3R6JrAs5BZzyyZQikjEfqvJjAz8PxbiYmz2Kb`

### Off-Chain Services (TypeScript)

```
app/
├── src/v3/
│   ├── sources/                  # Price source clients
│   │   ├── jupiter-client.ts     # Jupiter Price API v4
│   │   ├── dexscreener-client.ts # DexScreener integration
│   │   └── birdeye-client.ts     # Birdeye price feeds
│   └── aggregation/
│       └── price-aggregator.ts   # Weighted median + outlier detection
├── dashboard-server.ts           # WebSocket server
├── dashboard-tokens.ts           # 49+ verified token list
└── public/
    └── index.html                # Real-time monitoring UI
```

## Quick Start

### Prerequisites

- Node.js 18+
- Rust 1.75+ with Solana toolchain
- Anchor CLI 0.28.0
- Solana CLI

### Installation

```bash
# Clone the repository
git clone https://github.com/stackedPenguin/oracle.git
cd oracle

# Install dependencies
cd app
npm install

# Build the Anchor program
cd ..
anchor build
```

### Running Locally

#### 1. Start Local Validator

```bash
# Start Solana test validator
solana-test-validator
```

#### 2. Deploy Program

```bash
# Deploy to local validator
anchor deploy

# Initialize registry (in another terminal)
cd app
npm run test:e2e
```

#### 3. Start Dashboard

```bash
# Launch real-time monitoring dashboard
npm run dashboard

# Open browser to http://localhost:3000
```

## Dashboard

The dashboard provides real-time monitoring of 49+ Solana tokens with updates every second.

### Features

- **Sleek Grid Layout**: Compact cards showing 6-8 tokens per row
- **X1 Blue Theme**: Official X1 blockchain branding (#00D9FF)
- **Price Animations**: Visual feedback on price changes (green/blue up, red/purple down)
- **Latency Monitoring**: Color-coded latency indicators (fast: <1000ms, slow: >2000ms)
- **Active Updater Count**: Shows how many oracles are reporting (e.g., "3/4")
- **Stats Bar**: Total assets, average latency, last update time
- **Auto-Reconnecting**: Handles WebSocket disconnections gracefully
- **Responsive**: Works on desktop and mobile

### Monitored Tokens (49+)

**Stablecoins:** USDC, USDT, PYUSD
**Major Assets:** SOL, mSOL
**Memecoins:** BONK, WIF, BOME, MEW, SLERF, POPCAT
**DeFi/DEX:** JUP, RAY, ORCA, SRM, COPE, FIDA, SLND, TULIP
**Infrastructure:** PYTH, W (Wormhole), JTO (Jito), RENDER
**Staking:** mSOL, STEP
**NFT/Gaming:** ATLAS, MPLX, GMT, GENE, DFL, POLIS
**Helium Network:** HNT, MOBILE, IOT
**And 20+ more...**

## Price Aggregation Algorithm

1. **Collect Prices**: Fetch from all available sources
2. **Remove Outliers**: Use IQR (Interquartile Range) method to filter bad data
3. **Apply Weights**: Tier-based weighting system:
   - Pyth Network (TIER_1): 3x weight
   - Jupiter (TIER_2): 2x weight
   - DexScreener (TIER_3): 1.5x weight
   - Birdeye (TIER_3): 1.5x weight
4. **Calculate Median**: Compute weighted median price
5. **Confidence Score**: Assess reliability based on source agreement

### Outlier Detection

```typescript
IQR = Q3 - Q1
Lower Bound = Q1 - 1.5 × IQR
Upper Bound = Q3 + 1.5 × IQR
```

Prices outside these bounds are excluded from aggregation.

## Development

### Project Structure

```
oracle/
├── programs/
│   ├── oracle/          # Legacy V2 (5 hardcoded assets)
│   └── oracle-v3/       # New scalable architecture
├── app/
│   ├── src/
│   │   ├── v2/          # Legacy multi-source implementation
│   │   └── v3/          # New per-asset PDA implementation
│   ├── dashboard-server.ts     # Real-time WebSocket server
│   ├── dashboard-tokens.ts     # Token database
│   ├── test-aggregation.ts     # Aggregation tests
│   └── test-e2e.ts            # End-to-end tests
└── build-with-fix.sh   # Build automation (Cargo.lock fix)
```

### Building

```bash
# Standard build
anchor build

# Build with Cargo.lock version fix (if needed)
./build-with-fix.sh
```

### Testing

```bash
# Test price aggregation (no blockchain required)
npm run test:aggregation

# End-to-end test (requires local validator)
npm run test:e2e
```

### Adding New Tokens

Edit `app/dashboard-tokens.ts`:

```typescript
export const TOP_SOLANA_TOKENS: TokenInfo[] = [
  {
    symbol: 'TOKEN',
    name: 'Token Name',
    mint: 'TokenMintAddress...',
    basePrice: 1.23,
    decimals: 9, // optional
  },
  // ... more tokens
];
```

## Technical Challenges Solved

### 1. Rust Compiler Compatibility
- **Issue**: Solana BPF uses Rust 1.75, but modern Anchor dependencies require 1.76+
- **Solution**: Downgraded to Anchor 0.28.0 and pinned solana-program to 1.16.0

### 2. Cargo.lock Version
- **Issue**: System Cargo generates version 4 lockfiles, Solana BPF needs version 3
- **Solution**: Created `build-with-fix.sh` to automatically downgrade version

### 3. Anchor API Changes
- **Issue**: Bumps API changed between Anchor versions
- **Solution**: Updated from `ctx.bumps.registry` to `*ctx.bumps.get("registry").unwrap()`

### 4. TypeScript Strict Mode
- **Issue**: 20+ null safety and type casting errors
- **Solution**: Fixed with proper type guards and assertions

## Oracle V2 vs V3 Comparison

| Feature | Oracle V2 (Legacy) | Oracle V3 (New) |
|---------|-------------------|-----------------|
| **Assets** | 5 hardcoded (BTC, ETH, SOL, HYPE, ZEC) | Unlimited (49+ ready) |
| **Scalability** | Fixed | Per-Asset PDAs |
| **Price Sources** | Pyth + 7 CEX | 5 free sources |
| **Aggregation** | Simple average | Weighted median + IQR |
| **Dashboard** | None | Real-time WebSocket |
| **Theme** | N/A | X1 blue branded |
| **Cost** | CEX API limits | 100% free |
| **Asset Addition** | Code change + redeploy | Dynamic registration |

## API Endpoints

### Dashboard Server

```bash
# Get current prices
GET http://localhost:3000/api/prices

# Health check
GET http://localhost:3000/health

# WebSocket for real-time updates
WS ws://localhost:3000
```

### WebSocket Events

```typescript
// Initial connection
{
  type: 'initial',
  slot: 12345,
  pda: '7KqBTqC5f8sjmPTECG2pXfPzTXEh8zEmmvNnGTXL5XfX',
  assets: [...]
}

// Price updates (every 1 second)
{
  type: 'update',
  slot: 12346,
  pda: '7KqBTqC5f8sjmPTECG2pXfPzTXEh8zEmmvNnGTXL5XfX',
  assets: [...]
}
```

## Configuration

### Environment Variables

```bash
# Dashboard server
PORT=3000                                    # Server port
RPC_URL=http://localhost:8899                # Solana RPC endpoint

# For production
RPC_URL=https://api.mainnet-beta.solana.com  # Mainnet
# or
RPC_URL=https://rpc.x1.xyz                   # X1 blockchain
```

### Network Configuration

Edit `Anchor.toml`:

```toml
[programs.localnet]
oracle_v3 = "8gLZV8k3R6JrAs5BZzyyZQikjEfqvJjAz8PxbiYmz2Kb"

[programs.mainnet]
oracle_v3 = "YourMainnetProgramID..."
```

## Deployment

### Mainnet Deployment

```bash
# Build optimized program
anchor build --verifiable

# Deploy to mainnet
anchor deploy --provider.cluster mainnet

# Update program ID in Anchor.toml and lib.rs

# Rebuild with new ID
anchor build

# Initialize registry
ts-node initialize-mainnet.ts
```

### Dashboard Production

```bash
# Build for production
npm run build

# Run with PM2 (recommended)
pm2 start dashboard-server.ts --name oracle-dashboard

# Or with systemd
sudo systemctl start oracle-dashboard
```

## Contributing

1. Fork the repository
2. Create feature branch: `git checkout -b feature/my-feature`
3. Commit changes: `git commit -am 'Add new feature'`
4. Push to branch: `git push origin feature/my-feature`
5. Submit Pull Request

## License

MIT

## Links

- **Dashboard (Local)**: http://localhost:3000
- **GitHub**: https://github.com/stackedPenguin/oracle
- **X1 Blockchain**: https://x1.xyz
- **Jupiter API**: https://station.jup.ag/docs/apis/price-api
- **DexScreener**: https://dexscreener.com/
- **Birdeye**: https://birdeye.so/
- **Pyth Network**: https://pyth.network/

## Support

For issues and questions:
- Open an issue on GitHub
- Check existing documentation in `/docs`
- Review test files for usage examples

---

Built for X1 blockchain with ❤️
