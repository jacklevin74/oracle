"use strict";
/**
 * Application constants and configuration
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LOG_THROTTLE_MS = exports.DIVERGENCE_WARNING_THRESHOLD = exports.FORKED_ENV_VAR = exports.LOCK_FILE_NAME = exports.BLOCKHASH_MAX_AGE_MS = exports.TICK_MS = exports.DEFAULT_RPC_URL = exports.PYTH_HERMES_URL = exports.PYTH_FEEDS = exports.ASSETS = exports.VALID_INDICES = exports.ALLOWED_UPDATERS = exports.DISCRIMINATORS = exports.COMPUTE_UNIT_LIMIT = exports.DECIMALS = exports.STATE_SEED = exports.PROGRAM_ID = void 0;
const web3_js_1 = require("@solana/web3.js");
const types_1 = require("../types");
/**
 * Program ID on Solana
 */
exports.PROGRAM_ID = new web3_js_1.PublicKey('LuS6XnQ3qNXqNQvAJ3akXnEJRBv9XNoUricjMgTyCxX');
/**
 * PDA seed for state account
 */
exports.STATE_SEED = Buffer.from('state_v2');
/**
 * Price decimals (6 = fixed-point with 6 decimal places)
 */
exports.DECIMALS = 6;
/**
 * Compute unit limit for transactions
 */
exports.COMPUTE_UNIT_LIMIT = 15000;
/**
 * Instruction discriminators (8-byte anchor discriminators)
 */
exports.DISCRIMINATORS = {
    initialize: Uint8Array.from([175, 175, 109, 31, 13, 152, 155, 237]),
    set_price: Uint8Array.from([16, 19, 182, 8, 149, 83, 72, 181]),
    batch_set_prices: Uint8Array.from([22, 37, 238, 178, 182, 181, 83, 149]),
};
/**
 * Allowed updater public keys mapped to their index
 */
exports.ALLOWED_UPDATERS = new Map([
    ['CGLezzdUpYmxiq3g5xdXxry8SWqwQbSxFJsdqfM13ro9', 1], // mn_relay1.json
    ['FprJrTPJq9eKsVxEVhQCyRChEMaYzyTwcnK8aNfCae2D', 2], // mn_relay2.json
    ['7FZvQQE1VDq2fFSuBmCCxmo8tPNm9LfYqF9BMkbyp1by', 3], // mn_relay3.json
    ['55MyuYePgkwAExNqtdNY4zahSyiM3stjjRm3Ym36sTA8', 4], // Reserved
]);
/**
 * Valid updater indices
 */
exports.VALID_INDICES = [1, 2, 3, 4];
/**
 * Asset enum values
 */
exports.ASSETS = {
    BTC: types_1.Asset.BTC,
    ETH: types_1.Asset.ETH,
    SOL: types_1.Asset.SOL,
    HYPE: types_1.Asset.HYPE,
};
/**
 * Pyth Hermes feed IDs (canonical)
 * Note: HYPE not available on Pyth - uses composite oracle only
 */
exports.PYTH_FEEDS = {
    BTC: '0xe62df6c8b4a85fe1a67db44dc12de5db330f7ac66b72dc658afedf0f4a415b43',
    ETH: '0xff61491a931112ddf1bd8147cd1b641375f79f5825126d665480874634fd0ace',
    SOL: '0xef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d',
};
/**
 * Pyth Hermes URL
 */
exports.PYTH_HERMES_URL = 'https://hermes.pyth.network';
/**
 * Default RPC URL
 */
exports.DEFAULT_RPC_URL = 'http://127.0.0.1:8899';
/**
 * Tick interval for price updates (milliseconds)
 */
exports.TICK_MS = 750;
/**
 * Maximum age for blockhash cache (milliseconds)
 */
exports.BLOCKHASH_MAX_AGE_MS = 2000;
/**
 * Lock file name
 */
exports.LOCK_FILE_NAME = '.oracle.lock';
/**
 * Forked child process environment variable
 */
exports.FORKED_ENV_VAR = '__ORACLE_FORKED';
/**
 * Price divergence warning threshold (percentage)
 */
exports.DIVERGENCE_WARNING_THRESHOLD = 0.5;
/**
 * Log throttle interval for non-verbose mode (milliseconds)
 */
exports.LOG_THROTTLE_MS = 1000;
