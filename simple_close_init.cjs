#!/usr/bin/env node
const {Connection, PublicKey, Keypair, SystemProgram, Transaction, sendAndConfirmTransaction} = require("@solana/web3.js");
const fs = require("fs");
const BN = require("bn.js");

const PROGRAM_ID = new PublicKey("LuS6XnQ3qNXqNQvAJ3akXnEJRBv9XNoUricjMgTyCxX");
const STATE_SEED = "state_v2";

// Instruction discriminators from IDL
const CLOSE_STATE_DISCRIMINATOR = Buffer.from([25, 1, 184, 101, 200, 245, 210, 246]);
const INITIALIZE_DISCRIMINATOR = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]);

async function main() {
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL || "https://rpc.mainnet.x1.xyz";
  const walletPath = process.env.ANCHOR_WALLET || require("os").homedir() + "/.config/solana/id.json";

  const connection = new Connection(rpcUrl, "confirmed");
  const payer = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(fs.readFileSync(walletPath, "utf-8"))));

  console.log("Using wallet:", payer.publicKey.toString());
  console.log("RPC URL:", rpcUrl);

  // Derive state PDA
  const [statePda, bump] = PublicKey.findProgramAddressSync(
    [Buffer.from(STATE_SEED)],
    PROGRAM_ID
  );
  console.log("\nState PDA:", statePda.toString());

  // Check existing account
  const existingAccount = await connection.getAccountInfo(statePda);

  if (existingAccount) {
    console.log("\n✓ Found existing state account");
    console.log("  Size:", existingAccount.data.length, "bytes");
    console.log("\n⚙️  Closing old state account...");

    // Build close instruction
    const closeIx = {
      keys: [
        { pubkey: statePda, isSigner: false, isWritable: true },
        { pubkey: payer.publicKey, isSigner: true, isWritable: false },
        { pubkey: payer.publicKey, isSigner: false, isWritable: true }, // recipient
      ],
      programId: PROGRAM_ID,
      data: CLOSE_STATE_DISCRIMINATOR,
    };

    const closeTx = new Transaction().add(closeIx);
    try {
      const closeSig = await sendAndConfirmTransaction(connection, closeTx, [payer], {
        commitment: "confirmed",
      });
      console.log("✓ State closed!");
      console.log("  Transaction:", closeSig);
      await new Promise(r => setTimeout(r, 3000));
    } catch (err) {
      console.error("Error closing:", err.message);
      if (err.logs) console.error("Logs:", err.logs.join("\n"));
      throw err;
    }
  } else {
    console.log("\n✗ No existing state account");
  }

  // Initialize with new structure
  console.log("\n⚙️  Initializing state with 5-asset structure...");

  // Serialize update_authority pubkey (32 bytes)
  const updateAuthorityBytes = payer.publicKey.toBuffer();

  // Build initialize instruction data: discriminator (8) + update_authority (32)
  const initData = Buffer.concat([INITIALIZE_DISCRIMINATOR, updateAuthorityBytes]);

  const initIx = {
    keys: [
      { pubkey: statePda, isSigner: false, isWritable: true },
      { pubkey: payer.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: initData,
  };

  const initTx = new Transaction().add(initIx);
  try {
    const initSig = await sendAndConfirmTransaction(connection, initTx, [payer], {
      commitment: "confirmed",
    });
    console.log("✓ State initialized!");
    console.log("  Transaction:", initSig);

    await new Promise(r => setTimeout(r, 2000));

    const newAccount = await connection.getAccountInfo(statePda);
    console.log("\n✓ New state account:");
    console.log("  Size:", newAccount?.data.length, "bytes");
    console.log("  Expected: 362 bytes");

    if (newAccount && newAccount.data.length === 362) {
      console.log("  ✅ Correct size for 5 assets (BTC, ETH, SOL, HYPE, ZEC)!");
    } else {
      console.log("  ⚠️  Size mismatch");
    }
  } catch (err) {
    console.error("Error initializing:", err.message);
    if (err.logs) console.error("Logs:", err.logs.join("\n"));
    throw err;
  }
}

main()
  .then(() => {
    console.log("\n✅ Done!");
    process.exit(0);
  })
  .catch(err => {
    console.error("\n❌ Error:", err);
    process.exit(1);
  });
