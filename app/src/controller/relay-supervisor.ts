/**
 * Relay Supervisor
 *
 * Spawns, monitors, and restarts the relay process
 * Handles communication with relay via IPC
 */

import { ChildProcess, fork } from 'child_process';
import { EventEmitter } from 'events';

export interface SupervisorConfig {
  relayScriptPath: string;
  maxRestarts: number;
  restartDelayMs: number;
  healthCheckIntervalMs: number;
  healthCheckTimeoutMs: number;
  relayLogFile?: string;
}

export interface RelayHealth {
  running: boolean;
  lastHeartbeat: number;
  restartCount: number;
  uptime: number;
}

/**
 * Supervisor for relay process
 */
export class RelaySupervisor extends EventEmitter {
  private config: SupervisorConfig;
  private relayProcess: ChildProcess | null = null;
  private restartCount: number = 0;
  private lastHeartbeat: number = 0;
  private processStartTime: number = 0;
  private healthCheckTimer: NodeJS.Timeout | null = null;
  private isShuttingDown: boolean = false;

  constructor(config: SupervisorConfig) {
    super();
    this.config = config;
  }

  /**
   * Start the relay process
   */
  async start() {
    if (this.relayProcess) {
      throw new Error('Relay already running');
    }

    console.log('[Supervisor] Starting relay process...');
    this.spawnRelay();

    // Start health monitoring
    this.startHealthChecks();
  }

  /**
   * Spawn the relay child process
   */
  private spawnRelay() {
    try {
      this.processStartTime = Date.now();

      // Fork the relay process
      this.relayProcess = fork(this.config.relayScriptPath, [], {
        stdio: ['pipe', 'pipe', 'pipe', 'ipc'],
        env: {
          ...process.env,
          NODE_ENV: process.env.NODE_ENV || 'production',
          RELAY_LOG_FILE: this.config.relayLogFile || '',
        },
      });

      // Handle messages from relay
      this.relayProcess.on('message', (msg: any) => {
        this.handleRelayMessage(msg);
      });

      // Handle relay exit
      this.relayProcess.on('exit', (code, signal) => {
        console.log(`[Supervisor] Relay exited with code ${code}, signal ${signal}`);
        this.relayProcess = null;

        if (!this.isShuttingDown) {
          this.handleRelayCrash();
        }
      });

      // Handle relay errors
      this.relayProcess.on('error', (err) => {
        console.error('[Supervisor] Relay process error:', err);
        this.emit('error', err);
      });

      // Pipe relay output to console only if no relay log file
      if (!this.config.relayLogFile) {
        if (this.relayProcess.stdout) {
          this.relayProcess.stdout.on('data', (data) => {
            process.stdout.write(`[Relay] ${data}`);
          });
        }
        if (this.relayProcess.stderr) {
          this.relayProcess.stderr.on('data', (data) => {
            process.stderr.write(`[Relay] ${data}`);
          });
        }
      } else {
        // Relay output goes to its own log file
        if (this.relayProcess.stdout) {
          this.relayProcess.stdout.on('data', () => {
            // Output is handled by relay's own logger
          });
        }
        if (this.relayProcess.stderr) {
          this.relayProcess.stderr.on('data', () => {
            // Output is handled by relay's own logger
          });
        }
      }

      console.log('[Supervisor] Relay process started (PID:', this.relayProcess.pid, ')');
      this.emit('relay_started');
    } catch (err) {
      console.error('[Supervisor] Failed to spawn relay:', err);
      throw err;
    }
  }

  /**
   * Handle message from relay
   */
  private handleRelayMessage(msg: any) {
    if (msg.type === 'heartbeat') {
      this.lastHeartbeat = Date.now();
      this.emit('heartbeat', msg);
    } else if (msg.type === 'price_update') {
      this.lastHeartbeat = Date.now(); // Also counts as heartbeat
      this.emit('price_update', msg);
    } else {
      console.warn('[Supervisor] Unknown message type from relay:', msg.type);
    }
  }

  /**
   * Handle relay crash/exit
   */
  private handleRelayCrash() {
    this.restartCount++;

    if (this.restartCount > this.config.maxRestarts) {
      console.error(
        `[Supervisor] Relay crashed ${this.restartCount} times, exceeds max restarts (${this.config.maxRestarts})`
      );
      this.emit('max_restarts_exceeded');
      return;
    }

    console.log(
      `[Supervisor] Relay crashed, restarting in ${this.config.restartDelayMs}ms (attempt ${this.restartCount}/${this.config.maxRestarts})`
    );

    setTimeout(() => {
      if (!this.isShuttingDown) {
        this.spawnRelay();
      }
    }, this.config.restartDelayMs);
  }

  /**
   * Start health check monitoring
   */
  private startHealthChecks() {
    this.healthCheckTimer = setInterval(() => {
      this.checkHealth();
    }, this.config.healthCheckIntervalMs);
  }

  /**
   * Check relay health
   */
  private checkHealth() {
    if (!this.relayProcess) return;

    const now = Date.now();
    const timeSinceHeartbeat = now - this.lastHeartbeat;

    if (timeSinceHeartbeat > this.config.healthCheckTimeoutMs) {
      console.warn(
        `[Supervisor] No heartbeat from relay for ${timeSinceHeartbeat}ms, killing process...`
      );
      this.killRelay();
      this.handleRelayCrash();
    }
  }

  /**
   * Kill the relay process
   */
  private killRelay() {
    if (this.relayProcess) {
      try {
        this.relayProcess.kill('SIGTERM');
        // Force kill after 5 seconds
        setTimeout(() => {
          if (this.relayProcess) {
            console.log('[Supervisor] Force killing relay...');
            this.relayProcess.kill('SIGKILL');
          }
        }, 5000);
      } catch (err) {
        console.error('[Supervisor] Error killing relay:', err);
      }
    }
  }

  /**
   * Send message to relay
   */
  sendMessage(msg: any) {
    if (this.relayProcess && this.relayProcess.connected) {
      this.relayProcess.send(msg);
    }
  }

  /**
   * Get relay health status
   */
  getHealth(): RelayHealth {
    return {
      running: this.relayProcess !== null,
      lastHeartbeat: this.lastHeartbeat,
      restartCount: this.restartCount,
      uptime: this.processStartTime > 0 ? Date.now() - this.processStartTime : 0,
    };
  }

  /**
   * Stop the supervisor and relay
   */
  async stop() {
    this.isShuttingDown = true;

    console.log('[Supervisor] Stopping...');

    // Stop health checks
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }

    // Send shutdown message to relay
    this.sendMessage({ type: 'shutdown' });

    // Wait a bit then kill if still running
    await new Promise(resolve => setTimeout(resolve, 2000));
    this.killRelay();

    console.log('[Supervisor] Stopped');
  }
}
