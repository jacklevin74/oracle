/**
 * Lock file manager to prevent multiple instances
 */

import * as fs from 'fs';
import * as path from 'path';
import { LockFileData, LockFileError } from '../types';
import { LOCK_FILE_NAME } from '../config/constants';

/**
 * Lock file manager
 */
export class LockFileManager {
  private lockFilePath: string;
  private lockData: LockFileData | null = null;

  constructor(baseDir: string = __dirname) {
    this.lockFilePath = path.join(baseDir, LOCK_FILE_NAME);
  }

  /**
   * Check if a process is running
   */
  private isProcessRunning(pid: number): boolean {
    try {
      // Signal 0 checks if process exists without sending a signal
      process.kill(pid, 0);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Check if lock file exists and if the process is still running
   */
  checkExisting(): { exists: boolean; data: LockFileData | null; isRunning: boolean } {
    if (!fs.existsSync(this.lockFilePath)) {
      return { exists: false, data: null, isRunning: false };
    }

    try {
      const content = fs.readFileSync(this.lockFilePath, 'utf8');
      const data: LockFileData = JSON.parse(content);
      const isRunning = this.isProcessRunning(data.pid);

      return { exists: true, data, isRunning };
    } catch (error) {
      // Invalid lock file
      return { exists: true, data: null, isRunning: false };
    }
  }

  /**
   * Create a lock file for the current process
   */
  create(args: string[]): void {
    const existing = this.checkExisting();

    if (existing.exists && existing.isRunning && existing.data) {
      throw new LockFileError(
        `Oracle client is already running\n` +
        `   PID: ${existing.data.pid}\n` +
        `   Started: ${existing.data.started}\n` +
        `\n   To stop the running instance:\n` +
        `   kill ${existing.data.pid}\n` +
        `\n   To force start (if lock is stale):\n` +
        `   rm ${this.lockFilePath}\n`
      );
    }

    // Remove stale lock file if exists
    if (existing.exists) {
      this.remove();
    }

    // Create new lock file
    this.lockData = {
      pid: process.pid,
      started: new Date().toISOString(),
      args,
    };

    fs.writeFileSync(this.lockFilePath, JSON.stringify(this.lockData, null, 2));
  }

  /**
   * Remove the lock file
   */
  remove(): void {
    try {
      if (fs.existsSync(this.lockFilePath)) {
        fs.unlinkSync(this.lockFilePath);
      }
      this.lockData = null;
    } catch (error) {
      // Ignore errors during cleanup
    }
  }

  /**
   * Setup automatic cleanup on process exit
   */
  setupCleanup(): void {
    const cleanup = () => {
      this.remove();
    };

    process.on('exit', cleanup);
    process.on('SIGTERM', () => {
      cleanup();
      process.exit(0);
    });
    process.on('SIGINT', () => {
      cleanup();
      process.exit(0);
    });
  }

  /**
   * Get lock file path
   */
  getLockFilePath(): string {
    return this.lockFilePath;
  }

  /**
   * Get current lock data
   */
  getLockData(): LockFileData | null {
    return this.lockData;
  }
}
