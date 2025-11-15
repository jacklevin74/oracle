/**
 * Quality Controller - Monitors price quality and emits alerts
 */

import { EventEmitter } from 'events';
import { PublicKey } from '@solana/web3.js';
import { PriceReading, AggregatedPrice } from '../aggregation/types';

export interface QualityMetrics {
  asset: string;
  timestamp: number;
  priceDeviation: number;     // % deviation from median
  sourceCount: number;
  confidence: number;
  outlierCount: number;
  staleSources: string[];     // Sources with old data
  failedSources: string[];    // Sources that failed
}

export interface QualityAlert {
  type: 'high_deviation' | 'low_sources' | 'low_confidence' | 'high_outliers' | 'stale_data';
  asset: string;
  severity: 'warning' | 'error' | 'critical';
  message: string;
  data: any;
  timestamp: number;
}

export interface QualityConfig {
  maxDeviation: number;         // Max acceptable price deviation (default: 0.10 = 10%)
  minSources: number;           // Min required sources (default: 2)
  minConfidence: number;        // Min acceptable confidence (default: 0.70)
  maxOutlierRatio: number;      // Max ratio of outliers (default: 0.30)
  staleThresholdMs: number;     // Data age threshold (default: 60000ms)
  metricsHistorySize: number;   // How many metrics to keep (default: 1000)
}

export class QualityController extends EventEmitter {
  private metrics: Map<string, QualityMetrics[]>;
  private config: QualityConfig;
  private failedSources: Map<string, Set<string>>; // asset -> failed sources

  constructor(config?: Partial<QualityConfig>) {
    super();

    this.metrics = new Map();
    this.failedSources = new Map();

    // Default configuration
    this.config = {
      maxDeviation: 0.10,
      minSources: 2,
      minConfidence: 0.70,
      maxOutlierRatio: 0.30,
      staleThresholdMs: 60_000,
      metricsHistorySize: 1000,
      ...config,
    };
  }

  /**
   * Monitor price quality and emit alerts if needed
   */
  async monitorPrice(
    mint: PublicKey,
    readings: PriceReading[],
    aggregated: AggregatedPrice
  ): Promise<void> {
    const asset = mint.toString();

    const metrics: QualityMetrics = {
      asset,
      timestamp: Date.now(),
      priceDeviation: aggregated.deviation || 0,
      sourceCount: readings.length,
      confidence: aggregated.confidence,
      outlierCount: this.countOutliers(readings, aggregated.price),
      staleSources: this.findStaleSources(readings),
      failedSources: Array.from(this.failedSources.get(asset) || []),
    };

    // Store metrics
    this.storeMetrics(asset, metrics);

    // Check for alerts
    this.checkAlerts(metrics);

    // Emit metrics event
    this.emit('metrics', metrics);
  }

  /**
   * Record a failed source
   */
  recordFailure(mint: PublicKey, source: string): void {
    const asset = mint.toString();

    if (!this.failedSources.has(asset)) {
      this.failedSources.set(asset, new Set());
    }

    this.failedSources.get(asset)!.add(source);
  }

  /**
   * Clear failed sources for an asset
   */
  clearFailures(mint: PublicKey, source?: string): void {
    const asset = mint.toString();

    if (source) {
      this.failedSources.get(asset)?.delete(source);
    } else {
      this.failedSources.delete(asset);
    }
  }

  /**
   * Check for alert conditions and emit alerts
   */
  private checkAlerts(metrics: QualityMetrics): void {
    // Alert 1: High price deviation (possible manipulation or volatility)
    if (metrics.priceDeviation > this.config.maxDeviation) {
      this.emitAlert({
        type: 'high_deviation',
        asset: metrics.asset,
        severity: metrics.priceDeviation > 0.20 ? 'critical' : 'warning',
        message: `Price sources showing ${(metrics.priceDeviation * 100).toFixed(1)}% deviation`,
        data: { deviation: metrics.priceDeviation },
        timestamp: metrics.timestamp,
      });
    }

    // Alert 2: Low source count (reliability risk)
    if (metrics.sourceCount < this.config.minSources) {
      this.emitAlert({
        type: 'low_sources',
        asset: metrics.asset,
        severity: metrics.sourceCount === 0 ? 'critical' : 'error',
        message: `Only ${metrics.sourceCount} price source(s) available`,
        data: { sourceCount: metrics.sourceCount },
        timestamp: metrics.timestamp,
      });
    }

    // Alert 3: Low confidence (data quality issue)
    if (metrics.confidence < this.config.minConfidence) {
      this.emitAlert({
        type: 'low_confidence',
        asset: metrics.asset,
        severity: metrics.confidence < 0.50 ? 'error' : 'warning',
        message: `Price confidence below ${(this.config.minConfidence * 100).toFixed(0)}%`,
        data: { confidence: metrics.confidence },
        timestamp: metrics.timestamp,
      });
    }

    // Alert 4: High outlier ratio (market volatility or bad sources)
    const outlierRatio = metrics.sourceCount > 0
      ? metrics.outlierCount / metrics.sourceCount
      : 0;

    if (outlierRatio > this.config.maxOutlierRatio) {
      this.emitAlert({
        type: 'high_outliers',
        asset: metrics.asset,
        severity: 'warning',
        message: `${(outlierRatio * 100).toFixed(0)}% of sources are outliers`,
        data: {
          outlierCount: metrics.outlierCount,
          totalCount: metrics.sourceCount,
          ratio: outlierRatio,
        },
        timestamp: metrics.timestamp,
      });
    }

    // Alert 5: Stale data sources
    if (metrics.staleSources.length > 0) {
      this.emitAlert({
        type: 'stale_data',
        asset: metrics.asset,
        severity: 'warning',
        message: `${metrics.staleSources.length} source(s) have stale data`,
        data: { staleSources: metrics.staleSources },
        timestamp: metrics.timestamp,
      });
    }
  }

  /**
   * Emit an alert
   */
  private emitAlert(alert: QualityAlert): void {
    this.emit('alert', alert);
    this.emit(alert.type, alert);
  }

  /**
   * Count outlier prices
   */
  private countOutliers(
    readings: PriceReading[],
    medianPrice: number,
    threshold: number = 0.05
  ): number {
    return readings.filter(r =>
      Math.abs(r.price - medianPrice) / medianPrice > threshold
    ).length;
  }

  /**
   * Find sources with stale data
   */
  private findStaleSources(readings: PriceReading[]): string[] {
    const now = Date.now();

    return readings
      .filter(r => now - r.timestamp > this.config.staleThresholdMs)
      .map(r => r.source);
  }

  /**
   * Store metrics history
   */
  private storeMetrics(asset: string, metrics: QualityMetrics): void {
    if (!this.metrics.has(asset)) {
      this.metrics.set(asset, []);
    }

    const history = this.metrics.get(asset)!;
    history.push(metrics);

    // Keep only recent history
    if (history.length > this.config.metricsHistorySize) {
      history.shift();
    }
  }

  /**
   * Get metrics history for an asset
   */
  getMetricsHistory(mint: PublicKey, limit?: number): QualityMetrics[] {
    const asset = mint.toString();
    const history = this.metrics.get(asset) || [];

    if (limit) {
      return history.slice(-limit);
    }

    return [...history];
  }

  /**
   * Get latest metrics for an asset
   */
  getLatestMetrics(mint: PublicKey): QualityMetrics | null {
    const asset = mint.toString();
    const history = this.metrics.get(asset) || [];

    return history.length > 0 ? history[history.length - 1]! : null;
  }

  /**
   * Get source reliability score (0-1) based on historical performance
   */
  getSourceReliability(mint: PublicKey, source: string): number {
    const asset = mint.toString();
    const history = this.metrics.get(asset) || [];

    if (history.length === 0) {
      return 1.0; // No history = assume reliable
    }

    // Calculate uptime % over recent history
    const recent = history.slice(-100); // Last 100 readings
    const failures = recent.filter(m =>
      m.failedSources.includes(source) || m.staleSources.includes(source)
    ).length;

    return 1 - (failures / recent.length);
  }

  /**
   * Get overall quality score for an asset (0-1)
   */
  getQualityScore(mint: PublicKey): number {
    const metrics = this.getLatestMetrics(mint);

    if (!metrics) {
      return 0;
    }

    // Weighted quality score
    let score = 0;

    // Factor 1: Confidence (40%)
    score += metrics.confidence * 0.4;

    // Factor 2: Source count (30%)
    const sourceScore = Math.min(1, metrics.sourceCount / 5); // 5 sources = max score
    score += sourceScore * 0.3;

    // Factor 3: Low deviation (20%)
    const deviationScore = Math.max(0, 1 - (metrics.priceDeviation / 0.10));
    score += deviationScore * 0.2;

    // Factor 4: Few outliers (10%)
    const outlierRatio = metrics.sourceCount > 0
      ? metrics.outlierCount / metrics.sourceCount
      : 0;
    const outlierScore = Math.max(0, 1 - (outlierRatio / 0.30));
    score += outlierScore * 0.1;

    return score;
  }

  /**
   * Update configuration
   */
  updateConfig(config: Partial<QualityConfig>): void {
    this.config = { ...this.config, ...config };
  }

  /**
   * Get current configuration
   */
  getConfig(): QualityConfig {
    return { ...this.config };
  }

  /**
   * Clear all metrics
   */
  clearMetrics(mint?: PublicKey): void {
    if (mint) {
      this.metrics.delete(mint.toString());
      this.failedSources.delete(mint.toString());
    } else {
      this.metrics.clear();
      this.failedSources.clear();
    }
  }
}
