/**
 * Price Aggregator with multi-source aggregation and outlier detection
 */

import { PriceReading, AggregatedPrice, WeightedPrice, SourceTier } from './types';

export class PriceAggregator {
  /**
   * Aggregate prices from multiple sources with quality control
   */
  aggregate(readings: PriceReading[]): AggregatedPrice {
    if (readings.length === 0) {
      throw new Error('No price readings provided');
    }

    if (readings.length === 1) {
      return this.selectBestPrice(readings);
    }

    // Step 1: Remove outliers using IQR method
    const filtered = this.removeOutliers(readings);

    if (filtered.length < 2) {
      // Not enough sources after filtering, return best available
      return this.selectBestPrice(readings);
    }

    // Step 2: Calculate weighted median (more robust than mean)
    const weightedPrices = filtered.map(r => ({
      price: r.price,
      weight: this.calculateWeight(r),
    }));

    const medianPrice = this.weightedMedian(weightedPrices);

    // Step 3: Calculate confidence based on source agreement
    const confidence = this.calculateConfidence(filtered, medianPrice);

    // Step 4: Calculate maximum deviation
    const deviation = this.calculateMaxDeviation(filtered, medianPrice);

    return {
      price: medianPrice,
      confidence,
      sourceCount: filtered.length,
      sources: filtered.map(r => r.source),
      timestamp: Date.now(),
      deviation,
    };
  }

  /**
   * Remove outlier prices using Interquartile Range (IQR) method
   */
  private removeOutliers(readings: PriceReading[]): PriceReading[] {
    if (readings.length < 3) {
      return readings;
    }

    const prices = readings.map(r => r.price).sort((a, b) => a - b);
    const q1Index = Math.floor(prices.length * 0.25);
    const q3Index = Math.floor(prices.length * 0.75);

    const q1 = prices[q1Index]!;
    const q3 = prices[q3Index]!;
    const iqr = q3 - q1;

    const lowerBound = q1 - 1.5 * iqr;
    const upperBound = q3 + 1.5 * iqr;

    return readings.filter(r => r.price >= lowerBound && r.price <= upperBound);
  }

  /**
   * Calculate weight based on source tier, freshness, and confidence
   */
  private calculateWeight(reading: PriceReading): number {
    let weight = 1.0;

    // Tier-based weights
    switch (reading.tier) {
      case SourceTier.TIER_1_INSTITUTIONAL:
        weight *= 3.0;  // Pyth, CEX get 3x weight
        break;
      case SourceTier.TIER_2_DEX_AGGREGATOR:
        weight *= 2.0;  // Jupiter gets 2x weight
        break;
      case SourceTier.TIER_3_DEX_SCREENER:
        weight *= 1.5;  // DexScreener, Birdeye get 1.5x
        break;
      case SourceTier.TIER_4_FALLBACK:
        weight *= 1.0;  // CoinGecko baseline
        break;
    }

    // Freshness decay (older prices get less weight)
    const ageSeconds = (Date.now() - reading.timestamp) / 1000;
    if (ageSeconds > 60) {
      weight *= Math.exp(-ageSeconds / 120); // Exponential decay after 60s
    }

    // Confidence multiplier
    weight *= reading.confidence;

    return weight;
  }

  /**
   * Calculate weighted median
   * More robust than weighted mean against outliers
   */
  private weightedMedian(data: WeightedPrice[]): number {
    if (data.length === 0) {
      throw new Error('No data for weighted median');
    }

    if (data.length === 1) {
      return data[0]!.price;
    }

    // Sort by price
    const sorted = [...data].sort((a, b) => a.price - b.price);

    // Calculate total weight
    const totalWeight = sorted.reduce((sum, d) => sum + d.weight, 0);
    const halfWeight = totalWeight / 2;

    // Find weighted median
    let cumulativeWeight = 0;
    for (const item of sorted) {
      cumulativeWeight += item.weight;
      if (cumulativeWeight >= halfWeight) {
        return item.price;
      }
    }

    return sorted[sorted.length - 1]!.price;
  }

  /**
   * Calculate confidence score based on source agreement
   * Higher agreement = higher confidence
   */
  private calculateConfidence(
    readings: PriceReading[],
    aggregatedPrice: number
  ): number {
    if (readings.length === 1) {
      return 0.5; // Single source = medium confidence
    }

    // Calculate coefficient of variation
    const deviations = readings.map(r =>
      Math.abs(r.price - aggregatedPrice) / aggregatedPrice
    );

    const avgDeviation = deviations.reduce((a, b) => a + b, 0) / deviations.length;

    // High agreement = high confidence
    // 1% avg deviation = 0.99 confidence
    // 5% avg deviation = 0.95 confidence
    // 10% avg deviation = 0.90 confidence
    const confidence = Math.max(0, Math.min(1, 1 - avgDeviation));

    // Boost confidence for more sources
    const sourceBonus = Math.min(0.1, readings.length * 0.02);

    return Math.min(1, confidence + sourceBonus);
  }

  /**
   * Calculate maximum deviation from median
   */
  private calculateMaxDeviation(
    readings: PriceReading[],
    medianPrice: number
  ): number {
    const deviations = readings.map(r =>
      Math.abs(r.price - medianPrice) / medianPrice
    );

    return Math.max(...deviations);
  }

  /**
   * Fallback: select best single price when aggregation not possible
   */
  private selectBestPrice(readings: PriceReading[]): AggregatedPrice {
    // Sort by tier (lower tier = higher priority), then by confidence
    const best = readings.sort((a, b) => {
      if (a.tier !== b.tier) {
        return a.tier - b.tier;
      }
      return b.confidence - a.confidence;
    })[0]!;

    return {
      price: best.price,
      confidence: Math.min(0.6, best.confidence), // Lower confidence for single source
      sourceCount: 1,
      sources: [best.source],
      timestamp: best.timestamp,
      deviation: 0,
    };
  }

  /**
   * Count outlier prices (for monitoring)
   */
  countOutliers(readings: PriceReading[], medianPrice: number, threshold: number = 0.05): number {
    return readings.filter(r =>
      Math.abs(r.price - medianPrice) / medianPrice > threshold
    ).length;
  }
}
