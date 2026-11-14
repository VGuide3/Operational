import { hashTypedData, type Address, type Hex } from 'viem';
import { AppError, ErrorCodes, canonicalKeccak256 } from '@ops/core';
import { getChain, type ChainRegistryLike } from '@ops/chains';
import {
  PermitTransferDetails,
  PermitTransferFrom,
  type AllowanceRecord,
  isMaxAllowance,
} from './types.js';

/**
 * Permit2 integration.
 *
 * Flow (README "Permit2 transfer flow"):
 *  1. verify the wallet owns the token balance
 *  2. check the token's allowance to the canonical Permit2 contract
 *  3. if insufficient, prompt a standard ERC-20 approval to Permit2
 *  4. generate a PermitTransferFrom with unique nonce + deadline
 *  5. request an EIP-712 signature
 *  6. submit permit + transfer details + owner + signature to the executor
 *  7. record signature digest, nonce, deadline, chain, intent hash, result
 */

export const PERMIT2_DOMAIN_NAME = 'Permit2';

/** EIP-712 types for Permit2 permitTransferFrom. */
export const permit2Types = {
  EIP712Domain: [
    { name: 'name', type: 'string' },
    { name: 'chainId', type: 'uint256' },
    { name: 'verifyingContract', type: 'address' },
  ],
  PermitTransferFrom: [
    { name: 'permitted', type: 'TokenPermissions' },
    { name: 'spender', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
  ],
  TokenPermissions: [
    { name: 'token', type: 'address' },
    { name: 'amount', type: 'uint256' },
  ],
  // Witness variant appends the witness struct to the primary type.
  PermitWitnessTransferFrom: [
    { name: 'permitted', type: 'TokenPermissions' },
    { name: 'spender', type: 'address' },
    { name: 'nonce', type: 'uint256' },
    { name: 'deadline', type: 'uint256' },
    { name: 'witness', type: 'StrategyWitness' },
  ],
  StrategyWitness: [
    { name: 'strategyId', type: 'bytes32' },
    { name: 'intentHash', type: 'bytes32' },
    { name: 'expiresAt', type: 'uint256' },
    { name: 'executor', type: 'address' },
  ],
} as const;

export interface Permit2Domain {
  name: string;
  chainId: number;
  verifyingContract: Address;
}

export function permit2Domain(chainId: number, registry?: ChainRegistryLike): Permit2Domain {
  const chain = getChain(chainId, registry);
  if (!chain.permit2) {
    throw new AppError(ErrorCodes.UNKNOWN_CHAIN, `no Permit2 for chain ${chainId}`, 400);
  }
  return { name: PERMIT2_DOMAIN_NAME, chainId, verifyingContract: chain.permit2 as Address };
}

export interface Permit2PayloadInput {
  chainId: number;
  spender: Address;
  token: Address;
  amount: bigint;
  nonce: bigint;
  deadline: number;
  witness?: {
    strategyId: Hex;
    intentHash: Hex;
    expiresAt: number;
    executor: Address;
  };
  registry?: ChainRegistryLike;
}

/**
 * Build the EIP-712 payload for a Permit2 permit. When a witness is present,
 * the primary type is PermitWitnessTransferFrom with witness struct ordering
 * following EIP-712 rules.
 */
export function buildPermit2Payload(input: Permit2PayloadInput) {
  const domain = permit2Domain(input.chainId, input.registry);
  const message: Record<string, unknown> = {
    permitted: { token: input.token, amount: input.amount.toString() },
    spender: input.spender,
    nonce: input.nonce.toString(),
    deadline: input.deadline,
  };
  if (input.witness) {
    message.witness = input.witness;
    return {
      domain,
      primaryType: 'PermitWitnessTransferFrom',
      types: {
        EIP712Domain: permit2Types.EIP712Domain,
        PermitWitnessTransferFrom: permit2Types.PermitWitnessTransferFrom,
        TokenPermissions: permit2Types.TokenPermissions,
        StrategyWitness: permit2Types.StrategyWitness,
      },
      message,
    };
  }
  return {
    domain,
    primaryType: 'PermitTransferFrom',
    types: {
      EIP712Domain: permit2Types.EIP712Domain,
      PermitTransferFrom: permit2Types.PermitTransferFrom,
      TokenPermissions: permit2Types.TokenPermissions,
    },
    message,
  };
}

export function permitDigest(payload: ReturnType<typeof buildPermit2Payload>): Hex {
  return hashTypedData(payload as Parameters<typeof hashTypedData>[0]);
}

/** Nonce + intent-hash tracking to make permits single-use. */
export class NonceStore {
  /** consumed nonces keyed by `${chainId}:${owner}:${token}:${nonce}`. */
  private consumed = new Set<string>();
  /** intent hashes already used to create a permit. */
  private intentHashes = new Set<string>();

  private nonceKey(chainId: number, owner: string, token: string, nonce: bigint): string {
    return `${chainId}:${owner.toLowerCase()}:${token.toLowerCase()}:${nonce.toString()}`;
  }

  isConsumed(chainId: number, owner: string, token: string, nonce: bigint): boolean {
    return this.consumed.has(this.nonceKey(chainId, owner, token, nonce));
  }

  /** Reserve a nonce; throws if it was already used (replay). */
  consume(chainId: number, owner: string, token: string, nonce: bigint): void {
    const key = this.nonceKey(chainId, owner, token, nonce);
    if (this.consumed.has(key)) {
      throw new AppError(ErrorCodes.NONCE_REUSED, 'permit nonce has already been used', 409);
    }
    this.consumed.add(key);
  }

  /** Reserve an intent hash; throws if a permit was already issued for it. */
  reserveIntent(intentHash: string): void {
    if (this.intentHashes.has(intentHash)) {
      throw new AppError(ErrorCodes.INTENT_HASH_REUSED, 'a permit was already issued for this intent', 409);
    }
    this.intentHashes.add(intentHash);
  }

  /** Deterministic nonce derived from intent hash, owner, and a salt. */
  deriveNonce(owner: string, intentHash: string, salt: number): bigint {
    const h = canonicalKeccak256({ owner: owner.toLowerCase(), intentHash, salt });
    return BigInt(h) % (1n << 48n);
  }
}

export interface PermitValidationInput {
  permit: PermitTransferFrom;
  details: PermitTransferDetails;
  /** Owner that signed the permit. */
  owner: Address;
  /** Token balance owned by `owner` (base units). */
  ownerBalance: bigint;
  /** Owner's ERC-20 allowance to the canonical Permit2 contract. */
  permit2Erc20Allowance: bigint;
  /** Spender authorized by the permit (the executor). */
  spender: Address;
  now: number;
}

export interface PermitValidationResult {
  ok: boolean;
  /** Whether a standard ERC-20 approval to Permit2 must happen first. */
  needsErc20Approval: boolean;
  /** Amount to approve if needed. */
  suggestedApproval?: string;
}

/**
 * Validate a Permit2 transfer against on-chain preconditions before the
 * signature is requested. Does not consume the nonce; call `NonceStore.consume`
 * at submission time.
 */
export function validatePermitPreconditions(input: PermitValidationInput): PermitValidationResult {
  const { permit, details, ownerBalance, permit2Erc20Allowance, now } = input;

  if (permit.deadline <= now) {
    throw new AppError(ErrorCodes.SIGNATURE_EXPIRED, 'permit deadline has passed', 400);
  }
  const amount = BigInt(permit.amount);
  const requested = BigInt(details.requestedAmount);
  if (requested > amount) {
    throw new AppError(
      ErrorCodes.VALIDATION_FAILED,
      'requested amount exceeds the permitted maximum',
      422,
    );
  }
  if (ownerBalance < requested) {
    throw new AppError(
      ErrorCodes.POLICY_LIMIT_EXCEEDED,
      'owner does not hold the requested token balance',
      403,
    );
  }
  const needsErc20Approval = permit2Erc20Allowance < requested;
  return {
    ok: true,
    needsErc20Approval,
    ...(needsErc20Approval ? { suggestedApproval: permit.amount } : {}),
  };
}

/** Label an allowance record for display, flagging unlimited approvals. */
export function describeAllowance(record: AllowanceRecord): string {
  const base = `${record.token} -> ${record.spender} on chain ${record.chainId}`;
  if (record.allowanceIsMax || isMaxAllowance(record.allowanceRaw)) {
    return `${base}: UNLIMITED`;
  }
  return `${base}: ${record.allowanceRaw}`;
}
