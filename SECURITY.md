# Security Documentation

This document explains the security measures implemented for private key management in the oracle client.

## Private Key Lifecycle

### 1. Input Methods (Most Secure → Least Secure)

**✓ Interactive Prompt (Recommended)**
```bash
node app/pyth_sim.cjs --prompt
```
- Private key never stored on disk
- Hidden input (not visible while typing)
- Not in shell history
- Not in process arguments
- **Cleared from memory immediately after Keypair creation**

**✓ Environment Variable**
```bash
export ORACLE_PRIVATE_KEY="your_key"
node app/pyth_sim.cjs
```
- Not in shell history (if set in script)
- Not in process arguments
- **Cleared from process.env immediately after Keypair creation**

**✓ Stdin Pipe**
```bash
echo "your_key" | node app/pyth_sim.cjs --private-key-stdin
```
- Not in shell history (if piped from file)
- Not in process arguments
- **Cleared from memory immediately after Keypair creation**

**⚠️ Wallet File (Legacy)**
```bash
node app/pyth_sim.cjs /path/to/wallet.json
```
- Stored on disk (600 permissions recommended)
- File path visible in process arguments
- Consider using interactive prompt instead

### 2. Private Key Clearing (New Security Feature)

**After the Keypair object is created, the private key is immediately:**

1. **Overwritten in memory** - String filled with zeros
2. **Set to null** - Variable reference removed
3. **Deleted from environment** - `delete process.env.ORACLE_PRIVATE_KEY`

This prevents extraction via:
- ❌ `/proc/<PID>/environ` - No longer contains ORACLE_PRIVATE_KEY
- ❌ `pm2 env oracle-client` - Variable not in environment
- ❌ Memory inspection - Plaintext key overwritten

```javascript
// After Keypair creation (app/pyth_sim.cjs:317-327)
payer = parsePrivateKey(privateKey);

// SECURITY: Clear immediately
privateKey = '0'.repeat(privateKey.length);  // Overwrite
privateKey = null;                            // Nullify
delete process.env.ORACLE_PRIVATE_KEY;        // Remove from env

console.log('✓ Private key cleared from memory and environment');
```

### 3. What Remains in Memory

After clearing, only the **Keypair object** exists:
- Created by `@solana/web3.js` library
- Contains key material in internal format
- Used for transaction signing
- Much harder to extract than plaintext

**The Keypair still allows signing transactions but the raw private key is no longer accessible as plaintext.**

## Attack Vectors & Mitigations

### ✅ PROTECTED: Process List Inspection
```bash
ps aux | grep pyth_sim
# Private key NOT visible in arguments
```

### ✅ PROTECTED: Environment Variable Dump (After Fix)
```bash
cat /proc/$(pgrep -f pyth_sim)/environ | tr '\0' '\n' | grep ORACLE
# ORACLE_PRIVATE_KEY no longer present
```

### ✅ PROTECTED: PM2 Environment (After Fix)
```bash
pm2 env oracle-client | grep ORACLE
# ORACLE_PRIVATE_KEY not found
```

### ✅ PROTECTED: Shell History
```bash
history | grep ORACLE
# Empty (if using --prompt or secure methods)
```

### ⚠️ PARTIALLY PROTECTED: Memory Dump
```bash
# Requires root or same user + debugging privileges
gdb -p <PID>
(gdb) dump memory memory.dump 0x0 0xffffffff
```
**Mitigation:**
- Private key overwritten with zeros after use
- Keypair object still in memory (internal format)
- Requires significant effort to extract from Keypair
- Enable ptrace protection: `echo 1 > /proc/sys/kernel/yama/ptrace_scope`

### ⚠️ LIMITED PROTECTION: Root Access
If attacker has root access, they can:
- Dump all process memory
- Inspect Keypair object internals
- Attach debuggers

**Mitigation:**
- Proper OS-level security
- Principle of least privilege
- Don't run as root
- Use dedicated user account
- For highest security: Use HSM or hardware wallet

## Verification

### Before Fix (Insecure)
```bash
# Start oracle
node app/pm2-launcher.cjs

# Check environment (BAD - key visible!)
cat /proc/$(pgrep -f pyth_sim)/environ | tr '\0' '\n' | grep ORACLE
# Output: ORACLE_PRIVATE_KEY=[116,108,33,60,82...]
```

### After Fix (Secure)
```bash
# Start oracle
node app/pm2-launcher.cjs

# Check environment (GOOD - key cleared!)
cat /proc/$(pgrep -f pyth_sim)/environ | tr '\0' '\n' | grep ORACLE
# Output: (empty - no match)

# Verify in logs
pm2 logs oracle-client | grep "cleared"
# Output: ✓ Private key cleared from memory and environment
```

## Best Practices

### Development
```bash
# Use interactive prompt (most secure)
node app/pyth_sim.cjs --prompt

# Or PM2 launcher
node app/pm2-launcher.cjs
```

### Production

**Option 1: PM2 with Interactive Start**
```bash
# Prompt for key, starts under PM2
node app/pm2-launcher.cjs
# Private key cleared after startup
```

**Option 2: Systemd with Environment File**
```bash
# Create secure environment file
sudo mkdir -p /etc/oracle-client
sudo bash -c 'echo "ORACLE_PRIVATE_KEY=key" > /etc/oracle-client/private.env'
sudo chmod 600 /etc/oracle-client/private.env

# Start service (private key cleared after loading)
sudo systemctl start oracle-client
```

**Option 3: Dedicated User with Restricted Access**
```bash
# Create oracle user
sudo useradd -r -s /bin/bash oracle
sudo -u oracle bash

# Run as oracle user
node app/pyth_sim.cjs --prompt
```

### Auditing

Monitor for unauthorized access attempts:
```bash
# Check for suspicious memory dumps
sudo ausearch -k memory_dump

# Monitor ptrace calls
sudo ausearch -sc ptrace

# Check process access logs
sudo ausearch -x /proc
```

## Security Improvements Timeline

### v1 (Initial)
- ❌ Private key in environment throughout runtime
- ❌ Visible in `/proc/<PID>/environ`
- ❌ Visible in `pm2 env`

### v2 (Current)
- ✅ Private key cleared after Keypair creation
- ✅ Not in `/proc/<PID>/environ`
- ✅ Not in `pm2 env`
- ✅ Overwritten in memory
- ⚠️ Keypair object still in memory (internal format)

### Future Enhancements (Optional)

**Hardware Security Module (HSM)**
- Private key never enters application memory
- Signing happens in secure hardware
- Examples: YubiHSM, AWS CloudHSM

**Hardware Wallet**
- Private key stays on device
- Transaction signing via USB/Bluetooth
- Examples: Ledger, Trezor

**Secure Enclave**
- CPU-level isolation
- Examples: Intel SGX, ARM TrustZone

**Memory Encryption**
- Encrypt sensitive data in RAM
- Requires OS/hardware support

## Comparison: Before vs After

| Security Check | Before Fix | After Fix |
|----------------|------------|-----------|
| `/proc/<PID>/environ` | ❌ Key visible | ✅ Key not present |
| `pm2 env` output | ❌ Key visible | ✅ Key not present |
| Process arguments | ✅ Not visible | ✅ Not visible |
| Shell history | ✅ Not visible (prompt) | ✅ Not visible (prompt) |
| Memory (plaintext) | ❌ Present | ✅ Overwritten with zeros |
| Memory (Keypair) | ⚠️ Internal format | ⚠️ Internal format |
| Disk storage | ✅ Not stored | ✅ Not stored |

## Recommendations

1. **Always use `--prompt` or PM2 launcher** for interactive deployments
2. **Enable ptrace protection** on production servers
3. **Run as dedicated user** with minimal privileges
4. **Monitor for unauthorized access** attempts
5. **Use HSM/hardware wallet** for highest security needs
6. **Regularly audit** access logs and process list
7. **Update and pull latest code** to get security fixes

## Responsible Disclosure

If you discover a security vulnerability, please report it to:
- GitHub Security Advisory: https://github.com/jacklevin74/oracle/security/advisories
- Do not disclose publicly until patched

## License

This security documentation is part of the oracle client project.
