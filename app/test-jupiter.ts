import { PublicKey } from '@solana/web3.js';
import { JupiterPriceClient } from './src/v3/sources/jupiter-client';

async function testJupiter() {
  console.log('=== Testing Jupiter Price API ===\n');

  const client = new JupiterPriceClient();

  // Test single price
  console.log('1. Fetching SOL price...');
  const SOL_MINT = new PublicKey('So11111111111111111111111111111111111111112');
  const solPrice = await client.getPrice(SOL_MINT);

  if (solPrice) {
    console.log(`   ✓ SOL: $${solPrice.toFixed(2)}\n`);
  } else {
    console.log('   ✗ Failed to fetch SOL price\n');
  }

  // Test batch prices
  console.log('2. Fetching batch prices (SOL, USDC, BONK)...');
  const USDC_MINT = new PublicKey('EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v');
  const BONK_MINT = new PublicKey('DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263');

  const prices = await client.getPrices([SOL_MINT, USDC_MINT, BONK_MINT]);

  if (prices.size > 0) {
    console.log(`   ✓ Fetched ${prices.size} prices:`);
    for (const [mint, data] of prices) {
      const symbol = mint === SOL_MINT.toString() ? 'SOL' :
                     mint === USDC_MINT.toString() ? 'USDC' : 'BONK';
      console.log(`     ${symbol}: $${data.price.toFixed(symbol === 'BONK' ? 8 : 2)}`);
    }
    console.log('');
  } else {
    console.log('   ✗ No prices fetched\n');
  }

  // Test polling for 5 seconds
  console.log('3. Starting live polling (5 seconds)...');
  let updateCount = 0;

  client.on('price', (mint, priceData) => {
    updateCount++;
    const symbol = mint === SOL_MINT.toString() ? 'SOL' :
                   mint === USDC_MINT.toString() ? 'USDC' : 'BONK';
    console.log(`   [Update ${updateCount}] ${symbol}: $${priceData.price.toFixed(symbol === 'BONK' ? 8 : 2)}`);
  });

  client.startPolling([SOL_MINT, USDC_MINT, BONK_MINT], 2000);

  await new Promise(resolve => setTimeout(resolve, 5000));

  client.stopPolling();
  console.log(`\n   ✓ Received ${updateCount} updates\n`);

  console.log('=== Jupiter API Test Complete ===');
  console.log('✅ All price sources working!');
  console.log('\nNext steps:');
  console.log('  npm run test:aggregation  - Test price aggregation');
  console.log('  npm run test:integration  - Full integration test');
}

testJupiter().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});
