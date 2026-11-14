import { describe, expect, it } from 'vitest';
import { MAX_UINT256_DEC } from '@ops/permit2';
import {
  BalanceScanner,
  diffSnapshots,
  filterAllowances,
  flagUntrustedApprovals,
  type ChainReader,
  type TokenMetadata,
} from './scanner.js';

const OWNER = '0x1111111111111111111111111111111111111111';
const TOKEN_A = '0x2222222222222222222222222222222222222222';
const TOKEN_B = '0x3333333333333333333333333333333333333333';
const SPENDER = '0x4444444444444444444444444444444444444444';
const UNTRUSTED = '0x5555555555555555555555555555555555555555';

/** In-memory reader: exercises the real scanner code path without a network. */
class FakeReader implements ChainReader {
  chainId = 1;
  private failTokens = new Set<string>();
  constructor(private opts: { permit2?: boolean } = {}) {}

  failToken(token: string) {
    this.failTokens.add(token.toLowerCase());
  }

  async getBlockNumber() {
    return 21_000_000;
  }
  async getNativeBalance() {
    return 1_000_000_000_000_000_000n;
  }
  async getErc20Balance(token: string) {
    if (this.failTokens.has(token.toLowerCase())) throw new Error('indexer unavailable');
    return token.toLowerCase() === TOKEN_A ? 5_000_000n : 0n;
  }
  async getErc20Allowance(token: string, _owner: string, spender: string) {
    if (spender.toLowerCase() === UNTRUSTED.toLowerCase()) return BigInt(MAX_UINT256_DEC);
    return token.toLowerCase() === TOKEN_A ? 1_000_000n : 0n;
  }
  async getTokenMetadata(token: string): Promise<TokenMetadata | null> {
    if (token.toLowerCase() === TOKEN_A) {
      return { chainId: 1, address: TOKEN_A, symbol: 'USDC', name: 'USD Coin', decimals: 6 };
    }
    return { chainId: 1, address: TOKEN_B, symbol: 'DAI', name: 'Dai', decimals: 18 };
  }
  async getCode() {
    return '0x6001';
  }
  async getPermit2Allowance() {
    if (!this.opts.permit2) throw new Error('no permit2');
    return { amount: 500_000n, expiration: 1_900_000_000, nonce: 3 };
  }
}

describe('balance scanner', () => {
  it('reads native and token balances with metadata', async () => {
    const scanner = new BalanceScanner(new Map([[1, new FakeReader()]]));
    const result = await scanner.scanPortfolio({ chainId: 1, owner: OWNER, tokens: [TOKEN_A, TOKEN_B] });
    expect(result.readings).toHaveLength(3);
    const native = result.readings.find((r) => r.token === 'native')!;
    expect(native.balance).toBe('1000000000000000000');
    const a = result.readings.find((r) => r.token === TOKEN_A)!;
    expect(a.symbol).toBe('USDC');
    expect(a.decimals).toBe(6);
    expect(a.balance).toBe('5000000');
    expect(a.indexed).toBe(true);
  });

  it('distinguishes "not indexed" from "zero balance"', async () => {
    const reader = new FakeReader();
    reader.failToken(TOKEN_A);
    const scanner = new BalanceScanner(new Map([[1, reader]]));
    const result = await scanner.scanPortfolio({ chainId: 1, owner: OWNER, tokens: [TOKEN_A, TOKEN_B] });
    const a = result.readings.find((r) => r.token === TOKEN_A)!;
    const b = result.readings.find((r) => r.token === TOKEN_B)!;
    expect(a.indexed).toBe(false); // not indexed
    expect(a.stale).toBe(true);
    expect(b.indexed).toBe(true); // real zero
    expect(b.balance).toBe('0');
  });

  it('uses indexer data when available and falls back when it fails', async () => {
    const scanner = new BalanceScanner(new Map([[1, new FakeReader()]]));
    const withIndexer = await scanner.scanPortfolio({
      chainId: 1,
      owner: OWNER,
      tokens: [TOKEN_A],
      indexer: async () => new Map([[TOKEN_A.toLowerCase(), { balance: 9n, blockNumber: 42 }]]),
    });
    const a = withIndexer.readings.find((r) => r.token === TOKEN_A)!;
    expect(a.source).toBe('indexer');
    expect(a.balance).toBe('9');

    const failingIndexer = await scanner.scanPortfolio({
      chainId: 1,
      owner: OWNER,
      tokens: [TOKEN_A],
      indexer: async () => {
        throw new Error('indexer down');
      },
    });
    expect(failingIndexer.readings.find((r) => r.token === TOKEN_A)!.source).toBe('rpc_multicall');
  });

  it('caps tokens at the configured maximum', async () => {
    const scanner = new BalanceScanner(new Map([[1, new FakeReader()]]), { maxTokens: 1 });
    const result = await scanner.scanPortfolio({ chainId: 1, owner: OWNER, tokens: [TOKEN_A, TOKEN_B] });
    // native + 1 token
    expect(result.readings).toHaveLength(2);
  });

  it('marks stale results beyond the threshold', async () => {
    const scanner = new BalanceScanner(new Map([[1, new FakeReader()]]), {
      stalenessSeconds: 1,
      now: () => 1_000_000,
    });
    const result = await scanner.scanPortfolio({ chainId: 1, owner: OWNER, tokens: [TOKEN_A] });
    const later = 1_000_000 + 5000;
    expect(scanner.markStale(result.readings, later)).toBe(true);
  });
});

describe('allowance scanner', () => {
  it('reads allowances and flags unlimited approvals', async () => {
    const scanner = new BalanceScanner(new Map([[1, new FakeReader({ permit2: true })]]));
    const readings = await scanner.scanAllowances({
      chainId: 1,
      owner: OWNER,
      tokens: [TOKEN_A, TOKEN_B],
      spenders: [SPENDER, UNTRUSTED],
    });
    expect(readings).toHaveLength(4);
    const unlimited = readings.find((r) => r.spender === UNTRUSTED && r.token === TOKEN_A)!;
    expect(unlimited.allowanceIsMax).toBe(true);
    expect(unlimited.permit2Allowance?.amount).toBe('500000');
  });

  it('filters by unlimited, spender, and amount', async () => {
    const scanner = new BalanceScanner(new Map([[1, new FakeReader()]]));
    const readings = await scanner.scanAllowances({
      chainId: 1,
      owner: OWNER,
      tokens: [TOKEN_A],
      spenders: [SPENDER, UNTRUSTED],
    });
    expect(filterAllowances(readings, { unlimitedOnly: true })).toHaveLength(1);
    expect(filterAllowances(readings, { spender: SPENDER })).toHaveLength(1);
    expect(filterAllowances(readings, { minAmount: '500000' })).toHaveLength(2);
  });

  it('flags approvals to untrusted spenders', async () => {
    const scanner = new BalanceScanner(new Map([[1, new FakeReader()]]), {
      riskLookup: (chainId, address) =>
        address.toLowerCase() === UNTRUSTED.toLowerCase()
          ? { verified: false, newlyCreated: true, score: 90 }
          : { verified: true, score: 5 },
    });
    const readings = await scanner.scanAllowances({
      chainId: 1,
      owner: OWNER,
      tokens: [TOKEN_A],
      spenders: [SPENDER, UNTRUSTED],
    });
    const flagged = flagUntrustedApprovals(readings);
    expect(flagged).toHaveLength(1);
    expect(flagged[0]!.spender).toBe(UNTRUSTED);
  });
});

describe('snapshot diffing', () => {
  it('detects increases, decreases, new, and closed positions', () => {
    const changes = diffSnapshots(
      { chainId: 1, owner: OWNER, takenAt: 'a', balances: { [TOKEN_A]: '100', [TOKEN_B]: '50' } },
      { chainId: 1, owner: OWNER, takenAt: 'b', balances: { [TOKEN_A]: '150', [TOKEN_B]: '0', native: '10' } },
    );
    const byToken = Object.fromEntries(changes.map((c) => [c.token, c.direction]));
    expect(byToken[TOKEN_A]).toBe('increase');
    expect(byToken[TOKEN_B]).toBe('closed');
    expect(byToken['native']).toBe('new');
  });
});
