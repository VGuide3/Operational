import { AppError, ErrorCodes } from '@ops/core';
import {
  ApprovalService,
  decodeCallbackData,
  TelegramUpdate,
  verifyBodySignature,
  verifyWebhookSecret,
  type Decision,
} from '@ops/approvals';
import { hashPii, type MetricsRegistry, type Logger } from '@ops/telemetry';

/**
 * Telegram webhook receiver.
 *
 * Hardening (README "Security requirements"):
 *  - validate Telegram's secret token and optional body signature
 *  - bind each button to a single-use, short-lived token
 *  - reject replayed callbacks
 *  - rate-limit and lock out approvers after repeated invalid callbacks
 *  - never log secrets; IP/UA are hashed
 */

export interface TelegramWebhookDeps {
  approvals: ApprovalService;
  /** Maps a Telegram user id to an internal approver id. */
  resolveApprover: (telegramUserId: number) => string | undefined;
  webhookSecret: string;
  bodySigningSecret?: string;
  logger?: Logger;
  metrics?: MetricsRegistry;
  /** Simple token-bucket rate limiter per source. */
  rateLimiter?: RateLimiter;
}

export interface WebhookRequest {
  headers: Record<string, string | undefined>;
  rawBody: string;
  ip?: string;
  userAgent?: string;
}

export interface WebhookResponse {
  status: number;
  body: { ok: boolean; error?: string; state?: string };
}

/** Fixed-window rate limiter. */
export class RateLimiter {
  private windows = new Map<string, { count: number; start: number }>();
  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    private readonly now: () => number = () => Date.now(),
  ) {}

  allow(key: string): boolean {
    const now = this.now();
    const window = this.windows.get(key);
    if (!window || now - window.start >= this.windowMs) {
      this.windows.set(key, { count: 1, start: now });
      return true;
    }
    if (window.count >= this.limit) return false;
    window.count += 1;
    return true;
  }
}

const DECISION_MAP: Record<string, Decision> = {
  approve: 'approve',
  reject: 'reject',
  changes: 'changes',
  details: 'details',
};

export class TelegramWebhookHandler {
  constructor(private readonly deps: TelegramWebhookDeps) {}

  async handle(req: WebhookRequest): Promise<WebhookResponse> {
    const { approvals, resolveApprover, webhookSecret, bodySigningSecret, logger, metrics, rateLimiter } = this.deps;

    const ipHash = hashPii(req.ip);
    const uaHash = hashPii(req.userAgent);

    // Rate limit by source before doing any work.
    if (rateLimiter && !rateLimiter.allow(ipHash ?? 'unknown')) {
      metrics?.counter('ops_telegram_ratelimited_total');
      return { status: 429, body: { ok: false, error: 'rate_limited' } };
    }

    // Validate Telegram's secret token.
    const secretHeader = req.headers['x-telegram-bot-api-secret-token'];
    if (!verifyWebhookSecret(secretHeader, webhookSecret)) {
      metrics?.counter('ops_telegram_invalid_secret_total');
      logger?.warn('telegram webhook: invalid secret token', { ipHash });
      return { status: 401, body: { ok: false, error: 'invalid_signature' } };
    }

    // Validate optional body signature.
    if (bodySigningSecret) {
      const sig = req.headers['x-telegram-body-signature'];
      if (!sig || !verifyBodySignature(req.rawBody, sig, bodySigningSecret)) {
        metrics?.counter('ops_telegram_invalid_body_signature_total');
        return { status: 401, body: { ok: false, error: 'invalid_signature' } };
      }
    }

    let update: ReturnType<typeof TelegramUpdate.parse>;
    try {
      update = TelegramUpdate.parse(JSON.parse(req.rawBody));
    } catch {
      return { status: 400, body: { ok: false, error: 'invalid_payload' } };
    }

    const callback = update.callback_query;
    if (!callback) {
      // Non-callback updates are acknowledged without action.
      return { status: 200, body: { ok: true } };
    }

    const approverId = resolveApprover(callback.from.id);
    if (!approverId) {
      metrics?.counter('ops_telegram_unknown_approver_total');
      logger?.warn('telegram webhook: unknown approver', { telegramUserId: callback.from.id });
      return { status: 403, body: { ok: false, error: 'unknown_approver' } };
    }

    let data: ReturnType<typeof decodeCallbackData>;
    try {
      data = decodeCallbackData(callback.data);
    } catch {
      return { status: 400, body: { ok: false, error: 'invalid_callback_data' } };
    }

    const decision = DECISION_MAP[data.decision];
    if (!decision) return { status: 400, body: { ok: false, error: 'invalid_decision' } };

    try {
      const job = approvals.recordDecision({
        jobId: data.jobId,
        token: data.token,
        decision,
        approverId,
        callbackId: callback.id,
        ...(ipHash ? { ipHash } : {}),
        ...(uaHash ? { userAgentHash: uaHash } : {}),
      });
      metrics?.counter('ops_telegram_decision_total', { decision });
      logger?.info('telegram approval decision', { jobId: job.id, approverId, decision, state: job.state });
      return { status: 200, body: { ok: true, state: job.state } };
    } catch (e) {
      if (e instanceof AppError) {
        metrics?.counter('ops_telegram_decision_error_total', { code: e.code });
        if (e.code === ErrorCodes.APPROVAL_REPLAYED) metrics?.counter('ops_approval_replay_total');
        return { status: e.httpStatus, body: { ok: false, error: e.code } };
      }
      logger?.error('telegram webhook: unexpected error', { message: (e as Error).message });
      return { status: 500, body: { ok: false, error: 'internal_error' } };
    }
  }
}
