#!/usr/bin/env node
/**
 * Close old state and reinitialize with 5-asset structure
 */

const anchor = require("@coral-xyz/anchor");
const { PublicKey, SystemProgram } = require("@solana/web3.js");
const fs = require("fs");

const PROGRAM_ID = new PublicKey("LuS6XnQ3qNXqNQvAJ3akXnEJRBv9XNoUricjMgTyCxX");
const STATE_SEED = Buffer.from("state_v2");

async function main() {
  // Setup provider
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL || "https://rpc.mainnet.x1.xyz";
  const walletPath = process.env.ANCHOR_WALLET || require("os").homedir() + "/.config/solana/id.json";

  const connection = new anchor.web3.Connection(rpcUrl, "confirmed");
  const wallet = new anchor.Wallet(
    anchor.web3.Keypair.fromSecretKey(
      Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf-8")))
    )
  );

  const provider = new anchor.AnchorProvider(connection, wallet, {
    commitment: "confirmed",
  });
  anchor.setProvider(provider);

  console.log("Using wallet:", provider.wallet.publicKey.toString());
  console.log("RPC URL:", provider.connection.rpcEndpoint);

  // Load IDL and create program
  const idlPath = "./target/idl/oracle.json";
  const idl = JSON.parse(fs.readFileSync(idlPath, "utf8"));
  const program = new anchor.Program(idl, PROGRAM_ID, provider);

  // Derive state PDA
  const [statePda, bump] = PublicKey.findProgramAddressSync([STATE_SEED], PROGRAM_ID);
  console.log("\nState PDA:", statePda.toString());

  // Check existing account
  const existingAccount = await provider.connection.getAccountInfo(statePda);

  if (existingAccount) {
    console.log("\n✓ Found existing state account");
    console.log("  Size:", existingAccount.data.length, "bytes");

    // Close the old state
    console.log("\n⚙️  Closing old state account...");

    try {
      const closeTx = await program.methods
        .closeState()
        .accounts({
          state: statePda,
          authority: provider.wallet.publicKey,
          recipient: provider.wallet.publicKey,
        })
        .rpc();

      console.log("✓ State closed successfully!");
      console.log("  Transaction:", closeTx);

      // Wait a bit
      await new Promise(resolve => setTimeout(resolve, 2000));

    } catch (err) {
      console.error("Error closing state:", err.message);
      if (err.logs) {
        console.error("Logs:", err.logs.join("\n"));
      }
      throw err;
    }
  }

  // Initialize with new structure
  console.log("\n⚙️  Initializing state with 5-asset structure (BTC, ETH, SOL, HYPE, ZEC)...");

  try {
    const initTx = await program.methods
      .initialize(provider.wallet.publicKey)
      .accounts({
        state: statePda,
        payer: provider.wallet.publicKey,
        systemProgram: SystemProgram.programId,
      })
      .rpc();

    console.log("✓ State initialized successfully!");
    console.log("  Transaction:", initTx);

    // Verify
    await new Promise(resolve => setTimeout(resolve, 2000));
    const newAccount = await provider.connection.getAccountInfo(statePda);
    console.log("\n✓ New state account:");
    console.log("  Size:", newAccount?.data.length, "bytes");
    console.log("  Expected: 362 bytes (8 discriminator + 354 data)");

    if (newAccount && newAccount.data.length === 362) {
      console.log("  ✅ Size is correct for 5 assets!");
    } else {
      console.log("  ⚠️  Size mismatch");
    }

  } catch (err) {
    console.error("Error initializing:", err.message);
    if (err.logs) {
      console.error("Logs:", err.logs.join("\n"));
    }
    throw err;
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
