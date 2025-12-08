/**
 * Price Relay Process
 *
 * Collects prices from Pyth and Composite Oracle
 * Sends price updates to controller via Unix socket
 * No private keys - just data collection
 */

import { EventEmitter } from 'events';
import { PythClient } from '../oracles/pyth-client';
import { CompositeClient, COMPOSITE_CONFIGS } from '../oracles/composite-client';
import { AssetSymbol } from '../types';

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
  fartcoin: number | null;
}

export interface RelayMessage {
  type: 'heartbeat' | 'price_update';
  timestamp: number;
  data?: PriceData;
}

/**
 * Price relay service - collects prices and emits updates
 */
export class PriceRelay extends EventEmitter {
  private pythClient: PythClient;
  private compositeClient: CompositeClient;

  private latest: {
    BTC: { price: number; pubMs: number } | null;
    ETH: { price: number; pubMs: number } | null;
    SOL: { price: number; pubMs: number } | null;
    HYPE: { price: number; pubMs: number } | null;
    ZEC: { price: number; pubMs: number } | null;
    TSLA: { price: number; pubMs: number } | null;
    NVDA: { price: number; pubMs: number } | null;
    MSTR: { price: number; pubMs: number } | null;
    GOLD: { price: number; pubMs: number } | null;
    SILVER: { price: number; pubMs: number } | null;
    FARTCOIN: { price: number; pubMs: number } | null;
  };

  private compositeData: {
    BTC: { price: number | null; count: number };
    ETH: { price: number | null; count: number };
    SOL: { price: number | null; count: number };
    HYPE: { price: number | null; count: number };
    ZEC: { price: number | null; count: number };
    TSLA: { price: number | null; count: number };
    NVDA: { price: number | null; count: number };
    MSTR: { price: number | null; count: number };
    GOLD: { price: number | null; count: number };
    SILVER: { price: number | null; count: number };
    FARTCOIN: { price: number | null; count: number };
  };

  private heartbeatInterval: NodeJS.Timeout | null = null;
  private running: boolean = false;

  constructor() {
    super();

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
      FARTCOIN: null,
    };

    this.compositeData = {
      BTC: { price: null, count: 0 },
      ETH: { price: null, count: 0 },
      SOL: { price: null, count: 0 },
      HYPE: { price: null, count: 0 },
      ZEC: { price: null, count: 0 },
      TSLA: { price: null, count: 0 },
      NVDA: { price: null, count: 0 },
      MSTR: { price: null, count: 0 },
      GOLD: { price: null, count: 0 },
      SILVER: { price: null, count: 0 },
      FARTCOIN: { price: null, count: 0 },
    };

    this.pythClient = new PythClient();
    this.compositeClient = new CompositeClient();

    this.setupPythHandlers();
    this.setupCompositeHandlers();
  }

  /**
   * Setup Pyth price handlers
   */
  private setupPythHandlers() {
    this.pythClient.on('price', (symbol: AssetSymbol, priceData) => {
      this.latest[symbol] = priceData;
      this.checkAndEmitUpdate();
    });
  }

  /**
   * Setup composite oracle handlers
   */
  private setupCompositeHandlers() {
    this.compositeClient.on('price', (symbol: AssetSymbol, data) => {
      this.compositeData[symbol] = {
        price: data.composite,
        count: data.count,
      };

      // HYPE, ZEC, and FARTCOIN use composite only
      if (symbol === 'HYPE' || symbol === 'ZEC' || symbol === 'FARTCOIN') {
        if (data.composite !== null) {
          this.latest[symbol] = {
            price: data.composite,
            pubMs: Date.now(),
          };
          this.checkAndEmitUpdate();
        }
      }
    });
  }

  /**
   * Check if we have fresh updates and emit price_update event
   */
  private checkAndEmitUpdate() {
    // Only emit if we have at least some prices
    const hasPrices = Object.values(this.latest).some(p => p !== null);
    if (!hasPrices) return;

    const priceData: PriceData = {
      btc: this.latest.BTC?.price || null,
      eth: this.latest.ETH?.price || null,
      sol: this.latest.SOL?.price || null,
      hype: this.latest.HYPE?.price || null,
      zec: this.latest.ZEC?.price || null,
      tsla: this.latest.TSLA?.price || null,
      nvda: this.latest.NVDA?.price || null,
      mstr: this.latest.MSTR?.price || null,
      gold: this.latest.GOLD?.price || null,
      silver: this.latest.SILVER?.price || null,
      fartcoin: this.latest.FARTCOIN?.price || null,
    };

    const message: RelayMessage = {
      type: 'price_update',
      timestamp: Date.now(),
      data: priceData,
    };

    this.emit('message', message);
  }

  /**
   * Initialize and start the relay
   */
  async start() {
    if (this.running) {
      throw new Error('Relay already running');
    }

    console.log('[Relay] Starting price streams...');

    // Start Pyth feeds
    await this.pythClient.subscribe();
    console.log('[Relay] ✓ Connected to Pyth Network (BTC, ETH, SOL, ZEC, TSLA, NVDA, MSTR)');

    // Start composite oracles
    for (const symbol of Object.keys(COMPOSITE_CONFIGS) as Array<keyof typeof COMPOSITE_CONFIGS>) {
      this.compositeClient.startOracle(symbol, COMPOSITE_CONFIGS[symbol]);
    }
    console.log('[Relay] ✓ Connected to Composite Oracle (BTC, ETH, SOL, HYPE, ZEC)');

    // Start heartbeat (every 5 seconds)
    this.heartbeatInterval = setInterval(() => {
      const message: RelayMessage = {
        type: 'heartbeat',
        timestamp: Date.now(),
      };
      this.emit('message', message);
    }, 5000);

    this.running = true;
    console.log('[Relay] Running and ready to stream prices');
  }

  /**
   * Stop the relay
   */
  async stop() {
    if (!this.running) return;

    console.log('[Relay] Shutting down...');

    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }

    await this.pythClient.close();
    this.compositeClient.stopAll();

    this.running = false;
    console.log('[Relay] Stopped');
  }

  /**
   * Get current price data
   */
  getCurrentPrices(): PriceData {
    return {
      btc: this.latest.BTC?.price || null,
      eth: this.latest.ETH?.price || null,
      sol: this.latest.SOL?.price || null,
      hype: this.latest.HYPE?.price || null,
      zec: this.latest.ZEC?.price || null,
      tsla: this.latest.TSLA?.price || null,
      nvda: this.latest.NVDA?.price || null,
      mstr: this.latest.MSTR?.price || null,
      gold: this.latest.GOLD?.price || null,
      silver: this.latest.SILVER?.price || null,
      fartcoin: this.latest.FARTCOIN?.price || null,
    };
  }

  /**
   * Get composite data for diagnostics
   */
  getCompositeData() {
    return { ...this.compositeData };
  }
}
