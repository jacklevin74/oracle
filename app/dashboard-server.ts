/**
 * Oracle V3 Dashboard Server
 * Real-time monitoring console for price feeds
 */

import express from 'express';
import { createServer } from 'http';
import { WebSocketServer } from 'ws';
import { Connection, PublicKey } from '@solana/web3.js';
import path from 'path';
import { TOP_SOLANA_TOKENS, getTokenBySymbol } from './dashboard-tokens';

const app = express();
const server = createServer(app);
const wss = new WebSocketServer({ server });

// Configuration
const PORT = process.env.PORT || 3000;
const RPC_URL = process.env.RPC_URL || 'http://localhost:8899';
const PROGRAM_ID = new PublicKey('8gLZV8k3R6JrAs5BZzyyZQikjEfqvJjAz8PxbiYmz2Kb');

// Assets to monitor - All top Solana tokens from token list
const ASSETS = TOP_SOLANA_TOKENS.map(token => ({
  symbol: token.symbol,
  mint: token.mint,
  name: token.name,
  basePrice: token.basePrice,
}));

// Price data storage
interface UpdaterData {
  signer: string;
  price: number;
  timestamp: number;
  slot: number;
  localTime: string;
  isoTime: string;
  age: number;
}

interface AssetData {
  symbol: string;
  mint: string;
  aggregatedPrice: number;
  latency: number;
  lastUpdate: string;
  updaters: UpdaterData[];
}

let currentData: Map<string, AssetData> = new Map();
let currentSlot = 0;
let registryPDA = '';

// Solana connection
const connection = new Connection(RPC_URL, 'confirmed');

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// API endpoint for current data
app.get('/api/prices', (_req, res) => {
  const data = Array.from(currentData.values());
  res.json({
    slot: currentSlot,
    pda: registryPDA,
    assets: data,
  });
});

// Health check
app.get('/health', (_req, res) => {
  res.json({ status: 'ok', slot: currentSlot, assets: currentData.size });
});

// WebSocket connections
wss.on('connection', (ws) => {
  console.log('New WebSocket client connected');

  // Send current data immediately
  ws.send(JSON.stringify({
    type: 'initial',
    slot: currentSlot,
    pda: registryPDA,
    assets: Array.from(currentData.values()),
  }));

  ws.on('close', () => {
    console.log('WebSocket client disconnected');
  });
});

// Broadcast to all WebSocket clients
function broadcast(data: any) {
  const message = JSON.stringify(data);
  wss.clients.forEach((client) => {
    if (client.readyState === 1) { // OPEN
      client.send(message);
    }
  });
}

// Fetch price data from on-chain
async function fetchPriceData() {
  try {
    const slot = await connection.getSlot();
    currentSlot = slot;

    for (const asset of ASSETS) {
      // TODO: When PDAs are initialized, derive PDA and fetch real data:
      // const mint = new PublicKey(asset.mint);
      // const [priceDataPDA] = PublicKey.findProgramAddressSync(
      //   [Buffer.from('price'), mint.toBuffer()],
      //   PROGRAM_ID
      // );
      // const accountInfo = await connection.getAccountInfo(priceDataPDA);
      // const data = accountInfo?.data; // Parse with Anchor deserialize

      try {
        // Generate mock data for demo (will use real data when PDAs are initialized)
        if (true) { // Always show data for demo
          // Get base price from token data
          const tokenInfo = getTokenBySymbol(asset.symbol);
          const basePrice = tokenInfo?.basePrice || 1.00;
          const variance = basePrice * 0.005; // 0.5% variance

          const updaters: UpdaterData[] = [
            {
              signer: 'CGLezz',
              price: basePrice + (Math.random() - 0.5) * variance,
              timestamp: Date.now(),
              slot: slot,
              localTime: new Date().toLocaleTimeString(),
              isoTime: new Date().toISOString(),
              age: Math.floor(Math.random() * 1500) + 500,
            },
            {
              signer: 'FprJrT',
              price: basePrice + (Math.random() - 0.5) * variance,
              timestamp: Date.now() - 100,
              slot: slot,
              localTime: new Date(Date.now() - 100).toLocaleTimeString(),
              isoTime: new Date(Date.now() - 100).toISOString(),
              age: Math.floor(Math.random() * 1500) + 500,
            },
            {
              signer: '7FZvQQ',
              price: basePrice + (Math.random() - 0.5) * variance,
              timestamp: Date.now() - 200,
              slot: slot,
              localTime: new Date(Date.now() - 200).toLocaleTimeString(),
              isoTime: new Date(Date.now() - 200).toISOString(),
              age: Math.floor(Math.random() * 1500) + 500,
            },
            {
              signer: '55MyuY',
              price: 0,
              timestamp: 0,
              slot: 0,
              localTime: 'n/a',
              isoTime: 'n/a',
              age: 0,
            },
          ];

          // Calculate aggregated price
          const validPrices = updaters.filter(u => u.price > 0).map(u => u.price);
          const avgPrice = validPrices.reduce((a, b) => a + b, 0) / validPrices.length;

          const assetData: AssetData = {
            symbol: asset.symbol,
            mint: asset.mint,
            aggregatedPrice: avgPrice,
            latency: Math.min(...updaters.filter(u => u.age > 0).map(u => u.age)),
            lastUpdate: new Date().toLocaleTimeString(),
            updaters,
          };

          currentData.set(asset.symbol, assetData);
        }
      } catch (error) {
        console.error(`Error fetching ${asset.symbol}:`, error);
      }
    }

    // Broadcast update to all connected clients
    broadcast({
      type: 'update',
      slot: currentSlot,
      pda: registryPDA,
      assets: Array.from(currentData.values()),
    });

  } catch (error) {
    console.error('Error fetching price data:', error);
  }
}

// Calculate registry PDA
async function initializePDAs() {
  try {
    const [registryPDAKey] = PublicKey.findProgramAddressSync(
      [Buffer.from('registry')],
      PROGRAM_ID
    );
    registryPDA = registryPDAKey.toString();
    console.log(`Registry PDA: ${registryPDA}`);
  } catch (error) {
    console.error('Error initializing PDAs:', error);
  }
}

// Start server
async function start() {
  await initializePDAs();

  // Fetch data every 1 second
  setInterval(fetchPriceData, 1000);

  // Initial fetch
  await fetchPriceData();

  server.listen(PORT, () => {
    console.log(`\n╔════════════════════════════════════════╗`);
    console.log(`║   ORACLE V3 DASHBOARD SERVER          ║`);
    console.log(`╚════════════════════════════════════════╝`);
    console.log(`\n✓ Server running on http://localhost:${PORT}`);
    console.log(`✓ WebSocket ready for real-time updates`);
    console.log(`✓ Connected to RPC: ${RPC_URL}`);
    console.log(`✓ Program ID: ${PROGRAM_ID.toString()}`);
    console.log(`✓ Monitoring ${ASSETS.length} assets\n`);
  });
}

start().catch(console.error);
