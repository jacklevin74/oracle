/**
 * Asset → market mapping for the stream-only price engine.
 *
 * Crypto uses spot books quoted in USD or USDT. Equities and metals use the
 * deepest venues available: Hyperliquid HIP-3 (xyz:) markets and USDT perps,
 * which track the underlying rather than tokenized-stock premiums.
 */

export type FeedId =
  | 'kraken'
  | 'coinbase'
  | 'bitstamp'
  | 'bybit-spot'
  | 'bybit-linear'
  | 'hyperliquid'
  | 'okx'
  | 'bitget-spot'
  | 'bitget-futures'
  | 'gate-spot'
  | 'gate-futures';

export type QuoteCurrency = 'USD' | 'USDT';

export interface SourceConfig {
  feed: FeedId;
  market: string;
  quote: QuoteCurrency;
  kind: 'spot' | 'perp';
}

export interface AssetConfig {
  symbol: string;
  name: string;
  category: 'crypto' | 'equity' | 'metal' | 'reference';
  /** Minimum agreeing sources for status "ok" (fewer → "degraded") */
  minSources: number;
  /** Max fractional distance from the median before a source is rejected */
  maxDeviation: number;
  sources: SourceConfig[];
}

type CryptoFeed = 'kraken' | 'coinbase' | 'bitstamp' | 'bybit' | 'hyperliquid' | 'okx' | 'bitget' | 'gate';

function crypto(base: string, feeds: CryptoFeed[]): SourceConfig[] {
  const map: Record<CryptoFeed, SourceConfig> = {
    kraken: { feed: 'kraken', market: `${base}/USD`, quote: 'USD', kind: 'spot' },
    coinbase: { feed: 'coinbase', market: `${base}-USD`, quote: 'USD', kind: 'spot' },
    bitstamp: { feed: 'bitstamp', market: `${base.toLowerCase()}usd`, quote: 'USD', kind: 'spot' },
    bybit: { feed: 'bybit-spot', market: `${base}USDT`, quote: 'USDT', kind: 'spot' },
    // Hyperliquid perps settle in USDC and are quoted in USD
    hyperliquid: { feed: 'hyperliquid', market: base, quote: 'USD', kind: 'perp' },
    okx: { feed: 'okx', market: `${base}-USDT`, quote: 'USDT', kind: 'spot' },
    bitget: { feed: 'bitget-spot', market: `${base}USDT`, quote: 'USDT', kind: 'spot' },
    gate: { feed: 'gate-spot', market: `${base}_USDT`, quote: 'USDT', kind: 'spot' },
  };
  return feeds.map((f) => map[f]);
}

function tradfi(hlCoin: string, base: string): SourceConfig[] {
  return [
    { feed: 'hyperliquid', market: `xyz:${hlCoin}`, quote: 'USD', kind: 'perp' },
    { feed: 'okx', market: `${base}-USDT-SWAP`, quote: 'USDT', kind: 'perp' },
    { feed: 'bybit-linear', market: `${base}USDT`, quote: 'USDT', kind: 'perp' },
    { feed: 'bitget-futures', market: `${base}USDT`, quote: 'USDT', kind: 'perp' },
    { feed: 'gate-futures', market: `${base}_USDT`, quote: 'USDT', kind: 'perp' },
  ];
}

const ALL_CRYPTO: CryptoFeed[] = ['kraken', 'coinbase', 'bitstamp', 'bybit', 'hyperliquid', 'okx', 'bitget', 'gate'];

export const ASSETS: AssetConfig[] = [
  { symbol: 'BTC', name: 'Bitcoin', category: 'crypto', minSources: 3, maxDeviation: 0.005, sources: crypto('BTC', ALL_CRYPTO) },
  { symbol: 'ETH', name: 'Ethereum', category: 'crypto', minSources: 3, maxDeviation: 0.005, sources: crypto('ETH', ALL_CRYPTO) },
  { symbol: 'SOL', name: 'Solana', category: 'crypto', minSources: 3, maxDeviation: 0.005, sources: crypto('SOL', ALL_CRYPTO) },
  {
    symbol: 'HYPE',
    name: 'Hyperliquid',
    category: 'crypto',
    minSources: 3,
    maxDeviation: 0.01,
    sources: crypto('HYPE', ['kraken', 'coinbase', 'bybit', 'hyperliquid', 'okx', 'bitget', 'gate']),
  },
  {
    symbol: 'ZEC',
    name: 'Zcash',
    category: 'crypto',
    minSources: 3,
    maxDeviation: 0.01,
    sources: crypto('ZEC', ['kraken', 'coinbase', 'hyperliquid', 'okx', 'bitget', 'gate']),
  },
  {
    symbol: 'FARTCOIN',
    name: 'Fartcoin',
    category: 'crypto',
    minSources: 3,
    maxDeviation: 0.01,
    sources: crypto('FARTCOIN', ['kraken', 'coinbase', 'hyperliquid', 'bitget', 'gate']),
  },
  { symbol: 'TSLA', name: 'Tesla', category: 'equity', minSources: 3, maxDeviation: 0.01, sources: tradfi('TSLA', 'TSLA') },
  { symbol: 'NVDA', name: 'NVIDIA', category: 'equity', minSources: 3, maxDeviation: 0.01, sources: tradfi('NVDA', 'NVDA') },
  { symbol: 'MSTR', name: 'Strategy', category: 'equity', minSources: 3, maxDeviation: 0.01, sources: tradfi('MSTR', 'MSTR') },
  { symbol: 'GOLD', name: 'Gold (XAU)', category: 'metal', minSources: 3, maxDeviation: 0.005, sources: tradfi('GOLD', 'XAU') },
  { symbol: 'SILVER', name: 'Silver (XAG)', category: 'metal', minSources: 3, maxDeviation: 0.01, sources: tradfi('SILVER', 'XAG') },
];

/** USDT/USD reference used to convert USDT-quoted markets to USD */
export const USDT_REFERENCE: AssetConfig = {
  symbol: 'USDT',
  name: 'Tether (USDT/USD conversion)',
  category: 'reference',
  minSources: 2,
  maxDeviation: 0.002,
  sources: [
    { feed: 'kraken', market: 'USDT/USD', quote: 'USD', kind: 'spot' },
    { feed: 'coinbase', market: 'USDT-USD', quote: 'USD', kind: 'spot' },
    { feed: 'bitstamp', market: 'usdtusd', quote: 'USD', kind: 'spot' },
  ],
};
