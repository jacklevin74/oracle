"use strict";
/**
 * Lock file manager to prevent multiple instances
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
exports.LockFileManager = void 0;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const types_1 = require("../types");
const constants_1 = require("../config/constants");
/**
 * Lock file manager
 */
class LockFileManager {
    constructor(baseDir = __dirname) {
        this.lockData = null;
        this.lockFilePath = path.join(baseDir, constants_1.LOCK_FILE_NAME);
    }
    /**
     * Check if a process is running
     */
    isProcessRunning(pid) {
        try {
            // Signal 0 checks if process exists without sending a signal
            process.kill(pid, 0);
            return true;
        }
        catch (_a) {
            return false;
        }
    }
    /**
     * Check if lock file exists and if the process is still running
     */
    checkExisting() {
        if (!fs.existsSync(this.lockFilePath)) {
            return { exists: false, data: null, isRunning: false };
        }
        try {
            const content = fs.readFileSync(this.lockFilePath, 'utf8');
            const data = JSON.parse(content);
            const isRunning = this.isProcessRunning(data.pid);
            return { exists: true, data, isRunning };
        }
        catch (error) {
            // Invalid lock file
            return { exists: true, data: null, isRunning: false };
        }
    }
    /**
     * Create a lock file for the current process
     */
    create(args) {
        const existing = this.checkExisting();
        if (existing.exists && existing.isRunning && existing.data) {
            throw new types_1.LockFileError(`Oracle client is already running\n` +
                `   PID: ${existing.data.pid}\n` +
                `   Started: ${existing.data.started}\n` +
                `\n   To stop the running instance:\n` +
                `   kill ${existing.data.pid}\n` +
                `\n   To force start (if lock is stale):\n` +
                `   rm ${this.lockFilePath}\n`);
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
    remove() {
        try {
            if (fs.existsSync(this.lockFilePath)) {
                fs.unlinkSync(this.lockFilePath);
            }
            this.lockData = null;
        }
        catch (error) {
            // Ignore errors during cleanup
        }
    }
    /**
     * Setup automatic cleanup on process exit
     */
    setupCleanup() {
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
    getLockFilePath() {
        return this.lockFilePath;
    }
    /**
     * Get current lock data
     */
    getLockData() {
        return this.lockData;
    }
}
exports.LockFileManager = LockFileManager;
