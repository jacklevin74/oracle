# Oracle Price Updater (TypeScript)

A well-structured TypeScript application for streaming cryptocurrency prices from Pyth Network and Composite Oracle, then batching updates to Solana blockchain.

## Features

- **Multi-Asset Support**: BTC, ETH, SOL, HYPE
- **Dual Price Sources**:
  - Pyth Network (Hermes) for BTC/ETH/SOL
  - Composite Oracle for all assets (aggregates from multiple exchanges)
- **Secure Private Key Management**:
  - Interactive prompt (hidden input)
  - Environment variable
  - stdin
  - Wallet file (legacy)
- **Daemon Mode**: Fork to background process
- **Lock File**: Prevents multiple instances
- **Batch Updates**: All assets in single transaction
- **Dry Run Mode**: Test without sending transactions
- **Structured Logging**: Optional file output with timestamps
- **Type Safety**: Full TypeScript with strict mode
- **Modular Architecture**: Clean separation of concerns

## Project Structure

```
app/
├── src/
│   ├── app/
│   │   └── oracle-service.ts        # Main application orchestrator
│   ├── auth/
│   │   └── private-key-manager.ts   # Secure key handling
│   ├── config/
│   │   ├── constants.ts             # Application constants
│   │   └── colors.ts                # Terminal colors
│   ├── oracles/
│   │   ├── pyth-client.ts           # Pyth Network client
│   │   └── composite-client.ts      # Composite oracle wrapper
│   ├── solana/
│   │   └── transaction-builder.ts   # Transaction construction
│   ├── types/
│   │   └── index.ts                 # TypeScript type definitions
│   ├── utils/
│   │   ├── cli-parser.ts            # CLI argument parsing
│   │   ├── logger.ts                # Structured logging
│   │   ├── lock-file-manager.ts     # Lock file management
│   │   ├── daemon-fork.ts           # Background process forking
│   │   └── formatting.ts            # Number formatting utilities
│   └── index.ts                     # Main entry point
├── dist/                            # TypeScript build output
├── tsconfig.json                    # TypeScript configuration
├── package.json                     # Dependencies and scripts
├── .eslintrc.json                   # ESLint configuration
├── .prettierrc                      # Prettier configuration
└── README.md                        # This file
```

## Installation

### Prerequisites

- Node.js 16 or higher
- npm or yarn
- Solana CLI (for wallet management)

### Install Dependencies

```bash
cd app
npm install
```

## Building

```bash
# Build TypeScript to JavaScript
npm run build

# Build and watch for changes
npm run build:watch

# Clean build directory
npm clean
```

## Usage

### Basic Usage

```bash
# Interactive prompt (RECOMMENDED - most secure)
node dist/index.js --prompt

# With environment variable
ORACLE_PRIVATE_KEY=<key> node dist/index.js

# With stdin
echo <key> | node dist/index.js --private-key-stdin

# With wallet file (legacy)
node dist/index.js /path/to/wallet.json

# Dry run mode (no transactions)
node dist/index.js --dryrun
```

### Daemon Mode

```bash
# Fork to background with logging
node dist/index.js --prompt --daemon --log=/var/log/oracle.log

# Short form
node dist/index.js -p -d --log=./oracle.log
```

### Options

```
  --prompt, -p               Securely prompt for private key (hidden input)
  --private-key-stdin        Read private key from stdin
  --daemon, -d               Fork to background after authentication
  --dryrun                   Run without sending transactions
  --verbose, -v              Enable continuous logging (off by default)
  --log=<file>               Write logs to specified file (appends)
```

### Examples

```bash
# Development: verbose output
node dist/index.js --prompt --verbose

# Production: daemon with log file
node dist/index.js --prompt --daemon --log=/var/log/oracle.log

# Testing: dry run to see prices without sending
node dist/index.js --dryrun --verbose

# Using environment variable
export ORACLE_PRIVATE_KEY="your-base58-key"
node dist/index.js --daemon --log=./oracle.log
```

## Development

### Type Checking

```bash
npm run typecheck
```

### Linting

```bash
# Check for issues
npm run lint

# Auto-fix issues
npm run lint:fix
```

### Formatting

```bash
# Check formatting
npm run format:check

# Auto-format
npm run format
```

### Running in Development Mode

```bash
# Run TypeScript directly with ts-node
npm run dev -- --prompt --verbose
```

## Configuration

### Environment Variables

- `ORACLE_PRIVATE_KEY`: Private key (base58 or JSON array)
- `ANCHOR_PROVIDER_URL`: Solana RPC URL (default: http://127.0.0.1:8899)

### Authorized Updaters

The application validates that the provided keypair is in the authorized updater list:

- Index 1: `CGLezzdUpYmxiq3g5xdXxry8SWqwQbSxFJsdqfM13ro9`
- Index 2: `FprJrTPJq9eKsVxEVhQCyRChEMaYzyTwcnK8aNfCae2D`
- Index 3: `7FZvQQE1VDq2fFSuBmCCxmo8tPNm9LfYqF9BMkbyp1by`
- Index 4: `55MyuYePgkwAExNqtdNY4zahSyiM3stjjRm3Ym36sTA8` (Reserved)

## Data Sources

### 1. Pyth Network (Hermes)
- URL: https://hermes.pyth.network
- Provides: BTC/USD, ETH/USD, SOL/USD
- Real-time price feeds with cryptographic attestation

### 2. Composite Oracle (o3.js)
- Aggregates from multiple exchanges:
  - Kraken
  - Coinbase
  - KuCoin
  - Binance
  - MEXC
  - Bybit
- Provides: BTC/USD, ETH/USD, SOL/USD, HYPE/USD

### 3. HYPE Token
- Sourced exclusively from Composite Oracle
- No Pyth feed available
- Includes Hyperliquid native exchange

## Architecture Improvements

### From Original (pyth_sim.cjs) to TypeScript

1. **Code Organization**
   - Split into 10+ modules with clear responsibilities
   - Separated concerns: auth, config, oracles, solana, utils
   - Classes for stateful components (Logger, TransactionBuilder, etc.)

2. **Type Safety**
   - Full TypeScript with strict mode
   - Custom error types (OracleError, AuthenticationError, etc.)
   - Comprehensive interfaces for all data structures
   - No `any` types

3. **Better Patterns**
   - Dependency injection in OracleService
   - EventEmitter for oracle clients
   - Async/await with proper error handling
   - Graceful shutdown handling

4. **Security**
   - Secure private key handling preserved
   - Input validation with typed errors
   - Memory clearing after key use
   - Environment variable cleanup

5. **Maintainability**
   - Clear naming conventions
   - JSDoc/TSDoc comments
   - Better error messages
   - Configuration validation
   - Modular design for testability

6. **Logging**
   - Structured logging with levels
   - File and console separation
   - Configurable verbosity
   - Log throttling for non-verbose mode

## Stopping the Oracle

### If running in foreground
```bash
Ctrl+C
```

### If running in daemon mode
```bash
# Find the PID
ps aux | grep oracle

# Kill the process
kill <PID>

# Or remove lock file if stale
rm app/.oracle.lock
```

## Troubleshooting

### Lock File Error
If you see "Oracle client is already running", either:
1. Stop the running instance: `kill <PID>`
2. Remove stale lock file: `rm app/.oracle.lock`

### Private Key Format
Accepts two formats:
- Base58 string: `5J3mBbAH58CpQ3Y2S4VNFGyvW4kXNYyuJ...`
- JSON array: `[1,2,3,4,5,...]`

### Build Errors
```bash
# Clean and rebuild
npm run clean
npm install
npm run build
```

## Migration from JavaScript

The TypeScript version is a drop-in replacement for `pyth_sim.cjs`:

1. All CLI flags work identically
2. All functionality preserved
3. Same authentication methods
4. Same lock file mechanism
5. Same output formats

To migrate:
```bash
# Build the TypeScript version
cd app
npm install
npm run build

# Use the same commands
node dist/index.js --prompt --daemon --log=./oracle.log
```

## License

ISC
