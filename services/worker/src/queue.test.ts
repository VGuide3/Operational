import { describe, expect, it } from 'vitest';
import { AppError } from '@ops/core';
import { ApprovalService } from '@ops/approvals';
import { JobWorker } from './queue.js';

describe('job worker', () => {
  it('executes an unapproved job directly', async () => {
    const worker = new JobWorker({
      handlers: { scanner_refresh: async () => ({ refreshed: true }) },
    });
    const job = worker.enqueue({ runId: 'run_1', type: 'scanner_refresh', payload: {}, idempotencyKey: 'k1' });
    const done = await worker.run(job.id);
    expect(done.status).toBe('completed');
    expect(done.result).toEqual({ refreshed: true });
  });

  it('refuses to execute a job that needs approval without one', async () => {
    const approvals = new ApprovalService();
    const worker = new JobWorker({
      approvals,
      handlers: { multicall_execute: async () => ({}) },
    });
    const job = worker.enqueue({
      runId: 'run_1',
      type: 'multicall_execute',
      payload: {},
      requiresTelegramApproval: true,
      approvalJobId: 'job_missing',
      idempotencyKey: 'k2',
    });
    await expect(worker.run(job.id)).rejects.toThrow(AppError);
  });

  it('executes once approval quorum is satisfied', async () => {
    const approvals = new ApprovalService();
    const approvalJob = approvals.createJob({
      runId: 'run_1',
      jobHash: '0x1',
      requestedBy: 'usr_req',
      eligibleApprovers: ['usr_a'],
    });
    const token = approvals.issueToken(approvalJob.id, 'approve');
    approvals.recordDecision({
      jobId: approvalJob.id,
      token: token.token,
      decision: 'approve',
      approverId: 'usr_a',
      callbackId: 'c1',
    });

    const worker = new JobWorker({
      approvals,
      handlers: { multicall_execute: async () => ({ executed: true }) },
    });
    const job = worker.enqueue({
      runId: 'run_1',
      type: 'multicall_execute',
      payload: {},
      requiresTelegramApproval: true,
      approvalJobId: approvalJob.id,
      idempotencyKey: 'k3',
    });
    const done = await worker.run(job.id);
    expect(done.status).toBe('completed');
  });

  it('retries then dead-letters after exhausting attempts', async () => {
    let calls = 0;
    const worker = new JobWorker({
      maxAttempts: 2,
      backoffMs: [0],
      handlers: {
        scanner_refresh: async () => {
          calls++;
          throw new Error('boom');
        },
      },
    });
    const job = worker.enqueue({ runId: 'r', type: 'scanner_refresh', payload: {}, idempotencyKey: 'k4' });
    const first = await worker.run(job.id);
    expect(first.status).toBe('failed');
    const second = await worker.run(job.id);
    expect(second.status).toBe('dead_letter');
    expect(calls).toBe(2);
    expect(worker.listDeadLetters()).toHaveLength(1);
  });

  it('dead-letters when no handler is registered', async () => {
    const worker = new JobWorker({ handlers: {} });
    const job = worker.enqueue({ runId: 'r', type: 'notification_send', payload: {}, idempotencyKey: 'k5' });
    const done = await worker.run(job.id);
    expect(done.status).toBe('dead_letter');
  });

  it('is idempotent by idempotency key', () => {
    const worker = new JobWorker({ handlers: {} });
    const a = worker.enqueue({ runId: 'r', type: 'scanner_refresh', payload: {}, idempotencyKey: 'same' });
    const b = worker.enqueue({ runId: 'r', type: 'scanner_refresh', payload: {}, idempotencyKey: 'same' });
    expect(a.id).toBe(b.id);
  });
});
