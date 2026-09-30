/**
 * Fan-out of engine prices to per-client subscriptions.
 *
 * One engine snapshot per tick is shared by all clients. Each client gets a
 * batched message containing only its subscribed assets whose price or status
 * changed since the last message sent to that client.
 */

import { AssetSnapshot, PriceEngine } from '../feeds/price-engine';

export interface PriceUpdate {
  symbol: string;
  price: number | null;
  status: AssetSnapshot['status'];
  sourcesUsed: number;
  sourcesTotal: number;
  updatedAt: string | null;
  sources?: { venue: string; market: string; usdPrice: number | null; state: string }[];
}

export interface PricesMessage {
  type: 'prices';
  timestamp: string;
  data: PriceUpdate[];
}

export interface StreamClient {
  symbols: Set<string>;
  /** Include per-source detail in each update */
  detail: boolean;
  send(msg: PricesMessage): void;
}

interface ClientState {
  lastSent: Map<string, string>;
}

function toUpdate(a: AssetSnapshot, detail: boolean): PriceUpdate {
  const u: PriceUpdate = {
    symbol: a.symbol,
    price: a.price,
    status: a.status,
    sourcesUsed: a.sourcesUsed,
    sourcesTotal: a.sourcesTotal,
    updatedAt: a.updatedAt,
  };
  if (detail) {
    u.sources = a.sources.map((s) => ({ venue: s.venue, market: s.market, usdPrice: s.usdPrice, state: s.state }));
  }
  return u;
}

export class PriceStreamHub {
  private clients = new Map<StreamClient, ClientState>();
  private latest = new Map<string, AssetSnapshot>();
  private timestamp = new Date().toISOString();
  private timer: NodeJS.Timeout | null = null;

  constructor(
    private readonly engine: PriceEngine,
    private readonly tickMs: number
  ) {}

  start(): void {
    this.refresh();
    this.timer = setInterval(() => this.tick(), this.tickMs);
    this.timer.unref();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
  }

  get size(): number {
    return this.clients.size;
  }

  /** Normalize and validate requested symbols; returns unknown ones separately */
  parseSymbols(input: string[]): { valid: string[]; unknown: string[] } {
    const known = new Set(this.engine.symbols());
    const valid: string[] = [];
    const unknown: string[] = [];
    for (const raw of input) {
      const s = raw.trim().toUpperCase();
      if (!s) continue;
      if (s === '*' || s === 'ALL') valid.push(...known);
      else (known.has(s) ? valid : unknown).push(s);
    }
    return { valid: [...new Set(valid)], unknown: [...new Set(unknown)] };
  }

  add(client: StreamClient): void {
    // The shared snapshot is only refreshed while clients exist; don't serve a stale one
    this.refresh();
    this.clients.set(client, { lastSent: new Map() });
    this.sendChanges(client, true);
  }

  remove(client: StreamClient): void {
    this.clients.delete(client);
  }

  /** Call after changing a client's symbols; newly added symbols are sent immediately */
  resync(client: StreamClient): void {
    const state = this.clients.get(client);
    if (!state) return;
    for (const sym of state.lastSent.keys()) if (!client.symbols.has(sym)) state.lastSent.delete(sym);
    this.refresh();
    this.sendChanges(client, false);
  }

  private refresh(): void {
    const snap = this.engine.snapshot();
    this.timestamp = snap.timestamp;
    for (const a of snap.assets) this.latest.set(a.symbol, a);
  }

  private tick(): void {
    if (this.clients.size === 0) return;
    this.refresh();
    for (const client of this.clients.keys()) this.sendChanges(client, false);
  }

  private sendChanges(client: StreamClient, force: boolean): void {
    const state = this.clients.get(client);
    if (!state) return;
    const data: PriceUpdate[] = [];
    for (const sym of client.symbols) {
      const a = this.latest.get(sym);
      if (!a) continue;
      const key = `${a.price}|${a.status}|${a.sourcesUsed}`;
      if (!force && state.lastSent.get(sym) === key) continue;
      state.lastSent.set(sym, key);
      data.push(toUpdate(a, client.detail));
    }
    if (data.length > 0 || (force && client.symbols.size > 0)) {
      client.send({ type: 'prices', timestamp: this.timestamp, data });
    }
  }
}
