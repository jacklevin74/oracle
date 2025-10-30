#!/bin/bash
# Systemd wrapper script for Oracle Client
# Prompts for private key and starts the oracle client

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
GRAY='\033[0;90m'
NC='\033[0m' # No Color

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ORACLE_SCRIPT="$SCRIPT_DIR/pyth_sim.cjs"

# Check if running interactively
if [ -t 0 ]; then
    # Interactive mode - prompt for private key
    echo -e "${CYAN}╔═══════════════════════════════════════════════╗${NC}"
    echo -e "${CYAN}║${NC}  ${GREEN}Oracle Client Systemd Starter${NC}             ${CYAN}║${NC}"
    echo -e "${CYAN}╚═══════════════════════════════════════════════╝${NC}"
    echo ""
    echo -e "${CYAN}[Systemd]${NC} Starting oracle client..."
    echo ""

    # Use the built-in --prompt feature of pyth_sim.cjs
    exec node "$ORACLE_SCRIPT" --prompt "$@"
else
    # Non-interactive mode - check for environment variable
    if [ -z "$ORACLE_PRIVATE_KEY" ]; then
        echo -e "${RED}[ERROR]${NC} ORACLE_PRIVATE_KEY environment variable not set!" >&2
        echo -e "${YELLOW}When running as systemd service, you must set the private key in the service file.${NC}" >&2
        exit 1
    fi

    exec node "$ORACLE_SCRIPT" "$@"
fi
