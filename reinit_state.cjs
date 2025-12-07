#!/usr/bin/env node
/**
 * Script to close old state account and reinitialize with 5-asset structure
 */

const anchor = require("@coral-xyz/anchor");
const { PublicKey, SystemProgram } = require("@solana/web3.js");
const fs = require("fs");

const PROGRAM_ID = new PublicKey("LuS6XnQ3qNXqNQvAJ3akXnEJRBv9XNoUricjMgTyCxX");
const STATE_SEED = Buffer.from("state_v2");

async function main() {
  // Setup provider from Anchor
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  console.log("Using wallet:", provider.wallet.publicKey.toString());
  console.log("RPC URL:", provider.connection.rpcEndpoint);

  // Load the program
  const idlPath = "./target/idl/oracle.json";
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  const program = new anchor.Program(idl, PROGRAM_ID, provider);

  // Derive the state PDA
  const [statePda, bump] = PublicKey.findProgramAddressSync(
    [STATE_SEED],
    program.programId
  );

  console.log("\nState PDA:", statePda.toString());

  // Check if state account exists
  const stateAccount = await provider.connection.getAccountInfo(statePda);

  if (stateAccount) {
    console.log("\n✓ Found existing state account");
    console.log("  Size:", stateAccount.data.length, "bytes");
    console.log("  Owner:", stateAccount.owner.toString());

    // Close the account (this returns lamports to the wallet)
    console.log("\n⚙️  Closing old state account...");

    try {
      // We need to use a raw transaction to close the account
      // since there's no close instruction in the program
      // Instead, we'll just reinitialize over it (Anchor will reallocate if needed)
      console.log("Note: Will reinitialize over existing account");
    } catch (err) {
      console.error("Error:", err.message);
    }
  } else {
    console.log("\n✗ No existing state account found");
  }

  // Initialize with new structure
  console.log("\n⚙️  Initializing state with 5-asset structure (BTC, ETH, SOL, HYPE, ZEC)...");

  try {
    const tx = await program.methods
      .initialize(provider.wallet.publicKey)
      .accounts({
        state: statePda,
        payer: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("✓ State initialized successfully!");
    console.log("  Transaction:", tx);

    // Verify the new state
    const newStateAccount = await provider.connection.getAccountInfo(statePda);
    console.log("\n✓ New state account:");
    console.log("  Size:", newStateAccount.data.length, "bytes");
    console.log("  Expected: 362 bytes (8 discriminator + 32 + 64*5 + 2)");

    if (newStateAccount.data.length === 362) {
      console.log("  ✅ Size is correct for 5 assets!");
    } else {
      console.log("  ⚠️  Size mismatch - expected 362 bytes");
    }

  } catch (err) {
    if (err.message && err.message.includes("already in use")) {
      console.log("\n⚠️  Account already initialized");
      console.log("You may need to manually close it first using 'solana program close'");
      console.log("Or upgrade the program to include a close instruction");
    } else {
      console.error("Error initializing:", err.message);
      throw err;
    }
  }
}

main()
  .then(() => {
    console.log("\n✅ Done!");
    process.exit(0);
  })
  .catch((err) => {
    console.error("\n❌ Error:", err);
    process.exit(1);
  });
