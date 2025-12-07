#!/usr/bin/env node
const {Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction} = require("@solana/web3.js");
const fs = require("fs");

const TEST_PROGRAM_ID = new PublicKey("CcgTMiYkgVfz7cAGkD6835BqfycG5N5Y4aPPHYW1EvKx");
const RPC_URL = "https://rpc.mainnet.x1.xyz";
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

async function fetchPythPrices() {
  const FEEDS = {
    BTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
    ETH: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
    SOL: "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
    HYPE: "0x9c0bef372433bf0c9e823e9f2aa0a5220d5a25d3b0bf35e85bc2bc7960b6b46f",
    ZEC: "0xbe9b59d178f0d6a97ab4c343bff2aa69caa1eaae3e9048a65788c529b125bb24",
    TSLA: "0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1",
    NVDA: "0xb1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593",
    MSTR: "0xe1e80251e5f5184f2195008382538e847fafc36f751896889dd3d1b1f6111f09",
  };

  const response = await fetch("https://hermes.pyth.network/v2/updates/price/latest?" +
    Object.values(FEEDS).map(id => `ids[]=${id}`).join("&"));
  const data = await response.json();

  const prices = {};
  for (const [symbol, feedId] of Object.entries(FEEDS)) {
    const feed = data.parsed.find(f => '0x' + f.id === feedId);
    if (feed && feed.price) {
      const price = Number(feed.price.price) * Math.pow(10, feed.price.expo);
      prices[symbol] = Math.round(price * Math.pow(10, DECIMALS));
    } else {
      prices[symbol] = 0;
    }
  }
  return prices;
}

async function main() {
  console.log("🔴 LIVE UPDATE TEST - Sending real transaction to blockchain");
  console.log("Program ID:", TEST_PROGRAM_ID.toBase58());
  console.log();

  // Load relay3 wallet
  const relayKey = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(".keys/mn_relay3.json", "utf-8")))
  );
  console.log("Relay3 Wallet:", relayKey.publicKey.toBase58());

  // Fetch live prices from Pyth
  console.log("\n📡 Fetching live prices from Pyth Network...");
  const prices = await fetchPythPrices();

  console.log("\n📊 Live Prices (will be sent on-chain):");
  console.log("BTC:  $" + (prices.BTC / Math.pow(10, DECIMALS)).toFixed(2));
  console.log("ETH:  $" + (prices.ETH / Math.pow(10, DECIMALS)).toFixed(2));
  console.log("SOL:  $" + (prices.SOL / Math.pow(10, DECIMALS)).toFixed(2));
  console.log("HYPE: $" + (prices.HYPE / Math.pow(10, DECIMALS)).toFixed(2));
  console.log("ZEC:  $" + (prices.ZEC / Math.pow(10, DECIMALS)).toFixed(2));
  console.log("TSLA: $" + (prices.TSLA / Math.pow(10, DECIMALS)).toFixed(2) + " ← STOCK");
  console.log("NVDA: $" + (prices.NVDA / Math.pow(10, DECIMALS)).toFixed(2) + " ← STOCK");
  console.log("MSTR: $" + (prices.MSTR / Math.pow(10, DECIMALS)).toFixed(2) + " ← STOCK");

  // Derive state PDA
  const [statePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("state_v2")],
    TEST_PROGRAM_ID
  );
  console.log("\nState PDA:", statePda.toBase58());

  // Build batch_set_prices instruction
  const BATCH_SET_PRICES_DISCRIMINATOR = Buffer.from([22, 37, 238, 178, 182, 181, 83, 149]);
  const updaterIndex = 3; // Relay3 uses index 3
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
      { pubkey: relayKey.publicKey, isSigner: true, isWritable: false },
    ],
    programId: TEST_PROGRAM_ID,
    data: instructionData,
  };

  console.log("\n⚙️  Sending batch price update...");
  console.log("   Updater index: 3 (relay3)");
  console.log("   Timestamp:", clientTsMs);

  const connection = new Connection(RPC_URL, "confirmed");

  try {
    const tx = new Transaction().add(instruction);

    const signature = await sendAndConfirmTransaction(connection, tx, [relayKey], {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      commitment: "confirmed",
    });

    console.log("\n✅ Transaction CONFIRMED!");
    console.log("   Signature:", signature);

    // Verify state was updated
    await new Promise(r => setTimeout(r, 2000));
    const accountInfo = await connection.getAccountInfo(statePda);
    console.log("\n✅ State account verified");
    console.log("   Size:", accountInfo?.data.length, "bytes");

    console.log("\n🎉 LIVE 8-asset update successful!");
    console.log("   All 8 assets (crypto + stocks) updated on-chain!");
    console.log("   ✅ BTC, ETH, SOL, HYPE, ZEC");
    console.log("   ✅ TSLA, NVDA, MSTR");
    console.log("\nNext: Run 'node read_test_state.cjs' to verify live prices");

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
