/**
 * Birdeye API Client (FREE tier for price data)
 * https://docs.birdeye.so
 */

import { EventEmitter } from 'events';
import { PublicKey } from '@solana/web3.js';

export interface BirdeyePriceResponse {
  data: {
    value: number;
    updateUnixTime: number;
    updateHumanTime: string;
  };
  success: boolean;
}

export interface BirdeyeMultiPriceResponse {
  data: Record<string, {
    value: number;
    updateUnixTime: number;
    updateHumanTime: string;
  }>;
  success: boolean;
}

export interface BirdeyePriceData {
  price: number;
  timestamp: number;
  updateTime: number;
}

/**
 * Birdeye API Client
 * FREE tier - No API key required for basic price data
 * Solana-specialized
 */
export class BirdeyeClient extends EventEmitter {
  private baseUrl = 'https://public-api.birdeye.so';
  private pollInterval: NodeJS.Timeout | null = null;
  private isPolling = false;

  constructor() {
    super();
  }

  /**
   * Get price for a single token
   */
  async getPrice(mint: PublicKey): Promise<number | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}/public/price?address=${mint.toString()}`,
        {
          headers: {
            'Accept': 'application/json',
          },
        }
      );

      if (!response.ok) {
        console.error('Birdeye API error:', response.statusText);
        return null;
      }

      const data: BirdeyePriceResponse = await response.json();

      if (!data.success || !data.data?.value) {
        return null;
      }

      return data.data.value;
    } catch (error) {
      console.error('Birdeye price fetch error:', error);
      return null;
    }
  }

  /**
   * Get detailed price data with timestamps
   */
  async getPriceData(mint: PublicKey): Promise<BirdeyePriceData | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}/public/price?address=${mint.toString()}`,
        {
          headers: {
            'Accept': 'application/json',
          },
        }
      );

      if (!response.ok) {
        console.error('Birdeye API error:', response.statusText);
        return null;
      }

      const data: BirdeyePriceResponse = await response.json();

      if (!data.success || !data.data?.value) {
        return null;
      }

      return {
        price: data.data.value,
        timestamp: Date.now(),
        updateTime: data.data.updateUnixTime * 1000, // Convert to ms
      };
    } catch (error) {
      console.error('Birdeye price data fetch error:', error);
      return null;
    }
  }

  /**
   * Get prices for multiple tokens (batch endpoint)
   * This is more efficient than individual requests
   */
  async getMultiplePrices(mints: PublicKey[]): Promise<Map<string, BirdeyePriceData>> {
    const prices = new Map<string, BirdeyePriceData>();

    if (mints.length === 0) {
      return prices;
    }

    try {
      const addresses = mints.map(m => m.toString()).join(',');
      const response = await fetch(
        `${this.baseUrl}/public/multi_price?list_address=${addresses}`,
        {
          headers: {
            'Accept': 'application/json',
          },
        }
      );

      if (!response.ok) {
        console.error('Birdeye batch API error:', response.statusText);
        return prices;
      }

      const data: BirdeyeMultiPriceResponse = await response.json();

      if (!data.success || !data.data) {
        return prices;
      }

      const timestamp = Date.now();

      for (const [mint, priceData] of Object.entries(data.data)) {
        if (priceData && priceData.value) {
          prices.set(mint, {
            price: priceData.value,
            timestamp,
            updateTime: priceData.updateUnixTime * 1000,
          });
        }
      }

      return prices;
    } catch (error) {
      console.error('Birdeye batch price fetch error:', error);
      return prices;
    }
  }

  /**
   * Start polling prices at a regular interval
   * @param mints - Array of token mint addresses to poll
   * @param intervalMs - Polling interval in milliseconds (default: 2000ms)
   */
  startPolling(mints: PublicKey[], intervalMs: number = 2000): void {
    if (this.isPolling) {
      console.warn('Birdeye client is already polling');
      return;
    }

    this.isPolling = true;

    // Immediate first fetch
    this.pollPrices(mints);

    // Then poll at interval
    this.pollInterval = setInterval(() => {
      this.pollPrices(mints);
    }, intervalMs);

    console.log(`Birdeye polling started for ${mints.length} tokens (${intervalMs}ms interval)`);
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
    console.log('Birdeye polling stopped');
  }

  /**
   * Internal: Poll prices and emit events
   */
  private async pollPrices(mints: PublicKey[]): Promise<void> {
    try {
      const prices = await this.getMultiplePrices(mints);

      for (const [mint, priceData] of prices) {
        this.emit('price', mint, priceData);
      }

      this.emit('batch_update', prices);
    } catch (error) {
      console.error('Birdeye polling error:', error);
      this.emit('error', error);
    }
  }

  /**
   * Check if client is currently polling
   */
  isActive(): boolean {
    return this.isPolling;
  }
}
