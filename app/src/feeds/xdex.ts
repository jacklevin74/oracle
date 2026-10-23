/**
 * XDEX (X1 blockchain) pool price stream.
 *
 * XDEX runs Raydium's CP-swap program. A pool's price is the ratio of its two
 * vault balances, minus protocol and fund fees held in the vaults. The feed
 * subscribes to the pool and vault accounts over X1's RPC websocket and
 * recomputes the price whenever one of them changes.
 *
 * The RPC websocket has no request methods, so on each (re)connect the
 * current account state is read once with getMultipleAccounts over HTTP
 * JSON-RPC. Account notifications only arrive on change; an unchanged pool
 * means an unchanged price, so the last price is re-published on each
 * websocket pong while the subscription is healthy.
 *
 * Market = pool address; the emitted price is token0 priced in token1.
 */

import bs58 from 'bs58';
import { WsFeed } from './ws-feed';

const X1_RPC_URL = process.env.X1_RPC_URL || 'https://rpc.mainnet.x1.xyz';
const X1_WS_URL = process.env.X1_WS_URL || 'wss://rpc.mainnet.x1.xyz';

// Raydium CP-swap PoolState layout (after the 8-byte Anchor discriminator)
const POOL = {
  token0Vault: 8 + 32 * 2,
  token1Vault: 8 + 32 * 3,
  mint0Decimals: 8 + 32 * 10 + 3,
  mint1Decimals: 8 + 32 * 10 + 4,
  protocolFees0: 8 + 32 * 10 + 13,
  protocolFees1: 8 + 32 * 10 + 21,
  fundFees0: 8 + 32 * 10 + 29,
  fundFees1: 8 + 32 * 10 + 37,
};
// SPL token account: amount is a u64 at offset 64
const TOKEN_AMOUNT_OFFSET = 64;

interface AccountValue {
  data: Buffer;
  slot: number;
}

interface PoolInfo {
  vault0: string;
  vault1: string;
}

export class XdexFeed extends WsFeed {
  readonly id = 'xdex';
  readonly venue = 'XDEX (X1)';
  protected readonly url = X1_WS_URL;
  protected readonly protocolPing = true;
  protected readonly pingIntervalMs = 10_000;

  private accounts = new Map<string, AccountValue>();
  private pools = new Map<string, PoolInfo>();
  /** JSON-RPC request id → account address, then subscription id → account address */
  private pendingSubs = new Map<number, string>();
  private subs = new Map<number, string>();
  private nextId = 1;
  private generation = 0;

  protected subscribe(): void {
    const gen = ++this.generation;
    this.pendingSubs.clear();
    this.subs.clear();
    this.init(gen).catch((err) => this.reportError(`init: ${(err as Error).message}`));
  }

  protected onPong(): void {
    for (const pool of this.markets) this.publish(pool);
  }

  protected handleMessage(raw: string): void {
    const m = JSON.parse(raw);
    if (m.error) {
      this.reportError(m.error.message ?? 'rpc error');
      return;
    }
    if (typeof m.id === 'number' && typeof m.result === 'number') {
      const addr = this.pendingSubs.get(m.id);
      if (addr) this.subs.set(m.result, addr);
      return;
    }
    if (m.method === 'accountNotification') {
      const addr = this.subs.get(m.params?.subscription);
      const value = m.params?.result?.value;
      if (!addr || !value) return;
      this.store(addr, Buffer.from(value.data[0], 'base64'), m.params.result.context.slot);
      this.publishAffected(addr);
    }
  }

  private async init(gen: number): Promise<void> {
    // 1. Pool state gives the vault addresses
    await this.fetch(this.markets);
    for (const pool of this.markets) {
      const a = this.accounts.get(pool);
      if (!a) throw new Error(`pool ${pool} not found`);
      this.pools.set(pool, {
        vault0: bs58.encode(a.data.subarray(POOL.token0Vault, POOL.token0Vault + 32)),
        vault1: bs58.encode(a.data.subarray(POOL.token1Vault, POOL.token1Vault + 32)),
      });
    }
    if (gen !== this.generation) return;

    // 2. Subscribe before reading vaults; slots decide which value is newer
    const watch = [...this.markets, ...[...this.pools.values()].flatMap((p) => [p.vault0, p.vault1])];
    for (const addr of watch) {
      const id = this.nextId++;
      this.pendingSubs.set(id, addr);
      this.send({
        jsonrpc: '2.0',
        id,
        method: 'accountSubscribe',
        params: [addr, { encoding: 'base64', commitment: 'confirmed' }],
      });
    }

    // 3. Current vault balances
    await this.fetch(watch);
    if (gen !== this.generation) return;
    for (const pool of this.markets) this.publish(pool);
  }

  private async fetch(addresses: string[]): Promise<void> {
    const res = await fetch(X1_RPC_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: 1,
        method: 'getMultipleAccounts',
        params: [addresses, { encoding: 'base64', commitment: 'confirmed' }],
      }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`RPC HTTP ${res.status}`);
    const body = (await res.json()) as {
      error?: { message: string };
      result?: { context: { slot: number }; value: ({ data: [string, string] } | null)[] };
    };
    if (body.error || !body.result) throw new Error(body.error?.message ?? 'empty RPC response');
    const slot = body.result.context.slot;
    body.result.value.forEach((v, i) => {
      if (v) this.store(addresses[i]!, Buffer.from(v.data[0], 'base64'), slot);
    });
  }

  private store(addr: string, data: Buffer, slot: number): void {
    const prev = this.accounts.get(addr);
    if (!prev || slot >= prev.slot) this.accounts.set(addr, { data, slot });
  }

  private publishAffected(addr: string): void {
    for (const [pool, info] of this.pools) {
      if (addr === pool || addr === info.vault0 || addr === info.vault1) this.publish(pool);
    }
  }

  private publish(pool: string): void {
    const info = this.pools.get(pool);
    const p = this.accounts.get(pool)?.data;
    const v0 = info && this.accounts.get(info.vault0)?.data;
    const v1 = info && this.accounts.get(info.vault1)?.data;
    if (!p || !v0 || !v1) return;

    const reserve = (vault: Buffer, protocol: number, fund: number) =>
      vault.readBigUInt64LE(TOKEN_AMOUNT_OFFSET) - p.readBigUInt64LE(protocol) - p.readBigUInt64LE(fund);
    const r0 = Number(reserve(v0, POOL.protocolFees0, POOL.fundFees0)) / 10 ** p[POOL.mint0Decimals]!;
    const r1 = Number(reserve(v1, POOL.protocolFees1, POOL.fundFees1)) / 10 ** p[POOL.mint1Decimals]!;
    if (r0 > 0 && r1 > 0) this.emitQuote(pool, null, null, r1 / r0);
  }
}
