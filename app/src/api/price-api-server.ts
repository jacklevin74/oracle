#!/usr/bin/env node
/**
 * Public Price API
 *
 * Standalone HTTP service that lets users query current prices for all
 * supported assets. Prices come only from exchange websocket streams
 * (see src/feeds); no REST polling, no Pyth, no private keys, no blockchain.
 *
 * Endpoints:
 *   GET /                     - live status page (prices + per-source detail)
 *   GET /health               - service status
 *   GET /v1/tokens            - list of supported symbols
 *   GET /v1/prices            - latest prices for all assets, with sources
 *   GET /v1/prices/:symbol    - latest price for one asset (case-insensitive)
 *   GET /v1/stream            - SSE stream of the full snapshot (used by the status page)
 *   GET /v1/stream/prices     - SSE stream of chosen assets: ?symbols=BTC,ETH[&detail=true]
 *   WS  /v1/ws                - WebSocket stream with subscribe/unsubscribe messages
 */

import { IncomingMessage } from 'http';
import path from 'path';
import express, { Request, Response, NextFunction } from 'express';
import WebSocket, { WebSocketServer } from 'ws';
import { EngineSnapshot, PriceEngine } from '../feeds/price-engine';
import { PricesMessage, PriceStreamHub, StreamClient } from './price-stream-hub';

// '::' listens on IPv6 and IPv4, so localhost works whichever address the browser picks
const HOST = process.env.API_HOST || '::';
const PORT = Number(process.env.API_PORT || 8080);
const STALE_MS = Number(process.env.API_STALE_MS || 60_000);
const STREAM_INTERVAL_MS = Number(process.env.API_STREAM_INTERVAL_MS || 1000);
const RATE_LIMIT_PER_MIN = Number(process.env.API_RATE_LIMIT_PER_MIN || 600);
const MAX_STREAM_CLIENTS = Number(process.env.API_MAX_STREAM_CLIENTS || 500);
const MAX_STREAMS_PER_IP = Number(process.env.API_MAX_STREAMS_PER_IP || 20);
const USER_STREAM_TICK_MS = Number(process.env.API_USER_STREAM_TICK_MS || 250);
const HEARTBEAT_MS = 15_000;
/** Drop clients that fall this far behind instead of buffering without bound */
const MAX_BUFFERED_BYTES = 1_000_000;
const STATUS_PAGE = path.join(__dirname, '../../public/status.html');

const engine = new PriceEngine(undefined, STALE_MS);
const hub = new PriceStreamHub(engine, USER_STREAM_TICK_MS);
const startedAt = Date.now();

/**
 * Stream connection accounting across SSE and WebSocket, globally and per IP
 */
const streamsByIp = new Map<string, number>();
let streamCount = 0;
function acquireStream(ip: string): string | null {
  if (streamCount >= MAX_STREAM_CLIENTS) return 'too many stream clients';
  if ((streamsByIp.get(ip) ?? 0) >= MAX_STREAMS_PER_IP) return `limit of ${MAX_STREAMS_PER_IP} streams per IP reached`;
  streamCount++;
  streamsByIp.set(ip, (streamsByIp.get(ip) ?? 0) + 1);
  return null;
}
function releaseStream(ip: string): void {
  streamCount--;
  const n = (streamsByIp.get(ip) ?? 1) - 1;
  if (n <= 0) streamsByIp.delete(ip);
  else streamsByIp.set(ip, n);
}
function clientIp(req: IncomingMessage): string {
  const fwd = req.headers['x-forwarded-for'];
  if (process.env.API_TRUST_PROXY && typeof fwd === 'string') return fwd.split(',')[0]!.trim();
  return req.socket.remoteAddress ?? 'unknown';
}

/**
 * Simple fixed-window per-IP rate limiter
 */
const hits = new Map<string, { count: number; windowStart: number }>();
function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip || 'unknown';
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || now - entry.windowStart >= 60_000) {
    hits.set(ip, { count: 1, windowStart: now });
    return next();
  }
  entry.count++;
  if (entry.count > RATE_LIMIT_PER_MIN) {
    res.status(429).json({ error: 'rate limit exceeded' });
    return;
  }
  next();
}
setInterval(() => {
  const cutoff = Date.now() - 60_000;
  for (const [ip, e] of hits) if (e.windowStart < cutoff) hits.delete(ip);
}, 60_000).unref();

const app = express();
app.disable('x-powered-by');
if (process.env.API_TRUST_PROXY) app.set('trust proxy', process.env.API_TRUST_PROXY);

app.use((_req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Cache-Control', 'no-store');
  next();
});
app.use(rateLimit);

app.get('/', (_req, res) => {
  res.sendFile(STATUS_PAGE);
});

app.get('/health', (_req, res) => {
  const { assets, feeds } = engine.snapshot();
  const priced = assets.filter((a) => a.price !== null).length;
  res.status(priced > 0 ? 200 : 503).json({
    status: priced === assets.length ? 'ok' : priced > 0 ? 'degraded' : 'warming_up',
    uptimeSec: Math.floor((Date.now() - startedAt) / 1000),
    assets: assets.length,
    assetsPriced: priced,
    assetsBelowMinSources: assets.filter((a) => a.status !== 'ok').map((a) => a.symbol),
    feedsConnected: feeds.filter((f) => f.connected).length,
    feedsTotal: feeds.length,
  });
});

app.get('/v1/tokens', (_req, res) => {
  res.json({ tokens: engine.symbols() });
});

app.get('/v1/prices', (_req, res) => {
  const { timestamp, assets } = engine.snapshot();
  res.json({ timestamp, prices: assets });
});

app.get('/v1/prices/:symbol', (req, res) => {
  const symbol = String(req.params.symbol).toUpperCase();
  const asset = engine.snapshot().assets.find((a) => a.symbol === symbol);
  if (!asset) {
    res.status(404).json({ error: `unknown token '${req.params.symbol}'` });
    return;
  }
  res.json(asset);
});

/**
 * One snapshot per interval, broadcast to every SSE client
 */
const streamClients = new Set<Response>();
let lastSnapshot: EngineSnapshot | null = null;
setInterval(() => {
  if (streamClients.size === 0) return;
  lastSnapshot = engine.snapshot();
  const frame = `data: ${JSON.stringify(lastSnapshot)}\n\n`;
  for (const client of streamClients) client.write(frame);
}, STREAM_INTERVAL_MS).unref();

function openSse(res: Response): void {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();
}

app.get('/v1/stream', (req, res) => {
  const ip = clientIp(req);
  const denied = acquireStream(ip);
  if (denied) {
    res.status(503).json({ error: denied });
    return;
  }
  openSse(res);
  res.write(`retry: 3000\ndata: ${JSON.stringify(lastSnapshot ?? engine.snapshot())}\n\n`);
  streamClients.add(res);
  req.on('close', () => {
    streamClients.delete(res);
    releaseStream(ip);
  });
});

/**
 * SSE stream of user-chosen assets. Sends every chosen asset on connect,
 * then only assets whose price or status changed, batched per tick.
 */
app.get('/v1/stream/prices', (req, res) => {
  const requested = String(req.query.symbols ?? '').split(',');
  const { valid, unknown } = hub.parseSymbols(requested);
  if (unknown.length > 0 || valid.length === 0) {
    res.status(400).json({
      error: unknown.length ? `unknown symbols: ${unknown.join(', ')}` : 'pass ?symbols=BTC,ETH (or ?symbols=all)',
      available: engine.symbols(),
    });
    return;
  }
  const ip = clientIp(req);
  const denied = acquireStream(ip);
  if (denied) {
    res.status(503).json({ error: denied });
    return;
  }

  openSse(res);
  res.write('retry: 3000\n\n');
  const client: StreamClient = {
    symbols: new Set(valid),
    detail: req.query.detail === 'true',
    send: (msg: PricesMessage) => {
      if (res.writableLength > MAX_BUFFERED_BYTES) {
        res.destroy();
        return;
      }
      res.write(`data: ${JSON.stringify(msg)}\n\n`);
    },
  };
  hub.add(client);
  const heartbeat = setInterval(() => res.write(': ping\n\n'), HEARTBEAT_MS);
  req.on('close', () => {
    clearInterval(heartbeat);
    hub.remove(client);
    releaseStream(ip);
  });
});

app.use((_req, res) => {
  res.status(404).json({ error: 'not found' });
});

async function shutdown() {
  console.log('[Price API] Shutting down...');
  hub.stop();
  engine.stop();
  process.exit(0);
}

/**
 * WebSocket stream. Clients may pass ?symbols= and ?detail=true on connect,
 * then send JSON messages:
 *   {"op":"subscribe","symbols":["BTC","ETH"]}   add assets ("all" for every asset)
 *   {"op":"unsubscribe","symbols":["ETH"]}       remove assets
 *   {"op":"list"}                                 current subscription + available symbols
 *   {"op":"ping"}                                 → {"type":"pong"}
 * Server messages: welcome, subscribed, prices, pong, error.
 */
const wss = new WebSocketServer({ noServer: true, maxPayload: 4096 });

wss.on('connection', (ws: WebSocket, req: IncomingMessage, ip: string) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  const reply = (msg: object) => {
    if (ws.readyState !== WebSocket.OPEN) return;
    if (ws.bufferedAmount > MAX_BUFFERED_BYTES) {
      ws.terminate();
      return;
    }
    ws.send(JSON.stringify(msg));
  };
  const client: StreamClient = {
    symbols: new Set(),
    detail: url.searchParams.get('detail') === 'true',
    send: reply,
  };
  const subscribed = () => reply({ type: 'subscribed', symbols: [...client.symbols] });

  reply({ type: 'welcome', available: engine.symbols(), subscribed: [] });

  const initial = url.searchParams.get('symbols');
  if (initial) {
    const { valid, unknown } = hub.parseSymbols(initial.split(','));
    if (unknown.length) reply({ type: 'error', message: `unknown symbols: ${unknown.join(', ')}` });
    valid.forEach((s) => client.symbols.add(s));
    subscribed();
  }
  hub.add(client);

  let alive = true;
  ws.on('pong', () => (alive = true));
  const heartbeat = setInterval(() => {
    if (!alive) return ws.terminate();
    alive = false;
    ws.ping();
  }, HEARTBEAT_MS * 2);

  ws.on('message', (raw) => {
    let msg: { op?: string; symbols?: unknown };
    try {
      msg = JSON.parse(raw.toString());
    } catch {
      return reply({ type: 'error', message: 'invalid JSON' });
    }
    const symbols = Array.isArray(msg.symbols) ? msg.symbols.map(String) : [];
    switch (msg.op) {
      case 'subscribe': {
        const { valid, unknown } = hub.parseSymbols(symbols);
        if (unknown.length) reply({ type: 'error', message: `unknown symbols: ${unknown.join(', ')}` });
        valid.forEach((s) => client.symbols.add(s));
        subscribed();
        hub.resync(client);
        break;
      }
      case 'unsubscribe': {
        hub.parseSymbols(symbols).valid.forEach((s) => client.symbols.delete(s));
        subscribed();
        hub.resync(client);
        break;
      }
      case 'list':
        reply({ type: 'subscribed', symbols: [...client.symbols], available: engine.symbols() });
        break;
      case 'ping':
        reply({ type: 'pong' });
        break;
      default:
        reply({ type: 'error', message: 'unknown op; use subscribe, unsubscribe, list or ping' });
    }
  });

  ws.on('close', () => {
    clearInterval(heartbeat);
    hub.remove(client);
    releaseStream(ip);
  });
});

async function main() {
  console.log('[Price API] Starting exchange price streams...');
  engine.start();
  hub.start();
  const server = app.listen(PORT, HOST, () => {
    console.log(`[Price API] Listening on port ${PORT} — status page: http://localhost:${PORT}/`);
  });

  server.on('upgrade', (req, socket, head) => {
    const { pathname } = new URL(req.url ?? '/', 'http://localhost');
    if (pathname !== '/v1/ws') {
      socket.write('HTTP/1.1 404 Not Found\r\n\r\n');
      socket.destroy();
      return;
    }
    const ip = clientIp(req);
    const denied = acquireStream(ip);
    if (denied) {
      socket.write(`HTTP/1.1 503 Service Unavailable\r\nContent-Type: text/plain\r\n\r\n${denied}`);
      socket.destroy();
      return;
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req, ip));
  });
}

process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

main().catch((err) => {
  console.error('[Price API] Fatal error:', err);
  process.exit(1);
});
