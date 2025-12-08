#!/usr/bin/env node
/**
 * Migrate from 8-asset to 10-asset oracle state
 * 1. Close old 8-asset state (554 bytes)
 * 2. Initialize new 10-asset state (674 bytes)
 */
const {Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, SystemProgram} = require("@solana/web3.js");
const fs = require("fs");

const PROGRAM_ID = new PublicKey("CcgTMiYkgVfz7cAGkD6835BqfycG5N5Y4aPPHYW1EvKx");
const RPC_URL = "https://rpc.mainnet.x1.xyz";

// Instruction discriminators
const CLOSE_STATE_DISCRIMINATOR = Buffer.from([25, 1, 184, 101, 200, 245, 210, 246]);
const INITIALIZE_DISCRIMINATOR = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]);

// Allowed updaters (must match the program)
const UPDATERS = [
  new PublicKey("CGLezzdUpYmxiq3g5xdXxry8SWqwQbSxFJsdqfM13ro9"), // relay1
  new PublicKey("FprJrTPJq9eKsVxEVhQCyRChEMaYzyTwcnK8aNfCae2D"), // relay2
  new PublicKey("7FZvQQE1VDq2fFSuBmCCxmo8tPNm9LfYqF9BMkbyp1by"), // relay3
  new PublicKey("55MyuYePgkwAExNqtdNY4zahSyiM3stjjRm3Ym36sTA8"), // reserved
];

function encodeU8(value) {
  const buf = Buffer.allocUnsafe(1);
  buf.writeUInt8(value);
  return buf;
}

async function main() {
  console.log("🔄 Migrating oracle from 8 assets to 10 assets");
  console.log("Program ID:", PROGRAM_ID.toBase58());
  console.log();

  // Load update authority (validator faucet wallet)
  const authorityPath = process.env.HOME + "/.config/solana/id.json";
  const authorityKey = Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(authorityPath, "utf-8")))
  );
  console.log("Authority Wallet:", authorityKey.publicKey.toBase58());

  // Derive state PDA
  const [statePda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from("state_v2")],
    PROGRAM_ID
  );
  console.log("State PDA:", statePda.toBase58());

  const connection = new Connection(RPC_URL, "confirmed");

  // Check existing state
  const accountInfo = await connection.getAccountInfo(statePda);
  if (!accountInfo) {
    console.log("\n❌ No existing state account found!");
    console.log("   Run: node init_new_program.cjs");
    return;
  }

  console.log("\n📊 Current State:");
  console.log("   Size:", accountInfo.data.length, "bytes (8-asset state)");
  console.log("   Expected for 10 assets: 674 bytes");

  // Step 1: Close old state
  console.log("\n🗑️  Step 1: Closing old 8-asset state...");

  const closeInstruction = {
    keys: [
      { pubkey: statePda, isSigner: false, isWritable: true },
      { pubkey: authorityKey.publicKey, isSigner: true, isWritable: false },
      { pubkey: authorityKey.publicKey, isSigner: false, isWritable: true }, // recipient
    ],
    programId: PROGRAM_ID,
    data: CLOSE_STATE_DISCRIMINATOR,
  };

  try {
    const closeTx = new Transaction().add(closeInstruction);
    const closeSig = await sendAndConfirmTransaction(connection, closeTx, [authorityKey], {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      commitment: "confirmed",
    });

    console.log("   ✅ Old state closed!");
    console.log("   Signature:", closeSig);

    // Wait for state to be closed
    await new Promise(r => setTimeout(r, 3000));
  } catch (err) {
    console.error("\n❌ Error closing state:", err.message);
    if (err.logs) {
      console.error("\nProgram logs:");
      err.logs.forEach(log => console.error("  ", log));
    }
    throw err;
  }

  // Step 2: Initialize new 10-asset state
  console.log("\n🚀 Step 2: Initializing new 10-asset state...");

  // Encode 4 allowed updater pubkeys + decimals
  const initData = Buffer.concat([
    INITIALIZE_DISCRIMINATOR,
    UPDATERS[0].toBuffer(),
    UPDATERS[1].toBuffer(),
    UPDATERS[2].toBuffer(),
    UPDATERS[3].toBuffer(),
    encodeU8(8), // decimals
  ]);

  const initInstruction = {
    keys: [
      { pubkey: statePda, isSigner: false, isWritable: true },
      { pubkey: authorityKey.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: initData,
  };

  try {
    const initTx = new Transaction().add(initInstruction);
    const initSig = await sendAndConfirmTransaction(connection, initTx, [authorityKey], {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      commitment: "confirmed",
    });

    console.log("   ✅ New state initialized!");
    console.log("   Signature:", initSig);

    // Verify new state
    await new Promise(r => setTimeout(r, 2000));
    const newAccountInfo = await connection.getAccountInfo(statePda);

    console.log("\n✅ Migration Complete!");
    console.log("   New state size:", newAccountInfo?.data.length, "bytes");
    console.log("   Assets: BTC, ETH, SOL, HYPE, ZEC, TSLA, NVDA, MSTR, GOLD, SILVER");

    if (newAccountInfo && newAccountInfo.data.length === 674) {
      console.log("   ✅ Correct size for 10 assets!");
    } else {
      console.log("   ⚠️  Unexpected size");
    }

  } catch (err) {
    console.error("\n❌ Error initializing:", err.message);
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
