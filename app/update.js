#!/usr/bin/env node
// Usage: node app/update.js 1|2|3
// Env:   ANCHOR_PROVIDER_URL (e.g. http://127.0.0.1:8899), ANCHOR_WALLET (~/.config/solana/id.json)

import { Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction } from "@solana/web3.js";
import fs from "fs";
import path from "path";
import * as url from "url";

// ---------- Config (match your program + IDL) ----------
const PROGRAM_ID = new PublicKey("6EqUbMtdbZHd6WBJhYYrf7UQt47GT5iSJtPHQYgVsDiV");
const STATE_SEED = Buffer.from("state");
const DECIMALS = 6;

// Discriminators from your IDL:
const DISC = {
  initialize: Uint8Array.from([175, 175, 109, 31, 13, 152, 155, 237]),
  set_price:  Uint8Array.from([16, 19, 182, 8, 149, 83, 72, 181]),
  // set_update_authority: [166,198,186,255,217,170,103,155] // not used here
};

// ---------- Arg parsing ----------
const idx = Number(process.argv[2] || "0");
if (![1, 2, 3].includes(idx)) {
  console.error("Usage: node app/update.js 1|2|3");
  process.exit(1);
}

// ---------- Helpers ----------
const __dirname = path.dirname(url.fileURLToPath(import.meta.url));
function readKeypair(jsonPath) {
  const secret = JSON.parse(fs.readFileSync(jsonPath, "utf8"));
  return Keypair.fromSecretKey(Uint8Array.from(secret));
}
function i64ToBuf(n) {
  // Two's complement little-endian i64
  // JS safe i64 range is narrower, but our values fit; use BigInt for safety.
  let x = BigInt(n);
  const buf = Buffer.alloc(8);
  // handle negative
  if (x < 0n) x = (1n << 64n) + x;
  buf.writeBigUInt64LE(x);
  return buf;
}
function u8ToBuf(n) {
  const b = Buffer.alloc(1);
  b.writeUInt8(n);
  return b;
}
function pubkeyToBuf(pk) {
  return Buffer.from(pk.toBytes());
}
function toFixedI64(num, decimals) {
  const scaled = Math.round(num * 10 ** decimals);
  return scaled; // JS number -> convert in i64ToBuf
}

// ---------- Wire helpers (build instruction data by hand) ----------
function buildInitializeIx(updateAuthority, programId, statePda) {
  const data = Buffer.concat([
    Buffer.from(DISC.initialize),      // 8 bytes
    pubkeyToBuf(updateAuthority),      // 32 bytes (Pubkey)
  ]);

  const keys = [
    { pubkey: statePda,       isSigner: false, isWritable: true  },  // state (PDA)
    { pubkey: updateAuthority, isSigner: true,  isWritable: true  }, // payer (signer)
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];

  return { programId, keys, data };
}

function buildSetPriceIx(index, priceI64, clientTsMsI64, programId, statePda, signer) {
  const data = Buffer.concat([
    Buffer.from(DISC.set_price),       // 8 bytes
    u8ToBuf(index),                    // u8
    i64ToBuf(priceI64),                // i64
    i64ToBuf(clientTsMsI64),           // i64
  ]);

  const keys = [
    { pubkey: statePda, isSigner: false, isWritable: true }, // state (PDA)
    { pubkey: signer,   isSigner: true,  isWritable: false }, // signer (authority)
  ];

  return { programId, keys, data };
}

// ---------- Main ----------
(async () => {
  // Provider bits
  const rpc = process.env.ANCHOR_PROVIDER_URL || "http://127.0.0.1:8899";
  const walletPath = process.env.ANCHOR_WALLET || path.join(process.env.HOME, ".config/solana/id.json");
  const payer = readKeypair(walletPath);
  const connection = new Connection(rpc, "confirmed");

  // Derive PDA
  const [statePda] = PublicKey.findProgramAddressSync([STATE_SEED], PROGRAM_ID);

  // If no state account, run initialize
  const info = await connection.getAccountInfo(statePda);
  if (!info) {
    console.log("Initializing state PDA…");
    const initIx = buildInitializeIx(payer.publicKey, PROGRAM_ID, statePda);
    const tx = new Transaction().add(initIx);
    const sig = await sendAndConfirmTransaction(connection, tx, [payer], { skipPreflight: false });
    console.log("init tx:", sig);
  }

  // Compose set_price
  // price: random walk around 68k
  const base = 68_000;
  const px = base + (Math.random() * 50 - 25); // +/- 25
  const priceI64 = toFixedI64(px, DECIMALS);
  const clientTsMs = Date.now();

  const setIx = buildSetPriceIx(idx, priceI64, clientTsMs, PROGRAM_ID, statePda, payer.publicKey);
  const tx2 = new Transaction().add(setIx);
  const sig2 = await sendAndConfirmTransaction(connection, tx2, [payer], { skipPreflight: false });

  console.log(`✔ set_price tx ${sig2} | param${idx}: $${px.toFixed(DECIMALS)} | ts=${new Date(clientTsMs).toISOString()}`);
})().catch((e) => {
  console.error("Fatal:", e?.message ?? e);
  process.exit(1);
});

