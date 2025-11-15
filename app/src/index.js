#!/usr/bin/env node
"use strict";
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
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
const web3_js_1 = require("@solana/web3.js");
const cli_parser_1 = require("./utils/cli-parser");
const logger_1 = require("./utils/logger");
const lock_file_manager_1 = require("./utils/lock-file-manager");
const private_key_manager_1 = require("./auth/private-key-manager");
const daemon_fork_1 = require("./utils/daemon-fork");
const oracle_service_1 = require("./app/oracle-service");
const types_1 = require("./types");
const constants_1 = require("./config/constants");
const path = __importStar(require("path"));
/**
 * Main application entry point
 */
function main() {
    return __awaiter(this, void 0, void 0, function* () {
        // Parse CLI arguments
        const options = (0, cli_parser_1.parseCliArgs)(process.argv);
        // Validate options
        const validationError = (0, cli_parser_1.validateCliOptions)(options);
        if (validationError) {
            (0, cli_parser_1.displayUsage)();
            process.exit(1);
        }
        // Display dry run mode
        if (options.isDryRun) {
            console.log('🔍 DRY RUN MODE - No blockchain transactions will be sent\n');
        }
        // Setup lock file manager
        const lockManager = new lock_file_manager_1.LockFileManager(path.join(__dirname, '..'));
        try {
            // Check for existing instance
            lockManager.create(process.argv.slice(2));
            lockManager.setupCleanup();
        }
        catch (error) {
            if (error instanceof Error) {
                console.error(`\n❌ ERROR: ${error.message}`);
            }
            process.exit(1);
        }
        // Initialize logger
        const logger = (0, logger_1.initLogger)({
            logFile: options.logFile,
            verbose: options.verbose,
        });
        // Get keypair and index
        let keypair = null;
        let index = 1; // Default for dry run
        if (!options.isDryRun) {
            try {
                let privateKey = null;
                if (options.privateKeyFromEnv) {
                    // From environment variable
                    privateKey = options.privateKeyFromEnv;
                    console.log('✓ Loading keypair from ORACLE_PRIVATE_KEY environment variable');
                }
                else if (options.usePrompt) {
                    // Interactive prompt
                    try {
                        privateKey = yield (0, private_key_manager_1.promptPrivateKey)();
                    }
                    catch (error) {
                        logger.errorToConsole('Failed to read private key:', error instanceof Error ? error.message : String(error));
                        process.exit(1);
                    }
                    // Validate the private key before forking
                    let testKeypair;
                    let testIndex;
                    try {
                        testKeypair = (0, private_key_manager_1.parsePrivateKey)(privateKey);
                        testIndex = (0, private_key_manager_1.validateAuthorizedKeypair)(testKeypair);
                    }
                    catch (error) {
                        if (error instanceof types_1.AuthenticationError) {
                            logger.errorToConsole(`\n❌ ERROR: ${error.message}\n`);
                        }
                        else {
                            logger.errorToConsole(`\n❌ ERROR: Invalid private key format\n`);
                        }
                        process.exit(1);
                    }
                    // Fork to background if requested
                    if (options.shouldDaemonize && !options.isForkedChild) {
                        const rpcUrl = process.env.ANCHOR_PROVIDER_URL || constants_1.DEFAULT_RPC_URL;
                        (0, daemon_fork_1.forkToBackground)({
                            privateKey,
                            args: process.argv.slice(2),
                            logFile: options.logFile,
                            keypair: testKeypair,
                            index: testIndex,
                            rpcUrl,
                        });
                        // forkToBackground never returns (calls process.exit)
                    }
                }
                else if (options.useStdin) {
                    // Read from stdin
                    privateKey = yield (0, private_key_manager_1.readPrivateKeyFromStdin)();
                    console.log('✓ Loading keypair from stdin');
                }
                else if (options.keyFileName) {
                    // Read from .keys/ directory
                    const keyFilePath = path.join(__dirname, '..', '..', '.keys', options.keyFileName);
                    keypair = (0, private_key_manager_1.readKeypairFromFile)(keyFilePath);
                    console.log(`✓ Loading keypair from .keys/${options.keyFileName}`);
                }
                else if (options.walletPath) {
                    // Read from wallet file (legacy)
                    keypair = (0, private_key_manager_1.readKeypairFromFile)(options.walletPath);
                    logger.logToConsole(`Authorized wallet ${keypair.publicKey.toBase58()}`);
                }
                // Parse private key if we have one
                if (privateKey) {
                    try {
                        keypair = (0, private_key_manager_1.parsePrivateKey)(privateKey);
                        // SECURITY: Clear the private key from memory immediately after use
                        (0, private_key_manager_1.securelyEraseString)(privateKey);
                        privateKey = null;
                        // Clear from environment variable
                        if (options.privateKeyFromEnv) {
                            (0, private_key_manager_1.clearPrivateKeyFromEnv)();
                        }
                        logger.logToConsole(`✓ Private key cleared from memory and environment`);
                    }
                    catch (error) {
                        logger.errorToConsole('Failed to parse private key:', error instanceof Error ? error.message : String(error));
                        logger.errorToConsole('Expected base58 string or JSON array [1,2,3,...]');
                        process.exit(1);
                    }
                }
                // Validate keypair authorization
                if (keypair) {
                    try {
                        index = (0, private_key_manager_1.validateAuthorizedKeypair)(keypair);
                        logger.logToConsole(`✓ Authorized public key ${keypair.publicKey.toBase58()} for index ${index}.`);
                    }
                    catch (error) {
                        if (error instanceof types_1.AuthenticationError) {
                            logger.errorToConsole(`\n❌ ERROR: ${error.message}\n`);
                        }
                        else {
                            logger.errorToConsole('Wallet not authorized for any index');
                        }
                        process.exit(1);
                    }
                }
            }
            catch (error) {
                logger.errorToConsole('Fatal error during authentication:', error instanceof Error ? error.message : String(error));
                process.exit(1);
            }
        }
        else {
            logger.logToConsole('Using default index 1 for dry run mode.');
        }
        // Create oracle service
        const rpcUrl = process.env.ANCHOR_PROVIDER_URL || constants_1.DEFAULT_RPC_URL;
        const service = new oracle_service_1.OracleService({
            rpcUrl,
            updaterKeypair: keypair || web3_js_1.Keypair.generate(), // Use dummy keypair for dry run
            updaterIndex: index,
            isDryRun: options.isDryRun,
            logger,
        });
        // Setup graceful shutdown
        const shutdown = () => __awaiter(this, void 0, void 0, function* () {
            console.log('\nClosing streams…');
            try {
                yield service.stop();
                logger.close();
                lockManager.remove();
            }
            catch (error) {
                // Ignore errors during shutdown
            }
            process.exit(0);
        });
        process.on('SIGINT', shutdown);
        process.on('SIGTERM', shutdown);
        // Initialize and start service
        try {
            yield service.initialize();
            service.displayDataSources();
            service.start();
        }
        catch (error) {
            logger.errorToConsole('Fatal error:', error instanceof Error ? error.message : String(error));
            logger.close();
            lockManager.remove();
            process.exit(1);
        }
    });
}
// Run main
main().catch((error) => {
    console.error('Fatal:', error instanceof Error ? error.message : String(error));
    process.exit(1);
});
