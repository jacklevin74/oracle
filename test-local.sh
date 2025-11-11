#!/bin/bash

# Oracle V3 Local Testing Script
# This script automates the local testing setup

set -e

echo "======================================"
echo "Oracle V3 Local Testing Setup"
echo "======================================"
echo ""

# Colors for output
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

# Check prerequisites
echo "Checking prerequisites..."

if ! command -v solana &> /dev/null; then
    echo -e "${RED}❌ Solana CLI not found${NC}"
    echo "Install from: https://docs.solana.com/cli/install-solana-cli-tools"
    exit 1
fi
echo -e "${GREEN}✓${NC} Solana CLI found"

if ! command -v anchor &> /dev/null; then
    echo -e "${RED}❌ Anchor not found${NC}"
    echo "Install from: https://www.anchor-lang.com/docs/installation"
    exit 1
fi
echo -e "${GREEN}✓${NC} Anchor found"

if ! command -v node &> /dev/null; then
    echo -e "${RED}❌ Node.js not found${NC}"
    echo "Install from: https://nodejs.org/"
    exit 1
fi
echo -e "${GREEN}✓${NC} Node.js found"

echo ""

# Build programs first
echo "Building programs..."
if anchor build 2>&1 | grep -q "Error"; then
    echo -e "${RED}❌ Build failed${NC}"
    anchor build
    exit 1
else
    echo -e "${GREEN}✓${NC} Programs built successfully"
fi

echo ""

# Kill any existing validator
echo "Cleaning up any existing validator..."
pkill -9 solana-test-validator 2>/dev/null || true
sleep 2

# Start validator (without preloading oracle.so - we'll deploy it instead)
echo "Starting local validator..."
solana-test-validator \
  --reset \
  --quiet \
  > /tmp/solana-test-validator.log 2>&1 &

VALIDATOR_PID=$!
echo -e "${GREEN}✓${NC} Validator starting (PID: $VALIDATOR_PID)"
echo "  Log: /tmp/solana-test-validator.log"

# Wait for validator to be ready
echo "Waiting for validator to be ready..."
for i in {1..30}; do
    if solana cluster-version &> /dev/null; then
        echo -e "${GREEN}✓${NC} Validator ready"
        break
    fi
    if [ $i -eq 30 ]; then
        echo -e "${RED}❌ Validator failed to start${NC}"
        echo "Check log: tail /tmp/solana-test-validator.log"
        exit 1
    fi
    sleep 1
done

echo ""

# Configure Solana CLI
echo "Configuring Solana CLI..."
solana config set --url localhost > /dev/null 2>&1
echo -e "${GREEN}✓${NC} Configured for localhost"

# Check/create test wallet
WALLET_PATH="$HOME/.config/solana/test-wallet.json"
if [ ! -f "$WALLET_PATH" ]; then
    echo "Creating test wallet..."
    solana-keygen new --outfile "$WALLET_PATH" --no-bip39-passphrase --force > /dev/null 2>&1
    echo -e "${GREEN}✓${NC} Test wallet created"
else
    echo -e "${GREEN}✓${NC} Test wallet exists"
fi

# Set wallet
solana config set --keypair "$WALLET_PATH" > /dev/null 2>&1

# Airdrop SOL
echo "Requesting airdrop..."
if solana airdrop 10 > /dev/null 2>&1; then
    BALANCE=$(solana balance 2>/dev/null | awk '{print $1}')
    echo -e "${GREEN}✓${NC} Airdropped SOL (Balance: $BALANCE SOL)"
else
    echo -e "${YELLOW}⚠${NC} Airdrop failed (may have sufficient balance)"
    BALANCE=$(solana balance 2>/dev/null | awk '{print $1}')
    if [ ! -z "$BALANCE" ]; then
        echo "  Current balance: $BALANCE SOL"
    fi
fi

echo ""

# Deploy oracle-v3 program
echo "Deploying Oracle V3 program..."
if anchor deploy --provider.cluster localnet --program-name oracle-v3 2>&1 | tee /tmp/deploy.log | grep -q "Error"; then
    echo -e "${RED}❌ Deployment failed${NC}"
    cat /tmp/deploy.log
    exit 1
else
    PROGRAM_ID=$(solana address -k target/deploy/oracle_v3-keypair.json 2>/dev/null)
    echo -e "${GREEN}✓${NC} Oracle V3 deployed"
    echo "  Program ID: $PROGRAM_ID"
fi

echo ""

# Install app dependencies
echo "Installing app dependencies..."
cd app
if [ ! -d "node_modules" ]; then
    npm install > /tmp/npm-install.log 2>&1
    if [ $? -eq 0 ]; then
        echo -e "${GREEN}✓${NC} Dependencies installed"
    else
        echo -e "${RED}❌ npm install failed${NC}"
        tail -20 /tmp/npm-install.log
        exit 1
    fi
else
    echo -e "${GREEN}✓${NC} Dependencies already installed"
fi

echo ""
echo "======================================"
echo "Setup Complete! 🎉"
echo "======================================"
echo ""
echo "Validator is running (PID: $VALIDATOR_PID)"
echo "  To stop: kill $VALIDATOR_PID"
echo "  Log: tail -f /tmp/solana-test-validator.log"
echo ""
echo "Available test commands:"
echo ""
echo "  ${GREEN}npm run test:jupiter${NC}      - Test Jupiter price API"
echo "  ${GREEN}npm run test:dexscreener${NC}  - Test DexScreener API"
echo "  ${GREEN}npm run test:birdeye${NC}      - Test Birdeye API"
echo "  ${GREEN}npm run test:aggregation${NC}  - Test price aggregation"
echo "  ${GREEN}npm run test:quality${NC}      - Test quality control"
echo "  ${GREEN}npm run test:registry${NC}     - Test asset registry"
echo "  ${GREEN}npm run test:integration${NC}  - Full integration test"
echo "  ${GREEN}npm run test:live${NC}         - Live price monitoring"
echo "  ${GREEN}npm run test:v3${NC}           - Run all V3 tests"
echo ""
echo "Or run Anchor tests:"
echo "  ${GREEN}cd .. && anchor test --skip-local-validator${NC}"
echo ""
echo "Quick test: ${GREEN}npm run test:jupiter${NC}"
echo ""
