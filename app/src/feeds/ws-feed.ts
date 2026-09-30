/**
 * Base class for exchange websocket price streams.
 *
 * Handles connect, reconnect with exponential backoff, application-level
 * keepalive pings, and a watchdog that reconnects when the stream goes quiet.
 * Subclasses only implement subscription and message parsing.
 */

import { EventEmitter } from 'events';
import WebSocket from 'ws';

export interface Quote {
  feedId: string;
  market: string;
  bid: number | null;
  ask: number | null;
  /** Mid of bid/ask when both are present, otherwise last trade price */
  price: number;
  ts: number;
}

export interface FeedStatus {
  id: string;
  venue: string;
  url: string;
  connected: boolean;
  lastMessageMs: number | null;
  connectedSinceMs: number | null;
  reconnects: number;
  lastError: string | null;
  markets: string[];
}

const WATCHDOG_MS = 30_000;
const MAX_BACKOFF_MS = 30_000;

export abstract class WsFeed extends EventEmitter {
  abstract readonly id: string;
  abstract readonly venue: string;
  protected abstract readonly url: string;
  protected readonly pingIntervalMs: number = 20_000;

  protected readonly markets: string[];
  private ws: WebSocket | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private watchdogTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private backoffMs = 1000;
  private stopped = true;

  private connected = false;
  private lastMessageMs: number | null = null;
  private connectedSinceMs: number | null = null;
  private reconnects = 0;
  private lastError: string | null = null;

  constructor(markets: string[]) {
    super();
    this.markets = [...new Set(markets)];
  }

  /** Send subscription messages after the socket opens */
  protected abstract subscribe(): void;
  /** Parse one raw message; call emitQuote() for each price found */
  protected abstract handleMessage(raw: string): void;
  /** Application-level ping payload, or null if the venue needs none */
  protected pingPayload(): string | null {
    return null;
  }

  start(): void {
    if (!this.stopped || this.markets.length === 0) return;
    this.stopped = false;
    this.connect();
  }

  stop(): void {
    this.stopped = true;
    this.clearTimers();
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.ws?.terminate();
    this.ws = null;
    this.connected = false;
  }

  getStatus(): FeedStatus {
    return {
      id: this.id,
      venue: this.venue,
      url: this.url,
      connected: this.connected,
      lastMessageMs: this.lastMessageMs,
      connectedSinceMs: this.connectedSinceMs,
      reconnects: this.reconnects,
      lastError: this.lastError,
      markets: this.markets,
    };
  }

  protected send(msg: unknown): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(typeof msg === 'string' ? msg : JSON.stringify(msg));
    }
  }

  /** Record a venue-reported error (e.g. rejected subscription) for the status page */
  protected reportError(msg: string): void {
    this.lastError = msg;
  }

  protected emitQuote(market: string, bid: number | null, ask: number | null, last?: number | null): void {
    const okBid = bid !== null && Number.isFinite(bid) && bid > 0 ? bid : null;
    const okAsk = ask !== null && Number.isFinite(ask) && ask > 0 ? ask : null;
    let price: number | null = null;
    if (okBid !== null && okAsk !== null && okAsk >= okBid) price = (okBid + okAsk) / 2;
    else if (last !== undefined && last !== null && Number.isFinite(last) && last > 0) price = last;
    if (price === null) return;

    const quote: Quote = { feedId: this.id, market, bid: okBid, ask: okAsk, price, ts: Date.now() };
    this.emit('quote', quote);
  }

  private connect(): void {
    const ws = new WebSocket(this.url);
    this.ws = ws;

    ws.on('open', () => {
      this.connected = true;
      this.connectedSinceMs = Date.now();
      this.lastMessageMs = Date.now();
      this.backoffMs = 1000;
      this.subscribe();
      this.startTimers();
    });

    ws.on('message', (data: WebSocket.Data) => {
      this.lastMessageMs = Date.now();
      try {
        this.handleMessage(data.toString());
      } catch (err) {
        this.lastError = `parse: ${(err as Error).message}`;
      }
    });

    ws.on('unexpected-response', (_req, res) => {
      this.lastError = `HTTP ${res.statusCode} on connect`;
    });

    ws.on('error', (err: Error) => {
      this.lastError = err.message;
    });

    ws.on('close', () => {
      if (this.ws !== ws) return;
      this.connected = false;
      this.connectedSinceMs = null;
      this.clearTimers();
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.stopped) return;
    this.reconnects++;
    const delay = this.backoffMs;
    this.backoffMs = Math.min(this.backoffMs * 2, MAX_BACKOFF_MS);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private startTimers(): void {
    this.clearTimers();
    const ping = this.pingPayload();
    if (ping !== null) {
      this.pingTimer = setInterval(() => this.send(this.pingPayload() ?? ping), this.pingIntervalMs);
    }
    this.watchdogTimer = setInterval(() => {
      if (this.lastMessageMs !== null && Date.now() - this.lastMessageMs > WATCHDOG_MS) {
        this.lastError = `no data for ${WATCHDOG_MS / 1000}s, reconnecting`;
        this.ws?.terminate();
      }
    }, 5_000);
  }

  private clearTimers(): void {
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.watchdogTimer) clearInterval(this.watchdogTimer);
    this.pingTimer = null;
    this.watchdogTimer = null;
  }
}
