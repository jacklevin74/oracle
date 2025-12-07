"use strict";
/**
 * Solana transaction builder for oracle price updates
 */
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.TransactionBuilder = void 0;
const web3_js_1 = require("@solana/web3.js");
const types_1 = require("../types");
const constants_1 = require("../config/constants");
/**
 * Encode u8 (unsigned 8-bit integer)
 */
function encodeU8(n) {
    const b = Buffer.alloc(1);
    b.writeUInt8(n);
    return b;
}
/**
 * Encode i64 (signed 64-bit integer as two's complement)
 */
function encodeI64(n) {
    let x = BigInt(n);
    if (x < BigInt(0)) {
        x = (BigInt(1) << BigInt(64)) + x;
    }
    const b = Buffer.alloc(8);
    b.writeBigUInt64LE(x);
    return b;
}
/**
 * Convert PublicKey to Buffer
 */
function publicKeyToBuffer(pk) {
    return Buffer.from(pk.toBytes());
}
/**
 * Transaction builder for oracle operations
 */
class TransactionBuilder {
    constructor(connection) {
        this.connection = connection;
        this.programId = constants_1.PROGRAM_ID;
        this.blockhashCache = { blockhash: null, lastValidBlockHeight: 0, ts: 0 };
        // Derive state PDA
        const [statePda] = web3_js_1.PublicKey.findProgramAddressSync([constants_1.STATE_SEED], this.programId);
        this.statePda = statePda;
    }
    /**
     * Get state PDA address
     */
    getStatePda() {
        return this.statePda;
    }
    /**
     * Refresh blockhash cache
     */
    refreshBlockhash() {
        return __awaiter(this, void 0, void 0, function* () {
            const { blockhash, lastValidBlockHeight } = yield this.connection.getLatestBlockhash('processed');
            this.blockhashCache = { blockhash, lastValidBlockHeight, ts: Date.now() };
        });
    }
    /**
     * Ensure blockhash is fresh (refresh if older than maxAgeMs)
     */
    ensureBlockhashFresh() {
        return __awaiter(this, arguments, void 0, function* (maxAgeMs = 2000) {
            if (!this.blockhashCache.blockhash || Date.now() - this.blockhashCache.ts > maxAgeMs) {
                yield this.refreshBlockhash();
            }
        });
    }
    /**
     * Get current blockhash
     */
    getBlockhash() {
        if (!this.blockhashCache.blockhash) {
            throw new types_1.TransactionError('Blockhash not initialized');
        }
        return this.blockhashCache.blockhash;
    }
    /**
     * Build initialize instruction
     */
    buildInitializeInstruction(updateAuthority) {
        const data = Buffer.concat([
            Buffer.from(constants_1.DISCRIMINATORS.initialize),
            publicKeyToBuffer(updateAuthority),
        ]);
        const keys = [
            { pubkey: this.statePda, isSigner: false, isWritable: true },
            { pubkey: updateAuthority, isSigner: true, isWritable: true },
            { pubkey: web3_js_1.SystemProgram.programId, isSigner: false, isWritable: false },
        ];
        return new web3_js_1.TransactionInstruction({
            programId: this.programId,
            keys,
            data,
        });
    }
    /**
     * Build set_price instruction
     */
    buildSetPriceInstruction(asset, index, priceI64, clientTsMs, signer) {
        const data = Buffer.concat([
            Buffer.from(constants_1.DISCRIMINATORS.set_price),
            encodeU8(asset),
            encodeU8(index),
            encodeI64(priceI64),
            encodeI64(clientTsMs),
        ]);
        const keys = [
            { pubkey: this.statePda, isSigner: false, isWritable: true },
            { pubkey: signer, isSigner: true, isWritable: false },
        ];
        return new web3_js_1.TransactionInstruction({
            programId: this.programId,
            keys,
            data,
        });
    }
    /**
     * Build batch_set_prices instruction
     */
    buildBatchSetPricesInstruction(index, btcPrice, ethPrice, solPrice, hypePrice, clientTsMs, signer) {
        const data = Buffer.concat([
            Buffer.from(constants_1.DISCRIMINATORS.batch_set_prices),
            encodeU8(index),
            encodeI64(btcPrice),
            encodeI64(ethPrice),
            encodeI64(solPrice),
            encodeI64(hypePrice),
            encodeI64(clientTsMs),
        ]);
        const keys = [
            { pubkey: this.statePda, isSigner: false, isWritable: true },
            { pubkey: signer, isSigner: true, isWritable: false },
        ];
        return new web3_js_1.TransactionInstruction({
            programId: this.programId,
            keys,
            data,
        });
    }
    /**
     * Initialize state account if it doesn't exist
     */
    initializeIfNeeded(payer) {
        return __awaiter(this, void 0, void 0, function* () {
            const info = yield this.connection.getAccountInfo(this.statePda);
            if (info) {
                return false; // Already initialized
            }
            console.log('Initializing state PDA…');
            // Ensure fresh blockhash for init
            yield this.ensureBlockhashFresh();
            const tx = new web3_js_1.Transaction()
                .add(web3_js_1.ComputeBudgetProgram.setComputeUnitLimit({ units: constants_1.COMPUTE_UNIT_LIMIT }))
                .add(this.buildInitializeInstruction(payer.publicKey));
            tx.feePayer = payer.publicKey;
            tx.recentBlockhash = this.getBlockhash();
            const sig = yield (0, web3_js_1.sendAndConfirmTransaction)(this.connection, tx, [payer], {
                skipPreflight: false,
                commitment: 'processed',
            });
            console.log('Init tx:', sig);
            return true;
        });
    }
    /**
     * Send batch price update transaction
     */
    sendBatchPriceUpdate(payer, index, btcPrice, ethPrice, solPrice, hypePrice, clientTsMs) {
        return __awaiter(this, void 0, void 0, function* () {
            // Ensure fresh blockhash
            yield this.ensureBlockhashFresh();
            const tx = new web3_js_1.Transaction()
                .add(web3_js_1.ComputeBudgetProgram.setComputeUnitLimit({ units: constants_1.COMPUTE_UNIT_LIMIT }))
                .add(this.buildBatchSetPricesInstruction(index, btcPrice, ethPrice, solPrice, hypePrice, clientTsMs, payer.publicKey));
            tx.feePayer = payer.publicKey;
            tx.recentBlockhash = this.getBlockhash();
            try {
                const sig = yield (0, web3_js_1.sendAndConfirmTransaction)(this.connection, tx, [payer], {
                    skipPreflight: false,
                    commitment: 'processed',
                });
                return sig;
            }
            catch (error) {
                const msg = error instanceof Error ? error.message.toLowerCase() : String(error);
                const expired = msg.includes('block height exceeded') ||
                    msg.includes('blockhash not found') ||
                    (msg.includes('signature') && msg.includes('expired'));
                if (expired) {
                    throw new types_1.TransactionError(`Blockhash expired: ${error instanceof Error ? error.message : String(error)}`);
                }
                throw new types_1.TransactionError(`Transaction failed: ${error instanceof Error ? error.message : String(error)}`);
            }
        });
    }
}
exports.TransactionBuilder = TransactionBuilder;
