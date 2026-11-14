import { z } from 'zod';
import { AppError, ErrorCodes, canonicalKeccak256, newId } from '@ops/core';
import { Address, UintString } from './schema.js';

/**
 * Scoped delegation.
 *
 * Delegation must be explicit, revocable, time-bound, and policy-constrained.
 * It is validated on every backend execution; UI state is never trusted.
 */

export const DelegationScope = z.object({
  tokens: z.array(Address).default([]),
  maxPerTx: UintString.default('0'),
  maxDailyUsd: z.string().regex(/^\d+(\.\d+)?$/).default('0'),
  allowedContracts: z.array(Address).default([]),
  allowedFunctions: z.array(z.string()).default([]),
  blockedRecipients: z.array(Address).default([]),
});
export type DelegationScope = z.infer<typeof DelegationScope>;

export const Delegation = z.object({
  delegationId: z.string().optional(),
  grantor: Address,
  delegate: Address,
  chainId: z.number().int().positive(),
  scope: DelegationScope,
  validFrom: z.string().datetime(),
  validUntil: z.string().datetime(),
  signature: z.string().optional(),
  status: z.enum(['pending', 'active', 'revoked', 'expired']).default('pending'),
  revokedAt: z.string().datetime().nullable().optional(),
  nonce: z.number().int().nonnegative().default(0),
});
export type Delegation = z.infer<typeof Delegation>;

export interface DelegationRecord extends Omit<Delegation, 'delegationId' | 'signature'> {
  delegationId: string;
  signature: string | null;
  /** Running USD spend within the current daily window. */
  dailySpentUsd: string;
  dailyWindowStart: string;
}

export interface CreateDelegationInput {
  grantor: string;
  delegate: string;
  chainId: number;
  scope: DelegationScope;
  validFrom: string;
  validUntil: string;
  nonce?: number;
}

export function delegationScopeHash(scope: DelegationScope): string {
  return canonicalKeccak256(scope);
}

export function createDelegation(input: CreateDelegationInput): DelegationRecord {
  const parsed = Delegation.parse({ ...input, status: 'pending' });
  return {
    ...parsed,
    delegationId: newId('delegation'),
    signature: null,
    dailySpentUsd: '0',
    dailyWindowStart: new Date().toISOString(),
  };
}

/** The message bound by the EIP-712 delegation signature. */
export interface DelegationSigningMessage {
  delegationId: string;
  grantor: string;
  delegate: string;
  chainId: number;
  scopeHash: string;
  validFrom: number;
  validUntil: number;
  nonce: number;
}

export function delegationSigningMessage(record: DelegationRecord): DelegationSigningMessage {
  return {
    delegationId: canonicalKeccak256({ id: record.delegationId }),
    grantor: record.grantor,
    delegate: record.delegate,
    chainId: record.chainId,
    scopeHash: delegationScopeHash(record.scope),
    validFrom: Math.floor(new Date(record.validFrom).getTime() / 1000),
    validUntil: Math.floor(new Date(record.validUntil).getTime() / 1000),
    nonce: record.nonce,
  };
}

export interface DelegationAction {
  kind: 'token_transfer' | 'contract_call';
  chainId: number;
  /** Token or target contract. */
  token?: string;
  target?: string;
  /** Function name for contract calls. */
  fn?: string;
  /** Base-unit amount for transfers. */
  amount?: string;
  /** USD value of the action. */
  usdValue?: string;
  recipient?: string;
}

/**
 * Enforce a delegation on a proposed action. Throws DELEGATION_SCOPE_VIOLATION
 * when the action falls outside the granted scope.
 */
export function enforceDelegation(
  record: DelegationRecord,
  action: DelegationAction,
  now = Date.now(),
): void {
  if (record.status === 'revoked') {
    throw new AppError(ErrorCodes.DELEGATION_REVOKED, 'delegation has been revoked', 403);
  }
  if (record.status === 'expired') {
    throw new AppError(ErrorCodes.DELEGATION_EXPIRED, 'delegation has expired', 403);
  }
  if (new Date(record.validUntil).getTime() <= now) {
    throw new AppError(ErrorCodes.DELEGATION_EXPIRED, 'delegation validity window has ended', 403);
  }
  if (new Date(record.validFrom).getTime() > now) {
    throw new AppError(ErrorCodes.DELEGATION_INVALID, 'delegation is not yet valid', 403);
  }
  if (action.chainId !== record.chainId) {
    throw new AppError(ErrorCodes.DELEGATION_SCOPE_VIOLATION, 'delegation is bound to a different chain', 403);
  }

  const scope = record.scope;
  const violations: string[] = [];

  if (action.kind === 'token_transfer') {
    if (action.token && scope.tokens.length > 0 && !scope.tokens.some((t) => t.toLowerCase() === action.token!.toLowerCase())) {
      violations.push(`token ${action.token} is outside the delegated token set`);
    }
    if (action.amount !== undefined && BigInt(action.amount) > BigInt(scope.maxPerTx)) {
      violations.push(`amount ${action.amount} exceeds maxPerTx ${scope.maxPerTx}`);
    }
    if (
      action.recipient &&
      scope.blockedRecipients.some((r) => r.toLowerCase() === action.recipient!.toLowerCase())
    ) {
      violations.push(`recipient ${action.recipient} is blocked by the delegation`);
    }
  } else {
    if (action.target && scope.allowedContracts.length > 0 && !scope.allowedContracts.some((c) => c.toLowerCase() === action.target!.toLowerCase())) {
      violations.push(`contract ${action.target} is outside the allowed set`);
    }
    if (action.fn && scope.allowedFunctions.length > 0 && !scope.allowedFunctions.includes(action.fn)) {
      violations.push(`function ${action.fn} is not delegated`);
    }
  }

  if (action.usdValue !== undefined) {
    const projected = (Number(record.dailySpentUsd) + Number(action.usdValue)).toFixed(2);
    if (Number(projected) > Number(scope.maxDailyUsd)) {
      violations.push(`daily USD spend ${projected} exceeds maxDailyUsd ${scope.maxDailyUsd}`);
    }
  }

  if (violations.length > 0) {
    throw new AppError(ErrorCodes.DELEGATION_SCOPE_VIOLATION, violations.join('; '), 403);
  }
}

/** Record spend and roll the daily window when it elapses. */
export function recordDelegationSpend(
  record: DelegationRecord,
  usdValue: string,
  now = Date.now(),
): DelegationRecord {
  const windowStart = new Date(record.dailyWindowStart).getTime();
  const rollover = now - windowStart >= 24 * 3600 * 1000;
  const spent = rollover ? '0' : record.dailySpentUsd;
  return {
    ...record,
    dailySpentUsd: (Number(spent) + Number(usdValue)).toFixed(2),
    dailyWindowStart: rollover ? new Date(now).toISOString() : record.dailyWindowStart,
  };
}

/**
 * A delegate may never modify its own scope, extend its own expiry, or grant
 * further delegations unless the scope explicitly permits it.
 */
export function assertDelegationMutationAllowed(
  record: DelegationRecord,
  actor: string,
  mutation: 'scope' | 'expiry' | 'grant',
): void {
  const isDelegate = record.delegate.toLowerCase() === actor.toLowerCase();
  if (isDelegate) {
    throw new AppError(
      ErrorCodes.DELEGATION_SCOPE_VIOLATION,
      `a delegate may not modify its own ${mutation}`,
      403,
    );
  }
}

/** Alert when usage approaches a delegation limit (>= 80%). */
export function delegationUsageRatio(record: DelegationRecord): number {
  const max = Number(record.scope.maxDailyUsd);
  if (max <= 0) return 0;
  return Number(record.dailySpentUsd) / max;
}
