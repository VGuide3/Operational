import * as React from 'react';
import type { ModalContext, ModalEvent, ModalState } from './wallet-machine.js';
import { transition } from './wallet-machine.js';
import type { ConsentScope } from './consent.js';

/**
 * Canonical wallet-connect / consent modal.
 *
 * A single component used by both the dashboard and the embed runtime. It is
 * presentational + state-machine driven so it can render inside the Next.js app
 * or inside the embed's shadow DOM without behavioural drift.
 */

export interface WalletOption {
  id: string;
  name: string;
  installed: boolean;
  /** Deep link for mobile wallets. */
  deepLink?: string;
  /** QR payload for mobile wallets. */
  qrUri?: string;
}

export interface WalletConnectModalProps {
  context: ModalContext;
  /** Called on every event so the host can drive the state machine. */
  onEvent: (event: ModalEvent) => void;
  wallets: WalletOption[];
  /** Chain label resolved from the registry. */
  chainName?: string;
  /** Requesting origin, disclosed for embedded use. */
  requestingOrigin: string;
  /** Host app origin. */
  appOrigin: string;
  /** Consent scope labels for plain-language disclosure. */
  scopes?: ConsentScope[];
  termsUrl?: string;
  privacyUrl?: string;
  /** Optional ENS name for the connected address. */
  ens?: string;
}

const SCOPE_LABELS: Record<ConsentScope, string> = {
  'wallet:connect': 'Connect your wallet',
  'balance:read': 'Read token and native balances',
  'allowance:read': 'Read token allowances',
  'strategy:propose': 'Propose strategies for review',
  'signature:request': 'Request EIP-712 signatures',
  'transaction:submit': 'Submit transactions you approve',
};

function ChainBadge({ chainId, chainName }: { chainId?: number; chainName?: string }) {
  if (chainId === undefined) return null;
  return React.createElement(
    'span',
    { className: 'ops-badge', 'data-testid': 'chain-badge' },
    `${chainName ?? 'Chain'} (${chainId})`,
  );
}

/** Render the body for the current state. */
function renderBody(
  state: ModalState,
  props: WalletConnectModalProps,
): React.ReactNode {
  const { wallets, context, onEvent, requestingOrigin, appOrigin, scopes } = props;
  switch (state) {
    case 'idle':
      return null;
    case 'discovery':
      return React.createElement(
        'div',
        { className: 'ops-modal-body' },
        React.createElement('h2', { id: 'ops-modal-title' }, 'Connect a wallet'),
        React.createElement(
          'ul',
          { className: 'ops-wallet-list' },
          wallets.map((w) =>
            React.createElement(
              'li',
              { key: w.id },
              React.createElement(
                'button',
                {
                  type: 'button',
                  className: 'ops-wallet-option',
                  disabled: !w.installed,
                  onClick: () => onEvent({ type: 'SELECT_WALLET', walletId: w.id }),
                  'aria-label': `Connect ${w.name}`,
                },
                w.name,
                w.installed ? '' : ' (not installed)',
              ),
              w.qrUri
                ? React.createElement('img', {
                    className: 'ops-wallet-qr',
                    src: w.qrUri,
                    alt: `${w.name} QR code`,
                    width: 128,
                    height: 128,
                  })
                : null,
            ),
          ),
        ),
      );
    case 'connecting':
      return React.createElement(
        'div',
        { className: 'ops-modal-body' },
        React.createElement('h2', { id: 'ops-modal-title' }, 'Connecting…'),
        React.createElement('p', { role: 'status' }, 'Approve the connection in your wallet.'),
        React.createElement(
          'button',
          { type: 'button', onClick: () => onEvent({ type: 'TIMEOUT' }) },
          'Cancel',
        ),
      );
    case 'chain_switch':
      return React.createElement(
        'div',
        { className: 'ops-modal-body' },
        React.createElement('h2', { id: 'ops-modal-title' }, 'Switch network'),
        React.createElement('p', { role: 'status' }, 'Approve the network switch in your wallet.'),
      );
    case 'signature_request':
      return React.createElement(
        'div',
        { className: 'ops-modal-body' },
        React.createElement('h2', { id: 'ops-modal-title' }, 'Signature requested'),
        React.createElement('p', { role: 'status' }, 'Review the message in your wallet.'),
      );
    case 'rejected':
    case 'timeout':
    case 'unsupported_chain':
      return React.createElement(
        'div',
        { className: 'ops-modal-body' },
        React.createElement(
          'h2',
          { id: 'ops-modal-title' },
          state === 'rejected' ? 'Request rejected' : state === 'timeout' ? 'Connection timed out' : 'Unsupported chain',
        ),
        React.createElement('p', { role: 'alert' }, context.lastError ?? 'Please try again.'),
        React.createElement(
          'button',
          { type: 'button', onClick: () => onEvent({ type: 'RETRY' }) },
          'Try again',
        ),
        React.createElement(
          'button',
          { type: 'button', onClick: () => onEvent({ type: 'CLOSE' }) },
          'Close',
        ),
      );
    case 'consent':
      return React.createElement(
        'div',
        { className: 'ops-modal-body' },
        React.createElement('h2', { id: 'ops-modal-title' }, 'Review and consent'),
        React.createElement(
          'dl',
          { className: 'ops-consent-facts' },
          React.createElement('dt', null, 'Destination domain'),
          React.createElement('dd', null, appOrigin),
          React.createElement('dt', null, 'Requesting origin'),
          React.createElement('dd', { 'data-testid': 'requesting-origin' }, requestingOrigin),
          React.createElement('dt', null, 'Connected address'),
          React.createElement('dd', null, context.address ?? '—'),
          React.createElement('dt', null, 'Selected chain'),
          React.createElement('dd', null, String(context.chainId ?? '—')),
        ),
        React.createElement(
          'ul',
          { className: 'ops-scope-list' },
          (scopes ?? (Object.keys(SCOPE_LABELS) as ConsentScope[])).map((s) =>
            React.createElement('li', { key: s }, SCOPE_LABELS[s]),
          ),
        ),
        React.createElement(
          'p',
          { className: 'ops-privacy-notice' },
          'We never receive your private key or seed phrase. Signing happens in your wallet. ',
          props.termsUrl
            ? React.createElement('a', { href: props.termsUrl, target: '_blank', rel: 'noreferrer' }, 'Terms')
            : null,
          props.privacyUrl
            ? React.createElement('a', { href: props.privacyUrl, target: '_blank', rel: 'noreferrer' }, 'Privacy')
            : null,
        ),
        React.createElement(
          'div',
          { className: 'ops-modal-actions' },
          React.createElement(
            'button',
            { type: 'button', className: 'ops-primary', onClick: () => onEvent({ type: 'CONSENT_APPROVED' }) },
            'Approve',
          ),
          React.createElement(
            'button',
            { type: 'button', onClick: () => onEvent({ type: 'CONSENT_CANCELLED' }) },
            'Cancel',
          ),
        ),
      );
    case 'connected':
      return React.createElement(
        'div',
        { className: 'ops-modal-body' },
        React.createElement('h2', { id: 'ops-modal-title' }, 'Connected'),
        React.createElement(
          'p',
          null,
          props.ens ? `${props.ens} (${context.address})` : context.address,
        ),
        React.createElement(ChainBadge, { chainId: context.chainId, chainName: props.chainName }),
        React.createElement(
          'div',
          { className: 'ops-modal-actions' },
          React.createElement(
            'button',
            { type: 'button', onClick: () => onEvent({ type: 'ACCOUNT_CHANGED', address: context.address ?? '' }) },
            'Switch account',
          ),
          React.createElement(
            'button',
            { type: 'button', className: 'ops-danger', onClick: () => onEvent({ type: 'DISCONNECT' }) },
            'Disconnect',
          ),
        ),
      );
    default:
      return null;
  }
}

/**
 * Focus trap + Escape handling so the modal is keyboard-operable (WCAG 2.2 AA).
 */
function useModalA11y(open: boolean, onClose: () => void): React.RefObject<HTMLDivElement> {
  const ref = React.useRef<HTMLDivElement>(null);
  React.useEffect(() => {
    if (!open) return;
    const node = ref.current;
    if (!node) return;
    const focusable = () =>
      Array.from(
        node.querySelectorAll<HTMLElement>(
          'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
        ),
      ).filter((el) => !el.hasAttribute('disabled'));
    focusable()[0]?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
        return;
      }
      if (e.key !== 'Tab') return;
      const items = focusable();
      if (items.length === 0) return;
      const first = items[0]!;
      const last = items[items.length - 1]!;
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };
    node.addEventListener('keydown', onKeyDown);
    return () => node.removeEventListener('keydown', onKeyDown);
  }, [open, onClose]);
  return ref;
}

export function WalletConnectModal(props: WalletConnectModalProps): React.ReactElement | null {
  const { context, onEvent } = props;
  const open = context.state !== 'idle';
  const ref = useModalA11y(open, () => onEvent({ type: 'CLOSE' }));
  if (!open) return null;

  return React.createElement(
    'div',
    {
      className: 'ops-modal-overlay',
      role: 'presentation',
      onClick: (e: React.MouseEvent) => {
        if (e.target === e.currentTarget) onEvent({ type: 'CLOSE' });
      },
    },
    React.createElement(
      'div',
      {
        ref,
        className: 'ops-modal',
        role: 'dialog',
        'aria-modal': 'true',
        'aria-labelledby': 'ops-modal-title',
        tabIndex: -1,
      },
      renderBody(context.state, props),
    ),
  );
}

export { transition };
