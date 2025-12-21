/**
 * Oracle Controller
 *
 * Main controller process that:
 * - Holds the private key
 * - Supervises the relay process
 * - Validates prices from relay
 * - Signs and submits transactions
 */

import { Connection, Keypair } from '@solana/web3.js';
import { EventEmitter } from 'events';
import { TransactionBuilder } from '../solana/transaction-builder';
import { PriceValidator } from './price-validator';
import { RelaySupervisor } from './relay-supervisor';
import { DECIMALS, TICK_MS } from '../config/constants';
import { toFixedI64, formatPrice } from '../utils/formatting';
import { colors } from '../config/colors';
import { Logger } from '../utils/logger';

export interface ControllerConfig {
  rpcUrl: string;
  updaterKeypair: Keypair;
  updaterIndex: number;
  relayScriptPath: string;
  isDryRun?: boolean;
  verbose?: boolean;
  logger: Logger;
  relayLogFile?: string;
}

export interface PriceData {
  btc: number | null;
  eth: number | null;
  sol: number | null;
  hype: number | null;
  zec: number | null;
  tsla: number | null;
  nvda: number | null;
  mstr: number | null;
  gold: number | null;
  silver: number | null;
}

/**
 * Main oracle controller
 */
export class OracleController extends EventEmitter {
  private config: ControllerConfig;
  private logger: Logger;
  private txBuilder: TransactionBuilder | null = null;
  private validator: PriceValidator;
  private supervisor: RelaySupervisor;

  private lastSentPrices: Record<string, number | null> = {
    BTC: null,
    ETH: null,
    SOL: null,
    HYPE: null,
    ZEC: null,
    TSLA: null,
    NVDA: null,
    MSTR: null,
    GOLD: null,
    SILVER: null,
  };

  private lastSentI64: Record<string, number | null> = {
    BTC: null,
    ETH: null,
    SOL: null,
    HYPE: null,
    ZEC: null,
    TSLA: null,
    NVDA: null,
    MSTR: null,
    GOLD: null,
    SILVER: null,
  };

  private updateTimer: NodeJS.Timeout | null = null;
  private currentPrices: PriceData | null = null;

  // Error handling state
  private consecutiveFailures = 0;
  private lastFailureTime = 0;
  private circuitBreakerOpen = false;
  private circuitBreakerResetTime = 0;
  private totalErrors = 0;
  private totalSuccesses = 0;

  constructor(config: ControllerConfig) {
    super();
    this.config = config;
    this.logger = config.logger;
    this.validator = new PriceValidator();

    // Setup supervisor
    this.supervisor = new RelaySupervisor({
      relayScriptPath: config.relayScriptPath,
      maxRestarts: 5,
      restartDelayMs: 2000,
      healthCheckIntervalMs: 10000, // Check health every 10s
      healthCheckTimeoutMs: 30000, // 30s without heartbeat = dead
      relayLogFile: config.relayLogFile,
    });

    this.setupSupervisorHandlers();
  }

  /**
   * Setup supervisor event handlers
   */
  private setupSupervisorHandlers() {
    this.supervisor.on('relay_started', () => {
      this.logger.logToConsole(colors.green + '[Controller] Relay started' + colors.reset);
    });

    this.supervisor.on('heartbeat', () => {
      if (this.config.verbose) {
        this.logger.info(colors.gray + `[Controller] Heartbeat from relay` + colors.reset);
      }
    });

    this.supervisor.on('price_update', (msg) => {
      this.handlePriceUpdate(msg.data);
    });

    this.supervisor.on('max_restarts_exceeded', () => {
      this.logger.errorToConsole(
        colors.red + '[Controller] Relay exceeded max restarts, shutting down' + colors.reset
      );
      this.shutdown();
    });

    this.supervisor.on('error', (err) => {
      this.logger.errorToConsole(colors.red + '[Controller] Supervisor error:' + colors.reset, err);
    });
  }

  /**
   * Handle price update from relay
   */
  private handlePriceUpdate(data: PriceData) {
    if (this.config.verbose) {
      const priceStr = Object.entries(data)
        .filter(([_, price]) => price !== null)
        .map(([asset, price]) => `${asset.toUpperCase()}=$${formatPrice(price!)}`)
        .join(', ');
      this.logger.info(
        colors.gray + `[Controller] Price update: ${priceStr}` + colors.reset
      );
    }

    this.currentPrices = data;
  }

  /**
   * Initialize the controller
   */
  async initialize() {
    this.logger.logToConsole('[Controller] Initializing...');

    // Initialize transaction builder
    if (!this.config.isDryRun) {
      const connection = new Connection(this.config.rpcUrl, 'processed');
      this.txBuilder = new TransactionBuilder(connection);

      // Initialize state account if needed
      await this.txBuilder.initializeIfNeeded(this.config.updaterKeypair);
      this.logger.logToConsole(colors.green + '[Controller] Transaction builder ready' + colors.reset);
    }

    // Start relay supervisor
    await this.supervisor.start();

    this.logger.logToConsole(
      colors.green +
        `[Controller] Initialized (updater index ${this.config.updaterIndex})` +
        colors.reset
    );
  }

  /**
   * Start the update loop
   */
  start() {
    this.logger.logToConsole('[Controller] Starting update loop...');

    this.updateTimer = setInterval(() => {
      this.processUpdate();
    }, TICK_MS);

    this.logger.logToConsole(colors.green + '[Controller] Running' + colors.reset);
  }

  /**
   * Process price update (validation + signing)
   */
  private async processUpdate() {
    if (!this.currentPrices) return;

    const prices = this.currentPrices;

    // Check which prices need updating
    const updates: Array<{ asset: string; price: number; i64: number }> = [];

    for (const [assetKey, price] of Object.entries(prices)) {
      if (price === null) continue;

      const asset = assetKey.toUpperCase();

      // Validate price
      const validation = this.validator.validate(asset, price);
      if (!validation.valid) {
        this.logger.warn(
          `[Controller] ${asset} validation failed: ${validation.reason}`
        );
        continue;
      }

      // Convert to i64
      const i64 = toFixedI64(price, DECIMALS);

      // Check if changed
      if (this.lastSentI64[asset] !== null && this.lastSentI64[asset] === i64) {
        continue; // No change
      }

      updates.push({ asset, price, i64 });
    }

    if (updates.length === 0) return;

    // Process update
    if (this.config.isDryRun) {
      this.processDryRun(updates);
    } else {
      await this.processLiveUpdate(updates);
    }
  }

  /**
   * Process dry run update
   */
  private processDryRun(updates: Array<{ asset: string; price: number; i64: number }>) {
    const priceStr = updates
      .map(({ asset, price }) => `${asset}=$${formatPrice(price)}`)
      .join(', ');

    this.logger.info(
      colors.gray + `[${new Date().toISOString()}]` + colors.reset +
        ` ${colors.green}✓${colors.reset} Would send: ${priceStr}`
    );

    // Record as sent
    for (const { asset, price, i64 } of updates) {
      this.validator.recordPrice(asset, price);
      this.lastSentPrices[asset] = price;
      this.lastSentI64[asset] = i64;
    }
  }

  /**
   * Check if circuit breaker should prevent transaction attempts
   */
  private isCircuitBreakerOpen(): boolean {
    if (!this.circuitBreakerOpen) {
      return false;
    }

    // Check if it's time to reset the circuit breaker
    if (Date.now() >= this.circuitBreakerResetTime) {
      this.logger.info(colors.yellow + '[Controller] Circuit breaker reset - retrying transactions' + colors.reset);
      this.circuitBreakerOpen = false;
      this.consecutiveFailures = 0;
      return false;
    }

    return true;
  }

  /**
   * Categorize error type for better logging
   */
  private categorizeError(err: any): { type: 'transient' | 'permanent' } {
    const msg = err?.message?.toLowerCase() || String(err).toLowerCase();

    // Transient errors (network/RPC issues)
    const transientPatterns = [
      'block height exceeded',
      'blockhash not found',
      'blockhash expired',
      'timeout',
      'network',
      'connection',
      'econnrefused',
      'enotfound',
      'rate limit',
      '429',
      '503',
      '504',
    ];

    const isTransient = transientPatterns.some(pattern => msg.includes(pattern));

    return { type: isTransient ? 'transient' : 'permanent' };
  }

  /**
   * Handle transaction error with circuit breaker (no retries - continue with fresh data)
   */
  private handleTransactionError(err: any, updates: Array<{ asset: string; price: number }>) {
    this.totalErrors++;
    this.consecutiveFailures++;
    this.lastFailureTime = Date.now();

    const errorCategory = this.categorizeError(err);
    const priceStr = updates.map(({ asset, price }) => `${asset}=$${formatPrice(price)}`).join(', ');

    // Log detailed error information
    this.logger.error(
      colors.red + `[Controller] Transaction failed (${errorCategory.type})` + colors.reset +
        ` - ${priceStr}\n` +
        `  Error: ${err?.message || String(err)}\n` +
        `  Consecutive failures: ${this.consecutiveFailures}\n` +
        `  Success rate: ${this.totalSuccesses}/${this.totalSuccesses + this.totalErrors} ` +
        `(${((this.totalSuccesses / Math.max(1, this.totalSuccesses + this.totalErrors)) * 100).toFixed(1)}%)\n` +
        `  ${colors.yellow}Skipping failed transaction - will continue with fresh data${colors.reset}`
    );

    // Open circuit breaker after 10 consecutive failures
    if (this.consecutiveFailures >= 10 && !this.circuitBreakerOpen) {
      this.circuitBreakerOpen = true;
      this.circuitBreakerResetTime = Date.now() + 60000; // Reset after 1 minute
      this.logger.error(
        colors.red + '⚠️  [Controller] Circuit breaker OPENED - pausing transactions for 60 seconds' + colors.reset
      );
    }
  }

  /**
   * Record successful transaction
   */
  private recordTransactionSuccess() {
    this.totalSuccesses++;
    if (this.consecutiveFailures > 0) {
      this.logger.info(
        colors.green +
          `[Controller] Transaction succeeded after ${this.consecutiveFailures} failures - resetting error count` +
          colors.reset
      );
    }
    this.consecutiveFailures = 0;
    this.lastFailureTime = 0;
  }

  /**
   * Process live update (sign and submit)
   */
  private async processLiveUpdate(updates: Array<{ asset: string; price: number; i64: number }>) {
    if (!this.txBuilder) {
      this.logger.errorToConsole('[Controller] Transaction builder not initialized');
      return;
    }

    // Check circuit breaker
    if (this.isCircuitBreakerOpen()) {
      const waitTime = Math.ceil((this.circuitBreakerResetTime - Date.now()) / 1000);
      this.logger.debug(
        colors.yellow +
          `[Controller] Circuit breaker open - skipping transaction (resets in ${waitTime}s)` +
          colors.reset
      );
      return;
    }

    try {
      // Get current prices (use last sent if not updated)
      const btcI64 = updates.find(u => u.asset === 'BTC')?.i64 || this.lastSentI64.BTC || 0;
      const ethI64 = updates.find(u => u.asset === 'ETH')?.i64 || this.lastSentI64.ETH || 0;
      const solI64 = updates.find(u => u.asset === 'SOL')?.i64 || this.lastSentI64.SOL || 0;
      const hypeI64 = updates.find(u => u.asset === 'HYPE')?.i64 || this.lastSentI64.HYPE || 0;
      const zecI64 = updates.find(u => u.asset === 'ZEC')?.i64 || this.lastSentI64.ZEC || 0;
      const tslaI64 = updates.find(u => u.asset === 'TSLA')?.i64 || this.lastSentI64.TSLA || 0;
      const nvdaI64 = updates.find(u => u.asset === 'NVDA')?.i64 || this.lastSentI64.NVDA || 0;
      const mstrI64 = updates.find(u => u.asset === 'MSTR')?.i64 || this.lastSentI64.MSTR || 0;
      const goldI64 = updates.find(u => u.asset === 'GOLD')?.i64 || this.lastSentI64.GOLD || 0;
      const silverI64 = updates.find(u => u.asset === 'SILVER')?.i64 || this.lastSentI64.SILVER || 0;

      const clientTsMs = Date.now();

      // Sign and send transaction
      const sig = await this.txBuilder.sendBatchPriceUpdate(
        this.config.updaterKeypair,
        this.config.updaterIndex,
        btcI64,
        ethI64,
        solI64,
        hypeI64,
        zecI64,
        tslaI64,
        nvdaI64,
        mstrI64,
        goldI64,
        silverI64,
        clientTsMs
      );

      // Record success
      this.recordTransactionSuccess();

      // Record as sent
      for (const { asset, price, i64 } of updates) {
        this.validator.recordPrice(asset, price);
        this.lastSentPrices[asset] = price;
        this.lastSentI64[asset] = i64;
      }

      const priceStr = updates
        .map(({ asset, price }) => `${asset}=$${formatPrice(price)}`)
        .join(', ');

      this.logger.info(
        colors.gray + `[${new Date().toISOString()}]` + colors.reset +
          ` ${colors.green}✓${colors.reset} Updated: ${priceStr} ` +
          colors.gray + `(tx: ${sig.substring(0, 8)}...)` + colors.reset
      );
    } catch (err) {
      this.handleTransactionError(err, updates);
    }
  }

  /**
   * Get controller status
   */
  getStatus() {
    const relayHealth = this.supervisor.getHealth();
    const successRate = this.totalSuccesses + this.totalErrors > 0
      ? (this.totalSuccesses / (this.totalSuccesses + this.totalErrors)) * 100
      : 100;

    return {
      relay: relayHealth,
      prices: this.currentPrices,
      lastSent: this.lastSentPrices,
      updaterIndex: this.config.updaterIndex,
      errorMetrics: {
        consecutiveFailures: this.consecutiveFailures,
        totalSuccesses: this.totalSuccesses,
        totalErrors: this.totalErrors,
        successRate: parseFloat(successRate.toFixed(1)),
        circuitBreakerOpen: this.circuitBreakerOpen,
        lastFailureTime: this.lastFailureTime > 0 ? new Date(this.lastFailureTime).toISOString() : null,
      },
    };
  }

  /**
   * Shutdown the controller
   */
  async shutdown() {
    this.logger.logToConsole('[Controller] Shutting down...');

    if (this.updateTimer) {
      clearInterval(this.updateTimer);
      this.updateTimer = null;
    }

    await this.supervisor.stop();

    this.logger.logToConsole(colors.green + '[Controller] Shutdown complete' + colors.reset);
    process.exit(0);
  }
}
