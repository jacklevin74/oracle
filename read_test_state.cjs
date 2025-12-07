#!/usr/bin/env node
const {Connection, PublicKey} = require("@solana/web3.js");

const TEST_PROGRAM_ID = new PublicKey("CcgTMiYkgVfz7cAGkD6835BqfycG5N5Y4aPPHYW1EvKx");
const RPC_URL = "https://rpc.mainnet.x1.xyz";
const DECIMALS = 8;

function readI64(buf, offset) {
  return buf.readBigInt64LE(offset);
}

function decodePrice(i64Value) {
  const num = Number(i64Value);
  return num / Math.pow(10, DECIMALS);
}

async function main() {
  console.log("📖 Reading test program state...");
  console.log("Program ID:", TEST_PROGRAM_ID.toBase58());

  const connection = new Connection(RPC_URL, "confirmed");

  // Derive state PDA
  const [statePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("state_v2")],
    TEST_PROGRAM_ID
  );
  console.log("State PDA:", statePda.toBase58());

  const accountInfo = await connection.getAccountInfo(statePda);

  if (!accountInfo) {
    console.log("❌ State account not found");
    return;
  }

  console.log("\n✅ Account found");
  console.log("   Size:", accountInfo.data.length, "bytes");

  const data = accountInfo.data;

  // Skip 8-byte Anchor discriminator
  let offset = 8;

  // Read update_authority (32 bytes)
  const updateAuthority = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  console.log("   Update Authority:", updateAuthority.toBase58());

  // Triplet structure: 4 prices (i64 each = 8 bytes) + 4 timestamps (i64 each = 8 bytes) = 64 bytes
  const TRIPLET_SIZE = 64;

  const assets = ['BTC', 'ETH', 'SOL', 'HYPE', 'ZEC', 'TSLA', 'NVDA', 'MSTR'];

  console.log("\n📊 Asset Prices:");
  console.log("─".repeat(80));

  for (let i = 0; i < assets.length; i++) {
    const assetOffset = offset + (i * TRIPLET_SIZE);

    // Read 4 prices
    const param1 = readI64(data, assetOffset);
    const param2 = readI64(data, assetOffset + 8);
    const param3 = readI64(data, assetOffset + 16);
    const param4 = readI64(data, assetOffset + 24);

    // Read 4 timestamps
    const ts1 = readI64(data, assetOffset + 32);
    const ts2 = readI64(data, assetOffset + 40);
    const ts3 = readI64(data, assetOffset + 48);
    const ts4 = readI64(data, assetOffset + 56);

    console.log(`\n${assets[i].padEnd(6)}`);

    if (param1 !== 0n) {
      const price1 = decodePrice(param1);
      const date1 = ts1 !== 0n ? new Date(Number(ts1)).toISOString() : 'N/A';
      console.log(`  Param1: $${price1.toFixed(2).padStart(12)} at ${date1}`);
    } else {
      console.log(`  Param1: Not set`);
    }

    if (param2 !== 0n) {
      const price2 = decodePrice(param2);
      const date2 = ts2 !== 0n ? new Date(Number(ts2)).toISOString() : 'N/A';
      console.log(`  Param2: $${price2.toFixed(2).padStart(12)} at ${date2}`);
    } else {
      console.log(`  Param2: Not set`);
    }

    if (param3 !== 0n) {
      const price3 = decodePrice(param3);
      const date3 = ts3 !== 0n ? new Date(Number(ts3)).toISOString() : 'N/A';
      console.log(`  Param3: $${price3.toFixed(2).padStart(12)} at ${date3}`);
    } else {
      console.log(`  Param3: Not set`);
    }

    if (param4 !== 0n) {
      const price4 = decodePrice(param4);
      const date4 = ts4 !== 0n ? new Date(Number(ts4)).toISOString() : 'N/A';
      console.log(`  Param4: $${price4.toFixed(2).padStart(12)} at ${date4}`);
    } else {
      console.log(`  Param4: Not set`);
    }
  }

  offset += (8 * TRIPLET_SIZE);

  // Read decimals and bump
  const decimals = data.readUInt8(offset);
  const bump = data.readUInt8(offset + 1);

  console.log("\n─".repeat(80));
  console.log(`Decimals: ${decimals}`);
  console.log(`Bump: ${bump}`);
  console.log("\n✅ State read successfully!");
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error("❌ Error:", err.message);
    process.exit(1);
  });
