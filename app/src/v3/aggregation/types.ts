/**
 * Types for price aggregation
 */

export enum SourceTier {
  TIER_1_INSTITUTIONAL = 1,  // Pyth, CEX composite
  TIER_2_DEX_AGGREGATOR = 2, // Jupiter
  TIER_3_DEX_SCREENER = 3,   // DexScreener, Birdeye
  TIER_4_FALLBACK = 4,       // CoinGecko, etc.
}

export interface PriceReading {
  source: string;
  tier: SourceTier;
  price: number;
  timestamp: number;
  confidence: number; // 0-1 score
}

export interface AggregatedPrice {
  price: number;
  confidence: number;
  sourceCount: number;
  sources: string[];
  timestamp: number;
  deviation?: number; // Maximum deviation from median
}

export interface WeightedPrice {
  price: number;
  weight: number;
}
