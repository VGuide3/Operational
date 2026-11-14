import { describe, expect, it } from 'vitest';
import { DelegationStore } from './delegation-store.js';
import { enforceDelegation } from './delegation.js';

const GRANTOR = '0x1111111111111111111111111111111111111111';
const DELEGATE = '0x2222222222222222222222222222222222222222';
const TOKEN = '0x0000000000000000000000000000000000000002';

function makeStore() {
  const store = new DelegationStore();
  const record = store.create({
    grantor: GRANTOR,
    delegate: DELEGATE,
    chainId: 1,
    scope: {
      tokens: [TOKEN],
      maxPerTx: '1000000',
      maxDailyUsd: '50000',
      allowedContracts: [],
      allowedFunctions: [],
      blockedRecipients: [],
    },
    validFrom: new Date(Date.now() - 1000).toISOString(),
    validUntil: new Date(Date.now() + 7 * 86400_000).toISOString(),
  });
  return { store, record };
}

describe('DelegationStore', () => {
  it('persists and lists delegations', () => {
    const { store, record } = makeStore();
    expect(store.get(record.delegationId)).toBeDefined();
    expect(store.list({ chainId: 1 })).toHaveLength(1);
    expect(store.list({ chainId: 10 })).toHaveLength(0);
  });

  it('activation attaches a signature and marks the record active', () => {
    const { store, record } = makeStore();
    const active = store.activate(record.delegationId, '0xsig');
    expect(active.status).toBe('active');
    expect(active.signature).toBe('0xsig');
  });

  it('revocation is immediate and enforced on execution', () => {
    const { store, record } = makeStore();
    store.activate(record.delegationId, '0xsig');
    store.revoke(record.delegationId);
    const revoked = store.get(record.delegationId)!;
    expect(() =>
      enforceDelegation(revoked, { kind: 'token_transfer', chainId: 1, token: TOKEN, amount: '1' }),
    ).toThrow(/revoked/i);
  });

  it('records spend and rolls the daily window', () => {
    const { store, record } = makeStore();
    const first = store.recordSpend(record.delegationId, '100');
    expect(first.dailySpentUsd).toBe('100.00');
    const next = store.recordSpend(record.delegationId, '50');
    expect(next.dailySpentUsd).toBe('150.00');
  });

  it('throws a not-found error for unknown ids', () => {
    const store = new DelegationStore();
    expect(() => store.revoke('dlg_missing')).toThrow(/not found/i);
  });
});
