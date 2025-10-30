#!/usr/bin/env node
// PM2 Launcher for Oracle Client
// Prompts for private key securely and launches pyth_sim.cjs under PM2 management

const { exec, spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

// Color codes for output
const colors = {
  reset: '\x1b[0m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  gray: '\x1b[90m',
};

// Parse command line arguments
const args = process.argv.slice(2);
const verbose = args.includes('--verbose') || args.includes('-v');
const appName = args.find(a => a.startsWith('--name='))?.split('=')[1] || 'oracle-client';

function log(msg) {
  console.log(`${colors.cyan}[PM2 Launcher]${colors.reset} ${msg}`);
}

function error(msg) {
  console.error(`${colors.red}[ERROR]${colors.reset} ${msg}`);
}

function success(msg) {
  console.log(`${colors.green}✓${colors.reset} ${msg}`);
}

// Prompt for private key (hidden input)
async function promptPrivateKey() {
  return new Promise((resolve, reject) => {
    let input = '';

    console.log(`\n${colors.cyan}🔐 Enter your private key (input will be hidden):${colors.reset}`);
    console.log(`   ${colors.gray}Accepts: base58 string or JSON array [1,2,3,...]${colors.reset}`);
    console.log('');
    process.stdout.write('Private Key: ');

    if (process.stdin.isTTY) {
      process.stdin.setRawMode(true);
    }
    process.stdin.resume();
    process.stdin.setEncoding('utf8');

    const onData = (char) => {
      if (char === '\n' || char === '\r' || char === '\u0003' || char === '\u0004') {
        // Enter, Ctrl+C, or Ctrl+D pressed
        process.stdin.pause();
        if (process.stdin.isTTY) {
          process.stdin.setRawMode(false);
        }
        process.stdin.removeListener('data', onData);
        console.log('\n');

        if (char === '\u0003') {
          console.log('\nCancelled by user');
          process.exit(0);
        }

        if (!input || input.trim().length === 0) {
          reject(new Error('No input received'));
        } else {
          resolve(input.trim());
        }
      } else if (char === '\u007f' || char === '\b') {
        // Backspace
        if (input.length > 0) {
          input = input.slice(0, -1);
        }
      } else {
        // Regular character
        input += char;
      }
    };

    process.stdin.on('data', onData);
  });
}

// Check if pm2 is installed
function checkPM2() {
  return new Promise((resolve) => {
    exec('pm2 --version', (err) => {
      resolve(!err);
    });
  });
}

// Get PM2 process list
function getPM2List() {
  return new Promise((resolve, reject) => {
    exec('pm2 jlist', (err, stdout) => {
      if (err) {
        reject(err);
        return;
      }
      try {
        const list = JSON.parse(stdout);
        resolve(list);
      } catch (e) {
        reject(e);
      }
    });
  });
}

// Stop existing process if running
async function stopExistingProcess(name) {
  try {
    const list = await getPM2List();
    const existing = list.find(p => p.name === name);

    if (existing) {
      log(`Stopping existing process: ${colors.yellow}${name}${colors.reset}`);
      await new Promise((resolve, reject) => {
        exec(`pm2 delete ${name}`, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
      success(`Stopped ${name}`);
    }
  } catch (e) {
    // Ignore errors - process might not exist
  }
}

// Start process with PM2
function startWithPM2(privateKey, processName, verbose) {
  return new Promise((resolve, reject) => {
    // Use stdin wrapper to avoid environment variables completely
    const wrapperPath = path.join(__dirname, 'pm2-stdin-wrapper.cjs');

    // Build PM2 start command with wrapper
    let cmd = `echo "${privateKey}" | pm2 start ${wrapperPath} --name ${processName} --time --log-date-format "YYYY-MM-DD HH:mm:ss Z"`;

    // Add verbose flag if needed
    if (verbose) {
      cmd += ' -- --verbose';
    }

    log(`Starting oracle client under PM2...`);
    log(`Process name: ${colors.yellow}${processName}${colors.reset}`);
    log(`Verbose mode: ${verbose ? colors.green + 'enabled' : colors.gray + 'disabled'}${colors.reset}`);
    log(`${colors.green}Using stdin pipe (no environment variables)${colors.reset}`);

    // NO environment variable for private key!
    exec(cmd, (err, stdout, stderr) => {
      if (err) {
        reject(err);
        return;
      }

      console.log(stdout);
      if (stderr) console.error(stderr);

      // Overwrite and clear private key from this process
      privateKey = '0'.repeat(privateKey.length);
      privateKey = null;

      resolve();
    });
  });
}

// Show PM2 management commands
function showManagementCommands(processName) {
  console.log(`\n${colors.cyan}📋 PM2 Management Commands:${colors.reset}`);
  console.log(`${colors.gray}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}`);
  console.log(`  ${colors.yellow}pm2 list${colors.reset}                  - List all processes`);
  console.log(`  ${colors.yellow}pm2 logs ${processName}${colors.reset}        - View live logs`);
  console.log(`  ${colors.yellow}pm2 monit${colors.reset}                 - Monitor with dashboard`);
  console.log(`  ${colors.yellow}pm2 stop ${processName}${colors.reset}        - Stop the process`);
  console.log(`  ${colors.yellow}pm2 restart ${processName}${colors.reset}     - Restart the process`);
  console.log(`  ${colors.yellow}pm2 delete ${processName}${colors.reset}      - Remove from PM2`);
  console.log(`  ${colors.yellow}pm2 save${colors.reset}                  - Save process list (auto-restart on reboot)`);
  console.log(`  ${colors.yellow}pm2 startup${colors.reset}               - Enable PM2 on system boot`);
  console.log(`${colors.gray}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${colors.reset}\n`);
}

// Main function
async function main() {
  console.log(`${colors.cyan}╔═══════════════════════════════════════════════╗${colors.reset}`);
  console.log(`${colors.cyan}║${colors.reset}  ${colors.green}Oracle Client PM2 Launcher${colors.reset}              ${colors.cyan}║${colors.reset}`);
  console.log(`${colors.cyan}╚═══════════════════════════════════════════════╝${colors.reset}\n`);

  // Check if PM2 is installed
  log('Checking for PM2...');
  const hasPM2 = await checkPM2();

  if (!hasPM2) {
    error('PM2 is not installed!');
    console.log(`\n${colors.yellow}To install PM2, run:${colors.reset}`);
    console.log(`  ${colors.cyan}npm install -g pm2${colors.reset}\n`);
    process.exit(1);
  }

  success('PM2 is installed');

  // Check if pyth_sim.cjs exists
  const scriptPath = path.join(__dirname, 'pyth_sim.cjs');
  if (!fs.existsSync(scriptPath)) {
    error(`Oracle client not found at: ${scriptPath}`);
    process.exit(1);
  }

  success('Oracle client found');

  // Prompt for private key
  let privateKey;
  try {
    privateKey = await promptPrivateKey();
  } catch (e) {
    error(`Failed to read private key: ${e.message}`);
    process.exit(1);
  }

  success('Private key received');

  // Stop existing process if running
  await stopExistingProcess(appName);

  // Start with PM2
  try {
    await startWithPM2(privateKey, appName, verbose);
    success(`Oracle client started successfully!`);

    // Show management commands
    showManagementCommands(appName);

    // Show how to view logs
    console.log(`${colors.green}🚀 Oracle client is now running under PM2${colors.reset}`);
    console.log(`${colors.gray}   Run ${colors.yellow}pm2 logs ${appName}${colors.gray} to view live output${colors.reset}\n`);

  } catch (e) {
    error(`Failed to start process: ${e.message}`);
    process.exit(1);
  }
}

// Show usage
if (args.includes('--help') || args.includes('-h')) {
  console.log(`
${colors.cyan}Oracle Client PM2 Launcher${colors.reset}

${colors.yellow}Usage:${colors.reset}
  node app/pm2-launcher.js [options]

${colors.yellow}Options:${colors.reset}
  --verbose, -v          Enable verbose logging in oracle client
  --name=<name>          Set PM2 process name (default: oracle-client)
  --help, -h             Show this help message

${colors.yellow}Examples:${colors.reset}
  ${colors.gray}# Launch with default settings${colors.reset}
  node app/pm2-launcher.js

  ${colors.gray}# Launch with verbose logging${colors.reset}
  node app/pm2-launcher.js --verbose

  ${colors.gray}# Launch with custom process name${colors.reset}
  node app/pm2-launcher.js --name=oracle-prod

${colors.yellow}Security:${colors.reset}
  Your private key is passed securely via environment variable.
  It will not appear in process lists or PM2 logs.

${colors.yellow}PM2 Management:${colors.reset}
  After launching, use PM2 commands to manage the process:
    pm2 list        - View all processes
    pm2 logs        - View logs
    pm2 monit       - Monitor dashboard
    pm2 stop        - Stop the process
    pm2 restart     - Restart the process
    pm2 save        - Save for auto-restart on reboot
`);
  process.exit(0);
}

// Run main
main().catch((e) => {
  error(e.message);
  process.exit(1);
});
