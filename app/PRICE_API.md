# Price API

Live USD prices aggregated from exchange websocket streams (Kraken, Coinbase,
Bitstamp, Bybit, Hyperliquid, OKX, Bitget, Gate). No API key required.

Assets: `BTC ETH SOL HYPE ZEC FARTCOIN TSLA NVDA MSTR GOLD SILVER`
(`GET /v1/tokens` returns the current list). Symbols are case-insensitive;
`all` selects every asset.

Run: `npm run build && npm run api` (port 8080, `API_PORT` to change).
Status page: `http://<host>:8080/`

## Streaming

Both stream types send every chosen asset on connect, then only the assets
whose price or status changed, batched at most every 250 ms:

```json
{"type":"prices","timestamp":"2026-09-30T21:58:30.638Z","data":[
  {"symbol":"GOLD","price":4161.6998,"status":"ok","sourcesUsed":5,"sourcesTotal":5,
   "updatedAt":"2026-09-30T21:58:30.545Z"}
]}
```

`status` is `ok` (enough agreeing sources), `degraded` (fewer than the asset's
minimum) or `down` (no fresh sources; `price` is `null`). Add `detail=true` to
include per-exchange `sources` in each update.

### Server-Sent Events

```
GET /v1/stream/prices?symbols=BTC,ETH,GOLD[&detail=true]
```

```js
const es = new EventSource('http://localhost:8080/v1/stream/prices?symbols=BTC,GOLD');
es.onmessage = (e) => {
  for (const p of JSON.parse(e.data).data) console.log(p.symbol, p.price);
};
```

```sh
curl -N 'http://localhost:8080/v1/stream/prices?symbols=btc,tsla'
```

Unknown or missing symbols return `400` with the list of available symbols.
The browser `EventSource` reconnects automatically.

### WebSocket

```
ws://<host>:8080/v1/ws[?symbols=BTC,ETH][&detail=true]
```

Client messages:

| Message | Effect |
|---|---|
| `{"op":"subscribe","symbols":["BTC","TSLA"]}` | add assets (sends their current prices right away) |
| `{"op":"unsubscribe","symbols":["BTC"]}` | remove assets |
| `{"op":"list"}` | current subscription and available symbols |
| `{"op":"ping"}` | server replies `{"type":"pong"}` |

Server messages: `welcome`, `subscribed`, `prices`, `pong`, `error`.
The server also sends protocol-level pings every 30 s and closes
connections that don't answer.

```js
const ws = new WebSocket('ws://localhost:8080/v1/ws');
ws.onopen = () => ws.send(JSON.stringify({ op: 'subscribe', symbols: ['SOL', 'SILVER'] }));
ws.onmessage = (e) => {
  const msg = JSON.parse(e.data);
  if (msg.type === 'prices') for (const p of msg.data) console.log(p.symbol, p.price);
};
```

## Snapshots

| Endpoint | Returns |
|---|---|
| `GET /v1/prices` | all assets with per-exchange detail |
| `GET /v1/prices/:symbol` | one asset |
| `GET /v1/tokens` | available symbols |
| `GET /health` | service and feed health |

## Limits

| Setting | Default | Env var |
|---|---|---|
| Concurrent streams per IP (SSE + WebSocket) | 20 | `API_MAX_STREAMS_PER_IP` |
| Concurrent streams total | 500 | `API_MAX_STREAM_CLIENTS` |
| HTTP requests per IP per minute | 600 | `API_RATE_LIMIT_PER_MIN` |
| Stream update interval | 250 ms | `API_USER_STREAM_TICK_MS` |

Streams over a limit are refused with HTTP 503. Clients that fall more than
~1 MB behind are disconnected. Behind a reverse proxy, set
`API_TRUST_PROXY=1` so limits apply to the real client IP.
