# Error Handling & Circuit Breaker

This document describes the robust error handling system added to the Oracle Controller to prevent crashes and handle transaction failures gracefully.

## Philosophy: Skip and Continue with Fresh Data

The controller **does NOT retry** failed transactions. Instead, it:
1. Logs the error with detailed metrics
2. Skips the failed transaction
3. Continues running and waits for the next price update
4. Uses fresh price data on the next attempt

This approach ensures price data is always current rather than retrying stale prices.

## Features

### 1. **Circuit Breaker Pattern**
Prevents the controller from continuously hammering the RPC when transactions are failing:
- Opens after **10 consecutive failures**
- Pauses transaction attempts for **60 seconds**
- Automatically resets and retries with fresh data after the cooldown period
- Logs clear warnings when circuit breaker opens/closes

### 2. **Error Categorization**
Intelligently categorizes errors into two types for better diagnostics:

**Transient Errors** (network/temporary issues):
- Block height exceeded
- Blockhash not found / expired
- Network timeouts
- Connection errors (ECONNREFUSED, ENOTFOUND)
- Rate limiting (429, 503, 504)

**Permanent Errors** (other failures):
- All other transaction errors
- May indicate configuration or authorization issues

### 3. **Detailed Error Logging**
Enhanced error messages include:
- Error type (transient vs permanent)
- Asset prices that failed to update
- Full error message
- Consecutive failure count
- Success rate percentage
- Clear indication that failed transaction is skipped

Example error log:
```
[Controller] Transaction failed (transient) - BTC=$94023.45, ETH=$3456.78
  Error: Blockhash not found
  Consecutive failures: 3
  Success rate: 247/250 (98.8%)
  Skipping failed transaction - will continue with fresh data
```

### 4. **Success Tracking**
- Tracks total successes and failures
- Calculates real-time success rate
- Automatically resets consecutive failure count on success
- Logs recovery message after failures

### 5. **Health Monitoring**
The `getStatus()` method now includes error metrics:

```javascript
{
  relay: { ... },
  prices: { ... },
  lastSent: { ... },
  updaterIndex: 1,
  errorMetrics: {
    consecutiveFailures: 0,
    totalSuccesses: 247,
    totalErrors: 3,
    successRate: 98.8,
    circuitBreakerOpen: false,
    lastFailureTime: "2025-12-21T11:46:05.424Z"
  }
}
```

## Benefits

1. **No More Crashes**: Controller continues running even during RPC outages
2. **Self-Healing**: Automatically recovers when RPC becomes healthy again
3. **Rate Limiting**: Circuit breaker prevents overwhelming unhealthy RPC endpoints
4. **Visibility**: Detailed logs help diagnose issues quickly
5. **Metrics**: Track reliability with success rate and error counts

## Configuration

Key thresholds (can be adjusted in code if needed):

- **Circuit breaker threshold**: 10 consecutive failures
- **Circuit breaker cooldown**: 60 seconds

## Example Scenarios

### Scenario 1: Temporary RPC Hiccup
```
[Controller] Transaction failed (transient) - BTC=$94000
  Error: Blockhash not found
  Consecutive failures: 1
  Success rate: 247/248 (99.6%)
  Skipping failed transaction - will continue with fresh data
✓ Updated: BTC=$94001 (tx: 5Hj7w2x...)
[Controller] Transaction succeeded after 1 failures - resetting error count
```

### Scenario 2: Extended RPC Outage (Circuit Breaker Activates)
```
[Controller] Transaction failed (transient) - BTC=$94000
  Consecutive failures: 9
  Skipping failed transaction - will continue with fresh data
[Controller] Transaction failed (transient) - BTC=$94005
  Consecutive failures: 10
  Skipping failed transaction - will continue with fresh data
⚠️  Circuit breaker OPENED - pausing transactions for 60 seconds

[Controller] Circuit breaker open - skipping transaction (resets in 58s)
[Controller] Circuit breaker open - skipping transaction (resets in 55s)
...
[Controller] Circuit breaker reset - retrying transactions
✓ Updated: BTC=$94050 (tx: 3Kd9m1...)
[Controller] Transaction succeeded after 10 failures - resetting error count
```

## Testing

The error handling has been tested with:
- Transient network errors
- Blockhash expiration
- RPC timeouts
- Rate limiting responses
- Complete RPC outages

All scenarios result in graceful degradation without crashes.
