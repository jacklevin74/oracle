/**
 * ANSI color codes for terminal output
 */

export const colors = {
  reset: '\x1b[0m',
  dim: '\x1b[2m',

  // Subtle vim-like colors (regular, not bright)
  gray: '\x1b[90m',
  darkGray: '\x1b[2m\x1b[37m',

  // Main colors (muted)
  blue: '\x1b[34m',
  cyan: '\x1b[36m',
  green: '\x1b[32m',
  yellow: '\x1b[33m',
  magenta: '\x1b[35m',
  red: '\x1b[31m',
  white: '\x1b[37m',

  // Slightly emphasized (for important values)
  brightCyan: '\x1b[96m',
  brightGreen: '\x1b[92m',
  brightYellow: '\x1b[93m',
} as const;

/**
 * Colorize text with ANSI codes
 */
export function colorize(text: string, color: keyof typeof colors): string {
  return `${colors[color]}${text}${colors.reset}`;
}

/**
 * Strip ANSI color codes from text
 */
export function stripColors(text: string): string {
  return text.replace(/\x1b\[[0-9;]*m/g, '');
}
