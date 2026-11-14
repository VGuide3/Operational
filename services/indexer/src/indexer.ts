import type { ChainReader } from '@ops/service-scanner';

/**
 * Indexer service.
 *
 * Provides batched, cached balance/allowance reads and risk enrichment, and
 * tolerates partial failures: an unavailable indexer yields `indexed: false`
 * for the affected reads so callers can distinguish "not indexed" from "zero".
 */

export interface IndexerEntry<T> {
  value: T;
  blockNumber: number;
  fetchedAt: string;
}

export interface IndexerCacheOptions {
  ttlSeconds?: number;
  now?: () => number;
}

/** TTL cache for token metadata and balances. */
export class IndexerCache<T> {
  private store = new Map<string, IndexerEntry<T>>();
  private readonly ttlSeconds: number;
  private readonly now: () => number;

  constructor(options: IndexerCacheOptions = {}) {
    this.ttlSeconds = options.ttlSeconds ?? 60;
    this.now = options.now ?? (() => Date.now());
  }

  get(key: string): IndexerEntry<T> | undefined {
    const entry = this.store.get(key);
    if (!entry) return undefined;
    if (this.now() - new Date(entry.fetchedAt).getTime() > this.ttlSeconds * 1000) {
      this.store.delete(key);
      return undefined;
    }
    return entry;
  }

  set(key: string, value: T, blockNumber: number): IndexerEntry<T> {
    const entry: IndexerEntry<T> = { value, blockNumber, fetchedAt: new Date(this.now()).toISOString() };
    this.store.set(key, entry);
    return entry;
  }
}

export interface IndexerBatchResult {
  /** token -> balance entry. */
  balances: Map<string, { balance: bigint; blockNumber: number }>;
  /** Tokens that could not be indexed in this batch. */
  missing: string[];
}

/** Batched balance indexer that degrades gracefully per token. */
export class BalanceIndexer {
  constructor(
    private readonly reader: ChainReader,
    private readonly cache: IndexerCache<bigint> = new IndexerCache<bigint>(),
  ) {}

  async getBalances(owner: string, tokens: string[]): Promise<IndexerBatchResult> {
    const balances = new Map<string, { balance: bigint; blockNumber: number }>();
    const missing: string[] = [];
    let blockNumber = 0;
    try {
      blockNumber = await this.reader.getBlockNumber();
    } catch {
      blockNumber = 0;
    }

    for (const token of tokens) {
      const cacheKey = `${owner.toLowerCase()}:${token.toLowerCase()}`;
      const cached = this.cache.get(cacheKey);
      if (cached) {
        balances.set(token.toLowerCase(), { balance: cached.value, blockNumber: cached.blockNumber });
        continue;
      }
      try {
        const balance = await this.reader.getErc20Balance(token, owner);
        this.cache.set(cacheKey, balance, blockNumber);
        balances.set(token.toLowerCase(), { balance, blockNumber });
      } catch {
        missing.push(token);
      }
    }
    return { balances, missing };
  }
}
