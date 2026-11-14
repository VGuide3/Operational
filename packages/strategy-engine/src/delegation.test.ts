import { describe, expect, it } from 'vitest';
import { AppError } from '@ops/core';
import {
  assertDelegationMutationAllowed,
  createDelegation,
  delegationScopeHash,
  delegationSigningMessage,
  delegationUsageRatio,
  enforceDelegation,
  recordDelegationSpend,
  type DelegationRecord,
} from './delegation.js';

const GRANTOR = '0x1111111111111111111111111111111111111111';
const DELEGATE = '0x2222222222222222222222222222222222222222';
const TOKEN = '0x3333333333333333333333333333333333333333';
const CONTRACT = '0x4444444444444444444444444444444444444444';

function activeDelegation(overrides: Partial<DelegationRecord> = {}): DelegationRecord {
  const d = createDelegation({
    grantor: GRANTOR,
    delegate: DELEGATE,
    chainId: 1,
    validFrom: new Date(Date.now() - 3600_000).toISOString(),
    validUntil: new Date(Date.now() + 3600_000).toISOString(),
    scope: {
      tokens: [TOKEN],
      maxPerTx: '1000',
      maxDailyUsd: '5000',
      allowedContracts: [CONTRACT],
      allowedFunctions: ['transfer'],
      blockedRecipients: [],
    },
  });
  return { ...d, status: 'active', ...overrides };
}

describe('delegation', () => {
  it('creates a pending delegation with a stable scope hash', () => {
    const d = activeDelegation();
    expect(d.delegationId.startsWith('dlg_')).toBe(true);
    expect(delegationScopeHash(d.scope)).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('produces an EIP-712 signing message bound to scope + expiry', () => {
    const d = activeDelegation();
    const msg = delegationSigningMessage(d);
    expect(msg.scopeHash).toBe(delegationScopeHash(d.scope));
    expect(msg.chainId).toBe(1);
  });

  it('allows an in-scope transfer', () => {
    const d = activeDelegation();
    expect(() =>
      enforceDelegation(d, { kind: 'token_transfer', chainId: 1, token: TOKEN, amount: '500', usdValue: '100' }),
    ).not.toThrow();
  });

  it('rejects a token outside the delegated set', () => {
    const d = activeDelegation();
    expect(() =>
      enforceDelegation(d, { kind: 'token_transfer', chainId: 1, token: CONTRACT, amount: '1' }),
    ).toThrow(/outside the delegated token set/);
  });

  it('rejects an amount above maxPerTx', () => {
    const d = activeDelegation();
    expect(() =>
      enforceDelegation(d, { kind: 'token_transfer', chainId: 1, token: TOKEN, amount: '1001' }),
    ).toThrow(/maxPerTx/);
  });

  it('rejects a contract outside the allowed set', () => {
    const d = activeDelegation();
    expect(() =>
      enforceDelegation(d, { kind: 'contract_call', chainId: 1, target: TOKEN, fn: 'transfer' }),
    ).toThrow(/outside the allowed set/);
  });

  it('rejects a function that is not delegated', () => {
    const d = activeDelegation();
    expect(() =>
      enforceDelegation(d, { kind: 'contract_call', chainId: 1, target: CONTRACT, fn: 'withdraw' }),
    ).toThrow(/not delegated/);
  });

  it('rejects a chain mismatch', () => {
    const d = activeDelegation();
    expect(() =>
      enforceDelegation(d, { kind: 'token_transfer', chainId: 10, token: TOKEN, amount: '1' }),
    ).toThrow(/different chain/);
  });

  it('rejects expired and revoked delegations', () => {
    expect(() => enforceDelegation(activeDelegation({ status: 'revoked' }), { kind: 'token_transfer', chainId: 1 })).toThrow(
      /revoked/,
    );
    expect(() => enforceDelegation(activeDelegation({ status: 'expired' }), { kind: 'token_transfer', chainId: 1 })).toThrow(
      /expired/,
    );
    const past = activeDelegation({ validUntil: new Date(Date.now() - 1000).toISOString() });
    expect(() => enforceDelegation(past, { kind: 'token_transfer', chainId: 1 })).toThrow(/validity window/);
  });

  it('enforces the daily USD cap', () => {
    const d = activeDelegation();
    expect(() =>
      enforceDelegation(d, { kind: 'token_transfer', chainId: 1, token: TOKEN, amount: '1', usdValue: '6000' }),
    ).toThrow(/daily USD/);
  });

  it('accumulates daily spend and rolls the window', () => {
    let d = activeDelegation();
    d = recordDelegationSpend(d, '1000');
    expect(d.dailySpentUsd).toBe('1000.00');
    d = recordDelegationSpend(d, '500');
    expect(d.dailySpentUsd).toBe('1500.00');
    const future = Date.now() + 25 * 3600 * 1000;
    d = recordDelegationSpend(d, '10', future);
    expect(d.dailySpentUsd).toBe('10.00');
  });

  it('reports usage ratio for alerting', () => {
    let d = activeDelegation();
    d = recordDelegationSpend(d, '4000');
    expect(delegationUsageRatio(d)).toBeGreaterThanOrEqual(0.8);
  });

  it('prevents a delegate from mutating its own delegation', () => {
    const d = activeDelegation();
    expect(() => assertDelegationMutationAllowed(d, DELEGATE, 'scope')).toThrow(AppError);
    expect(() => assertDelegationMutationAllowed(d, GRANTOR, 'scope')).not.toThrow();
  });
});
