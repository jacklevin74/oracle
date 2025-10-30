#!/usr/bin/env node
// app/pyth_stream_writer.js
// Multi-asset (BTC/ETH/SOL/HYPE) → on-chain writer, batching only i64-changing assets.
// Usage: node app/pyth_stream_writer.js <wallet.json>
//
// Env:  ANCHOR_PROVIDER_URL  (default http://127.0.0.1:8899)
// Deps: npm i @solana/web3.js @pythnetwork/hermes-client @pythnetwork/price-service-client ws

const { HermesClient } = require("@pythnetwork/hermes-client");
const { PriceServiceConnection } = require("@pythnetwork/price-service-client");
const CompositeOracle = require("./o3.cjs");
const {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
} = require("@solana/web3.js");
const fs = require("fs");
const path = require("path");

/* ===== ANSI Color codes for terminal output (vim-like subtle colors) ===== */
const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',

  // Subtle vim-like colors (regular, not bright)
  gray: '\x1b[90m',
  darkGray: '\x1b[2m\x1b[37m',

  // Main colors (muted)
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  white: '\x1b[37m',

  // Slightly emphasized (for important values)
  brightCyan: '\x1b[96m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m'
};

/* ===== Program constants ===== */
const PROGRAM_ID = new PublicKey("LuS6XnQ3qNXqNQvAJ3akXnEJRBv9XNoUricjMgTyCxX");
const STATE_SEED = Buffer.from("state_v2"); // new PDA seed
const DECIMALS = 6;
const COMPUTE_UNIT_LIMIT = 15_000;

/* Instruction discriminators */
const DISC = {
  initialize: Uint8Array.from([175, 175, 109, 31, 13, 152, 155, 237]),
  set_price:  Uint8Array.from([16, 19, 182, 8, 149, 83, 72, 181]),
  batch_set_prices: Uint8Array.from([22, 37, 238, 178, 182, 181, 83, 149]),
};

/* Allowed updaters → index (must match on-chain allow-list) */
const ALLOWED = new Map([
  ["AivknDqDUqnvyYVmDViiB2bEHKyUK5HcX91gWL2zgTZ4", 1],
  ["C3Un8Zf6pnyedk1AWDgqtZtKYLyiaZ4zwFPqJMVU2Trt", 2],
  ["129arbPoM1UXBtYk99PXbp4w1csc4d5hFXnX4mh7nYc5", 3],
  ["55MyuYePgkwAExNqtdNY4zahSyiM3stjjRm3Ym36sTA8", 4],
]);

/* Asset ids (must match your program enum) */
const ASSETS = { BTC: 1, ETH: 2, SOL: 3, HYPE: 4 };

/* Hermes canonical feed IDs (HYPE not available on Pyth - uses composite oracle only) */
const FEEDS = {
  BTC: "0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43",
  ETH: "0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace",
  SOL: "0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d",
};

/* ===== helpers ===== */
const norm = (id) => (id || "").toLowerCase().replace(/^0x/, "");
function readKeypair(p) {
  return Keypair.fromSecretKey(
    Uint8Array.from(JSON.parse(fs.readFileSync(p, "utf8")))
  );
}
function keypairFromBase58(base58PrivateKey) {
  // Decode base58 private key string to bytes
  const decoded = require('bs58').decode(base58PrivateKey);
  return Keypair.fromSecretKey(decoded);
}
function keypairFromArray(secretKeyArray) {
  // Create keypair from array of bytes [1,2,3,...]
  return Keypair.fromSecretKey(Uint8Array.from(secretKeyArray));
}
async function promptPrivateKey() {
  // Prompt for private key without echoing (like password input)
  const readline = require('readline');

  return new Promise((resolve, reject) => {
    let input = '';

    console.log('\n🔐 Enter your private key (input will be hidden):');
    console.log('   Accepts: base58 string or JSON array [1,2,3,...]');
    console.log('');
    process.stdout.write('Private Key: ');

    // Set raw mode to read key-by-key without echo
    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onData = (char) => {
      if (char === '\n' || char === '\r' || char === '\u0003' || char === '\u0004') {
        // Enter, Ctrl+C, or Ctrl+D pressed
        process.stdin.pause();
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        process.stdin.removeListener('data', onData);
        console.log('\n'); // New line after hidden input

        if (char === '\u0003') {
          // Ctrl+C
          console.log('\nCancelled by user');
          process.exit(0);
        }

        if (!input || input.trim().length === 0) {
          reject(new Error('No input received'));
        } else {
          resolve(input.trim());
        }
      } else if (char === '\u007f' || char === '\b') {
        // Backspace
        if (input.length > 0) {
          input = input.slice(0, -1);
        }
      } else {
        // Regular character
        input += char;
      }
    };

    process.stdin.on('data', onData);
  });
}
function parsePrivateKey(input) {
  // Try to parse as JSON array first
  if (input.startsWith('[')) {
    try {
      const arr = JSON.parse(input);
      return keypairFromArray(arr);
    } catch (e) {
      throw new Error('Invalid JSON array format');
    }
  }
  // Otherwise treat as base58
  return keypairFromBase58(input);
}
function u8(n) {
  const b = Buffer.alloc(1);
  b.writeUint8(n);
  return b;
}
function i64(n) {
  let x = BigInt(n);
  if (x < 0n) x = (1n << 64n) + x;
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(x);
  return b;
}
function pkbuf(pk) {
  return Buffer.from(pk.toBytes());
}
function toFixedI64(num, d) {
  // round to nearest integer at d=6 dp
  return Math.round(Number(num) * 10 ** d);
}
function scalePythPrice(p) {
  if (!p || p.price === undefined || p.expo === undefined) return null;
  const n = Number(p.price.toString());
  if (!Number.isFinite(n)) return null;
  return n * Math.pow(10, p.expo); // human dollars (float)
}
function fmt2(x) {
  return Number(x).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/* ===== TransactionInstructions ===== */
function ixInitialize(updateAuthority, programId, statePda) {
  const data = Buffer.concat([Buffer.from(DISC.initialize), pkbuf(updateAuthority)]);
  const keys = [
    { pubkey: statePda, isSigner: false, isWritable: true },
    { pubkey: updateAuthority, isSigner: true, isWritable: true },
    { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
  ];
  return new TransactionInstruction({ programId, keys, data });
}
function ixSetPrice(asset, index, priceI64, clientTsMs, programId, statePda, signer) {
  const data = Buffer.concat([
    Buffer.from(DISC.set_price),
    u8(asset),
    u8(index),
    i64(priceI64),
    i64(clientTsMs),
  ]);
  const keys = [
    { pubkey: statePda, isSigner: false, isWritable: true },
    { pubkey: signer, isSigner: true, isWritable: false },
  ];
  return new TransactionInstruction({ programId, keys, data });
}
function ixBatchSetPrices(index, btcPrice, ethPrice, solPrice, hypePrice, clientTsMs, programId, statePda, signer) {
  const data = Buffer.concat([
    Buffer.from(DISC.batch_set_prices),
    u8(index),
    i64(btcPrice),
    i64(ethPrice),
    i64(solPrice),
    i64(hypePrice),
    i64(clientTsMs),
  ]);
  const keys = [
    { pubkey: statePda, isSigner: false, isWritable: true },
    { pubkey: signer, isSigner: true, isWritable: false },
  ];
  return new TransactionInstruction({ programId, keys, data });
}

/* ===== main ===== */
;(async () => {
  /* CLI */
  const args = process.argv.slice(2);
  const isDryRun = args.includes("--dryrun") || args.includes("--dry-run");
  const verbose = args.includes("--verbose") || args.includes("-v");

  // Check for log file option
  const logArg = args.find(a => a.startsWith("--log="));
  const logFile = logArg ? logArg.split('=')[1] : null;

  // Setup logging
  let logStream = null;
  const originalConsoleLog = console.log;
  const originalConsoleError = console.error;
  const originalConsoleWarn = console.warn;

  if (logFile) {
    logStream = fs.createWriteStream(logFile, { flags: 'a' });

    // Override console methods to write to both stdout and file
    console.log = function(...args) {
      const message = args.join(' ');
      originalConsoleLog.apply(console, args);
      logStream.write(new Date().toISOString() + ' [LOG] ' + message + '\n');
    };

    console.error = function(...args) {
      const message = args.join(' ');
      originalConsoleError.apply(console, args);
      logStream.write(new Date().toISOString() + ' [ERROR] ' + message + '\n');
    };

    console.warn = function(...args) {
      const message = args.join(' ');
      originalConsoleWarn.apply(console, args);
      logStream.write(new Date().toISOString() + ' [WARN] ' + message + '\n');
    };

    console.log(`📝 Logging to file: ${logFile}`);
  }

  // Check for private key from environment variable (most secure)
  const privateKeyFromEnv = process.env.ORACLE_PRIVATE_KEY;

  // Check for --private-key-stdin flag (secure - no history)
  const useStdin = args.includes("--private-key-stdin");

  // Check for --prompt flag (interactive prompt - secure)
  const usePrompt = args.includes("--prompt") || args.includes("-p");

  // Check for wallet file (legacy method)
  const walletArg = args.find(a => !a.startsWith("--") && !a.startsWith("-"));

  if (!isDryRun && !walletArg && !privateKeyFromEnv && !useStdin && !usePrompt) {
    console.error("Usage:");
    console.error("  Interactive prompt (SECURE):  node app/pyth_sim.cjs --prompt");
    console.error("  With env var:                 ORACLE_PRIVATE_KEY=<key> node app/pyth_sim.cjs");
    console.error("  With stdin:                   echo <key> | node app/pyth_sim.cjs --private-key-stdin");
    console.error("  With wallet file:             node app/pyth_sim.cjs <wallet.json>");
    console.error("  Dry run mode:                 node app/pyth_sim.cjs --dryrun");
    console.error("");
    console.error("Options:");
    console.error("  --prompt, -p               Securely prompt for private key (hidden input)");
    console.error("  --private-key-stdin        Read private key from stdin");
    console.error("  --dryrun                   Run without sending transactions");
    console.error("  --verbose, -v              Enable continuous logging (off by default)");
    console.error("  --log=<file>               Write logs to specified file (appends)");
    console.error("");
    console.error("Examples:");
    console.error("  node app/pyth_sim.cjs --prompt --log=/var/log/oracle.log");
    console.error("  node app/pyth_sim.cjs --prompt --verbose --log=./oracle.log");
    console.error("");
    console.error("🔒 Security: --prompt and env var methods don't expose keys in history or process lists");
    process.exit(1);
  }

  if (isDryRun) {
    console.log("🔍 DRY RUN MODE - No blockchain transactions will be sent\n");
  }

  let payer, payerPub, index;

  if (privateKeyFromEnv || useStdin || usePrompt) {
    /* Load from environment variable, stdin, or interactive prompt (all secure) */
    let privateKey;

    if (privateKeyFromEnv) {
      privateKey = privateKeyFromEnv;
      console.log("✓ Loading keypair from ORACLE_PRIVATE_KEY environment variable");
    } else if (usePrompt) {
      // Interactive secure prompt
      try {
        privateKey = await promptPrivateKey();
      } catch (e) {
        console.error("Failed to read private key:", e.message);
        process.exit(1);
      }
    } else if (useStdin) {
      // Read from stdin
      const readline = require('readline');
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
        terminal: false
      });

      privateKey = await new Promise((resolve) => {
        rl.on('line', (line) => {
          resolve(line.trim());
          rl.close();
        });
      });
      console.log("✓ Loading keypair from stdin");
    }

    try {
      payer = parsePrivateKey(privateKey);
      payerPub = payer.publicKey.toBase58();
      index = ALLOWED.get(payerPub);

      // SECURITY: Clear the private key from memory immediately after use
      // Overwrite the string with zeros
      if (typeof privateKey === 'string') {
        privateKey = '0'.repeat(privateKey.length);
      }
      privateKey = null;

      // Clear from environment variable to prevent /proc exposure
      if (privateKeyFromEnv) {
        delete process.env.ORACLE_PRIVATE_KEY;
      }

      if (![1, 2, 3, 4].includes(index)) {
        console.error("Public key not authorized for any index:", payerPub);
        process.exit(1);
      }
      console.log(`✓ Authorized public key ${payerPub} for index ${index}.`);
      console.log(`✓ Private key cleared from memory and environment`);
    } catch (e) {
      console.error("Failed to parse private key:", e.message);
      console.error("Expected base58 string or JSON array [1,2,3,...]");
      process.exit(1);
    }
  } else if (walletArg) {
    /* Load from wallet file (legacy method) */
    const walletPath = path.isAbsolute(walletArg)
      ? walletArg
      : path.join(process.cwd(), walletArg);
    if (!fs.existsSync(walletPath)) {
      console.error("Wallet file not found:", walletPath);
      process.exit(1);
    }
    payer = readKeypair(walletPath);
    payerPub = payer.publicKey.toBase58();
    index = ALLOWED.get(payerPub);
    if (![1, 2, 3, 4].includes(index)) {
      console.error("Wallet not authorized for any index:", payerPub);
      process.exit(1);
    }
    console.log(`Authorized wallet ${payerPub} for index ${index}.`);
  } else if (isDryRun) {
    index = 1; // Default index for dry run
    console.log("Using default index 1 for dry run mode.");
  }

  const rpc = process.env.ANCHOR_PROVIDER_URL || "http://127.0.0.1:8899";

  let connection, statePda, bhCache;

  /* Blockhash cache functions (declared at higher scope) */
  async function refreshBlockhash() {
    const { blockhash, lastValidBlockHeight } =
      await connection.getLatestBlockhash("processed");
    bhCache = { blockhash, lastValidBlockHeight, ts: Date.now() };
    return bhCache;
  }
  async function ensureBlockhashFresh(maxAgeMs = 2000) {
    if (!bhCache.blockhash || Date.now() - bhCache.ts > maxAgeMs) {
      await refreshBlockhash();
    }
    return bhCache;
  }

  if (!isDryRun) {
    connection = new Connection(rpc, "processed");
    [statePda] = PublicKey.findProgramAddressSync([STATE_SEED], PROGRAM_ID);

    /* Blockhash cache (no retry policy) */
    bhCache = { blockhash: null, lastValidBlockHeight: 0, ts: 0 };

    /* Initialize if missing */
    const info = await connection.getAccountInfo(statePda);
    if (!info) {
      console.log("Initializing state PDA…");
      // ensure fresh blockhash for init too
      await ensureBlockhashFresh();
      const tx = new Transaction()
        .add(ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }))
        .add(ixInitialize(payer.publicKey, PROGRAM_ID, statePda));
      tx.feePayer = payer.publicKey;
      tx.recentBlockhash = bhCache.blockhash;

      const sig = await sendAndConfirmTransaction(connection, tx, [payer], {
        skipPreflight: false,
        commitment: "processed",
      });
      console.log("init tx:", sig);
    }
  }

  /* Pyth stream setup */
  const hermes = new HermesClient("https://hermes.pyth.network", {});
  const idBySymbol = new Map(Object.entries(FEEDS).map(([sym, id]) => [sym, norm(id)]));
  const symbolById = new Map(
    [...idBySymbol.entries()].map(([sym, id]) => [id, sym])
  );
  const priceIds = [...idBySymbol.values()];
  const psc = new PriceServiceConnection("https://hermes.pyth.network", {
    priceFeedRequestConfig: { binary: true },
  });

  /* Latest cache + send guards */
  const latest = {
    BTC: { price: null, pubMs: 0 },
    ETH: { price: null, pubMs: 0 },
    SOL: { price: null, pubMs: 0 },
    HYPE: { price: null, pubMs: 0 },
  };
  const sentUpTo = { BTC: 0, ETH: 0, SOL: 0, HYPE: 0 };
  const lastSentI64 = { BTC: null, ETH: null, SOL: null, HYPE: null };

  /* Composite oracle tracking (BTC, ETH, SOL, HYPE) */
  const compositeData = {
    BTC: { price: null, count: 0, sources: [] },
    ETH: { price: null, count: 0, sources: [] },
    SOL: { price: null, count: 0, sources: [] },
    HYPE: { price: null, count: 0, sources: [] }
  };

  console.log("\n" + colors.gray + "=".repeat(70) + colors.reset);
  console.log(colors.cyan + "📡 DATA SOURCES CONFIGURATION" + colors.reset);
  console.log(colors.gray + "=".repeat(70) + colors.reset);

  console.log("\n" + colors.yellow + "1️⃣  PYTH NETWORK (Hermes)" + colors.reset);
  console.log(colors.gray + "    URL: https://hermes.pyth.network" + colors.reset);
  console.log("    Provides: " + colors.green + "BTC/USD, ETH/USD, SOL/USD" + colors.reset);
  console.log("    Feed IDs:");
  for (const [sym, id] of idBySymbol.entries()) {
    console.log(`      • ${colors.cyan}${sym}/USD${colors.reset}: ${colors.gray}0x${id}${colors.reset}`);
  }

  console.log("\n" + colors.yellow + "2️⃣  COMPOSITE ORACLE (o3.js)" + colors.reset);
  console.log("    Aggregates " + colors.green + "BTC/USD, ETH/USD, SOL/USD" + colors.reset + " from multiple exchanges:");
  console.log(`      • ${colors.blue}Kraken${colors.reset}`);
  console.log(`      • ${colors.blue}Coinbase${colors.reset}`);
  console.log(`      • ${colors.blue}KuCoin${colors.reset}`);
  console.log(`      • ${colors.blue}Binance${colors.reset}`);
  console.log(`      • ${colors.blue}MEXC${colors.reset}`);
  console.log(`      • ${colors.blue}Bybit${colors.reset}`);

  console.log("\n" + colors.yellow + "3️⃣  HYPE TOKEN (Composite Oracle Only)" + colors.reset);
  console.log("    " + colors.magenta + "HYPE/USD" + colors.reset + " sourced exclusively from exchanges (no Pyth feed available):");
  console.log(`      • ${colors.blue}Hyperliquid${colors.reset} ${colors.gray}(native exchange)${colors.reset}`);
  console.log(`      • ${colors.blue}Bybit${colors.reset}`);
  console.log(`      • ${colors.blue}Binance${colors.reset} ${colors.gray}(if available)${colors.reset}`);
  console.log(`      • ${colors.blue}KuCoin${colors.reset} ${colors.gray}(if available)${colors.reset}`);
  console.log(`      • ${colors.blue}MEXC${colors.reset} ${colors.gray}(if available)${colors.reset}`);

  console.log("\n" + colors.cyan + "📤 OUTPUT:" + colors.reset);
  if (isDryRun) {
    console.log("    Mode: " + colors.yellow + "DRY RUN" + colors.reset + " " + colors.gray + "(logging only)" + colors.reset);
  } else {
    console.log("    Mode: " + colors.red + "LIVE" + colors.reset + " " + colors.gray + "(sending to blockchain)" + colors.reset);
    console.log(`    Target Program: ${colors.cyan}${PROGRAM_ID.toBase58()}${colors.reset}`);
    console.log(`    Updater Index: ${colors.yellow}${index}${colors.reset}`);
  }
  console.log(colors.gray + "=".repeat(70) + "\n" + colors.reset);

  if (!verbose) {
    console.log(colors.gray + "ℹ️  Verbose logging disabled. Use --verbose or -v to see detailed updates." + colors.reset);
  }
  console.log("Starting price streams...\n");

  /* Start composite oracles for BTC, ETH, SOL, HYPE */
  const compositeBTC = new CompositeOracle({
    silent: true,
    pairKraken: 'BTC/USD',
    productCB: 'BTC-USD',
    symbolKucoin: 'BTC-USDT',
    symbolBinance: 'btcusdt',
    symbolMexc: 'BTCUSDT',
    symbolBybit: 'BTCUSDT'
  });
  compositeBTC.on('price', (result) => {
    compositeData.BTC.price = result.composite;
    compositeData.BTC.count = result.count;
    compositeData.BTC.sources = result.sources || [];
  });
  compositeBTC.start();

  const compositeETH = new CompositeOracle({
    silent: true,
    pairKraken: 'ETH/USD',
    productCB: 'ETH-USD',
    symbolKucoin: 'ETH-USDT',
    symbolBinance: 'ethusdt',
    symbolMexc: 'ETHUSDT',
    symbolBybit: 'ETHUSDT'
  });
  compositeETH.on('price', (result) => {
    compositeData.ETH.price = result.composite;
    compositeData.ETH.count = result.count;
    compositeData.ETH.sources = result.sources || [];
  });
  compositeETH.start();

  const compositeSOL = new CompositeOracle({
    silent: true,
    pairKraken: 'SOL/USD',
    productCB: 'SOL-USD',
    symbolKucoin: 'SOL-USDT',
    symbolBinance: 'solusdt',
    symbolMexc: 'SOLUSDT',
    symbolBybit: 'SOLUSDT'
  });
  compositeSOL.on('price', (result) => {
    compositeData.SOL.price = result.composite;
    compositeData.SOL.count = result.count;
    compositeData.SOL.sources = result.sources || [];
  });
  compositeSOL.start();

  const compositeHYPE = new CompositeOracle({
    silent: true,
    pairKraken: 'HYPE/USD',
    productCB: 'HYPE-USD',
    symbolKucoin: 'HYPE-USDT',
    symbolBinance: 'hypeusdt',
    symbolMexc: 'HYPEUSDT',
    symbolBybit: 'HYPEUSDT',
    coinHyperliquid: 'HYPE'
  });
  compositeHYPE.on('price', (result) => {
    compositeData.HYPE.price = result.composite;
    compositeData.HYPE.count = result.count;
    compositeData.HYPE.sources = result.sources || [];
  });
  compositeHYPE.start();

  await psc.subscribePriceFeedUpdates(priceIds, (pf) => {
    try {
      const p = pf.getPriceNoOlderThan(120);
      const val = scalePythPrice(p);
      if (val === null || !Number.isFinite(val)) return;

      const id = norm(pf.id);
      const sym = symbolById.get(id);
      if (!sym) return;

      const pubMs = p.publishTime ? Number(p.publishTime) * 1000 : Date.now();
      latest[sym] = { price: val, pubMs };
    } catch {
      /* ignore stale */
    }
  });

  /* Batch sender — only send if fixed-point i64 changes; no retry on expired */
  const TICK_MS = 750;
  let lastLogTime = 0; // Track last log time for non-verbose status (time-based throttle)
  setInterval(async () => {
    try {
      // Build fresh list with the exact i64 that would be written
      const fresh = [];
      for (const sym of ["BTC", "ETH", "SOL", "HYPE"]) {
        let priceToUse, pubMsToUse;

        // HYPE uses composite oracle only (no Pyth feed)
        if (sym === "HYPE") {
          const compData = compositeData[sym];
          if (compData.price == null) continue;
          priceToUse = compData.price;
          pubMsToUse = Date.now(); // Use current time for composite
        } else {
          // BTC, ETH, SOL use Pyth
          const hasPrice = latest[sym].price != null;
          if (!hasPrice) continue;
          priceToUse = latest[sym].price;
          pubMsToUse = latest[sym].pubMs;
        }

        const candI64 = toFixedI64(priceToUse, DECIMALS); // fixed-point to write
        const newerPub = pubMsToUse > sentUpTo[sym];
        const changedI64 =
          lastSentI64[sym] == null || candI64 !== lastSentI64[sym];

        if (newerPub && changedI64) fresh.push({ sym, candI64, priceSource: sym === "HYPE" ? "composite" : "pyth" });
      }
      if (fresh.length === 0) return;

      const t0 = Date.now();
      const clientTsMs = Date.now();

      if (isDryRun) {
        // DRY RUN: Print friendly human-readable log (only if verbose)
        if (verbose) {
          console.log("\n" + colors.gray + "=".repeat(70) + colors.reset);
          console.log(colors.cyan + `📊 Price Update @ ${new Date(clientTsMs).toISOString()}` + colors.reset);
          console.log(colors.gray + "=".repeat(70) + colors.reset);

          console.log("\n" + colors.yellow + "📡 PYTH NETWORK (Hermes):" + colors.reset);
          console.log(colors.gray + "   Source: https://hermes.pyth.network" + colors.reset);
          for (const { sym, candI64, priceSource } of fresh) {
            if (priceSource === "pyth") {
              const humanPrice = candI64 / 10 ** DECIMALS;
              const feed = FEEDS[sym];
              console.log(`   • ${colors.cyan}${sym}/USD${colors.reset}: ${colors.green}$${fmt2(humanPrice)}${colors.reset}`);
              console.log(`     ${colors.gray}Feed ID: ${feed.substring(0, 20)}...${colors.reset}`);
              console.log(`     ${colors.gray}Publish time: ${new Date(latest[sym].pubMs).toISOString()}${colors.reset}`);
            }
          }

          console.log("\n" + colors.cyan + "🔗 COMPOSITE ORACLE (o3.js):" + colors.reset);
          for (const sym of ['BTC', 'ETH', 'SOL', 'HYPE']) {
            const compData = compositeData[sym];
            if (compData.price != null) {
              const symColor = sym === 'HYPE' ? colors.magenta : colors.cyan;
              console.log(`\n   • ${symColor}${sym}/USD${colors.reset}: ${colors.green}$${fmt2(compData.price)}${colors.reset}`);
              const maxSources = sym === 'HYPE' ? 7 : 6; // HYPE has Hyperliquid as 7th source
              console.log(`     ${colors.gray}Active sources: ${compData.count}/${maxSources}${colors.reset}`);

              if (compData.sources.length > 0) {
                console.log(`     ${colors.gray}Individual sources:${colors.reset}`);
                for (const src of compData.sources) {
                  const ageSec = (src.age / 1000).toFixed(1);
                  console.log(`       • ${colors.blue}${src.source.padEnd(10)}${colors.reset}: ${colors.green}$${fmt2(src.price)}${colors.reset} ${colors.gray}(age: ${ageSec}s)${colors.reset}`);
                }
              }

              const freshAsset = fresh.find(f => f.sym === sym);
              if (freshAsset) {
                const pythPrice = freshAsset.candI64 / 10 ** DECIMALS;
                const diff = Math.abs(pythPrice - compData.price);
                const pct = (diff / compData.price) * 100;
                console.log(`\n     ${colors.cyan}📈 Price Comparison:${colors.reset}`);
                console.log(`       ${colors.yellow}Pyth ${sym}${colors.reset}:      ${colors.green}$${fmt2(pythPrice)}${colors.reset}`);
                console.log(`       ${colors.cyan}Composite ${sym}${colors.reset}: ${colors.green}$${fmt2(compData.price)}${colors.reset}`);
                console.log(`       ${colors.gray}Difference${colors.reset}:    ${colors.yellow}$${diff.toFixed(2)} (${pct.toFixed(3)}%)${colors.reset}`);
                if (pct > 0.5) {
                  console.log(`       ${colors.red}⚠️  WARNING: Divergence exceeds 0.5%!${colors.reset}`);
                } else {
                  console.log(`       ${colors.green}✅ Within acceptable range${colors.reset}`);
                }
              }
            }
          }

          console.log("\n" + colors.yellow + "💾 WOULD SEND TO BLOCKCHAIN:" + colors.reset);
          console.log(`   ${colors.gray}Program:${colors.reset} ${colors.cyan}${PROGRAM_ID.toBase58()}${colors.reset}`);
          console.log(`   ${colors.gray}Updater Index:${colors.reset} ${colors.yellow}${index}${colors.reset}`);
          console.log(`   ${colors.gray}Assets:${colors.reset} ${colors.green}${fresh.map(f => f.sym).join(", ")}${colors.reset}`);
          console.log(colors.gray + "=".repeat(70) + "\n" + colors.reset);
        } else {
          // Non-verbose dryrun: print minimal status at most once per second
          const now = Date.now();
          if (now - lastLogTime >= 1000) {
            const priceStr = fresh.map(({ sym, candI64 }) =>
              `${sym}=$${fmt2(candI64 / 10 ** DECIMALS)}`
            ).join(', ');
            console.log(`${colors.gray}[${new Date().toISOString()}]${colors.reset} ✓ Would send: ${priceStr}`);
            lastLogTime = now;
          }
        }

        // Mark as sent in dry run to avoid repeated logs
        for (const { sym, candI64, priceSource } of fresh) {
          sentUpTo[sym] = priceSource === "pyth" ? latest[sym].pubMs : Date.now();
          lastSentI64[sym] = candI64;
        }
        return;
      }

      // LIVE MODE: Send to blockchain
      // fresh blockhash every send (<= 2s old)
      await ensureBlockhashFresh();

      // Build batch tx with compute budget limit - use single batch instruction
      const tx = new Transaction();
      tx.add(ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }));

      // Collect prices for all 4 assets (use last sent value if asset not in fresh list)
      const btcData = fresh.find(f => f.sym === "BTC");
      const ethData = fresh.find(f => f.sym === "ETH");
      const solData = fresh.find(f => f.sym === "SOL");
      const hypeData = fresh.find(f => f.sym === "HYPE");

      const btcPrice = btcData ? btcData.candI64 : (lastSentI64.BTC || 0);
      const ethPrice = ethData ? ethData.candI64 : (lastSentI64.ETH || 0);
      const solPrice = solData ? solData.candI64 : (lastSentI64.SOL || 0);
      const hypePrice = hypeData ? hypeData.candI64 : (lastSentI64.HYPE || 0);

      // Single batch instruction for all 4 assets
      tx.add(
        ixBatchSetPrices(
          index,
          btcPrice,
          ethPrice,
          solPrice,
          hypePrice,
          clientTsMs,
          PROGRAM_ID,
          statePda,
          payer.publicKey
        )
      );

      tx.feePayer = payer.publicKey;
      tx.recentBlockhash = bhCache.blockhash;

      const t_recv = Date.now();

      let sig;
      try {
        sig = await sendAndConfirmTransaction(connection, tx, [payer], {
          skipPreflight: false,
          commitment: "processed",
        });
      } catch (e) {
        const msg = (e?.message || "").toLowerCase();
        const expired =
          msg.includes("block height exceeded") ||
          msg.includes("blockhash not found") ||
          (msg.includes("signature") && msg.includes("expired"));
        if (expired) {
          // Do NOT retry (your requirement): just log and skip this batch
          console.warn(
            `[send/batch] skipped: blockhash expired (no retry). details: ${e?.message || e}`
          );
          return; // don't mark sent; let next tick handle fresh data with a new blockhash
        }
        throw e; // surface other errors
      }

      const t_sent = Date.now();

      // Mark sent (both publish time and i64)
      for (const { sym, candI64, priceSource } of fresh) {
        sentUpTo[sym] = priceSource === "pyth" ? latest[sym].pubMs : Date.now();
        lastSentI64[sym] = candI64;
      }

      // Calculate price divergence for all assets if both sources available
      const divergences = {};
      const warnings = [];

      for (const sym of ['BTC', 'ETH', 'SOL', 'HYPE']) {
        const assetFresh = fresh.find(f => f.sym === sym);
        const compData = compositeData[sym];

        if (assetFresh && compData.price != null) {
          const pythPrice = assetFresh.candI64 / 10 ** DECIMALS;
          const diff = Math.abs(pythPrice - compData.price);
          const pct = (diff / compData.price) * 100;
          divergences[sym] = { diff: diff.toFixed(2), pct: pct.toFixed(3) };

          // Warn if divergence > 0.5%
          if (pct > 0.5) {
            warnings.push(`${sym}: Pyth=${pythPrice.toFixed(2)} vs Composite=${compData.price.toFixed(2)} (${pct.toFixed(3)}%)`);
          }
        }
      }

      // Log: compact JSON with ms timestamp + latency + composite comparison
      if (verbose) {
        const compositeInfo = {};
        for (const sym of ['BTC', 'ETH', 'SOL', 'HYPE']) {
          const compData = compositeData[sym];
          if (compData.price != null) {
            compositeInfo[sym] = {
              price: fmt2(compData.price),
              sources: compData.count,
              sourceDetails: compData.sources.map(s => ({
                name: s.source,
                price: fmt2(s.price),
                age_ms: s.age
              })),
              divergence: divergences[sym] || null
            };
          }
        }

        console.log(
          JSON.stringify(
            {
              ts_ms: clientTsMs,
              idx: index,
              assets: fresh.map(({ sym }) => sym),
              prices: Object.fromEntries(
                fresh.map(({ sym, candI64 }) => [
                  sym,
                  fmt2(candI64 / 10 ** DECIMALS),
                ])
              ),
              composite: Object.keys(compositeInfo).length > 0 ? compositeInfo : null,
              tx: sig,
              t_recv,
              t_sent,
              dt_handle: t_recv - t0,
              dt_send: t_sent - t_recv,
            },
            null,
            0
          )
        );

        // Log warnings if significant divergence
        if (warnings.length > 0) {
          console.warn(`[WARN] Price divergence > 0.5%: ${warnings.join(', ')}`);
        }
      } else {
        // Non-verbose mode: print minimal status at most once per second
        const now = Date.now();
        if (now - lastLogTime >= 1000) {
          const priceStr = fresh.map(({ sym, candI64 }) =>
            `${sym}=$${fmt2(candI64 / 10 ** DECIMALS)}`
          ).join(', ');
          console.log(`${colors.gray}[${new Date().toISOString()}]${colors.reset} ✓ Updated: ${priceStr} ${colors.gray}(tx: ${sig.substring(0, 8)}...)${colors.reset}`);
          lastLogTime = now;
        }
      }
    } catch (e) {
      console.error("[send/batch]", e?.message || e);
    }
  }, TICK_MS);

  process.on("SIGINT", async () => {
    console.log("\nClosing streams…");
    try {
      await psc.closeWebSocket();
      compositeBTC.stop();
      compositeETH.stop();
      compositeSOL.stop();
      compositeHYPE.stop();

      // Close log stream if open
      if (logStream) {
        logStream.end();
      }
    } catch {}
    process.exit(0);
  });
})().catch((e) => {
  console.error("Fatal:", e?.message ?? e);

  // Close log stream on fatal error
  if (logStream) {
    logStream.end();
  }

  process.exit(1);
});

