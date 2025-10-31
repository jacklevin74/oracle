/**
 * Daemon forking utility
 */

import { spawn, ChildProcess } from 'child_process';
import { FORKED_ENV_VAR } from '../config/constants';

/**
 * Fork process to background with private key passed via stdin
 */
export function forkToBackground(privateKey: string, args: string[], logFile: string | null): never {
  // Build arguments for child (replace --prompt with --private-key-stdin, remove --daemon)
  const childArgs = args.filter((a) => a !== '--prompt' && a !== '-p' && a !== '--daemon' && a !== '-d');
  childArgs.push('--private-key-stdin');

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

  // Write private key to child's stdin
  if (child.stdin) {
    child.stdin.write(privateKey + '\n');
    child.stdin.end();
  }

  // Clear private key from parent
  privateKey = '0'.repeat(privateKey.length);

  // Unref so parent can exit
  child.unref();

  // Print success message and exit parent
  console.log(`\n✓ Oracle client forked to background (PID: ${child.pid})`);
  if (logFile) {
    console.log(`  Logs: ${logFile}`);
  }
  console.log(`  Process is now detached and running independently\n`);
  process.exit(0);
}
