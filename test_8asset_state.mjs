#!/usr/bin/env node
import { Connection, PublicKey } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("CcgTMiYkgVfz7cAGkD6835BqfycG5N5Y4aPPHYW1EvKx"); // TEST
const STATE_SEED = Buffer.from("state_v2");
const RPC_URL = "https://rpc.mainnet.x1.xyz";

console.log("🧪 Testing 8-asset oracle state...");
console.log("Program ID:", PROGRAM_ID.toBase58());

const conn = new Connection(RPC_URL, "processed");
const [pda] = PublicKey.findProgramAddressSync([STATE_SEED], PROGRAM_ID);

console.log("State PDA:", pda.toBase58());

try {
  const res = await conn.getAccountInfo(pda);

  if (!res) {
    console.log("❌ Account does not exist");
    process.exit(1);
  }

  console.log("✅ Account exists!");
  console.log("   Size:", res.data.length, "bytes");
  console.log("   Owner:", res.owner.toBase58());
  console.log("   Expected: 554 bytes (8 assets with Anchor discriminator)");

  if (res.data.length === 554) {
    console.log("   ✅ Correct size!");
  } else {
    console.log("   ⚠️  Unexpected size");
  }

  // Decode update authority (skip 8-byte discriminator)
  const updateAuthority = new PublicKey(res.data.slice(8, 40));
  console.log("\n   Update Authority:", updateAuthority.toBase58());

  console.log("\n✅ Test program state is ready for batch price updates!");
} catch (error) {
  console.error("❌ Error:", error.message);
  process.exit(1);
}
