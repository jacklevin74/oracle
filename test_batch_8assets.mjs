#!/usr/bin/env node
import { Connection, Keypair, PublicKey } from "@solana/web3.js";
import priceServicePkg from "@pythnetwork/price-service-client";
const { PriceServiceConnection } = priceServicePkg;
import fs from "fs";
import os from "os";

const TEST_PROGRAM_ID = new PublicKey("CcgTMiYkgVfz7cAGkD6835BqfycG5N5Y4aPPHYW1EvKx");
const RPC_URL = "https://rpc.mainnet.x1.xyz";
const HERMES_URL = "https://hermes.pyth.network";

// Pyth price feed IDs
const PRICE_FEEDS = {
  BTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  ETH: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  SOL: "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
  HYPE: "0x9c0bef372433bf0c9e823e9f2aa0a5220d5a25d3b0bf35e85bc2bc7960b6b46f",
  ZEC: "0xbe9b59d178f0d6a97ab4c343bff2aa69caa1eaae3e9048a65788c529b125bb24",
  TSLA: "0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1",
  NVDA: "0x6155be35cf31917867c5c981e0e08f234a8a07e6f92d2e4bb9e0bea5e207e4bf",
  MSTR: "0x9ee4e7c60b940440078d6809c90c268c8b4e5cc2b1bc803dde1f78c8da6c1c5c"
};

const DECIMALS = 8;

function encodeI64(value) {
  const buf = Buffer.allocUnsafe(8);
  buf.writeBigInt64LE(BigInt(value));
  return buf;
}

function encodeU8(value) {
  const buf = Buffer.allocUnsafe(1);
  buf.writeUInt8(value);
  return buf;
}

async function main() {
  console.log("🧪 Testing batch price update with 8 assets");
  console.log("Program ID:", TEST_PROGRAM_ID.toBase58());
  console.log("\n");

  // Load wallet
  const walletPath = process.env.ANCHOR_WALLET || `${os.homedir()}/.config/solana/id.json`;
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf-8"))));
  console.log("Wallet:", payer.publicKey.toBase58());

  // Connect to Pyth Hermes
  console.log("Fetching prices from Pyth Network...");
  const pythConnection = new PriceServiceConnection(HERMES_URL, { priceFeedRequestConfig: { binary: true } });

  const priceIds = Object.values(PRICE_FEEDS);
  const priceFeeds = await pythConnection.getLatestPriceFeeds(priceIds);

  // Extract prices
  const prices = {};
  for (const [symbol, feedId] of Object.entries(PRICE_FEEDS)) {
    const feed = priceFeeds.find(f => '0x' + f.id === feedId);
    if (feed) {
      const priceData = feed.getPriceUnchecked();
      const price = Number(priceData.price) * Math.pow(10, priceData.expo);
      const priceI64 = Math.round(price * Math.pow(10, DECIMALS));
      prices[symbol] = priceI64;
      console.log(`${symbol.padEnd(6)} $${price.toFixed(2).padStart(12)} → i64: ${priceI64}`);
    } else {
      console.log(`${symbol.padEnd(6)} ❌ Feed not found`);
      prices[symbol] = 0;
    }
  }

  // Derive state PDA
  const [statePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("state_v2")],
    TEST_PROGRAM_ID
  );
  console.log("\nState PDA:", statePda.toBase58());

  // Build batch_set_prices instruction
  const BATCH_SET_PRICES_DISCRIMINATOR = Buffer.from([219, 158, 87, 136, 50, 33, 90, 72]);
  const updaterIndex = 0; // First updater slot
  const clientTsMs = Date.now();

  const instructionData = Buffer.concat([
    BATCH_SET_PRICES_DISCRIMINATOR,
    encodeU8(updaterIndex),
    encodeI64(prices.BTC),
    encodeI64(prices.ETH),
    encodeI64(prices.SOL),
    encodeI64(prices.HYPE),
    encodeI64(prices.ZEC),
    encodeI64(prices.TSLA),
    encodeI64(prices.NVDA),
    encodeI64(prices.MSTR),
    encodeI64(clientTsMs),
  ]);

  const instruction = {
    keys: [
      { pubkey: statePda, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: false },
    ],
    programId: TEST_PROGRAM_ID,
    data: instructionData,
  };

  console.log("\n⚙️  Sending batch price update...");
  console.log("   Updater index:", updaterIndex);
  console.log("   Timestamp:", clientTsMs);

  const connection = new Connection(RPC_URL, "confirmed");

  try {
    const { Transaction } = await import("@solana/web3.js");
    const tx = new Transaction().add(instruction);

    const signature = await connection.sendTransaction(tx, [payer], {
      skipPreflight: false,
      preflightCommitment: "confirmed",
    });

    console.log("\n✅ Transaction sent!");
    console.log("   Signature:", signature);
    console.log("\n⏳ Confirming...");

    await connection.confirmTransaction(signature, "confirmed");
    console.log("✅ Transaction confirmed!");

    // Verify state was updated
    await new Promise(r => setTimeout(r, 2000));
    const accountInfo = await connection.getAccountInfo(statePda);
    console.log("\n✅ State account size:", accountInfo?.data.length, "bytes");
    console.log("\n🎉 8-asset batch update successful!");

  } catch (err) {
    console.error("\n❌ Error:", err.message);
    if (err.logs) {
      console.error("\nProgram logs:");
      err.logs.forEach(log => console.error("  ", log));
    }
    throw err;
  }
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
