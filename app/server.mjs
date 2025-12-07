#!/usr/bin/env node
// app/server.mjs
// VT100-style oracle dashboard with Server-Sent Events support
// - TOP: Stacked AGGREGATES (BTC / ETH / SOL) showing average age in ms + latest local time
// - BELOW: Collapsible per-signer tables (toggle with triangle), now with LOCAL time column
// - Real-time updates via SSE: 250ms

import express from "express";
import { Connection, PublicKey } from "@solana/web3.js";

/* ----------- CONFIG (must match your on-chain program) ----------- */
// TESTING: Using test program with 8-asset support (crypto + stocks)
// PRODUCTION: LuS6XnQ3qNXqNQvAJ3akXnEJRBv9XNoUricjMgTyCxX
const PROGRAM_ID = new PublicKey("CcgTMiYkgVfz7cAGkD6835BqfycG5N5Y4aPPHYW1EvKx");
const STATE_SEED = Buffer.from("state_v2"); // PDA seed
const RPC_URL = process.env.RPC_URL || "https://rpc.mainnet.x1.xyz";
const HOST = "0.0.0.0";
const PORT = 3000;
const COMMITMENT = "processed";
const POLL_MS = 250;

/* ----------- RPC & app ----------- */
const conn = new Connection(RPC_URL, COMMITMENT);
const app = express();

/* ----------- State layout decoding ----------- */
const DISC_LEN = 8;
const TRIP = { price1: 0, price2: 8, price3: 16, price4: 24, ts1: 32, ts2: 40, ts3: 48, ts4: 56, SIZE: 64 };
const OFF = {
  update_authority: 0,
  btc: 32,
  eth: 32 + TRIP.SIZE,
  sol: 32 + TRIP.SIZE * 2,
  hype: 32 + TRIP.SIZE * 3,
  zec: 32 + TRIP.SIZE * 4,
  tsla: 32 + TRIP.SIZE * 5,
  nvda: 32 + TRIP.SIZE * 6,
  mstr: 32 + TRIP.SIZE * 7,
  decimals: 32 + TRIP.SIZE * 8,
  bump: 32 + TRIP.SIZE * 8 + 1,
};
const PAYLOAD_MIN = 32 + TRIP.SIZE * 8 + 2;

function readI64LE(b, o) {
  const buf = Buffer.isBuffer(b) ? b : Buffer.from(b);
  const u = buf.readBigUInt64LE(o);
  return u > 0x7fffffffffffffffn ? Number(u - 0x10000000000000000n) : Number(u);
}
function readU8(b, o) {
  const buf = Buffer.isBuffer(b) ? b : Buffer.from(b);
  return buf.readUInt8(o);
}
function decodeTrip(buf, base) {
  return {
    p1: readI64LE(buf, base + TRIP.price1),
    p2: readI64LE(buf, base + TRIP.price2),
    p3: readI64LE(buf, base + TRIP.price3),
    p4: readI64LE(buf, base + TRIP.price4),
    t1: readI64LE(buf, base + TRIP.ts1),
    t2: readI64LE(buf, base + TRIP.ts2),
    t3: readI64LE(buf, base + TRIP.ts3),
    t4: readI64LE(buf, base + TRIP.ts4),
  };
}
function toHuman2(i64, d) {
  if (i64 == null) return null;
  const v = Number(i64) / 10 ** d;
  return Number.isFinite(v) ? v.toFixed(2) : null;
}

/* ----------- Core read ----------- */
async function readOracleState() {
  const [pda] = PublicKey.findProgramAddressSync([STATE_SEED], PROGRAM_ID);
  const res = await conn.getAccountInfoAndContext(pda, COMMITMENT);
  const ctxSlot = res?.context?.slot ?? null;
  const info = res?.value;

  if (!info) {
    return {
      ctxSlot,
      pda: pda.toBase58(),
      exists: false,
      message: "State not initialized (state_v2).",
    };
  }

  const data = Buffer.isBuffer(info.data) ? info.data : Buffer.from(info.data ?? []);
  if (!data || data.length < DISC_LEN + PAYLOAD_MIN) {
    return {
      ctxSlot,
      pda: pda.toBase58(),
      exists: false,
      message: `State too small: ${data?.length ?? 0} < ${DISC_LEN + PAYLOAD_MIN}`,
    };
  }

  const payload = data.subarray(DISC_LEN);
  // HARDCODED: Using 8 decimals for test program (on-chain state has 6)
  const decimals = 8;
  const btc = decodeTrip(payload, OFF.btc);
  const eth = decodeTrip(payload, OFF.eth);
  const sol = decodeTrip(payload, OFF.sol);
  const hype = decodeTrip(payload, OFF.hype);
  const zec = decodeTrip(payload, OFF.zec);
  const tsla = decodeTrip(payload, OFF.tsla);
  const nvda = decodeTrip(payload, OFF.nvda);
  const mstr = decodeTrip(payload, OFF.mstr);

  const now = Date.now();
  const validMs = (x) => Number.isFinite(Number(x)) && Number(x) > 1e11 && Number(x) < 8.64e15;
  const safeIso = (ms) => {
    if (!validMs(ms)) return null;
    const d = new Date(Number(ms));
    return Number.isFinite(d.getTime()) ? d.toISOString() : null;
  };
  const ageOf = (ms) => (validMs(ms) ? now - Number(ms) : null);

  const mkRows = (t) => ([
    { price: toHuman2(t.p1, decimals), ts: safeIso(t.t1), age: ageOf(t.t1) },
    { price: toHuman2(t.p2, decimals), ts: safeIso(t.t2), age: ageOf(t.t2) },
    { price: toHuman2(t.p3, decimals), ts: safeIso(t.t3), age: ageOf(t.t3) },
    { price: toHuman2(t.p4, decimals), ts: safeIso(t.t4), age: ageOf(t.t4) },
  ]);

  const groups = {
    BTC: mkRows(btc),
    ETH: mkRows(eth),
    SOL: mkRows(sol),
    HYPE: mkRows(hype),
    ZEC: mkRows(zec),
    TSLA: mkRows(tsla),
    NVDA: mkRows(nvda),
    MSTR: mkRows(mstr)
  };

  // Aggregates from current rows (ignore nulls, exclude stale and outliers)
  const agg = {};
  const latestTs = {};
  const STALE_THRESHOLD_MS = 15000; // 15 seconds
  const OUTLIER_THRESHOLD = 0.10; // 10%

  for (const sym of ["BTC", "ETH", "SOL", "HYPE", "ZEC", "TSLA", "NVDA", "MSTR"]) {
    const rows = groups[sym];

    // Filter out zero/null prices and stale data (older than 15s)
    const validRows = rows
      .map((r, idx) => ({ ...r, idx, priceNum: Number(r.price) }))
      .filter(r => {
        if (!Number.isFinite(r.priceNum)) return false;
        if (r.priceNum === 0) return false; // exclude zero prices
        if (!Number.isFinite(r.age)) return false;
        if (r.age > STALE_THRESHOLD_MS) return false; // exclude stale data
        return true;
      });

    if (validRows.length === 0) {
      agg[sym] = { avg: null, count: 0, ageAvg: null };
      latestTs[sym] = null;
      continue;
    }

    // Calculate median to detect outliers
    const sortedPrices = validRows.map(r => r.priceNum).sort((a, b) => a - b);
    const median = sortedPrices[Math.floor(sortedPrices.length / 2)];

    // Exclude outliers (more than 10% away from median)
    const filteredRows = validRows.filter(r => {
      const deviation = Math.abs(r.priceNum - median) / median;
      return deviation <= OUTLIER_THRESHOLD;
    });

    if (filteredRows.length === 0) {
      agg[sym] = { avg: null, count: 0, ageAvg: null };
      latestTs[sym] = null;
      continue;
    }

    const prices = filteredRows.map(r => r.priceNum);
    const ages = filteredRows.map(r => r.age);
    const tsVals = filteredRows.map(r => (r.ts ? Date.parse(r.ts) : null)).filter((x)=>Number.isFinite(x));

    agg[sym] = {
      avg: prices.reduce((a,b)=>a+b,0) / prices.length,
      count: filteredRows.length,
      ageAvg: ages.length ? Math.round(ages.reduce((a,b)=>a+b,0) / ages.length) : null
    };
    latestTs[sym] = tsVals.length ? Math.max(...tsVals) : null; // store ms epoch
  }

  return {
    ctxSlot,
    pda: pda.toBase58(),
    exists: true,
    decimals,
    groups,
    agg,        // { BTC:{avg,count,ageAvg}, ... }
    latestTs,   // { BTC: <ms|null>, ETH:..., SOL:... }
  };
}

/* ----------- API ----------- */
app.get("/api/state", async (_req, res) => {
  try {
    res.json(await readOracleState());
  } catch (e) {
    res.status(500).json({ error: e?.message ?? String(e) });
  }
});

/* ----------- SSE endpoint for real-time streaming ----------- */
app.get("/api/stream", (req, res) => {
  // Set headers for SSE
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('Access-Control-Allow-Origin', '*');

  // Send initial connection event
  res.write('data: {"connected": true}\n\n');

  // Function to send updates
  const sendUpdate = async () => {
    try {
      const state = await readOracleState();
      res.write(`data: ${JSON.stringify(state)}\n\n`);
    } catch (e) {
      console.error("SSE error:", e);
      res.write(`data: ${JSON.stringify({ error: e?.message ?? String(e) })}\n\n`);
    }
  };

  // Send updates every POLL_MS
  const interval = setInterval(sendUpdate, POLL_MS);

  // Send first update immediately
  sendUpdate();

  // Clean up on client disconnect
  req.on('close', () => {
    clearInterval(interval);
    res.end();
  });
});

/* ----------- HTML with Orbitron UI ----------- */
const SIGNER_NAMES = ["CGLezz", "FprJrT", "7FZvQQ", "55MyuY"]; // mn_relay1, mn_relay2, mn_relay3, reserved
const HTML = /* html */ `
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
      cursor: pointer;
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

    .signer-details {
      margin-top: 15px;
      border-top: 1px solid rgba(0, 255, 255, 0.2);
      padding-top: 15px;
      max-height: 0;
      overflow: hidden;
      opacity: 0;
      transition: all 0.3s ease;
    }

    .signer-details.expanded {
      max-height: 500px;
      opacity: 1;
    }

    .signer-table {
      width: 100%;
      border-collapse: collapse;
      font-size: 9px;
    }

    .signer-table th {
      text-align: left;
      padding: 6px 4px;
      color: rgba(0, 255, 255, 0.6);
      font-weight: 700;
      border-bottom: 1px solid rgba(0, 255, 255, 0.2);
    }

    .signer-table td {
      padding: 6px 4px;
      border-bottom: 1px solid rgba(0, 255, 255, 0.1);
      color: #00ffff;
    }

    .signer-table tr:last-child td {
      border-bottom: none;
    }

    .fresh { color: #00ff00 !important; }
    .ok { color: #00ffff !important; }
    .stale { color: #ffcc00 !important; }
    .expired { color: #ff5555 !important; }
    .dim { color: rgba(0, 255, 255, 0.4) !important; }
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
        <div class="card" onclick="toggleCard('BTC')">
          <div class="card-header">
            <span class="symbol">BTC</span>
            <span class="badge crypto">CRYPTO</span>
          </div>
          <div class="price" id="price-BTC">–</div>
          <div class="details" id="sub-BTC"></div>
          <div class="signer-details" id="signers-BTC"></div>
        </div>
        <div class="card" onclick="toggleCard('ETH')">
          <div class="card-header">
            <span class="symbol">ETH</span>
            <span class="badge crypto">CRYPTO</span>
          </div>
          <div class="price" id="price-ETH">–</div>
          <div class="details" id="sub-ETH"></div>
          <div class="signer-details" id="signers-ETH"></div>
        </div>
        <div class="card" onclick="toggleCard('SOL')">
          <div class="card-header">
            <span class="symbol">SOL</span>
            <span class="badge crypto">CRYPTO</span>
          </div>
          <div class="price" id="price-SOL">–</div>
          <div class="details" id="sub-SOL"></div>
          <div class="signer-details" id="signers-SOL"></div>
        </div>
        <div class="card" onclick="toggleCard('HYPE')">
          <div class="card-header">
            <span class="symbol">HYPE</span>
            <span class="badge crypto">CRYPTO</span>
          </div>
          <div class="price" id="price-HYPE">–</div>
          <div class="details" id="sub-HYPE"></div>
          <div class="signer-details" id="signers-HYPE"></div>
        </div>
        <div class="card" onclick="toggleCard('ZEC')">
          <div class="card-header">
            <span class="symbol">ZEC</span>
            <span class="badge crypto">CRYPTO</span>
          </div>
          <div class="price" id="price-ZEC">–</div>
          <div class="details" id="sub-ZEC"></div>
          <div class="signer-details" id="signers-ZEC"></div>
        </div>
      </div>
    </div>

    <div class="section">
      <div class="section-title">▶ EQUITIES</div>
      <div class="grid">
        <div class="card" onclick="toggleCard('TSLA')">
          <div class="card-header">
            <span class="symbol">TSLA</span>
            <span class="badge stock">STOCK</span>
          </div>
          <div class="price" id="price-TSLA">–</div>
          <div class="details" id="sub-TSLA"></div>
          <div class="signer-details" id="signers-TSLA"></div>
        </div>
        <div class="card" onclick="toggleCard('NVDA')">
          <div class="card-header">
            <span class="symbol">NVDA</span>
            <span class="badge stock">STOCK</span>
          </div>
          <div class="price" id="price-NVDA">–</div>
          <div class="details" id="sub-NVDA"></div>
          <div class="signer-details" id="signers-NVDA"></div>
        </div>
        <div class="card" onclick="toggleCard('MSTR')">
          <div class="card-header">
            <span class="symbol">MSTR</span>
            <span class="badge stock">STOCK</span>
          </div>
          <div class="price" id="price-MSTR">–</div>
          <div class="details" id="sub-MSTR"></div>
          <div class="signer-details" id="signers-MSTR"></div>
        </div>
      </div>
    </div>
  </div>

  <script>
    const SIGNER_NAMES = ${JSON.stringify(SIGNER_NAMES)};
    const expandedCards = new Set();

    function toggleCard(symbol) {
      const el = document.getElementById('signers-' + symbol);
      if (!el) return;

      if (expandedCards.has(symbol)) {
        expandedCards.delete(symbol);
        el.classList.remove('expanded');
      } else {
        expandedCards.add(symbol);
        el.classList.add('expanded');
      }
    }

    function formatPrice(price) {
      if (price == null || !Number.isFinite(Number(price))) return '–';
      return '$' + Number(price).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2
      });
    }

    function formatTime(ts) {
      if (!ts) return null;
      const ms = Date.parse(ts);
      if (!Number.isFinite(ms)) return null;
      const d = new Date(ms);
      if (!Number.isFinite(d.getTime())) return null;
      return d.toLocaleTimeString(undefined, { hour12: false });
    }

    function ageClass(age) {
      if (age == null || !Number.isFinite(Number(age))) return 'dim';
      const a = Number(age);
      if (a <= 2000) return 'fresh';
      if (a <= 5000) return 'ok';
      if (a <= 15000) return 'stale';
      return 'expired';
    }

    function formatMs(x) {
      return x == null ? '–' : (x + ' ms');
    }

    function updateUI(data) {
      if (!data.exists) {
        document.getElementById('meta').textContent = data.message || 'State not initialized';
        return;
      }

      document.getElementById('meta').textContent =
        \`slot \${data.ctxSlot} · pda \${data.pda} · dec \${data.decimals} · [SSE]\`;

      const symbols = ['BTC', 'ETH', 'SOL', 'HYPE', 'ZEC', 'TSLA', 'NVDA', 'MSTR'];

      for (const sym of symbols) {
        const priceEl = document.getElementById(\`price-\${sym}\`);
        const subEl = document.getElementById(\`sub-\${sym}\`);
        const signersEl = document.getElementById(\`signers-\${sym}\`);

        const aggData = data.agg?.[sym];
        const latestTsMs = data.latestTs?.[sym];
        const rows = data.groups?.[sym] || [];

        // Update aggregated price
        if (priceEl) {
          priceEl.textContent = formatPrice(aggData?.avg ?? null);
        }

        // Update summary details
        if (subEl) {
          const localTime = latestTsMs ? formatTime(new Date(latestTsMs).toISOString()) : null;
          const ageAvg = aggData?.ageAvg;
          const ageColor = ageClass(ageAvg);

          subEl.innerHTML = \`
            <div class="details-row"><span>COUNT</span><span>\${aggData?.count || 0} sources</span></div>
            <div class="details-row"><span>AVG AGE</span><span class="\${ageColor}">\${formatMs(ageAvg)}</span></div>
            <div class="details-row"><span>UPDATED</span><span>\${localTime || 'n/a'}</span></div>
          \`;
        }

        // Update signer details table
        if (signersEl) {
          const wasExpanded = expandedCards.has(sym);

          const tableHtml = \`
            <table class="signer-table">
              <thead>
                <tr>
                  <th>SIGNER</th>
                  <th>PRICE</th>
                  <th>TIME</th>
                  <th>AGE</th>
                </tr>
              </thead>
              <tbody>
                \${rows.map((row, idx) => {
                  const localTime = formatTime(row.ts);
                  const ageColor = ageClass(row.age);
                  const price = row.price !== null ? '$' + row.price : '<span class="dim">n/a</span>';
                  const age = row.age !== null && Number.isFinite(row.age) ? Math.round(row.age) + 'ms' : '<span class="dim">n/a</span>';

                  return \`<tr>
                    <td>\${SIGNER_NAMES[idx] || 'SIG' + (idx + 1)}</td>
                    <td>\${price}</td>
                    <td>\${localTime || '<span class="dim">n/a</span>'}</td>
                    <td class="\${ageColor}">\${age}</td>
                  </tr>\`;
                }).join('')}
              </tbody>
            </table>
          \`;

          signersEl.innerHTML = tableHtml;

          // Restore expanded state
          if (wasExpanded) {
            signersEl.classList.add('expanded');
          }
        }
      }
    }

    // Set up Server-Sent Events connection
    const eventSource = new EventSource('/api/stream');

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        if (data.connected) {
          console.log('SSE connected');
        } else if (data.error) {
          document.getElementById('meta').textContent = 'error: ' + data.error;
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
      // EventSource automatically reconnects
    };
  </script>
</body>
</html>
`;

/* ----------- routes ----------- */
app.get("/", (_req, res) => res.type("html").send(HTML));

/* ----------- start ----------- */
const server = app.listen(PORT, HOST, () => {
  console.log(`Server on http://${HOST}:${PORT} (RPC=${RPC_URL}, commitment=${COMMITMENT}, poll=${POLL_MS}ms)`);
});

server.on('error', (err) => {
  console.error("SERVER ERROR:", err);
  process.exit(1);
});

/* ----------- process-level guards ----------- */
process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION:", err);
  // Don't exit, just log
});
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
  // Don't exit, just log
});

process.on('SIGTERM', () => {
  console.log('SIGTERM received, closing server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});

process.on('SIGINT', () => {
  console.log('SIGINT received, closing server...');
  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
