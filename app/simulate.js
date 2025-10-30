#!/usr/bin/env node
// Continuous BTC oracle simulator: rotates writes to param1/2/3.
// Usage: node app/simulate.js
// Env:   ANCHOR_PROVIDER_URL, ANCHOR_WALLET

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  sendAndConfirmTransaction,
} from "@solana/web3.js";
import fs from "fs";
import path from "path";
import * as url from "url";

/* ------------------ CONFIG ------------------ */
const PROGRAM_ID = new PublicKey("6EqUbMtdbZHd6WBJhYYrf7UQt47GT5iSJtPHQYgVsDiV");
const STATE_SEED = Buffer.from("state");
const DECIMALS = 6;

// Instruction discriminators (from your IDL)
const DISC = {
  initialize: Uint8Array.from([175, 175, 109, 31, 13, 152, 155, 237]),
  set_price: Uint8Array.from([16, 19, 182, 8, 149, 83, 72, 181]),
};

const TICK_MS = 200;       // cadence
const TARGET = 68_000;     // mean-reversion center
const VOL = 35;            // per-tick stochastic volatility ($)
const K_REVERT = 0.04;     // pull-back strength toward TARGET (0..1)

/* -------------- small helpers -------------- */
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
function readKeypair(jsonPath) {
  const secret = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}
function u8ToBuf(n) { const b = Buffer.alloc(1); b.writeUInt8(n); return b; }
function i64ToBuf(n) {
  let x = BigInt(n);
  if (x < 0n) x = (1n << 64n) + x; // two's complement
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(x);
  return b;
}
function pubkeyToBuf(pk) { return Buffer.from(pk.toBytes()); }
function toFixedI64(num, decimals) { return Math.round(num * 10 ** decimals); }
function randn() {
  // Box-Muller
  let u = 0, v = 0;
  while (!u) u = Math.random();
  while (!v) v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

/* ----------- instruction builders ----------- */
function ixInitialize(updateAuthority, programId, statePda) {
  const data = Buffer.concat([
    Buffer.from(DISC.initialize),     // 8
    pubkeyToBuf(updateAuthority),     // 32
  ]);
  const keys = [
    { pubkey: statePda, isSigner: false, isWritable: true },
    { pubkey: updateAuthority, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  return { programId, keys, data };
}

function ixSetPrice(index, priceI64, clientTsMsI64, programId, statePda, signer) {
  const data = Buffer.concat([
    Buffer.from(DISC.set_price),  // 8
    u8ToBuf(index),               // u8
    i64ToBuf(priceI64),           // i64 (little-endian)
    i64ToBuf(clientTsMsI64),      // i64 (little-endian)
  ]);
  const keys = [
    { pubkey: statePda, isSigner: false, isWritable: true },
    { pubkey: signer,   isSigner: true,  isWritable: false },
  ];
  return { programId, keys, data };
}

/* -------------------- main -------------------- */
(async () => {
  const rpc = process.env.ANCHOR_PROVIDER_URL || "http://127.0.0.1:8899";
  const walletPath =
    process.env.ANCHOR_WALLET || path.join(process.env.HOME, ".config/solana/id.json");
  const payer = readKeypair(walletPath);
  const connection = new Connection(rpc, "confirmed");

  const [statePda] = PublicKey.findProgramAddressSync([STATE_SEED], PROGRAM_ID);

  // Initialize if missing
  const info = await connection.getAccountInfo(statePda);
  if (!info) {
    console.log("Initializing state PDA…");
    const tx = new Transaction().add(ixInitialize(payer.publicKey, PROGRAM_ID, statePda));
    const sig = await sendAndConfirmTransaction(connection, tx, [payer], { skipPreflight: false });
    console.log("init tx:", sig);
  }

  console.log(
    `Running continuous updates every ${TICK_MS}ms → rotating param1→2→3… (Ctrl+C to stop)`
  );

  // Start near target
  let price = TARGET;

  // Rotate through 1,2,3
  let index = 1;

  const loop = async () => {
    try {
      // Mean-reverting random walk
      const shock = randn() * VOL;
      const drift = (TARGET - price) * K_REVERT;
      price = Math.max(1000, price + drift + shock);

      const clientTsMs = Date.now();
      const priceI64 = toFixedI64(price, DECIMALS);

      const ix = ixSetPrice(index, priceI64, clientTsMs, PROGRAM_ID, statePda, payer.publicKey);
      const tx = new Transaction().add(ix);
      const sig = await sendAndConfirmTransaction(connection, tx, [payer], { skipPreflight: false });

      console.log(
        `✔ tx ${sig} | param${index}: $${price.toFixed(DECIMALS)} | ts=${new Date(
          clientTsMs
        ).toISOString()}`
      );

      // next slot
      index = index === 3 ? 1 : index + 1;
    } catch (e) {
      console.error("tick error:", e?.message ?? e);
    }
  };

  const timer = setInterval(loop, TICK_MS);

  process.on("SIGINT", () => {
    clearInterval(timer);
    console.log("\nStopped.");
    process.exit(0);
  });
})();

