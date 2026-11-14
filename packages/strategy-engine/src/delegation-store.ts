import { AppError, ErrorCodes } from '@ops/core';
import {
  createDelegation,
  recordDelegationSpend,
  type CreateDelegationInput,
  type DelegationRecord,
} from './delegation.js';

/**
 * Delegation store.
 *
 * Delegations are validated on every backend execution, never from UI state.
 * Revocation is immediate; a revoked or expired delegation can no longer be
 * enforced successfully.
 */
export class DelegationStore {
  private readonly delegations = new Map<string, DelegationRecord>();

  create(input: CreateDelegationInput): DelegationRecord {
    const record = createDelegation(input);
    this.delegations.set(record.delegationId, record);
    return record;
  }

  get(id: string): DelegationRecord | undefined {
    return this.delegations.get(id);
  }

  list(filter: { grantor?: string; delegate?: string; chainId?: number } = {}): DelegationRecord[] {
    return [...this.delegations.values()].filter((d) => {
      if (filter.grantor && d.grantor.toLowerCase() !== filter.grantor.toLowerCase()) return false;
      if (filter.delegate && d.delegate.toLowerCase() !== filter.delegate.toLowerCase()) return false;
      if (filter.chainId !== undefined && d.chainId !== filter.chainId) return false;
      return true;
    });
  }

  /** Mark a delegation active once its EIP-712 signature is verified. */
  activate(id: string, signature: string): DelegationRecord {
    const record = this.require(id);
    record.signature = signature;
    record.status = 'active';
    return record;
  }

  revoke(id: string): DelegationRecord {
    const record = this.require(id);
    record.status = 'revoked';
    record.revokedAt = new Date().toISOString();
    return record;
  }

  /** Record spend against the daily limit and persist the rolled window. */
  recordSpend(id: string, usdValue: string, now = Date.now()): DelegationRecord {
    const record = this.require(id);
    const updated = recordDelegationSpend(record, usdValue, now);
    this.delegations.set(id, updated);
    return updated;
  }

  private require(id: string): DelegationRecord {
    const record = this.delegations.get(id);
    if (!record) throw new AppError(ErrorCodes.NOT_FOUND, `delegation ${id} not found`, 404);
    return record;
  }
}
