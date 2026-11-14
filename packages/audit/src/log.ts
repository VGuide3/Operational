import { canonicalKeccak256, AppError, ErrorCodes } from '@ops/core';
import {
  AuditEvent,
  AuditEventInput,
  eventHashPayload,
  makeEventId,
} from './event.js';

/**
 * Hash-linked audit writer.
 *
 * The writer is append-only: there is no update or delete API. Each event's
 * hash chains to its predecessor, so removing or mutating any event breaks the
 * chain and is detectable via `verifyChain`.
 */

export interface AuditAnchor {
  /** Sequence of the last event covered by the anchor. */
  seq: number;
  eventHash: string;
  /** Where the anchor was published (e.g. an external transparency log). */
  location: string;
  anchoredAt: string;
}

export class AuditLog {
  private events: AuditEvent[] = [];
  private anchors: AuditAnchor[] = [];
  /** Fast lookup guard for event ids. */
  private ids = new Set<string>();

  append(input: AuditEventInput): AuditEvent {
    const parsed = AuditEventInput.parse(input);
    const eventId = makeEventId();
    if (this.ids.has(eventId)) {
      throw new AppError(ErrorCodes.CONFLICT, 'duplicate audit event id', 409);
    }
    const prev = this.events[this.events.length - 1];
    const prevEventHash = prev ? prev.eventHash : null;
    const seq = this.events.length + 1;
    const occurredAt = parsed.occurredAt ?? new Date().toISOString();

    const body: Omit<AuditEvent, 'eventHash' | 'prevEventHash' | 'seq'> = {
      eventId,
      occurredAt,
      actorType: parsed.actorType,
      actorId: parsed.actorId ?? null,
      walletAddress: parsed.walletAddress ?? null,
      impersonatedBy: parsed.impersonatedBy ?? null,
      action: parsed.action,
      resourceType: parsed.resourceType,
      resourceId: parsed.resourceId ?? null,
      chainId: parsed.chainId ?? null,
      beforeState: parsed.beforeState ?? null,
      afterState: parsed.afterState ?? null,
      requestId: parsed.requestId ?? null,
      ipHash: parsed.ipHash ?? null,
      userAgentHash: parsed.userAgentHash ?? null,
      signatureDigest: parsed.signatureDigest ?? null,
    };

    const eventHash = canonicalKeccak256(eventHashPayload(body, prevEventHash));
    const event: AuditEvent = { ...body, prevEventHash, eventHash, seq };
    this.events.push(event);
    this.ids.add(eventId);
    return event;
  }

  get length(): number {
    return this.events.length;
  }

  all(): readonly AuditEvent[] {
    return this.events;
  }

  getByEventId(eventId: string): AuditEvent | undefined {
    return this.events.find((e) => e.eventId === eventId);
  }

  /** Query by actor, action, resource, chain, or time window. */
  query(filter: {
    actorId?: string;
    action?: string;
    resourceType?: string;
    resourceId?: string;
    chainId?: number;
    since?: string;
    until?: string;
    limit?: number;
    cursorSeq?: number;
  } = {}): { items: AuditEvent[]; nextCursor: string | null } {
    let items = this.events.filter((e) => {
      if (filter.actorId && e.actorId !== filter.actorId) return false;
      if (filter.action && e.action !== filter.action) return false;
      if (filter.resourceType && e.resourceType !== filter.resourceType) return false;
      if (filter.resourceId && e.resourceId !== filter.resourceId) return false;
      if (filter.chainId !== undefined && e.chainId !== filter.chainId) return false;
      if (filter.since && e.occurredAt < filter.since) return false;
      if (filter.until && e.occurredAt > filter.until) return false;
      if (filter.cursorSeq !== undefined && e.seq <= filter.cursorSeq) return false;
      return true;
    });
    items = items.sort((a, b) => b.seq - a.seq);
    const limit = Math.min(filter.limit ?? 100, 500);
    const slice = items.slice(0, limit);
    const last = slice[slice.length - 1];
    const nextCursor = last && items.length > limit ? String(last.seq) : null;
    return { items: slice, nextCursor };
  }

  /**
   * Recompute the chain and report the first discontinuity, if any.
   * Used by the audit-chain hash discontinuity alert.
   */
  verifyChain(): { ok: true } | { ok: false; brokenAtSeq: number; reason: string } {
    let prevHash: string | null = null;
    for (const event of this.events) {
      if (event.prevEventHash !== prevHash) {
        return { ok: false, brokenAtSeq: event.seq, reason: 'prevEventHash linkage mismatch' };
      }
      // Recompute from the canonical body, excluding seq and the hashes themselves.
      const { eventHash: _h, prevEventHash: _p, seq: _s, ...body } = event;
      const recomputed = canonicalKeccak256(eventHashPayload(body, prevHash));
      if (recomputed !== event.eventHash) {
        return { ok: false, brokenAtSeq: event.seq, reason: 'eventHash mismatch' };
      }
      prevHash = event.eventHash;
    }
    return { ok: true };
  }

  /** Publish an anchor covering the current head (for external anchoring). */
  anchor(location: string): AuditAnchor {
    const head = this.events[this.events.length - 1];
    if (!head) throw new AppError(ErrorCodes.CONFLICT, 'cannot anchor an empty audit log', 409);
    const anchor: AuditAnchor = {
      seq: head.seq,
      eventHash: head.eventHash,
      location,
      anchoredAt: new Date().toISOString(),
    };
    this.anchors.push(anchor);
    return anchor;
  }

  listAnchors(): readonly AuditAnchor[] {
    return this.anchors;
  }
}
