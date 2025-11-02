#!/usr/bin/env node
/**
 * Controller Process Entry Point
 *
 * Main process that:
 * - Holds private key
 * - Supervises relay process
 * - Validates and signs transactions
 */

import { Keypair } from '@solana/web3.js';
import * as path from 'path';
import { OracleController } from './oracle-controller';
import { parsePrivateKey, validateAuthorizedKeypair, promptPrivateKey, readPrivateKeyFromStdin, securelyEraseString, clearPrivateKeyFromEnv } from '../auth/private-key-manager';
import { AuthenticationError } from '../types';
import { DEFAULT_RPC_URL, FORKED_ENV_VAR } from '../config/constants';
import { initLogger } from '../utils/logger';
import { forkToBackground } from '../utils/daemon-fork';

interface CliOptions {
  isDryRun: boolean;
  verbose: boolean;
  usePrompt: boolean;
  useStdin: boolean;
  privateKeyFromEnv: string | null;
  controllerLogFile: string;
  relayLogFile: string;
  shouldDaemonize: boolean;
  foreground: boolean;
  isForkedChild: boolean;
}

/**
 * Parse CLI arguments
 */
function parseArgs(): CliOptions {
  const args = process.argv.slice(2);

  // Check for foreground flag
  const foreground = args.includes('-f') || args.includes('--foreground');

  // Default log files (can be overridden)
  let controllerLogFile = 'controller.log';
  let relayLogFile = 'relay.log';

  // Find controller log file option (override default)
  const controllerLogIndex = args.findIndex(arg => arg === '--controller-log');
  if (controllerLogIndex !== -1 && controllerLogIndex + 1 < args.length) {
    controllerLogFile = args[controllerLogIndex + 1] || controllerLogFile;
  }

  // Find relay log file option (override default)
  const relayLogIndex = args.findIndex(arg => arg === '--relay-log');
  if (relayLogIndex !== -1 && relayLogIndex + 1 < args.length) {
    relayLogFile = args[relayLogIndex + 1] || relayLogFile;
  }

  // Legacy --log-file option (applies to controller)
  const legacyLogIndex = args.findIndex(arg => arg === '--log-file');
  if (legacyLogIndex !== -1 && legacyLogIndex + 1 < args.length) {
    controllerLogFile = args[legacyLogIndex + 1] || controllerLogFile;
  }

  return {
    isDryRun: args.includes('--dry-run'),
    verbose: args.includes('--verbose') || args.includes('-v'),
    usePrompt: args.includes('--prompt'),
    useStdin: args.includes('--private-key-stdin'),
    privateKeyFromEnv: process.env.ORACLE_PRIVATE_KEY || null,
    controllerLogFile,
    relayLogFile,
    shouldDaemonize: !foreground, // Daemon by default unless -f specified
    foreground,
    isForkedChild: !!process.env[FORKED_ENV_VAR],
  };
}

/**
 * Main entry point
 */
async function main() {
  const options = parseArgs();

  // Get keypair
  let keypair: Keypair;
  let index: number;
  let privateKey: string | null = null;

  // Handle prompt and daemonization BEFORE logger initialization
  if (!options.isDryRun) {
    // For non-dry-run mode, we need private key
    if (options.usePrompt) {
      privateKey = await promptPrivateKey();
    } else if (options.privateKeyFromEnv) {
      privateKey = options.privateKeyFromEnv;
    }

    // Validate private key if we have one
    if (privateKey) {
      let testKeypair: Keypair;
      let testIndex: number;
      try {
        testKeypair = parsePrivateKey(privateKey);
        testIndex = validateAuthorizedKeypair(testKeypair);
      } catch (error) {
        if (error instanceof AuthenticationError) {
          console.error(`\n❌ ERROR: ${error.message}\n`);
        } else {
          console.error('\n❌ ERROR: Invalid private key format\n');
        }
        process.exit(1);
      }

      // Fork to background if daemon mode (before logger setup)
      if (options.shouldDaemonize && !options.isForkedChild) {
        const rpcUrl = process.env.ANCHOR_PROVIDER_URL || DEFAULT_RPC_URL;
        forkToBackground({
          privateKey,
          args: process.argv.slice(2),
          logFile: options.controllerLogFile,
          keypair: testKeypair,
          index: testIndex,
          rpcUrl,
        });
        // forkToBackground never returns (calls process.exit)
      }
    }
  } else {
    // Dry run mode - check if daemon mode requested
    if (options.shouldDaemonize && !options.isForkedChild) {
      // For dry run, fork without private key validation
      const rpcUrl = process.env.ANCHOR_PROVIDER_URL || DEFAULT_RPC_URL;
      const dummyKeypair = Keypair.generate();
      forkToBackground({
        privateKey: 'dry-run-mode',
        args: process.argv.slice(2),
        logFile: options.controllerLogFile,
        keypair: dummyKeypair,
        index: 1,
        rpcUrl,
      });
      // forkToBackground never returns (calls process.exit)
    }
  }

  // Initialize logger AFTER prompt
  const logger = initLogger({
    logFile: options.controllerLogFile,
    verbose: options.verbose,
  });

  if (!options.isForkedChild) {
    logger.logToConsole('🎮 Oracle Controller\n');
  }

  if (options.isDryRun) {
    logger.logToConsole('🔍 DRY RUN MODE - No blockchain transactions will be sent\n');
    keypair = Keypair.generate();
    index = 1;
  } else {
    // Get private key (if not already from prompt)
    if (!privateKey) {
      if (options.privateKeyFromEnv) {
        logger.logToConsole('✓ Loading keypair from ORACLE_PRIVATE_KEY environment variable');
        privateKey = options.privateKeyFromEnv;
      } else if (options.useStdin) {
        // Read from stdin (used in daemon mode)
        privateKey = await readPrivateKeyFromStdin();
        logger.logToConsole('✓ Loading keypair from stdin');
      } else {
        logger.errorToConsole('Error: Must provide private key via --prompt or ORACLE_PRIVATE_KEY env var');
        logger.logToConsole('\nUsage:');
        logger.logToConsole('  node controller-process.js --prompt              # Interactive prompt');
        logger.logToConsole('  ORACLE_PRIVATE_KEY=xxx node controller-process.js # From env var');
        logger.logToConsole('  node controller-process.js --dry-run             # Dry run (no signing)');
        logger.logToConsole('\nOptions:');
        logger.logToConsole('  --verbose, -v              Verbose logging');
        logger.logToConsole('  --dry-run                  Test mode (no transactions)');
        logger.logToConsole('  --prompt                   Interactive private key prompt');
        logger.logToConsole('  -f, --foreground           Run in foreground (default: daemon mode)');
        logger.logToConsole('  --controller-log <path>    Controller log file (default: controller.log)');
        logger.logToConsole('  --relay-log <path>         Relay log file (default: relay.log)');
        logger.logToConsole('  --log-file <path>          Legacy: same as --controller-log');
        process.exit(1);
      }
    }

    // Parse and validate keypair
    try {
      keypair = parsePrivateKey(privateKey!);

      // SECURITY: Clear the private key from memory immediately after use
      securelyEraseString(privateKey!);
      privateKey = null;

      // Clear from environment variable
      if (options.privateKeyFromEnv) {
        clearPrivateKeyFromEnv();
      }

      logger.logToConsole('✓ Private key cleared from memory and environment');

      index = validateAuthorizedKeypair(keypair);
      logger.logToConsole(`✓ Authorized public key ${keypair.publicKey.toBase58()} for index ${index}\n`);
    } catch (error) {
      if (error instanceof AuthenticationError) {
        logger.errorToConsole(`\n❌ ERROR: ${error.message}\n`);
      } else {
        logger.errorToConsole('\n❌ ERROR: Invalid private key format\n');
      }
      process.exit(1);
    }
  }

  // Get RPC URL
  const rpcUrl = process.env.ANCHOR_PROVIDER_URL || DEFAULT_RPC_URL;

  // Get relay script path
  const relayScriptPath = path.join(__dirname, '../relay/relay-process.js');

  // Create controller
  const controller = new OracleController({
    rpcUrl,
    updaterKeypair: keypair,
    updaterIndex: index,
    relayScriptPath,
    isDryRun: options.isDryRun,
    verbose: options.verbose,
    logger,
    relayLogFile: options.relayLogFile || undefined,
  });

  // Setup graceful shutdown
  const shutdown = async () => {
    logger.logToConsole('\nShutting down...');
    await controller.shutdown();
    logger.close();
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  // Initialize and start
  try {
    await controller.initialize();
    controller.start();

    if (!options.isForkedChild) {
      logger.logToConsole('\n📡 Controller running - Press Ctrl+C to stop\n');
    }
  } catch (error) {
    logger.errorToConsole('Fatal error:', error instanceof Error ? error.message : String(error));
    logger.close();
    process.exit(1);
  }
}

// Handle errors (create default logger for error handling)
const errorLogger = initLogger({ logFile: null, verbose: false });

process.on('uncaughtException', (err) => {
  errorLogger.errorToConsole('Uncaught exception:', err);
  errorLogger.close();
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  errorLogger.errorToConsole('Unhandled rejection:', err);
  errorLogger.close();
  process.exit(1);
});

// Start
main().catch((err) => {
  console.error('Fatal:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
