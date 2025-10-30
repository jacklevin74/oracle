#!/usr/bin/env node
// app/read.js — multi-asset reader with fresh-average
// Prints per-signer BTC/ETH/SOL + an average of non-stale signers.
//
// Env:
//   ANCHOR_PROVIDER_URL (default http://127.0.0.1:8899)

import { Connection, PublicKey } from "@solana/web3.js";
import path from "path";
import * as url from "url";

/* ------------------ CONFIG (must match program) ------------------ */
const PROGRAM_ID = new PublicKey("7ARBeYF5rGCanAGiRaxhVpiuZZpGXazo5UJqHMoJgkuE");
const STATE_SEED = Buffer.from("state_v2");   // NEW seed
const DECIMALS = 6;                           // on-chain fixed-point places
const POLL_MS = 1000;                         // read cadence
const STALE_MS = 5000;                        // consider signer fresh if age ≤ 5s

/* ------------------ helpers ------------------ */
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
const rpc = process.env.ANCHOR_PROVIDER_URL || "http://127.0.0.1:8899";
const conn = new Connection(rpc, "confirmed");

// Anchor account discriminator is 8 bytes at the start of any #[account] struct
const DISC_LEN = 8;

// layout sizes (must match your Rust State struct exactly)
// State {
//   update_authority: [32],
//   btc: Triplet, eth: Triplet, sol: Triplet (each Triplet = price1/2/3 (i64*3), ts1/2/3 (i64*3) = 48 bytes),
//   decimals: u8,
//   bump: u8,
// }
const TRIP_SIZE = 48;
const OFF = {
  update_authority: 0,                 // 32
  btc:               32,               // +48
  eth:               32 + TRIP_SIZE,   // +48
  sol:               32 + TRIP_SIZE*2, // +48
  decimals:          32 + TRIP_SIZE*3, // +1
  bump:              32 + TRIP_SIZE*3 + 1, // +1
};
const PAYLOAD_MIN = 32 + TRIP_SIZE*3 + 2; // 178

function readI64LE(buf, o) {
  const u = buf.readBigUInt64LE(o);
  return u > 0x7fffffffffffffffn ? Number(u - 0x10000000000000000n) : Number(u);
}
function readU8(buf, o) { return buf.readUInt8(o); }
function fmtPrice(i64, d) { return (Number(i64) / 10**d).toFixed(6); } // keep 6dp here, print 2dp below if you prefer
function fmt2(i64, d) { return (Number(i64) / 10**d).toFixed(2); }     // for aggregate or cleaner view
function ageMs(ts) { return Date.now() - Number(ts); }
function fresh(ms) {
  if (ms <= 2_000) return "fresh";
  if (ms <= 5_000) return "ok";
  if (ms <= 15_000) return "stale";
  return "expired";
}

function decodeTrip(buf, base) {
  return {
    p1: readI64LE(buf, base +  0),
    p2: readI64LE(buf, base +  8),
    p3: readI64LE(buf, base + 16),
    t1: readI64LE(buf, base + 24),
    t2: readI64LE(buf, base + 32),
    t3: readI64LE(buf, base + 40),
  };
}

function decodeState(data) {
  if (!data || data.length < DISC_LEN + PAYLOAD_MIN) {
    throw new Error(`State too small: have ${data?.length ?? 0}, need >= ${DISC_LEN + PAYLOAD_MIN}`);
  }
  const payload = data.subarray(DISC_LEN);
  const decimals = readU8(payload, OFF.decimals);
  const btc = decodeTrip(payload, OFF.btc);
  const eth = decodeTrip(payload, OFF.eth);
  const sol = decodeTrip(payload, OFF.sol);
  return { decimals, btc, eth, sol };
}

function printSignerLine(asset, idx, priceI64, ts, d) {
  if (!priceI64 || !ts) {
    console.log(`${asset}[${idx}]: (no value)`);
    return { included: false };
  }
  const iso = new Date(Number(ts)).toISOString();
  const a = ageMs(ts);
  const tag = fresh(a);
  // per-signer print at 6dp (or change to fmt2 for 2dp)
  console.log(`${asset}[${idx}]: $${fmtPrice(priceI64, d)} | ts=${iso} | age=${a}ms | ${tag}`);
  return { included: a <= STALE_MS, priceI64 };
}

function avgI64(i64s) {
  if (i64s.length === 0) return null;
  const sum = i64s.reduce((acc,v)=>acc+v, 0);
  return Math.round(sum / i64s.length);
}

/* ------------------ main loop ------------------ */
(async () => {
  const [statePda] = PublicKey.findProgramAddressSync([STATE_SEED], PROGRAM_ID);
  console.log(`Reading PDA: ${statePda.toBase58()} (program ${PROGRAM_ID.toBase58()}) every ${POLL_MS} ms…`);

  const tick = async () => {
    try {
      const info = await conn.getAccountInfo(statePda);
      if (!info) {
        console.log("State account not found yet.");
        return;
      }
      const { decimals, btc, eth, sol } = decodeState(info.data);
      const d = typeof decimals === "number" ? decimals : DECIMALS;

      // BTC
      const b1 = printSignerLine("BTC", 1, btc.p1, btc.t1, d);
      const b2 = printSignerLine("BTC", 2, btc.p2, btc.t2, d);
      const b3 = printSignerLine("BTC", 3, btc.p3, btc.t3, d);
      const bFresh = [b1,b2,b3].filter(x=>x.included).map(x=>x.priceI64);
      if (bFresh.length) {
        const avg = avgI64(bFresh);
        console.log(`BTC[AVG]: $${fmt2(avg, d)} (from ${bFresh.length} fresh signer${bFresh.length>1?"s":""})`);
      } else {
        console.log(`BTC[AVG]: (no fresh values ≤ ${STALE_MS}ms)`);
      }

      // ETH
      const e1 = printSignerLine("ETH", 1, eth.p1, eth.t1, d);
      const e2 = printSignerLine("ETH", 2, eth.p2, eth.t2, d);
      const e3 = printSignerLine("ETH", 3, eth.p3, eth.t3, d);
      const eFresh = [e1,e2,e3].filter(x=>x.included).map(x=>x.priceI64);
      if (eFresh.length) {
        const avg = avgI64(eFresh);
        console.log(`ETH[AVG]: $${fmt2(avg, d)} (from ${eFresh.length} fresh signer${eFresh.length>1?"s":""})`);
      } else {
        console.log(`ETH[AVG]: (no fresh values ≤ ${STALE_MS}ms)`);
      }

      // SOL
      const s1 = printSignerLine("SOL", 1, sol.p1, sol.t1, d);
      const s2 = printSignerLine("SOL", 2, sol.p2, sol.t2, d);
      const s3 = printSignerLine("SOL", 3, sol.p3, sol.t3, d);
      const sFresh = [s1,s2,s3].filter(x=>x.included).map(x=>x.priceI64);
      if (sFresh.length) {
        const avg = avgI64(sFresh);
        console.log(`SOL[AVG]: $${fmt2(avg, d)} (from ${sFresh.length} fresh signer${sFresh.length>1?"s":""})`);
      } else {
        console.log(`SOL[AVG]: (no fresh values ≤ ${STALE_MS}ms)`);
      }

      console.log("—");
    } catch (e) {
      console.error("read error:", e?.message ?? e);
    }
  };

  await tick();
  const handle = setInterval(tick, POLL_MS);
  process.on("SIGINT", () => { clearInterval(handle); console.log("\nStopped."); process.exit(0); });
})();

