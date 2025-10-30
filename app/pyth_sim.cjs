#!/usr/bin/env node
// app/pyth_stream_writer.js
// Multi-asset (BTC/ETH/SOL) → on-chain writer, batching only i64-changing assets.
// Usage: node app/pyth_stream_writer.js <wallet.json>
//
// Env:  ANCHOR_PROVIDER_URL  (default http://127.0.0.1:8899)
// Deps: npm i @solana/web3.js @pythnetwork/hermes-client @pythnetwork/price-service-client ws

const { HermesClient } = require("@pythnetwork/hermes-client");
const { PriceServiceConnection } = require("@pythnetwork/price-service-client");
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
} = require("@solana/web3.js");
const fs = require("fs");
const path = require("path");

/* ===== Program constants ===== */
const PROGRAM_ID = new PublicKey("7ARBeYF5rGCanAGiRaxhVpiuZZpGXazo5UJqHMoJgkuE");
const STATE_SEED = Buffer.from("state_v2"); // new PDA seed
const DECIMALS = 6;

/* set_price(asset:u8, index:u8, price:i64, ts:i64) */
const DISC = {
  initialize: Uint8Array.from([175, 175, 109, 31, 13, 152, 155, 237]),
  set_price:  Uint8Array.from([16, 19, 182, 8, 149, 83, 72, 181]),
};

/* Allowed updaters → index (must match on-chain allow-list) */
const ALLOWED = new Map([
  ["AivknDqDUqnvyYVmDViiB2bEHKyUK5HcX91gWL2zgTZ4", 1],
  ["C3Un8Zf6pnyedk1AWDgqtZtKYLyiaZ4zwFPqJMVU2Trt", 2],
  ["129arbPoM1UXBtYk99PXbp4w1csc4d5hFXnX4mh7nYc5", 3],
]);

/* Asset ids (must match your program enum) */
const ASSETS = { BTC: 1, ETH: 2, SOL: 3 };

/* Hermes canonical feed IDs */
const FEEDS = {
  BTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  ETH: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  SOL: "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
};

/* ===== helpers ===== */
const norm = (id) => (id || "").toLowerCase().replace(/^0x/, "");
function readKeypair(p) {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8")))
  );
}
function u8(n) {
  const b = Buffer.alloc(1);
  b.writeUint8(n);
  return b;
}
function i64(n) {
  let x = BigInt(n);
  if (x < 0n) x = (1n << 64n) + x;
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(x);
  return b;
}
function pkbuf(pk) {
  return Buffer.from(pk.toBytes());
}
function toFixedI64(num, d) {
  // round to nearest integer at d=6 dp
  return Math.round(Number(num) * 10 ** d);
}
function scalePythPrice(p) {
  if (!p || p.price === undefined || p.expo === undefined) return null;
  const n = Number(p.price.toString());
  if (!Number.isFinite(n)) return null;
  return n * Math.pow(10, p.expo); // human dollars (float)
}
function fmt2(x) {
  return Number(x).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/* ===== TransactionInstructions ===== */
function ixInitialize(updateAuthority, programId, statePda) {
  const data = Buffer.concat([Buffer.from(DISC.initialize), pkbuf(updateAuthority)]);
  const keys = [
    { pubkey: statePda, isSigner: false, isWritable: true },
    { pubkey: updateAuthority, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  return new TransactionInstruction({ programId, keys, data });
}
function ixSetPrice(asset, index, priceI64, clientTsMs, programId, statePda, signer) {
  const data = Buffer.concat([
    Buffer.from(DISC.set_price),
    u8(asset),
    u8(index),
    i64(priceI64),
    i64(clientTsMs),
  ]);
  const keys = [
    { pubkey: statePda, isSigner: false, isWritable: true },
    { pubkey: signer, isSigner: true, isWritable: false },
  ];
  return new TransactionInstruction({ programId, keys, data });
}

/* ===== main ===== */
;(async () => {
  /* CLI */
  const walletArg = process.argv[2];
  if (!walletArg) {
    console.error("Usage: node app/pyth_stream_writer.js <wallet.json>");
    process.exit(1);
  }
  const walletPath = path.isAbsolute(walletArg)
    ? walletArg
    : path.join(process.cwd(), walletArg);
  if (!fs.existsSync(walletPath)) {
    console.error("Wallet file not found:", walletPath);
    process.exit(1);
  }

  /* RPC + wallet */
  const rpc = process.env.ANCHOR_PROVIDER_URL || "http://127.0.0.1:8899";
  const payer = readKeypair(walletPath);
  const payerPub = payer.publicKey.toBase58();
  const index = ALLOWED.get(payerPub);
  if (![1, 2, 3].includes(index)) {
    console.error("Wallet not authorized for any index:", payerPub);
    process.exit(1);
  }
  console.log(`Authorized wallet ${payerPub} for index ${index}.`);

  const connection = new Connection(rpc, "processed");
  const [statePda] = PublicKey.findProgramAddressSync([STATE_SEED], PROGRAM_ID);

  /* Blockhash cache (no retry policy) */
  let bhCache = { blockhash: null, lastValidBlockHeight: 0, ts: 0 };
  async function refreshBlockhash() {
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("processed");
    bhCache = { blockhash, lastValidBlockHeight, ts: Date.now() };
    return bhCache;
  }
  async function ensureBlockhashFresh(maxAgeMs = 2000) {
    if (!bhCache.blockhash || Date.now() - bhCache.ts > maxAgeMs) {
      await refreshBlockhash();
    }
    return bhCache;
  }

  /* Initialize if missing */
  const info = await connection.getAccountInfo(statePda);
  if (!info) {
    console.log("Initializing state PDA…");
    // ensure fresh blockhash for init too
    await ensureBlockhashFresh();
    const tx = new Transaction().add(
      ixInitialize(payer.publicKey, PROGRAM_ID, statePda)
    );
    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = bhCache.blockhash;

    const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
      skipPreflight: false,
      commitment: "processed",
    });
    console.log("init tx:", sig);
  }

  /* Pyth stream setup */
  const hermes = new HermesClient("https://hermes.pyth.network", {});
  const idBySymbol = new Map(Object.entries(FEEDS).map(([sym, id]) => [sym, norm(id)]));
  const symbolById = new Map(
    [...idBySymbol.entries()].map(([sym, id]) => [id, sym])
  );
  const priceIds = [...idBySymbol.values()];
  const psc = new PriceServiceConnection("https://hermes.pyth.network", {
    priceFeedRequestConfig: { binary: true },
  });

  /* Latest cache + send guards */
  const latest = {
    BTC: { price: null, pubMs: 0 },
    ETH: { price: null, pubMs: 0 },
    SOL: { price: null, pubMs: 0 },
  };
  const sentUpTo = { BTC: 0, ETH: 0, SOL: 0 };
  const lastSentI64 = { BTC: null, ETH: null, SOL: null };

  console.log("Streaming these USD feeds:");
  for (const [sym, id] of idBySymbol.entries()) console.log(`  ${sym} -> 0x${id}`);

  await psc.subscribePriceFeedUpdates(priceIds, (pf) => {
    try {
      const p = pf.getPriceNoOlderThan(120);
      const val = scalePythPrice(p);
      if (val === null || !Number.isFinite(val)) return;

      const id = norm(pf.id);
      const sym = symbolById.get(id);
      if (!sym) return;

      const pubMs = p.publishTime ? Number(p.publishTime) * 1000 : Date.now();
      latest[sym] = { price: val, pubMs };
    } catch {
      /* ignore stale */
    }
  });

  /* Batch sender — only send if fixed-point i64 changes; no retry on expired */
  const TICK_MS = 750;
  setInterval(async () => {
    try {
      // Build fresh list with the exact i64 that would be written
      const fresh = [];
      for (const sym of ["BTC", "ETH", "SOL"]) {
        const hasPrice = latest[sym].price != null;
        if (!hasPrice) continue;

        const candI64 = toFixedI64(latest[sym].price, DECIMALS); // fixed-point to write
        const newerPub = latest[sym].pubMs > sentUpTo[sym];
        const changedI64 =
          lastSentI64[sym] == null || candI64 !== lastSentI64[sym];

        if (newerPub && changedI64) fresh.push({ sym, candI64 });
      }
      if (fresh.length === 0) return;

      const t0 = Date.now();
      const clientTsMs = Date.now();

      // fresh blockhash every send (<= 2s old)
      await ensureBlockhashFresh();

      // Build batch tx (no priority fee, as requested)
      const tx = new Transaction();
      for (const { sym, candI64 } of fresh) {
        const asset =
          sym === "BTC" ? ASSETS.BTC : sym === "ETH" ? ASSETS.ETH : ASSETS.SOL;
        tx.add(
          ixSetPrice(
            asset,
            index,
            candI64,
            clientTsMs,
            PROGRAM_ID,
            statePda,
            payer.publicKey
          )
        );
      }
      tx.feePayer = payer.publicKey;
      tx.recentBlockhash = bhCache.blockhash;

      const t_recv = Date.now();

      let sig;
      try {
        sig = await sendAndConfirmTransaction(connection, tx, [payer], {
          skipPreflight: false,
          commitment: "processed",
        });
      } catch (e) {
        const msg = (e?.message || "").toLowerCase();
        const expired =
          msg.includes("block height exceeded") ||
          msg.includes("blockhash not found") ||
          (msg.includes("signature") && msg.includes("expired"));
        if (expired) {
          // Do NOT retry (your requirement): just log and skip this batch
          console.warn(
            `[send/batch] skipped: blockhash expired (no retry). details: ${e?.message || e}`
          );
          return; // don’t mark sent; let next tick handle fresh data with a new blockhash
        }
        throw e; // surface other errors
      }

      const t_sent = Date.now();

      // Mark sent (both publish time and i64)
      for (const { sym, candI64 } of fresh) {
        sentUpTo[sym] = latest[sym].pubMs;
        lastSentI64[sym] = candI64;
      }

      // Log: compact JSON with ms timestamp + latency
      console.log(
        JSON.stringify(
          {
            ts_ms: clientTsMs,
            idx: index,
            assets: fresh.map(({ sym }) => sym),
            prices: Object.fromEntries(
              fresh.map(({ sym, candI64 }) => [
                sym,
                fmt2(candI64 / 10 ** DECIMALS),
              ])
            ),
            tx: sig,
            t_recv,
            t_sent,
            dt_handle: t_recv - t0,
            dt_send: t_sent - t_recv,
          },
          null,
          0
        )
      );
    } catch (e) {
      console.error("[send/batch]", e?.message || e);
    }
  }, TICK_MS);

  process.on("SIGINT", async () => {
    console.log("\nClosing stream…");
    try {
      await psc.closeWebSocket();
    } catch {}
    process.exit(0);
  });
})().catch((e) => {
  console.error("Fatal:", e?.message ?? e);
  process.exit(1);
});

