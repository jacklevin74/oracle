# Oracle Dashboard Server

Web dashboard for monitoring oracle price updates on X1 Mainnet.

## Quick Start

```bash
# From the app directory
npm run server

# Or directly
node server.mjs
```

The dashboard will be available at: **http://localhost:3000**

## Features

- Real-time price monitoring for all 5 assets:
  - BTC (Bitcoin)
  - ETH (Ethereum)
  - SOL (Solana)
  - HYPE (Hyperliquid)
  - ZEC (Zcash)

- Aggregated average prices with age indicators
- Per-signer detailed tables showing:
  - Slot number
  - Signer ID (relay1, relay2, relay3, reserved)
  - Local timestamp
  - ISO timestamp
  - Age in milliseconds
  - Price value

- Color-coded freshness indicators:
  - 🟢 Fresh (≤2s)
  - 🟢 OK (≤5s)
  - 🟡 Stale (≤15s)
  - 🔴 Expired (>15s)

## Configuration

The server connects to:
- **RPC URL:** `https://rpc.mainnet.x1.xyz`
- **Program ID:** `LuS6XnQ3qNXqNQvAJ3akXnEJRBv9XNoUricjMgTyCxX`
- **Poll Interval:** 250ms
- **Port:** 3000

To customize, edit `server.mjs` constants at the top of the file.

## API Endpoints

### GET /
Returns the HTML dashboard interface.

### GET /api/state
Returns JSON with current oracle state:

```json
{
  "ctxSlot": 5551519,
  "pda": "ErU8byy8jYDZg5NjsF7eacK2khJ7jfUjsoQZ2E28baJA",
  "exists": true,
  "decimals": 6,
  "groups": {
    "BTC": [...],
    "ETH": [...],
    "SOL": [...],
    "HYPE": [...],
    "ZEC": [...]
  },
  "agg": {
    "BTC": { "avg": 109740.54, "count": 4, "ageAvg": 1250 },
    ...
  },
  "latestTs": {
    "BTC": 1730419087000,
    ...
  }
}
```

## Note about server.js vs server.mjs

The file `server.js` contains ES module imports (`import`/`export`), but since `package.json` has `"type": "commonjs"`, Node.js treats `.js` files as CommonJS by default.

Solution: We use `server.mjs` (Module JavaScript) which explicitly tells Node.js to treat it as an ES module, regardless of package.json settings.

Both files are identical - `server.mjs` is just a copy with the `.mjs` extension.

To run: `npm run server` or `node server.mjs`
