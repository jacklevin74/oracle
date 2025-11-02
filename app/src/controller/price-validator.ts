/**
 * Price Validator
 *
 * Validates prices before signing to prevent obviously bad data
 * Uses simple heuristics - not responsible for outlier detection
 * (that happens off-chain by consumers comparing multiple oracle nodes)
 */

export interface PriceValidationConfig {
  minPrice: number;
  maxPrice: number;
  maxPercentChange: number; // e.g., 0.10 = 10%
  minUpdateIntervalMs: number;
}

const VALIDATION_CONFIGS: Record<string, PriceValidationConfig> = {
  BTC: {
    minPrice: 10_000,
    maxPrice: 200_000,
    maxPercentChange: 0.15, // 15% max change
    minUpdateIntervalMs: 300,
  },
  ETH: {
    minPrice: 500,
    maxPrice: 10_000,
    maxPercentChange: 0.15,
    minUpdateIntervalMs: 300,
  },
  SOL: {
    minPrice: 10,
    maxPrice: 1000,
    maxPercentChange: 0.20,
    minUpdateIntervalMs: 300,
  },
  HYPE: {
    minPrice: 1,
    maxPrice: 100,
    maxPercentChange: 0.25,
    minUpdateIntervalMs: 300,
  },
  ZEC: {
    minPrice: 10,
    maxPrice: 500,
    maxPercentChange: 0.20,
    minUpdateIntervalMs: 300,
  },
};

export class PriceValidator {
  private lastPrices: Record<string, number | null> = {
    BTC: null,
    ETH: null,
    SOL: null,
    HYPE: null,
    ZEC: null,
  };

  private lastUpdateTimes: Record<string, number> = {
    BTC: 0,
    ETH: 0,
    SOL: 0,
    HYPE: 0,
    ZEC: 0,
  };

  /**
   * Validate a price before signing
   */
  validate(asset: string, price: number): { valid: boolean; reason?: string } {
    const config = VALIDATION_CONFIGS[asset];
    if (!config) {
      return { valid: false, reason: `Unknown asset: ${asset}` };
    }

    // 1. Check bounds
    if (price < config.minPrice) {
      return { valid: false, reason: `Price ${price} below minimum ${config.minPrice}` };
    }
    if (price > config.maxPrice) {
      return { valid: false, reason: `Price ${price} above maximum ${config.maxPrice}` };
    }

    // 2. Check rate limiting
    const now = Date.now();
    const lastUpdate = this.lastUpdateTimes[asset] || 0;
    if (lastUpdate > 0 && now - lastUpdate < config.minUpdateIntervalMs) {
      return {
        valid: false,
        reason: `Update too soon (${now - lastUpdate}ms < ${config.minUpdateIntervalMs}ms)`,
      };
    }

    // 3. Check percent change from last price
    const lastPrice = this.lastPrices[asset] || null;
    if (lastPrice !== null && lastPrice > 0) {
      const percentChange = Math.abs(price - lastPrice) / lastPrice;
      if (percentChange > config.maxPercentChange) {
        return {
          valid: false,
          reason: `Price change ${(percentChange * 100).toFixed(2)}% exceeds max ${(config.maxPercentChange * 100).toFixed(2)}%`,
        };
      }
    }

    return { valid: true };
  }

  /**
   * Record a validated price
   */
  recordPrice(asset: string, price: number) {
    this.lastPrices[asset] = price;
    this.lastUpdateTimes[asset] = Date.now();
  }

  /**
   * Reset validation state for an asset
   */
  reset(asset: string) {
    this.lastPrices[asset] = null;
    this.lastUpdateTimes[asset] = 0;
  }

  /**
   * Reset all validation state
   */
  resetAll() {
    Object.keys(this.lastPrices).forEach(asset => this.reset(asset));
  }

  /**
   * Get last recorded price for an asset
   */
  getLastPrice(asset: string): number | null {
    return this.lastPrices[asset] || null;
  }
}
