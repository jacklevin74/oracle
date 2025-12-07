"use strict";
/**
 * Structured logger with file and console output support
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.Logger = void 0;
exports.initLogger = initLogger;
exports.getLogger = getLogger;
const fs = __importStar(require("fs"));
const colors_1 = require("../config/colors");
/**
 * Logger class for structured logging with optional file output
 */
class Logger {
    constructor(options = {}) {
        var _a;
        this.logStream = null;
        this.verbose = (_a = options.verbose) !== null && _a !== void 0 ? _a : false;
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
    setupFileLogging(logFile) {
        this.logStream = fs.createWriteStream(logFile, { flags: 'a' });
        // Override console methods to write to file only
        console.log = (...args) => {
            var _a;
            const message = this.formatArgs(args);
            (_a = this.logStream) === null || _a === void 0 ? void 0 : _a.write(`${new Date().toISOString()} [LOG] ${message}\n`);
        };
        console.error = (...args) => {
            var _a;
            const message = this.formatArgs(args);
            (_a = this.logStream) === null || _a === void 0 ? void 0 : _a.write(`${new Date().toISOString()} [ERROR] ${message}\n`);
        };
        console.warn = (...args) => {
            var _a;
            const message = this.formatArgs(args);
            (_a = this.logStream) === null || _a === void 0 ? void 0 : _a.write(`${new Date().toISOString()} [WARN] ${message}\n`);
        };
        this.originalConsoleLog(`📝 Logging to file: ${logFile}`);
        this.originalConsoleLog(`   All output will go to the log file only`);
    }
    /**
     * Format console arguments to string
     */
    formatArgs(args) {
        return args
            .map((arg) => {
            if (typeof arg === 'string') {
                // Strip ANSI colors for file logging
                return (0, colors_1.stripColors)(arg);
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
    logToConsole(...args) {
        this.originalConsoleLog(...args);
    }
    /**
     * Log error to original console (bypasses file logging)
     */
    errorToConsole(...args) {
        this.originalConsoleError(...args);
    }
    /**
     * Log warning to original console (bypasses file logging)
     */
    warnToConsole(...args) {
        this.originalConsoleWarn(...args);
    }
    /**
     * Debug level logging (only when verbose)
     */
    debug(...args) {
        if (this.verbose) {
            console.log(`${colors_1.colors.gray}[DEBUG]${colors_1.colors.reset}`, ...args);
        }
    }
    /**
     * Info level logging
     */
    info(...args) {
        console.log(...args);
    }
    /**
     * Warning level logging
     */
    warn(...args) {
        console.warn(`${colors_1.colors.yellow}[WARN]${colors_1.colors.reset}`, ...args);
    }
    /**
     * Error level logging
     */
    error(...args) {
        console.error(`${colors_1.colors.red}[ERROR]${colors_1.colors.reset}`, ...args);
    }
    /**
     * Verbose-only logging
     */
    verboseLog(...args) {
        if (this.verbose) {
            console.log(...args);
        }
    }
    /**
     * Check if verbose mode is enabled
     */
    isVerbose() {
        return this.verbose;
    }
    /**
     * Close the log stream
     */
    close() {
        if (this.logStream) {
            this.logStream.end();
            this.logStream = null;
        }
    }
    /**
     * Restore original console methods
     */
    restore() {
        console.log = this.originalConsoleLog;
        console.error = this.originalConsoleError;
        console.warn = this.originalConsoleWarn;
    }
}
exports.Logger = Logger;
/**
 * Global logger instance (initialized by main app)
 */
let globalLogger = null;
/**
 * Initialize the global logger
 */
function initLogger(options) {
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
function getLogger() {
    if (!globalLogger) {
        globalLogger = new Logger();
    }
    return globalLogger;
}
