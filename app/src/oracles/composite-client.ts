/**
 * Composite oracle client wrapper
 */

import { EventEmitter } from 'events';
import { AssetSymbol, CompositeData } from '../types';
import { CompositeOracle } from './composite-oracle';

/**
 * Configuration for composite oracle
 */
export interface CompositeOracleConfig {
  pairKraken?: string;
  productCB?: string;
  symbolKucoin?: string;
  symbolBinance?: string;
  symbolMexc?: string;
  symbolBybit?: string;
  coinHyperliquid?: string;
}

/**
 * Composite oracle client for aggregated price feeds
 */
export class CompositeClient extends EventEmitter {
  private oracles: Map<AssetSymbol, CompositeOracle>;

  constructor() {
    super();
    this.oracles = new Map();
  }

  /**
   * Start composite oracle for a specific asset
   */
  startOracle(symbol: AssetSymbol, config: CompositeOracleConfig): void {
    if (this.oracles.has(symbol)) {
      return; // Already started
    }

    const oracle = new CompositeOracle({
      silent: true,
      ...config,
    });

    oracle.on('price', (result: CompositeData) => {
      this.emit('price', symbol, result);
    });

    oracle.start();
    this.oracles.set(symbol, oracle);
  }

  /**
   * Stop composite oracle for a specific asset
   */
  stopOracle(symbol: AssetSymbol): void {
    const oracle = this.oracles.get(symbol);
    if (oracle) {
      oracle.stop();
      this.oracles.delete(symbol);
    }
  }

  /**
   * Stop all composite oracles
   */
  stopAll(): void {
    for (const oracle of this.oracles.values()) {
      oracle.stop();
    }
    this.oracles.clear();
  }

  /**
   * Check if oracle is running for a symbol
   */
  isRunning(symbol: AssetSymbol): boolean {
    return this.oracles.has(symbol);
  }

  /**
   * Get all running symbols
   */
  getRunningSymbols(): AssetSymbol[] {
    return Array.from(this.oracles.keys());
  }
}

/**
 * Create composite oracle configurations for standard assets
 */
export const COMPOSITE_CONFIGS: Record<AssetSymbol, CompositeOracleConfig> = {
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
  ZEC: {
    productCB: 'ZEC-USD',
    symbolKucoin: 'ZEC-USDT',
    symbolBinance: 'zecusdt',
    symbolMexc: 'ZECUSDT',
    coinHyperliquid: 'ZEC',
  },
  // Stock assets - not available on crypto exchanges, only use Pyth feeds
  TSLA: {},
  NVDA: {},
  MSTR: {},
  GOLD: {},
  SILVER: {},
  FARTCOIN: {
    pairKraken: 'FARTCOIN/USD',
    productCB: 'FARTCOIN-USD',
    symbolKucoin: 'FARTCOIN-USDT',
    symbolBinance: 'fartcoinusdt',
    symbolMexc: 'FARTCOINUSDT',
    symbolBybit: 'FARTCOINUSDT',
  },
};
