import { z } from 'zod';
import { AppError, ErrorCodes } from '@ops/core';
import { getChain, type ChainRegistryLike } from '@ops/chains';
import { MAX_UINT256_DEC } from '@ops/permit2';

/**
 * Balance and allowance scanner.
 *
 * The scanner queries RPC providers, token metadata caches, and indexer data.
 * It tolerates partial indexer failures and distinguishes "not indexed" from
 * "zero balance": `indexed: false` means the data source could not answer,
 * whereas `indexed: true` with `balance: "0"` is a real zero.
 */

export const DataSource = z.enum(['rpc_multicall', 'indexer', 'cache', 'permit2']);
export type DataSource = z.infer<typeof DataSource>;

export interface TokenMetadata {
  chainId: number;
  address: string;
  symbol: string | null;
  name: string | null;
  decimals: number | null;
  totalSupply?: string | null;
  metadata?: Record<string, unknown>;
}

export interface TokenRisk {
  verified: boolean;
  honeypot?: boolean;
  liquidityUsd?: number;
  blacklisted?: boolean;
  exploitAssociations?: string[];
  /** Whether the spender/contract is newly created. */
  newlyCreated?: boolean;
  score: number; // 0 (safe) .. 100 (dangerous)
}

export interface BalanceReading {
  chainId: number;
  owner: string;
  /** Token address, or the sentinel "native". */
  token: string;
  symbol: string | null;
  decimals: number | null;
  balance: string;
  /** True when the data source could answer; false means "not indexed". */
  indexed: boolean;
  source: DataSource;
  blockNumber: number | null;
  scannedAt: string;
  stale: boolean;
  risk?: TokenRisk;
}

export interface AllowanceReading {
  chainId: number;
  owner: string;
  token: string;
  spender: string;
  allowanceRaw: string;
  allowanceIsMax: boolean;
  permit2Allowance?: { amount: string; expiration: number; nonce: number };
  scannedAt: string;
  source: DataSource;
  blockNumber: number | null;
  /** Spender risk metadata, used to flag untrusted approvals. */
  spenderRisk?: TokenRisk;
}

/** Read interface implemented by RPC / indexer adapters. */
export interface ChainReader {
  chainId: number;
  getBlockNumber(): Promise<number>;
  getNativeBalance(owner: string): Promise<bigint>;
  getErc20Balance(token: string, owner: string): Promise<bigint>;
  getErc20Allowance(token: string, owner: string, spender: string): Promise<bigint>;
  getPermit2Allowance?(
    token: string,
    owner: string,
    spender: string,
  ): Promise<{ amount: bigint; expiration: number; nonce: number }>;
  getTokenMetadata(token: string): Promise<TokenMetadata | null>;
  getCode(address: string): Promise<string>;
}

export interface ScannerOptions {
  registry?: ChainRegistryLike;
  /** Freshness threshold in seconds; beyond this, results are marked stale. */
  stalenessSeconds?: number;
  /** Token metadata cache. */
  metadataCache?: Map<string, TokenMetadata>;
  /** Spender risk lookup. */
  riskLookup?: (chainId: number, address: string) => TokenRisk | undefined;
  /** Max tokens per scan (README: up to 50 tokens). */
  maxTokens?: number;
  now?: () => number;
}

const NATIVE = 'native';

export class BalanceScanner {
  private readonly registry?: ChainRegistryLike;
  private readonly stalenessSeconds: number;
  private readonly metadataCache: Map<string, TokenMetadata>;
  private readonly riskLookup?: (chainId: number, address: string) => TokenRisk | undefined;
  private readonly maxTokens: number;
  private readonly now: () => number;

  constructor(
    private readonly readers: Map<number, ChainReader>,
    options: ScannerOptions = {},
  ) {
    this.registry = options.registry;
    this.stalenessSeconds = options.stalenessSeconds ?? 900;
    this.metadataCache = options.metadataCache ?? new Map();
    this.riskLookup = options.riskLookup;
    this.maxTokens = options.maxTokens ?? 50;
    this.now = options.now ?? (() => Date.now());
  }

  private reader(chainId: number): ChainReader {
    const reader = this.readers.get(chainId);
    if (!reader) throw new AppError(ErrorCodes.UNKNOWN_CHAIN, `no reader for chain ${chainId}`, 400);
    getChain(chainId, this.registry); // validates chain support
    return reader;
  }

  private async metadata(reader: ChainReader, chainId: number, token: string): Promise<TokenMetadata | null> {
    const key = `${chainId}:${token.toLowerCase()}`;
    const cached = this.metadataCache.get(key);
    if (cached) return cached;
    const fetched = await reader.getTokenMetadata(token);
    if (fetched) this.metadataCache.set(key, fetched);
    return fetched;
  }

  /** Scan native + ERC-20 balances. Tolerates partial indexer failures. */
  async scanPortfolio(input: {
    chainId: number;
    owner: string;
    tokens: string[];
    /** Optional indexer that may be unavailable. */
    indexer?: (input: { chainId: number; owner: string; tokens: string[] }) => Promise<
      Map<string, { balance: bigint; blockNumber: number }>
    >;
  }): Promise<{ readings: BalanceReading[]; source: DataSource; blockNumber: number | null }> {
    const reader = this.reader(input.chainId);
    const tokens = input.tokens.slice(0, this.maxTokens);
    const nowIso = new Date(this.now()).toISOString();

    let blockNumber: number | null = null;
    try {
      blockNumber = await reader.getBlockNumber();
    } catch {
      blockNumber = null;
    }

    const readings: BalanceReading[] = [];

    // Native balance.
    try {
      const native = await reader.getNativeBalance(input.owner);
      readings.push({
        chainId: input.chainId,
        owner: input.owner,
        token: NATIVE,
        symbol: null,
        decimals: 18,
        balance: native.toString(),
        indexed: true,
        source: 'rpc_multicall',
        blockNumber,
        scannedAt: nowIso,
        stale: false,
      });
    } catch {
      readings.push({
        chainId: input.chainId,
        owner: input.owner,
        token: NATIVE,
        symbol: null,
        decimals: 18,
        balance: '0',
        indexed: false,
        source: 'rpc_multicall',
        blockNumber,
        scannedAt: nowIso,
        stale: true,
      });
    }

    // ERC-20 balances, batching where the indexer is available.
    let indexerData: Map<string, { balance: bigint; blockNumber: number }> | undefined;
    if (input.indexer) {
      try {
        indexerData = await input.indexer({ chainId: input.chainId, owner: input.owner, tokens });
      } catch {
        indexerData = undefined; // tolerate indexer failure; fall back to RPC
      }
    }

    for (const token of tokens) {
      const meta = await this.metadata(reader, input.chainId, token).catch(() => null);
      const fromIndexer = indexerData?.get(token.toLowerCase());
      let balance: bigint;
      let indexed = true;
      let source: DataSource = 'indexer';
      try {
        if (fromIndexer) {
          balance = fromIndexer.balance;
          source = 'indexer';
        } else {
          balance = await reader.getErc20Balance(token, input.owner);
          source = 'rpc_multicall';
        }
      } catch {
        balance = 0n;
        indexed = false;
        source = 'rpc_multicall';
      }
      readings.push({
        chainId: input.chainId,
        owner: input.owner,
        token,
        symbol: meta?.symbol ?? null,
        decimals: meta?.decimals ?? null,
        balance: balance.toString(),
        indexed,
        source,
        blockNumber: fromIndexer?.blockNumber ?? blockNumber,
        scannedAt: nowIso,
        stale: !indexed,
        ...(this.riskLookup ? { risk: this.riskLookup(input.chainId, token) } : {}),
      });
    }

    return { readings, source: indexerData ? 'indexer' : 'rpc_multicall', blockNumber };
  }

  /** Scan ERC-20 + Permit2 allowances for a set of spenders. */
  async scanAllowances(input: {
    chainId: number;
    owner: string;
    tokens: string[];
    spenders: string[];
  }): Promise<AllowanceReading[]> {
    const reader = this.reader(input.chainId);
    const nowIso = new Date(this.now()).toISOString();
    let blockNumber: number | null = null;
    try {
      blockNumber = await reader.getBlockNumber();
    } catch {
      blockNumber = null;
    }

    const out: AllowanceReading[] = [];
    for (const token of input.tokens.slice(0, this.maxTokens)) {
      for (const spender of input.spenders) {
        let allowanceRaw = '0';
        let source: DataSource = 'rpc_multicall';
        try {
          allowanceRaw = (await reader.getErc20Allowance(token, input.owner, spender)).toString();
        } catch {
          source = 'cache';
        }
        const reading: AllowanceReading = {
          chainId: input.chainId,
          owner: input.owner,
          token,
          spender,
          allowanceRaw,
          allowanceIsMax: allowanceRaw === MAX_UINT256_DEC,
          scannedAt: nowIso,
          source,
          blockNumber,
          ...(this.riskLookup ? { spenderRisk: this.riskLookup(input.chainId, spender) } : {}),
        };
        if (reader.getPermit2Allowance) {
          try {
            const p2 = await reader.getPermit2Allowance(token, input.owner, spender);
            reading.permit2Allowance = {
              amount: p2.amount.toString(),
              expiration: p2.expiration,
              nonce: p2.nonce,
            };
          } catch {
            // Permit2 not configured for this pair; leave undefined.
          }
        }
        out.push(reading);
      }
    }
    return out;
  }

  /** Mark readings as stale when they exceed the freshness threshold. */
  markStale(readings: { scannedAt: string }[], now = this.now()): boolean {
    return readings.some((r) => now - new Date(r.scannedAt).getTime() > this.stalenessSeconds * 1000);
  }
}

export interface PortfolioSnapshot {
  chainId: number;
  owner: string;
  takenAt: string;
  /** token -> balance (base units). */
  balances: Record<string, string>;
}

/** Compare two snapshots to detect portfolio changes. */
export function diffSnapshots(prev: PortfolioSnapshot, next: PortfolioSnapshot): Array<{
  token: string;
  before: string;
  after: string;
  direction: 'increase' | 'decrease' | 'new' | 'closed';
}> {
  const tokens = new Set([...Object.keys(prev.balances), ...Object.keys(next.balances)]);
  const changes = [];
  for (const token of tokens) {
    const before = prev.balances[token] ?? '0';
    const after = next.balances[token] ?? '0';
    if (before === after) continue;
    const b = BigInt(before);
    const a = BigInt(after);
    const direction: 'increase' | 'decrease' | 'new' | 'closed' =
      before === '0' ? 'new' : after === '0' ? 'closed' : a > b ? 'increase' : 'decrease';
    changes.push({ token, before, after, direction });
  }
  return changes;
}

/** Filter allowances by token, spender, chain, amount, and risk score. */
export function filterAllowances(
  readings: AllowanceReading[],
  filter: {
    token?: string;
    spender?: string;
    chainId?: number;
    minAmount?: string;
    unlimitedOnly?: boolean;
    minRiskScore?: number;
  },
): AllowanceReading[] {
  return readings.filter((r) => {
    if (filter.token && r.token.toLowerCase() !== filter.token.toLowerCase()) return false;
    if (filter.spender && r.spender.toLowerCase() !== filter.spender.toLowerCase()) return false;
    if (filter.chainId !== undefined && r.chainId !== filter.chainId) return false;
    if (filter.unlimitedOnly && !r.allowanceIsMax) return false;
    if (filter.minAmount && BigInt(r.allowanceRaw) < BigInt(filter.minAmount)) return false;
    if (filter.minRiskScore !== undefined && (r.spenderRisk?.score ?? 0) < filter.minRiskScore) return false;
    return true;
  });
}

/** Identify approvals to untrusted or newly created spender contracts. */
export function flagUntrustedApprovals(readings: AllowanceReading[]): AllowanceReading[] {
  return readings.filter(
    (r) =>
      r.allowanceRaw !== '0' &&
      (r.spenderRisk?.newlyCreated === true ||
        r.spenderRisk?.verified === false ||
        (r.spenderRisk?.score ?? 0) >= 70),
  );
}
