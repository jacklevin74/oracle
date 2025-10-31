/**
 * Structured logger with file and console output support
 */

import * as fs from 'fs';
import { colors, stripColors } from '../config/colors';

export interface LoggerOptions {
  logFile?: string | null;
  verbose?: boolean;
}

/**
 * Logger class for structured logging with optional file output
 */
export class Logger {
  private logStream: fs.WriteStream | null = null;
  private verbose: boolean;
  private originalConsoleLog: typeof console.log;
  private originalConsoleError: typeof console.error;
  private originalConsoleWarn: typeof console.warn;

  constructor(options: LoggerOptions = {}) {
    this.verbose = options.verbose ?? false;

    // Preserve original console methods
    this.originalConsoleLog = console.log.bind(console);
    this.originalConsoleError = console.error.bind(console);
    this.originalConsoleWarn = console.warn.bind(console);

    if (options.logFile) {
      this.setupFileLogging(options.logFile);
    }
  }

  /**
   * Setup file logging by overriding console methods
   */
  private setupFileLogging(logFile: string): void {
    this.logStream = fs.createWriteStream(logFile, { flags: 'a' });

    // Override console methods to write to file only
    console.log = (...args: unknown[]) => {
      const message = this.formatArgs(args);
      this.logStream?.write(`${new Date().toISOString()} [LOG] ${message}\n`);
    };

    console.error = (...args: unknown[]) => {
      const message = this.formatArgs(args);
      this.logStream?.write(`${new Date().toISOString()} [ERROR] ${message}\n`);
    };

    console.warn = (...args: unknown[]) => {
      const message = this.formatArgs(args);
      this.logStream?.write(`${new Date().toISOString()} [WARN] ${message}\n`);
    };

    this.originalConsoleLog(`📝 Logging to file: ${logFile}`);
    this.originalConsoleLog(`   All output will go to the log file only`);
  }

  /**
   * Format console arguments to string
   */
  private formatArgs(args: unknown[]): string {
    return args
      .map((arg) => {
        if (typeof arg === 'string') {
          // Strip ANSI colors for file logging
          return stripColors(arg);
        }
        if (typeof arg === 'object') {
          return JSON.stringify(arg);
        }
        return String(arg);
      })
      .join(' ');
  }

  /**
   * Log to original console (bypasses file logging)
   */
  logToConsole(...args: unknown[]): void {
    this.originalConsoleLog(...args);
  }

  /**
   * Log error to original console (bypasses file logging)
   */
  errorToConsole(...args: unknown[]): void {
    this.originalConsoleError(...args);
  }

  /**
   * Log warning to original console (bypasses file logging)
   */
  warnToConsole(...args: unknown[]): void {
    this.originalConsoleWarn(...args);
  }

  /**
   * Debug level logging (only when verbose)
   */
  debug(...args: unknown[]): void {
    if (this.verbose) {
      console.log(`${colors.gray}[DEBUG]${colors.reset}`, ...args);
    }
  }

  /**
   * Info level logging
   */
  info(...args: unknown[]): void {
    console.log(...args);
  }

  /**
   * Warning level logging
   */
  warn(...args: unknown[]): void {
    console.warn(`${colors.yellow}[WARN]${colors.reset}`, ...args);
  }

  /**
   * Error level logging
   */
  error(...args: unknown[]): void {
    console.error(`${colors.red}[ERROR]${colors.reset}`, ...args);
  }

  /**
   * Verbose-only logging
   */
  verboseLog(...args: unknown[]): void {
    if (this.verbose) {
      console.log(...args);
    }
  }

  /**
   * Check if verbose mode is enabled
   */
  isVerbose(): boolean {
    return this.verbose;
  }

  /**
   * Close the log stream
   */
  close(): void {
    if (this.logStream) {
      this.logStream.end();
      this.logStream = null;
    }
  }

  /**
   * Restore original console methods
   */
  restore(): void {
    console.log = this.originalConsoleLog;
    console.error = this.originalConsoleError;
    console.warn = this.originalConsoleWarn;
  }
}

/**
 * Global logger instance (initialized by main app)
 */
let globalLogger: Logger | null = null;

/**
 * Initialize the global logger
 */
export function initLogger(options: LoggerOptions): Logger {
  if (globalLogger) {
    globalLogger.close();
    globalLogger.restore();
  }
  globalLogger = new Logger(options);
  return globalLogger;
}

/**
 * Get the global logger instance
 */
export function getLogger(): Logger {
  if (!globalLogger) {
    globalLogger = new Logger();
  }
  return globalLogger;
}
