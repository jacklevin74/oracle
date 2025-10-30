# Systemd Setup for Oracle Client

This guide explains how to run the oracle client as a systemd service with secure private key management.

## Overview

The oracle client can be run as a systemd service in two modes:

1. **Interactive Mode** (manual start with prompt) - For development/testing
2. **Environment Variable Mode** (automated) - For production

## Prerequisites

- Node.js installed (check with `node --version`)
- Systemd-based Linux system (Ubuntu, Debian, CentOS, etc.)
- Oracle client repository cloned

## Installation

### 1. Make the wrapper script executable

```bash
chmod +x app/systemd-start.sh
```

### 2. Copy the systemd service file

For **system-wide** service (recommended):
```bash
sudo cp systemd/oracle-client.service /etc/systemd/system/
```

For **user** service (runs as your user without sudo):
```bash
mkdir -p ~/.config/systemd/user
cp systemd/oracle-client.service ~/.config/systemd/user/
```

### 3. Update paths in the service file

Edit the service file to match your installation:

```bash
# For system-wide service
sudo nano /etc/systemd/system/oracle-client.service

# For user service
nano ~/.config/systemd/user/oracle-client.service
```

Update these fields:
- `User=` - Your username
- `Group=` - Your group (typically same as username)
- `WorkingDirectory=` - Full path to oracle directory
- `ExecStart=` - Full path to node and pyth_sim.cjs

## Configuration Options

### Option 1: Interactive Mode (Development)

Good for manual starts where you want to enter the private key each time.

**Edit the service file:**
```ini
# Comment out the EnvironmentFile and ExecStart lines
# Uncomment the interactive ExecStart:
ExecStart=/full/path/to/oracle/app/systemd-start.sh
```

**Start the service:**
```bash
# System service
sudo systemctl start oracle-client

# User service
systemctl --user start oracle-client
```

You'll be prompted to enter your private key interactively.

### Option 2: Environment Variable Mode (Production - Recommended)

Good for automated starts and production deployments.

**1. Create the environment file:**

```bash
# Create directory (system service)
sudo mkdir -p /etc/oracle-client
sudo chmod 700 /etc/oracle-client

# Or for user service
mkdir -p ~/.config/oracle-client
chmod 700 ~/.config/oracle-client
```

**2. Create the private key file:**

```bash
# System service
sudo nano /etc/oracle-client/private.env

# User service
nano ~/.config/oracle-client/private.env
```

**3. Add your private key:**

```bash
# In the private.env file:
ORACLE_PRIVATE_KEY=your_base58_private_key_here
```

**4. Secure the file permissions:**

```bash
# System service
sudo chmod 600 /etc/oracle-client/private.env
sudo chown root:root /etc/oracle-client/private.env

# User service
chmod 600 ~/.config/oracle-client/private.env
```

**5. Update the service file to use the environment file:**

```ini
# For system service, use:
EnvironmentFile=/etc/oracle-client/private.env

# For user service, use:
EnvironmentFile=%h/.config/oracle-client/private.env
```

## Managing the Service

### Enable auto-start on boot

```bash
# System service
sudo systemctl enable oracle-client

# User service
systemctl --user enable oracle-client
```

### Start the service

```bash
# System service
sudo systemctl start oracle-client

# User service
systemctl --user start oracle-client
```

### Stop the service

```bash
# System service
sudo systemctl stop oracle-client

# User service
systemctl --user stop oracle-client
```

### Restart the service

```bash
# System service
sudo systemctl restart oracle-client

# User service
systemctl --user restart oracle-client
```

### Check status

```bash
# System service
sudo systemctl status oracle-client

# User service
systemctl --user status oracle-client
```

### View logs

```bash
# System service - view live logs
sudo journalctl -u oracle-client -f

# System service - view recent logs
sudo journalctl -u oracle-client -n 100

# User service
journalctl --user -u oracle-client -f
```

### Reload service file after changes

```bash
# System service
sudo systemctl daemon-reload
sudo systemctl restart oracle-client

# User service
systemctl --user daemon-reload
systemctl --user restart oracle-client
```

## Verbose Logging

To enable verbose logging, edit the service file and add `--verbose` flag:

```ini
ExecStart=/usr/local/bin/node /path/to/oracle/app/pyth_sim.cjs --verbose
```

Then reload and restart:
```bash
sudo systemctl daemon-reload
sudo systemctl restart oracle-client
```

## Security Best Practices

1. **File Permissions**: Ensure `private.env` is readable only by the service user
   ```bash
   chmod 600 /etc/oracle-client/private.env
   ```

2. **Directory Permissions**: Restrict access to the config directory
   ```bash
   chmod 700 /etc/oracle-client
   ```

3. **Service User**: Run as a dedicated non-root user when possible

4. **Systemd Security**: The service file includes security hardening:
   - `NoNewPrivileges=true` - Prevents privilege escalation
   - `PrivateTmp=true` - Isolates /tmp directory
   - `ProtectSystem=strict` - Read-only access to /usr, /boot, /efi
   - `ProtectHome=read-only` - Limited home directory access

5. **Audit Logs**: Monitor service logs regularly
   ```bash
   sudo journalctl -u oracle-client --since "1 hour ago"
   ```

## Troubleshooting

### Service fails to start

Check the logs:
```bash
sudo journalctl -u oracle-client -n 50
```

Common issues:
- Wrong paths in service file
- Missing ORACLE_PRIVATE_KEY environment variable
- Node.js not in PATH
- Permission issues

### Private key not found

Verify environment file exists and has correct permissions:
```bash
ls -la /etc/oracle-client/private.env
cat /etc/oracle-client/private.env  # Should show ORACLE_PRIVATE_KEY=...
```

### Service starts but crashes

Check if private key is valid:
```bash
# Test manually
export ORACLE_PRIVATE_KEY="your_key_here"
node app/pyth_sim.cjs --dryrun
```

### View detailed status

```bash
sudo systemctl status oracle-client -l --no-pager
```

## Converting Wallet to Base58

If you have a wallet.json file, convert it to base58 format:

```bash
node app/wallet-to-base58.js /path/to/wallet.json
```

Copy the output and paste it into your `private.env` file.

## Alternative: User Service (No sudo required)

User services run in your user session and don't require root privileges:

**Setup:**
```bash
# Copy service file
mkdir -p ~/.config/systemd/user
cp systemd/oracle-client.service ~/.config/systemd/user/

# Create private key file
mkdir -p ~/.config/oracle-client
echo "ORACLE_PRIVATE_KEY=your_key_here" > ~/.config/oracle-client/private.env
chmod 600 ~/.config/oracle-client/private.env

# Update service file to use %h (home directory)
nano ~/.config/systemd/user/oracle-client.service
# Change: EnvironmentFile=%h/.config/oracle-client/private.env

# Enable and start
systemctl --user daemon-reload
systemctl --user enable oracle-client
systemctl --user start oracle-client

# Check status
systemctl --user status oracle-client
```

**Enable linger** (keeps user services running after logout):
```bash
sudo loginctl enable-linger $USER
```

## Monitoring

### Check if service is running

```bash
systemctl is-active oracle-client
```

### Monitor resource usage

```bash
systemctl status oracle-client
```

### Watch logs in real-time

```bash
sudo journalctl -u oracle-client -f --output=cat
```

## Comparison: PM2 vs Systemd

| Feature | PM2 | Systemd |
|---------|-----|---------|
| Auto-restart | ✓ | ✓ |
| Log management | ✓ (pm2 logs) | ✓ (journalctl) |
| Process monitoring | ✓ (pm2 monit) | ✓ (systemctl status) |
| Cluster mode | ✓ | ✗ |
| Native to OS | ✗ | ✓ (Linux) |
| Root privileges | Not required | May be required |
| Multiple processes | Easy | Manual |
| Cross-platform | ✓ | ✗ (Linux only) |

**Recommendation:**
- Use **PM2** for development and multi-process deployments
- Use **Systemd** for production single-process deployments on Linux servers

## Example Production Setup

```bash
# 1. Install as system service
sudo cp systemd/oracle-client.service /etc/systemd/system/

# 2. Create secure environment file
sudo mkdir -p /etc/oracle-client
sudo chmod 700 /etc/oracle-client
sudo bash -c 'cat > /etc/oracle-client/private.env << EOF
ORACLE_PRIVATE_KEY=your_base58_key_here
EOF'
sudo chmod 600 /etc/oracle-client/private.env

# 3. Update service file paths
sudo nano /etc/systemd/system/oracle-client.service

# 4. Enable and start
sudo systemctl daemon-reload
sudo systemctl enable oracle-client
sudo systemctl start oracle-client

# 5. Verify running
sudo systemctl status oracle-client
sudo journalctl -u oracle-client -f
```

## Uninstall

```bash
# Stop and disable service
sudo systemctl stop oracle-client
sudo systemctl disable oracle-client

# Remove service file
sudo rm /etc/systemd/system/oracle-client.service

# Remove environment file (contains private key!)
sudo rm -rf /etc/oracle-client

# Reload systemd
sudo systemctl daemon-reload
```
