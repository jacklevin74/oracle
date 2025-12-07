"use strict";
/**
 * Daemon forking utility
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.forkToBackground = forkToBackground;
const child_process_1 = require("child_process");
const constants_1 = require("../config/constants");
/**
 * Fork process to background with private key passed via stdin
 */
function forkToBackground(options) {
    const { privateKey, args, logFile, keypair, index, rpcUrl } = options;
    // Build arguments for child (replace --prompt with --private-key-stdin, remove --daemon)
    const childArgs = args.filter((a) => a !== '--prompt' && a !== '-p' && a !== '--daemon' && a !== '-d');
    childArgs.push('--private-key-stdin');
    // Display comprehensive startup status information
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
    console.log('  Oracle Client - Daemon Initialization');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    // Show all allowed updater public keys
    console.log('✓ Authorized updater public keys:');
    for (const [pubkey, idx] of constants_1.ALLOWED_UPDATERS.entries()) {
        const marker = idx === index ? ' ← ACTIVE' : '';
        console.log(`  [${idx}] ${pubkey}${marker}`);
    }
    // Show loaded private key status (without revealing it)
    console.log('\n✓ Private key validated successfully');
    console.log(`✓ Using updater index: ${index}`);
    console.log(`✓ Public key: ${keypair.publicKey.toBase58()}`);
    // Show target configuration
    console.log(`\n✓ Target program: ${constants_1.PROGRAM_ID.toBase58()}`);
    console.log(`✓ RPC endpoint: ${rpcUrl}`);
    // Show log file location
    if (logFile) {
        console.log(`✓ Log file: ${logFile}`);
    }
    console.log('\n✓ All systems ready - forking to background...\n');
    // Get the entry point script that was used to start this process
    const scriptPath = process.argv[1];
    if (!scriptPath) {
        console.error('ERROR: Cannot determine script path');
        process.exit(1);
    }
    // Spawn child process detached
    const child = (0, child_process_1.spawn)(process.execPath, [scriptPath, ...childArgs], {
        detached: true,
        stdio: ['pipe', 'ignore', 'ignore'],
        env: Object.assign(Object.assign({}, process.env), { [constants_1.FORKED_ENV_VAR]: '1' }),
    });
    // Write private key to child's stdin and wait for it to be flushed
    if (child.stdin) {
        child.stdin.write(privateKey + '\n', () => {
            // Callback fires when data is flushed
            child.stdin.end();
            // Clear private key from parent (Note: parameter destructuring creates a local copy)
            // The original privateKey in parent's memory will be cleared by the caller
            // Unref so parent can exit
            child.unref();
        });
    } else {
        // If no stdin (shouldn't happen), still unref
        child.unref();
    }
    // Print success message and exit parent
    console.log(`\n✓ Oracle client forked to background (PID: ${child.pid})`);
    if (logFile) {
        console.log(`  Logs: ${logFile}`);
    }
    console.log(`  Process is now detached and running independently\n`);
    process.exit(0);
}
