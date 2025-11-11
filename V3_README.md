# Oracle V3 - Multi-Source Price Oracle

## Overview

Oracle V3 is a comprehensive multi-source price oracle system designed for X1 (SVM-compatible chain) that supports unlimited token coverage at zero cost through intelligent aggregation of free data sources.

## Key Features

- ✅ **Unlimited Token Support** - Per-Asset PDA architecture supports any Solana/SVM token
- ✅ **100% Free Data Sources** - Jupiter, DexScreener, Birdeye, Pyth, CEX aggregation (no API costs)
- ✅ **Multi-Source Aggregation** - Weighted median with outlier detection
- ✅ **Quality Control** - Real-time monitoring, confidence scoring, and alerting
- ✅ **Dynamic Management** - Add/remove assets via configuration file
- ✅ **Scalable** - Handle 1000+ tokens easily

## Architecture

### On-Chain Program (`programs/oracle-v3/`)

The Solana program uses a **Per-Asset PDA pattern**:

```
AssetRegistry (Global)
    ├── AssetConfig (per token)
    └── PriceData (per token)
```

**Key Accounts:**
- `AssetRegistry` - Global registry tracking all assets
- `AssetConfig` - Configuration for each asset (symbol, decimals, Pyth feed ID)
- `PriceData` - Price data with Triplet structure (4 updaters)

**Instructions:**
- `initialize_registry` - One-time setup
- `register_asset` - Add new token
- `activate_asset` / `deactivate_asset` - Enable/disable tokens
- `set_price` - Update single asset
- `batch_set_prices` - Update multiple assets (dynamic size)

### Off-Chain Components (`app/src/v3/`)

#### 1. Price Sources (`sources/`)
- **JupiterPriceClient** - Jupiter aggregator API (FREE)
- **DexScreenerClient** - DexScreener API (FREE)
- **BirdeyeClient** - Birdeye API (FREE, Solana-specialized)
- Plus existing: Pyth Network, CEX composite

#### 2. Price Aggregation (`aggregation/`)
- **PriceAggregator** - Weighted median calculation
- **Outlier Detection** - IQR-based filtering
- **Confidence Scoring** - Based on source agreement
- **Tier-based Weighting**:
  - Tier 1 (3x): Pyth, CEX composite
  - Tier 2 (2x): Jupiter
  - Tier 3 (1.5x): DexScreener, Birdeye
  - Tier 4 (1x): Fallback sources

#### 3. Quality Control (`quality/`)
- **QualityController** - Real-time monitoring
- **Metrics Tracking** - Historical performance
- **Alert System** - Deviation, stale data, low confidence
- **Reliability Scoring** - Per-source uptime tracking

#### 4. Asset Registry (`registry/`)
- **AssetRegistry** - Load/manage asset configuration
- **Dynamic Config** - JSON-based asset definitions
- **Hot Reload** - Update configuration without restart

## Configuration

### Asset Configuration (`app/config/assets.json`)

```json
{
  "version": "1.0",
  "updateIntervalMs": 1000,
  "assets": [
    {
      "mint": "So11111111111111111111111111111111111111112",
      "symbol": "SOL",
      "decimals": 9,
      "sources": {
        "pyth": {
          "feedId": "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d"
        },
        "jupiter": { "enabled": true },
        "dexScreener": { "enabled": true },
        "birdeye": { "enabled": true },
        "cex": {
          "exchanges": ["kraken", "coinbase", "binance"]
        }
      },
      "minSources": 3,
      "maxPriceDeviation": 0.05,
      "enabled": true
    }
  ]
}
```

## Price Source Details

### Jupiter Price API
- **Cost:** FREE
- **Rate Limit:** 999 req/s (QuickNode free tier)
- **Coverage:** All tokens with Jupiter liquidity
- **URL:** `https://price.jup.ag/v4`
- **Features:** Batch endpoints, real liquidity

### DexScreener API
- **Cost:** FREE
- **Rate Limit:** Unlimited (reasonable use)
- **Coverage:** 70+ chains, 50+ DEXs
- **URL:** `https://api.dexscreener.com`
- **Features:** Liquidity data, volume, pair info

### Birdeye API
- **Cost:** FREE (price tier)
- **Rate Limit:** Standard limits
- **Coverage:** Solana-focused
- **URL:** `https://public-api.birdeye.so`
- **Features:** Batch endpoints, multi-price API

### Pyth Network
- **Cost:** FREE
- **Rate Limit:** WebSocket streaming
- **Coverage:** 500+ major assets
- **Features:** Institutional-grade, high frequency

### CEX Composite
- **Cost:** FREE
- **Sources:** Kraken, Coinbase, Binance, Bybit, MEXC, KuCoin, Hyperliquid
- **Features:** WebSocket, real-time

## Usage Examples

### Adding a New Token

1. **Add to config** (`app/config/assets.json`):
```json
{
  "mint": "NEW_TOKEN_MINT_ADDRESS",
  "symbol": "NEWTOKEN",
  "decimals": 9,
  "sources": {
    "jupiter": { "enabled": true },
    "dexScreener": { "enabled": true },
    "birdeye": { "enabled": true }
  },
  "minSources": 2,
  "maxPriceDeviation": 0.15,
  "enabled": true
}
```

2. **Register on-chain** (one-time):
```bash
anchor run register-asset -- \
  --mint NEW_TOKEN_MINT_ADDRESS \
  --symbol NEWTOKEN \
  --decimals 9
```

3. **Price updates start automatically!**

### Monitoring Quality

```typescript
import { QualityController } from './v3/quality';

const qualityController = new QualityController({
  maxDeviation: 0.10,        // 10% max deviation
  minSources: 2,             // Min 2 sources
  minConfidence: 0.70,       // 70% min confidence
});

qualityController.on('alert', (alert) => {
  console.log(`[${alert.severity}] ${alert.type}: ${alert.message}`);
});

qualityController.on('metrics', (metrics) => {
  console.log(`${metrics.asset}: ${metrics.sourceCount} sources, ${(metrics.confidence * 100).toFixed(0)}% confidence`);
});
```

### Custom Aggregation

```typescript
import { PriceAggregator } from './v3/aggregation';

const aggregator = new PriceAggregator();

const readings = [
  { source: 'jupiter', tier: SourceTier.TIER_2_DEX_AGGREGATOR, price: 180.5, timestamp: Date.now(), confidence: 0.85 },
  { source: 'birdeye', tier: SourceTier.TIER_3_DEX_SCREENER, price: 180.2, timestamp: Date.now(), confidence: 0.80 },
  { source: 'pyth', tier: SourceTier.TIER_1_INSTITUTIONAL, price: 180.7, timestamp: Date.now(), confidence: 0.95 },
];

const aggregated = aggregator.aggregate(readings);
console.log(`Price: $${aggregated.price}, Confidence: ${(aggregated.confidence * 100).toFixed(0)}%`);
```

## Deployment

### 1. Build & Deploy Program

```bash
# Build program
anchor build

# Deploy to X1 Mainnet
anchor deploy --provider.cluster https://rpc.mainnet.x1.xyz

# Initialize registry
anchor run initialize
```

### 2. Configure Assets

Edit `app/config/assets.json` with your tokens.

### 3. Run Oracle Service

```bash
cd app
npm install
npm run start:v3
```

## Cost Analysis

### One-Time Costs
- Program deployment: ~0.1 SOL
- Registry initialization: ~0.001 SOL
- Per asset registration: ~0.002 SOL (~$0.40 @ $200/SOL)

### Ongoing Costs
- **API Costs:** $0 (all free sources)
- **Transaction Fees:** ~$0.000005 per update
- **For 100 assets @ 1 update/sec:** ~$0.50/day in tx fees

### Comparison to Paid Services
- Pyth Premium: $500-2000/month
- CoinGecko Pro: $129-499/month
- **Oracle V3:** $0/month + ~$15/month tx fees

## Scaling

### Current Implementation
- 10-20 tokens: $0.02/day tx fees
- 100 tokens: $0.50/day tx fees
- 500 tokens: $2.50/day tx fees
- 1000 tokens: $5.00/day tx fees

### Performance
- Update frequency: 1 second
- Price sources: 3-7 per token
- Batch size: Up to 100 tokens/tx
- Network: Sub-second latency

## Security

### Price Manipulation Protection
1. **Multi-source aggregation** - No single point of failure
2. **Outlier detection** - IQR-based filtering
3. **Weighted median** - Robust against manipulation
4. **Confidence scoring** - Track data quality
5. **Alert system** - Real-time anomaly detection

### Access Control
- 4 authorized updaters (hardware keys)
- Per-updater index verification
- Authority-only admin functions
- Immutable program logic

## Monitoring & Alerts

### Alert Types
- **high_deviation** - Price sources disagree >10%
- **low_sources** - Less than 2 sources available
- **low_confidence** - Confidence below 70%
- **high_outliers** - >30% of sources are outliers
- **stale_data** - Sources not updating

### Quality Metrics
- Price deviation
- Source count
- Confidence score
- Outlier ratio
- Source reliability
- Overall quality score

## Future Enhancements

### Planned Features
- [ ] Auto-discovery of new tokens
- [ ] WebSocket API for price streaming
- [ ] Historical price storage
- [ ] Advanced analytics dashboard
- [ ] Multi-chain support (Eclipse, Neon)
- [ ] DAO governance for adding assets

### Integration Ideas
- DeFi protocols (lending, DEXs)
- Trading bots
- Portfolio trackers
- Price alert services
- Analytics platforms

## Development

### Directory Structure
```
programs/oracle-v3/          # Solana program
  src/
    state/                   # Account structures
    instructions/            # Program instructions
    errors.rs                # Error definitions
    lib.rs                   # Main program

app/src/v3/                  # TypeScript client
  sources/                   # Price source clients
  aggregation/               # Price aggregation
  quality/                   # Quality control
  registry/                  # Asset management
```

### Testing

```bash
# Run tests
anchor test

# Test specific module
npm test -- sources/jupiter-client

# Integration test
npm run test:integration
```

## Support

- GitHub Issues: [https://github.com/your-org/oracle/issues](https://github.com/your-org/oracle/issues)
- Documentation: [https://docs.your-oracle.com](https://docs.your-oracle.com)
- Discord: [https://discord.gg/your-oracle](https://discord.gg/your-oracle)

## License

MIT License - See LICENSE file for details

## Contributing

Contributions welcome! Please read CONTRIBUTING.md first.

---

**Built with ❤️ for the Solana ecosystem**
