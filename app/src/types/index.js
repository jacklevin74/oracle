"use strict";
/**
 * Type definitions for the Oracle Price Updater
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.LockFileError = exports.TransactionError = exports.ConfigurationError = exports.AuthenticationError = exports.OracleError = exports.LogLevel = exports.Asset = void 0;
/**
 * Asset types supported by the oracle
 */
var Asset;
(function (Asset) {
    Asset[Asset["BTC"] = 1] = "BTC";
    Asset[Asset["ETH"] = 2] = "ETH";
    Asset[Asset["SOL"] = 3] = "SOL";
    Asset[Asset["HYPE"] = 4] = "HYPE";
})(Asset || (exports.Asset = Asset = {}));
/**
 * Log levels
 */
var LogLevel;
(function (LogLevel) {
    LogLevel["DEBUG"] = "DEBUG";
    LogLevel["INFO"] = "INFO";
    LogLevel["WARN"] = "WARN";
    LogLevel["ERROR"] = "ERROR";
})(LogLevel || (exports.LogLevel = LogLevel = {}));
/**
 * Custom error types
 */
class OracleError extends Error {
    constructor(message, code) {
        super(message);
        this.code = code;
        this.name = 'OracleError';
    }
}
exports.OracleError = OracleError;
class AuthenticationError extends OracleError {
    constructor(message) {
        super(message, 'AUTH_ERROR');
        this.name = 'AuthenticationError';
    }
}
exports.AuthenticationError = AuthenticationError;
class ConfigurationError extends OracleError {
    constructor(message) {
        super(message, 'CONFIG_ERROR');
        this.name = 'ConfigurationError';
    }
}
exports.ConfigurationError = ConfigurationError;
class TransactionError extends OracleError {
    constructor(message) {
        super(message, 'TX_ERROR');
        this.name = 'TransactionError';
    }
}
exports.TransactionError = TransactionError;
class LockFileError extends OracleError {
    constructor(message) {
        super(message, 'LOCK_ERROR');
        this.name = 'LockFileError';
    }
}
exports.LockFileError = LockFileError;
