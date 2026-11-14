/**
 * Strict postMessage protocol for the embed runtime.
 *
 * The embed accepts messages only from an allowlisted origin and only for a
 * fixed set of actions. It never exposes generic `eth_sendTransaction`, wallet
 * state, or backend credentials to the host page.
 */

export const EMBED_VERSION = '1.0.0';

export const ALLOWED_ACTIONS = [
  'open_portfolio',
  'open_allowances',
  'open_strategy',
  'open_approval',
  'get_view',
  'disconnect',
  'set_theme',
] as const;
export type EmbedAction = (typeof ALLOWED_ACTIONS)[number];

/** JSON-RPC methods the embed may forward through its scoped bridge. */
export const RPC_ALLOWLIST = [
  'eth_chainId',
  'eth_blockNumber',
  'eth_getBalance',
  'eth_call',
  'eth_estimateGas',
  'eth_getCode',
] as const;

export interface EmbedRequest {
  type: 'ops:request';
  requestId: string;
  action: EmbedAction;
  payload?: Record<string, unknown>;
}

export interface EmbedResponse {
  type: 'ops:response';
  requestId: string;
  ok: boolean;
  data?: Record<string, unknown>;
  error?: { code: string; message: string };
}

export interface EmbedEvent {
  type: 'ops:event';
  event: string;
  data?: Record<string, unknown>;
}

export type EmbedMessage = EmbedRequest | EmbedResponse | EmbedEvent;

export interface OriginPolicy {
  /** Origins permitted to message this embed instance. */
  allowedOrigins: string[];
}

export function isAllowedOrigin(origin: string, policy: OriginPolicy): boolean {
  return policy.allowedOrigins.some((allowed) => {
    if (allowed === '*') return false; // wildcard never trusted
    if (allowed === origin) return true;
    // Allow subdomains of a registrable allowlist entry.
    try {
      const a = new URL(allowed);
      const o = new URL(origin);
      return o.protocol === a.protocol && (o.hostname === a.hostname || o.hostname.endsWith(`.${a.hostname}`));
    } catch {
      return false;
    }
  });
}

export function parseMessage(data: unknown): EmbedMessage | null {
  if (typeof data !== 'string') return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(data);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object') return null;
  const type = (parsed as { type?: unknown }).type;
  if (type !== 'ops:request' && type !== 'ops:response' && type !== 'ops:event') return null;
  if (type === 'ops:request') {
    const req = parsed as Partial<EmbedRequest>;
    if (typeof req.requestId !== 'string' || typeof req.action !== 'string') return null;
    if (!ALLOWED_ACTIONS.includes(req.action as EmbedAction)) return null;
    return { type: 'ops:request', requestId: req.requestId, action: req.action as EmbedAction, payload: req.payload };
  }
  return parsed as EmbedMessage;
}

export function isRpcAllowed(method: string): boolean {
  return (RPC_ALLOWLIST as readonly string[]).includes(method);
}

/** Validate an API key shape. Live keys are pk_live_, test keys pk_test_. */
export function isValidApiKey(key: string | undefined): boolean {
  return typeof key === 'string' && /^pk_(live|test)_[A-Za-z0-9]{8,}$/.test(key);
}

export function makeResponse(requestId: string, data: Record<string, unknown>): EmbedResponse {
  return { type: 'ops:response', requestId, ok: true, data };
}

export function makeError(requestId: string, code: string, message: string): EmbedResponse {
  return { type: 'ops:response', requestId, ok: false, error: { code, message } };
}
