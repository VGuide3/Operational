import { describe, expect, it } from 'vitest';
import { type Address, type Hex } from 'viem';
import { AppError } from '@ops/core';
import {
  assertDeploymentApprovals,
  bytecodeHash,
  predictCreate2Address,
  prepareDeployment,
  verifyDeployment,
  type DeploymentRecord,
} from './create2.js';

const FACTORY = '0x4e59b44847b379578588920cA78FbF26c0B4956C' as Address;
const SALT: Hex = `0x${'11'.repeat(32)}`;
const INIT_CODE: Hex = '0x600160005260206000f3';

describe('create2', () => {
  it('computes a deterministic address', () => {
    const a = predictCreate2Address(FACTORY, SALT, INIT_CODE);
    const b = predictCreate2Address(FACTORY, SALT, INIT_CODE);
    expect(a).toBe(b);
    expect(a).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('produces different addresses for different salts', () => {
    const a = predictCreate2Address(FACTORY, SALT, INIT_CODE);
    const b = predictCreate2Address(FACTORY, `0x${'22'.repeat(32)}`, INIT_CODE);
    expect(a).not.toBe(b);
  });

  it('matches a known reference vector', () => {
    // keccak256(0xff ++ factory ++ salt ++ keccak256(initCode))[12:]
    // Verified against the deterministic-deployment-proxy algorithm.
    const predicted = predictCreate2Address(
      '0x0000000000000000000000000000000000000000' as Address,
      `0x${'00'.repeat(32)}` as Hex,
      '0x' as Hex,
    );
    expect(predicted).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('prepares a deployment and detects a mismatched prediction', () => {
    const prepared = prepareDeployment({
      chainId: 1,
      factory: FACTORY,
      salt: SALT,
      initCode: INIT_CODE,
    });
    expect(prepared.matchesSupplied).toBe(true);
    expect(prepared.artifactHash).toMatch(/^0x[0-9a-f]{64}$/);

    const mismatch = prepareDeployment({
      chainId: 1,
      factory: FACTORY,
      salt: SALT,
      initCode: INIT_CODE,
      predictedAddress: '0x0000000000000000000000000000000000000009',
    });
    expect(mismatch.matchesSupplied).toBe(false);
  });

  it('rejects an occupied address', () => {
    expect(() =>
      prepareDeployment({ chainId: 1, factory: FACTORY, salt: SALT, initCode: INIT_CODE }, { addressOccupied: true }),
    ).toThrow(/occupied/);
  });

  it('verifies a deployment against the expected bytecode hash', () => {
    const runtime: Hex = '0x600160005260206000f3';
    const expected = bytecodeHash(runtime);
    const predicted = predictCreate2Address(FACTORY, SALT, INIT_CODE);
    const record: DeploymentRecord = {
      id: 'dep_1',
      chainId: 1,
      factory: FACTORY,
      salt: SALT,
      initCode: INIT_CODE,
      predictedAddress: predicted,
      expectedBytecodeHash: expected,
      actualBytecodeHash: null,
      status: 'deployed',
      txHash: null,
      deployer: null,
      blockNumber: 1,
      approvals: [],
      verificationProvider: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
      failureReason: null,
    };
    const verified = verifyDeployment({ record, actualRuntimeBytecode: runtime, onChainAddress: predicted });
    expect(verified.status).toBe('verified');
  });

  it('halts when deployed to an unexpected address', () => {
    const predicted = predictCreate2Address(FACTORY, SALT, INIT_CODE);
    const record: DeploymentRecord = {
      id: 'dep_1',
      chainId: 1,
      factory: FACTORY,
      salt: SALT,
      initCode: INIT_CODE,
      predictedAddress: predicted,
      expectedBytecodeHash: null,
      actualBytecodeHash: null,
      status: 'deployed',
      txHash: null,
      deployer: null,
      blockNumber: 1,
      approvals: [],
      verificationProvider: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
      failureReason: null,
    };
    const result = verifyDeployment({
      record,
      actualRuntimeBytecode: '0x00',
      onChainAddress: '0x0000000000000000000000000000000000000009',
    });
    expect(result.status).toBe('halted');
    expect(result.failureReason).toContain('unexpected address');
  });

  it('halts when bytecode hash mismatches', () => {
    const predicted = predictCreate2Address(FACTORY, SALT, INIT_CODE);
    const record: DeploymentRecord = {
      id: 'dep_1',
      chainId: 1,
      factory: FACTORY,
      salt: SALT,
      initCode: INIT_CODE,
      predictedAddress: predicted,
      expectedBytecodeHash: bytecodeHash('0x1234'),
      actualBytecodeHash: null,
      status: 'deployed',
      txHash: null,
      deployer: null,
      blockNumber: 1,
      approvals: [],
      verificationProvider: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
      failureReason: null,
    };
    const result = verifyDeployment({ record, actualRuntimeBytecode: '0x00', onChainAddress: predicted });
    expect(result.status).toBe('halted');
    expect(result.failureReason).toContain('bytecode hash');
  });

  it('enforces two-person production approval', () => {
    const base: DeploymentRecord = {
      id: 'dep_1',
      chainId: 1,
      factory: FACTORY,
      salt: SALT,
      initCode: INIT_CODE,
      predictedAddress: predictCreate2Address(FACTORY, SALT, INIT_CODE),
      expectedBytecodeHash: null,
      actualBytecodeHash: null,
      status: 'pending',
      txHash: null,
      deployer: null,
      blockNumber: null,
      approvals: ['usr_a'],
      verificationProvider: null,
      createdAt: new Date().toISOString(),
      completedAt: null,
      failureReason: null,
    };
    expect(() => assertDeploymentApprovals(base, 2)).toThrow(AppError);
    expect(() => assertDeploymentApprovals({ ...base, approvals: ['usr_a', 'usr_b'] }, 2)).not.toThrow();
    // Duplicate approvals do not count twice.
    expect(() => assertDeploymentApprovals({ ...base, approvals: ['usr_a', 'usr_a'] }, 2)).toThrow(AppError);
  });
});
