# Oracle V3 - Quick Start Guide

## 🚀 Get Started in 2 Minutes

### Option 1: Automated Setup (Recommended)

```bash
# Run the automated setup script
./test-local.sh

# This will:
# ✓ Check prerequisites (Solana, Anchor, Node.js)
# ✓ Start local validator
# ✓ Build and deploy programs
# ✓ Install dependencies
# ✓ Show available test commands
```

### Option 2: Manual Setup

```bash
# 1. Start local validator
solana-test-validator --reset

# 2. Build and deploy (in another terminal)
anchor build
anchor deploy --provider.cluster localnet --program-name oracle-v3

# 3. Install dependencies
cd app && npm install
```

## 🧪 Run Tests

### Quick Tests (Free APIs)

```bash
cd app

# Test Jupiter price API (< 5 seconds)
npm run test:jupiter

# Test price aggregation
npm run test:aggregation

# Test quality control
npm run test:quality

# Run all quick tests
npm run test:v3
```

### Integration Test

```bash
# Full end-to-end test with all price sources
npm run test:integration

# Expected output:
# ✓ 3+ price sources for SOL
# ✓ Aggregated price with confidence score
# ✓ Quality metrics and alerts
```

### Live Monitoring (30 seconds)

```bash
# Watch live price updates
npm run test:live

# Shows real-time prices from multiple sources
# Updates every 3 seconds
```

### On-Chain Tests

```bash
# Test Solana program (requires local validator)
cd ..
anchor test --skip-local-validator

# Tests:
# ✓ Initialize registry
# ✓ Register assets
# ✓ Set prices
# ✓ Batch update
```

## 📊 What You'll See

### Jupiter Test Output
```
SOL Price: 180.50
Batch Prices: [
  [ 'So111...', { price: 180.50, timestamp: 1699... } ],
  [ 'EPjF...', { price: 1.00, timestamp: 1699... } ]
]
So111...: $180.50
EPjF...: $1.00
```

### Integration Test Output
```
=== Oracle V3 Integration Test ===

1. Loading asset registry...
   Loaded 10 active assets

2. Initializing price clients...
   All clients initialized

3. Fetching prices for SOL...
   ✓ Jupiter: $180.52
   ✓ DexScreener: $180.45 (liquidity: $25.3M)
   ✓ Birdeye: $180.48

4. Aggregating prices...
   Final Price: $180.49
   Confidence: 86.2%
   Sources: 3
   Deviation: 0.19%

5. Quality check...
   Quality Score: 88.5%

=== Integration Test Complete ===
```

### Live Monitoring Output
```
=== Live Prices (Updated Every 3s) ===

10:30:45 AM

SOL:
  Price: $180.50
  Confidence: 87%
  Sources: jupiter, birdeye

BONK:
  Price: $0.00001234
  Confidence: 82%
  Sources: jupiter, dexscreener, birdeye
```

## ✅ Verify Everything Works

Run this one-liner to test all components:

```bash
./test-local.sh && cd app && npm run test:v3 && npm run test:integration
```

Expected: All tests pass with ✓ marks

## 🔧 Troubleshooting

### "Command not found: solana"
```bash
# Install Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"
```

### "Command not found: anchor"
```bash
# Install Anchor
cargo install --git https://github.com/coral-xyz/anchor --tag v0.32.1 anchor-cli
```

### "Network request failed"
- Jupiter/DexScreener/Birdeye APIs require internet connection
- Check your network and try again
- Some APIs may have temporary outages

### "Program build failed"
```bash
# Clean and rebuild
anchor clean
anchor build
```

### "Validator not responding"
```bash
# Stop validator
pkill solana-test-validator

# Start fresh
solana-test-validator --reset
```

## 📁 Test Files Location

All test files are in `app/`:

```
app/
├── test-jupiter.ts          # Jupiter client test
├── test-dexscreener.ts      # DexScreener client test
├── test-birdeye.ts          # Birdeye client test
├── test-aggregation.ts      # Aggregation engine test
├── test-quality.ts          # Quality control test
├── test-registry.ts         # Asset registry test
├── test-integration.ts      # Full integration test
└── test-live.ts             # Live monitoring test
```

## 🎯 Next Steps

After testing locally:

1. **Review V3_README.md** for complete documentation
2. **Review LOCAL_TESTING.md** for detailed test scenarios
3. **Customize assets.json** with your token list
4. **Deploy to X1 Mainnet** (see V3_README.md)
5. **Build the main oracle service** to tie everything together

## 💡 Pro Tips

1. **Start small**: Test individual components before integration
2. **Check logs**: Use `console.log` liberally during development
3. **Watch live updates**: `npm run test:live` is great for debugging
4. **Monitor quality**: Quality controller alerts help catch issues early
5. **Read error messages**: They usually tell you exactly what's wrong

## 📚 Documentation

- **V3_README.md** - Complete feature documentation
- **LOCAL_TESTING.md** - Detailed testing guide
- **QUICKSTART.md** - This file

## 🆘 Need Help?

1. Check error messages carefully
2. Review LOCAL_TESTING.md for specific scenarios
3. Check GitHub issues
4. Ensure all prerequisites are installed

## ✨ Success Criteria

You're ready to move forward when:
- ✅ `./test-local.sh` completes successfully
- ✅ All price source clients return data
- ✅ Price aggregation produces confidence scores
- ✅ Quality controller detects alerts
- ✅ On-chain program tests pass
- ✅ Integration test shows multi-source prices

Happy testing! 🎉
