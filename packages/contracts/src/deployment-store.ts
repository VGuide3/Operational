import { AppError, ErrorCodes, newId } from '@ops/core';
import { getAddress, type Address, type Hex } from 'viem';
import {
  prepareDeployment,
  predictCreate2Address,
  type Create2DeploymentInput,
  type DeploymentRecord,
} from './create2.js';

/**
 * Deployment store.
 *
 * Records are immutable artifacts. A deployment is never marked `verified`
 * until its on-chain bytecode hash matches the expected hash; a mismatch halts
 * and raises an incident instead of activating the contract.
 */
export class DeploymentStore {
  private readonly deployments = new Map<string, DeploymentRecord>();

  /** Prepare and record a deterministic deployment request. */
  create(input: Create2DeploymentInput): {
    record: DeploymentRecord;
    artifactHash: Hex;
    initCodeHash: Hex;
    matchesSupplied: boolean;
  } {
    const prepared = prepareDeployment(input);
    if (!prepared.matchesSupplied) {
      throw new AppError(
        ErrorCodes.BYTECODE_HASH_MISMATCH,
        'supplied predictedAddress does not match the computed address',
        422,
      );
    }
    const record: DeploymentRecord = {
      id: newId('deployment'),
      chainId: input.chainId,
      factory: getAddress(input.factory) as Address,
      salt: input.salt as Hex,
      initCode: input.initCode as Hex,
      predictedAddress: prepared.predictedAddress,
      expectedBytecodeHash: (input.expectedBytecodeHash as Hex | undefined) ?? null,
      actualBytecodeHash: null,
      status: 'pending',
      txHash: null,
      deployer: null,
      blockNumber: null,
      approvals: [],
      verificationProvider: input.verification?.provider ?? null,
      createdAt: new Date().toISOString(),
      completedAt: null,
      failureReason: null,
    };
    this.deployments.set(record.id, record);
    return {
      record,
      artifactHash: prepared.artifactHash,
      initCodeHash: prepared.initCodeHash,
      matchesSupplied: prepared.matchesSupplied,
    };
  }

  get(id: string): DeploymentRecord | undefined {
    return this.deployments.get(id);
  }

  list(chainId?: number): DeploymentRecord[] {
    const items = [...this.deployments.values()];
    return chainId === undefined ? items : items.filter((d) => d.chainId === chainId);
  }

  update(id: string, patch: Partial<DeploymentRecord>): DeploymentRecord {
    const record = this.require(id);
    Object.assign(record, patch);
    return record;
  }

  /** Recompute the address for a stored request; used for verification display. */
  recomputeAddress(id: string): Address {
    const record = this.require(id);
    return predictCreate2Address(record.factory, record.salt, record.initCode);
  }

  private require(id: string): DeploymentRecord {
    const record = this.deployments.get(id);
    if (!record) throw new AppError(ErrorCodes.NOT_FOUND, `deployment ${id} not found`, 404);
    return record;
  }
}
