# Controller-Relay Architecture

Separated oracle architecture with enhanced security through process isolation.

## Architecture Overview

```
┌─────────────────────────────────────────┐
│        CONTROLLER PROCESS               │
│  • Holds private key (isolated)         │
│  • Validates prices                     │
│  • Signs transactions                   │
│  • Supervises relay                     │
│  • Auto-restarts relay on crash         │
└──────────────┬──────────────────────────┘
               │
               │ IPC (fork + message passing)
               │
┌──────────────▼──────────────────────────┐
│         RELAY PROCESS                   │
│  • NO private keys                      │
│  • Connects to Pyth Network             │
│  • Connects to exchange WebSockets      │
│  • Aggregates prices                    │
│  • Sends heartbeats                     │
└─────────────────────────────────────────┘
```

## Security Benefits

### Process Separation
- **Private key isolation**: Keys only in controller, never in network-facing code
- **Reduced attack surface**: Relay has no signing capability
- **Fault tolerance**: Relay crashes don't lose keys

### Multi-Node Oracle Network
- **Byzantine tolerance**: Each node submits independently
- **Limited compromise impact**: Corrupted node only affects one index
- **Off-chain consensus**: Consumers calculate median from all nodes

### Defense in Depth
- **Price validation**: Controller validates before signing
  - Bounds checking (min/max price)
  - Rate limiting (max update frequency)
  - Change limits (max % change from last price)
- **Health monitoring**: Auto-restart crashed relay
- **Supervisor pattern**: Controller watches relay health

## Components

### 1. Price Relay (`relay-process.ts`)
**Responsibilities:**
- Collect prices from Pyth Network (BTC, ETH, SOL)
- Collect prices from exchanges via Composite Oracle (BTC, ETH, SOL, HYPE, ZEC)
- Send price updates to controller via IPC
- Send periodic heartbeats (every 5s)

**NO access to:**
- Private keys
- Transaction signing
- Blockchain submission

### 2. Oracle Controller (`controller-process.ts`)
**Responsibilities:**
- Hold private key securely
- Spawn and monitor relay process
- Validate incoming prices
- Sign and submit transactions
- Auto-restart relay on failure

**Includes:**
- `PriceValidator`: Validates prices before signing
- `RelaySupervisor`: Monitors and restarts relay
- `TransactionBuilder`: Signs and submits to Solana

## Data Pipeline

### Messages: Relay → Controller

```typescript
// Heartbeat (every 5s)
{
  type: 'heartbeat',
  timestamp: number
}

// Price update (when prices change)
{
  type: 'price_update',
  timestamp: number,
  data: {
    btc: number | null,
    eth: number | null,
    sol: number | null,
    hype: number | null,
    zec: number | null
  }
}
```

### Messages: Controller → Relay

```typescript
// Shutdown command
{
  type: 'shutdown'
}
```

## Health Monitoring

### Relay Health Checks
- Heartbeat timeout: 30 seconds
- Check interval: 10 seconds
- Max restarts: 5
- Restart delay: 2 seconds

### Failure Handling
1. Controller detects missing heartbeat
2. Kills unresponsive relay process
3. Waits 2 seconds
4. Spawns new relay process
5. If max restarts exceeded → controller shuts down

## Usage

### Dry Run (Testing)
```bash
# Compile TypeScript
cd app
npx tsc

# Run in dry run mode (no signing)
node src/controller/controller-process.js --dry-run --verbose
```

### Production (with Private Key)

**Option 1: Interactive Prompt**
```bash
node dist/controller/controller-process.js --prompt
```

**Option 2: Environment Variable**
```bash
ORACLE_PRIVATE_KEY="your_base58_key" node dist/controller/controller-process.js
```

**With verbose logging:**
```bash
node dist/controller/controller-process.js --prompt --verbose
```

**With daemon mode (background):**
```bash
# With log file (recommended for daemon)
node dist/controller/controller-process.js --prompt --daemon --log-file oracle.log

# Or short form
node dist/controller/controller-process.js --prompt -d --log-file oracle.log
```

**With environment variable in daemon mode:**
```bash
ORACLE_PRIVATE_KEY="your_key" \
  node dist/controller/controller-process.js \
  -d --log-file oracle.log
```

### Environment Variables
```bash
# RPC endpoint (default: http://127.0.0.1:8899)
export ANCHOR_PROVIDER_URL="https://rpc.mainnet.x1.xyz"

# Private key (alternative to --prompt)
export ORACLE_PRIVATE_KEY="your_base58_or_json_array"
```

## Price Validation Rules

### BTC
- Min: $10,000
- Max: $200,000
- Max change: 15%
- Min interval: 500ms

### ETH
- Min: $500
- Max: $10,000
- Max change: 15%
- Min interval: 500ms

### SOL
- Min: $10
- Max: $1,000
- Max change: 20%
- Min interval: 500ms

### HYPE
- Min: $1
- Max: $100
- Max change: 25%
- Min interval: 500ms

### ZEC
- Min: $10
- Max: $500
- Max change: 20%
- Min interval: 500ms

**Note:** These are sanity checks only. Outlier detection happens off-chain by consuming applications that compare prices across all oracle nodes.

## Files Structure

```
app/src/
├── controller/
│   ├── controller-process.ts    # Main controller entry point
│   ├── oracle-controller.ts     # Controller orchestrator
│   ├── price-validator.ts       # Price validation logic
│   └── relay-supervisor.ts      # Relay monitoring/restart
├── relay/
│   ├── relay-process.ts         # Relay entry point
│   └── price-relay.ts           # Price collection logic
├── oracles/
│   ├── pyth-client.ts           # Pyth Network client
│   └── composite-client.ts      # Exchange aggregation
├── solana/
│   └── transaction-builder.ts   # Transaction signing
└── auth/
    └── private-key-manager.ts   # Key handling
```

## Development

### Build
```bash
cd app
npm install
npx tsc
```

### Run Tests
```bash
# Start controller in dry run mode
node src/controller/controller-process.js --dry-run --verbose

# You should see:
# - Controller starts
# - Relay process spawns
# - Heartbeats every 5s
# - Price updates when prices change
# - No actual transactions sent
```

### Monitor Relay Health
```bash
# In dry run mode with verbose logging, you'll see:
# - [Relay Process] Starting...
# - [Relay] ✓ Connected to Pyth Network
# - [Relay] ✓ Connected to Composite Oracle
# - [Controller] Heartbeat from relay
# - [Controller] Price update: BTC=$XX,XXX, ETH=$X,XXX...
```

## Deployment for Multi-Node Oracle

For a distributed oracle network with 4 nodes:

**Node 1 (Index 1):**
```bash
ORACLE_PRIVATE_KEY="key_for_index_1" \
ANCHOR_PROVIDER_URL="https://rpc.mainnet.x1.xyz" \
node src/controller/controller-process.js
```

**Node 2 (Index 2):**
```bash
ORACLE_PRIVATE_KEY="key_for_index_2" \
ANCHOR_PROVIDER_URL="https://rpc.mainnet.x1.xyz" \
node src/controller/controller-process.js
```

Each node independently collects prices and submits to their respective `paramN` slot on-chain. Off-chain consumers read all 4 values and calculate median/mean while filtering outliers.

## Security Considerations

### What This Architecture Protects Against
✅ Relay process compromise → Key still safe in controller
✅ WebSocket exploit → No keys in network-facing code
✅ Relay crash → Auto-restart without losing state
✅ Single node corruption → Other nodes still honest

### What It Doesn't Protect Against
❌ Controller process compromise → Game over
❌ All nodes corrupted → No honest reference
❌ On-chain program bug → Separate concern

### Best Practices
1. Run controller and relay on same machine (localhost IPC)
2. Use hardware security module (HSM) for production keys
3. Monitor controller process separately (systemd, Docker healthcheck)
4. Set up alerts for max restart events
5. Log all price validation failures for investigation

## Troubleshooting

### Relay keeps crashing
- Check network connectivity
- Verify WebSocket access (Pyth, exchanges)
- Check logs for errors
- Increase max restarts if transient issues

### No price updates
- Check verbose logs: `--verbose`
- Verify Pyth feed IDs are correct
- Check exchange API availability
- Ensure composite oracle is receiving data

### Validation failures
- Check price bounds in `price-validator.ts`
- Adjust max % change if markets volatile
- Review last sent prices in logs
- Consider market conditions (circuit breakers)

### Max restarts exceeded
- Investigate relay crash cause
- Check system resources (memory, CPU)
- Review error logs before crashes
- May indicate persistent infrastructure issue
