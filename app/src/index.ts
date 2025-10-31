#!/usr/bin/env node
/**
 * Oracle Price Updater - Main Entry Point
 *
 * Multi-asset (BTC/ETH/SOL/HYPE) price oracle client that streams prices from
 * Pyth Network and Composite Oracle, then batches updates to Solana blockchain.
 *
 * Features:
 * - Secure private key handling (prompt, stdin, env var, or file)
 * - Daemon mode (background process)
 * - Lock file to prevent multiple instances
 * - Batch price updates (all assets in single transaction)
 * - Dry run mode for testing
 * - Structured logging with file output
 */

import { Keypair } from '@solana/web3.js';
import { parseCliArgs, validateCliOptions, displayUsage } from './utils/cli-parser';
import { initLogger } from './utils/logger';
import { LockFileManager } from './utils/lock-file-manager';
import {
  readKeypairFromFile,
  parsePrivateKey,
  promptPrivateKey,
  readPrivateKeyFromStdin,
  validateAuthorizedKeypair,
  securelyEraseString,
  clearPrivateKeyFromEnv,
} from './auth/private-key-manager';
import { forkToBackground } from './utils/daemon-fork';
import { OracleService } from './app/oracle-service';
import { AuthenticationError } from './types';
import { DEFAULT_RPC_URL } from './config/constants';
import * as path from 'path';

/**
 * Main application entry point
 */
async function main(): Promise<void> {
  // Parse CLI arguments
  const options = parseCliArgs(process.argv);

  // Validate options
  const validationError = validateCliOptions(options);
  if (validationError) {
    displayUsage();
    process.exit(1);
  }

  // Display dry run mode
  if (options.isDryRun) {
    console.log('🔍 DRY RUN MODE - No blockchain transactions will be sent\n');
  }

  // Setup lock file manager
  const lockManager = new LockFileManager(path.join(__dirname, '..'));

  try {
    // Check for existing instance
    lockManager.create(process.argv.slice(2));
    lockManager.setupCleanup();
  } catch (error) {
    if (error instanceof Error) {
      console.error(`\n❌ ERROR: ${error.message}`);
    }
    process.exit(1);
  }

  // Initialize logger
  const logger = initLogger({
    logFile: options.logFile,
    verbose: options.verbose,
  });

  // Get keypair and index
  let keypair: Keypair | null = null;
  let index: number = 1; // Default for dry run

  if (!options.isDryRun) {
    try {
      let privateKey: string | null = null;

      if (options.privateKeyFromEnv) {
        // From environment variable
        privateKey = options.privateKeyFromEnv;
        console.log('✓ Loading keypair from ORACLE_PRIVATE_KEY environment variable');
      } else if (options.usePrompt) {
        // Interactive prompt
        try {
          privateKey = await promptPrivateKey();
        } catch (error) {
          logger.errorToConsole('Failed to read private key:', error instanceof Error ? error.message : String(error));
          process.exit(1);
        }

        // Validate the private key before forking
        try {
          const testKeypair = parsePrivateKey(privateKey);
          validateAuthorizedKeypair(testKeypair);
        } catch (error) {
          if (error instanceof AuthenticationError) {
            logger.errorToConsole(`\n❌ ERROR: ${error.message}\n`);
          } else {
            logger.errorToConsole(`\n❌ ERROR: Invalid private key format\n`);
          }
          process.exit(1);
        }

        // Fork to background if requested
        if (options.shouldDaemonize && !options.isForkedChild) {
          forkToBackground(privateKey, process.argv.slice(2), options.logFile);
          // forkToBackground never returns (calls process.exit)
        }
      } else if (options.useStdin) {
        // Read from stdin
        privateKey = await readPrivateKeyFromStdin();
        console.log('✓ Loading keypair from stdin');
      } else if (options.walletPath) {
        // Read from wallet file (legacy)
        keypair = readKeypairFromFile(options.walletPath);
        logger.logToConsole(`Authorized wallet ${keypair.publicKey.toBase58()}`);
      }

      // Parse private key if we have one
      if (privateKey) {
        try {
          keypair = parsePrivateKey(privateKey);

          // SECURITY: Clear the private key from memory immediately after use
          securelyEraseString(privateKey);
          privateKey = null;

          // Clear from environment variable
          if (options.privateKeyFromEnv) {
            clearPrivateKeyFromEnv();
          }

          logger.logToConsole(`✓ Private key cleared from memory and environment`);
        } catch (error) {
          logger.errorToConsole('Failed to parse private key:', error instanceof Error ? error.message : String(error));
          logger.errorToConsole('Expected base58 string or JSON array [1,2,3,...]');
          process.exit(1);
        }
      }

      // Validate keypair authorization
      if (keypair) {
        try {
          index = validateAuthorizedKeypair(keypair);
          logger.logToConsole(`✓ Authorized public key ${keypair.publicKey.toBase58()} for index ${index}.`);
        } catch (error) {
          if (error instanceof AuthenticationError) {
            logger.errorToConsole(`\n❌ ERROR: ${error.message}\n`);
          } else {
            logger.errorToConsole('Wallet not authorized for any index');
          }
          process.exit(1);
        }
      }
    } catch (error) {
      logger.errorToConsole('Fatal error during authentication:', error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  } else {
    logger.logToConsole('Using default index 1 for dry run mode.');
  }

  // Create oracle service
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL || DEFAULT_RPC_URL;
  const service = new OracleService({
    rpcUrl,
    updaterKeypair: keypair || Keypair.generate(), // Use dummy keypair for dry run
    updaterIndex: index,
    isDryRun: options.isDryRun,
    logger,
  });

  // Setup graceful shutdown
  const shutdown = async () => {
    console.log('\nClosing streams…');
    try {
      await service.stop();
      logger.close();
      lockManager.remove();
    } catch (error) {
      // Ignore errors during shutdown
    }
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Initialize and start service
  try {
    await service.initialize();
    service.displayDataSources();
    service.start();
  } catch (error) {
    logger.errorToConsole('Fatal error:', error instanceof Error ? error.message : String(error));
    logger.close();
    lockManager.remove();
    process.exit(1);
  }
}

// Run main
main().catch((error) => {
  console.error('Fatal:', error instanceof Error ? error.message : String(error));
  process.exit(1);
});
