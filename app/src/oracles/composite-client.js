"use strict";
/**
 * Composite oracle client wrapper
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.COMPOSITE_CONFIGS = exports.CompositeClient = void 0;
const events_1 = require("events");
const composite_oracle_1 = require("./composite-oracle");
/**
 * Composite oracle client for aggregated price feeds
 */
class CompositeClient extends events_1.EventEmitter {
    constructor() {
        super();
        this.oracles = new Map();
    }
    /**
     * Start composite oracle for a specific asset
     */
    startOracle(symbol, config) {
        if (this.oracles.has(symbol)) {
            return; // Already started
        }
        const oracle = new composite_oracle_1.CompositeOracle(Object.assign({ silent: true }, config));
        oracle.on('price', (result) => {
            this.emit('price', symbol, result);
        });
        oracle.start();
        this.oracles.set(symbol, oracle);
    }
    /**
     * Stop composite oracle for a specific asset
     */
    stopOracle(symbol) {
        const oracle = this.oracles.get(symbol);
        if (oracle) {
            oracle.stop();
            this.oracles.delete(symbol);
        }
    }
    /**
     * Stop all composite oracles
     */
    stopAll() {
        for (const oracle of this.oracles.values()) {
            oracle.stop();
        }
        this.oracles.clear();
    }
    /**
     * Check if oracle is running for a symbol
     */
    isRunning(symbol) {
        return this.oracles.has(symbol);
    }
    /**
     * Get all running symbols
     */
    getRunningSymbols() {
        return Array.from(this.oracles.keys());
    }
}
exports.CompositeClient = CompositeClient;
/**
 * Create composite oracle configurations for standard assets
 */
exports.COMPOSITE_CONFIGS = {
    BTC: {
        pairKraken: 'BTC/USD',
        productCB: 'BTC-USD',
        symbolKucoin: 'BTC-USDT',
        symbolBinance: 'btcusdt',
        symbolMexc: 'BTCUSDT',
        symbolBybit: 'BTCUSDT',
    },
    ETH: {
        pairKraken: 'ETH/USD',
        productCB: 'ETH-USD',
        symbolKucoin: 'ETH-USDT',
        symbolBinance: 'ethusdt',
        symbolMexc: 'ETHUSDT',
        symbolBybit: 'ETHUSDT',
    },
    SOL: {
        pairKraken: 'SOL/USD',
        productCB: 'SOL-USD',
        symbolKucoin: 'SOL-USDT',
        symbolBinance: 'solusdt',
        symbolMexc: 'SOLUSDT',
        symbolBybit: 'SOLUSDT',
    },
    HYPE: {
        pairKraken: 'HYPE/USD',
        productCB: 'HYPE-USD',
        symbolKucoin: 'HYPE-USDT',
        symbolBinance: 'hypeusdt',
        symbolMexc: 'HYPEUSDT',
        symbolBybit: 'HYPEUSDT',
        coinHyperliquid: 'HYPE',
    },
};
