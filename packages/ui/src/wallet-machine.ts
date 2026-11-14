/**
 * Canonical wallet-connect / consent state machine.
 *
 * Both the dashboard and the script.js embed runtime render this same machine
 * through a single component, so consent semantics cannot diverge between the
 * two surfaces. States match the README "Required states".
 */

export type ModalState =
  | 'idle'
  | 'discovery'
  | 'connecting'
  | 'chain_switch'
  | 'signature_request'
  | 'rejected'
  | 'timeout'
  | 'unsupported_chain'
  | 'consent'
  | 'connected';

export type ModalEvent =
  | { type: 'OPEN' }
  | { type: 'SELECT_WALLET'; walletId: string }
  | { type: 'CONNECTED'; address: string; chainId: number }
  | { type: 'CHAIN_UNSUPPORTED' }
  | { type: 'REQUEST_SIGNATURE' }
  | { type: 'SIGNED' }
  | { type: 'REJECTED' }
  | { type: 'TIMEOUT' }
  | { type: 'SWITCH_CHAIN'; chainId: number }
  | { type: 'CONSENT_APPROVED' }
  | { type: 'CONSENT_CANCELLED' }
  | { type: 'DISCONNECT' }
  | { type: 'EXPIRED' }
  | { type: 'ACCOUNT_CHANGED'; address: string }
  | { type: 'RETRY' }
  | { type: 'CLOSE' };

export interface ModalContext {
  state: ModalState;
  selectedWallet?: string;
  address?: string;
  chainId?: number;
  /** Whether a persisted consent record exists for this context. */
  consentGranted: boolean;
  /** Reason the last failure occurred, for display. */
  lastError?: string;
  /** Whether the modal was opened by an embed (affects origin disclosure). */
  embedded: boolean;
}

export const initialModalContext: ModalContext = {
  state: 'idle',
  consentGranted: false,
  embedded: false,
};

export interface TransitionResult {
  context: ModalContext;
  /** Audit action to emit, if any. */
  audit?: string;
  /** Whether the caller should clear any authenticated session. */
  clearSession?: boolean;
}

/**
 * Pure transition function. Rejecting connection or consent leaves no
 * authenticated session and emits an audit event.
 */
export function transition(ctx: ModalContext, event: ModalEvent): TransitionResult {
  switch (event.type) {
    case 'OPEN':
      return { context: { ...ctx, state: 'discovery', lastError: undefined } };
    case 'SELECT_WALLET':
      return { context: { ...ctx, state: 'connecting', selectedWallet: event.walletId } };
    case 'CONNECTED':
      if (ctx.consentGranted) {
        return {
          context: { ...ctx, state: 'connected', address: event.address, chainId: event.chainId },
          audit: 'wallet.connect',
        };
      }
      return {
        context: { ...ctx, state: 'consent', address: event.address, chainId: event.chainId },
        audit: 'wallet.connect',
      };
    case 'CHAIN_UNSUPPORTED':
      return { context: { ...ctx, state: 'unsupported_chain', lastError: 'unsupported chain' } };
    case 'REQUEST_SIGNATURE':
      return { context: { ...ctx, state: 'signature_request' } };
    case 'SIGNED':
      return { context: { ...ctx, state: 'connected' } };
    case 'REJECTED':
      return {
        context: { ...ctx, state: 'rejected', lastError: 'user rejected the request', consentGranted: false },
        audit: 'auth.failure',
        clearSession: true,
      };
    case 'TIMEOUT':
      return {
        context: { ...ctx, state: 'timeout', lastError: 'connection timed out', consentGranted: false },
        clearSession: true,
      };
    case 'SWITCH_CHAIN':
      return { context: { ...ctx, state: 'chain_switch', chainId: event.chainId }, audit: 'wallet.chain_switch' };
    case 'CONSENT_APPROVED':
      return {
        context: { ...ctx, state: 'connected', consentGranted: true, lastError: undefined },
        audit: 'consent.grant',
      };
    case 'CONSENT_CANCELLED':
      return {
        context: { ...ctx, state: 'discovery', consentGranted: false },
        audit: 'consent.revoke',
        clearSession: true,
      };
    case 'DISCONNECT':
      return {
        context: { ...initialModalContext, embedded: ctx.embedded },
        audit: 'wallet.disconnect',
        clearSession: true,
      };
    case 'EXPIRED':
      return {
        context: { ...ctx, state: 'consent', consentGranted: false, lastError: 'session expired' },
        audit: 'consent.expired',
        clearSession: true,
      };
    case 'ACCOUNT_CHANGED':
      // Changing the wallet address invalidates prior consent.
      return {
        context: { ...ctx, state: 'consent', address: event.address, consentGranted: false },
        audit: 'consent.invalidated',
      };
    case 'RETRY':
      return { context: { ...ctx, state: 'connecting', lastError: undefined } };
    case 'CLOSE':
      return { context: { ...ctx, state: 'idle' } };
    default:
      return { context: ctx };
  }
}

/** Scopes that a given modal state is allowed to exercise. */
export function scopesForState(state: ModalState): string[] {
  switch (state) {
    case 'connected':
      return ['wallet:connect', 'balance:read', 'allowance:read', 'strategy:propose', 'signature:request', 'transaction:submit'];
    case 'consent':
      return ['wallet:connect'];
    default:
      return [];
  }
}
