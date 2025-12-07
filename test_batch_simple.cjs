#!/usr/bin/env node
const {Connection, Keypair, PublicKey, SystemProgram, Transaction, sendAndConfirmTransaction} = require("@solana/web3.js");
const fs = require("fs");
const os = require("os");

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
  console.log("🧪 Testing batch price update with 8 assets");
  console.log("Program ID:", TEST_PROGRAM_ID.toBase58());
  console.log();

  // Load wallet
  const walletPath = process.env.ANCHOR_WALLET || `${os.homedir()}/.config/solana/id.json`;
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf-8"))));
  console.log("Wallet:", payer.publicKey.toBase58());

  // Hardcoded test prices (realistic values as of Dec 2024)
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

  console.log("\n📊 Test Prices:");
  console.log("BTC:  $95,000.00 →", prices.BTC);
  console.log("ETH:   $3,500.00 →", prices.ETH);
  console.log("SOL:     $180.00 →", prices.SOL);
  console.log("HYPE:     $25.00 →", prices.HYPE);
  console.log("ZEC:      $45.00 →", prices.ZEC);
  console.log("TSLA:    $385.00 →", prices.TSLA);
  console.log("NVDA:    $135.00 →", prices.NVDA);
  console.log("MSTR:    $415.00 →", prices.MSTR);

  // Derive state PDA
  const [statePda] = PublicKey.findProgramAddressSync(
    [Buffer.from("state_v2")],
    TEST_PROGRAM_ID
  );
  console.log("\nState PDA:", statePda.toBase58());

  // Build batch_set_prices instruction
  const BATCH_SET_PRICES_DISCRIMINATOR = Buffer.from([22, 37, 238, 178, 182, 181, 83, 149]);
  const updaterIndex = 1; // First updater slot (1-indexed)
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
  console.log("   Instruction data size:", instructionData.length, "bytes");

  const connection = new Connection(RPC_URL, "confirmed");

  try {
    const tx = new Transaction().add(instruction);

    const signature = await sendAndConfirmTransaction(connection, tx, [payer], {
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
    console.log("\nNext: Verify prices on dashboard");

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
