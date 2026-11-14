import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { AppError } from '@ops/core';
import {
  ApprovalService,
  decodeCallbackData,
  encodeCallbackData,
  renderApprovalMessage,
  verifyBodySignature,
  verifyWebhookSecret,
} from './index.js';

function setup(quorum = 1) {
  const svc = new ApprovalService();
  const job = svc.createJob({
    runId: 'run_1',
    jobHash: '0xabc',
    requestedBy: 'usr_requester',
    quorum,
    eligibleApprovers: ['usr_a', 'usr_b'],
  });
  return { svc, job };
}

describe('telegram webhook security', () => {
  it('validates the secret token in constant time', () => {
    expect(verifyWebhookSecret('s3cret', 's3cret')).toBe(true);
    expect(verifyWebhookSecret('wrong', 's3cret')).toBe(false);
    expect(verifyWebhookSecret(undefined, 's3cret')).toBe(false);
  });

  it('verifies body signatures', () => {
    const body = JSON.stringify({ update_id: 1 });
    const sig = createHmac('sha256', 'k').update(body).digest('hex');
    expect(verifyBodySignature(body, sig, 'k')).toBe(true);
    expect(verifyBodySignature(body, 'bad', 'k')).toBe(false);
  });

  it('round-trips callback data', () => {
    const data = { jobId: 'job_1', decision: 'approve' as const, token: 'tok_12345678' };
    expect(decodeCallbackData(encodeCallbackData(data))).toEqual(data);
  });
});

describe('approval lifecycle', () => {
  it('clears a job once quorum is met', () => {
    const { svc, job } = setup(2);
    const t1 = svc.issueToken(job.id, 'approve');
    svc.recordDecision({ jobId: job.id, token: t1.token, decision: 'approve', approverId: 'usr_a', callbackId: 'c1' });
    expect(svc.getJob(job.id)!.state).toBe('awaiting_approval');
    const t2 = svc.issueToken(job.id, 'approve');
    svc.recordDecision({ jobId: job.id, token: t2.token, decision: 'approve', approverId: 'usr_b', callbackId: 'c2' });
    expect(svc.getJob(job.id)!.state).toBe('queued');
    expect(() => svc.assertExecutable(job.id)).not.toThrow();
  });

  it('rejects a replayed callback', () => {
    const { svc, job } = setup();
    const t = svc.issueToken(job.id, 'approve');
    svc.recordDecision({ jobId: job.id, token: t.token, decision: 'approve', approverId: 'usr_a', callbackId: 'c1' });
    expect(() =>
      svc.recordDecision({ jobId: job.id, token: t.token, decision: 'approve', approverId: 'usr_a', callbackId: 'c1' }),
    ).toThrow(AppError);
  });

  it('rejects a reused token', () => {
    const { svc, job } = setup();
    const t = svc.issueToken(job.id, 'approve');
    svc.recordDecision({ jobId: job.id, token: t.token, decision: 'approve', approverId: 'usr_a', callbackId: 'c1' });
    expect(() =>
      svc.recordDecision({ jobId: job.id, token: t.token, decision: 'approve', approverId: 'usr_b', callbackId: 'c2' }),
    ).toThrow(/already been used/);
  });

  it('prevents self-approval', () => {
    const svc = new ApprovalService();
    const job = svc.createJob({
      runId: 'r',
      jobHash: '0x1',
      requestedBy: 'usr_a',
      eligibleApprovers: ['usr_a'],
    });
    const t = svc.issueToken(job.id, 'approve');
    expect(() =>
      svc.recordDecision({ jobId: job.id, token: t.token, decision: 'approve', approverId: 'usr_a', callbackId: 'c1' }),
    ).toThrow(/own job/);
  });

  it('expires jobs and blocks execution', () => {
    const { svc, job } = setup();
    const now = Date.now() + 3600_000;
    svc.sweep(now);
    expect(svc.getJob(job.id)!.state).toBe('expired');
    expect(() => svc.assertExecutable(job.id, now)).toThrow(/expired/);
  });

  it('blocks execution before quorum', () => {
    const { svc, job } = setup(2);
    expect(() => svc.assertExecutable(job.id)).toThrow(AppError);
  });

  it('marks rejected jobs and blocks execution', () => {
    const { svc, job } = setup();
    const t = svc.issueToken(job.id, 'reject');
    svc.recordDecision({ jobId: job.id, token: t.token, decision: 'reject', approverId: 'usr_a', callbackId: 'c1' });
    expect(svc.getJob(job.id)!.state).toBe('rejected');
    expect(() => svc.assertExecutable(job.id)).toThrow(/rejected/);
  });

  it('supports the dashboard fallback approval path', () => {
    const { svc, job } = setup();
    svc.recordDashboardApproval({ jobId: job.id, approverId: 'usr_a', decision: 'approve' });
    expect(svc.getJob(job.id)!.state).toBe('queued');
  });
});

describe('message rendering', () => {
  it('renders a structured, secret-free message', () => {
    const msg = renderApprovalMessage({
      jobId: 'job_1',
      runId: 'run_1',
      strategyName: 'rebalance',
      chainId: 1,
      actor: 'usr_a',
      actions: ['Transfer 100 USDC to 0xabc'],
      usdExposure: '100.00',
      simulationSummary: 'ok',
      expiresAt: new Date().toISOString(),
      jobHash: '0x' + 'a'.repeat(64),
    });
    expect(msg).toContain('Approval required');
    expect(msg).toContain('Transfer 100 USDC');
    expect(msg).not.toContain('privateKey');
  });
});
