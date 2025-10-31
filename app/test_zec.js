#!/usr/bin/env node
/**
 * Test ZEC (Zcash) availability across different price providers
 */

const https = require('https');
const http = require('http');

// Test configurations for each provider
const providers = {
  'Pyth Network': {
    url: 'https://hermes.pyth.network/v2/updates/price/latest?ids[]=0xbe9b59d178f0d6a97ab4c343bff2aa69caa1eaae3e9048a65788c529b125bb24',
    method: 'GET',
    test: (data) => {
      const parsed = JSON.parse(data);
      return parsed.parsed && parsed.parsed.length > 0;
    }
  },
  'Kraken': {
    url: 'https://api.kraken.com/0/public/Ticker?pair=ZECUSD',
    method: 'GET',
    test: (data) => {
      const parsed = JSON.parse(data);
      return parsed.error.length === 0 && parsed.result.ZECUSD;
    }
  },
  'Coinbase': {
    url: 'https://api.coinbase.com/v2/exchange-rates?currency=ZEC',
    method: 'GET',
    test: (data) => {
      const parsed = JSON.parse(data);
      return parsed.data && parsed.data.rates && parsed.data.rates.USD;
    }
  },
  'Binance': {
    url: 'https://api.binance.com/api/v3/ticker/price?symbol=ZECUSDT',
    method: 'GET',
    test: (data) => {
      const parsed = JSON.parse(data);
      return parsed.symbol === 'ZECUSDT' && parsed.price;
    }
  },
  'KuCoin': {
    url: 'https://api.kucoin.com/api/v1/market/orderbook/level1?symbol=ZEC-USDT',
    method: 'GET',
    test: (data) => {
      const parsed = JSON.parse(data);
      return parsed.code === '200000' && parsed.data && parsed.data.price;
    }
  },
  'MEXC': {
    url: 'https://api.mexc.com/api/v3/ticker/price?symbol=ZECUSDT',
    method: 'GET',
    test: (data) => {
      const parsed = JSON.parse(data);
      return parsed.symbol === 'ZECUSDT' && parsed.price;
    }
  },
  'Bybit': {
    url: 'https://api.bybit.com/v5/market/tickers?category=spot&symbol=ZECUSDT',
    method: 'GET',
    test: (data) => {
      const parsed = JSON.parse(data);
      return parsed.retCode === 0 && parsed.result && parsed.result.list && parsed.result.list.length > 0;
    }
  },
  'Hyperliquid': {
    url: 'https://api.hyperliquid.xyz/info',
    method: 'POST',
    body: JSON.stringify({ type: 'allMids' }),
    test: (data) => {
      const parsed = JSON.parse(data);
      return parsed.ZEC !== undefined;
    }
  }
};

function fetch(url, method = 'GET', body = null) {
  return new Promise((resolve, reject) => {
    const isHttps = url.startsWith('https');
    const lib = isHttps ? https : http;

    const urlObj = new URL(url);
    const options = {
      hostname: urlObj.hostname,
      port: urlObj.port,
      path: urlObj.pathname + urlObj.search,
      method: method,
      headers: {
        'User-Agent': 'Oracle-ZEC-Test/1.0',
        'Content-Type': 'application/json'
      }
    };

    if (body && method === 'POST') {
      options.headers['Content-Length'] = Buffer.byteLength(body);
    }

    const req = lib.request(options, (res) => {
      let data = '';
      res.on('data', (chunk) => data += chunk);
      res.on('end', () => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          resolve(data);
        } else {
          reject(new Error(`HTTP ${res.statusCode}: ${data}`));
        }
      });
    });

    req.on('error', reject);
    if (body && method === 'POST') {
      req.write(body);
    }
    req.end();
  });
}

async function testProvider(name, config) {
  try {
    const data = await fetch(config.url, config.method, config.body);
    const supported = config.test(data);

    if (supported) {
      const parsed = JSON.parse(data);
      let price = null;

      // Extract price for display
      if (name === 'Pyth Network') {
        price = parsed.parsed[0]?.price?.price / 1e8;
      } else if (name === 'Kraken') {
        price = parseFloat(parsed.result.ZECUSD.c[0]);
      } else if (name === 'Coinbase') {
        price = parseFloat(parsed.data.rates.USD);
      } else if (name === 'Binance') {
        price = parseFloat(parsed.price);
      } else if (name === 'KuCoin') {
        price = parseFloat(parsed.data.price);
      } else if (name === 'MEXC') {
        price = parseFloat(parsed.price);
      } else if (name === 'Bybit') {
        price = parseFloat(parsed.result.list[0].lastPrice);
      } else if (name === 'Hyperliquid') {
        price = parseFloat(parsed.ZEC);
      }

      return { name, supported: true, price };
    } else {
      return { name, supported: false, price: null };
    }
  } catch (error) {
    return { name, supported: false, error: error.message };
  }
}

async function main() {
  console.log('\n═══════════════════════════════════════════════════');
  console.log('  Testing ZEC (Zcash) Support Across Providers');
  console.log('═══════════════════════════════════════════════════\n');

  const results = [];

  for (const [name, config] of Object.entries(providers)) {
    process.stdout.write(`Testing ${name}...`);
    const result = await testProvider(name, config);
    results.push(result);

    if (result.supported) {
      console.log(` ✓ SUPPORTED - Price: $${result.price?.toFixed(2) || 'N/A'}`);
    } else {
      console.log(` ✗ NOT SUPPORTED ${result.error ? `(${result.error})` : ''}`);
    }
  }

  console.log('\n═══════════════════════════════════════════════════');
  console.log('  Summary');
  console.log('═══════════════════════════════════════════════════\n');

  const supported = results.filter(r => r.supported);
  const notSupported = results.filter(r => !r.supported);

  console.log(`Supported providers (${supported.length}):`);
  supported.forEach(r => {
    console.log(`  ✓ ${r.name}: $${r.price?.toFixed(2)}`);
  });

  if (notSupported.length > 0) {
    console.log(`\nNot supported (${notSupported.length}):`);
    notSupported.forEach(r => {
      console.log(`  ✗ ${r.name}`);
    });
  }

  console.log('\n');
}

main().catch(console.error);
