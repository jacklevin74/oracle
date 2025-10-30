#!/usr/bin/env node
// PM2 stdin wrapper - Reads private key from stdin and starts oracle client
// This avoids exposing the key via environment variables

const { spawn } = require('child_process');
const path = require('path');
const readline = require('readline');

// Read private key from stdin
const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
  terminal: false
});

let privateKey = '';

rl.on('line', (line) => {
  privateKey = line.trim();
  rl.close();
});

rl.on('close', () => {
  if (!privateKey) {
    console.error('[PM2 Wrapper] No private key received from stdin');
    process.exit(1);
  }

  // Start the oracle client with --private-key-stdin flag
  const scriptPath = path.join(__dirname, 'pyth_sim.cjs');
  const args = ['--private-key-stdin', ...process.argv.slice(2)];

  const child = spawn('node', [scriptPath, ...args], {
    stdio: ['pipe', 'inherit', 'inherit'],  // Pipe stdin, inherit stdout/stderr
    env: { ...process.env }  // No ORACLE_PRIVATE_KEY in environment!
  });

  // Write private key to child's stdin
  child.stdin.write(privateKey + '\n');
  child.stdin.end();

  // Clear private key from memory
  privateKey = '0'.repeat(privateKey.length);
  privateKey = null;

  // Forward signals
  process.on('SIGINT', () => child.kill('SIGINT'));
  process.on('SIGTERM', () => child.kill('SIGTERM'));

  child.on('exit', (code) => {
    process.exit(code || 0);
  });
});
