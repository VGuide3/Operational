import {
  hashTypedData,
  recoverTypedDataAddress,
  verifyTypedData,
  type Address,
  type Hex,
  type TypedData,
} from 'viem';
import { z } from 'zod';
import { AppError, ErrorCodes, canonicalKeccak256 } from '@ops/core';

/**
 * EIP-712 structured signing.
 *
 * Every off-chain authorization in this system (Permit2 permits, delegation
 * grants, backend-job approvals, strategy intents) is signed as EIP-712 typed
 * data whose domain includes name, version, chainId, and verifyingContract.
 * That prevents both cross-domain and cross-chain replay.
 */

export const DOMAIN_NAME = 'Web3 Operations Dashboard' as const;
export const DOMAIN_VERSION = '1' as const;

export const EIP712DomainSchema = z.object({
  name: z.string().min(1),
  version: z.string().min(1),
  chainId: z.number().int().positive(),
  verifyingContract: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
});
export type EIP712Domain = z.infer<typeof EIP712DomainSchema>;

/** Build the canonical domain for a chain's executor/verifier contract. */
export function buildDomain(chainId: number, verifyingContract: Address): EIP712Domain {
  return { name: DOMAIN_NAME, version: DOMAIN_VERSION, chainId, verifyingContract };
}

const StrategyIntentType = [
  { name: 'strategyId', type: 'bytes32' },
  { name: 'version', type: 'uint256' },
  { name: 'chainId', type: 'uint256' },
  { name: 'executor', type: 'address' },
  { name: 'intentHash', type: 'bytes32' },
  { name: 'nonce', type: 'uint256' },
  { name: 'expiresAt', type: 'uint256' },
] as const;

const DelegationType = [
  { name: 'delegationId', type: 'bytes32' },
  { name: 'grantor', type: 'address' },
  { name: 'delegate', type: 'address' },
  { name: 'chainId', type: 'uint256' },
  { name: 'scopeHash', type: 'bytes32' },
  { name: 'validFrom', type: 'uint256' },
  { name: 'validUntil', type: 'uint256' },
  { name: 'nonce', type: 'uint256' },
] as const;

const JobApprovalType = [
  { name: 'jobId', type: 'bytes32' },
  { name: 'runId', type: 'bytes32' },
  { name: 'chainId', type: 'uint256' },
  { name: 'intentHash', type: 'bytes32' },
  { name: 'approver', type: 'address' },
  { name: 'decision', type: 'uint8' },
  { name: 'expiresAt', type: 'uint256' },
] as const;

export const StrategyIntentMessage = z.object({
  strategyId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  version: z.number().int().nonnegative(),
  chainId: z.number().int().positive(),
  executor: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  intentHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  nonce: z.number().int().nonnegative(),
  expiresAt: z.number().int().nonnegative(),
});
export type StrategyIntentMessage = z.infer<typeof StrategyIntentMessage>;

export const DelegationMessage = z.object({
  delegationId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  grantor: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  delegate: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  chainId: z.number().int().positive(),
  scopeHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  validFrom: z.number().int().nonnegative(),
  validUntil: z.number().int().nonnegative(),
  nonce: z.number().int().nonnegative(),
});
export type DelegationMessage = z.infer<typeof DelegationMessage>;

export const JobApprovalMessage = z.object({
  jobId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  runId: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  chainId: z.number().int().positive(),
  intentHash: z.string().regex(/^0x[0-9a-fA-F]{64}$/),
  approver: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  decision: z.number().int().min(0).max(3),
  expiresAt: z.number().int().nonnegative(),
});
export type JobApprovalMessage = z.infer<typeof JobApprovalMessage>;

export const ApprovalDecision = {
  Approve: 0,
  Reject: 1,
  RequestChanges: 2,
  ViewDetails: 3,
} as const;
export type ApprovalDecision = (typeof ApprovalDecision)[keyof typeof ApprovalDecision];

/** Full typed-data payloads as displayed to the wallet. */
export interface TypedPayload {
  domain: EIP712Domain;
  primaryType: string;
  types: Record<string, readonly { name: string; type: string }[]>;
  message: Record<string, unknown>;
}

const baseTypes = {
  EIP712Domain: [
    { name: 'name', type: 'string' },
    { name: 'version', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' },
  ],
} as const;

export function strategyIntentTypedData(
  domain: EIP712Domain,
  message: StrategyIntentMessage,
): TypedPayload {
  return {
    domain,
    primaryType: 'StrategyIntent',
    types: { ...baseTypes, StrategyIntent: StrategyIntentType },
    message: { ...message },
  };
}

export function delegationTypedData(domain: EIP712Domain, message: DelegationMessage): TypedPayload {
  return {
    domain,
    primaryType: 'Delegation',
    types: { ...baseTypes, Delegation: DelegationType },
    message: { ...message },
  };
}

export function jobApprovalTypedData(domain: EIP712Domain, message: JobApprovalMessage): TypedPayload {
  return {
    domain,
    primaryType: 'JobApproval',
    types: { ...baseTypes, JobApproval: JobApprovalType },
    message: { ...message },
  };
}

/** Compute the digest a wallet will sign (and that the server verifies). */
export function typedDataDigest(payload: TypedPayload): Hex {
  return hashTypedData({
    domain: payload.domain,
    primaryType: payload.primaryType,
    types: payload.types,
    message: payload.message,
  } as Parameters<typeof hashTypedData>[0]);
}

export interface VerifyInput {
  payload: TypedPayload;
  signature: Hex;
  expectedAddress: Address;
  /** Reject if the payload's expiry (seconds) is in the past. */
  now?: number;
  expiryField?: string;
  /** Chain the server is currently operating on. */
  expectedChainId: number;
}

export interface VerifyResult {
  valid: boolean;
  recovered: Address;
  digest: Hex;
}

/**
 * Verify an EIP-712 signature server-side.
 *
 * Validates: domain chain matches the operating chain, the signature recovers
 * to the expected signer, and (when an expiry field is supplied) the message
 * has not expired.
 */
export async function verifyTypedSignature(input: VerifyInput): Promise<VerifyResult> {
  const { payload, signature, expectedAddress, expectedChainId } = input;
  const now = input.now ?? Math.floor(Date.now() / 1000);

  if (payload.domain.chainId !== expectedChainId) {
    throw new AppError(
      ErrorCodes.CHAIN_MISMATCH,
      `signature domain chain ${payload.domain.chainId} does not match operating chain ${expectedChainId}`,
      400,
    );
  }
  if (payload.domain.name !== DOMAIN_NAME || payload.domain.version !== DOMAIN_VERSION) {
    throw new AppError(ErrorCodes.DOMAIN_MISMATCH, 'signature domain does not match application domain', 400);
  }

  const expiryField = input.expiryField ?? 'expiresAt';
  const rawExpiry = payload.message[expiryField];
  if (typeof rawExpiry === 'number' && rawExpiry <= now) {
    throw new AppError(ErrorCodes.SIGNATURE_EXPIRED, 'signature has expired', 400);
  }

  const valid = await verifyTypedData({
    address: expectedAddress,
    domain: payload.domain,
    primaryType: payload.primaryType,
    types: payload.types,
    message: payload.message,
    signature,
  } as Parameters<typeof verifyTypedData>[0]);

  const recovered = await recoverTypedDataAddress({
    domain: payload.domain,
    primaryType: payload.primaryType,
    types: payload.types,
    message: payload.message,
    signature,
  } as Parameters<typeof recoverTypedDataAddress>[0]);

  if (!valid || recovered.toLowerCase() !== expectedAddress.toLowerCase()) {
    throw new AppError(
      ErrorCodes.SIGNATURE_INVALID,
      'signature does not recover to the expected signer',
      400,
    );
  }

  return { valid: true, recovered, digest: typedDataDigest(payload) };
}

/**
 * Derive a deterministic bytes32 id from an application id string so it can be
 * used inside an EIP-712 message.
 */
export function toBytes32(id: string): Hex {
  return canonicalKeccak256({ id });
}

/** Human-readable rendering of a typed payload for wallet/UI display. */
export function describeTypedPayload(payload: TypedPayload): string {
  const lines = [
    `${payload.domain.name} v${payload.domain.version}`,
    `Chain: ${payload.domain.chainId}`,
    `Verifying contract: ${payload.domain.verifyingContract}`,
    `Type: ${payload.primaryType}`,
  ];
  for (const [k, v] of Object.entries(payload.message)) {
    lines.push(`  ${k}: ${String(v)}`);
  }
  return lines.join('\n');
}

export type { TypedData };
