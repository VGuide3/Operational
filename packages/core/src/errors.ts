/**
 * Stable, machine-readable error codes returned by every API route.
 * Raw stack traces are never returned to callers.
 */
export const ErrorCodes = {
  // auth / consent
  UNAUTHENTICATED: 'unauthenticated',
  FORBIDDEN: 'forbidden',
  CONSENT_REQUIRED: 'consent_required',
  CONSENT_EXPIRED: 'consent_expired',
  CONSENT_REVOKED: 'consent_revoked',
  CONSENT_INVALIDATED: 'consent_invalidated',
  // validation
  VALIDATION_FAILED: 'validation_failed',
  UNKNOWN_CHAIN: 'unknown_chain',
  // contracts
  DUPLICATE_CONTRACT: 'duplicate_contract',
  UNVERIFIED_NOT_ALLOWED: 'unverified_not_allowed',
  BYTECODE_MISSING: 'bytecode_missing',
  // strategy
  STRATEGY_UNRESOLVED_REFERENCE: 'strategy_unresolved_reference',
  STRATEGY_INVALID_DECIMALS: 'strategy_invalid_decimals',
  STRATEGY_UNKNOWN_FUNCTION: 'strategy_unknown_function',
  STRATEGY_DEADLINE_EXPIRED: 'strategy_deadline_expired',
  POLICY_LIMIT_EXCEEDED: 'policy_limit_exceeded',
  SIMULATION_REQUIRED: 'simulation_required',
  SIMULATION_FAILED: 'simulation_failed',
  // signatures / permit2
  SIGNATURE_INVALID: 'signature_invalid',
  SIGNATURE_EXPIRED: 'signature_expired',
  NONCE_REUSED: 'nonce_reused',
  INTENT_HASH_REUSED: 'intent_hash_reused',
  DOMAIN_MISMATCH: 'domain_mismatch',
  CHAIN_MISMATCH: 'chain_mismatch',
  // deployments
  ADDRESS_OCCUPIED: 'address_occupied',
  BYTECODE_HASH_MISMATCH: 'bytecode_hash_mismatch',
  DEPLOYMENT_NOT_VERIFIED: 'deployment_not_verified',
  // approvals
  APPROVAL_REQUIRED: 'approval_required',
  APPROVAL_REPLAYED: 'approval_replayed',
  APPROVAL_EXPIRED: 'approval_expired',
  QUORUM_NOT_MET: 'quorum_not_met',
  SELF_APPROVAL_FORBIDDEN: 'self_approval_forbidden',
  WEBHOOK_SIGNATURE_INVALID: 'webhook_signature_invalid',
  // delegation
  DELEGATION_INVALID: 'delegation_invalid',
  DELEGATION_REVOKED: 'delegation_revoked',
  DELEGATION_EXPIRED: 'delegation_expired',
  DELEGATION_SCOPE_VIOLATION: 'delegation_scope_violation',
  // rate limiting / infra
  RATE_LIMITED: 'rate_limited',
  IDEMPOTENCY_CONFLICT: 'idempotency_conflict',
  NOT_FOUND: 'not_found',
  CONFLICT: 'conflict',
  INTERNAL: 'internal_error',
} as const;

export type ErrorCode = (typeof ErrorCodes)[keyof typeof ErrorCodes];

export interface ErrorDetail {
  path: string;
  message: string;
}

/** Base class for all domain errors surfaced to API clients. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly details?: ErrorDetail[];

  constructor(
    code: ErrorCode,
    message: string,
    httpStatus = 400,
    details?: ErrorDetail[],
  ) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatus;
    if (details) this.details = details;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }
}

export function isAppError(e: unknown): e is AppError {
  return e instanceof AppError;
}

export class ValidationError extends AppError {
  constructor(details: ErrorDetail[]) {
    super(ErrorCodes.VALIDATION_FAILED, 'request validation failed', 422, details);
    this.name = 'ValidationError';
  }
}

export class NotFoundError extends AppError {
  constructor(message = 'resource not found') {
    super(ErrorCodes.NOT_FOUND, message, 404);
    this.name = 'NotFoundError';
  }
}
