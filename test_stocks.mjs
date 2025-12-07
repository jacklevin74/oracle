#!/usr/bin/env node
/**
 * Test script to listen to TSLA, NVDA, and MSTR price feeds from Pyth Network
 */

import { PriceServiceConnection } from '@pythnetwork/price-service-client';

const FEED_IDS = {
  TSLA: '0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1',
  NVDA: '0xb1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593',
  MSTR: '0xe1e80251e5f5184f2195008382538e847fafc36f751896889dd3d1b1f6111f09',
};

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
  console.log('='.repeat(70));
  console.log('Stock Price Feeds Test - TSLA, NVDA, MSTR');
  console.log('='.repeat(70));
  console.log(`Hermes URL: ${PYTH_HERMES_URL}`);
  console.log('');
  console.log('Feed IDs:');
  for (const [symbol, id] of Object.entries(FEED_IDS)) {
    console.log(`  ${symbol}: ${id}`);
  }
  console.log('='.repeat(70));
  console.log('');

  const priceService = new PriceServiceConnection(PYTH_HERMES_URL, {
    priceFeedRequestConfig: { binary: true },
  });

  const normalizedIds = Object.values(FEED_IDS).map(normalizeFeedId);
  const updateCounts = { TSLA: 0, NVDA: 0, MSTR: 0 };
  const latestPrices = { TSLA: null, NVDA: null, MSTR: null };

  console.log('Subscribing to stock price feeds...\n');

  await priceService.subscribePriceFeedUpdates(normalizedIds, (priceFeed) => {
    try {
      // Get latest available price regardless of age
      const p = priceFeed.getPriceUnchecked();

      if (!p) {
        return;
      }

      const id = normalizeFeedId(priceFeed.id);
      const symbol = Object.keys(FEED_IDS).find(key => normalizeFeedId(FEED_IDS[key]) === id);

      if (!symbol) {
        return;
      }

      const price = scalePythPrice(p);

      if (price === null || !Number.isFinite(price)) {
        return;
      }

      updateCounts[symbol]++;
      const timestamp = new Date(Number(p.publishTime) * 1000);
      const ageSeconds = Math.floor((Date.now() / 1000) - Number(p.publishTime));
      const confidence = p.conf ? Number(p.conf) * Math.pow(10, p.expo) : 0;

      // Store latest price
      latestPrices[symbol] = price;

      // Only print first update per symbol or every 10th update
      if (updateCounts[symbol] === 1 || updateCounts[symbol] % 10 === 0) {
        const marketStatus = ageSeconds > 120 ? '(Market CLOSED)' : '(Market OPEN)';
        console.log(`[${symbol}] Update #${updateCounts[symbol]} ${marketStatus}`);
        console.log(`    Price:      $${price.toFixed(2)}`);
        console.log(`    Confidence: ±$${confidence.toFixed(2)}`);
        console.log(`    Published:  ${timestamp.toISOString()}`);
        console.log(`    Age:        ${ageSeconds}s ago`);
        console.log('');
      }

    } catch (error) {
      // Ignore errors
    }
  });

  console.log('✓ Subscribed! Listening for stock price updates...');
  console.log('  (Press Ctrl+C to stop)\n');

  // Print summary every 5 seconds
  const summaryInterval = setInterval(() => {
    console.log('--- Update Summary ---');
    for (const symbol of Object.keys(FEED_IDS)) {
      const price = latestPrices[symbol];
      const count = updateCounts[symbol];
      if (price !== null) {
        console.log(`  ${symbol}: $${price.toFixed(2)} (${count} updates)`);
      } else {
        console.log(`  ${symbol}: No data yet`);
      }
    }
    console.log('');
  }, 5000);

  // Keep the script running
  process.on('SIGINT', async () => {
    clearInterval(summaryInterval);
    console.log('\n\nClosing connection...');
    await priceService.closeWebSocket();
    console.log('\nFinal Statistics:');
    for (const [symbol, count] of Object.entries(updateCounts)) {
      console.log(`  ${symbol}: ${count} updates, Latest: $${latestPrices[symbol]?.toFixed(2) || 'N/A'}`);
    }
    process.exit(0);
  });
}

main().catch((error) => {
  console.error('Error:', error);
  process.exit(1);
});
