/**
 * CLI argument parser
 */

import { CliOptions } from '../types';
import { FORKED_ENV_VAR } from '../config/constants';

/**
 * Parse command line arguments
 */
export function parseCliArgs(argv: string[]): CliOptions {
  const args = argv.slice(2);

  const isDryRun = args.includes('--dryrun') || args.includes('--dry-run');
  const verbose = args.includes('--verbose') || args.includes('-v');

  // Check for log file option
  const logArg = args.find((a) => a.startsWith('--log='));
  const logFile = logArg?.split('=')[1] || null;

  // Check if we should daemonize (background) after prompt
  const shouldDaemonize = args.includes('--daemon') || args.includes('-d');
  const isForkedChild = process.env[FORKED_ENV_VAR] === '1';

  // Check for private key from environment variable
  const privateKeyFromEnv = process.env.ORACLE_PRIVATE_KEY || null;

  // Check for --private-key-stdin flag (secure - no history)
  const useStdin = args.includes('--private-key-stdin');

  // Check for --prompt flag (interactive prompt - secure)
  const usePrompt = args.includes('--prompt') || args.includes('-p');

  // Check for --key-file option (loads from .keys/ directory)
  const keyFileArg = args.find((a) => a.startsWith('--key-file='));
  const keyFileName = keyFileArg?.split('=')[1] || null;

  // Check for wallet file (legacy method)
  const walletArg = args.find((a) => !a.startsWith('--') && !a.startsWith('-'));
  const walletPath = walletArg || null;

  return {
    isDryRun,
    verbose,
    logFile,
    shouldDaemonize,
    isForkedChild,
    usePrompt,
    useStdin,
    privateKeyFromEnv,
    walletPath,
    keyFileName,
  };
}

/**
 * Validate CLI options
 */
export function validateCliOptions(options: CliOptions): string | null {
  const {
    isDryRun,
    walletPath,
    privateKeyFromEnv,
    useStdin,
    usePrompt,
    keyFileName,
  } = options;

  // In dry run mode, we don't need any authentication
  if (isDryRun) {
    return null;
  }

  // Check if at least one authentication method is provided
  if (!walletPath && !privateKeyFromEnv && !useStdin && !usePrompt && !keyFileName) {
    return 'No authentication method provided';
  }

  return null;
}

/**
 * Display usage information
 */
export function displayUsage(): void {
  console.error('Usage:');
  console.error('  Interactive prompt (SECURE):  node app/pyth_sim.cjs --prompt');
  console.error('  With key file:                node app/pyth_sim.cjs --key-file=mn_relay1.json');
  console.error('  With env var:                 ORACLE_PRIVATE_KEY=<key> node app/pyth_sim.cjs');
  console.error('  With stdin:                   echo <key> | node app/pyth_sim.cjs --private-key-stdin');
  console.error('  With wallet file:             node app/pyth_sim.cjs <wallet.json>');
  console.error('  Dry run mode:                 node app/pyth_sim.cjs --dryrun');
  console.error('');
  console.error('Options:');
  console.error('  --prompt, -p               Securely prompt for private key (hidden input)');
  console.error('  --key-file=<filename>      Load key from .keys/<filename> (e.g., mn_relay1.json)');
  console.error('  --private-key-stdin        Read private key from stdin');
  console.error('  --daemon, -d               Fork to background after authentication');
  console.error('  --dryrun                   Run without sending transactions');
  console.error('  --verbose, -v              Enable continuous logging (off by default)');
  console.error('  --log=<file>               Write logs to specified file (appends)');
  console.error('');
  console.error('Examples:');
  console.error('  node app/pyth_sim.cjs --key-file=mn_relay1.json --daemon --log=relay.log');
  console.error('  node app/pyth_sim.cjs --prompt --daemon --log=/var/log/oracle.log');
  console.error('  node app/pyth_sim.cjs --prompt --verbose');
  console.error('  node app/pyth_sim.cjs -p -d --log=./oracle.log');
  console.error('');
  console.error('🔒 Security: --prompt and env var methods don\'t expose keys in history or process lists');
}
