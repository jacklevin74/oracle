#!/usr/bin/env node
/**
 * Test script to listen to TSLA price feed from Pyth Network
 */

import { PriceServiceConnection } from '@pythnetwork/price-service-client';

const TSLA_FEED_ID = '0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1';
const PYTH_HERMES_URL = 'https://hermes.pyth.network';

// Normalize feed ID (remove 0x prefix)
function normalizeFeedId(id) {
  return id.toLowerCase().replace(/^0x/, '');
}

// Scale Pyth price to human-readable format
function scalePythPrice(price) {
  if (!price || price.price === undefined || price.expo === undefined) {
    return null;
  }
  const n = typeof price.price === 'bigint' ? Number(price.price.toString()) : Number(price.price);
  if (!Number.isFinite(n)) {
    return null;
  }
  return n * Math.pow(10, price.expo);
}

async function main() {
  console.log('='.repeat(60));
  console.log('TSLA Price Feed Test');
  console.log('='.repeat(60));
  console.log(`Feed ID: ${TSLA_FEED_ID}`);
  console.log(`Hermes URL: ${PYTH_HERMES_URL}`);
  console.log('='.repeat(60));
  console.log('');

  const priceService = new PriceServiceConnection(PYTH_HERMES_URL, {
    priceFeedRequestConfig: { binary: true },
  });

  const normalizedId = normalizeFeedId(TSLA_FEED_ID);
  let updateCount = 0;

  console.log('Subscribing to TSLA price feed...\n');

  await priceService.subscribePriceFeedUpdates([normalizedId], (priceFeed) => {
    try {
      // Try to get price with different age thresholds
      let p = priceFeed.getPriceUnchecked(); // Get latest available price regardless of age

      if (!p) {
        console.log('⚠️  No price data available');
        return;
      }

      const ageSeconds = Math.floor((Date.now() / 1000) - Number(p.publishTime));

      // Warn if price is stale (older than 2 minutes)
      if (ageSeconds > 120) {
        if (updateCount === 0) {
          console.log(`⚠️  Market appears CLOSED - using last available price from ${ageSeconds}s ago`);
        }
      }

      const price = scalePythPrice(p);

      if (price === null || !Number.isFinite(price)) {
        console.log('⚠️  Invalid price data');
        return;
      }

      updateCount++;
      const timestamp = new Date(Number(p.publishTime) * 1000);
      const confidence = p.conf ? Number(p.conf) * Math.pow(10, p.expo) : 0;

      console.log(`[${updateCount}] TSLA Price Update`);
      console.log(`    Price:      $${price.toFixed(2)}`);
      console.log(`    Confidence: ±$${confidence.toFixed(2)}`);
      console.log(`    Published:  ${timestamp.toISOString()}`);
      console.log(`    Age:        ${Math.floor((Date.now() - timestamp.getTime()) / 1000)}s ago`);
      console.log('');

    } catch (error) {
      if (error.message && error.message.includes('no older than')) {
        // Ignore stale price errors
      } else {
        console.error('Error processing price feed:', error.message);
      }
    }
  });

  console.log('✓ Subscribed! Listening for TSLA price updates...');
  console.log('  (Press Ctrl+C to stop)\n');

  // Keep the script running
  process.on('SIGINT', async () => {
    console.log('\n\nClosing connection...');
    await priceService.closeWebSocket();
    console.log(`Received ${updateCount} price updates.`);
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
