#!/usr/bin/env node
// app/server.js
// VT100-style oracle dashboard.
// - TOP: Stacked AGGREGATES (BTC / ETH / SOL) showing average age in ms (single number)
// - BELOW: Collapsible per-signer tables (toggle with triangle)
// - Fast refresh: 250ms

import express from "express";
import { Connection, PublicKey } from "@solana/web3.js";

/* ----------- CONFIG (must match your on-chain program) ----------- */
const PROGRAM_ID = new PublicKey("7ARBeYF5rGCanAGiRaxhVpiuZZpGXazo5UJqHMoJgkuE");
const STATE_SEED = Buffer.from("state_v2"); // PDA seed
const RPC_URL = process.env.RPC_URL || "http://127.0.0.1:8899";
const HOST = "0.0.0.0";
const PORT = 3000;
const COMMITMENT = "processed";
const POLL_MS = 250;

/* ----------- RPC & app ----------- */
const conn = new Connection(RPC_URL, COMMITMENT);
const app = express();

/* ----------- State layout decoding ----------- */
const DISC_LEN = 8;
const TRIP = { price1: 0, price2: 8, price3: 16, ts1: 24, ts2: 32, ts3: 40, SIZE: 48 };
const OFF = {
  update_authority: 0,
  btc: 32,
  eth: 32 + TRIP.SIZE,
  sol: 32 + TRIP.SIZE * 2,
  decimals: 32 + TRIP.SIZE * 3,
  bump: 32 + TRIP.SIZE * 3 + 1,
};
const PAYLOAD_MIN = 32 + TRIP.SIZE * 3 + 2;

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
    t1: readI64LE(buf, base + TRIP.ts1),
    t2: readI64LE(buf, base + TRIP.ts2),
    t3: readI64LE(buf, base + TRIP.ts3),
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

  // Ensure we have a Node Buffer so readBigUInt64LE works
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
  const decimals = readU8(payload, OFF.decimals);
  const btc = decodeTrip(payload, OFF.btc);
  const eth = decodeTrip(payload, OFF.eth);
  const sol = decodeTrip(payload, OFF.sol);

  const now = Date.now();
  const validMs = (x) => Number.isFinite(Number(x)) && Number(x) > 1e11 && Number(x) < 8.64e15; // ~275k years cap
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
  ]);

  const groups = { BTC: mkRows(btc), ETH: mkRows(eth), SOL: mkRows(sol) };

  // Aggregates from current rows (ignore nulls). Compute avg age (single number).
  const agg = {};
  for (const sym of ["BTC", "ETH", "SOL"]) {
    const rows = groups[sym];
    const prices = rows.map(r => (r.price != null ? Number(r.price) : null)).filter(Number.isFinite);
    const ages   = rows.map(r => (Number.isFinite(r.age) ? r.age : null)).filter(Number.isFinite);
    agg[sym] = {
      avg: prices.length ? (prices.reduce((a,b)=>a+b,0) / prices.length) : null,
      count: prices.length,
      ageAvg: ages.length ? Math.round(ages.reduce((a,b)=>a+b,0) / ages.length) : null
    };
  }

  return {
    ctxSlot,
    pda: pda.toBase58(),
    exists: true,
    decimals,
    groups,
    agg, // { BTC:{avg,count,ageAvg}, ... }
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

/* ----------- HTML (aggregates on TOP with single avg ms; collapsible details) ----------- */
const COL_HDRS = ["AivknD", "C3Un8Z", "129arb"];
const HTML = /* html */ `
<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>ORACLE CONSOLE</title>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <style>
    :root{--bg:#000;--green:#28ff28;--dim:#00aa00;--grid:#003600;--warn:#ffcc00;--bad:#ff5555}
    html,body{margin:0;background:var(--bg);color:var(--green);
      font-family:"IBM Plex Mono",ui-monospace,Menlo,Consolas,monospace;font-size:15px}
    .wrap{max-width:1080px;margin:20px auto;padding:12px}
    h1{margin:0 0 8px;letter-spacing:1px}
    .meta{color:var(--dim);margin-bottom:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}

    /* TOP stacked aggregates */
    .stack{display:flex;flex-direction:column;gap:10px;margin-bottom:10px}
    .card{border:none;padding:12px;background:rgba(0,255,0,0.03)}
    .card .title{color:var(--dim);font-size:13px;margin-bottom:6px;letter-spacing:1px}
    .price{font-size:36px;font-weight:800;letter-spacing:1px;line-height:1}
    .sub{color:var(--dim);font-size:12px;margin-top:4px}

    /* Collapsible area */
    .collapser{display:flex;align-items:center;gap:8px;cursor:pointer;user-select:none;margin-top:10px}
    .tri{display:inline-block;transition:transform 0.15s ease;font-weight:700;}
    .tri.open{transform:rotate(90deg)}
    .pane{overflow:hidden;transition:max-height 0.2s ease;border-top:1px solid var(--grid);margin-top:8px}
    .pane.hide{max-height:0}
    .pane.show{max-height:2000px}

    table{border-collapse:collapse;width:100%;table-layout:fixed;border:1px solid var(--grid)}
    th,td{border-bottom:1px dashed var(--grid);padding:6px 8px;text-align:left;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}
    th{color:var(--dim)}
    colgroup col.c1{width:90px} colgroup col.c2{width:120px} colgroup col.c3{width:260px}
    colgroup col.c4{width:110px} colgroup col.c5{width:120px}
    .fresh{color:var(--green)} .ok{color:var(--green)} .stale{color:var(--warn)} .expired{color:var(--bad)} .dim{color:var(--dim)}
    .group{margin-top:14px}
    .badge{border:1px solid var(--grid);padding:2px 6px;border-radius:2px}
  </style>
</head>
<body>
  <div class="wrap">
    <h1>∙ ORACLE ∙ CONSOLE ∙</h1>
    <div id="meta" class="meta"></div>

    <!-- STACKED AGGREGATES (average of current signer values + single avg ms number) -->
    <div class="stack" id="stack" style="display:none">
      <div class="card">
        <div class="title">BTC · aggregated average</div>
        <div class="price" id="agg-btc">–</div>
        <div class="sub" id="sub-btc"></div>
      </div>
      <div class="card">
        <div class="title">ETH · aggregated average</div>
        <div class="price" id="agg-eth">–</div>
        <div class="sub" id="sub-eth"></div>
      </div>
      <div class="card">
        <div class="title">SOL · aggregated average</div>
        <div class="price" id="agg-sol">–</div>
        <div class="sub" id="sub-sol"></div>
      </div>
    </div>

    <!-- Collapser -->
    <div class="collapser" id="toggle">
      <span class="tri" id="tri">▶</span>
      <span>Show per-signer details</span>
    </div>

    <!-- Collapsible per-signer pane -->
    <div class="pane hide" id="pane">
      <div id="groups"></div>
    </div>
  </div>

  <script>
    const COLS = ${JSON.stringify(COL_HDRS)};
    const POLL_MS = ${POLL_MS};

    function cls(age){
      if (age == null || !Number.isFinite(Number(age))) return "dim";
      const a = Number(age);
      if (a <= 2000) return "fresh";
      if (a <= 5000) return "ok";
      if (a <= 15000) return "stale";
      return "expired";
    }
    function row(label, arr){
      return \`
      <div class="group">
        <div class="meta"><span class="badge">\${label}</span></div>
        <table>
          <colgroup><col class="c1"/><col class="c2"/><col class="c3"/><col class="c4"/><col class="c5"/></colgroup>
          <thead><tr><th>SLOT</th><th>SIGNER</th><th>TIMESTAMP</th><th>AGE(ms)</th><th>PRICE</th></tr></thead>
          <tbody>
            \${(arr||[]).map((c,i)=>\`<tr>
              <td>\${i+1}</td>
              <td>\${COLS[i] ?? ("SIG"+(i+1))}</td>
              <td>\${c.ts || "<span class='dim'>n/a</span>"}</td>
              <td class="\${cls(c.age)}">\${(c.age==null||!Number.isFinite(Number(c.age)))?"n/a":Number(c.age)}</td>
              <td>\${(c.price ?? null) !== null ? c.price : "<span class='dim'>n/a</span>"}</td>
            </tr>\`).join("")}
          </tbody>
        </table>
      </div>\`;
    }
    function fmt2(x){ return x==null? "–" : Number(x).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2}); }
    function fmtMs(x){ return x==null? "–" : (x + " ms"); }

    // Collapser behavior
    const pane = document.getElementById('pane');
    const tri = document.getElementById('tri');
    const toggle = document.getElementById('toggle');
    let open = false;
    function renderToggle(){
      tri.classList.toggle("open", open);
      tri.textContent = "▶";
      pane.classList.toggle("show", open);
      pane.classList.toggle("hide", !open);
      toggle.querySelector('span:last-child').textContent = open ? "Hide per-signer details" : "Show per-signer details";
    }
    toggle.addEventListener('click', ()=>{ open = !open; renderToggle(); });

    async function tick(){
      try{
        const r = await fetch('/api/state',{ cache:'no-store' });
        const d = await r.json();
        const meta = document.getElementById('meta');
        const stack = document.getElementById('stack');
        const groups = document.getElementById('groups');
        const oB = document.getElementById('agg-btc');
        const oE = document.getElementById('agg-eth');
        const oS = document.getElementById('agg-sol');
        const sB = document.getElementById('sub-btc');
        const sE = document.getElementById('sub-eth');
        const sS = document.getElementById('sub-sol');

        if(!d.exists){
          meta.textContent = d.message || "state not initialized";
          groups.innerHTML = "";
          stack.style.display = "none";
          return;
        }

        meta.textContent = \`slot \${d.ctxSlot} · pda \${d.pda} · dec \${d.decimals}\`;

        // TOP aggregates: show avg price and single number in ms (average age)
        const B = d.agg?.BTC, E = d.agg?.ETH, S = d.agg?.SOL;
        oB.textContent = fmt2(B?.avg ?? null);
        oE.textContent = fmt2(E?.avg ?? null);
        oS.textContent = fmt2(S?.avg ?? null);

        sB.textContent = (B && B.count) ? fmtMs(B.ageAvg) : "–";
        sE.textContent = (E && E.count) ? fmtMs(E.ageAvg) : "–";
        sS.textContent = (S && S.count) ? fmtMs(S.ageAvg) : "–";

        stack.style.display = (B?.count || E?.count || S?.count) ? "block" : "none";

        // Collapsible per-signer tables
        groups.innerHTML = row("BTC", d.groups.BTC) + row("ETH", d.groups.ETH) + row("SOL", d.groups.SOL);
      }catch(e){
        document.getElementById('meta').textContent = "error: " + (e.message || e);
        document.getElementById('stack').style.display = "none";
      }
    }

    renderToggle();
    tick(); setInterval(tick, ${POLL_MS});
  </script>
</body>
</html>
`;

/* ----------- routes ----------- */
app.get("/", (_req, res) => res.type("html").send(HTML));

/* ----------- start ----------- */
app.listen(PORT, HOST, () => {
  console.log(`Server on http://${HOST}:${PORT} (RPC=${RPC_URL}, commitment=${COMMITMENT}, poll=${POLL_MS}ms)`);
});

/* ----------- process-level guards ----------- */
process.on("unhandledRejection", (err) => {
  console.error("UNHANDLED REJECTION:", err);
});
process.on("uncaughtException", (err) => {
  console.error("UNCAUGHT EXCEPTION:", err);
});

