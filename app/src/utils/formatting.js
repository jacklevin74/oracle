"use strict";
/**
 * Formatting utilities
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.toFixedI64 = toFixedI64;
exports.fromFixedI64 = fromFixedI64;
exports.formatPrice = formatPrice;
exports.formatNumber = formatNumber;
exports.formatTimestamp = formatTimestamp;
const constants_1 = require("../config/constants");
/**
 * Convert float price to fixed-point i64 (rounded to nearest integer)
 */
function toFixedI64(num, decimals = constants_1.DECIMALS) {
    return Math.round(num * Math.pow(10, decimals));
}
/**
 * Convert fixed-point i64 to float
 */
function fromFixedI64(i64, decimals = constants_1.DECIMALS) {
    return i64 / Math.pow(10, decimals);
}
/**
 * Format number with 2 decimal places
 */
function formatPrice(x) {
    return Number(x).toLocaleString(undefined, {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
    });
}
/**
 * Format number with commas and specified decimal places
 */
function formatNumber(x, decimals = 2) {
    return Number(x).toLocaleString(undefined, {
        minimumFractionDigits: decimals,
        maximumFractionDigits: decimals,
    });
}
/**
 * Format timestamp to ISO string
 */
function formatTimestamp(ms) {
    return new Date(ms).toISOString();
}
