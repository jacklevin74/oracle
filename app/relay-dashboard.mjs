#!/usr/bin/env node
/**
 * Relay Price Dashboard
 *
 * Shows ALL 8 price feeds (BTC, ETH, SOL, HYPE, ZEC, TSLA, NVDA, MSTR)
 * Reads directly from price relay instead of blockchain
 */

import express from 'express';
import { PythClient } from './dist/oracles/pyth-client.js';
import { CompositeClient, COMPOSITE_CONFIGS } from './dist/oracles/composite-client.js';

const HOST = '0.0.0.0';
const PORT = 3001;
const app = express();

// Price storage
const prices = {
  BTC: { price: null, timestamp: null, source: null },
  ETH: { price: null, timestamp: null, source: null },
  SOL: { price: null, timestamp: null, source: null },
  HYPE: { price: null, timestamp: null, source: null },
  ZEC: { price: null, timestamp: null, source: null },
  TSLA: { price: null, timestamp: null, source: null },
  NVDA: { price: null, timestamp: null, source: null },
  MSTR: { price: null, timestamp: null, source: null },
  GOLD: { price: null, timestamp: null, source: null },
  SILVER: { price: null, timestamp: null, source: null },
};

// Initialize clients
const pythClient = new PythClient();
const compositeClient = new CompositeClient();

// Setup Pyth handlers
pythClient.on('price', (symbol, priceData) => {
  prices[symbol] = {
    price: priceData.price,
    timestamp: priceData.pubMs,
    source: 'Pyth Network',
  };
});

// Setup composite handlers
compositeClient.on('price', (symbol, data) => {
  if (symbol === 'HYPE' || symbol === 'ZEC') {
    if (data.composite !== null) {
      prices[symbol] = {
        price: data.composite,
        timestamp: Date.now(),
        source: `Composite (${data.count} sources)`,
      };
    }
  }
});

// Start price feeds
async function startFeeds() {
  console.log('Starting price feeds...');

  await pythClient.subscribe();
  console.log('✓ Connected to Pyth Network');

  for (const symbol of Object.keys(COMPOSITE_CONFIGS)) {
    compositeClient.startOracle(symbol, COMPOSITE_CONFIGS[symbol]);
  }
  console.log('✓ Connected to Composite Oracle');
}

// API endpoint
app.get('/api/prices', (_req, res) => {
  const now = Date.now();
  const response = {};

  for (const [symbol, data] of Object.entries(prices)) {
    response[symbol] = {
      price: data.price,
      timestamp: data.timestamp,
      source: data.source,
      age: data.timestamp ? now - data.timestamp : null,
    };
  }

  res.json(response);
});

// SSE endpoint
app.get('/api/stream', (_req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  res.write('data: {"connected": true}\n\n');

  const sendUpdate = () => {
    const now = Date.now();
    const data = {};

    for (const [symbol, priceData] of Object.entries(prices)) {
      data[symbol] = {
        price: priceData.price,
        timestamp: priceData.timestamp,
        source: priceData.source,
        age: priceData.timestamp ? now - priceData.timestamp : null,
      };
    }

    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const interval = setInterval(sendUpdate, 250);
  sendUpdate();

  _req.on('close', () => {
    clearInterval(interval);
    res.end();
  });
});

// HTML Dashboard
const HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0"/>
  <title>ORACLE PRICE FEEDS</title>
  <style>
    @import url('https://fonts.googleapis.com/css2?family=Orbitron:wght@400;500;700;900&display=swap');

    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }

    body {
      font-family: 'Orbitron', 'Courier New', monospace;
      background: #000000;
      background-image:
        linear-gradient(rgba(0, 255, 255, 0.03) 1px, transparent 1px),
        linear-gradient(90deg, rgba(0, 255, 255, 0.03) 1px, transparent 1px);
      background-size: 50px 50px;
      color: #00ffff;
      padding: 20px;
      line-height: 1.5;
      font-size: 12px;
      position: relative;
    }

    body::before {
      content: '';
      position: fixed;
      top: 0;
      left: 0;
      right: 0;
      bottom: 0;
      background: radial-gradient(circle at 50% 50%, rgba(0, 255, 255, 0.1) 0%, transparent 50%);
      pointer-events: none;
      z-index: 0;
    }

    .container {
      max-width: 1400px;
      margin: 0 auto;
      position: relative;
      z-index: 1;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 16px 20px;
      margin-bottom: 20px;
      background: transparent;
    }

    .header h1 {
      font-size: 18px;
      color: #ffffff;
      font-weight: 900;
      letter-spacing: 3px;
      text-transform: uppercase;
      margin-bottom: 4px;
    }

    .header p {
      font-size: 11px;
      color: #00ffff;
      font-weight: 400;
      text-transform: uppercase;
      letter-spacing: 1px;
    }

    .section {
      margin-bottom: 30px;
    }

    .section-title {
      font-size: 12px;
      color: #00ffff;
      font-weight: 700;
      letter-spacing: 2px;
      text-transform: uppercase;
      margin-bottom: 15px;
      padding-left: 10px;
      border-left: 3px solid #00ffff;
    }

    .grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(280px, 1fr));
      gap: 15px;
    }

    .card {
      background: rgba(0, 255, 255, 0.03);
      border: 1px solid rgba(0, 255, 255, 0.2);
      padding: 20px;
      position: relative;
      overflow: hidden;
      transition: all 0.3s ease;
    }

    .card-wide {
      grid-column: span 2;
    }

    .card:hover {
      border-color: #00ffff;
      box-shadow: 0 0 20px rgba(0, 255, 255, 0.2);
    }

    .card::before {
      content: '';
      position: absolute;
      top: 0;
      left: 0;
      right: 0;
      height: 2px;
      background: linear-gradient(90deg, transparent, #00ffff, transparent);
      opacity: 0;
      transition: opacity 0.3s ease;
    }

    .card:hover::before {
      opacity: 1;
    }

    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      margin-bottom: 12px;
    }

    .symbol {
      font-size: 14px;
      font-weight: 700;
      color: #ffffff;
      letter-spacing: 2px;
    }

    .badge {
      font-size: 9px;
      padding: 3px 8px;
      border: 1px solid;
      font-weight: 700;
      letter-spacing: 1px;
    }

    .badge.crypto {
      border-color: #00ffff;
      color: #00ffff;
    }

    .badge.stock {
      border-color: #ff8800;
      color: #ff8800;
    }

    .price {
      font-size: 32px;
      font-weight: 900;
      color: #00ffff;
      letter-spacing: 1px;
      margin: 15px 0;
      text-shadow: 0 0 10px rgba(0, 255, 255, 0.3);
    }

    .details {
      font-size: 10px;
      color: rgba(0, 255, 255, 0.6);
      line-height: 1.8;
    }

    .details-row {
      display: flex;
      justify-content: space-between;
      padding: 3px 0;
    }

    .fresh { color: #00ff00 !important; }
    .ok { color: #00ffff !important; }
    .stale { color: #ffcc00 !important; }
    .expired { color: #ff5555 !important; }
  </style>
</head>
<body>
  <div class="container">
    <div class="header">
      <div>
        <h1>ORACLE PRICE FEEDS</h1>
        <p id="meta">Real-time streaming · X1 Oracle Aggregation System</p>
      </div>
    </div>

    <div class="section">
      <div class="section-title">▶ CRYPTOCURRENCY</div>
      <div class="grid">
        <div class="card">
          <div class="card-header">
            <span class="symbol">BTC</span>
            <span class="badge crypto">CRYPTO</span>
          </div>
          <div class="price" id="price-BTC">–</div>
          <div class="details" id="sub-BTC"></div>
        </div>
        <div class="card">
          <div class="card-header">
            <span class="symbol">ETH</span>
            <span class="badge crypto">CRYPTO</span>
          </div>
          <div class="price" id="price-ETH">–</div>
          <div class="details" id="sub-ETH"></div>
        </div>
        <div class="card">
          <div class="card-header">
            <span class="symbol">SOL</span>
            <span class="badge crypto">CRYPTO</span>
          </div>
          <div class="price" id="price-SOL">–</div>
          <div class="details" id="sub-SOL"></div>
        </div>
        <div class="card">
          <div class="card-header">
            <span class="symbol">HYPE</span>
            <span class="badge crypto">CRYPTO</span>
          </div>
          <div class="price" id="price-HYPE">–</div>
          <div class="details" id="sub-HYPE"></div>
        </div>
        <div class="card">
          <div class="card-header">
            <span class="symbol">ZEC</span>
            <span class="badge crypto">CRYPTO</span>
          </div>
          <div class="price" id="price-ZEC">–</div>
          <div class="details" id="sub-ZEC"></div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">▶ COMMODITIES</div>
      <div class="grid">
        <div class="card card-wide">
          <div class="card-header">
            <span class="symbol">GOLD</span>
            <span class="badge stock">COMMODITY</span>
          </div>
          <div class="price" id="price-GOLD">–</div>
          <div class="details" id="sub-GOLD"></div>
        </div>
        <div class="card card-wide">
          <div class="card-header">
            <span class="symbol">SILVER</span>
            <span class="badge stock">COMMODITY</span>
          </div>
          <div class="price" id="price-SILVER">–</div>
          <div class="details" id="sub-SILVER"></div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">▶ EQUITIES</div>
      <div class="grid">
        <div class="card">
          <div class="card-header">
            <span class="symbol">TSLA</span>
            <span class="badge stock">STOCK</span>
          </div>
          <div class="price" id="price-TSLA">–</div>
          <div class="details" id="sub-TSLA"></div>
        </div>
        <div class="card">
          <div class="card-header">
            <span class="symbol">NVDA</span>
            <span class="badge stock">STOCK</span>
          </div>
          <div class="price" id="price-NVDA">–</div>
          <div class="details" id="sub-NVDA"></div>
        </div>
        <div class="card">
          <div class="card-header">
            <span class="symbol">MSTR</span>
            <span class="badge stock">STOCK</span>
          </div>
          <div class="price" id="price-MSTR">–</div>
          <div class="details" id="sub-MSTR"></div>
        </div>
      </div>
    </div>

  </div>

  <script>
    function formatPrice(price) {
      if (price == null || !Number.isFinite(Number(price))) return '–';
      return '$' + Number(price).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    }

    function formatAge(age) {
      if (age == null || !Number.isFinite(Number(age))) return 'n/a';
      const sec = Math.floor(age / 1000);
      if (sec < 60) return sec + 's ago';
      const min = Math.floor(sec / 60);
      return min + 'm ago';
    }

    function ageClass(age) {
      if (age == null || !Number.isFinite(Number(age))) return 'expired';
      if (age <= 2000) return 'fresh';
      if (age <= 5000) return 'ok';
      if (age <= 15000) return 'stale';
      return 'expired';
    }

    function formatTime(ts) {
      if (!ts || !Number.isFinite(Number(ts))) return null;
      const d = new Date(Number(ts));
      if (!Number.isFinite(d.getTime())) return null;
      return d.toLocaleTimeString(undefined, { hour12: false });
    }

    function updateUI(data) {
      for (const [symbol, info] of Object.entries(data)) {
        const priceEl = document.getElementById(\`price-\${symbol}\`);
        const subEl = document.getElementById(\`sub-\${symbol}\`);

        if (priceEl) {
          priceEl.textContent = formatPrice(info.price);
        }

        if (subEl) {
          const time = formatTime(info.timestamp);
          const age = formatAge(info.age);
          const ageColor = ageClass(info.age);
          subEl.innerHTML = \`
            <div class="details-row"><span>SOURCE</span><span>\${info.source || 'Unknown'}</span></div>
            <div class="details-row"><span>UPDATED</span><span>\${time || 'n/a'}</span></div>
            <div class="details-row"><span>AGE</span><span class="\${ageColor}">\${age}</span></div>
          \`;
        }
      }
    }

    // Set up SSE
    const eventSource = new EventSource('/api/stream');

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.connected) {
          console.log('SSE connected');
        } else {
          updateUI(data);
        }
      } catch (e) {
        console.error('Error parsing SSE data:', e);
      }
    };

    eventSource.onerror = (error) => {
      console.error('SSE error:', error);
      document.getElementById('meta').textContent = 'Connection error - retrying...';
    };
  </script>
</body>
</html>
`;

app.get('/', (_req, res) => res.type('html').send(HTML));

// Start server
const server = app.listen(PORT, HOST, async () => {
  console.log(`Relay Dashboard on http://${HOST}:${PORT}`);
  await startFeeds();
});

server.on('error', (err) => {
  console.error('SERVER ERROR:', err);
  process.exit(1);
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing...');
  server.close(() => process.exit(0));
});

process.on('SIGINT', () => {
  console.log('SIGINT received, closing...');
  server.close(() => process.exit(0));
});
