# Quick Start Guide

Get the Oracle Price Updater running in 5 minutes.

## Prerequisites

```bash
node --version  # Should be >= 16.0.0
npm --version
```

## Installation

```bash
cd app
npm install
```

## Build

```bash
npm run build
```

## Run

### Test Mode (No Transactions)

```bash
# See live prices without sending to blockchain
node dist/index.js --dryrun --verbose
```

### Development Mode

```bash
# Interactive prompt for private key
node dist/index.js --prompt --verbose
```

### Production Mode

```bash
# Daemon with logging
node dist/index.js --prompt --daemon --log=/var/log/oracle.log
```

## Common Commands

```bash
# Build
npm run build                # Compile TypeScript → JavaScript
npm run build:watch          # Auto-rebuild on changes
npm run clean               # Remove build output

# Development
npm run dev -- --dryrun     # Run TypeScript directly (no build)
npm run typecheck           # Check types only
npm run lint                # Check code style
npm run format              # Auto-format code

# Run
node dist/index.js --help   # Show usage
node dist/index.js --dryrun # Test without transactions
```

## Examples

### 1. Test Locally (Dry Run)
```bash
node dist/index.js --dryrun --verbose
```
Shows live prices, no blockchain interaction.

### 2. Development with Verbose Logging
```bash
node dist/index.js --prompt --verbose
```
Interactive key entry, detailed output.

### 3. Production Daemon
```bash
node dist/index.js --prompt --daemon --log=./oracle.log
tail -f oracle.log  # Watch logs
```
Background process with file logging.

### 4. Using Environment Variable
```bash
export ORACLE_PRIVATE_KEY="your-key-here"
node dist/index.js --daemon --log=./oracle.log
```
Most secure for scripts/automation.

### 5. Local Solana Network
```bash
# Start local validator (different terminal)
solana-test-validator

# Run oracle
export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899
node dist/index.js --prompt --verbose
```

## Stopping

### Foreground Process
```
Ctrl+C
```

### Daemon Process
```bash
# Find PID
cat app/.oracle.lock | jq -r .pid

# Kill process
kill <PID>

# Or use pkill
pkill -f "oracle"
```

## Configuration

### Environment Variables
```bash
export ANCHOR_PROVIDER_URL=http://127.0.0.1:8899  # Solana RPC
export ORACLE_PRIVATE_KEY=<your-key>              # Private key (optional)
```

### CLI Flags
```
--prompt, -p      Interactive key prompt (recommended)
--daemon, -d      Run in background
--dryrun          Test mode, no transactions
--verbose, -v     Detailed logging
--log=<file>      Log to file
```

## Troubleshooting

### Lock File Error
```bash
# Process already running
kill $(cat app/.oracle.lock | jq -r .pid)
# Or remove stale lock
rm app/.oracle.lock
```

### Build Errors
```bash
npm run clean
rm -rf node_modules
npm install
npm run build
```

### Private Key Issues
Accepts two formats:
- Base58: `5J3mBbAH58CpQ3Y2S4VNFGyvW4kXNYyuJ...`
- JSON: `[1,2,3,4,5,...]`

## Development Workflow

```bash
# Terminal 1: Watch TypeScript
npm run build:watch

# Terminal 2: Run and test
node dist/index.js --dryrun --verbose
```

## Production Checklist

- [ ] Build: `npm run build`
- [ ] Test dry run: `node dist/index.js --dryrun`
- [ ] Test auth: `node dist/index.js --prompt`
- [ ] Test daemon: `node dist/index.js --prompt --daemon`
- [ ] Verify logs: `tail -f oracle.log`
- [ ] Check lock file: `cat .oracle.lock`
- [ ] Monitor transactions
- [ ] Setup monitoring/alerts

## Next Steps

1. Read [README.md](./README.md) for detailed documentation
2. Check [MIGRATION.md](./MIGRATION.md) if upgrading from JavaScript version
3. Review source code in `src/` directory
4. Setup monitoring (log aggregation, alerts, etc.)

## Support

- Check logs: `tail -f oracle.log`
- Verify prices: Use `--dryrun --verbose`
- Test locally: Use Solana test validator
- Review code: All TypeScript in `src/`
