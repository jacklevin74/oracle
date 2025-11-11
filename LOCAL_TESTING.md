# Local Testing Guide for Oracle V3

## Prerequisites

1. **Solana CLI Tools**
```bash
solana --version  # Should be 1.18.x or higher
anchor --version  # Should be 0.32.x or higher
```

2. **Node.js & Dependencies**
```bash
node --version  # Should be 18.x or higher
cd app && npm install
```

3. **Local Solana Keypairs**
```bash
# Generate test wallet if needed
solana-keygen new --outfile ~/.config/solana/test-wallet.json

# Set to localnet
solana config set --url localhost
```

## Step 1: Start Local Validator

Open a new terminal and run:

```bash
# Start local Solana validator with sufficient compute units
solana-test-validator \
  --reset \
  --compute-unit-limit 200000 \
  --bpf-program LuS6XnQ3qNXqNQvAJ3akXnEJRBv9XNoUricjMgTyCxX target/deploy/oracle.so

# Keep this running in the background
```

**Note:** If you want to test with the existing v2 program, you can preload it. For v3 testing, we'll deploy fresh.

## Step 2: Build the Programs

In another terminal:

```bash
# Build both programs
anchor build

# Check build succeeded
ls -lh target/deploy/
# Should see: oracle.so and oracle_v3.so
```

## Step 3: Deploy Oracle V3 Program

```bash
# Deploy to local validator
anchor deploy --provider.cluster localnet --program-name oracle-v3

# Get the program ID (should match declare_id in lib.rs)
solana address -k target/deploy/oracle_v3-keypair.json

# Fund your wallet
solana airdrop 10

# Verify deployment
solana program show <PROGRAM_ID>
```

## Step 4: Test Individual Price Clients

Create test scripts to verify each free API works:

### Test Jupiter Client

Create `app/test-jupiter.ts`:
```typescript
import { PublicKey } from '@solana/web3.js';
import { JupiterPriceClient } from './src/v3/sources/jupiter-client';

async function testJupiter() {
  const client = new JupiterPriceClient();

  // Test single price
  const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
  const price = await client.getPrice(SOL_MINT);
  console.log('SOL Price:', price);

  // Test batch prices
  const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  const BONK_MINT = new PublicKey('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263');

  const prices = await client.getPrices([SOL_MINT, USDC_MINT, BONK_MINT]);
  console.log('Batch Prices:', Array.from(prices.entries()));

  // Test polling
  client.on('price', (mint, priceData) => {
    console.log(`${mint}: $${priceData.price}`);
  });

  client.startPolling([SOL_MINT, USDC_MINT], 2000);

  // Run for 10 seconds
  await new Promise(resolve => setTimeout(resolve, 10000));
  client.stopPolling();
}

testJupiter().catch(console.error);
```

Run it:
```bash
cd app
npx ts-node test-jupiter.ts
```

### Test DexScreener Client

Create `app/test-dexscreener.ts`:
```typescript
import { PublicKey } from '@solana/web3.js';
import { DexScreenerClient } from './src/v3/sources/dexscreener-client';

async function testDexScreener() {
  const client = new DexScreenerClient();

  const BONK_MINT = new PublicKey('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263');

  // Test single token
  const data = await client.getTokenData(BONK_MINT);
  console.log('BONK Data:', {
    price: data?.price,
    liquidity: data?.liquidity,
    volume24h: data?.volume24h,
  });

  // Test with events
  client.on('price', (mint, priceData) => {
    console.log(`${mint}: $${priceData.price} (liquidity: $${priceData.liquidity})`);
  });

  client.startPolling([BONK_MINT], 5000);

  await new Promise(resolve => setTimeout(resolve, 15000));
  client.stopPolling();
}

testDexScreener().catch(console.error);
```

Run it:
```bash
npx ts-node test-dexscreener.ts
```

### Test Birdeye Client

Create `app/test-birdeye.ts`:
```typescript
import { PublicKey } from '@solana/web3.js';
import { BirdeyeClient } from './src/v3/sources/birdeye-client';

async function testBirdeye() {
  const client = new BirdeyeClient();

  const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
  const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

  // Test batch endpoint
  const prices = await client.getMultiplePrices([SOL_MINT, USDC_MINT]);
  console.log('Birdeye Prices:', Array.from(prices.entries()));

  client.on('batch_update', (prices) => {
    console.log(`Updated ${prices.size} prices`);
    prices.forEach((data, mint) => {
      console.log(`  ${mint}: $${data.price}`);
    });
  });

  client.startPolling([SOL_MINT, USDC_MINT], 2000);

  await new Promise(resolve => setTimeout(resolve, 10000));
  client.stopPolling();
}

testBirdeye().catch(console.error);
```

Run it:
```bash
npx ts-node test-birdeye.ts
```

## Step 5: Test Price Aggregation

Create `app/test-aggregation.ts`:
```typescript
import { PriceAggregator, SourceTier, PriceReading } from './src/v3/aggregation';

function testAggregation() {
  const aggregator = new PriceAggregator();

  // Simulate readings from different sources for SOL
  const readings: PriceReading[] = [
    {
      source: 'jupiter',
      tier: SourceTier.TIER_2_DEX_AGGREGATOR,
      price: 180.50,
      timestamp: Date.now(),
      confidence: 0.85,
    },
    {
      source: 'birdeye',
      tier: SourceTier.TIER_3_DEX_SCREENER,
      price: 180.30,
      timestamp: Date.now(),
      confidence: 0.80,
    },
    {
      source: 'dexscreener',
      tier: SourceTier.TIER_3_DEX_SCREENER,
      price: 180.45,
      timestamp: Date.now(),
      confidence: 0.78,
    },
    {
      source: 'pyth',
      tier: SourceTier.TIER_1_INSTITUTIONAL,
      price: 180.60,
      timestamp: Date.now(),
      confidence: 0.95,
    },
  ];

  const result = aggregator.aggregate(readings);

  console.log('Aggregation Result:');
  console.log('  Price:', result.price);
  console.log('  Confidence:', (result.confidence * 100).toFixed(1) + '%');
  console.log('  Sources:', result.sourceCount);
  console.log('  Deviation:', (result.deviation! * 100).toFixed(2) + '%');
  console.log('  Used Sources:', result.sources);

  // Test with outlier
  console.log('\n--- Testing with Outlier ---');
  const withOutlier = [...readings, {
    source: 'bad_source',
    tier: SourceTier.TIER_4_FALLBACK,
    price: 200.00,  // Outlier (10% above median)
    timestamp: Date.now(),
    confidence: 0.60,
  }];

  const result2 = aggregator.aggregate(withOutlier);
  console.log('  Price:', result2.price);
  console.log('  Confidence:', (result2.confidence * 100).toFixed(1) + '%');
  console.log('  Sources Used:', result2.sourceCount, '/', withOutlier.length);
}

testAggregation();
```

Run it:
```bash
npx ts-node test-aggregation.ts
```

## Step 6: Test Quality Controller

Create `app/test-quality.ts`:
```typescript
import { PublicKey } from '@solana/web3.js';
import { QualityController } from './src/v3/quality';
import { PriceReading, AggregatedPrice, SourceTier } from './src/v3/aggregation';

async function testQuality() {
  const controller = new QualityController({
    maxDeviation: 0.10,
    minSources: 2,
    minConfidence: 0.70,
  });

  // Listen to alerts
  controller.on('alert', (alert) => {
    console.log(`[${alert.severity.toUpperCase()}] ${alert.type}: ${alert.message}`);
  });

  controller.on('metrics', (metrics) => {
    console.log(`Metrics - Sources: ${metrics.sourceCount}, Confidence: ${(metrics.confidence * 100).toFixed(0)}%`);
  });

  const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');

  // Test normal scenario
  console.log('--- Test 1: Normal Scenario ---');
  const normalReadings: PriceReading[] = [
    { source: 'jupiter', tier: SourceTier.TIER_2_DEX_AGGREGATOR, price: 180.50, timestamp: Date.now(), confidence: 0.85 },
    { source: 'birdeye', tier: SourceTier.TIER_3_DEX_SCREENER, price: 180.40, timestamp: Date.now(), confidence: 0.82 },
    { source: 'pyth', tier: SourceTier.TIER_1_INSTITUTIONAL, price: 180.55, timestamp: Date.now(), confidence: 0.95 },
  ];

  const normalAgg: AggregatedPrice = {
    price: 180.50,
    confidence: 0.87,
    sourceCount: 3,
    sources: ['jupiter', 'birdeye', 'pyth'],
    timestamp: Date.now(),
    deviation: 0.001,
  };

  await controller.monitorPrice(SOL_MINT, normalReadings, normalAgg);

  // Test high deviation scenario
  console.log('\n--- Test 2: High Deviation Scenario ---');
  const highDevReadings: PriceReading[] = [
    { source: 'jupiter', tier: SourceTier.TIER_2_DEX_AGGREGATOR, price: 180.50, timestamp: Date.now(), confidence: 0.85 },
    { source: 'birdeye', tier: SourceTier.TIER_3_DEX_SCREENER, price: 200.00, timestamp: Date.now(), confidence: 0.82 },
  ];

  const highDevAgg: AggregatedPrice = {
    price: 190.25,
    confidence: 0.70,
    sourceCount: 2,
    sources: ['jupiter', 'birdeye'],
    timestamp: Date.now(),
    deviation: 0.11,
  };

  await controller.monitorPrice(SOL_MINT, highDevReadings, highDevAgg);

  // Test low sources scenario
  console.log('\n--- Test 3: Low Sources Scenario ---');
  const lowSourceReadings: PriceReading[] = [
    { source: 'jupiter', tier: SourceTier.TIER_2_DEX_AGGREGATOR, price: 180.50, timestamp: Date.now(), confidence: 0.85 },
  ];

  const lowSourceAgg: AggregatedPrice = {
    price: 180.50,
    confidence: 0.60,
    sourceCount: 1,
    sources: ['jupiter'],
    timestamp: Date.now(),
    deviation: 0,
  };

  await controller.monitorPrice(SOL_MINT, lowSourceReadings, lowSourceAgg);

  // Check quality score
  const qualityScore = controller.getQualityScore(SOL_MINT);
  console.log(`\nOverall Quality Score: ${(qualityScore * 100).toFixed(1)}%`);
}

testQuality().catch(console.error);
```

Run it:
```bash
npx ts-node test-quality.ts
```

## Step 7: Test Asset Registry

Create `app/test-registry.ts`:
```typescript
import { AssetRegistry } from './src/v3/registry';
import * as path from 'path';

async function testRegistry() {
  const registry = new AssetRegistry();

  // Load configuration
  const configPath = path.join(__dirname, 'config', 'assets.json');
  await registry.loadFromConfig(configPath);

  console.log(`Loaded ${registry.getAssetCount()} assets`);
  console.log(`Active assets: ${registry.getActiveAssetCount()}`);

  // Get all active assets
  const assets = registry.getActiveAssets();
  console.log('\nActive Assets:');
  assets.forEach(asset => {
    console.log(`  ${asset.symbol}: ${asset.mint.toString()}`);
    console.log(`    Sources:`, Object.keys(asset.sources));
    console.log(`    Min Sources: ${asset.minSources}, Max Deviation: ${asset.maxPriceDeviation * 100}%`);
  });

  // Get assets by source
  const jupiterAssets = registry.getAssetsBySource('jupiter');
  console.log(`\nAssets with Jupiter: ${jupiterAssets.length}`);

  const pythAssets = registry.getAssetsBySource('pyth');
  console.log(`Assets with Pyth: ${pythAssets.length}`);

  // Export config
  const exported = registry.exportConfig();
  console.log('\nExported config length:', exported.length);
}

testRegistry().catch(console.error);
```

Run it:
```bash
npx ts-node test-registry.ts
```

## Step 8: Test On-Chain Program

Create `tests/oracle-v3.ts`:
```typescript
import * as anchor from '@coral-xyz/anchor';
import { Program } from '@coral-xyz/anchor';
import { PublicKey } from '@solana/web3.js';
import { expect } from 'chai';

describe('oracle-v3', () => {
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.OracleV3 as Program;
  const authority = provider.wallet;

  let registryPda: PublicKey;
  let registryBump: number;

  // Test token mints
  const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
  const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');

  before(async () => {
    // Derive registry PDA
    [registryPda, registryBump] = PublicKey.findProgramAddressSync(
      [Buffer.from('registry')],
      program.programId
    );
  });

  it('Initialize registry', async () => {
    await program.methods
      .initializeRegistry(authority.publicKey)
      .accounts({
        registry: registryPda,
        payer: authority.publicKey,
      })
      .rpc();

    const registry = await program.account.assetRegistry.fetch(registryPda);
    expect(registry.authority.toString()).to.equal(authority.publicKey.toString());
    expect(registry.assetCount).to.equal(0);
  });

  it('Register SOL asset', async () => {
    const [assetConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('asset_config'), SOL_MINT.toBuffer()],
      program.programId
    );

    const [priceDataPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('price_data'), SOL_MINT.toBuffer()],
      program.programId
    );

    // Pyth feed ID for SOL/USD
    const pythFeedId = Buffer.from(
      'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
      'hex'
    );

    await program.methods
      .registerAsset(SOL_MINT, 'SOL', 6, Array.from(pythFeedId))
      .accounts({
        registry: registryPda,
        assetConfig: assetConfigPda,
        priceData: priceDataPda,
        authority: authority.publicKey,
        payer: authority.publicKey,
      })
      .rpc();

    const registry = await program.account.assetRegistry.fetch(registryPda);
    expect(registry.assetCount).to.equal(1);

    const assetConfig = await program.account.assetConfig.fetch(assetConfigPda);
    expect(assetConfig.mint.toString()).to.equal(SOL_MINT.toString());
    expect(assetConfig.isActive).to.be.true;
  });

  it('Set price for SOL', async () => {
    const [assetConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('asset_config'), SOL_MINT.toBuffer()],
      program.programId
    );

    const [priceDataPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('price_data'), SOL_MINT.toBuffer()],
      program.programId
    );

    const price = 180_500000; // $180.50 with 6 decimals
    const timestamp = Date.now();

    await program.methods
      .setPrice(1, new anchor.BN(price), new anchor.BN(timestamp))
      .accounts({
        assetConfig: assetConfigPda,
        priceData: priceDataPda,
        signer: authority.publicKey,
      })
      .rpc();

    const priceData = await program.account.priceData.fetch(priceDataPda);
    expect(priceData.prices.param1.toString()).to.equal(price.toString());
  });

  it('Register USDC asset', async () => {
    const [assetConfigPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('asset_config'), USDC_MINT.toBuffer()],
      program.programId
    );

    const [priceDataPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('price_data'), USDC_MINT.toBuffer()],
      program.programId
    );

    await program.methods
      .registerAsset(USDC_MINT, 'USDC', 6, null)
      .accounts({
        registry: registryPda,
        assetConfig: assetConfigPda,
        priceData: priceDataPda,
        authority: authority.publicKey,
        payer: authority.publicKey,
      })
      .rpc();

    const registry = await program.account.assetRegistry.fetch(registryPda);
    expect(registry.assetCount).to.equal(2);
  });

  it('Batch set prices', async () => {
    const updates = [
      {
        mint: SOL_MINT,
        price: new anchor.BN(181_000000),
      },
      {
        mint: USDC_MINT,
        price: new anchor.BN(1_000000),
      },
    ];

    const timestamp = Date.now();

    // Prepare remaining accounts (asset_config, price_data for each update)
    const remainingAccounts = [];
    for (const update of updates) {
      const [assetConfigPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('asset_config'), update.mint.toBuffer()],
        program.programId
      );
      const [priceDataPda] = PublicKey.findProgramAddressSync(
        [Buffer.from('price_data'), update.mint.toBuffer()],
        program.programId
      );

      remainingAccounts.push(
        { pubkey: assetConfigPda, isWritable: false, isSigner: false },
        { pubkey: priceDataPda, isWritable: true, isSigner: false }
      );
    }

    await program.methods
      .batchSetPrices(1, updates, new anchor.BN(timestamp))
      .accounts({
        signer: authority.publicKey,
      })
      .remainingAccounts(remainingAccounts)
      .rpc();

    // Verify prices were updated
    const [solPriceDataPda] = PublicKey.findProgramAddressSync(
      [Buffer.from('price_data'), SOL_MINT.toBuffer()],
      program.programId
    );
    const solPriceData = await program.account.priceData.fetch(solPriceDataPda);
    expect(solPriceData.prices.param1.toString()).to.equal('181000000');
  });
});
```

Run tests:
```bash
anchor test --skip-local-validator
# (validator already running from Step 1)
```

## Step 9: Integration Test (Full Flow)

Create `app/test-integration.ts`:
```typescript
import { PublicKey } from '@solana/web3.js';
import { JupiterPriceClient } from './src/v3/sources/jupiter-client';
import { DexScreenerClient } from './src/v3/sources/dexscreener-client';
import { BirdeyeClient } from './src/v3/sources/birdeye-client';
import { PriceAggregator, SourceTier, PriceReading } from './src/v3/aggregation';
import { QualityController } from './src/v3/quality';
import { AssetRegistry } from './src/v3/registry';
import * as path from 'path';

async function integrationTest() {
  console.log('=== Oracle V3 Integration Test ===\n');

  // 1. Load asset registry
  console.log('1. Loading asset registry...');
  const registry = new AssetRegistry();
  await registry.loadFromConfig(path.join(__dirname, 'config', 'assets.json'));
  console.log(`   Loaded ${registry.getActiveAssetCount()} active assets\n`);

  // 2. Initialize price clients
  console.log('2. Initializing price clients...');
  const jupiterClient = new JupiterPriceClient();
  const dexScreenerClient = new DexScreenerClient();
  const birdeyeClient = new BirdeyeClient();
  const aggregator = new PriceAggregator();
  const qualityController = new QualityController();
  console.log('   All clients initialized\n');

  // 3. Set up quality monitoring
  qualityController.on('alert', (alert) => {
    console.log(`   ⚠️  [${alert.type}] ${alert.message}`);
  });

  // 4. Test with SOL
  const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
  console.log('3. Fetching prices for SOL...');

  const readings: PriceReading[] = [];

  // Get Jupiter price
  const jupiterPrice = await jupiterClient.getPrice(SOL_MINT);
  if (jupiterPrice) {
    readings.push({
      source: 'jupiter',
      tier: SourceTier.TIER_2_DEX_AGGREGATOR,
      price: jupiterPrice,
      timestamp: Date.now(),
      confidence: 0.85,
    });
    console.log(`   ✓ Jupiter: $${jupiterPrice.toFixed(2)}`);
  }

  // Get DexScreener price
  const dexData = await dexScreenerClient.getTokenData(SOL_MINT);
  if (dexData) {
    readings.push({
      source: 'dexscreener',
      tier: SourceTier.TIER_3_DEX_SCREENER,
      price: dexData.price,
      timestamp: Date.now(),
      confidence: 0.80,
    });
    console.log(`   ✓ DexScreener: $${dexData.price.toFixed(2)} (liquidity: $${(dexData.liquidity / 1e6).toFixed(1)}M)`);
  }

  // Get Birdeye price
  const birdeyeData = await birdeyeClient.getPriceData(SOL_MINT);
  if (birdeyeData) {
    readings.push({
      source: 'birdeye',
      tier: SourceTier.TIER_3_DEX_SCREENER,
      price: birdeyeData.price,
      timestamp: Date.now(),
      confidence: 0.82,
    });
    console.log(`   ✓ Birdeye: $${birdeyeData.price.toFixed(2)}`);
  }

  // 5. Aggregate prices
  console.log('\n4. Aggregating prices...');
  if (readings.length > 0) {
    const aggregated = aggregator.aggregate(readings);
    console.log(`   Final Price: $${aggregated.price.toFixed(2)}`);
    console.log(`   Confidence: ${(aggregated.confidence * 100).toFixed(1)}%`);
    console.log(`   Sources: ${aggregated.sourceCount}`);
    console.log(`   Deviation: ${(aggregated.deviation! * 100).toFixed(2)}%`);

    // 6. Quality check
    console.log('\n5. Quality check...');
    await qualityController.monitorPrice(SOL_MINT, readings, aggregated);
    const qualityScore = qualityController.getQualityScore(SOL_MINT);
    console.log(`   Quality Score: ${(qualityScore * 100).toFixed(1)}%`);
  } else {
    console.log('   ❌ No price readings available');
  }

  console.log('\n=== Integration Test Complete ===');
}

integrationTest().catch(console.error);
```

Run it:
```bash
npx ts-node test-integration.ts
```

## Step 10: Monitor Live Updates

Create `app/test-live.ts`:
```typescript
import { PublicKey } from '@solana/web3.js';
import { JupiterPriceClient } from './src/v3/sources/jupiter-client';
import { BirdeyeClient } from './src/v3/sources/birdeye-client';
import { PriceAggregator, SourceTier, PriceReading } from './src/v3/aggregation';

async function liveTest() {
  console.log('=== Live Price Monitoring ===\n');

  const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
  const BONK_MINT = new PublicKey('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263');

  const jupiterClient = new JupiterPriceClient();
  const birdeyeClient = new BirdeyeClient();
  const aggregator = new PriceAggregator();

  const latestPrices = new Map<string, Map<string, PriceReading>>();

  // Jupiter updates
  jupiterClient.on('price', (mint, data) => {
    if (!latestPrices.has(mint)) {
      latestPrices.set(mint, new Map());
    }
    latestPrices.get(mint)!.set('jupiter', {
      source: 'jupiter',
      tier: SourceTier.TIER_2_DEX_AGGREGATOR,
      price: data.price,
      timestamp: data.timestamp,
      confidence: 0.85,
    });
  });

  // Birdeye updates
  birdeyeClient.on('price', (mint, data) => {
    if (!latestPrices.has(mint)) {
      latestPrices.set(mint, new Map());
    }
    latestPrices.get(mint)!.set('birdeye', {
      source: 'birdeye',
      tier: SourceTier.TIER_3_DEX_SCREENER,
      price: data.price,
      timestamp: data.timestamp,
      confidence: 0.82,
    });
  });

  // Start polling
  jupiterClient.startPolling([SOL_MINT, BONK_MINT], 2000);
  birdeyeClient.startPolling([SOL_MINT, BONK_MINT], 2000);

  // Aggregate every 3 seconds
  setInterval(() => {
    console.clear();
    console.log('=== Live Prices (Updated Every 3s) ===\n');
    console.log(new Date().toLocaleTimeString());
    console.log('');

    for (const [mint, sources] of latestPrices) {
      const readings = Array.from(sources.values());
      if (readings.length > 0) {
        const aggregated = aggregator.aggregate(readings);
        const symbol = mint === SOL_MINT.toString() ? 'SOL' : 'BONK';

        console.log(`${symbol}:`);
        console.log(`  Price: $${aggregated.price.toFixed(symbol === 'SOL' ? 2 : 8)}`);
        console.log(`  Confidence: ${(aggregated.confidence * 100).toFixed(0)}%`);
        console.log(`  Sources: ${aggregated.sources.join(', ')}`);
        console.log('');
      }
    }
  }, 3000);

  // Run for 30 seconds
  await new Promise(resolve => setTimeout(resolve, 30000));

  jupiterClient.stopPolling();
  birdeyeClient.stopPolling();
  console.log('\n=== Monitoring Stopped ===');
}

liveTest().catch(console.error);
```

Run it:
```bash
npx ts-node test-live.ts
```

## Troubleshooting

### Program Build Errors
```bash
# Clean and rebuild
anchor clean
anchor build

# Check for syntax errors
cd programs/oracle-v3/src && rustc --explain E0308
```

### RPC Connection Issues
```bash
# Check validator is running
solana cluster-version

# Check balance
solana balance

# Get fresh airdrop
solana airdrop 5
```

### Price API Failures
- **Jupiter:** Check network connectivity, API might be rate-limited
- **DexScreener:** Slow responses are normal, increase timeout
- **Birdeye:** Free tier has limits, space out requests

### Test Failures
```bash
# Reset validator state
solana-test-validator --reset

# Redeploy programs
anchor deploy --provider.cluster localnet

# Check logs
solana logs
```

## Summary

You should now be able to:
- ✅ Test individual price source clients (Jupiter, DexScreener, Birdeye)
- ✅ Test price aggregation with outlier detection
- ✅ Test quality control and alerting
- ✅ Test on-chain program operations
- ✅ Run full integration tests
- ✅ Monitor live price updates

Next: Deploy to X1 Mainnet! 🚀
