/**
 * Application constants and configuration
 */

import { PublicKey } from '@solana/web3.js';
import { Asset, PythFeeds } from '../types';

/**
 * Program ID on Solana
 * CURRENT: 10-asset program (BTC, ETH, SOL, HYPE, ZEC, TSLA, NVDA, MSTR, GOLD, SILVER)
 * BACKUP 8-asset: CcgTMiYkgVfz7cAGkD6835BqfycG5N5Y4aPPHYW1EvKx (keypair saved in oracle-keypair-8asset.json)
 */
export const PROGRAM_ID = new PublicKey('wsTKwvC4uVwbamEHfCH6JexbvG6Ubkqav5v3U6ewKYL');

/**
 * PDA seed for state account
 */
export const STATE_SEED = Buffer.from('state_v2');

/**
 * Price decimals (8 = fixed-point with 8 decimal places)
 */
export const DECIMALS = 8;

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
  TSLA: Asset.TSLA,
  NVDA: Asset.NVDA,
  MSTR: Asset.MSTR,
  GOLD: Asset.GOLD,
  SILVER: Asset.SILVER,
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
  TSLA: '0x16dad506d7db8da01c87581c87ca897a012a153557d4d578c3b9c9e1bc0632f1',
  NVDA: '0xb1073854ed24cbc755dc527418f52b7d271f6cc967bbf8d8129112b18860a593',
  MSTR: '0xe1e80251e5f5184f2195008382538e847fafc36f751896889dd3d1b1f6111f09',
  GOLD: '0x765d2ba906dbc32ca17cc11f5310a89e9ee1f6420508c63861f2f8ba4ee34bb2',
  SILVER: '0xf2fb02c32b055c805e7238d628e5e9dadef274376114eb1f012337cabe93871e',
};

/**
 * Pyth Hermes URL
 */
export const PYTH_HERMES_URL = 'https://hermes.pyth.network';

/**
 * Default RPC URL
 */
export const DEFAULT_RPC_URL = 'https://rpc.mainnet.x1.xyz';

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
