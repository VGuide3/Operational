import { describe, expect, it } from 'vitest';
import type { ChainReader, TokenMetadata } from '@ops/service-scanner';
import { BalanceIndexer, IndexerCache } from './indexer.js';

const OWNER = '0x1111111111111111111111111111111111111111';
const TOKEN_A = '0x2222222222222222222222222222222222222222';
const TOKEN_B = '0x3333333333333333333333333333333333333333';

class Reader implements ChainReader {
  chainId = 1;
  calls = 0;
  async getBlockNumber() {
    return 100;
  }
  async getNativeBalance() {
    return 0n;
  }
  async getErc20Balance(token: string) {
    this.calls++;
    if (token.toLowerCase() === TOKEN_B.toLowerCase()) throw new Error('rpc error');
    return 42n;
  }
  async getErc20Allowance() {
    return 0n;
  }
  async getTokenMetadata(): Promise<TokenMetadata | null> {
    return null;
  }
  async getCode() {
    return '0x';
  }
}

describe('indexer cache', () => {
  it('expires entries after the ttl', () => {
    let now = 0;
    const cache = new IndexerCache<number>({ ttlSeconds: 10, now: () => now });
    cache.set('k', 1, 5);
    expect(cache.get('k')?.value).toBe(1);
    now = 11_000;
    expect(cache.get('k')).toBeUndefined();
  });
});

describe('balance indexer', () => {
  it('returns balances and tolerates per-token failures', async () => {
    const indexer = new BalanceIndexer(new Reader());
    const result = await indexer.getBalances(OWNER, [TOKEN_A, TOKEN_B]);
    expect(result.balances.get(TOKEN_A.toLowerCase())?.balance).toBe(42n);
    expect(result.missing).toEqual([TOKEN_B]);
  });

  it('serves cached balances without re-reading', async () => {
    const reader = new Reader();
    const indexer = new BalanceIndexer(reader);
    await indexer.getBalances(OWNER, [TOKEN_A]);
    await indexer.getBalances(OWNER, [TOKEN_A]);
    expect(reader.calls).toBe(1);
  });
});
