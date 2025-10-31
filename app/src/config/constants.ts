/**
 * Application constants and configuration
 */

import { PublicKey } from '@solana/web3.js';
import { Asset, PythFeeds } from '../types';

/**
 * Program ID on Solana
 */
export const PROGRAM_ID = new PublicKey('LuS6XnQ3qNXqNQvAJ3akXnEJRBv9XNoUricjMgTyCxX');

/**
 * PDA seed for state account
 */
export const STATE_SEED = Buffer.from('state_v2');

/**
 * Price decimals (6 = fixed-point with 6 decimal places)
 */
export const DECIMALS = 6;

/**
 * Compute unit limit for transactions
 */
export const COMPUTE_UNIT_LIMIT = 15_000;

/**
 * Instruction discriminators (8-byte anchor discriminators)
 */
export const DISCRIMINATORS = {
  initialize: Uint8Array.from([175, 175, 109, 31, 13, 152, 155, 237]),
  set_price: Uint8Array.from([16, 19, 182, 8, 149, 83, 72, 181]),
  batch_set_prices: Uint8Array.from([22, 37, 238, 178, 182, 181, 83, 149]),
};

/**
 * Allowed updater public keys mapped to their index
 */
export const ALLOWED_UPDATERS = new Map<string, number>([
  ['CGLezzdUpYmxiq3g5xdXxry8SWqwQbSxFJsdqfM13ro9', 1], // mn_relay1.json
  ['FprJrTPJq9eKsVxEVhQCyRChEMaYzyTwcnK8aNfCae2D', 2], // mn_relay2.json
  ['7FZvQQE1VDq2fFSuBmCCxmo8tPNm9LfYqF9BMkbyp1by', 3], // mn_relay3.json
  ['55MyuYePgkwAExNqtdNY4zahSyiM3stjjRm3Ym36sTA8', 4], // Reserved
]);

/**
 * Valid updater indices
 */
export const VALID_INDICES = [1, 2, 3, 4] as const;

/**
 * Asset enum values
 */
export const ASSETS: Record<string, Asset> = {
  BTC: Asset.BTC,
  ETH: Asset.ETH,
  SOL: Asset.SOL,
  HYPE: Asset.HYPE,
  ZEC: Asset.ZEC,
};

/**
 * Pyth Hermes feed IDs (canonical)
 * Note: HYPE not available on Pyth - uses composite oracle only
 */
export const PYTH_FEEDS: PythFeeds = {
  BTC: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
  ETH: '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
  SOL: '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
  ZEC: '0xbe9b59d178f0d6a97ab4c343bff2aa69caa1eaae3e9048a65788c529b125bb24',
};

/**
 * Pyth Hermes URL
 */
export const PYTH_HERMES_URL = 'https://hermes.pyth.network';

/**
 * Default RPC URL
 */
export const DEFAULT_RPC_URL = 'http://127.0.0.1:8899';

/**
 * Tick interval for price updates (milliseconds)
 */
export const TICK_MS = 750;

/**
 * Maximum age for blockhash cache (milliseconds)
 */
export const BLOCKHASH_MAX_AGE_MS = 2000;

/**
 * Lock file name
 */
export const LOCK_FILE_NAME = '.oracle.lock';

/**
 * Forked child process environment variable
 */
export const FORKED_ENV_VAR = '__ORACLE_FORKED';

/**
 * Price divergence warning threshold (percentage)
 */
export const DIVERGENCE_WARNING_THRESHOLD = 0.5;

/**
 * Log throttle interval for non-verbose mode (milliseconds)
 */
export const LOG_THROTTLE_MS = 1000;
