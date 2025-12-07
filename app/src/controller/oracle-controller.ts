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
  };

  private updateTimer: NodeJS.Timeout | null = null;
  private currentPrices: PriceData | null = null;

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
   * Process live update (sign and submit)
   */
  private async processLiveUpdate(updates: Array<{ asset: string; price: number; i64: number }>) {
    if (!this.txBuilder) {
      this.logger.errorToConsole('[Controller] Transaction builder not initialized');
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
        clientTsMs
      );

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
      this.logger.error('[Controller] Failed to send transaction:', err);
    }
  }

  /**
   * Get controller status
   */
  getStatus() {
    const relayHealth = this.supervisor.getHealth();
    return {
      relay: relayHealth,
      prices: this.currentPrices,
      lastSent: this.lastSentPrices,
      updaterIndex: this.config.updaterIndex,
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
