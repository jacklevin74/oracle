/**
 * Secure private key management and authentication
 */

import * as fs from 'fs';
import * as path from 'path';
import * as readline from 'readline';
import { Keypair } from '@solana/web3.js';
import bs58 from 'bs58';
import { AuthenticationError } from '../types';
import { ALLOWED_UPDATERS, VALID_INDICES } from '../config/constants';

/**
 * Read keypair from JSON file
 */
export function readKeypairFromFile(filePath: string): Keypair {
  try {
    const absolutePath = path.isAbsolute(filePath)
      ? filePath
      : path.join(process.cwd(), filePath);

    if (!fs.existsSync(absolutePath)) {
      throw new AuthenticationError(`Wallet file not found: ${absolutePath}`);
    }

    const secretKeyJson = fs.readFileSync(absolutePath, 'utf8');
    const secretKey = Uint8Array.from(JSON.parse(secretKeyJson));
    return Keypair.fromSecretKey(secretKey);
  } catch (error) {
    if (error instanceof AuthenticationError) {
      throw error;
    }
    throw new AuthenticationError(
      `Failed to read keypair from file: ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

/**
 * Create keypair from base58 private key string
 */
export function keypairFromBase58(base58PrivateKey: string): Keypair {
  try {
    const decoded = bs58.decode(base58PrivateKey);
    return Keypair.fromSecretKey(decoded);
  } catch (error) {
    throw new AuthenticationError('Invalid base58 private key format');
  }
}

/**
 * Create keypair from array of bytes [1,2,3,...]
 */
export function keypairFromArray(secretKeyArray: number[]): Keypair {
  try {
    return Keypair.fromSecretKey(Uint8Array.from(secretKeyArray));
  } catch (error) {
    throw new AuthenticationError('Invalid secret key array format');
  }
}

/**
 * Parse private key from string (base58 or JSON array)
 */
export function parsePrivateKey(input: string): Keypair {
  const trimmed = input.trim();

  // Try to parse as JSON array first
  if (trimmed.startsWith('[')) {
    try {
      const arr = JSON.parse(trimmed);
      if (!Array.isArray(arr)) {
        throw new Error('Not an array');
      }
      return keypairFromArray(arr);
    } catch (error) {
      throw new AuthenticationError('Invalid JSON array format');
    }
  }

  // Otherwise treat as base58
  return keypairFromBase58(trimmed);
}

/**
 * Prompt for private key without echoing (like password input)
 */
export async function promptPrivateKey(): Promise<string> {
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

    const onData = (char: string) => {
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
          reject(new AuthenticationError('No input received'));
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

/**
 * Read private key from stdin (non-interactive)
 */
export async function readPrivateKeyFromStdin(): Promise<string> {
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
    terminal: false,
  });

  return new Promise((resolve) => {
    rl.on('line', (line) => {
      resolve(line.trim());
      rl.close();
    });
  });
}

/**
 * Validate that a keypair is authorized and get its index
 */
export function validateAuthorizedKeypair(keypair: Keypair): number {
  const publicKey = keypair.publicKey.toBase58();
  const index = ALLOWED_UPDATERS.get(publicKey);

  if (!index || !VALID_INDICES.includes(index as typeof VALID_INDICES[number])) {
    throw new AuthenticationError(
      `Public key not authorized: ${publicKey}\n` +
      `This key is not in the allowed updaters list`
    );
  }

  return index;
}

/**
 * Securely clear a string from memory (overwrite with zeros)
 */
export function securelyEraseString(str: string): void {
  // In JavaScript, we can't truly overwrite memory, but we can at least
  // overwrite the variable and hope GC picks it up
  // This is a best-effort approach
  str = '0'.repeat(str.length);
}

/**
 * Clear private key from environment variable
 */
export function clearPrivateKeyFromEnv(): void {
  if (process.env.ORACLE_PRIVATE_KEY) {
    delete process.env.ORACLE_PRIVATE_KEY;
  }
}
