/**
 * Jupiter Price API Client (100% FREE)
 * https://station.jup.ag/docs/apis/price-api
 */

import { EventEmitter } from 'events';
import { PublicKey } from '@solana/web3.js';

export interface JupiterPriceResponse {
  data: Record<string, {
    id: string;
    mintSymbol: string;
    vsToken: string;
    vsTokenSymbol: string;
    price: number;
  }>;
  timeTaken: number;
}

export interface JupiterPriceData {
  price: number;
  timestamp: number;
  vsToken: string;
}

/**
 * Jupiter Price API Client
 * FREE - No API key required
 * Rate limit: 999 req/s on QuickNode free tier
 */
export class JupiterPriceClient extends EventEmitter {
  private baseUrl = 'https://price.jup.ag/v4';
  private pollInterval: NodeJS.Timeout | null = null;
  private isPolling = false;

  constructor() {
    super();
  }

  /**
   * Get price for a single token
   * @param mint - Token mint address
   * @param vsToken - Quote token (defaults to USDC)
   */
  async getPrice(
    mint: PublicKey,
    vsToken: string = 'USDC'
  ): Promise<number | null> {
    try {
      const response = await fetch(
        `${this.baseUrl}/price?ids=${mint.toString()}&vsToken=${vsToken}`
      );

      if (!response.ok) {
        console.error('Jupiter API error:', response.statusText);
        return null;
      }

      const data = await response.json() as JupiterPriceResponse;
      const priceData = data.data[mint.toString()];

      return priceData?.price || null;
    } catch (error) {
      console.error('Jupiter price fetch error:', error);
      return null;
    }
  }

  /**
   * Get prices for multiple tokens in one call (batch)
   * @param mints - Array of token mint addresses
   * @param vsToken - Quote token (defaults to USDC)
   */
  async getPrices(
    mints: PublicKey[],
    vsToken: string = 'USDC'
  ): Promise<Map<string, JupiterPriceData>> {
    const prices = new Map<string, JupiterPriceData>();

    if (mints.length === 0) {
      return prices;
    }

    try {
      const ids = mints.map(m => m.toString()).join(',');
      const response = await fetch(
        `${this.baseUrl}/price?ids=${ids}&vsToken=${vsToken}`
      );

      if (!response.ok) {
        console.error('Jupiter API batch error:', response.statusText);
        return prices;
      }

      const data = await response.json() as JupiterPriceResponse;
      const timestamp = Date.now();

      for (const [mint, priceData] of Object.entries(data.data)) {
        if (priceData && priceData.price) {
          prices.set(mint, {
            price: priceData.price,
            timestamp,
            vsToken: priceData.vsTokenSymbol,
          });
        }
      }

      return prices;
    } catch (error) {
      console.error('Jupiter batch price fetch error:', error);
      return prices;
    }
  }

  /**
   * Start polling prices at a regular interval
   * @param mints - Array of token mint addresses to poll
   * @param intervalMs - Polling interval in milliseconds (default: 1000ms)
   * @param vsToken - Quote token (defaults to USDC)
   */
  startPolling(
    mints: PublicKey[],
    intervalMs: number = 1000,
    vsToken: string = 'USDC'
  ): void {
    if (this.isPolling) {
      console.warn('Jupiter client is already polling');
      return;
    }

    this.isPolling = true;

    // Immediate first fetch
    this.pollPrices(mints, vsToken);

    // Then poll at interval
    this.pollInterval = setInterval(() => {
      this.pollPrices(mints, vsToken);
    }, intervalMs);

    console.log(`Jupiter polling started for ${mints.length} tokens (${intervalMs}ms interval)`);
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
    console.log('Jupiter polling stopped');
  }

  /**
   * Internal: Poll prices and emit events
   */
  private async pollPrices(mints: PublicKey[], vsToken: string): Promise<void> {
    try {
      const prices = await this.getPrices(mints, vsToken);

      for (const [mint, priceData] of prices) {
        this.emit('price', mint, priceData);
      }

      this.emit('batch_update', prices);
    } catch (error) {
      console.error('Jupiter polling error:', error);
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
