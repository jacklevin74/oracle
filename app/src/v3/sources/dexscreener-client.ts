/**
 * DexScreener API Client (100% FREE)
 * https://docs.dexscreener.com/api/reference
 */

import { EventEmitter } from 'events';
import { PublicKey } from '@solana/web3.js';

export interface DexScreenerPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceNative: string;
  priceUsd: string;
  txns: {
    h24: {
      buys: number;
      sells: number;
    };
  };
  volume: {
    h24: number;
  };
  priceChange: {
    h24: number;
  };
  liquidity: {
    usd: number;
    base: number;
    quote: number;
  };
  fdv: number;
  pairCreatedAt: number;
}

export interface DexScreenerResponse {
  schemaVersion: string;
  pairs: DexScreenerPair[];
}

export interface DexScreenerPriceData {
  price: number;
  timestamp: number;
  liquidity: number;
  volume24h: number;
  pairAddress: string;
}

/**
 * DexScreener API Client
 * FREE - No API key required
 * Rate limit: Unlimited (but please be reasonable)
 */
export class DexScreenerClient extends EventEmitter {
  private baseUrl = 'https://api.dexscreener.com/latest/dex';
  private pollInterval: NodeJS.Timeout | null = null;
  private isPolling = false;
  private rateLimitDelay = 100; // ms between requests to be respectful

  constructor() {
    super();
  }

  /**
   * Get token price from DexScreener
   * Returns the most liquid pair
   */
  async getTokenPrice(mint: PublicKey): Promise<number | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}/tokens/${mint.toString()}`
      );

      if (!response.ok) {
        console.error('DexScreener API error:', response.statusText);
        return null;
      }

      const data = await response.json() as DexScreenerResponse;

      if (!data.pairs || data.pairs.length === 0) {
        return null;
      }

      // Sort by liquidity (highest first)
      const bestPair = data.pairs.sort((a, b) =>
        (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
      )[0];

      if (!bestPair) {
        return null;
      }

      const price = parseFloat(bestPair.priceUsd);
      return isFinite(price) ? price : null;
    } catch (error) {
      console.error('DexScreener price fetch error:', error);
      return null;
    }
  }

  /**
   * Get detailed price data including liquidity and volume
   */
  async getTokenData(mint: PublicKey): Promise<DexScreenerPriceData | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}/tokens/${mint.toString()}`
      );

      if (!response.ok) {
        console.error('DexScreener API error:', response.statusText);
        return null;
      }

      const data = await response.json() as DexScreenerResponse;

      if (!data.pairs || data.pairs.length === 0) {
        return null;
      }

      // Sort by liquidity (highest first)
      const bestPair = data.pairs.sort((a, b) =>
        (b.liquidity?.usd || 0) - (a.liquidity?.usd || 0)
      )[0];

      if (!bestPair) {
        return null;
      }

      const price = parseFloat(bestPair.priceUsd);
      if (!isFinite(price)) {
        return null;
      }

      return {
        price,
        timestamp: Date.now(),
        liquidity: bestPair.liquidity?.usd || 0,
        volume24h: bestPair.volume?.h24 || 0,
        pairAddress: bestPair.pairAddress,
      };
    } catch (error) {
      console.error('DexScreener data fetch error:', error);
      return null;
    }
  }

  /**
   * Get prices for multiple tokens (with rate limiting)
   * Note: DexScreener doesn't have a batch endpoint, so we rate limit individual requests
   */
  async getMultipleTokens(mints: PublicKey[]): Promise<Map<string, DexScreenerPriceData>> {
    const prices = new Map<string, DexScreenerPriceData>();

    if (mints.length === 0) {
      return prices;
    }

    for (const mint of mints) {
      try {
        const data = await this.getTokenData(mint);
        if (data) {
          prices.set(mint.toString(), data);
        }

        // Rate limiting to be respectful
        if (mints.length > 1) {
          await this.delay(this.rateLimitDelay);
        }
      } catch (error) {
        console.error(`DexScreener error for ${mint.toString()}:`, error);
      }
    }

    return prices;
  }

  /**
   * Start polling prices at a regular interval
   * @param mints - Array of token mint addresses to poll
   * @param intervalMs - Polling interval in milliseconds (default: 5000ms)
   */
  startPolling(mints: PublicKey[], intervalMs: number = 5000): void {
    if (this.isPolling) {
      console.warn('DexScreener client is already polling');
      return;
    }

    // Validate reasonable polling interval (min 5 seconds to avoid rate limits)
    if (intervalMs < 5000) {
      console.warn('DexScreener polling interval too short, using 5000ms');
      intervalMs = 5000;
    }

    this.isPolling = true;

    // Immediate first fetch
    this.pollPrices(mints);

    // Then poll at interval
    this.pollInterval = setInterval(() => {
      this.pollPrices(mints);
    }, intervalMs);

    console.log(`DexScreener polling started for ${mints.length} tokens (${intervalMs}ms interval)`);
  }

  /**
   * Stop polling
   */
  stopPolling(): void {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.isPolling = false;
    console.log('DexScreener polling stopped');
  }

  /**
   * Internal: Poll prices and emit events
   */
  private async pollPrices(mints: PublicKey[]): Promise<void> {
    try {
      const prices = await this.getMultipleTokens(mints);

      for (const [mint, priceData] of prices) {
        this.emit('price', mint, priceData);
      }

      this.emit('batch_update', prices);
    } catch (error) {
      console.error('DexScreener polling error:', error);
      this.emit('error', error);
    }
  }

  /**
   * Delay helper for rate limiting
   */
  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check if client is currently polling
   */
  isActive(): boolean {
    return this.isPolling;
  }

  /**
   * Set rate limit delay between requests (in milliseconds)
   */
  setRateLimitDelay(ms: number): void {
    this.rateLimitDelay = Math.max(50, ms);
  }
}
