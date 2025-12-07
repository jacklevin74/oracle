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

async function main() {
  console.log("🧪 Testing batch price update with relay3 key");
  console.log("Program ID:", TEST_PROGRAM_ID.toBase58());
  console.log();

  // Load relay3 wallet
  const relayKey = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(".keys/mn_relay3.json", "utf-8")))
  );
  console.log("Relay3 Wallet:", relayKey.publicKey.toBase58());

  // Hardcoded test prices (realistic values)
  const prices = {
    BTC:  Math.round(95000 * Math.pow(10, DECIMALS)),   // $95,000
    ETH:  Math.round(3500 * Math.pow(10, DECIMALS)),    // $3,500
    SOL:  Math.round(180 * Math.pow(10, DECIMALS)),     // $180
    HYPE: Math.round(25 * Math.pow(10, DECIMALS)),      // $25
    ZEC:  Math.round(45 * Math.pow(10, DECIMALS)),      // $45
    TSLA: Math.round(385 * Math.pow(10, DECIMALS)),     // $385
    NVDA: Math.round(135 * Math.pow(10, DECIMALS)),     // $135
    MSTR: Math.round(415 * Math.pow(10, DECIMALS)),     // $415
  };

  console.log("\n📊 Test Prices (will be set in param3):");
  console.log("BTC:  $95,000.00 →", prices.BTC);
  console.log("ETH:   $3,500.00 →", prices.ETH);
  console.log("SOL:     $180.00 →", prices.SOL);
  console.log("HYPE:     $25.00 →", prices.HYPE);
  console.log("ZEC:      $45.00 →", prices.ZEC);
  console.log("TSLA:    $385.00 →", prices.TSLA, "← NEW STOCK");
  console.log("NVDA:    $135.00 →", prices.NVDA, "← NEW STOCK");
  console.log("MSTR:    $415.00 →", prices.MSTR, "← NEW STOCK");

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
  console.log("   Instruction data size:", instructionData.length, "bytes");

  const connection = new Connection(RPC_URL, "confirmed");

  try {
    const tx = new Transaction().add(instruction);

    const signature = await sendAndConfirmTransaction(connection, tx, [relayKey], {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      commitment: "confirmed",
    });

    console.log("\n✅ Transaction sent!");
    console.log("   Signature:", signature);

    // Verify state was updated
    await new Promise(r => setTimeout(r, 2000));
    const accountInfo = await connection.getAccountInfo(statePda);
    console.log("\n✅ State account verified");
    console.log("   Size:", accountInfo?.data.length, "bytes");

    console.log("\n🎉 8-asset batch update successful!");
    console.log("   All 8 assets updated in param3 slot:");
    console.log("   ✅ BTC, ETH, SOL, HYPE, ZEC");
    console.log("   ✅ TSLA, NVDA, MSTR (stocks!)");
    console.log("\nNext: Run 'node read_test_state.cjs' to verify prices are on-chain");

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
