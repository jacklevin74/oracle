#!/usr/bin/env node
/**
 * Read and display the new 10-asset oracle state from blockchain
 */
const {Connection, PublicKey} = require("@solana/web3.js");

const PROGRAM_ID = new PublicKey("CcgTMiYkgVfz7cAGkD6835BqfycG5N5Y4aPPHYW1EvKx");
const RPC_URL = "https://rpc.mainnet.x1.xyz";
const DECIMALS = 8;

function decodeI64(buffer, offset) {
  return Number(buffer.readBigInt64LE(offset));
}

function decodeU64(buffer, offset) {
  return Number(buffer.readBigUInt64LE(offset));
}

async function main() {
  console.log("📖 Reading 10-asset oracle state from blockchain");
  console.log("Program ID:", PROGRAM_ID.toBase58());
  console.log();

  const connection = new Connection(RPC_URL, "confirmed");

  // Derive state PDA
  const [statePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("state_v2")],
    PROGRAM_ID
  );
  console.log("State PDA:", statePda.toBase58());

  const accountInfo = await connection.getAccountInfo(statePda);
  if (!accountInfo) {
    console.error("❌ State account not found!");
    return;
  }

  console.log("Account size:", accountInfo.data.length, "bytes");
  console.log();

  // Skip 8-byte discriminator
  const data = accountInfo.data;
  let offset = 8;

  // Read update authority (32 bytes)
  const authority = new PublicKey(data.slice(offset, offset + 32));
  offset += 32;
  console.log("Update Authority:", authority.toBase58());
  console.log();

  // Read each asset's triplet (64 bytes each)
  const assets = ["BTC", "ETH", "SOL", "HYPE", "ZEC", "TSLA", "NVDA", "MSTR", "GOLD", "SILVER"];

  console.log("═══════════════════════════════════════════════════════");
  console.log("  ASSET PRICES (Live from blockchain)");
  console.log("═══════════════════════════════════════════════════════");

  for (const symbol of assets) {
    // Each triplet: 4 prices (i64 * 4) + 4 timestamps (u64 * 4) = 64 bytes
    const prices = [];
    for (let i = 0; i < 4; i++) {
      prices.push(decodeI64(data, offset + i * 8));
    }

    const timestamps = [];
    for (let i = 0; i < 4; i++) {
      timestamps.push(decodeU64(data, offset + 32 + i * 8));
    }

    offset += 64;

    // Find the median price (middle two averaged if 4 values)
    const sortedPrices = [...prices].filter(p => p !== 0).sort((a, b) => a - b);
    let median;
    if (sortedPrices.length >= 4) {
      // True median: average of middle two values
      median = (sortedPrices[1] + sortedPrices[2]) / 2;
    } else if (sortedPrices.length >= 2) {
      // Average of available prices
      median = sortedPrices.reduce((a, b) => a + b, 0) / sortedPrices.length;
    } else {
      // Single price or no prices
      median = sortedPrices[0] || 0;
    }

    const displayPrice = median / Math.pow(10, DECIMALS);

    // Find most recent timestamp
    const maxTs = Math.max(...timestamps);
    const age = maxTs ? Date.now() - maxTs : null;
    const ageStr = age !== null ? `${Math.floor(age / 1000)}s ago` : "n/a";

    const badge = symbol === "GOLD" || symbol === "SILVER" ? "COMMODITY" :
                  symbol === "TSLA" || symbol === "NVDA" || symbol === "MSTR" ? "STOCK" : "CRYPTO";

    console.log(`  ${symbol.padEnd(6)} $${displayPrice.toLocaleString('en-US', {minimumFractionDigits: 2, maximumFractionDigits: 2}).padEnd(12)} [${badge}] (${ageStr})`);
  }

  console.log("═══════════════════════════════════════════════════════");

  // Read decimals and bump
  const decimals = data[offset];
  const bump = data[offset + 1];
  console.log();
  console.log("Decimals:", decimals);
  console.log("Bump:", bump);

  console.log();
  console.log("✅ Successfully read all 10 asset prices from new program!");
  console.log("   Including GOLD and SILVER commodities!");
}

main()
  .then(() => process.exit(0))
  .catch(err => {
    console.error(err);
    process.exit(1);
  });
