#!/usr/bin/env node
// Convert Solana wallet.json to base58 private key
// Usage: node app/wallet-to-base58.js <wallet.json>

const fs = require('fs');
const bs58 = require('bs58');

const walletPath = process.argv[2];

if (!walletPath) {
  console.error('Usage: node app/wallet-to-base58.js <wallet.json>');
  console.error('');
  console.error('Converts a Solana wallet.json file to base58 encoded private key.');
  console.error('The output can be used with ORACLE_PRIVATE_KEY environment variable.');
  process.exit(1);
}

if (!fs.existsSync(walletPath)) {
  console.error('Error: Wallet file not found:', walletPath);
  process.exit(1);
}

try {
  const walletData = JSON.parse(fs.readFileSync(walletPath, 'utf8'));
  const privateKeyBase58 = bs58.encode(Buffer.from(walletData));

  console.log('✓ Successfully converted wallet to base58');
  console.log('');
  console.log('Your base58 private key (keep this secret!):');
  console.log(privateKeyBase58);
  console.log('');
  console.log('To use it with the oracle client:');
  console.log('  export ORACLE_PRIVATE_KEY="' + privateKeyBase58 + '"');
  console.log('  node app/pyth_sim.cjs');
  console.log('');
  console.log('Or pipe it securely:');
  console.log('  echo "' + privateKeyBase58 + '" | node app/pyth_sim.cjs --private-key-stdin');
} catch (e) {
  console.error('Error reading wallet file:', e.message);
  process.exit(1);
}
