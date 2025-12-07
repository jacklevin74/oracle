"use strict";
/**
 * Composite Oracle - Aggregates prices from multiple exchanges
 *
 * Supports: Kraken, Coinbase, KuCoin, Binance, MEXC, Bybit, and Hyperliquid
 * - Normalizes to midprice ((bid+ask)/2) when available; else falls back to last trade
 * - Resamples output on a fixed cadence with stale-data detection
 * - Auto-reconnects with jitter and basic heartbeats
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CompositeOracle = void 0;
const ws_1 = __importDefault(require("ws"));
const https = __importStar(require("https"));
const events_1 = require("events");
/** Provider toggles from environment */
const ENABLE_KRAKEN = process.env.ENABLE_KRAKEN !== 'false';
const ENABLE_COINBASE = process.env.ENABLE_COINBASE !== 'false';
const ENABLE_KUCOIN = process.env.ENABLE_KUCOIN !== 'false';
const ENABLE_BINANCE = process.env.ENABLE_BINANCE !== 'false';
const ENABLE_MEXC = process.env.ENABLE_MEXC !== 'false';
const ENABLE_BYBIT = process.env.ENABLE_BYBIT !== 'false';
const ENABLE_HYPERLIQUID = process.env.ENABLE_HYPERLIQUID !== 'false';
/** Configuration */
const PUBLISH_MS = parseInt(process.env.PUBLISH_MS || '1000', 10);
const STALE_MS = parseInt(process.env.STALE_MS || '2000', 10);
const WS_TIMEOUT_MS = 15000;
/**
 * Composite Oracle class
 * Aggregates prices from multiple exchanges and emits composite prices
 */
class CompositeOracle extends events_1.EventEmitter {
    constructor(options = {}) {
        super();
        this.publishTimer = null;
        this.publishMs = options.publishMs || PUBLISH_MS;
        this.staleMs = options.staleMs || STALE_MS;
        this.silent = options.silent || false;
        // Symbol configuration
        this.pairKraken = options.pairKraken || process.env.KRAKEN_SYMBOL || 'BTC/USD';
        this.productCB = options.productCB || process.env.CB_PRODUCT || 'BTC-USD';
        this.symbolKucoin = options.symbolKucoin || process.env.KUCOIN_SYMBOL || 'BTC-USDT';
        this.symbolBinance = options.symbolBinance || process.env.BINANCE_SYMBOL || 'btcusdt';
        this.symbolBybit = options.symbolBybit || process.env.BYBIT_SYMBOL || 'BTCUSDT';
        this.coinHyperliquid = options.coinHyperliquid || process.env.HYPERLIQUID_COIN || null;
        this.enableHyperliquid = !!options.coinHyperliquid;
        this.latest = {
            kraken: null,
            coinbase: null,
            kucoin: null,
            binance: null,
            mexc: null,
            bybit: null,
            hyperliquid: null,
        };
        this.connections = {
            kraken: { ws: null, hbTimer: null },
            coinbase: { ws: null, hbTimer: null },
            kucoin: { ws: null, hbTimer: null },
            binance: { ws: null, hbTimer: null },
            mexc: { ws: null, hbTimer: null, proto: null },
            bybit: { ws: null, hbTimer: null },
            hyperliquid: { ws: null, hbTimer: null },
        };
    }
    log(...args) {
        if (!this.silent)
            console.log(...args);
    }
    logError(...args) {
        if (!this.silent)
            console.error(...args);
    }
    setLatest(name, price) {
        if (Number.isFinite(price)) {
            this.latest[name] = { price, ts: Date.now() };
        }
    }
    nowISO() {
        return new Date().toISOString();
    }
    /** Kraken v2 WebSocket connection */
    krakenConnect() {
        const url = 'wss://ws.kraken.com/v2';
        const conn = this.connections.kraken;
        const sub = () => {
            var _a;
            const msg = {
                method: 'subscribe',
                params: {
                    channel: 'ticker',
                    symbol: [this.pairKraken],
                    snapshot: true,
                },
            };
            (_a = conn.ws) === null || _a === void 0 ? void 0 : _a.send(JSON.stringify(msg));
        };
        const open = () => {
            conn.ws = new ws_1.default(url);
            conn.ws.on('open', () => {
                this.log(this.nowISO(), '[KRAKEN] Connected to', url);
                sub();
                heartbeat();
            });
            conn.ws.on('message', (raw) => {
                let m;
                try {
                    m = JSON.parse(raw.toString());
                }
                catch (e) {
                    this.logError(this.nowISO(), '[KRAKEN] Parse error:', e.message);
                    return;
                }
                if (m && m.channel === 'ticker' && Array.isArray(m.data)) {
                    const t = m.data[0];
                    if (!t)
                        return;
                    const hasBbo = Number.isFinite(t.bid) && Number.isFinite(t.ask);
                    const price = hasBbo ? (t.bid + t.ask) / 2 : Number.isFinite(t.last) ? t.last : null;
                    if (price !== null)
                        this.setLatest('kraken', price);
                }
            });
            conn.ws.on('close', (code, reason) => {
                this.log(this.nowISO(), '[KRAKEN] Connection closed -', code, reason.toString());
                if (conn.hbTimer)
                    clearInterval(conn.hbTimer);
                retry();
            });
            conn.ws.on('error', (err) => {
                var _a;
                this.logError(this.nowISO(), '[KRAKEN] WebSocket error:', err.message);
                try {
                    (_a = conn.ws) === null || _a === void 0 ? void 0 : _a.close();
                }
                catch (_b) { }
            });
        };
        const heartbeat = () => {
            if (conn.hbTimer)
                clearInterval(conn.hbTimer);
            conn.hbTimer = setInterval(() => {
                try {
                    if (conn.ws && conn.ws.readyState === ws_1.default.OPEN) {
                        conn.ws.ping();
                    }
                }
                catch (_a) { }
            }, WS_TIMEOUT_MS / 3);
        };
        const retry = () => {
            const d = 1000 + Math.floor(Math.random() * 1000);
            setTimeout(open, d);
        };
        open();
    }
    /** Coinbase Advanced Trade WebSocket connection */
    coinbaseConnect() {
        const url = 'wss://advanced-trade-ws.coinbase.com';
        const conn = this.connections.coinbase;
        const sub = () => {
            var _a;
            const msg = {
                type: 'subscribe',
                channel: 'ticker',
                product_ids: [this.productCB],
            };
            (_a = conn.ws) === null || _a === void 0 ? void 0 : _a.send(JSON.stringify(msg));
        };
        const open = () => {
            conn.ws = new ws_1.default(url);
            conn.ws.on('open', () => {
                this.log(this.nowISO(), '[COINBASE] Connected to', url);
                sub();
                heartbeat();
            });
            conn.ws.on('message', (raw) => {
                let m;
                try {
                    m = JSON.parse(raw.toString());
                }
                catch (e) {
                    this.logError(this.nowISO(), '[COINBASE] Parse error:', e.message);
                    return;
                }
                if (!m || m.channel !== 'ticker' || !Array.isArray(m.events))
                    return;
                const ev = m.events[0];
                if (!ev || !Array.isArray(ev.tickers))
                    return;
                const t = ev.tickers.find((x) => x.product_id === this.productCB) || ev.tickers[0];
                if (!t)
                    return;
                const bb = parseFloat(t.best_bid);
                const ba = parseFloat(t.best_ask);
                const px = Number.isFinite(bb) && Number.isFinite(ba) ? (bb + ba) / 2 : parseFloat(t.price);
                if (Number.isFinite(px))
                    this.setLatest('coinbase', px);
            });
            conn.ws.on('close', (code, reason) => {
                this.log(this.nowISO(), '[COINBASE] Connection closed -', code, reason.toString());
                if (conn.hbTimer)
                    clearInterval(conn.hbTimer);
                retry();
            });
            conn.ws.on('error', (err) => {
                var _a;
                this.logError(this.nowISO(), '[COINBASE] WebSocket error:', err.message);
                try {
                    (_a = conn.ws) === null || _a === void 0 ? void 0 : _a.close();
                }
                catch (_b) { }
            });
        };
        const heartbeat = () => {
            if (conn.hbTimer)
                clearInterval(conn.hbTimer);
            conn.hbTimer = setInterval(() => {
                try {
                    if (conn.ws && conn.ws.readyState === ws_1.default.OPEN) {
                        conn.ws.ping();
                    }
                }
                catch (_a) { }
            }, WS_TIMEOUT_MS / 3);
        };
        const retry = () => {
            const d = 1000 + Math.floor(Math.random() * 1000);
            setTimeout(open, d);
        };
        open();
    }
    /** KuCoin WebSocket connection */
    kucoinConnect() {
        const conn = this.connections.kucoin;
        const getToken = (callback) => {
            https
                .request('https://api.kucoin.com/api/v1/bullet-public', { method: 'POST' }, (res) => {
                let data = '';
                res.on('data', (chunk) => (data += chunk));
                res.on('end', () => {
                    try {
                        const json = JSON.parse(data);
                        if (json.code === '200000' && json.data) {
                            const token = json.data.token;
                            const endpoint = json.data.instanceServers[0].endpoint;
                            callback(endpoint, token);
                        }
                        else {
                            this.logError(this.nowISO(), '[KUCOIN] Token error:', json);
                            retryGetToken();
                        }
                    }
                    catch (e) {
                        this.logError(this.nowISO(), '[KUCOIN] Parse error:', e.message);
                        retryGetToken();
                    }
                });
            })
                .on('error', (err) => {
                this.logError(this.nowISO(), '[KUCOIN] Token request error:', err.message);
                retryGetToken();
            })
                .end();
        };
        const retryGetToken = () => {
            const d = 1000 + Math.floor(Math.random() * 1000);
            setTimeout(() => getToken(openWs), d);
        };
        const openWs = (endpoint, token) => {
            const url = `${endpoint}?token=${token}`;
            const sub = () => {
                var _a;
                const msg = {
                    id: Date.now(),
                    type: 'subscribe',
                    topic: `/market/ticker:${this.symbolKucoin}`,
                    privateChannel: false,
                    response: true,
                };
                (_a = conn.ws) === null || _a === void 0 ? void 0 : _a.send(JSON.stringify(msg));
            };
            conn.ws = new ws_1.default(url);
            conn.ws.on('open', () => {
                this.log(this.nowISO(), '[KUCOIN] Connected to', url.split('?')[0]);
                sub();
                heartbeat();
            });
            conn.ws.on('message', (raw) => {
                let m;
                try {
                    m = JSON.parse(raw.toString());
                }
                catch (e) {
                    this.logError(this.nowISO(), '[KUCOIN] Parse error:', e.message);
                    return;
                }
                if (m && m.type === 'message' && m.topic === `/market/ticker:${this.symbolKucoin}` && m.data) {
                    const d = m.data;
                    const bb = parseFloat(d.bestBid);
                    const ba = parseFloat(d.bestAsk);
                    const price = Number.isFinite(bb) && Number.isFinite(ba) ? (bb + ba) / 2 : parseFloat(d.price);
                    if (Number.isFinite(price))
                        this.setLatest('kucoin', price);
                }
            });
            conn.ws.on('close', (code, reason) => {
                this.log(this.nowISO(), '[KUCOIN] Connection closed -', code, reason.toString());
                if (conn.hbTimer)
                    clearInterval(conn.hbTimer);
                retryGetToken();
            });
            conn.ws.on('error', (err) => {
                var _a;
                this.logError(this.nowISO(), '[KUCOIN] WebSocket error:', err.message);
                try {
                    (_a = conn.ws) === null || _a === void 0 ? void 0 : _a.close();
                }
                catch (_b) { }
            });
            const heartbeat = () => {
                if (conn.hbTimer)
                    clearInterval(conn.hbTimer);
                conn.hbTimer = setInterval(() => {
                    try {
                        if (conn.ws && conn.ws.readyState === ws_1.default.OPEN) {
                            conn.ws.send(JSON.stringify({ id: Date.now(), type: 'ping' }));
                        }
                    }
                    catch (_a) { }
                }, WS_TIMEOUT_MS / 3);
            };
        };
        getToken(openWs);
    }
    /** Binance WebSocket connection */
    binanceConnect() {
        const url = `wss://stream.binance.com:9443/ws/${this.symbolBinance}@bookTicker`;
        const conn = this.connections.binance;
        const open = () => {
            conn.ws = new ws_1.default(url);
            conn.ws.on('open', () => {
                this.log(this.nowISO(), '[BINANCE] Connected to', url);
                heartbeat();
            });
            conn.ws.on('message', (raw) => {
                let m;
                try {
                    m = JSON.parse(raw.toString());
                }
                catch (e) {
                    this.logError(this.nowISO(), '[BINANCE] Parse error:', e.message);
                    return;
                }
                if (m && m.s && m.b && m.a) {
                    const bb = parseFloat(m.b);
                    const ba = parseFloat(m.a);
                    if (Number.isFinite(bb) && Number.isFinite(ba)) {
                        const price = (bb + ba) / 2;
                        this.setLatest('binance', price);
                    }
                }
            });
            conn.ws.on('close', (code, reason) => {
                this.log(this.nowISO(), '[BINANCE] Connection closed -', code, reason.toString());
                if (conn.hbTimer)
                    clearInterval(conn.hbTimer);
                retry();
            });
            conn.ws.on('error', (err) => {
                var _a;
                this.logError(this.nowISO(), '[BINANCE] WebSocket error:', err.message);
                try {
                    (_a = conn.ws) === null || _a === void 0 ? void 0 : _a.close();
                }
                catch (_b) { }
            });
        };
        const heartbeat = () => {
            if (conn.hbTimer)
                clearInterval(conn.hbTimer);
            conn.hbTimer = setInterval(() => {
                try {
                    if (conn.ws && conn.ws.readyState === ws_1.default.OPEN) {
                        conn.ws.ping();
                    }
                }
                catch (_a) { }
            }, WS_TIMEOUT_MS / 3);
        };
        const retry = () => {
            const d = 1000 + Math.floor(Math.random() * 1000);
            setTimeout(open, d);
        };
        open();
    }
    /** MEXC WebSocket connection (protobuf-based) */
    mexcConnect() {
        // MEXC protobuf implementation skipped for now
        // Would require protobufjs and proto file setup
        this.log(this.nowISO(), '[MEXC] Protobuf connection not yet implemented in TypeScript');
    }
    /** Bybit WebSocket connection */
    bybitConnect() {
        const url = 'wss://stream.bybit.com/v5/public/spot';
        const conn = this.connections.bybit;
        const sub = () => {
            var _a;
            const msg = {
                op: 'subscribe',
                args: [`tickers.${this.symbolBybit}`],
            };
            (_a = conn.ws) === null || _a === void 0 ? void 0 : _a.send(JSON.stringify(msg));
        };
        const open = () => {
            conn.ws = new ws_1.default(url);
            conn.ws.on('open', () => {
                this.log(this.nowISO(), '[BYBIT] Connected to', url);
                sub();
                heartbeat();
            });
            conn.ws.on('message', (raw) => {
                var _a;
                let m;
                try {
                    m = JSON.parse(raw.toString());
                }
                catch (e) {
                    this.logError(this.nowISO(), '[BYBIT] Parse error:', e.message);
                    return;
                }
                // Handle ping/pong
                if (m && m.op === 'ping') {
                    try {
                        (_a = conn.ws) === null || _a === void 0 ? void 0 : _a.send(JSON.stringify({ op: 'pong', req_id: m.req_id }));
                    }
                    catch (_b) { }
                    return;
                }
                // Handle ticker data
                if (m && m.topic && m.topic.startsWith('tickers.') && m.data) {
                    const t = m.data;
                    const bb = parseFloat(t.bid1Price);
                    const ba = parseFloat(t.ask1Price);
                    const price = Number.isFinite(bb) && Number.isFinite(ba) ? (bb + ba) / 2 : parseFloat(t.lastPrice);
                    if (Number.isFinite(price))
                        this.setLatest('bybit', price);
                }
            });
            conn.ws.on('close', (code, reason) => {
                this.log(this.nowISO(), '[BYBIT] Connection closed -', code, reason.toString());
                if (conn.hbTimer)
                    clearInterval(conn.hbTimer);
                retry();
            });
            conn.ws.on('error', (err) => {
                var _a;
                this.logError(this.nowISO(), '[BYBIT] WebSocket error:', err.message);
                try {
                    (_a = conn.ws) === null || _a === void 0 ? void 0 : _a.close();
                }
                catch (_b) { }
            });
        };
        const heartbeat = () => {
            if (conn.hbTimer)
                clearInterval(conn.hbTimer);
            conn.hbTimer = setInterval(() => {
                try {
                    if (conn.ws && conn.ws.readyState === ws_1.default.OPEN) {
                        conn.ws.ping();
                    }
                }
                catch (_a) { }
            }, WS_TIMEOUT_MS / 3);
        };
        const retry = () => {
            const d = 1000 + Math.floor(Math.random() * 1000);
            setTimeout(open, d);
        };
        open();
    }
    /** Hyperliquid WebSocket connection */
    hyperliquidConnect() {
        const url = 'wss://api.hyperliquid.xyz/ws';
        const conn = this.connections.hyperliquid;
        const sub = () => {
            var _a;
            const msg = {
                method: 'subscribe',
                subscription: {
                    type: 'l2Book',
                    coin: this.coinHyperliquid,
                },
            };
            (_a = conn.ws) === null || _a === void 0 ? void 0 : _a.send(JSON.stringify(msg));
        };
        const open = () => {
            conn.ws = new ws_1.default(url);
            conn.ws.on('open', () => {
                this.log(this.nowISO(), '[HYPERLIQUID] Connected to', url);
                sub();
                heartbeat();
            });
            conn.ws.on('message', (raw) => {
                let m;
                try {
                    m = JSON.parse(raw.toString());
                }
                catch (e) {
                    this.logError(this.nowISO(), '[HYPERLIQUID] Parse error:', e.message);
                    return;
                }
                // Handle l2Book data
                if (m && m.channel === 'l2Book' && m.data && m.data.coin === this.coinHyperliquid) {
                    const book = m.data;
                    // book.levels is [bids[], asks[]] where each entry is {px, sz, n}
                    if (book.levels && book.levels.length >= 2) {
                        const bids = book.levels[0];
                        const asks = book.levels[1];
                        if (bids.length > 0 && asks.length > 0) {
                            const bestBid = parseFloat(bids[0].px);
                            const bestAsk = parseFloat(asks[0].px);
                            if (Number.isFinite(bestBid) && Number.isFinite(bestAsk)) {
                                const price = (bestBid + bestAsk) / 2;
                                this.setLatest('hyperliquid', price);
                            }
                        }
                    }
                }
            });
            conn.ws.on('close', (code, reason) => {
                this.log(this.nowISO(), '[HYPERLIQUID] Connection closed -', code, reason.toString());
                if (conn.hbTimer)
                    clearInterval(conn.hbTimer);
                retry();
            });
            conn.ws.on('error', (err) => {
                var _a;
                this.logError(this.nowISO(), '[HYPERLIQUID] WebSocket error:', err.message);
                try {
                    (_a = conn.ws) === null || _a === void 0 ? void 0 : _a.close();
                }
                catch (_b) { }
            });
        };
        const heartbeat = () => {
            if (conn.hbTimer)
                clearInterval(conn.hbTimer);
            conn.hbTimer = setInterval(() => {
                try {
                    if (conn.ws && conn.ws.readyState === ws_1.default.OPEN) {
                        conn.ws.ping();
                    }
                }
                catch (_a) { }
            }, WS_TIMEOUT_MS / 3);
        };
        const retry = () => {
            const d = 1000 + Math.floor(Math.random() * 1000);
            setTimeout(open, d);
        };
        open();
    }
    /** Calculate robust composite price using median filtering */
    robustComposite(rows) {
        var _a;
        const now = Date.now();
        const fresh = rows.filter((r) => r && now - r.ts <= this.staleMs);
        if (fresh.length === 0)
            return { price: null, count: 0 };
        const prices = fresh.map((r) => r.price).sort((a, b) => a - b);
        const median = prices[Math.floor(prices.length / 2)];
        if (median === undefined)
            return { price: null, count: 0 };
        const tol = 0.005;
        const kept = prices.filter((p) => Math.abs(p - median) / median <= tol);
        const med2 = kept.length ? (_a = kept[Math.floor(kept.length / 2)]) !== null && _a !== void 0 ? _a : median : median;
        return { price: med2, count: fresh.length };
    }
    /** Get current composite price with all source data */
    getComposite() {
        const rows = [
            this.latest.kraken ? Object.assign({ src: 'kraken' }, this.latest.kraken) : null,
            this.latest.coinbase ? Object.assign({ src: 'coinbase' }, this.latest.coinbase) : null,
            this.latest.kucoin ? Object.assign({ src: 'kucoin' }, this.latest.kucoin) : null,
            this.latest.binance ? Object.assign({ src: 'binance' }, this.latest.binance) : null,
            this.latest.mexc ? Object.assign({ src: 'mexc' }, this.latest.mexc) : null,
            this.latest.bybit ? Object.assign({ src: 'bybit' }, this.latest.bybit) : null,
            this.latest.hyperliquid ? Object.assign({ src: 'hyperliquid' }, this.latest.hyperliquid) : null,
        ].filter((x) => x !== null);
        const comp = this.robustComposite(rows);
        return {
            composite: comp.price,
            count: comp.count,
            sources: rows.map((r) => ({
                source: r.src,
                price: r.price,
                age: Date.now() - r.ts,
            })),
        };
    }
    /** Start all oracle feeds and begin publishing */
    start() {
        if (ENABLE_KRAKEN) {
            this.log(this.nowISO(), '🚀 Starting Kraken feed...');
            this.krakenConnect();
        }
        else {
            this.log(this.nowISO(), '⏸️  Kraken feed disabled');
        }
        if (ENABLE_COINBASE) {
            this.log(this.nowISO(), '🚀 Starting Coinbase feed...');
            this.coinbaseConnect();
        }
        else {
            this.log(this.nowISO(), '⏸️  Coinbase feed disabled');
        }
        if (ENABLE_KUCOIN) {
            this.log(this.nowISO(), '🚀 Starting KuCoin feed...');
            this.kucoinConnect();
        }
        else {
            this.log(this.nowISO(), '⏸️  KuCoin feed disabled');
        }
        if (ENABLE_BINANCE) {
            this.log(this.nowISO(), '🚀 Starting Binance feed...');
            this.binanceConnect();
        }
        else {
            this.log(this.nowISO(), '⏸️  Binance feed disabled');
        }
        if (ENABLE_MEXC) {
            this.log(this.nowISO(), '🚀 Starting MEXC feed...');
            this.mexcConnect();
        }
        else {
            this.log(this.nowISO(), '⏸️  MEXC feed disabled');
        }
        if (ENABLE_BYBIT) {
            this.log(this.nowISO(), '🚀 Starting Bybit feed...');
            this.bybitConnect();
        }
        else {
            this.log(this.nowISO(), '⏸️  Bybit feed disabled');
        }
        // Only start Hyperliquid if a coin was explicitly specified
        if (ENABLE_HYPERLIQUID && this.enableHyperliquid && this.coinHyperliquid) {
            this.log(this.nowISO(), '🚀 Starting Hyperliquid feed...');
            this.hyperliquidConnect();
        }
        // Start publisher loop
        this.publishTimer = setInterval(() => {
            const result = this.getComposite();
            this.emit('price', result);
        }, this.publishMs);
    }
    /** Stop all oracle feeds */
    stop() {
        if (this.publishTimer) {
            clearInterval(this.publishTimer);
        }
        for (const conn of Object.values(this.connections)) {
            if (conn.hbTimer)
                clearInterval(conn.hbTimer);
            if (conn.ws) {
                try {
                    conn.ws.close();
                }
                catch (_a) { }
            }
        }
    }
}
exports.CompositeOracle = CompositeOracle;
