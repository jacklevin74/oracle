/**
 * Stream-only price engine.
 *
 * Starts one websocket feed per exchange endpoint, keeps the latest quote
 * per market, and aggregates each asset into a USD price:
 *   1. convert USDT-quoted markets to USD with the live USDT/USD reference
 *   2. drop quotes older than staleMs
 *   3. take the median, reject sources beyond the asset's maxDeviation,
 *      and re-take the median of the survivors
 */

import { AssetConfig, ASSETS, FeedId, SourceConfig, USDT_REFERENCE } from './assets';
import { FeedStatus, Quote, WsFeed } from './ws-feed';
import {
  BitgetFeed,
  BitstampFeed,
  BybitFeed,
  CoinbaseFeed,
  GateFeed,
  HyperliquidFeed,
  KrakenFeed,
  OkxFeed,
} from './venues';

export type SourceState = 'used' | 'outlier' | 'stale' | 'no_data';
export type AssetStatus = 'ok' | 'degraded' | 'down';

export interface SourceSnapshot {
  venue: string;
  feed: FeedId;
  market: string;
  kind: 'spot' | 'perp';
  quote: 'USD' | 'USDT';
  rawPrice: number | null;
  usdPrice: number | null;
  bid: number | null;
  ask: number | null;
  ageMs: number | null;
  deviationPct: number | null;
  state: SourceState;
}

export interface AssetSnapshot {
  symbol: string;
  name: string;
  category: AssetConfig['category'];
  price: number | null;
  status: AssetStatus;
  sourcesUsed: number;
  sourcesTotal: number;
  minSources: number;
  /** Time of the freshest quote used, ISO string */
  updatedAt: string | null;
  sources: SourceSnapshot[];
}

export interface EngineSnapshot {
  timestamp: string;
  usdtUsd: AssetSnapshot;
  assets: AssetSnapshot[];
  feeds: (FeedStatus & { quotesReceived: number })[];
}

export function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

export class PriceEngine {
  private feeds = new Map<FeedId, WsFeed>();
  private quotes = new Map<string, Quote>();
  private quoteCounts = new Map<string, number>();

  constructor(
    private readonly assets: AssetConfig[] = ASSETS,
    private readonly staleMs = 60_000
  ) {
    const all = [USDT_REFERENCE, ...assets];
    const marketsFor = (feed: FeedId) =>
      all.flatMap((a) => a.sources.filter((s) => s.feed === feed).map((s) => s.market));

    const feeds: WsFeed[] = [
      new KrakenFeed(marketsFor('kraken')),
      new CoinbaseFeed(marketsFor('coinbase')),
      new BitstampFeed(marketsFor('bitstamp')),
      new BybitFeed('spot', marketsFor('bybit-spot')),
      new BybitFeed('linear', marketsFor('bybit-linear')),
      new HyperliquidFeed(marketsFor('hyperliquid')),
      new OkxFeed(marketsFor('okx')),
      new BitgetFeed('SPOT', marketsFor('bitget-spot')),
      new BitgetFeed('USDT-FUTURES', marketsFor('bitget-futures')),
      new GateFeed('spot', marketsFor('gate-spot')),
      new GateFeed('futures', marketsFor('gate-futures')),
    ];

    for (const f of feeds) {
      f.on('quote', (q: Quote) => {
        this.quotes.set(`${q.feedId}|${q.market}`, q);
        this.quoteCounts.set(q.feedId, (this.quoteCounts.get(q.feedId) ?? 0) + 1);
      });
      this.feeds.set(f.id as FeedId, f);
    }
  }

  start(): void {
    for (const f of this.feeds.values()) f.start();
  }

  stop(): void {
    for (const f of this.feeds.values()) f.stop();
  }

  symbols(): string[] {
    return this.assets.map((a) => a.symbol);
  }

  snapshot(): EngineSnapshot {
    const now = Date.now();
    const usdt = this.aggregate(USDT_REFERENCE, now, 1);
    // Fall back to 1:1 if the USDT reference is unavailable
    const usdtRate = usdt.price ?? 1;
    return {
      timestamp: new Date(now).toISOString(),
      usdtUsd: usdt,
      assets: this.assets.map((a) => this.aggregate(a, now, usdtRate)),
      feeds: [...this.feeds.values()].map((f) => ({
        ...f.getStatus(),
        quotesReceived: this.quoteCounts.get(f.id as FeedId) ?? 0,
      })),
    };
  }

  private aggregate(asset: AssetConfig, now: number, usdtRate: number): AssetSnapshot {
    const sources: SourceSnapshot[] = asset.sources.map((s: SourceConfig) => {
      const q = this.quotes.get(`${s.feed}|${s.market}`);
      const rate = s.quote === 'USDT' ? usdtRate : 1;
      const ageMs = q ? now - q.ts : null;
      return {
        venue: this.feeds.get(s.feed)?.venue ?? s.feed,
        feed: s.feed,
        market: s.market,
        kind: s.kind,
        quote: s.quote,
        rawPrice: q?.price ?? null,
        usdPrice: q ? q.price * rate : null,
        bid: q?.bid ?? null,
        ask: q?.ask ?? null,
        ageMs,
        deviationPct: null,
        state: !q ? 'no_data' : ageMs! > this.staleMs ? 'stale' : 'used',
      };
    });

    const fresh = sources.filter((s) => s.state === 'used');
    const first = median(fresh.map((s) => s.usdPrice!));
    let price: number | null = null;

    if (first !== null) {
      for (const s of fresh) {
        if (Math.abs(s.usdPrice! - first) / first > asset.maxDeviation) s.state = 'outlier';
      }
      price = median(sources.filter((s) => s.state === 'used').map((s) => s.usdPrice!));
    }
    if (price !== null) {
      for (const s of sources) {
        if (s.usdPrice !== null) s.deviationPct = ((s.usdPrice - price) / price) * 100;
      }
    }

    const used = sources.filter((s) => s.state === 'used');
    const newest = used.reduce<number | null>((m, s) => (m === null || s.ageMs! < m ? s.ageMs! : m), null);

    return {
      symbol: asset.symbol,
      name: asset.name,
      category: asset.category,
      price,
      status: used.length >= asset.minSources ? 'ok' : used.length > 0 ? 'degraded' : 'down',
      sourcesUsed: used.length,
      sourcesTotal: sources.length,
      minSources: asset.minSources,
      updatedAt: newest !== null ? new Date(now - newest).toISOString() : null,
      sources,
    };
  }
}
