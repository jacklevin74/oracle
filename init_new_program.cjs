#!/usr/bin/env node
/**
 * Initialize the new 10-asset oracle program
 */
const {Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction, SystemProgram} = require("@solana/web3.js");
const fs = require("fs");

const PROGRAM_ID = new PublicKey("wsTKwvC4uVwbamEHfCH6JexbvG6Ubkqav5v3U6ewKYL");
const RPC_URL = "https://rpc.mainnet.x1.xyz";

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
  console.log("🚀 Initializing new 10-asset oracle program");
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
  console.log("Bump:", bump);

  const connection = new Connection(RPC_URL, "confirmed");

  // Check if already initialized
  const accountInfo = await connection.getAccountInfo(statePda);
  if (accountInfo) {
    console.log("\n⚠️  State account already exists!");
    console.log("   Size:", accountInfo.data.length, "bytes");
    console.log("   Owner:", accountInfo.owner.toBase58());
    return;
  }

  console.log("\n📝 Building initialize instruction...");

  // Initialize instruction discriminator (anchor build generates this)
  const INIT_DISCRIMINATOR = Buffer.from([175, 175, 109, 31, 13, 152, 155, 237]);

  // Encode 4 allowed updater pubkeys
  const data = Buffer.concat([
    INIT_DISCRIMINATOR,
    UPDATERS[0].toBuffer(),
    UPDATERS[1].toBuffer(),
    UPDATERS[2].toBuffer(),
    UPDATERS[3].toBuffer(),
    encodeU8(8), // decimals
  ]);

  // State account size: 674 bytes (32 + 64*10 + 1 + 1)
  const STATE_SIZE = 674;
  const rentExemptLamports = await connection.getMinimumBalanceForRentExemption(STATE_SIZE);

  console.log("   State size:", STATE_SIZE, "bytes");
  console.log("   Rent-exempt lamports:", rentExemptLamports);

  const instruction = {
    keys: [
      { pubkey: statePda, isSigner: false, isWritable: true },
      { pubkey: authorityKey.publicKey, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    programId: PROGRAM_ID,
    data: data,
  };

  console.log("\n⚙️  Sending initialize transaction...");
  console.log("   Updater 1:", UPDATERS[0].toBase58());
  console.log("   Updater 2:", UPDATERS[1].toBase58());
  console.log("   Updater 3:", UPDATERS[2].toBase58());
  console.log("   Updater 4:", UPDATERS[3].toBase58());
  console.log("   Decimals: 8");

  try {
    const tx = new Transaction().add(instruction);

    const signature = await sendAndConfirmTransaction(connection, tx, [authorityKey], {
      skipPreflight: false,
      preflightCommitment: "confirmed",
      commitment: "confirmed",
    });

    console.log("\n✅ Initialization SUCCESSFUL!");
    console.log("   Signature:", signature);

    // Verify state was created
    await new Promise(r => setTimeout(r, 2000));
    const verifyInfo = await connection.getAccountInfo(statePda);
    console.log("\n✅ State account verified");
    console.log("   Size:", verifyInfo?.data.length, "bytes");
    console.log("   Owner:", verifyInfo?.owner.toBase58());

    console.log("\n🎉 New 10-asset oracle program is ready!");
    console.log("   You can now run: node test_10_assets.cjs");

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
