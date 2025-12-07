"use strict";
/**
 * Secure private key management and authentication
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
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.readKeypairFromFile = readKeypairFromFile;
exports.keypairFromBase58 = keypairFromBase58;
exports.keypairFromArray = keypairFromArray;
exports.parsePrivateKey = parsePrivateKey;
exports.promptPrivateKey = promptPrivateKey;
exports.readPrivateKeyFromStdin = readPrivateKeyFromStdin;
exports.validateAuthorizedKeypair = validateAuthorizedKeypair;
exports.securelyEraseString = securelyEraseString;
exports.clearPrivateKeyFromEnv = clearPrivateKeyFromEnv;
const fs = __importStar(require("fs"));
const path = __importStar(require("path"));
const readline = __importStar(require("readline"));
const web3_js_1 = require("@solana/web3.js");
const bs58_1 = __importDefault(require("bs58"));
const types_1 = require("../types");
const constants_1 = require("../config/constants");
/**
 * Read keypair from JSON file
 */
function readKeypairFromFile(filePath) {
    try {
        const absolutePath = path.isAbsolute(filePath)
            ? filePath
            : path.join(process.cwd(), filePath);
        if (!fs.existsSync(absolutePath)) {
            throw new types_1.AuthenticationError(`Wallet file not found: ${absolutePath}`);
        }
        const secretKeyJson = fs.readFileSync(absolutePath, 'utf8');
        const secretKey = Uint8Array.from(JSON.parse(secretKeyJson));
        return web3_js_1.Keypair.fromSecretKey(secretKey);
    }
    catch (error) {
        if (error instanceof types_1.AuthenticationError) {
            throw error;
        }
        throw new types_1.AuthenticationError(`Failed to read keypair from file: ${error instanceof Error ? error.message : String(error)}`);
    }
}
/**
 * Create keypair from base58 private key string
 */
function keypairFromBase58(base58PrivateKey) {
    try {
        const decoded = bs58_1.default.decode(base58PrivateKey);
        return web3_js_1.Keypair.fromSecretKey(decoded);
    }
    catch (error) {
        throw new types_1.AuthenticationError('Invalid base58 private key format');
    }
}
/**
 * Create keypair from array of bytes [1,2,3,...]
 */
function keypairFromArray(secretKeyArray) {
    try {
        return web3_js_1.Keypair.fromSecretKey(Uint8Array.from(secretKeyArray));
    }
    catch (error) {
        throw new types_1.AuthenticationError('Invalid secret key array format');
    }
}
/**
 * Parse private key from string (base58 or JSON array)
 */
function parsePrivateKey(input) {
    const trimmed = input.trim();
    // Try to parse as JSON array first
    if (trimmed.startsWith('[')) {
        try {
            const arr = JSON.parse(trimmed);
            if (!Array.isArray(arr)) {
                throw new Error('Not an array');
            }
            return keypairFromArray(arr);
        }
        catch (error) {
            throw new types_1.AuthenticationError('Invalid JSON array format');
        }
    }
    // Otherwise treat as base58
    return keypairFromBase58(trimmed);
}
/**
 * Prompt for private key without echoing (like password input)
 */
function promptPrivateKey() {
    return __awaiter(this, void 0, void 0, function* () {
        return new Promise((resolve, reject) => {
            let input = '';
            console.log('\n🔐 Enter your private key (input will be hidden):');
            console.log('   Accepts: base58 string or JSON array [1,2,3,...]');
            console.log('');
            process.stdout.write('Private Key: ');
            // Set raw mode to read key-by-key without echo
            if (process.stdin.isTTY) {
                process.stdin.setRawMode(true);
            }
            process.stdin.resume();
            process.stdin.setEncoding('utf8');
            const onData = (char) => {
                if (char === '\n' || char === '\r' || char === '\u0003' || char === '\u0004') {
                    // Enter, Ctrl+C, or Ctrl+D pressed
                    process.stdin.pause();
                    if (process.stdin.isTTY) {
                        process.stdin.setRawMode(false);
                    }
                    process.stdin.removeListener('data', onData);
                    console.log('\n'); // New line after hidden input
                    if (char === '\u0003') {
                        // Ctrl+C
                        console.log('\nCancelled by user');
                        process.exit(0);
                    }
                    if (!input || input.trim().length === 0) {
                        reject(new types_1.AuthenticationError('No input received'));
                    }
                    else {
                        resolve(input.trim());
                    }
                }
                else if (char === '\u007f' || char === '\b') {
                    // Backspace
                    if (input.length > 0) {
                        input = input.slice(0, -1);
                    }
                }
                else {
                    // Regular character
                    input += char;
                }
            };
            process.stdin.on('data', onData);
        });
    });
}
/**
 * Read private key from stdin (non-interactive)
 */
function readPrivateKeyFromStdin() {
    return __awaiter(this, void 0, void 0, function* () {
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
            terminal: false,
        });
        return new Promise((resolve) => {
            rl.on('line', (line) => {
                resolve(line.trim());
                rl.close();
            });
        });
    });
}
/**
 * Validate that a keypair is authorized and get its index
 */
function validateAuthorizedKeypair(keypair) {
    const publicKey = keypair.publicKey.toBase58();
    const index = constants_1.ALLOWED_UPDATERS.get(publicKey);
    if (!index || !constants_1.VALID_INDICES.includes(index)) {
        throw new types_1.AuthenticationError(`Public key not authorized: ${publicKey}\n` +
            `This key is not in the allowed updaters list`);
    }
    return index;
}
/**
 * Securely clear a string from memory (overwrite with zeros)
 */
function securelyEraseString(str) {
    // In JavaScript, we can't truly overwrite memory, but we can at least
    // overwrite the variable and hope GC picks it up
    // This is a best-effort approach
    str = '0'.repeat(str.length);
}
/**
 * Clear private key from environment variable
 */
function clearPrivateKeyFromEnv() {
    if (process.env.ORACLE_PRIVATE_KEY) {
        delete process.env.ORACLE_PRIVATE_KEY;
    }
}
