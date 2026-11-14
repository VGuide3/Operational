import { z } from 'zod';
import { newId } from '@ops/core';

/**
 * Append-only, hash-linked audit log.
 *
 * `event_hash` is computed from the canonical event fields plus the previous
 * event's hash, giving tamper-evidence and a stable anchor for periodic
 * external anchoring. Audit events are never mutated or deleted.
 */

export const ActorType = z.enum(['user', 'system', 'service', 'embed', 'approver', 'delegate']);
export type ActorType = z.infer<typeof ActorType>;

/** Canonical action names emitted across the system. */
export const AuditAction = z.enum([
  'wallet.connect',
  'wallet.disconnect',
  'wallet.chain_switch',
  'consent.grant',
  'consent.revoke',
  'consent.expired',
  'consent.invalidated',
  'contract.import',
  'contract.validation_failure',
  'contract.approve',
  'contract.activate',
  'scan.start',
  'scan.complete',
  'scan.failure',
  'scan.stale',
  'strategy.create',
  'strategy.compile',
  'strategy.simulate',
  'strategy.approve',
  'strategy.execute',
  'strategy.revert',
  'strategy.complete',
  'permit2.request',
  'permit2.verify',
  'permit2.nonce_use',
  'permit2.expiry',
  'permit2.replay_attempt',
  'create2.predict',
  'create2.deploy',
  'create2.verify',
  'create2.mismatch',
  'create2.rollback',
  'delegation.create',
  'delegation.use',
  'delegation.limit_breach',
  'delegation.revoke',
  'delegation.expire',
  'approval.request',
  'approval.callback',
  'approval.approve',
  'approval.reject',
  'approval.expire',
  'approval.invalid_signature',
  'auth.failure',
  'authz.denial',
  'ratelimit.hit',
  'suspicious.pattern',
  'job.queue',
  'job.execute',
  'job.failure',
  'job.dead_letter',
  'embed.init',
  'embed.reject_origin',
]);
export type AuditAction = z.infer<typeof AuditAction>;

export const AuditEventInput = z.object({
  occurredAt: z.string().datetime().optional(),
  actorType: ActorType,
  actorId: z.string().nullable().optional(),
  walletAddress: z.string().nullable().optional(),
  impersonatedBy: z.string().uuid().nullable().optional(),
  action: AuditAction,
  resourceType: z.string().min(1),
  resourceId: z.string().nullable().optional(),
  chainId: z.number().int().nullable().optional(),
  beforeState: z.unknown().optional(),
  afterState: z.unknown().optional(),
  requestId: z.string().nullable().optional(),
  ipHash: z.string().nullable().optional(),
  userAgentHash: z.string().nullable().optional(),
  signatureDigest: z.string().nullable().optional(),
});
export type AuditEventInput = z.infer<typeof AuditEventInput>;

export interface AuditEvent extends Required<Pick<AuditEventInput, 'actorType' | 'action' | 'resourceType'>> {
  /** bigserial-equivalent, monotonically increasing sequence. */
  seq: number;
  eventId: string;
  occurredAt: string;
  actorId: string | null;
  walletAddress: string | null;
  impersonatedBy: string | null;
  resourceId: string | null;
  chainId: number | null;
  beforeState: unknown;
  afterState: unknown;
  requestId: string | null;
  ipHash: string | null;
  userAgentHash: string | null;
  signatureDigest: string | null;
  prevEventHash: string | null;
  eventHash: string;
}

/** Fields that participate in the hash, in a fixed canonical shape. */
export function eventHashPayload(
  event: Omit<AuditEvent, 'eventHash' | 'prevEventHash' | 'seq'>,
  prevEventHash: string | null,
): Record<string, unknown> {
  return {
    eventId: event.eventId,
    occurredAt: event.occurredAt,
    actorType: event.actorType,
    actorId: event.actorId,
    walletAddress: event.walletAddress,
    impersonatedBy: event.impersonatedBy,
    action: event.action,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    chainId: event.chainId,
    beforeState: event.beforeState ?? null,
    afterState: event.afterState ?? null,
    requestId: event.requestId,
    ipHash: event.ipHash,
    userAgentHash: event.userAgentHash,
    signatureDigest: event.signatureDigest,
    prevEventHash,
  };
}

export function makeEventId(): string {
  return newId('event');
}
