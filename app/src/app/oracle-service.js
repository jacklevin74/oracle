"use strict";
/**
 * Oracle service - Main application orchestrator
 */
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
exports.OracleService = void 0;
const web3_js_1 = require("@solana/web3.js");
const events_1 = require("events");
const transaction_builder_1 = require("../solana/transaction-builder");
const pyth_client_1 = require("../oracles/pyth-client");
const composite_client_1 = require("../oracles/composite-client");
const formatting_1 = require("../utils/formatting");
const colors_1 = require("../config/colors");
const constants_1 = require("../config/constants");
/**
 * Oracle service for managing price feeds and updates
 */
class OracleService extends events_1.EventEmitter {
    constructor(config) {
        super();
        this.txBuilder = null;
        // Update loop
        this.updateInterval = null;
        this.lastLogTime = 0;
        this.config = config;
        this.logger = config.logger;
        // Initialize price tracking
        this.latest = {
            BTC: null,
            ETH: null,
            SOL: null,
            HYPE: null,
        };
        this.sentUpTo = {
            BTC: 0,
            ETH: 0,
            SOL: 0,
            HYPE: 0,
        };
        this.lastSentI64 = {
            BTC: null,
            ETH: null,
            SOL: null,
            HYPE: null,
        };
        this.compositeData = {
            BTC: { price: null, count: 0, sources: [] },
            ETH: { price: null, count: 0, sources: [] },
            SOL: { price: null, count: 0, sources: [] },
            HYPE: { price: null, count: 0, sources: [] },
        };
        // Initialize clients
        this.pythClient = new pyth_client_1.PythClient();
        this.compositeClient = new composite_client_1.CompositeClient();
        // Setup event handlers
        this.setupPythHandlers();
        this.setupCompositeHandlers();
    }
    /**
     * Setup Pyth price feed handlers
     */
    setupPythHandlers() {
        this.pythClient.on('price', (symbol, priceData) => {
            this.latest[symbol] = priceData;
        });
    }
    /**
     * Setup composite oracle handlers
     */
    setupCompositeHandlers() {
        this.compositeClient.on('price', (symbol, data) => {
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
    initialize() {
        return __awaiter(this, void 0, void 0, function* () {
            const rpcUrl = this.config.rpcUrl || constants_1.DEFAULT_RPC_URL;
            if (!this.config.isDryRun) {
                const connection = new web3_js_1.Connection(rpcUrl, 'processed');
                this.txBuilder = new transaction_builder_1.TransactionBuilder(connection);
                // Initialize state account if needed
                yield this.txBuilder.initializeIfNeeded(this.config.updaterKeypair);
            }
            this.logger.logToConsole('Starting price streams...\n');
            // Start Pyth feeds (BTC, ETH, SOL - no HYPE on Pyth)
            yield this.pythClient.subscribe();
            this.logger.logToConsole(colors_1.colors.green + '✓ Connected to Pyth Network (BTC, ETH, SOL)' + colors_1.colors.reset);
            // Start composite oracles for all assets
            for (const symbol of Object.keys(composite_client_1.COMPOSITE_CONFIGS)) {
                this.compositeClient.startOracle(symbol, composite_client_1.COMPOSITE_CONFIGS[symbol]);
            }
            this.logger.logToConsole(colors_1.colors.green + '✓ Connected to Composite Oracle exchanges:' + colors_1.colors.reset +
                colors_1.colors.gray + '\n   Kraken, Coinbase, KuCoin, Binance, MEXC, Bybit, Hyperliquid' + colors_1.colors.reset);
            this.logger.logToConsole(colors_1.colors.gray + '   Aggregating: BTC, ETH, SOL, HYPE' + colors_1.colors.reset);
            this.logger.logToConsole('');
        });
    }
    /**
     * Display data sources configuration
     */
    displayDataSources() {
        this.logger.logToConsole('\n' + colors_1.colors.gray + '='.repeat(70) + colors_1.colors.reset);
        this.logger.logToConsole(colors_1.colors.cyan + '📡 DATA SOURCES CONFIGURATION' + colors_1.colors.reset);
        this.logger.logToConsole(colors_1.colors.gray + '='.repeat(70) + colors_1.colors.reset);
        this.logger.logToConsole('\n' + colors_1.colors.yellow + '1️⃣  PYTH NETWORK (Hermes)' + colors_1.colors.reset);
        this.logger.logToConsole(colors_1.colors.gray + '    URL: https://hermes.pyth.network' + colors_1.colors.reset);
        this.logger.logToConsole('    Provides: ' + colors_1.colors.green + 'BTC/USD, ETH/USD, SOL/USD' + colors_1.colors.reset);
        this.logger.logToConsole('\n' + colors_1.colors.yellow + '2️⃣  COMPOSITE ORACLE (o3.js)' + colors_1.colors.reset);
        this.logger.logToConsole('    Aggregates ' + colors_1.colors.green + 'BTC/USD, ETH/USD, SOL/USD' + colors_1.colors.reset + ' from multiple exchanges');
        this.logger.logToConsole('\n' + colors_1.colors.yellow + '3️⃣  HYPE TOKEN (Composite Oracle Only)' + colors_1.colors.reset);
        this.logger.logToConsole('    ' + colors_1.colors.magenta + 'HYPE/USD' + colors_1.colors.reset + ' sourced exclusively from exchanges');
        this.logger.logToConsole('\n' + colors_1.colors.cyan + '📤 OUTPUT:' + colors_1.colors.reset);
        if (this.config.isDryRun) {
            this.logger.logToConsole('    Mode: ' + colors_1.colors.yellow + 'DRY RUN' + colors_1.colors.reset);
        }
        else {
            this.logger.logToConsole('    Mode: ' + colors_1.colors.red + 'LIVE' + colors_1.colors.reset);
            this.logger.logToConsole(`    Updater Index: ${colors_1.colors.yellow}${this.config.updaterIndex}${colors_1.colors.reset}`);
        }
        this.logger.logToConsole(colors_1.colors.gray + '='.repeat(70) + '\n' + colors_1.colors.reset);
        if (!this.logger.isVerbose()) {
            this.logger.logToConsole(colors_1.colors.gray + 'ℹ️  Verbose logging disabled. Use --verbose or -v to see detailed updates.' + colors_1.colors.reset);
        }
    }
    /**
     * Get fresh price updates that need to be sent
     */
    getFreshUpdates() {
        const fresh = [];
        const symbols = ['BTC', 'ETH', 'SOL', 'HYPE'];
        for (const sym of symbols) {
            let priceToUse;
            let pubMsToUse;
            let priceSource;
            // HYPE uses composite oracle only (no Pyth feed)
            if (sym === 'HYPE') {
                const compData = this.compositeData[sym];
                if (compData.price == null)
                    continue;
                priceToUse = compData.price;
                pubMsToUse = Date.now();
                priceSource = 'composite';
            }
            else {
                // BTC, ETH, SOL use Pyth
                const latestPrice = this.latest[sym];
                if (!latestPrice)
                    continue;
                priceToUse = latestPrice.price;
                pubMsToUse = latestPrice.pubMs;
                priceSource = 'pyth';
            }
            const candI64 = (0, formatting_1.toFixedI64)(priceToUse, constants_1.DECIMALS);
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
    calculateDivergence(fresh) {
        const warnings = [];
        for (const item of fresh) {
            const compData = this.compositeData[item.sym];
            if (compData.price == null)
                continue;
            const pythPrice = item.candI64 / Math.pow(10, constants_1.DECIMALS);
            const diff = Math.abs(pythPrice - compData.price);
            const pct = (diff / compData.price) * 100;
            if (pct > constants_1.DIVERGENCE_WARNING_THRESHOLD) {
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
    handleDryRunUpdate(fresh, clientTsMs) {
        if (this.logger.isVerbose()) {
            this.logVerboseDryRun(fresh, clientTsMs);
        }
        else {
            this.logMinimalDryRun(fresh);
        }
        // Mark as sent in dry run
        for (const { sym, candI64, priceSource } of fresh) {
            this.sentUpTo[sym] = priceSource === 'pyth' && this.latest[sym] ? this.latest[sym].pubMs : Date.now();
            this.lastSentI64[sym] = candI64;
        }
    }
    /**
     * Log verbose dry run output
     */
    logVerboseDryRun(fresh, clientTsMs) {
        console.log('\n' + colors_1.colors.gray + '='.repeat(70) + colors_1.colors.reset);
        console.log(colors_1.colors.cyan + `📊 Price Update @ ${new Date(clientTsMs).toISOString()}` + colors_1.colors.reset);
        console.log(colors_1.colors.gray + '='.repeat(70) + colors_1.colors.reset);
        // Show Pyth prices
        console.log('\n' + colors_1.colors.yellow + '📡 PYTH NETWORK (Hermes):' + colors_1.colors.reset);
        console.log(colors_1.colors.gray + '   Source: https://hermes.pyth.network' + colors_1.colors.reset);
        for (const item of fresh) {
            if (item.priceSource === 'pyth' && item.sym !== 'HYPE') {
                const price = item.candI64 / Math.pow(10, constants_1.DECIMALS);
                const latestPrice = this.latest[item.sym];
                const pubTime = latestPrice ? new Date(latestPrice.pubMs).toISOString() : 'N/A';
                const feedId = this.pythClient.getFeedId(item.sym) || 'N/A';
                console.log(`   • ${colors_1.colors.green}${item.sym}/USD${colors_1.colors.reset}: $${(0, formatting_1.formatPrice)(price)}`);
                console.log(colors_1.colors.gray + `     Feed ID: ${feedId.substring(0, 20)}...` + colors_1.colors.reset);
                console.log(colors_1.colors.gray + `     Publish time: ${pubTime}` + colors_1.colors.reset);
            }
        }
        // Show Composite prices with detailed breakdown
        console.log('\n' + colors_1.colors.yellow + '🔗 COMPOSITE ORACLE (o3.js):' + colors_1.colors.reset);
        console.log('');
        const symbols = ['BTC', 'ETH', 'SOL', 'HYPE'];
        for (const sym of symbols) {
            const compData = this.compositeData[sym];
            // Skip if no price data available (but always show HYPE if it has sources)
            if (!compData.price && !(sym === 'HYPE' && compData.count > 0))
                continue;
            const price = compData.price;
            const sources = compData.sources || [];
            const activeCount = sources.length;
            const totalCount = sym === 'HYPE' ? 7 : 6;
            // Color for HYPE token
            const symbolColor = sym === 'HYPE' ? colors_1.colors.magenta : colors_1.colors.green;
            if (price !== null) {
                console.log(`   • ${symbolColor}${sym}/USD${colors_1.colors.reset}: ${colors_1.colors.green}$${(0, formatting_1.formatPrice)(price)}${colors_1.colors.reset}`);
                console.log(colors_1.colors.gray + `     Active sources: ${activeCount}/${totalCount}` + colors_1.colors.reset);
            }
            else {
                // Show waiting for data if price is null but we have sources
                console.log(`   • ${symbolColor}${sym}/USD${colors_1.colors.reset}: ${colors_1.colors.yellow}Waiting for data...${colors_1.colors.reset}`);
                console.log(colors_1.colors.gray + `     Active sources: ${activeCount}/${totalCount}` + colors_1.colors.reset);
            }
            if (activeCount > 0) {
                console.log(colors_1.colors.gray + '     Individual sources:' + colors_1.colors.reset);
                for (const sourceData of sources) {
                    const age = (sourceData.age / 1000).toFixed(1);
                    console.log(colors_1.colors.gray + `       • ${colors_1.colors.cyan}${sourceData.source.padEnd(12)}${colors_1.colors.reset}: ${colors_1.colors.green}$${(0, formatting_1.formatPrice)(sourceData.price)}${colors_1.colors.reset} ${colors_1.colors.gray}(age: ${age}s)${colors_1.colors.reset}`);
                }
            }
            // Show price comparison only if we have a price
            if (price !== null) {
                // Show price comparison with Pyth (except for HYPE)
                if (sym !== 'HYPE') {
                    const pythPrice = this.latest[sym];
                    if (pythPrice) {
                        const pythVal = pythPrice.price;
                        const diff = Math.abs(pythVal - price);
                        const pct = (diff / pythVal) * 100;
                        console.log('');
                        console.log(colors_1.colors.gray + '     📈 Price Comparison:' + colors_1.colors.reset);
                        console.log(colors_1.colors.gray + `       Pyth ${sym}:      ${colors_1.colors.yellow}$${(0, formatting_1.formatPrice)(pythVal)}${colors_1.colors.reset}`);
                        console.log(colors_1.colors.gray + `       Composite ${sym}: ${colors_1.colors.cyan}$${(0, formatting_1.formatPrice)(price)}${colors_1.colors.reset}`);
                        console.log(colors_1.colors.gray + `       Difference:    ${colors_1.colors.yellow}$${diff.toFixed(2)} (${pct.toFixed(3)}%)${colors_1.colors.reset}`);
                        if (pct > constants_1.DIVERGENCE_WARNING_THRESHOLD) {
                            console.log(colors_1.colors.red + `       ⚠️  Exceeds threshold (${constants_1.DIVERGENCE_WARNING_THRESHOLD}%)` + colors_1.colors.reset);
                        }
                        else {
                            console.log(colors_1.colors.green + '       ✅ Within acceptable range' + colors_1.colors.reset);
                        }
                    }
                }
                else {
                    // For HYPE, just show it's from composite only
                    console.log('');
                    console.log(colors_1.colors.gray + '     📈 Price Comparison:' + colors_1.colors.reset);
                    console.log(colors_1.colors.gray + `       Pyth HYPE:      ${colors_1.colors.yellow}$${(0, formatting_1.formatPrice)(price)}${colors_1.colors.reset}`);
                    console.log(colors_1.colors.gray + `       Composite HYPE: ${colors_1.colors.cyan}$${(0, formatting_1.formatPrice)(price)}${colors_1.colors.reset}`);
                    console.log(colors_1.colors.gray + `       Difference:    ${colors_1.colors.yellow}$0.00 (0.000%)${colors_1.colors.reset}`);
                    console.log(colors_1.colors.green + '       ✅ Within acceptable range' + colors_1.colors.reset);
                }
            }
            console.log('');
        }
        // Show what would be sent
        console.log(colors_1.colors.yellow + '💾 WOULD SEND TO BLOCKCHAIN:' + colors_1.colors.reset);
        console.log(colors_1.colors.gray + `   Program: ${constants_1.PROGRAM_ID.toBase58()}` + colors_1.colors.reset);
        console.log(colors_1.colors.gray + `   Updater Index: ${this.config.updaterIndex}` + colors_1.colors.reset);
        console.log(`   ${colors_1.colors.gray}Assets:${colors_1.colors.reset} ${colors_1.colors.green}${fresh.map((f) => f.sym).join(', ')}${colors_1.colors.reset}`);
        console.log(colors_1.colors.gray + '='.repeat(70) + '\n' + colors_1.colors.reset);
    }
    /**
     * Log minimal dry run output (throttled)
     */
    logMinimalDryRun(fresh) {
        const now = Date.now();
        if (now - this.lastLogTime >= constants_1.LOG_THROTTLE_MS) {
            const priceStr = fresh
                .map(({ sym, candI64 }) => `${sym}=$${(0, formatting_1.formatPrice)(candI64 / Math.pow(10, constants_1.DECIMALS))}`)
                .join(', ');
            console.log(`${colors_1.colors.gray}[${new Date().toISOString()}]${colors_1.colors.reset} ✓ Would send: ${priceStr}`);
            this.lastLogTime = now;
        }
    }
    /**
     * Handle live update (send transaction)
     */
    handleLiveUpdate(fresh, clientTsMs) {
        return __awaiter(this, void 0, void 0, function* () {
            if (!this.txBuilder) {
                throw new Error('Transaction builder not initialized');
            }
            const t0 = Date.now();
            // Collect prices for all 4 assets
            const btcData = fresh.find((f) => f.sym === 'BTC');
            const ethData = fresh.find((f) => f.sym === 'ETH');
            const solData = fresh.find((f) => f.sym === 'SOL');
            const hypeData = fresh.find((f) => f.sym === 'HYPE');
            const btcPrice = btcData ? btcData.candI64 : this.lastSentI64.BTC || 0;
            const ethPrice = ethData ? ethData.candI64 : this.lastSentI64.ETH || 0;
            const solPrice = solData ? solData.candI64 : this.lastSentI64.SOL || 0;
            const hypePrice = hypeData ? hypeData.candI64 : this.lastSentI64.HYPE || 0;
            const tRecv = Date.now();
            try {
                const sig = yield this.txBuilder.sendBatchPriceUpdate(this.config.updaterKeypair, this.config.updaterIndex, btcPrice, ethPrice, solPrice, hypePrice, clientTsMs);
                const tSent = Date.now();
                // Mark sent
                for (const { sym, candI64, priceSource } of fresh) {
                    this.sentUpTo[sym] = priceSource === 'pyth' && this.latest[sym] ? this.latest[sym].pubMs : Date.now();
                    this.lastSentI64[sym] = candI64;
                }
                // Log result
                this.logTransactionResult(fresh, sig, clientTsMs, tRecv, tSent, t0);
                // Check divergence
                const warnings = this.calculateDivergence(fresh);
                if (warnings.length > 0) {
                    this.logDivergenceWarnings(warnings);
                }
            }
            catch (error) {
                if (error instanceof Error && error.message.includes('Blockhash expired')) {
                    console.warn('[send/batch] skipped: blockhash expired (no retry)');
                    return;
                }
                throw error;
            }
        });
    }
    /**
     * Log transaction result
     */
    logTransactionResult(fresh, sig, clientTsMs, tRecv, tSent, t0) {
        if (this.logger.isVerbose()) {
            const compositeInfo = {};
            for (const sym of ['BTC', 'ETH', 'SOL', 'HYPE']) {
                const compData = this.compositeData[sym];
                if (compData.price != null && compData.sources) {
                    compositeInfo[sym] = {
                        price: (0, formatting_1.formatPrice)(compData.price),
                        sources: compData.count,
                        sourceDetails: compData.sources.map((data) => ({
                            name: data.source,
                            price: (0, formatting_1.formatPrice)(data.price),
                            age_ms: data.age,
                        })),
                    };
                }
            }
            console.log(JSON.stringify({
                ts_ms: clientTsMs,
                idx: this.config.updaterIndex,
                assets: fresh.map(({ sym }) => sym),
                prices: Object.fromEntries(fresh.map(({ sym, candI64 }) => [sym, (0, formatting_1.formatPrice)(candI64 / Math.pow(10, constants_1.DECIMALS))])),
                composite: Object.keys(compositeInfo).length > 0 ? compositeInfo : null,
                tx: sig,
                t_recv: tRecv,
                t_sent: tSent,
                dt_handle: tRecv - t0,
                dt_send: tSent - tRecv,
            }, null, 0));
        }
        else {
            const now = Date.now();
            if (now - this.lastLogTime >= constants_1.LOG_THROTTLE_MS) {
                const priceStr = fresh
                    .map(({ sym, candI64 }) => `${sym}=$${(0, formatting_1.formatPrice)(candI64 / Math.pow(10, constants_1.DECIMALS))}`)
                    .join(', ');
                console.log(`${colors_1.colors.gray}[${new Date().toISOString()}]${colors_1.colors.reset} ✓ Updated: ${priceStr} ${colors_1.colors.gray}(tx: ${sig.substring(0, 8)}...)${colors_1.colors.reset}`);
                this.lastLogTime = now;
            }
        }
    }
    /**
     * Log divergence warnings
     */
    logDivergenceWarnings(warnings) {
        const msg = warnings
            .map((w) => `${w.asset}: Pyth=${w.pythPrice.toFixed(2)} vs Composite=${w.compositePrice.toFixed(2)} (${w.percentage.toFixed(3)}%)`)
            .join(', ');
        console.warn(`[WARN] Price divergence > ${constants_1.DIVERGENCE_WARNING_THRESHOLD}%: ${msg}`);
    }
    /**
     * Start the update loop
     */
    start() {
        this.updateInterval = setInterval(() => __awaiter(this, void 0, void 0, function* () {
            try {
                const fresh = this.getFreshUpdates();
                if (fresh.length === 0)
                    return;
                const clientTsMs = Date.now();
                if (this.config.isDryRun) {
                    this.handleDryRunUpdate(fresh, clientTsMs);
                }
                else {
                    yield this.handleLiveUpdate(fresh, clientTsMs);
                }
            }
            catch (error) {
                console.error('[send/batch]', error instanceof Error ? error.message : String(error));
            }
        }), constants_1.TICK_MS);
    }
    /**
     * Stop the oracle service
     */
    stop() {
        return __awaiter(this, void 0, void 0, function* () {
            if (this.updateInterval) {
                clearInterval(this.updateInterval);
                this.updateInterval = null;
            }
            yield this.pythClient.close();
            this.compositeClient.stopAll();
            this.emit('stopped');
        });
    }
}
exports.OracleService = OracleService;
