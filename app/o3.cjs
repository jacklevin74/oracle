// composite_ws.js
// Node 16+ (CommonJS)
// Composite price from Kraken v2, Coinbase Advanced Trade, KuCoin Spot, Binance, MEXC, Bybit, and Hyperliquid.
// - Normalizes to midprice ( (bid+ask)/2 ) when available; else falls back to last trade.
// - Resamples output on a fixed cadence with stale-data detection.
// - Auto-reconnects with jitter and basic heartbeats (where relevant).
// - Can be used as a module or standalone script

const WebSocket = require('ws');
const https = require('https');
const protobuf = require('protobufjs');
const EventEmitter = require('events');

/** ---------- ANSI Color Codes ---------- **/
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',

  // Foreground colors
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  blue: '\x1b[34m',
  magenta: '\x1b[35m',
  gray: '\x1b[90m',
  white: '\x1b[37m',
  red: '\x1b[31m',

  // Bright colors
  brightCyan: '\x1b[96m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
  brightMagenta: '\x1b[95m'
};

/** ---------- Config ---------- **/
const PUBLISH_MS    = parseInt(process.env.PUBLISH_MS || '1000', 10);   // composite cadence
const STALE_MS      = parseInt(process.env.STALE_MS   || '2000', 10);   // stale threshold
const WS_TIMEOUT_MS = 15000; // ping/pong timeout where applicable

/** ---------- Provider Toggles ---------- **/
const ENABLE_KRAKEN      = process.env.ENABLE_KRAKEN      !== 'false'; // default: enabled
const ENABLE_COINBASE    = process.env.ENABLE_COINBASE    !== 'false'; // default: enabled
const ENABLE_KUCOIN      = process.env.ENABLE_KUCOIN      !== 'false'; // default: enabled
const ENABLE_BINANCE     = process.env.ENABLE_BINANCE     !== 'false'; // default: enabled
const ENABLE_MEXC        = process.env.ENABLE_MEXC        !== 'false'; // default: enabled
const ENABLE_BYBIT       = process.env.ENABLE_BYBIT       !== 'false'; // default: enabled
const ENABLE_HYPERLIQUID = process.env.ENABLE_HYPERLIQUID !== 'false'; // default: enabled

/** ---------- CompositeOracle class ---------- **/
class CompositeOracle extends EventEmitter {
  constructor(options = {}) {
    super();
    this.publishMs = options.publishMs || PUBLISH_MS;
    this.staleMs = options.staleMs || STALE_MS;
    this.silent = options.silent || false; // suppress console output

    // Symbol configuration - accept from options or use defaults
    this.pairKraken = options.pairKraken || process.env.KRAKEN_SYMBOL || 'BTC/USD';
    this.productCB = options.productCB || process.env.CB_PRODUCT || 'BTC-USD';
    this.symbolKucoin = options.symbolKucoin || process.env.KUCOIN_SYMBOL || 'BTC-USDT';
    this.symbolBinance = options.symbolBinance || process.env.BINANCE_SYMBOL || 'btcusdt';
    this.symbolMexc = options.symbolMexc || process.env.MEXC_SYMBOL || 'BTCUSDT';
    this.symbolBybit = options.symbolBybit || process.env.BYBIT_SYMBOL || 'BTCUSDT';
    this.coinHyperliquid = options.coinHyperliquid || process.env.HYPERLIQUID_COIN || null;
    this.enableHyperliquid = !!options.coinHyperliquid; // Only enable if explicitly set

    this.latest = {
      kraken:  null, // { price, ts }
      coinbase:null,
      kucoin:  null,
      binance: null,
      mexc:    null,
      bybit:   null,
      hyperliquid: null
    };

    this.publishTimer = null;
    this.connections = {
      kraken: { ws: null, hbTimer: null },
      coinbase: { ws: null, hbTimer: null },
      kucoin: { ws: null, hbTimer: null },
      binance: { ws: null, hbTimer: null },
      mexc: { ws: null, hbTimer: null, proto: null },
      bybit: { ws: null, hbTimer: null },
      hyperliquid: { ws: null, hbTimer: null }
    };
  }

  log(...args) {
    if (!this.silent) console.log(...args);
  }

  logError(...args) {
    if (!this.silent) console.error(...args);
  }

  setLatest(name, price) {
    if (Number.isFinite(price)) {
      this.latest[name] = { price, ts: Date.now() };
    }
  }

  nowISO() {
    return new Date().toISOString();
  }

  /** ---------- Kraken v2 (ticker) ---------- **/
  krakenConnect(){
    const url = 'wss://ws.kraken.com/v2';
    const conn = this.connections.kraken;

    const sub = () => {
      const msg = {
        method: 'subscribe',
        params: {
          channel: 'ticker',
          symbol: [this.pairKraken],
          snapshot: true
        }
      };
      conn.ws.send(JSON.stringify(msg));
    };

    const open = () => {
      conn.ws = new WebSocket(url);
      conn.ws.on('open', () => {
        this.log(this.nowISO(), '[KRAKEN] Connected to', url);
        sub();
        heartbeat();
      });
      conn.ws.on('message', raw => {
        let m; try{ m = JSON.parse(raw); } catch(e){
          this.logError(this.nowISO(), '[KRAKEN] Parse error:', e.message);
          return;
        }

        if (m && m.channel === 'ticker' && Array.isArray(m.data)){
          const t = m.data[0];
          if (!t) return;
          const hasBbo = Number.isFinite(t.bid) && Number.isFinite(t.ask);
          const price = hasBbo ? (t.bid + t.ask)/2
                      : (Number.isFinite(t.last) ? t.last : null);
          if (price != null) this.setLatest('kraken', price);
        }
      });
      conn.ws.on('close', (code, reason) => {
        this.log(this.nowISO(), '[KRAKEN] Connection closed -', code, reason.toString());
        clearInterval(conn.hbTimer);
        retry();
      });
      conn.ws.on('error', (err) => {
        this.logError(this.nowISO(), '[KRAKEN] WebSocket error:', err.message);
        try{ conn.ws.close(); }catch{}
      });
    };

    const heartbeat = () => {
      clearInterval(conn.hbTimer);
      conn.hbTimer = setInterval(() => {
        try{
          if (conn.ws && conn.ws.readyState === WebSocket.OPEN) conn.ws.ping();
        }catch{}
      }, WS_TIMEOUT_MS/3);
    };

    const retry = () => {
      const d = 1000 + Math.floor(Math.random()*1000);
      setTimeout(open, d);
    };

    open();
  }

  /** ---------- Coinbase Advanced Trade (ticker) ---------- **/
  coinbaseConnect(){
    const url = 'wss://advanced-trade-ws.coinbase.com';
    const conn = this.connections.coinbase;

    const sub = () => {
      const msg = {
        type: 'subscribe',
        channel: 'ticker',
        product_ids: [this.productCB]
      };
      conn.ws.send(JSON.stringify(msg));
    };

    const open = () => {
      conn.ws = new WebSocket(url);
      conn.ws.on('open', () => {
        this.log(this.nowISO(), '[COINBASE] Connected to', url);
        sub();
        heartbeat();
      });
      conn.ws.on('message', raw => {
        let m; try{ m = JSON.parse(raw); } catch(e){
          this.logError(this.nowISO(), '[COINBASE] Parse error:', e.message);
          return;
        }
        if (!m || m.channel !== 'ticker' || !Array.isArray(m.events)) return;

        const ev = m.events[0];
        if (!ev || !Array.isArray(ev.tickers)) return;
        const t = ev.tickers.find(x => x.product_id === this.productCB) || ev.tickers[0];
        if (!t) return;

        const bb = parseFloat(t.best_bid);
        const ba = parseFloat(t.best_ask);
        const px = (Number.isFinite(bb) && Number.isFinite(ba))
                    ? (bb+ba)/2
                    : parseFloat(t.price);
        if (Number.isFinite(px)) this.setLatest('coinbase', px);
      });
      conn.ws.on('close', (code, reason) => {
        this.log(this.nowISO(), '[COINBASE] Connection closed -', code, reason.toString());
        clearInterval(conn.hbTimer);
        retry();
      });
      conn.ws.on('error', (err) => {
        this.logError(this.nowISO(), '[COINBASE] WebSocket error:', err.message);
        try{ conn.ws.close(); }catch{}
      });
    };

    const heartbeat = () => {
      clearInterval(conn.hbTimer);
      conn.hbTimer = setInterval(() => {
        try{
          if (conn.ws && conn.ws.readyState === WebSocket.OPEN) conn.ws.ping();
        }catch{}
      }, WS_TIMEOUT_MS/3);
    };

    const retry = () => {
      const d = 1000 + Math.floor(Math.random()*1000);
      setTimeout(open, d);
    };

    open();
  }

  /** ---------- KuCoin Spot (ticker) ---------- **/
  kucoinConnect(){
    const conn = this.connections.kucoin;

    const getToken = (callback) => {
      https.request('https://api.kucoin.com/api/v1/bullet-public', { method: 'POST' }, res => {
        let data = '';
        res.on('data', chunk => data += chunk);
        res.on('end', () => {
          try{
            const json = JSON.parse(data);
            if (json.code === '200000' && json.data){
              const token = json.data.token;
              const endpoint = json.data.instanceServers[0].endpoint;
              callback(endpoint, token);
            } else {
              this.logError(this.nowISO(), '[KUCOIN] Token error:', json);
              retryGetToken();
            }
          }catch(e){
            this.logError(this.nowISO(), '[KUCOIN] Parse error:', e.message);
            retryGetToken();
          }
        });
      }).on('error', err => {
        this.logError(this.nowISO(), '[KUCOIN] Token request error:', err.message);
        retryGetToken();
      }).end();
    };

    const retryGetToken = () => {
      const d = 1000 + Math.floor(Math.random()*1000);
      setTimeout(() => getToken(openWs), d);
    };

    const openWs = (endpoint, token) => {
      const url = `${endpoint}?token=${token}`;

      const sub = () => {
        const msg = {
          id: Date.now(),
          type: 'subscribe',
          topic: `/market/ticker:${this.symbolKucoin}`,
          privateChannel: false,
          response: true
        };
        conn.ws.send(JSON.stringify(msg));
      };

      conn.ws = new WebSocket(url);
      conn.ws.on('open', () => {
        this.log(this.nowISO(), '[KUCOIN] Connected to', url.split('?')[0]);
        sub();
        heartbeat();
      });
      conn.ws.on('message', raw => {
        let m; try{ m = JSON.parse(raw); } catch(e){
          this.logError(this.nowISO(), '[KUCOIN] Parse error:', e.message);
          return;
        }

        if (m && m.type === 'message' && m.topic === `/market/ticker:${this.symbolKucoin}` && m.data){
          const d = m.data;
          const bb = parseFloat(d.bestBid);
          const ba = parseFloat(d.bestAsk);
          const price = (Number.isFinite(bb) && Number.isFinite(ba))
                        ? (bb+ba)/2
                        : parseFloat(d.price);
          if (Number.isFinite(price)) this.setLatest('kucoin', price);
        }
      });
      conn.ws.on('close', (code, reason) => {
        this.log(this.nowISO(), '[KUCOIN] Connection closed -', code, reason.toString());
        clearInterval(conn.hbTimer);
        retryGetToken();
      });
      conn.ws.on('error', (err) => {
        this.logError(this.nowISO(), '[KUCOIN] WebSocket error:', err.message);
        try{ conn.ws.close(); }catch{}
      });

      const heartbeat = () => {
        clearInterval(conn.hbTimer);
        conn.hbTimer = setInterval(() => {
          try{
            if (conn.ws && conn.ws.readyState === WebSocket.OPEN){
              conn.ws.send(JSON.stringify({ id: Date.now(), type: 'ping' }));
            }
          }catch{}
        }, WS_TIMEOUT_MS/3);
      };
    };

    getToken(openWs);
  }

  /** ---------- Binance Spot (bookTicker) ---------- **/
  binanceConnect(){
    const url = `wss://stream.binance.com:9443/ws/${this.symbolBinance}@bookTicker`;
    const conn = this.connections.binance;

    const open = () => {
      conn.ws = new WebSocket(url);
      conn.ws.on('open', () => {
        this.log(this.nowISO(), '[BINANCE] Connected to', url);
        heartbeat();
      });
      conn.ws.on('message', raw => {
        let m; try{ m = JSON.parse(raw); } catch(e){
          this.logError(this.nowISO(), '[BINANCE] Parse error:', e.message);
          return;
        }

        if (m && m.s && m.b && m.a){
          const bb = parseFloat(m.b);
          const ba = parseFloat(m.a);
          if (Number.isFinite(bb) && Number.isFinite(ba)){
            const price = (bb + ba) / 2;
            this.setLatest('binance', price);
          }
        }
      });
      conn.ws.on('close', (code, reason) => {
        this.log(this.nowISO(), '[BINANCE] Connection closed -', code, reason.toString());
        clearInterval(conn.hbTimer);
        retry();
      });
      conn.ws.on('error', (err) => {
        this.logError(this.nowISO(), '[BINANCE] WebSocket error:', err.message);
        try{ conn.ws.close(); }catch{}
      });
    };

    const heartbeat = () => {
      clearInterval(conn.hbTimer);
      conn.hbTimer = setInterval(() => {
        try{
          if (conn.ws && conn.ws.readyState === WebSocket.OPEN) conn.ws.ping();
        }catch{}
      }, WS_TIMEOUT_MS/3);
    };

    const retry = () => {
      const d = 1000 + Math.floor(Math.random()*1000);
      setTimeout(open, d);
    };

    open();
  }

  /** ---------- MEXC Spot (protobuf bookTicker) ---------- **/
  mexcConnect(){
    const url = 'wss://wbs-api.mexc.com/ws';
    const conn = this.connections.mexc;

    const loadProto = (callback) => {
      protobuf.load(__dirname + '/mexc-proto/PushDataV3ApiWrapper.proto', (err, root) => {
        if (err) {
          this.logError(this.nowISO(), '[MEXC] Failed to load proto:', err.message);
          setTimeout(() => loadProto(callback), 5000);
          return;
        }
        conn.proto = root.lookupType('PushDataV3ApiWrapper');
        callback();
      });
    };

    const sub = () => {
      const msg = {
        method: 'SUBSCRIPTION',
        params: [`spot@public.bookTicker.batch.v3.api.pb@${this.symbolMexc}`]
      };
      conn.ws.send(JSON.stringify(msg));
    };

    const open = () => {
      conn.ws = new WebSocket(url);
      conn.ws.on('open', () => {
        this.log(this.nowISO(), '[MEXC] Connected to', url);
        sub();
        heartbeat();
      });
      conn.ws.on('message', raw => {
        if (typeof raw === 'string' || raw[0] === 0x7B) {
          try {
            JSON.parse(raw);
            return;
          } catch(e) {}
        }

        try {
          const wrapper = conn.proto.decode(raw);

          if (wrapper.publicBookTickerBatch && wrapper.publicBookTickerBatch.items && wrapper.publicBookTickerBatch.items.length > 0) {
            const ticker = wrapper.publicBookTickerBatch.items[0];
            const bid = parseFloat(ticker.bidPrice);
            const ask = parseFloat(ticker.askPrice);

            if (Number.isFinite(bid) && Number.isFinite(ask)) {
              const price = (bid + ask) / 2;
              this.setLatest('mexc', price);
            }
          }
        } catch(e) {
          this.logError(this.nowISO(), '[MEXC] Protobuf parse error:', e.message);
        }
      });
      conn.ws.on('close', (code, reason) => {
        this.log(this.nowISO(), '[MEXC] Connection closed -', code, reason.toString());
        clearInterval(conn.hbTimer);
        retry();
      });
      conn.ws.on('error', (err) => {
        this.logError(this.nowISO(), '[MEXC] WebSocket error:', err.message);
        try{ conn.ws.close(); }catch{}
      });
    };

    const heartbeat = () => {
      clearInterval(conn.hbTimer);
      conn.hbTimer = setInterval(() => {
        try{
          if (conn.ws && conn.ws.readyState === WebSocket.OPEN){
            conn.ws.send(JSON.stringify({ method: 'PING' }));
          }
        }catch{}
      }, WS_TIMEOUT_MS/3);
    };

    const retry = () => {
      const d = 1000 + Math.floor(Math.random()*1000);
      setTimeout(open, d);
    };

    loadProto(open);
  }

  /** ---------- Bybit Spot (tickers) ---------- **/
  bybitConnect(){
    const url = 'wss://stream.bybit.com/v5/public/spot';
    const conn = this.connections.bybit;

    const sub = () => {
      const msg = {
        op: 'subscribe',
        args: [`tickers.${this.symbolBybit}`]
      };
      conn.ws.send(JSON.stringify(msg));
    };

    const open = () => {
      conn.ws = new WebSocket(url);
      conn.ws.on('open', () => {
        this.log(this.nowISO(), '[BYBIT] Connected to', url);
        sub();
        heartbeat();
      });
      conn.ws.on('message', raw => {
        let m; try{ m = JSON.parse(raw); } catch(e){
          this.logError(this.nowISO(), '[BYBIT] Parse error:', e.message);
          return;
        }

        // Handle ping/pong
        if (m && m.op === 'ping') {
          try {
            conn.ws.send(JSON.stringify({ op: 'pong', req_id: m.req_id }));
          } catch(e) {}
          return;
        }

        // Handle ticker data
        if (m && m.topic && m.topic.startsWith('tickers.') && m.data){
          const t = m.data;
          const bb = parseFloat(t.bid1Price);
          const ba = parseFloat(t.ask1Price);
          const price = (Number.isFinite(bb) && Number.isFinite(ba))
                        ? (bb+ba)/2
                        : parseFloat(t.lastPrice);
          if (Number.isFinite(price)) this.setLatest('bybit', price);
        }
      });
      conn.ws.on('close', (code, reason) => {
        this.log(this.nowISO(), '[BYBIT] Connection closed -', code, reason.toString());
        clearInterval(conn.hbTimer);
        retry();
      });
      conn.ws.on('error', (err) => {
        this.logError(this.nowISO(), '[BYBIT] WebSocket error:', err.message);
        try{ conn.ws.close(); }catch{}
      });
    };

    const heartbeat = () => {
      clearInterval(conn.hbTimer);
      conn.hbTimer = setInterval(() => {
        try{
          if (conn.ws && conn.ws.readyState === WebSocket.OPEN) conn.ws.ping();
        }catch{}
      }, WS_TIMEOUT_MS/3);
    };

    const retry = () => {
      const d = 1000 + Math.floor(Math.random()*1000);
      setTimeout(open, d);
    };

    open();
  }

  /** ---------- Hyperliquid (l2Book) ---------- **/
  hyperliquidConnect(){
    const url = 'wss://api.hyperliquid.xyz/ws';
    const conn = this.connections.hyperliquid;

    const sub = () => {
      const msg = {
        method: 'subscribe',
        subscription: {
          type: 'l2Book',
          coin: this.coinHyperliquid
        }
      };
      conn.ws.send(JSON.stringify(msg));
    };

    const open = () => {
      conn.ws = new WebSocket(url);
      conn.ws.on('open', () => {
        this.log(this.nowISO(), '[HYPERLIQUID] Connected to', url);
        sub();
        heartbeat();
      });
      conn.ws.on('message', raw => {
        let m; try{ m = JSON.parse(raw); } catch(e){
          this.logError(this.nowISO(), '[HYPERLIQUID] Parse error:', e.message);
          return;
        }

        // Handle l2Book data
        if (m && m.channel === 'l2Book' && m.data && m.data.coin === this.coinHyperliquid){
          const book = m.data;
          // book.levels is [bids[], asks[]] where each entry is {px, sz, n}
          if (book.levels && book.levels.length >= 2) {
            const bids = book.levels[0]; // array of {px, sz, n}
            const asks = book.levels[1]; // array of {px, sz, n}

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
        clearInterval(conn.hbTimer);
        retry();
      });
      conn.ws.on('error', (err) => {
        this.logError(this.nowISO(), '[HYPERLIQUID] WebSocket error:', err.message);
        try{ conn.ws.close(); }catch{}
      });
    };

    const heartbeat = () => {
      clearInterval(conn.hbTimer);
      conn.hbTimer = setInterval(() => {
        try{
          if (conn.ws && conn.ws.readyState === WebSocket.OPEN) conn.ws.ping();
        }catch{}
      }, WS_TIMEOUT_MS/3);
    };

    const retry = () => {
      const d = 1000 + Math.floor(Math.random()*1000);
      setTimeout(open, d);
    };

    open();
  }

  /** ---------- Composite logic ---------- **/
  robustComposite(rows){
    const now = Date.now();
    const fresh = rows.filter(r => r && now - r.ts <= this.staleMs);
    if (fresh.length === 0) return { price: null, count: 0 };

    const prices = fresh.map(r => r.price).sort((a,b)=>a-b);
    const median = prices[Math.floor(prices.length/2)];

    const tol = 0.005;
    const kept = prices.filter(p => Math.abs(p - median)/median <= tol);
    const med2 = kept.length ? kept[Math.floor(kept.length/2)] : median;

    return { price: med2, count: fresh.length };
  }

  /** ---------- Get current composite price ---------- **/
  getComposite(){
    const rows = [
      this.latest.kraken  ? { src:'kraken',  ...this.latest.kraken  } : null,
      this.latest.coinbase? { src:'coinbase',...this.latest.coinbase} : null,
      this.latest.kucoin  ? { src:'kucoin',  ...this.latest.kucoin  } : null,
      this.latest.binance ? { src:'binance', ...this.latest.binance } : null,
      this.latest.mexc    ? { src:'mexc',    ...this.latest.mexc    } : null,
      this.latest.bybit   ? { src:'bybit',   ...this.latest.bybit   } : null,
      this.latest.hyperliquid ? { src:'hyperliquid', ...this.latest.hyperliquid } : null
    ].filter(Boolean);

    const comp = this.robustComposite(rows);
    return {
      composite: comp.price,
      count: comp.count,
      sources: rows.map(r => ({ source: r.src, price: r.price, age: Date.now() - r.ts }))
    };
  }

  /** ---------- Start oracle feeds and publisher ---------- **/
  start(){
    if (ENABLE_KRAKEN) {
      this.log(this.nowISO(), '🚀 Starting Kraken feed...');
      this.krakenConnect();
    } else {
      this.log(this.nowISO(), '⏸️  Kraken feed disabled');
    }

    if (ENABLE_COINBASE) {
      this.log(this.nowISO(), '🚀 Starting Coinbase feed...');
      this.coinbaseConnect();
    } else {
      this.log(this.nowISO(), '⏸️  Coinbase feed disabled');
    }

    if (ENABLE_KUCOIN) {
      this.log(this.nowISO(), '🚀 Starting KuCoin feed...');
      this.kucoinConnect();
    } else {
      this.log(this.nowISO(), '⏸️  KuCoin feed disabled');
    }

    if (ENABLE_BINANCE) {
      this.log(this.nowISO(), '🚀 Starting Binance feed...');
      this.binanceConnect();
    } else {
      this.log(this.nowISO(), '⏸️  Binance feed disabled');
    }

    if (ENABLE_MEXC) {
      this.log(this.nowISO(), '🚀 Starting MEXC feed...');
      this.mexcConnect();
    } else {
      this.log(this.nowISO(), '⏸️  MEXC feed disabled');
    }

    if (ENABLE_BYBIT) {
      this.log(this.nowISO(), '🚀 Starting Bybit feed...');
      this.bybitConnect();
    } else {
      this.log(this.nowISO(), '⏸️  Bybit feed disabled');
    }

    // Only start Hyperliquid if a coin was explicitly specified (opt-in only for specific assets)
    if (ENABLE_HYPERLIQUID && this.enableHyperliquid && this.coinHyperliquid) {
      this.log(this.nowISO(), '🚀 Starting Hyperliquid feed...');
      this.hyperliquidConnect();
    }

    // Start publisher loop
    this.publishTimer = setInterval(() => {
      const result = this.getComposite();
      this.emit('price', result);

      if (!this.silent) {
        // Colorized output
        const timestamp = `${colors.gray}${this.nowISO()}${colors.reset}`;
        const label = `${colors.bright}${colors.cyan}COMPOSITE${colors.reset}`;

        // Color each source differently
        const sourceColors = {
          kraken: colors.brightGreen,
          coinbase: colors.brightCyan,
          kucoin: colors.brightYellow,
          binance: colors.yellow,
          mexc: colors.magenta,
          bybit: colors.blue,
          hyperliquid: colors.brightMagenta
        };

        const parts = result.sources.map(s => {
          const color = sourceColors[s.source] || colors.white;
          return `${color}${s.source}${colors.reset}:${colors.green}${s.price.toFixed(2)}${colors.reset}`;
        });

        if (result.composite == null){
          this.log(timestamp, label, `${colors.red}none${colors.reset}`, parts.join(' '));
        } else {
          const price = `${colors.bright}${colors.green}$${result.composite.toFixed(2)}${colors.reset}`;
          this.log(timestamp, label, price, parts.join(' '));
        }
      }
    }, this.publishMs);
  }

  /** ---------- Stop oracle ---------- **/
  stop(){
    clearInterval(this.publishTimer);
    for (const [name, conn] of Object.entries(this.connections)) {
      clearInterval(conn.hbTimer);
      if (conn.ws) {
        try { conn.ws.close(); } catch {}
      }
    }
  }
}

/** ---------- Module exports ---------- **/
module.exports = CompositeOracle;

/** ---------- Standalone execution ---------- **/
if (require.main === module) {
  const oracle = new CompositeOracle({ silent: false });
  oracle.start();

  process.on('SIGINT', () => {
    console.log('\nStopping oracle...');
    oracle.stop();
    process.exit(0);
  });
}
