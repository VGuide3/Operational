import { createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

/**
 * Telegram approval service.
 *
 * Telegram is an out-of-band approval channel for backend jobs that exceed
 * automated policy limits. Webhook callbacks are authenticated with Telegram's
 * secret-token header, bound to single-use short-lived tokens, and validated
 * against job state before any decision is recorded.
 */

export const TelegramCallbackQuery = z.object({
  id: z.string(),
  from: z.object({
    id: z.number(),
    username: z.string().optional(),
    first_name: z.string().optional(),
  }),
  data: z.string(),
  message: z
    .object({
      message_id: z.number(),
      chat: z.object({ id: z.number() }),
    })
    .optional(),
});
export type TelegramCallbackQuery = z.infer<typeof TelegramCallbackQuery>;

export const TelegramUpdate = z.object({
  update_id: z.number(),
  callback_query: TelegramCallbackQuery.optional(),
});
export type TelegramUpdate = z.infer<typeof TelegramUpdate>;

/** Verify the secret token Telegram sends in the X-Telegram-Bot-Api-Secret-Token header. */
export function verifyWebhookSecret(headerValue: string | undefined, expected: string): boolean {
  if (!headerValue || !expected) return false;
  const a = Buffer.from(headerValue);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * HMAC-based signature over the raw webhook body. Some Telegram deployments
 * front the webhook with a gateway that signs bodies; we support both.
 */
export function verifyBodySignature(rawBody: string, signature: string, secret: string): boolean {
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** Approval button callbacks embed a single-use, short-lived token. */
export const ApprovalCallbackData = z.object({
  jobId: z.string(),
  decision: z.enum(['approve', 'reject', 'changes', 'details']),
  token: z.string().min(8),
});
export type ApprovalCallbackData = z.infer<typeof ApprovalCallbackData>;

export function encodeCallbackData(data: ApprovalCallbackData): string {
  return JSON.stringify(data);
}

export function decodeCallbackData(raw: string): ApprovalCallbackData {
  return ApprovalCallbackData.parse(JSON.parse(raw));
}

/** Telegram message size limits; we keep messages well under 4096 chars. */
export const MAX_MESSAGE_LENGTH = 3500;

export interface ApprovalMessageInput {
  jobId: string;
  runId: string;
  strategyName: string;
  chainId: number;
  actor: string;
  /** Decoded, human-readable actions. */
  actions: string[];
  /** USD exposure, decimal string. */
  usdExposure: string;
  simulationSummary: string;
  expiresAt: string;
  jobHash: string;
}

/**
 * Render the structured approval message. Never includes raw private keys,
 * full calldata, or secrets.
 */
export function renderApprovalMessage(input: ApprovalMessageInput): string {
  const lines = [
    '🔐 Approval required',
    `Job: ${input.jobId}`,
    `Run: ${input.runId}`,
    `Strategy: ${input.strategyName}`,
    `Chain: ${input.chainId}`,
    `Actor: ${input.actor}`,
    `USD exposure: $${input.usdExposure}`,
    `Simulation: ${input.simulationSummary}`,
    `Job hash: ${input.jobHash.slice(0, 18)}…`,
    `Expires: ${input.expiresAt}`,
    '',
    'Actions:',
    ...input.actions.map((a, i) => `  ${i + 1}. ${a}`),
  ];
  let text = lines.join('\n');
  if (text.length > MAX_MESSAGE_LENGTH) text = text.slice(0, MAX_MESSAGE_LENGTH - 1) + '…';
  return text;
}
