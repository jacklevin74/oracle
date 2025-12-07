import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, SystemProgram, Keypair } from "@solana/web3.js";
import { Oracle } from "./target/types/oracle";

const PROGRAM_ID = new PublicKey("LuS6XnQ3qNXqNQvAJ3akXnEJRBv9XNoUricjMgTyCxX");
const STATE_SEED = Buffer.from("state_v2");

//jack

async function main() {
  // Setup provider
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.Oracle as Program<Oracle>;

  console.log("Using wallet:", provider.wallet.publicKey.toString());
  console.log("RPC URL:", provider.connection.rpcEndpoint);
  console.log("Program ID:", program.programId.toString());

  // Derive the state PDA
  const [statePda, bump] = PublicKey.findProgramAddressSync(
    [STATE_SEED],
    program.programId
  );

  console.log("\nState PDA:", statePda.toString());

  // Check existing state
  const existingAccount = await provider.connection.getAccountInfo(statePda);

  if (existingAccount) {
    console.log("\n✓ Found existing state account");
    console.log("  Size:", existingAccount.data.length, "bytes");
    console.log("  Owner:", existingAccount.owner.toString());

    // The account exists but is too small
    // We need to transfer it to a new temporary account and close it
    console.log("\n⚠️  Account exists with wrong size (needs 362 bytes)");
    console.log("⚠️  Cannot automatically close program-owned accounts");
    console.log("⚠️  Need to add a 'close' instruction to the program");

    console.log("\nSuggested fix:");
    console.log("1. Add a close instruction to programs/oracle/src/lib.rs");
    console.log("2. Redeploy the program");
    console.log("3. Call the close instruction");
    console.log("4. Re-run this script");

    return;
  }

  // Initialize with new structure
  console.log("\n⚙️  Initializing state with 5-asset structure...");

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

    // Verify
    const newAccount = await provider.connection.getAccountInfo(statePda);
    console.log("\n✓ New state account:");
    console.log("  Size:", newAccount?.data.length, "bytes");
    console.log("  Expected: 362 bytes");

    if (newAccount && newAccount.data.length === 362) {
      console.log("  ✅ Size is correct for 5 assets (BTC, ETH, SOL, HYPE, ZEC)!");
    }

  } catch (err: any) {
    console.error("Error:", err.message);
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
