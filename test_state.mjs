#!/usr/bin/env node
import { Connection, PublicKey } from "@solana/web3.js";

const PROGRAM_ID = new PublicKey("LuS6XnQ3qNXqNQvAJ3akXnEJRBv9XNoUricjMgTyCxX");
const STATE_SEED = Buffer.from("state_v2");
const RPC_URL = process.env.RPC_URL || "https://rpc.mainnet.x1.xyz";

async function test() {
  console.log("Testing oracle state...");
  console.log("RPC:", RPC_URL);

  const conn = new Connection(RPC_URL, "processed");
  const [pda] = PublicKey.findProgramAddressSync([STATE_SEED], PROGRAM_ID);

  console.log("PDA:", pda.toBase58());
  console.log("Fetching account info...");

  try {
    const startTime = Date.now();
    const res = await conn.getAccountInfo(pda);
    const elapsed = Date.now() - startTime;

    console.log(`Response received in ${elapsed}ms`);

    if (!res) {
      console.log("Account does not exist");
      process.exit(1);
    }

    console.log("Account exists!");
    console.log("Data length:", res.data.length);
    console.log("Owner:", res.owner.toBase58());

  } catch (error) {
    console.error("Error:", error.message);
    process.exit(1);
  }
}

test();
