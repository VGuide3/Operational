import { describe, expect, it } from 'vitest';
import { AuditLog } from './log.js';

describe('audit log', () => {
  it('appends events with a chained hash', () => {
    const log = new AuditLog();
    const e1 = log.append({ actorType: 'user', actorId: 'usr_1', action: 'wallet.connect', resourceType: 'wallet' });
    const e2 = log.append({ actorType: 'user', actorId: 'usr_1', action: 'consent.grant', resourceType: 'consent' });
    expect(e1.prevEventHash).toBeNull();
    expect(e2.prevEventHash).toBe(e1.eventHash);
    expect(log.length).toBe(2);
  });

  it('verifies an intact chain', () => {
    const log = new AuditLog();
    for (let i = 0; i < 5; i++) {
      log.append({ actorType: 'system', action: 'scan.complete', resourceType: 'scan' });
    }
    expect(log.verifyChain()).toEqual({ ok: true });
  });

  it('detects a tampered event', () => {
    const log = new AuditLog();
    for (let i = 0; i < 3; i++) {
      log.append({ actorType: 'system', action: 'scan.complete', resourceType: 'scan' });
    }
    const events = log.all() as unknown as { eventHash: string }[];
    events[1]!.eventHash = '0xdeadbeef';
    const result = log.verifyChain();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.brokenAtSeq).toBe(2);
  });

  it('rejects unknown actions via schema validation', () => {
    const log = new AuditLog();
    expect(() =>
      log.append({ actorType: 'user', action: 'not.an.action' as never, resourceType: 'x' }),
    ).toThrow();
  });

  it('queries by action and filters, newest first', () => {
    const log = new AuditLog();
    log.append({ actorType: 'user', action: 'wallet.connect', resourceType: 'wallet' });
    log.append({ actorType: 'user', action: 'scan.complete', resourceType: 'scan' });
    log.append({ actorType: 'user', action: 'scan.complete', resourceType: 'scan' });
    const result = log.query({ action: 'scan.complete' });
    expect(result.items).toHaveLength(2);
    expect(result.items[0]!.seq).toBeGreaterThan(result.items[1]!.seq);
  });

  it('publishes anchors over the head', () => {
    const log = new AuditLog();
    log.append({ actorType: 'system', action: 'scan.complete', resourceType: 'scan' });
    const anchor = log.anchor('https://anchor.example/log');
    expect(anchor.seq).toBe(1);
    expect(log.listAnchors()).toHaveLength(1);
  });
});
