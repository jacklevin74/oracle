/**
 * Oracle service - Main application orchestrator
 */

import { Connection, Keypair } from '@solana/web3.js';
import { EventEmitter } from 'events';
import {
  AssetSymbol,
  LatestPrices,
  SentPriceTracking,
  LastSentI64,
  CompositeTrackingMap,
  PriceUpdateItem,
  CompositeData,
  PriceData,
  DivergenceWarning,
} from '../types';
import { TransactionBuilder } from '../solana/transaction-builder';
import { PythClient } from '../oracles/pyth-client';
import { CompositeClient, COMPOSITE_CONFIGS } from '../oracles/composite-client';
import { Logger } from '../utils/logger';
import { toFixedI64, formatPrice } from '../utils/formatting';
import { colors } from '../config/colors';
import {
  DECIMALS,
  TICK_MS,
  DIVERGENCE_WARNING_THRESHOLD,
  LOG_THROTTLE_MS,
  DEFAULT_RPC_URL,
  PROGRAM_ID,
} from '../config/constants';

/**
 * Oracle service configuration
 */
export interface OracleServiceConfig {
  rpcUrl?: string;
  updaterKeypair: Keypair;
  updaterIndex: number;
  isDryRun?: boolean;
  logger: Logger;
}

/**
 * Oracle service for managing price feeds and updates
 */
export class OracleService extends EventEmitter {
  private config: OracleServiceConfig;
  private txBuilder: TransactionBuilder | null = null;
  private pythClient: PythClient;
  private compositeClient: CompositeClient;
  private logger: Logger;

  // Price tracking
  private latest: LatestPrices;
  private sentUpTo: SentPriceTracking;
  private lastSentI64: LastSentI64;
  private compositeData: CompositeTrackingMap;

  // Update loop
  private updateInterval: NodeJS.Timeout | null = null;
  private lastLogTime: number = 0;

  // Heartbeat monitoring
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private updateCount: number = 0;
  private errorCount: number = 0;

  constructor(config: OracleServiceConfig) {
    super();
    this.config = config;
    this.logger = config.logger;

    // Initialize price tracking
    this.latest = {
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

    this.sentUpTo = {
      BTC: 0,
      ETH: 0,
      SOL: 0,
      HYPE: 0,
      ZEC: 0,
      TSLA: 0,
      NVDA: 0,
      MSTR: 0,
      GOLD: 0,
      SILVER: 0,
    };

    this.lastSentI64 = {
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

    this.compositeData = {
      BTC: { price: null, count: 0, sources: [] },
      ETH: { price: null, count: 0, sources: [] },
      SOL: { price: null, count: 0, sources: [] },
      HYPE: { price: null, count: 0, sources: [] },
      ZEC: { price: null, count: 0, sources: [] },
      TSLA: { price: null, count: 0, sources: [] },
      NVDA: { price: null, count: 0, sources: [] },
      MSTR: { price: null, count: 0, sources: [] },
      GOLD: { price: null, count: 0, sources: [] },
      SILVER: { price: null, count: 0, sources: [] },
    };

    // Initialize clients
    this.pythClient = new PythClient();
    this.compositeClient = new CompositeClient();

    // Setup event handlers
    this.setupPythHandlers();
    this.setupCompositeHandlers();
  }

  /**
   * Setup Pyth price feed handlers
   */
  private setupPythHandlers(): void {
    this.pythClient.on('price', (symbol: AssetSymbol, priceData: PriceData) => {
      this.latest[symbol] = priceData;
    });
  }

  /**
   * Setup composite oracle handlers
   */
  private setupCompositeHandlers(): void {
    this.compositeClient.on('price', (symbol: AssetSymbol, data: CompositeData) => {
      // Store composite data directly - TypeScript oracle returns correct format
      this.compositeData[symbol] = {
        price: data.composite,
        count: data.count,
        sources: data.sources || [],
      };
    });
  }

  /**
   * Initialize the oracle service
   */
  async initialize(): Promise<void> {
    const rpcUrl = this.config.rpcUrl || DEFAULT_RPC_URL;

    if (!this.config.isDryRun) {
      const connection = new Connection(rpcUrl, 'processed');
      this.txBuilder = new TransactionBuilder(connection);

      // Initialize state account if needed
      await this.txBuilder.initializeIfNeeded(this.config.updaterKeypair);
    }

    this.logger.logToConsole('Starting price streams...\n');

    // Start Pyth feeds (BTC, ETH, SOL, ZEC - no HYPE on Pyth)
    await this.pythClient.subscribe();
    this.logger.logToConsole(colors.green + '✓ Connected to Pyth Network (BTC, ETH, SOL, ZEC)' + colors.reset);

    // Start composite oracles for all assets
    for (const symbol of Object.keys(COMPOSITE_CONFIGS) as AssetSymbol[]) {
      this.compositeClient.startOracle(symbol, COMPOSITE_CONFIGS[symbol]);
    }
    this.logger.logToConsole(
      colors.green + '✓ Connected to Composite Oracle exchanges:' + colors.reset +
      colors.gray + '\n   Kraken, Coinbase, KuCoin, Binance, MEXC, Bybit, Hyperliquid' + colors.reset
    );
    this.logger.logToConsole(colors.gray + '   Aggregating: BTC, ETH, SOL, HYPE, ZEC' + colors.reset);
    this.logger.logToConsole('');
  }

  /**
   * Display data sources configuration
   */
  displayDataSources(): void {
    this.logger.logToConsole('\n' + colors.gray + '='.repeat(70) + colors.reset);
    this.logger.logToConsole(colors.cyan + '📡 DATA SOURCES CONFIGURATION' + colors.reset);
    this.logger.logToConsole(colors.gray + '='.repeat(70) + colors.reset);

    this.logger.logToConsole('\n' + colors.yellow + '1️⃣  PYTH NETWORK (Hermes)' + colors.reset);
    this.logger.logToConsole(colors.gray + '    URL: https://hermes.pyth.network' + colors.reset);
    this.logger.logToConsole('    Provides: ' + colors.green + 'BTC/USD, ETH/USD, SOL/USD' + colors.reset);

    this.logger.logToConsole('\n' + colors.yellow + '2️⃣  COMPOSITE ORACLE (o3.js)' + colors.reset);
    this.logger.logToConsole('    Aggregates ' + colors.green + 'BTC/USD, ETH/USD, SOL/USD' + colors.reset + ' from multiple exchanges');

    this.logger.logToConsole('\n' + colors.yellow + '3️⃣  HYPE TOKEN (Composite Oracle Only)' + colors.reset);
    this.logger.logToConsole('    ' + colors.magenta + 'HYPE/USD' + colors.reset + ' sourced exclusively from exchanges');

    this.logger.logToConsole('\n' + colors.cyan + '📤 OUTPUT:' + colors.reset);
    if (this.config.isDryRun) {
      this.logger.logToConsole('    Mode: ' + colors.yellow + 'DRY RUN' + colors.reset);
    } else {
      this.logger.logToConsole('    Mode: ' + colors.red + 'LIVE' + colors.reset);
      this.logger.logToConsole(`    Updater Index: ${colors.yellow}${this.config.updaterIndex}${colors.reset}`);
    }
    this.logger.logToConsole(colors.gray + '='.repeat(70) + '\n' + colors.reset);

    if (!this.logger.isVerbose()) {
      this.logger.logToConsole(colors.gray + 'ℹ️  Verbose logging disabled. Use --verbose or -v to see detailed updates.' + colors.reset);
    }
  }

  /**
   * Get fresh price updates that need to be sent
   */
  private getFreshUpdates(): PriceUpdateItem[] {
    const fresh: PriceUpdateItem[] = [];
    const symbols: AssetSymbol[] = ['BTC', 'ETH', 'SOL', 'HYPE', 'ZEC'];

    for (const sym of symbols) {
      let priceToUse: number;
      let pubMsToUse: number;
      let priceSource: 'pyth' | 'composite';

      // HYPE and ZEC use composite oracle only (no Pyth feed for HYPE, ZEC has both)
      if (sym === 'HYPE') {
        const compData = this.compositeData[sym];
        if (compData.price == null) continue;
        priceToUse = compData.price;
        pubMsToUse = Date.now();
        priceSource = 'composite';
      } else if (sym === 'ZEC') {
        // ZEC uses Pyth feed
        const latestPrice = this.latest[sym];
        if (!latestPrice) continue;
        priceToUse = latestPrice.price;
        pubMsToUse = latestPrice.pubMs;
        priceSource = 'pyth';
      } else {
        // BTC, ETH, SOL use Pyth
        const latestPrice = this.latest[sym];
        if (!latestPrice) continue;
        priceToUse = latestPrice.price;
        pubMsToUse = latestPrice.pubMs;
        priceSource = 'pyth';
      }

      const candI64 = toFixedI64(priceToUse, DECIMALS);
      const newerPub = pubMsToUse > this.sentUpTo[sym];
      const changedI64 = this.lastSentI64[sym] == null || candI64 !== this.lastSentI64[sym];

      if (newerPub && changedI64) {
        fresh.push({ sym, candI64, priceSource });
      }
    }

    return fresh;
  }

  /**
   * Calculate price divergence warnings
   */
  private calculateDivergence(fresh: PriceUpdateItem[]): DivergenceWarning[] {
    const warnings: DivergenceWarning[] = [];

    for (const item of fresh) {
      const compData = this.compositeData[item.sym];
      if (compData.price == null) continue;

      const pythPrice = item.candI64 / Math.pow(10, DECIMALS);
      const diff = Math.abs(pythPrice - compData.price);
      const pct = (diff / compData.price) * 100;

      if (pct > DIVERGENCE_WARNING_THRESHOLD) {
        warnings.push({
          asset: item.sym,
          pythPrice,
          compositePrice: compData.price,
          percentage: pct,
        });
      }
    }

    return warnings;
  }

  /**
   * Handle dry run update
   */
  private handleDryRunUpdate(fresh: PriceUpdateItem[], clientTsMs: number): void {
    if (this.logger.isVerbose()) {
      this.logVerboseDryRun(fresh, clientTsMs);
    } else {
      this.logMinimalDryRun(fresh);
    }

    // Mark as sent in dry run
    for (const { sym, candI64, priceSource } of fresh) {
      this.sentUpTo[sym] = priceSource === 'pyth' && this.latest[sym] ? this.latest[sym]!.pubMs : Date.now();
      this.lastSentI64[sym] = candI64;
    }
  }

  /**
   * Log verbose dry run output
   */
  private logVerboseDryRun(fresh: PriceUpdateItem[], clientTsMs: number): void {
    console.log('\n' + colors.gray + '='.repeat(70) + colors.reset);
    console.log(colors.cyan + `📊 Price Update @ ${new Date(clientTsMs).toISOString()}` + colors.reset);
    console.log(colors.gray + '='.repeat(70) + colors.reset);

    // Show Pyth prices
    console.log('\n' + colors.yellow + '📡 PYTH NETWORK (Hermes):' + colors.reset);
    console.log(colors.gray + '   Source: https://hermes.pyth.network' + colors.reset);

    for (const item of fresh) {
      if (item.priceSource === 'pyth' && item.sym !== 'HYPE') {
        const price = item.candI64 / Math.pow(10, DECIMALS);
        const latestPrice = this.latest[item.sym];
        const pubTime = latestPrice ? new Date(latestPrice.pubMs).toISOString() : 'N/A';
        const feedId = this.pythClient.getFeedId(item.sym) || 'N/A';

        console.log(`   • ${colors.green}${item.sym}/USD${colors.reset}: $${formatPrice(price)}`);
        console.log(colors.gray + `     Feed ID: ${feedId.substring(0, 20)}...` + colors.reset);
        console.log(colors.gray + `     Publish time: ${pubTime}` + colors.reset);
      }
    }

    // Show Composite prices with detailed breakdown
    console.log('\n' + colors.yellow + '🔗 COMPOSITE ORACLE (o3.js):' + colors.reset);
    console.log('');

    const symbols: AssetSymbol[] = ['BTC', 'ETH', 'SOL', 'HYPE', 'ZEC'];
    for (const sym of symbols) {
      const compData = this.compositeData[sym];

      // Skip if no price data available (but always show HYPE/ZEC if they have sources)
      if (!compData.price && !(sym === 'HYPE' && compData.count > 0) && !(sym === 'ZEC' && compData.count > 0)) continue;

      const price = compData.price;
      const sources = compData.sources || [];
      const activeCount = sources.length;
      // HYPE: 7 sources, ZEC: 5 sources (no Kraken/Bybit), Others: 6 sources
      const totalCount = sym === 'HYPE' ? 7 : sym === 'ZEC' ? 5 : 6;

      // Color for HYPE and ZEC tokens
      const symbolColor = sym === 'HYPE' ? colors.magenta : sym === 'ZEC' ? colors.yellow : colors.green;

      if (price !== null) {
        console.log(`   • ${symbolColor}${sym}/USD${colors.reset}: ${colors.green}$${formatPrice(price)}${colors.reset}`);
        console.log(colors.gray + `     Active sources: ${activeCount}/${totalCount}` + colors.reset);
      } else {
        // Show waiting for data if price is null but we have sources
        console.log(`   • ${symbolColor}${sym}/USD${colors.reset}: ${colors.yellow}Waiting for data...${colors.reset}`);
        console.log(colors.gray + `     Active sources: ${activeCount}/${totalCount}` + colors.reset);
      }

      if (activeCount > 0) {
        console.log(colors.gray + '     Individual sources:' + colors.reset);
        for (const sourceData of sources) {
          const age = (sourceData.age / 1000).toFixed(1);
          console.log(colors.gray + `       • ${colors.cyan}${sourceData.source.padEnd(12)}${colors.reset}: ${colors.green}$${formatPrice(sourceData.price)}${colors.reset} ${colors.gray}(age: ${age}s)${colors.reset}`);
        }
      }

      // Show price comparison only if we have a price
      if (price !== null) {
        // Show price comparison with Pyth (except for HYPE which is composite-only)
        if (sym !== 'HYPE') {
          const pythPrice = this.latest[sym];
          if (pythPrice) {
            const pythVal = pythPrice.price;
            const diff = Math.abs(pythVal - price);
            const pct = (diff / pythVal) * 100;

            console.log('');
            console.log(colors.gray + '     📈 Price Comparison:' + colors.reset);
            console.log(colors.gray + `       Pyth ${sym}:      ${colors.yellow}$${formatPrice(pythVal)}${colors.reset}`);
            console.log(colors.gray + `       Composite ${sym}: ${colors.cyan}$${formatPrice(price)}${colors.reset}`);
            console.log(colors.gray + `       Difference:    ${colors.yellow}$${diff.toFixed(2)} (${pct.toFixed(3)}%)${colors.reset}`);

            if (pct > DIVERGENCE_WARNING_THRESHOLD) {
              console.log(colors.red + `       ⚠️  Exceeds threshold (${DIVERGENCE_WARNING_THRESHOLD}%)` + colors.reset);
            } else {
              console.log(colors.green + '       ✅ Within acceptable range' + colors.reset);
            }
          }
        } else {
          // For HYPE, just show it's from composite only (no Pyth feed)
          console.log('');
          console.log(colors.gray + '     📈 Price Comparison:' + colors.reset);
          console.log(colors.gray + `       Pyth HYPE:      ${colors.yellow}$${formatPrice(price)}${colors.reset}`);
          console.log(colors.gray + `       Composite HYPE: ${colors.cyan}$${formatPrice(price)}${colors.reset}`);
          console.log(colors.gray + `       Difference:    ${colors.yellow}$0.00 (0.000%)${colors.reset}`);
          console.log(colors.green + '       ✅ Within acceptable range' + colors.reset);
        }
      }

      console.log('');
    }

    // Show what would be sent
    console.log(colors.yellow + '💾 WOULD SEND TO BLOCKCHAIN:' + colors.reset);
    console.log(colors.gray + `   Program: ${PROGRAM_ID.toBase58()}` + colors.reset);
    console.log(colors.gray + `   Updater Index: ${this.config.updaterIndex}` + colors.reset);
    console.log(`   ${colors.gray}Assets:${colors.reset} ${colors.green}${fresh.map((f) => f.sym).join(', ')}${colors.reset}`);
    console.log(colors.gray + '='.repeat(70) + '\n' + colors.reset);
  }

  /**
   * Log minimal dry run output (throttled)
   */
  private logMinimalDryRun(fresh: PriceUpdateItem[]): void {
    const now = Date.now();
    if (now - this.lastLogTime >= LOG_THROTTLE_MS) {
      const priceStr = fresh
        .map(({ sym, candI64 }) => `${sym}=$${formatPrice(candI64 / Math.pow(10, DECIMALS))}`)
        .join(', ');
      console.log(`${colors.gray}[${new Date().toISOString()}]${colors.reset} ✓ Would send: ${priceStr}`);
      this.lastLogTime = now;
    }
  }

  /**
   * Handle live update (send transaction)
   */
  private async handleLiveUpdate(fresh: PriceUpdateItem[], clientTsMs: number): Promise<void> {
    if (!this.txBuilder) {
      throw new Error('Transaction builder not initialized');
    }

    const t0 = Date.now();

    // Collect prices for all 10 assets
    const btcData = fresh.find((f) => f.sym === 'BTC');
    const ethData = fresh.find((f) => f.sym === 'ETH');
    const solData = fresh.find((f) => f.sym === 'SOL');
    const hypeData = fresh.find((f) => f.sym === 'HYPE');
    const zecData = fresh.find((f) => f.sym === 'ZEC');
    const tslaData = fresh.find((f) => f.sym === 'TSLA');
    const nvdaData = fresh.find((f) => f.sym === 'NVDA');
    const mstrData = fresh.find((f) => f.sym === 'MSTR');
    const goldData = fresh.find((f) => f.sym === 'GOLD');
    const silverData = fresh.find((f) => f.sym === 'SILVER');

    const btcPrice = btcData ? btcData.candI64 : this.lastSentI64.BTC || 0;
    const ethPrice = ethData ? ethData.candI64 : this.lastSentI64.ETH || 0;
    const solPrice = solData ? solData.candI64 : this.lastSentI64.SOL || 0;
    const hypePrice = hypeData ? hypeData.candI64 : this.lastSentI64.HYPE || 0;
    const zecPrice = zecData ? zecData.candI64 : this.lastSentI64.ZEC || 0;
    const tslaPrice = tslaData ? tslaData.candI64 : this.lastSentI64.TSLA || 0;
    const nvdaPrice = nvdaData ? nvdaData.candI64 : this.lastSentI64.NVDA || 0;
    const mstrPrice = mstrData ? mstrData.candI64 : this.lastSentI64.MSTR || 0;
    const goldPrice = goldData ? goldData.candI64 : this.lastSentI64.GOLD || 0;
    const silverPrice = silverData ? silverData.candI64 : this.lastSentI64.SILVER || 0;

    const tRecv = Date.now();

    try {
      const sig = await this.txBuilder.sendBatchPriceUpdate(
        this.config.updaterKeypair,
        this.config.updaterIndex,
        btcPrice,
        ethPrice,
        solPrice,
        hypePrice,
        zecPrice,
        tslaPrice,
        nvdaPrice,
        mstrPrice,
        goldPrice,
        silverPrice,
        clientTsMs
      );

      const tSent = Date.now();

      // Mark sent
      for (const { sym, candI64, priceSource } of fresh) {
        this.sentUpTo[sym] = priceSource === 'pyth' && this.latest[sym] ? this.latest[sym]!.pubMs : Date.now();
        this.lastSentI64[sym] = candI64;
      }

      // Log result
      this.logTransactionResult(fresh, sig, clientTsMs, tRecv, tSent, t0);

      // Check divergence
      const warnings = this.calculateDivergence(fresh);
      if (warnings.length > 0) {
        this.logDivergenceWarnings(warnings);
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('Blockhash expired')) {
        console.warn('[send/batch] skipped: blockhash expired (no retry)');
        return;
      }
      throw error;
    }
  }

  /**
   * Log transaction result
   */
  private logTransactionResult(
    fresh: PriceUpdateItem[],
    sig: string,
    clientTsMs: number,
    tRecv: number,
    tSent: number,
    t0: number
  ): void {
    if (this.logger.isVerbose()) {
      const compositeInfo: Record<string, unknown> = {};
      for (const sym of ['BTC', 'ETH', 'SOL', 'HYPE', 'ZEC'] as AssetSymbol[]) {
        const compData = this.compositeData[sym];
        if (compData.price != null && compData.sources) {
          compositeInfo[sym] = {
            price: formatPrice(compData.price),
            sources: compData.count,
            sourceDetails: compData.sources.map((data) => ({
              name: data.source,
              price: formatPrice(data.price),
              age_ms: data.age,
            })),
          };
        }
      }

      console.log(
        JSON.stringify(
          {
            ts_ms: clientTsMs,
            idx: this.config.updaterIndex,
            assets: fresh.map(({ sym }) => sym),
            prices: Object.fromEntries(
              fresh.map(({ sym, candI64 }) => [sym, formatPrice(candI64 / Math.pow(10, DECIMALS))])
            ),
            composite: Object.keys(compositeInfo).length > 0 ? compositeInfo : null,
            tx: sig,
            t_recv: tRecv,
            t_sent: tSent,
            dt_handle: tRecv - t0,
            dt_send: tSent - tRecv,
          },
          null,
          0
        )
      );
    } else {
      const now = Date.now();
      if (now - this.lastLogTime >= LOG_THROTTLE_MS) {
        const priceStr = fresh
          .map(({ sym, candI64 }) => `${sym}=$${formatPrice(candI64 / Math.pow(10, DECIMALS))}`)
          .join(', ');
        console.log(
          `${colors.gray}[${new Date().toISOString()}]${colors.reset} ✓ Updated: ${priceStr} ${colors.gray}(tx: ${sig.substring(0, 8)}...)${colors.reset}`
        );
        this.lastLogTime = now;
      }
    }
  }

  /**
   * Log divergence warnings
   */
  private logDivergenceWarnings(warnings: DivergenceWarning[]): void {
    const msg = warnings
      .map(
        (w) =>
          `${w.asset}: Pyth=${w.pythPrice.toFixed(2)} vs Composite=${w.compositePrice.toFixed(2)} (${w.percentage.toFixed(3)}%)`
      )
      .join(', ');
    console.warn(`[WARN] Price divergence > ${DIVERGENCE_WARNING_THRESHOLD}%: ${msg}`);
  }

  /**
   * Log heartbeat to confirm process is alive
   */
  private logHeartbeat(): void {
    const now = Date.now();
    const uptime = process.uptime();
    const memUsage = process.memoryUsage();
    const heapUsedMB = (memUsage.heapUsed / 1024 / 1024).toFixed(2);
    const heapTotalMB = (memUsage.heapTotal / 1024 / 1024).toFixed(2);
    const rssMB = (memUsage.rss / 1024 / 1024).toFixed(2);

    const uptimeStr = uptime > 3600
      ? `${(uptime / 3600).toFixed(1)}h`
      : uptime > 60
        ? `${(uptime / 60).toFixed(1)}m`
        : `${uptime.toFixed(0)}s`;

    const heartbeatMsg =
      `[HEARTBEAT] ${new Date(now).toISOString()} | ` +
      `PID: ${process.pid} | ` +
      `Uptime: ${uptimeStr} | ` +
      `Updates: ${this.updateCount} | ` +
      `Errors: ${this.errorCount} | ` +
      `Mem: ${heapUsedMB}/${heapTotalMB} MB (RSS: ${rssMB} MB)`;

    // Log to both console and file
    this.logger.logToConsole(colors.gray + heartbeatMsg + colors.reset);
    console.log(heartbeatMsg); // Also goes to file if file logging is enabled
  }

  /**
   * Start the update loop
   */
  start(): void {
    this.updateInterval = setInterval(async () => {
      try {
        const fresh = this.getFreshUpdates();
        if (fresh.length === 0) return;

        const clientTsMs = Date.now();

        if (this.config.isDryRun) {
          this.handleDryRunUpdate(fresh, clientTsMs);
        } else {
          await this.handleLiveUpdate(fresh, clientTsMs);
        }

        // Increment update count on success
        this.updateCount++;
      } catch (error) {
        console.error('[send/batch]', error instanceof Error ? error.message : String(error));
        this.errorCount++;
      }
    }, TICK_MS);

    // Start heartbeat monitor (every 60 seconds)
    this.heartbeatInterval = setInterval(() => {
      this.logHeartbeat();
    }, 60000); // 60 seconds

    // Log initial heartbeat
    this.logHeartbeat();
  }

  /**
   * Stop the oracle service
   */
  async stop(): Promise<void> {
    if (this.updateInterval) {
      clearInterval(this.updateInterval);
      this.updateInterval = null;
    }

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    await this.pythClient.close();
    this.compositeClient.stopAll();

    this.emit('stopped');
  }
}
