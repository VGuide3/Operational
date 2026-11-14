import { describe, expect, it } from 'vitest';
import { AppError } from '@ops/core';
import { ContractStore } from './store.js';
import { validateManifest } from './manifest.js';

const ABI = [
  { type: 'function', name: 'transfer', inputs: [], outputs: [] },
  { type: 'event', name: 'Transfer', inputs: [] },
];

function validManifest(overrides: Record<string, unknown> = {}) {
  return {
    manifestVersion: '1.0.0',
    contracts: [
      {
        key: 'treasury',
        name: 'Treasury',
        chainId: 1,
        address: '0x0000000000000000000000000000000000000001',
        abi: ABI,
        verified: true,
        tags: ['treasury', 'production'],
        verification: { compilerVersion: '0.8.24' },
        ...overrides,
      },
    ],
  };
}

const verified = new Set(['1:0x0000000000000000000000000000000000000001']);

describe('manifest validation', () => {
  it('accepts a valid manifest with bytecode', () => {
    const out = validateManifest(validManifest(), { bytecodeVerified: verified });
    expect(out.contracts).toHaveLength(1);
    expect(out.contracts[0]!.abiHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it('rejects an unsupported chain', () => {
    expect(() =>
      validateManifest(validManifest({ chainId: 999999 }), { bytecodeVerified: verified }),
    ).toThrow(AppError);
  });

  it('rejects unknown ABI entry types', () => {
    try {
      validateManifest(validManifest({ abi: [{ type: 'not_a_type' }] }), { bytecodeVerified: verified });
      throw new Error('should have thrown');
    } catch (e) {
      expect((e as AppError).code).toBe('validation_failed');
    }
  });

  it('rejects non-checksummed addresses', () => {
    expect(() =>
      validateManifest(
        validManifest({ address: '0x0000000000000000000000000000000000000001'.toUpperCase() }),
        { bytecodeVerified: verified },
      ),
    ).toThrow(AppError);
  });

  it('rejects duplicate (chainId,address) unless aliased', () => {
    const dup = {
      manifestVersion: '1.0.0',
      contracts: [
        { key: 'a', name: 'A', chainId: 1, address: '0x0000000000000000000000000000000000000001', abi: ABI, verified: true },
        { key: 'b', name: 'B', chainId: 1, address: '0x0000000000000000000000000000000000000001', abi: ABI, verified: true },
      ],
    };
    expect(() => validateManifest(dup, { bytecodeVerified: verified })).toThrow(AppError);
    const aliased = JSON.parse(JSON.stringify(dup));
    aliased.contracts[1].alias = true;
    expect(() => validateManifest(aliased, { bytecodeVerified: verified })).not.toThrow();
  });

  it('blocks unverified imports on production chains without acknowledgement', () => {
    expect(() =>
      validateManifest(validManifest({ verified: false }), { bytecodeVerified: verified }),
    ).toThrow(AppError);
  });

  it('allows unverified imports on staging with acknowledgement', () => {
    const out = validateManifest(validManifest({ verified: false, chainId: 11155111, address: '0x0000000000000000000000000000000000000001' }), {
      allowUnverifiedChainIds: [11155111],
      acknowledgeUnverified: true,
      bytecodeVerified: new Set(['11155111:0x0000000000000000000000000000000000000001']),
    });
    expect(out.warnings.some((w) => w.includes('unverified'))).toBe(true);
  });

  it('blocks when bytecode is absent and unverified imports are not permitted', () => {
    expect(() => validateManifest(validManifest(), { bytecodeVerified: new Set() })).toThrow(AppError);
  });
});

describe('contract store', () => {
  it('stages, approves, and searches contracts', () => {
    const store = new ContractStore();
    const out = validateManifest(validManifest(), { bytecodeVerified: verified });
    const manifest = store.stageManifest(out, 'usr_1');
    expect(manifest.status).toBe('staged');
    const { contracts } = store.approveManifest(manifest.id, 'usr_2');
    expect(contracts).toHaveLength(1);

    expect(store.search({ name: 'treasur' }).items).toHaveLength(1);
    expect(store.search({ tag: 'production' }).items).toHaveLength(1);
    expect(store.search({ abiFunction: 'transfer' }).items).toHaveLength(1);
    expect(store.search({ abiFunction: 'nonexistent' }).items).toHaveLength(0);
  });

  it('creates a new revision when the ABI changes, preserving history', () => {
    const store = new ContractStore();
    const m1 = store.stageManifest(validateManifest(validManifest(), { bytecodeVerified: verified }), 'usr_1');
    store.approveManifest(m1.id, 'usr_2');
    const changed = validManifest({ abi: [...ABI, { type: 'function', name: 'mint', inputs: [], outputs: [] }] });
    const m2 = store.stageManifest(validateManifest(changed, { bytecodeVerified: verified }), 'usr_1');
    store.approveManifest(m2.id, 'usr_2');

    const revisions = store.listRevisions(1, '0x0000000000000000000000000000000000000001');
    expect(revisions).toHaveLength(2);
    expect(revisions[0]!.revision).toBe(1);
    expect(revisions[1]!.revision).toBe(2);
    expect(revisions[0]!.functions).toContain('transfer');
    expect(revisions[1]!.functions).toContain('mint');
  });

  it('is idempotent for identical ABI re-imports', () => {
    const store = new ContractStore();
    const m1 = store.stageManifest(validateManifest(validManifest(), { bytecodeVerified: verified }), 'usr_1');
    const c1 = store.approveManifest(m1.id, 'usr_2').contracts;
    const m2 = store.stageManifest(validateManifest(validManifest(), { bytecodeVerified: verified }), 'usr_1');
    const c2 = store.approveManifest(m2.id, 'usr_2').contracts;
    expect(c1[0]!.id).toBe(c2[0]!.id);
  });
});
