/**
 * Daemon forking utility
 */

import { spawn, ChildProcess } from 'child_process';
import { Keypair } from '@solana/web3.js';
import { FORKED_ENV_VAR, PROGRAM_ID, ALLOWED_UPDATERS } from '../config/constants';

/**
 * Options for forking to background
 */
export interface ForkOptions {
  privateKey: string;
  args: string[];
  logFile: string | null;
  keypair: Keypair;
  index: number;
  rpcUrl: string;
}

/**
 * Fork process to background with private key passed via stdin
 */
export function forkToBackground(options: ForkOptions): never {
  const { privateKey, args, logFile, keypair, index, rpcUrl } = options;
  // Build arguments for child (replace --prompt with --private-key-stdin, remove --daemon)
  const childArgs = args.filter((a) => a !== '--prompt' && a !== '-p' && a !== '--daemon' && a !== '-d');
  childArgs.push('--private-key-stdin');

  // Display comprehensive startup status information directly to stdout
  // (bypasses console.log override to ensure output appears on terminal)
  process.stdout.write('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  process.stdout.write('  Oracle Client - Daemon Initialization\n');
  process.stdout.write('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n');

  // Show all allowed updater public keys
  process.stdout.write('✓ Authorized updater public keys:\n');
  for (const [pubkey, idx] of ALLOWED_UPDATERS.entries()) {
    const marker = idx === index ? ' ← ACTIVE' : '';
    process.stdout.write(`  [${idx}] ${pubkey}${marker}\n`);
  }

  // Show loaded private key status (without revealing it)
  process.stdout.write('\n✓ Private key validated successfully\n');
  process.stdout.write(`✓ Using updater index: ${index}\n`);
  process.stdout.write(`✓ Public key: ${keypair.publicKey.toBase58()}\n`);

  // Show target configuration
  process.stdout.write(`\n✓ Target program: ${PROGRAM_ID.toBase58()}\n`);
  process.stdout.write(`✓ RPC endpoint: ${rpcUrl}\n`);

  // Show log file location
  if (logFile) {
    process.stdout.write(`✓ Log file: ${logFile}\n`);
  }

  process.stdout.write('\n✓ All systems ready - forking to background...\n\n');

  // Get the entry point script that was used to start this process
  const scriptPath = process.argv[1];
  if (!scriptPath) {
    console.error('ERROR: Cannot determine script path');
    process.exit(1);
  }

  // Spawn child process detached
  const child: ChildProcess = spawn(process.execPath, [scriptPath, ...childArgs], {
    detached: true,
    stdio: ['pipe', 'ignore', 'ignore'],
    env: { ...process.env, [FORKED_ENV_VAR]: '1' },
  });

  // Write private key to child's stdin and wait for it to be flushed
  if (child.stdin) {
    child.stdin.write(privateKey + '\n', () => {
      // Callback fires when data is flushed
      child.stdin!.end();
      // Clear private key from parent (Note: parameter destructuring creates a local copy)
      // The original privateKey in parent's memory will be cleared by the caller
      // Unref so parent can exit
      child.unref();
    });
  } else {
    // If no stdin (shouldn't happen), still unref
    child.unref();
  }

  // Print success message and exit parent (using stdout to bypass console.log override)
  process.stdout.write(`\n✓ Oracle client forked to background (PID: ${child.pid})\n`);
  if (logFile) {
    process.stdout.write(`  Logs: ${logFile}\n`);
  }
  process.stdout.write(`  Process is now detached and running independently\n\n`);
  process.exit(0);
}
