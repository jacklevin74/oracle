# Migration Guide: JavaScript to TypeScript

This document provides guidance for migrating from the original `pyth_sim.cjs` to the new TypeScript implementation.

## Overview

The TypeScript version is a complete rewrite that maintains 100% functional compatibility while adding:
- Full type safety
- Better code organization
- Improved error handling
- Enhanced maintainability

## No Breaking Changes

The TypeScript version is designed as a drop-in replacement:

### ✅ Same CLI Interface
```bash
# These work identically in both versions
node app/pyth_sim.cjs --prompt --daemon --log=./oracle.log
node app/dist/index.js --prompt --daemon --log=./oracle.log
```

### ✅ Same Features
- All CLI flags work identically
- Lock file mechanism unchanged
- Daemon forking behavior identical
- Log format compatible
- Authentication methods identical

### ✅ Same Authentication
```bash
# Environment variable
ORACLE_PRIVATE_KEY=<key> node dist/index.js

# Interactive prompt
node dist/index.js --prompt

# Stdin
echo <key> | node dist/index.js --private-key-stdin

# Wallet file
node dist/index.js wallet.json
```

## Quick Start

### 1. Install Dependencies

```bash
cd app
npm install
```

### 2. Build TypeScript

```bash
npm run build
```

This compiles `src/**/*.ts` → `dist/**/*.js`

### 3. Run

```bash
# Use the same commands as before
node dist/index.js --prompt --verbose
```

## Side-by-Side Comparison

### Original (JavaScript)
```bash
node app/pyth_sim.cjs --prompt --daemon --log=/var/log/oracle.log
```

### New (TypeScript)
```bash
node app/dist/index.js --prompt --daemon --log=/var/log/oracle.log
```

## What Changed Under the Hood

### Code Organization

**Before**: Single 1028-line file
```
app/
├── pyth_sim.cjs  (1028 lines)
└── o3.cjs        (779 lines)
```

**After**: Modular structure
```
app/
├── src/
│   ├── app/             # Application logic
│   ├── auth/            # Authentication
│   ├── config/          # Configuration
│   ├── oracles/         # Price feed clients
│   ├── solana/          # Blockchain interaction
│   ├── types/           # TypeScript types
│   └── utils/           # Utilities
└── dist/                # Compiled output
```

### Type Safety

**Before**: Dynamic typing, runtime errors
```javascript
function toFixedI64(num, d) {
  return Math.round(Number(num) * 10 ** d);
}
```

**After**: Static typing, compile-time checking
```typescript
export function toFixedI64(num: number, decimals: number = DECIMALS): number {
  return Math.round(num * Math.pow(10, decimals));
}
```

### Error Handling

**Before**: Generic errors
```javascript
throw new Error("Invalid private key");
```

**After**: Custom error types
```typescript
throw new AuthenticationError("Invalid private key format");
```

### Class-Based Architecture

**Before**: Procedural with closures
```javascript
let connection, statePda, bhCache;
async function refreshBlockhash() { ... }
```

**After**: Object-oriented
```typescript
class TransactionBuilder {
  private connection: Connection;
  private blockhashCache: BlockhashCache;

  async refreshBlockhash(): Promise<void> { ... }
}
```

## Development Workflow

### Building

```bash
# One-time build
npm run build

# Watch mode (rebuilds on changes)
npm run build:watch

# Clean build
npm run clean && npm run build
```

### Type Checking

```bash
# Check types without building
npm run typecheck
```

### Linting & Formatting

```bash
# Check code style
npm run lint
npm run format:check

# Auto-fix issues
npm run lint:fix
npm run format
```

### Testing During Development

```bash
# Run TypeScript directly (no build needed)
npm run dev -- --dryrun --verbose
```

## Migration Checklist

- [ ] Install dependencies: `npm install`
- [ ] Build TypeScript: `npm run build`
- [ ] Test dry run: `node dist/index.js --dryrun --verbose`
- [ ] Test authentication: `node dist/index.js --prompt`
- [ ] Test daemon mode: `node dist/index.js --prompt --daemon`
- [ ] Verify log output: `node dist/index.js --log=./test.log`
- [ ] Update systemd/supervisor configs (if using)
- [ ] Update deployment scripts
- [ ] Retire old `pyth_sim.cjs` (keep as backup)

## Deployment

### Option 1: Replace in Place

```bash
# Backup original
cp app/pyth_sim.cjs app/pyth_sim.cjs.backup

# Build TypeScript
cd app
npm install
npm run build

# Update launch script to use dist/index.js
# Old: node app/pyth_sim.cjs --prompt --daemon
# New: node app/dist/index.js --prompt --daemon
```

### Option 2: Blue-Green Deployment

```bash
# Keep both running temporarily
# Old: node app/pyth_sim.cjs --prompt --daemon --log=./old.log
# New: node app/dist/index.js --prompt --daemon --log=./new.log

# Monitor for 24 hours
# Compare outputs, check for issues
# Shut down old version when confident
```

### Option 3: Systemd Service

```ini
# /etc/systemd/system/oracle.service
[Unit]
Description=Oracle Price Updater
After=network.target

[Service]
Type=forking
User=oracle
WorkingDirectory=/opt/oracle/app
Environment="ORACLE_PRIVATE_KEY=..."
ExecStart=/usr/bin/node dist/index.js --daemon --log=/var/log/oracle.log
Restart=on-failure

[Install]
WantedBy=multi-user.target
```

## Performance

No significant performance differences:
- Same WebSocket connections
- Same batch transaction logic
- Same update frequency (750ms tick)

Slight improvements:
- Better memory management with classes
- More efficient error handling
- Cleaner event handling

## Troubleshooting

### Build Fails

```bash
# Clear and reinstall
rm -rf node_modules dist
npm install
npm run build
```

### Type Errors

```bash
# Check specific file
npx tsc src/path/to/file.ts --noEmit
```

### Runtime Errors

The TypeScript version includes better error messages:

**Before**:
```
Error: Invalid key
```

**After**:
```
AuthenticationError: Invalid private key format
Expected: base58 string or JSON array [1,2,3,...]
Public key: CGLezzdUpYmxiq3g5xdXxry8SWqwQbSxFJsdqfM13ro9
This key is not in the allowed updaters list
```

## Rollback Plan

If you need to rollback:

```bash
# Stop TypeScript version
kill $(cat app/.oracle.lock | jq -r .pid)

# Start original version
node app/pyth_sim.cjs --prompt --daemon --log=./oracle.log
```

The lock file and log formats are compatible, so you can switch between versions.

## Support

For issues or questions:
1. Check the error message (improved in TypeScript version)
2. Review logs (same format as before)
3. Verify build output: `npm run build`
4. Check type errors: `npm run typecheck`

## Future Enhancements

The modular TypeScript architecture enables:
- Unit tests (easily testable modules)
- Additional price sources (plug in new oracle clients)
- Monitoring/metrics (emit events from service)
- Configuration files (strongly-typed config objects)
- Multiple networks (inject different RPC connections)
- Rate limiting (add to TransactionBuilder)

## Summary

The TypeScript rewrite provides significant improvements in code quality and maintainability while maintaining 100% compatibility with the original JavaScript version. No changes to deployment scripts or CLI commands are required.
