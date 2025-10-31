/**
 * Type definitions for the Oracle Price Updater
 */

import { PublicKey, Keypair } from '@solana/web3.js';

/**
 * Asset types supported by the oracle
 */
export enum Asset {
  BTC = 1,
  ETH = 2,
  SOL = 3,
  HYPE = 4,
}

/**
 * Asset symbol names
 */
export type AssetSymbol = 'BTC' | 'ETH' | 'SOL' | 'HYPE';

/**
 * Price data with timestamp
 */
export interface PriceData {
  price: number;
  pubMs: number;
}

/**
 * Latest price cache for all assets
 */
export interface LatestPrices {
  BTC: PriceData | null;
  ETH: PriceData | null;
  SOL: PriceData | null;
  HYPE: PriceData | null;
}

/**
 * Sent price tracking
 */
export interface SentPriceTracking {
  BTC: number;
  ETH: number;
  SOL: number;
  HYPE: number;
}

/**
 * Last sent i64 values
 */
export interface LastSentI64 {
  BTC: number | null;
  ETH: number | null;
  SOL: number | null;
  HYPE: number | null;
}

/**
 * Composite oracle data (from o3.cjs)
 */
export interface CompositeData {
  composite: number | null;
  count: number;
  sources?: Array<{
    source: string;
    price: number;
    age: number;
  }>;
}

/**
 * Internal composite tracking (normalized)
 */
export interface CompositeTracking {
  price: number | null;
  count: number;
  sources?: Array<{
    source: string;
    price: number;
    age: number;
  }>;
}

/**
 * Composite oracle tracking for all assets
 */
export interface CompositeTrackingMap {
  BTC: CompositeTracking;
  ETH: CompositeTracking;
  SOL: CompositeTracking;
  HYPE: CompositeTracking;
}

/**
 * Price update item for batching
 */
export interface PriceUpdateItem {
  sym: AssetSymbol;
  candI64: number;
  priceSource: 'pyth' | 'composite';
}

/**
 * CLI configuration options
 */
export interface CliOptions {
  isDryRun: boolean;
  verbose: boolean;
  logFile: string | null;
  shouldDaemonize: boolean;
  isForkedChild: boolean;
  usePrompt: boolean;
  useStdin: boolean;
  privateKeyFromEnv: string | null;
  walletPath: string | null;
}

/**
 * Application configuration
 */
export interface AppConfig {
  programId: PublicKey;
  stateSeed: Buffer;
  decimals: number;
  computeUnitLimit: number;
  rpcUrl: string;
  tickMs: number;
  blockhashMaxAgeMs: number;
}

/**
 * Authorized updater information
 */
export interface AuthorizedUpdater {
  keypair: Keypair;
  publicKey: string;
  index: number;
}

/**
 * Blockhash cache
 */
export interface BlockhashCache {
  blockhash: string | null;
  lastValidBlockHeight: number;
  ts: number;
}

/**
 * Lock file data
 */
export interface LockFileData {
  pid: number;
  started: string;
  args: string[];
}

/**
 * Log levels
 */
export enum LogLevel {
  DEBUG = 'DEBUG',
  INFO = 'INFO',
  WARN = 'WARN',
  ERROR = 'ERROR',
}

/**
 * Pyth feed IDs
 */
export interface PythFeeds {
  BTC: string;
  ETH: string;
  SOL: string;
}

/**
 * Transaction result
 */
export interface TransactionResult {
  signature: string;
  clientTsMs: number;
  receivedMs: number;
  sentMs: number;
  assets: AssetSymbol[];
  prices: Record<AssetSymbol, string>;
  composite: Record<AssetSymbol, CompositeData> | null;
}

/**
 * Price divergence warning
 */
export interface DivergenceWarning {
  asset: AssetSymbol;
  pythPrice: number;
  compositePrice: number;
  percentage: number;
}

/**
 * Custom error types
 */
export class OracleError extends Error {
  constructor(message: string, public readonly code?: string) {
    super(message);
    this.name = 'OracleError';
  }
}

export class AuthenticationError extends OracleError {
  constructor(message: string) {
    super(message, 'AUTH_ERROR');
    this.name = 'AuthenticationError';
  }
}

export class ConfigurationError extends OracleError {
  constructor(message: string) {
    super(message, 'CONFIG_ERROR');
    this.name = 'ConfigurationError';
  }
}

export class TransactionError extends OracleError {
  constructor(message: string) {
    super(message, 'TX_ERROR');
    this.name = 'TransactionError';
  }
}

export class LockFileError extends OracleError {
  constructor(message: string) {
    super(message, 'LOCK_ERROR');
    this.name = 'LockFileError';
  }
}
