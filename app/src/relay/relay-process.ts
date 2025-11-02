#!/usr/bin/env node
/**
 * Relay Process Entry Point
 *
 * Standalone process that collects prices and sends to controller via IPC
 * No private keys - just data collection
 */

import { PriceRelay, RelayMessage } from './price-relay';
import { initLogger } from '../utils/logger';

let relay: PriceRelay | null = null;

// Setup relay logger if log file specified
const relayLogFile = process.env.RELAY_LOG_FILE;
if (relayLogFile) {
  initLogger({
    logFile: relayLogFile,
    verbose: false,
  });
}

/**
 * Handle messages from controller
 */
process.on('message', (msg: any) => {
  if (msg.type === 'shutdown') {
    console.log('[Relay Process] Received shutdown command');
    shutdown();
  }
});

/**
 * Handle IPC disconnect
 */
process.on('disconnect', () => {
  console.log('[Relay Process] IPC channel disconnected - controller may have exited');
  // Continue running but log the disconnection
});

/**
 * Graceful shutdown
 */
async function shutdown() {
  if (relay) {
    await relay.stop();
  }
  process.exit(0);
}

/**
 * Main entry point
 */
async function main() {
  console.log('[Relay Process] Starting...');

  relay = new PriceRelay();

  // Forward messages to parent process (controller)
  relay.on('message', (msg: RelayMessage) => {
    if (process.send && process.connected) {
      try {
        process.send(msg);
      } catch (err: any) {
        // IPC channel may be closed - ignore send errors
        if (err.code !== 'ERR_IPC_CHANNEL_CLOSED') {
          console.error('[Relay Process] Error sending message:', err);
        }
      }
    }
  });

  // Start collecting prices
  await relay.start();

  console.log('[Relay Process] Ready');
}

// Handle errors
process.on('uncaughtException', (err) => {
  console.error('[Relay Process] Uncaught exception:', err);
  process.exit(1);
});

process.on('unhandledRejection', (err) => {
  console.error('[Relay Process] Unhandled rejection:', err);
  process.exit(1);
});

// Handle termination signals
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);

// Start
main().catch((err) => {
  console.error('[Relay Process] Fatal error:', err);
  process.exit(1);
});
