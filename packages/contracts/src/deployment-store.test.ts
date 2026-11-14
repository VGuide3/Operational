import { describe, expect, it } from 'vitest';
import { DeploymentStore } from './deployment-store.js';
import { predictCreate2Address } from './create2.js';

const FACTORY = '0x00000000000000000000000000000000000000f1' as const;
const SALT = `0x${'11'.repeat(32)}` as const;
const INIT_CODE = '0x60006000' as const;

function makeStore() {
  const store = new DeploymentStore();
  const { record, artifactHash } = store.create({
    chainId: 1,
    factory: FACTORY,
    salt: SALT,
    initCode: INIT_CODE,
    constructorArgs: [],
  });
  return { store, record, artifactHash };
}

describe('DeploymentStore', () => {
  it('records a pending deployment with the predicted address', () => {
    const { record } = makeStore();
    expect(record.status).toBe('pending');
    expect(record.predictedAddress).toBe(predictCreate2Address(FACTORY, SALT, INIT_CODE));
  });

  it('recomputeAddress reproduces the stored prediction', () => {
    const { store, record } = makeStore();
    expect(store.recomputeAddress(record.id)).toBe(record.predictedAddress);
  });

  it('lists by chain', () => {
    const { store } = makeStore();
    expect(store.list(1)).toHaveLength(1);
    expect(store.list(10)).toHaveLength(0);
  });

  it('rejects a supplied predicted address that does not match', () => {
    const store = new DeploymentStore();
    expect(() =>
      store.create({
        chainId: 1,
        factory: FACTORY,
        salt: SALT,
        initCode: INIT_CODE,
        constructorArgs: [],
        predictedAddress: '0x0000000000000000000000000000000000009999',
      }),
    ).toThrow(/does not match/i);
  });

  it('throws a not-found error for unknown ids', () => {
    const store = new DeploymentStore();
    expect(() => store.update('dep_missing', {})).toThrow(/not found/i);
  });
});
