/**
 * Solana transaction builder for oracle price updates
 */

import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
  TransactionInstruction,
  sendAndConfirmTransaction,
  ComputeBudgetProgram,
} from '@solana/web3.js';
import { Asset, BlockhashCache, TransactionError } from '../types';
import {
  PROGRAM_ID,
  STATE_SEED,
  DISCRIMINATORS,
  COMPUTE_UNIT_LIMIT,
} from '../config/constants';

/**
 * Encode u8 (unsigned 8-bit integer)
 */
function encodeU8(n: number): Buffer {
  const b = Buffer.alloc(1);
  b.writeUInt8(n);
  return b;
}

/**
 * Encode i64 (signed 64-bit integer as two's complement)
 */
function encodeI64(n: number): Buffer {
  let x = BigInt(n);
  if (x < 0n) {
    x = (1n << 64n) + x;
  }
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(x);
  return b;
}

/**
 * Convert PublicKey to Buffer
 */
function publicKeyToBuffer(pk: PublicKey): Buffer {
  return Buffer.from(pk.toBytes());
}

/**
 * Transaction builder for oracle operations
 */
export class TransactionBuilder {
  private connection: Connection;
  private programId: PublicKey;
  private statePda: PublicKey;
  private blockhashCache: BlockhashCache;

  constructor(connection: Connection) {
    this.connection = connection;
    this.programId = PROGRAM_ID;
    this.blockhashCache = { blockhash: null, lastValidBlockHeight: 0, ts: 0 };

    // Derive state PDA
    const [statePda] = PublicKey.findProgramAddressSync([STATE_SEED], this.programId);
    this.statePda = statePda;
  }

  /**
   * Get state PDA address
   */
  getStatePda(): PublicKey {
    return this.statePda;
  }

  /**
   * Refresh blockhash cache
   */
  async refreshBlockhash(): Promise<void> {
    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash('processed');
    this.blockhashCache = { blockhash, lastValidBlockHeight, ts: Date.now() };
  }

  /**
   * Ensure blockhash is fresh (refresh if older than maxAgeMs)
   */
  async ensureBlockhashFresh(maxAgeMs: number = 2000): Promise<void> {
    if (!this.blockhashCache.blockhash || Date.now() - this.blockhashCache.ts > maxAgeMs) {
      await this.refreshBlockhash();
    }
  }

  /**
   * Get current blockhash
   */
  getBlockhash(): string {
    if (!this.blockhashCache.blockhash) {
      throw new TransactionError('Blockhash not initialized');
    }
    return this.blockhashCache.blockhash;
  }

  /**
   * Build initialize instruction
   */
  buildInitializeInstruction(updateAuthority: PublicKey): TransactionInstruction {
    const data = Buffer.concat([
      Buffer.from(DISCRIMINATORS.initialize),
      publicKeyToBuffer(updateAuthority),
    ]);

    const keys = [
      { pubkey: this.statePda, isSigner: false, isWritable: true },
      { pubkey: updateAuthority, isSigner: true, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ];

    return new TransactionInstruction({
      programId: this.programId,
      keys,
      data,
    });
  }

  /**
   * Build set_price instruction
   */
  buildSetPriceInstruction(
    asset: Asset,
    index: number,
    priceI64: number,
    clientTsMs: number,
    signer: PublicKey
  ): TransactionInstruction {
    const data = Buffer.concat([
      Buffer.from(DISCRIMINATORS.set_price),
      encodeU8(asset),
      encodeU8(index),
      encodeI64(priceI64),
      encodeI64(clientTsMs),
    ]);

    const keys = [
      { pubkey: this.statePda, isSigner: false, isWritable: true },
      { pubkey: signer, isSigner: true, isWritable: false },
    ];

    return new TransactionInstruction({
      programId: this.programId,
      keys,
      data,
    });
  }

  /**
   * Build batch_set_prices instruction
   */
  buildBatchSetPricesInstruction(
    index: number,
    btcPrice: number,
    ethPrice: number,
    solPrice: number,
    hypePrice: number,
    clientTsMs: number,
    signer: PublicKey
  ): TransactionInstruction {
    const data = Buffer.concat([
      Buffer.from(DISCRIMINATORS.batch_set_prices),
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

    return new TransactionInstruction({
      programId: this.programId,
      keys,
      data,
    });
  }

  /**
   * Initialize state account if it doesn't exist
   */
  async initializeIfNeeded(payer: Keypair): Promise<boolean> {
    const info = await this.connection.getAccountInfo(this.statePda);

    if (info) {
      return false; // Already initialized
    }

    console.log('Initializing state PDA…');

    // Ensure fresh blockhash for init
    await this.ensureBlockhashFresh();

    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }))
      .add(this.buildInitializeInstruction(payer.publicKey));

    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = this.getBlockhash();

    const sig = await sendAndConfirmTransaction(this.connection, tx, [payer], {
      skipPreflight: false,
      commitment: 'processed',
    });

    console.log('Init tx:', sig);
    return true;
  }

  /**
   * Send batch price update transaction
   */
  async sendBatchPriceUpdate(
    payer: Keypair,
    index: number,
    btcPrice: number,
    ethPrice: number,
    solPrice: number,
    hypePrice: number,
    clientTsMs: number
  ): Promise<string> {
    // Ensure fresh blockhash
    await this.ensureBlockhashFresh();

    const tx = new Transaction()
      .add(ComputeBudgetProgram.setComputeUnitLimit({ units: COMPUTE_UNIT_LIMIT }))
      .add(
        this.buildBatchSetPricesInstruction(
          index,
          btcPrice,
          ethPrice,
          solPrice,
          hypePrice,
          clientTsMs,
          payer.publicKey
        )
      );

    tx.feePayer = payer.publicKey;
    tx.recentBlockhash = this.getBlockhash();

    try {
      const sig = await sendAndConfirmTransaction(this.connection, tx, [payer], {
        skipPreflight: false,
        commitment: 'processed',
      });
      return sig;
    } catch (error) {
      const msg = error instanceof Error ? error.message.toLowerCase() : String(error);
      const expired =
        msg.includes('block height exceeded') ||
        msg.includes('blockhash not found') ||
        (msg.includes('signature') && msg.includes('expired'));

      if (expired) {
        throw new TransactionError(
          `Blockhash expired: ${error instanceof Error ? error.message : String(error)}`
        );
      }

      throw new TransactionError(
        `Transaction failed: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}
