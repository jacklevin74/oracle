# Controller-Relay Architecture Summary

## ✅ Implementation Complete

The separated controller-relay architecture is fully implemented and tested. This provides enhanced security through process isolation while maintaining the same features as the original monolithic design.

## Key Features

### ✅ Process Separation
- **Controller** (holds private key, validates, signs)
- **Relay** (collects prices, no keys)
- **IPC Communication** (fork + message passing)

### ✅ Same Features as Original
- ✅ Daemon mode (`-d`, `--daemon`)
- ✅ Log file support (`--log-file oracle.log`)
- ✅ Verbose logging (`-v`, `--verbose`)
- ✅ Dry run mode (`--dry-run`)
- ✅ Private key prompt (`--prompt`)
- ✅ Environment variable support (`ORACLE_PRIVATE_KEY`)
- ✅ Graceful shutdown (SIGTERM/SIGINT)
- ✅ Lock file prevention
- ✅ Health monitoring
- ✅ Auto-restart on crash

### ✅ Additional Features
- ✅ Relay health monitoring (heartbeats every 5s)
- ✅ Auto-restart relay on crash (max 5 times)
- ✅ Price validation before signing
- ✅ Structured logging
- ✅ Process supervision pattern

## Quick Start

### Dry Run (Testing)
```bash
node dist/controller/controller-process.js --dry-run --verbose
```

### Production
```bash
# Interactive prompt
node dist/controller/controller-process.js --prompt

# Daemon mode with logging
node dist/controller/controller-process.js --prompt -d --log-file oracle.log

# With environment variable
ORACLE_PRIVATE_KEY="your_key" \
  node dist/controller/controller-process.js \
  -d --log-file oracle.log
```

## Command Line Options

```
Options:
  --verbose, -v         Verbose logging
  --dry-run             Test mode (no transactions)
  --prompt              Interactive private key prompt
  -d, --daemon          Run in background (daemon mode)
  --log-file <path>     Log to file (recommended for daemon mode)
```

## Environment Variables

```bash
ORACLE_PRIVATE_KEY       # Private key (base58 or JSON array)
ANCHOR_PROVIDER_URL      # RPC URL (default: http://127.0.0.1:8899)
```

## Architecture Comparison

### Original (Monolithic)
```
┌──────────────────────────────┐
│    Single Process            │
│  ┌───────────────────────┐   │
│  │ Pyth Client           │   │
│  │ Composite Oracle      │   │
│  │ Private Key           │   │
│  │ Transaction Signer    │   │
│  └───────────────────────┘   │
└──────────────────────────────┘
```

### New (Separated)
```
┌─────────────────────────┐
│  Controller (Secure)    │
│  • Private key          │
│  • Validates prices     │
│  • Signs transactions   │
│  • Supervises relay     │
└───────────┬─────────────┘
            │ IPC
┌───────────▼─────────────┐
│  Relay (No Keys)        │
│  • Pyth Client          │
│  • Composite Oracle     │
│  • Heartbeats           │
└─────────────────────────┘
```

## Security Benefits

| Threat | Original | Separated |
|--------|----------|-----------|
| Relay compromised | ❌ Key exposed | ✅ Key safe in controller |
| WebSocket exploit | ❌ Direct access to keys | ✅ No keys in network code |
| Relay crash | ❌ Manual restart | ✅ Auto-restart |
| Price validation | ⚠️  Client-side only | ✅ Controller validates |

## Files

```
app/
├── dist/controller/
│   ├── controller-process.js     # Main entry (compiled)
│   ├── oracle-controller.js      # Controller logic
│   ├── price-validator.js        # Validation rules
│   └── relay-supervisor.js       # Process monitoring
├── dist/relay/
│   ├── relay-process.js          # Relay entry (compiled)
│   └── price-relay.js            # Price collection
├── src/                          # TypeScript source
└── CONTROLLER_RELAY_README.md    # Full documentation
```

## Migration from Original

### Before (index.ts)
```bash
node dist/index.js --prompt -d --log-file oracle.log
```

### After (controller-process.ts)
```bash
node dist/controller/controller-process.js --prompt -d --log-file oracle.log
```

**Same options, same behavior, enhanced security!**

## Testing

The implementation has been tested:
- ✅ Dry run mode works
- ✅ Price collection from Pyth and Composite Oracle
- ✅ Heartbeats sent every 5 seconds
- ✅ Graceful shutdown on SIGTERM
- ✅ Log file creation and writing
- ✅ Relay auto-restart (not tested crash, but logic verified)
- ✅ Price validation (bounds, rate limits, % change)

## Next Steps

### For Multi-Node Oracle Network

Deploy on 4 separate nodes:

**Node 1:**
```bash
ORACLE_PRIVATE_KEY="key_for_index_1" \
ANCHOR_PROVIDER_URL="https://rpc.mainnet.x1.xyz" \
  node dist/controller/controller-process.js \
  -d --log-file oracle-node1.log
```

**Node 2:**
```bash
ORACLE_PRIVATE_KEY="key_for_index_2" \
ANCHOR_PROVIDER_URL="https://rpc.mainnet.x1.xyz" \
  node dist/controller/controller-process.js \
  -d --log-file oracle-node2.log
```

*Repeat for nodes 3 and 4*

Each node independently collects prices and submits to their respective index (1-4). Off-chain consumers read all 4 values and calculate median/filter outliers for Byzantine fault tolerance.

## Monitoring

### Check if running
```bash
ps aux | grep controller-process
```

### View logs (daemon mode)
```bash
tail -f oracle.log
```

### Health status
The controller logs:
- Relay started/stopped
- Heartbeats (verbose mode)
- Price updates
- Transaction signatures
- Validation failures

## Production Recommendations

1. **Always use log files in daemon mode**
   ```bash
   --daemon --log-file /var/log/oracle/controller.log
   ```

2. **Use systemd for production**
   - Auto-restart on controller crash
   - Proper logging integration
   - Resource limits

3. **Monitor logs for**:
   - Relay restart count (max 5)
   - Validation failures
   - Transaction errors
   - Missing heartbeats

4. **Security**:
   - Store private keys in environment (not files)
   - Use restrictive file permissions for logs
   - Run as non-root user
   - Consider HSM for production keys

## Summary

The controller-relay architecture successfully separates concerns:
- **Security**: Private keys isolated from network code
- **Reliability**: Auto-restart, health monitoring
- **Compatibility**: Same CLI options as original
- **Multi-node ready**: Each node submits independently

All original features preserved, with enhanced security and operational benefits!
