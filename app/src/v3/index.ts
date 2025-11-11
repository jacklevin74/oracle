/**
 * Oracle V3 - Multi-Source Price Oracle with Dynamic Asset Support
 *
 * This module provides a comprehensive multi-source price oracle that:
 * - Supports unlimited Solana/SVM tokens via Per-Asset PDA architecture
 * - Aggregates prices from multiple FREE sources (Jupiter, DexScreener, Birdeye, Pyth, CEX)
 * - Provides quality control with outlier detection and confidence scoring
 * - Enables dynamic asset management via configuration files
 * - Maintains 100% free operation with no API costs
 */

export * from './sources';
export * from './aggregation';
export * from './quality';
export * from './registry';
