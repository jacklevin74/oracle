/**
 * Websocket price stream connectors, one class per exchange endpoint.
 * All public market data; no API keys and no REST calls.
 */

import { WsFeed } from './ws-feed';

const num = (v: unknown): number | null => {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
};

/** Kraken spot, v2 ticker channel */
export class KrakenFeed extends WsFeed {
  readonly id = 'kraken';
  readonly venue = 'Kraken';
  protected readonly url = 'wss://ws.kraken.com/v2';

  protected subscribe(): void {
    // Push on best bid/offer changes, not only on trades, so quiet markets stay fresh
    this.send({ method: 'subscribe', params: { channel: 'ticker', symbol: this.markets, event_trigger: 'bbo' } });
  }
  protected pingPayload(): string {
    return JSON.stringify({ method: 'ping' });
  }
  protected handleMessage(raw: string): void {
    const m = JSON.parse(raw);
    if (m.success === false) this.reportError(m.error ?? 'subscribe failed');
    if (m.channel !== 'ticker' || !Array.isArray(m.data)) return;
    for (const d of m.data) this.emitQuote(d.symbol, num(d.bid), num(d.ask), num(d.last));
  }
}

/** Coinbase Exchange, ticker channel */
export class CoinbaseFeed extends WsFeed {
  readonly id = 'coinbase';
  readonly venue = 'Coinbase';
  protected readonly url = 'wss://ws-feed.exchange.coinbase.com';

  protected subscribe(): void {
    this.send({ type: 'subscribe', product_ids: this.markets, channels: ['ticker', 'heartbeat'] });
  }
  protected handleMessage(raw: string): void {
    const m = JSON.parse(raw);
    if (m.type === 'error') this.reportError(`${m.message}: ${m.reason ?? ''}`);
    if (m.type !== 'ticker') return;
    this.emitQuote(m.product_id, num(m.best_bid), num(m.best_ask), num(m.price));
  }
}

/** Bybit v5 public stream, top-of-book (orderbook.1) for spot or linear perps */
export class BybitFeed extends WsFeed {
  readonly id: string;
  readonly venue: string;
  protected readonly url: string;
  private books = new Map<string, { bid: number | null; ask: number | null }>();

  constructor(category: 'spot' | 'linear', markets: string[]) {
    super(markets);
    this.id = `bybit-${category}`;
    this.venue = category === 'spot' ? 'Bybit Spot' : 'Bybit Perps';
    this.url = `wss://stream.bybit.com/v5/public/${category}`;
  }
  protected subscribe(): void {
    // Spot allows at most 10 args per subscribe request
    for (let i = 0; i < this.markets.length; i += 10) {
      this.send({ op: 'subscribe', args: this.markets.slice(i, i + 10).map((s) => `orderbook.1.${s}`) });
    }
  }
  protected pingPayload(): string {
    return JSON.stringify({ op: 'ping' });
  }
  protected handleMessage(raw: string): void {
    const m = JSON.parse(raw);
    if (m.success === false) this.reportError(m.ret_msg ?? 'subscribe failed');
    if (typeof m.topic !== 'string' || !m.topic.startsWith('orderbook.1.') || !m.data) return;
    const sym: string = m.data.s;
    const book = m.type === 'snapshot' ? { bid: null, ask: null } : (this.books.get(sym) ?? { bid: null, ask: null });
    const b = m.data.b?.[0];
    const a = m.data.a?.[0];
    if (b) book.bid = num(b[1]) === 0 ? null : num(b[0]);
    if (a) book.ask = num(a[1]) === 0 ? null : num(a[0]);
    this.books.set(sym, book);
    this.emitQuote(sym, book.bid, book.ask);
  }
}

/** Hyperliquid, l2Book per coin (includes HIP-3 markets such as xyz:TSLA) */
export class HyperliquidFeed extends WsFeed {
  readonly id = 'hyperliquid';
  readonly venue = 'Hyperliquid';
  protected readonly url = 'wss://api.hyperliquid.xyz/ws';

  protected subscribe(): void {
    for (const coin of this.markets) {
      this.send({ method: 'subscribe', subscription: { type: 'l2Book', coin } });
    }
  }
  protected pingPayload(): string {
    return JSON.stringify({ method: 'ping' });
  }
  protected handleMessage(raw: string): void {
    const m = JSON.parse(raw);
    if (m.channel === 'error') this.reportError(String(m.data));
    if (m.channel !== 'l2Book' || !m.data?.levels) return;
    const [bids, asks] = m.data.levels;
    this.emitQuote(m.data.coin, num(bids?.[0]?.px), num(asks?.[0]?.px));
  }
}

/** OKX v5 public tickers (spot and swaps share one endpoint) */
export class OkxFeed extends WsFeed {
  readonly id = 'okx';
  readonly venue = 'OKX';
  protected readonly url = 'wss://ws.okx.com:8443/ws/v5/public';

  protected subscribe(): void {
    this.send({ op: 'subscribe', args: this.markets.map((instId) => ({ channel: 'tickers', instId })) });
  }
  protected pingPayload(): string {
    return 'ping';
  }
  protected handleMessage(raw: string): void {
    if (raw === 'pong') return;
    const m = JSON.parse(raw);
    if (m.event === 'error') this.reportError(m.msg ?? 'subscribe failed');
    if (m.arg?.channel !== 'tickers' || !Array.isArray(m.data)) return;
    for (const d of m.data) this.emitQuote(d.instId, num(d.bidPx), num(d.askPx), num(d.last));
  }
}

/** Bitget v2 public ticker, spot or USDT-margined futures */
export class BitgetFeed extends WsFeed {
  readonly id: string;
  readonly venue: string;
  protected readonly url = 'wss://ws.bitget.com/v2/ws/public';
  protected readonly pingIntervalMs = 25_000;

  constructor(private readonly instType: 'SPOT' | 'USDT-FUTURES', markets: string[]) {
    super(markets);
    this.id = instType === 'SPOT' ? 'bitget-spot' : 'bitget-futures';
    this.venue = instType === 'SPOT' ? 'Bitget Spot' : 'Bitget Perps';
  }
  protected subscribe(): void {
    this.send({
      op: 'subscribe',
      args: this.markets.map((instId) => ({ instType: this.instType, channel: 'ticker', instId })),
    });
  }
  protected pingPayload(): string {
    return 'ping';
  }
  protected handleMessage(raw: string): void {
    if (raw === 'pong') return;
    const m = JSON.parse(raw);
    if (m.event === 'error') this.reportError(m.msg ?? 'subscribe failed');
    if (m.arg?.channel !== 'ticker' || !Array.isArray(m.data)) return;
    for (const d of m.data) this.emitQuote(d.instId, num(d.bidPr), num(d.askPr), num(d.lastPr));
  }
}

/** Gate.io v4 book_ticker, spot or USDT perpetual futures */
export class GateFeed extends WsFeed {
  readonly id: string;
  readonly venue: string;
  protected readonly url: string;
  private readonly prefix: 'spot' | 'futures';

  constructor(kind: 'spot' | 'futures', markets: string[]) {
    super(markets);
    this.prefix = kind;
    this.id = `gate-${kind}`;
    this.venue = kind === 'spot' ? 'Gate Spot' : 'Gate Perps';
    this.url = kind === 'spot' ? 'wss://api.gateio.ws/ws/v4/' : 'wss://fx-ws.gateio.ws/v4/ws/usdt';
  }
  private now(): number {
    return Math.floor(Date.now() / 1000);
  }
  protected subscribe(): void {
    this.send({ time: this.now(), channel: `${this.prefix}.book_ticker`, event: 'subscribe', payload: this.markets });
  }
  protected pingPayload(): string {
    return JSON.stringify({ time: this.now(), channel: `${this.prefix}.ping` });
  }
  protected handleMessage(raw: string): void {
    const m = JSON.parse(raw);
    if (m.error) this.reportError(m.error.message ?? JSON.stringify(m.error));
    if (m.channel !== `${this.prefix}.book_ticker` || m.event !== 'update' || !m.result) return;
    this.emitQuote(m.result.s, num(m.result.b), num(m.result.a));
  }
}

/** Bitstamp top of order book */
export class BitstampFeed extends WsFeed {
  readonly id = 'bitstamp';
  readonly venue = 'Bitstamp';
  protected readonly url = 'wss://ws.bitstamp.net';

  protected subscribe(): void {
    for (const pair of this.markets) {
      this.send({ event: 'bts:subscribe', data: { channel: `order_book_${pair}` } });
    }
  }
  protected pingPayload(): string {
    return JSON.stringify({ event: 'bts:heartbeat' });
  }
  protected handleMessage(raw: string): void {
    const m = JSON.parse(raw);
    if (m.event === 'bts:error') this.reportError(m.data?.message ?? 'subscribe failed');
    if (m.event !== 'data' || typeof m.channel !== 'string' || !m.channel.startsWith('order_book_')) return;
    const pair = m.channel.slice('order_book_'.length);
    this.emitQuote(pair, num(m.data?.bids?.[0]?.[0]), num(m.data?.asks?.[0]?.[0]));
  }
}
