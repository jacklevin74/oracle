/**
 * Asset configuration types and loader
 */

import { PublicKey } from '@solana/web3.js';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface AssetSourceConfig {
  pyth?: {
    feedId: string;
  };
  jupiter?: {
    enabled: boolean;
    vsToken?: string;
  };
  dexScreener?: {
    enabled: boolean;
    pairAddress?: string;
  };
  birdeye?: {
    enabled: boolean;
  };
  cex?: {
    exchanges: string[];
  };
  coingecko?: {
    coinId: string;
  };
}

export interface AssetFeedConfig {
  mint: PublicKey;
  symbol: string;
  decimals: number;
  sources: AssetSourceConfig;
  minSources: number;
  maxPriceDeviation: number;
  outlierThreshold?: number;
  enabled: boolean;
}

export interface AssetConfigFile {
  version: string;
  updateIntervalMs: number;
  assets: Array<{
    mint: string;
    symbol: string;
    decimals: number;
    sources: AssetSourceConfig;
    minSources: number;
    maxPriceDeviation: number;
    outlierThreshold?: number;
    enabled: boolean;
  }>;
}

export class AssetRegistry {
  private assets: Map<string, AssetFeedConfig>;
  private configPath: string | null;

  constructor() {
    this.assets = new Map();
    this.configPath = null;
  }

  /**
   * Load assets from JSON configuration file
   */
  async loadFromConfig(configPath: string): Promise<void> {
    this.configPath = configPath;

    try {
      const content = await fs.readFile(configPath, 'utf-8');
      const config: AssetConfigFile = JSON.parse(content);

      console.log(`Loading asset configuration v${config.version} from ${configPath}`);

      for (const assetData of config.assets) {
        try {
          const asset: AssetFeedConfig = {
            mint: new PublicKey(assetData.mint),
            symbol: assetData.symbol,
            decimals: assetData.decimals,
            sources: assetData.sources,
            minSources: assetData.minSources,
            maxPriceDeviation: assetData.maxPriceDeviation,
            outlierThreshold: assetData.outlierThreshold,
            enabled: assetData.enabled,
          };

          this.assets.set(assetData.mint, asset);
        } catch (error) {
          console.error(`Error loading asset ${assetData.symbol}:`, error);
        }
      }

      console.log(`Loaded ${this.assets.size} assets from configuration`);
    } catch (error) {
      throw new Error(`Failed to load asset configuration: ${error}`);
    }
  }

  /**
   * Reload configuration from file
   */
  async reload(): Promise<void> {
    if (!this.configPath) {
      throw new Error('No configuration path set');
    }

    const oldSize = this.assets.size;
    this.assets.clear();
    await this.loadFromConfig(this.configPath);

    console.log(`Reloaded configuration: ${oldSize} -> ${this.assets.size} assets`);
  }

  /**
   * Get all assets
   */
  getAllAssets(): AssetFeedConfig[] {
    return Array.from(this.assets.values());
  }

  /**
   * Get active (enabled) assets only
   */
  getActiveAssets(): AssetFeedConfig[] {
    return this.getAllAssets().filter(a => a.enabled);
  }

  /**
   * Get asset by mint address
   */
  getAsset(mint: PublicKey): AssetFeedConfig | undefined {
    return this.assets.get(mint.toString());
  }

  /**
   * Get asset by symbol
   */
  getAssetBySymbol(symbol: string): AssetFeedConfig | undefined {
    return this.getAllAssets().find(a => a.symbol === symbol);
  }

  /**
   * Check if asset exists
   */
  hasAsset(mint: PublicKey): boolean {
    return this.assets.has(mint.toString());
  }

  /**
   * Get assets with a specific source enabled
   */
  getAssetsBySource(sourceName: keyof AssetSourceConfig): AssetFeedConfig[] {
    return this.getActiveAssets().filter(a => {
      const source = a.sources[sourceName];
      if (sourceName === 'jupiter' || sourceName === 'dexScreener' || sourceName === 'birdeye') {
        return source && (source as any).enabled === true;
      }
      return source !== undefined;
    });
  }

  /**
   * Enable/disable an asset
   */
  setAssetEnabled(mint: PublicKey, enabled: boolean): void {
    const asset = this.assets.get(mint.toString());
    if (asset) {
      asset.enabled = enabled;
    }
  }

  /**
   * Add asset programmatically
   */
  addAsset(asset: AssetFeedConfig): void {
    this.assets.set(asset.mint.toString(), asset);
  }

  /**
   * Remove asset
   */
  removeAsset(mint: PublicKey): boolean {
    return this.assets.delete(mint.toString());
  }

  /**
   * Get asset count
   */
  getAssetCount(): number {
    return this.assets.size;
  }

  /**
   * Get active asset count
   */
  getActiveAssetCount(): number {
    return this.getActiveAssets().length;
  }

  /**
   * Export configuration to JSON string
   */
  exportConfig(): string {
    const config: AssetConfigFile = {
      version: '1.0',
      updateIntervalMs: 1000,
      assets: this.getAllAssets().map(a => ({
        mint: a.mint.toString(),
        symbol: a.symbol,
        decimals: a.decimals,
        sources: a.sources,
        minSources: a.minSources,
        maxPriceDeviation: a.maxPriceDeviation,
        outlierThreshold: a.outlierThreshold,
        enabled: a.enabled,
      })),
    };

    return JSON.stringify(config, null, 2);
  }

  /**
   * Save configuration to file
   */
  async saveConfig(outputPath?: string): Promise<void> {
    const savePath = outputPath || this.configPath;
    if (!savePath) {
      throw new Error('No save path specified');
    }

    const config = this.exportConfig();
    await fs.writeFile(savePath, config, 'utf-8');

    console.log(`Saved configuration to ${savePath}`);
  }
}
