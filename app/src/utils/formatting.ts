/**
 * Formatting utilities
 */

import { DECIMALS } from '../config/constants';

/**
 * Convert float price to fixed-point i64 (rounded to nearest integer)
 */
export function toFixedI64(num: number, decimals: number = DECIMALS): number {
  return Math.round(num * Math.pow(10, decimals));
}

/**
 * Convert fixed-point i64 to float
 */
export function fromFixedI64(i64: number, decimals: number = DECIMALS): number {
  return i64 / Math.pow(10, decimals);
}

/**
 * Format number with 2 decimal places
 */
export function formatPrice(x: number): string {
  return Number(x).toLocaleString(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Format number with commas and specified decimal places
 */
export function formatNumber(x: number, decimals: number = 2): string {
  return Number(x).toLocaleString(undefined, {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Format timestamp to ISO string
 */
export function formatTimestamp(ms: number): string {
  return new Date(ms).toISOString();
}
