/**
 * Pyth Network price feed client
 */

import { PriceServiceConnection } from '@pythnetwork/price-service-client';
import { EventEmitter } from 'events';
import { AssetSymbol, PriceData } from '../types';
import { PYTH_HERMES_URL, PYTH_FEEDS } from '../config/constants';

/**
 * Normalize feed ID (remove 0x prefix and convert to lowercase)
 */
function normalizeFeedId(id: string): string {
  return (id || '').toLowerCase().replace(/^0x/, '');
}

/**
 * Scale Pyth price to human-readable format
 */
function scalePythPrice(price: { price: bigint | string; expo: number }): number | null {
  if (!price || price.price === undefined || price.expo === undefined) {
    return null;
  }

  const n = typeof price.price === 'bigint' ? Number(price.price.toString()) : Number(price.price);
  if (!Number.isFinite(n)) {
    return null;
  }

  return n * Math.pow(10, price.expo);
}

/**
 * Pyth client for streaming price feeds
 */
export class PythClient extends EventEmitter {
  private priceService: PriceServiceConnection;
  private idBySymbol: Map<AssetSymbol, string>;
  private symbolById: Map<string, AssetSymbol>;
  private priceIds: string[];
  private isSubscribed: boolean = false;

  constructor() {
    super();
    this.priceService = new PriceServiceConnection(PYTH_HERMES_URL, {
      priceFeedRequestConfig: { binary: true },
    });

    // Build feed ID mappings
    this.idBySymbol = new Map<AssetSymbol, string>();
    this.symbolById = new Map<string, AssetSymbol>();

    for (const [sym, id] of Object.entries(PYTH_FEEDS)) {
      const normalizedId = normalizeFeedId(id);
      this.idBySymbol.set(sym as AssetSymbol, normalizedId);
      this.symbolById.set(normalizedId, sym as AssetSymbol);
    }

    this.priceIds = Array.from(this.idBySymbol.values());
  }

  /**
   * Get feed ID for a symbol
   */
  getFeedId(symbol: AssetSymbol): string | undefined {
    return this.idBySymbol.get(symbol);
  }

  /**
   * Get symbol for a feed ID
   */
  getSymbol(feedId: string): AssetSymbol | undefined {
    return this.symbolById.get(normalizeFeedId(feedId));
  }

  /**
   * Subscribe to price feed updates
   */
  async subscribe(): Promise<void> {
    if (this.isSubscribed) {
      return;
    }

    await this.priceService.subscribePriceFeedUpdates(this.priceIds, (priceFeed) => {
      try {
        const p = priceFeed.getPriceNoOlderThan(120);

        if (!p) {
          return;
        }

        const val = scalePythPrice(p);

        if (val === null || !Number.isFinite(val)) {
          return;
        }

        const id = normalizeFeedId(priceFeed.id);
        const sym = this.symbolById.get(id);

        if (!sym) {
          return;
        }

        const pubMs = p.publishTime ? Number(p.publishTime) * 1000 : Date.now();

        const priceData: PriceData = { price: val, pubMs };
        this.emit('price', sym, priceData);
      } catch (error) {
        // Ignore stale price errors
      }
    });

    this.isSubscribed = true;
  }

  /**
   * Close the price service connection
   */
  async close(): Promise<void> {
    if (this.isSubscribed) {
      await this.priceService.closeWebSocket();
      this.isSubscribed = false;
    }
  }

  /**
   * Get available symbols
   */
  getAvailableSymbols(): AssetSymbol[] {
    return Array.from(this.idBySymbol.keys());
  }
}
