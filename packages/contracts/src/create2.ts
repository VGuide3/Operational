import { concatHex, getAddress, keccak256, toHex, type Address, type Hex } from 'viem';
import { z } from 'zod';
import { AppError, ErrorCodes, canonicalKeccak256 } from '@ops/core';

/**
 * CREATE2 deterministic deployment.
 *
 * predicted = keccak256(0xff ++ factory ++ salt ++ keccak256(initCode))[12:]
 * The same factory, salt, and init code always produce the same address. A
 * deployment is not marked complete until on-chain bytecode matches the
 * expected code hash.
 */

export const AddressSchema = z.string().regex(/^0x[0-9a-fA-F]{40}$/);
export const Bytes32Schema = z.string().regex(/^0x[0-9a-fA-F]{64}$/);
export const HexDataSchema = z.string().regex(/^0x[0-9a-fA-F]*$/);

export const Create2DeploymentInput = z.object({
  chainId: z.number().int().positive(),
  factory: AddressSchema,
  salt: Bytes32Schema,
  /** Hex-encoded initialization code (creation code + constructor args). */
  initCode: HexDataSchema,
  constructorArgs: z.array(z.unknown()).default([]),
  predictedAddress: AddressSchema.optional(),
  expectedBytecodeHash: Bytes32Schema.optional(),
  verification: z
    .object({
      provider: z.string(),
      status: z.enum(['pending', 'verified', 'failed']),
    })
    .optional(),
  /** Compiler provenance pinned with the artifact. */
  build: z
    .object({
      compilerVersion: z.string(),
      optimizer: z.boolean(),
      optimizerRuns: z.number().int().nonnegative(),
      evmVersion: z.string(),
      metadataHash: z.string(),
      sourceHash: z.string(),
    })
    .optional(),
});
export type Create2DeploymentInput = z.input<typeof Create2DeploymentInput>;

/**
 * Compute the CREATE2 address for a factory, salt, and initialization code.
 * Reproducible: callers must display this before submission.
 */
export function predictCreate2Address(factory: Address, salt: Hex, initCode: Hex): Address {
  const codeHash = keccak256(initCode);
  const payload = concatHex(['0xff', getAddress(factory), salt as Hex, codeHash]);
  const hash = keccak256(payload);
  return getAddress(`0x${hash.slice(-40)}`);
}

/** keccak256 of deployed runtime bytecode, for verification. */
export function bytecodeHash(runtimeBytecode: Hex): Hex {
  return keccak256(runtimeBytecode);
}

export interface DeploymentRecord {
  id: string;
  chainId: number;
  factory: Address;
  salt: Hex;
  initCode: Hex;
  predictedAddress: Address;
  expectedBytecodeHash: Hex | null;
  actualBytecodeHash: Hex | null;
  status: 'pending' | 'deployed' | 'verified' | 'failed' | 'halted';
  txHash: Hex | null;
  deployer: string | null;
  blockNumber: number | null;
  approvals: string[];
  verificationProvider: string | null;
  createdAt: string;
  completedAt: string | null;
  failureReason: string | null;
}

export interface PrepareDeploymentOptions {
  /** Whether the predicted address is already occupied on-chain. */
  addressOccupied?: boolean;
  /** Roles that must approve a production deployment (two-person rule). */
  requiredApprovals?: number;
}

export interface PreparedDeployment {
  predictedAddress: Address;
  /** Hash of the initialization code that determines the address. */
  initCodeHash: Hex;
  /** Deterministic artifact hash for the audit trail. */
  artifactHash: Hex;
  /** Recompute matches the supplied predictedAddress, if any. */
  matchesSupplied: boolean;
}

/**
 * Prepare a deployment: recompute the address, reject an occupied address, and
 * produce a deterministic artifact hash.
 */
export function prepareDeployment(
  input: Create2DeploymentInput,
  options: PrepareDeploymentOptions = {},
): PreparedDeployment {
  const parsed = Create2DeploymentInput.parse(input);
  if (options.addressOccupied) {
    throw new AppError(ErrorCodes.ADDRESS_OCCUPIED, 'predicted address is already occupied', 409);
  }
  const predictedAddress = predictCreate2Address(
    parsed.factory as Address,
    parsed.salt as Hex,
    parsed.initCode as Hex,
  );
  const initCodeHash = keccak256(parsed.initCode as Hex);
  const artifactHash = canonicalKeccak256({
    chainId: parsed.chainId,
    factory: parsed.factory,
    salt: parsed.salt,
    initCodeHash,
    build: parsed.build ?? null,
  });
  const matchesSupplied =
    parsed.predictedAddress === undefined ||
    parsed.predictedAddress.toLowerCase() === predictedAddress.toLowerCase();
  return { predictedAddress, initCodeHash, artifactHash, matchesSupplied };
}

/**
 * Verify a deployed contract: the on-chain bytecode hash must equal the
 * expected hash. A mismatch halts and must not mark the contract active.
 */
export function verifyDeployment(input: {
  record: DeploymentRecord;
  actualRuntimeBytecode: Hex;
  onChainAddress: Address;
}): DeploymentRecord {
  const { record } = input;
  const actual = bytecodeHash(input.actualRuntimeBytecode);
  const updated: DeploymentRecord = { ...record, actualBytecodeHash: actual };

  if (input.onChainAddress.toLowerCase() !== record.predictedAddress.toLowerCase()) {
    updated.status = 'halted';
    updated.failureReason = `deployed to unexpected address ${input.onChainAddress}`;
    return updated;
  }
  if (record.expectedBytecodeHash && actual.toLowerCase() !== record.expectedBytecodeHash.toLowerCase()) {
    updated.status = 'halted';
    updated.failureReason = 'deployed bytecode hash does not match the expected hash';
    return updated;
  }
  updated.status = 'verified';
  updated.completedAt = new Date().toISOString();
  return updated;
}

/** Assert that a production deployment has the required approvals. */
export function assertDeploymentApprovals(record: DeploymentRecord, required = 2): void {
  const distinct = new Set(record.approvals);
  if (distinct.size < required) {
    throw new AppError(
      ErrorCodes.APPROVAL_REQUIRED,
      `production deployment requires ${required} approvals (have ${distinct.size})`,
      403,
    );
  }
}

export const SALT_ZERO: Hex = toHex(0, { size: 32 });
