import { describe, expect, it } from 'vitest';
import { createHmac } from 'node:crypto';
import { ApprovalService } from '@ops/approvals';
import { MetricsRegistry } from '@ops/telemetry';
import { RateLimiter, TelegramWebhookHandler } from './webhook.js';

const SECRET = 'webhook-secret';

function setup() {
  const approvals = new ApprovalService();
  const job = approvals.createJob({
    runId: 'run_1',
    jobHash: '0xabc',
    requestedBy: 'usr_requester',
    eligibleApprovers: ['usr_a'],
  });
  const metrics = new MetricsRegistry();
  const handler = new TelegramWebhookHandler({
    approvals,
    resolveApprover: (id) => (id === 42 ? 'usr_a' : undefined),
    webhookSecret: SECRET,
    metrics,
    rateLimiter: new RateLimiter(100, 60_000),
  });
  return { approvals, job, handler, metrics };
}

function updateBody(jobId: string, token: string, decision: string, callbackId = 'cb_1') {
  return JSON.stringify({
    update_id: 1,
    callback_query: {
      id: callbackId,
      from: { id: 42, username: 'alice' },
      data: JSON.stringify({ jobId, decision, token }),
      message: { message_id: 1, chat: { id: -100 } },
    },
  });
}

function req(body: string, headers: Record<string, string> = {}): {
  rawBody: string;
  headers: Record<string, string | undefined>;
} {
  return { rawBody: body, headers: { 'x-telegram-bot-api-secret-token': SECRET, ...headers } };
}

describe('telegram webhook', () => {
  it('rejects an invalid secret token', async () => {
    const { handler } = setup();
    const res = await handler.handle({ rawBody: '{}', headers: { 'x-telegram-bot-api-secret-token': 'wrong' } });
    expect(res.status).toBe(401);
  });

  it('records an approval decision', async () => {
    const { handler, job, approvals } = setup();
    const token = approvals.issueToken(job.id, 'approve');
    const res = await handler.handle(req(updateBody(job.id, token.token, 'approve')));
    expect(res.status).toBe(200);
    expect(res.body.state).toBe('queued');
  });

  it('rejects a replayed callback', async () => {
    const { handler, job, approvals } = setup();
    const token = approvals.issueToken(job.id, 'approve');
    const body = updateBody(job.id, token.token, 'approve');
    await handler.handle(req(body));
    const replay = await handler.handle(req(body));
    expect(replay.status).toBe(409);
    expect(replay.body.error).toBe('approval_replayed');
  });

  it('rejects an unknown approver', async () => {
    const { handler, job, approvals } = setup();
    const token = approvals.issueToken(job.id, 'approve');
    const body = JSON.stringify({
      update_id: 2,
      callback_query: {
        id: 'cb_x',
        from: { id: 999 },
        data: JSON.stringify({ jobId: job.id, decision: 'approve', token: token.token }),
      },
    });
    const res = await handler.handle(req(body));
    expect(res.status).toBe(403);
  });

  it('verifies body signatures when configured', async () => {
    const approvals = new ApprovalService();
    const handler = new TelegramWebhookHandler({
      approvals,
      resolveApprover: () => 'usr_a',
      webhookSecret: SECRET,
      bodySigningSecret: 'body-key',
    });
    const body = JSON.stringify({ update_id: 5 });
    const sig = createHmac('sha256', 'body-key').update(body).digest('hex');
    const ok = await handler.handle({
      rawBody: body,
      headers: { 'x-telegram-bot-api-secret-token': SECRET, 'x-telegram-body-signature': sig },
    });
    expect(ok.status).toBe(200);
    const bad = await handler.handle({
      rawBody: body,
      headers: { 'x-telegram-bot-api-secret-token': SECRET, 'x-telegram-body-signature': 'nope' },
    });
    expect(bad.status).toBe(401);
  });

  it('rate-limits flooding sources', async () => {
    const approvals = new ApprovalService();
    const handler = new TelegramWebhookHandler({
      approvals,
      resolveApprover: () => 'usr_a',
      webhookSecret: SECRET,
      rateLimiter: new RateLimiter(2, 60_000),
    });
    const r = () => ({
      rawBody: JSON.stringify({ update_id: 9 }),
      headers: { 'x-telegram-bot-api-secret-token': SECRET },
      ip: '1.2.3.4',
    });
    expect((await handler.handle(r())).status).toBe(200);
    expect((await handler.handle(r())).status).toBe(200);
    expect((await handler.handle(r())).status).toBe(429);
  });
});
