import { AppError, ErrorCodes } from '@ops/core';
import { getChain, type ChainRegistryLike } from '@ops/chains';

/**
 * Execution services: private transaction submission and relayer keys.
 *
 * The relayer holds separately controlled service keys with least-privilege
 * spending limits. Keys never appear in the frontend. This module defines the
 * submission boundary; concrete signing is provided by a KeyProvider that
 * deployments back with a KMS/HSM.
 */

export interface TransactionRequest {
  chainId: number;
  to: string;
  data: string;
  value: string;
  /** Per-transaction gas cap enforced by policy. */
  gasLimit?: string;
  /** Optional private-mempool submission (front-running mitigation). */
  privateMempool?: boolean;
  /** Idempotency key: resubmission returns the prior result. */
  idempotencyKey: string;
}

export interface TransactionReceipt {
  txHash: string;
  status: 'success' | 'reverted';
  blockNumber: number;
  gasUsed: string;
}

export interface SubmissionResult {
  txHash: string;
  submittedAt: string;
  privateMempool: boolean;
}

/** Signs and submits transactions. Backed by KMS/HSM in production. */
export interface Relayer {
  address(chainId: number): Promise<string>;
  submit(req: TransactionRequest): Promise<SubmissionResult>;
  receipt(chainId: number, txHash: string): Promise<TransactionReceipt | null>;
  balanceWei(chainId: number): Promise<bigint>;
}

export interface RelayerPolicy {
  /** Maximum native value (wei) the relayer will ever attach to a tx. */
  maxValueWei: string;
  /** Maximum gas the relayer will pay for a single transaction. */
  maxGasLimit: string;
  /** Recipients the relayer refuses to send to. */
  blockedRecipients: string[];
}

export const defaultRelayerPolicy: RelayerPolicy = {
  maxValueWei: '0', // relayer never forwards native value by default
  maxGasLimit: '3000000',
  blockedRecipients: [],
};

/** In-memory relayer for local development and tests. */
export class InMemoryRelayer implements Relayer {
  private nonce = 0;
  private receipts = new Map<string, TransactionReceipt>();
  private submissions = new Map<string, SubmissionResult>();
  private balance: bigint;

  constructor(
    private readonly relayerAddress: string,
    private readonly policy: RelayerPolicy = defaultRelayerPolicy,
    opts: { balanceWei?: bigint } = {},
  ) {
    this.balance = opts.balanceWei ?? 10n ** 18n;
  }

  async address(): Promise<string> {
    return this.relayerAddress;
  }

  /** Enforce policy before submission; the relayer is the last line of defense. */
  private enforcePolicy(req: TransactionRequest): void {
    if (BigInt(req.value) > BigInt(this.policy.maxValueWei)) {
      throw new AppError(ErrorCodes.POLICY_LIMIT_EXCEEDED, 'relayer value exceeds policy limit', 403);
    }
    if (req.gasLimit && BigInt(req.gasLimit) > BigInt(this.policy.maxGasLimit)) {
      throw new AppError(ErrorCodes.POLICY_LIMIT_EXCEEDED, 'relayer gas exceeds policy limit', 403);
    }
    if (this.policy.blockedRecipients.some((r) => r.toLowerCase() === req.to.toLowerCase())) {
      throw new AppError(ErrorCodes.POLICY_LIMIT_EXCEEDED, 'relayer refuses blocked recipient', 403);
    }
  }

  async submit(req: TransactionRequest): Promise<SubmissionResult> {
    const existing = this.submissions.get(req.idempotencyKey);
    if (existing) return existing;
    this.enforcePolicy(req);
    getChain(req.chainId); // validates chain
    this.nonce += 1;
    const txHash = `0x${this.nonce.toString(16).padStart(64, '0')}`;
    const result: SubmissionResult = {
      txHash,
      submittedAt: new Date().toISOString(),
      privateMempool: req.privateMempool ?? false,
    };
    this.submissions.set(req.idempotencyKey, result);
    this.receipts.set(txHash, { txHash, status: 'success', blockNumber: this.nonce, gasUsed: '21000' });
    return result;
  }

  async receipt(_chainId: number, txHash: string): Promise<TransactionReceipt | null> {
    return this.receipts.get(txHash) ?? null;
  }

  async balanceWei(): Promise<bigint> {
    return this.balance;
  }

  setBalance(wei: bigint): void {
    this.balance = wei;
  }
}

export interface RelayerRegistryLike {
  registry?: ChainRegistryLike;
}

/**
 * The single submission path for backend jobs. Enforces that a job is only
 * submitted after policy evaluation, simulation, and required approvals — the
 * caller must have already called `ApprovalService.assertExecutable`.
 */
export class RelayerService {
  constructor(private readonly relayers: Map<number, Relayer>) {}

  relayerFor(chainId: number): Relayer {
    const relayer = this.relayers.get(chainId);
    if (!relayer) throw new AppError(ErrorCodes.UNKNOWN_CHAIN, `no relayer for chain ${chainId}`, 400);
    getChain(chainId);
    return relayer;
  }

  async submit(chainId: number, req: Omit<TransactionRequest, 'chainId'>): Promise<SubmissionResult> {
    return this.relayerFor(chainId).submit({ ...req, chainId });
  }

  /** Alert when the relayer balance drops below a threshold. */
  async checkBalance(chainId: number, minWei: bigint): Promise<{ ok: boolean; balance: bigint }> {
    const balance = await this.relayerFor(chainId).balanceWei(chainId);
    return { ok: balance >= minWei, balance };
  }
}
