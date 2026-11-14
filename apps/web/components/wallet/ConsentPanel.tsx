'use client';

import * as React from 'react';
import { ALL_SCOPES, type ConsentScope } from '@ops/ui';
import { useConsent } from '../../hooks/use-consent';

const SCOPE_LABELS: Record<ConsentScope, string> = {
  'wallet:connect': 'Connect your wallet',
  'balance:read': 'Read token and native balances',
  'allowance:read': 'Read token allowances',
  'strategy:propose': 'Propose strategies for review',
  'signature:request': 'Request EIP-712 signatures',
  'transaction:submit': 'Submit transactions you approve',
};

/**
 * Consent disclosure and grant control.
 *
 * The panel lists every requested scope in plain language and binds the record
 * to the current wallet, chain, and origin before privileged operations unlock.
 */
export function ConsentPanel({ chainId }: { chainId: number }) {
  const { consent, grant, revoke, busy, error } = useConsent();
  const [scopes, setScopes] = React.useState<ConsentScope[]>(ALL_SCOPES);

  const toggle = (scope: ConsentScope) => {
    setScopes((prev) => (prev.includes(scope) ? prev.filter((s) => s !== scope) : [...prev, scope]));
  };

  if (consent) {
    return React.createElement(
      'div',
      { className: 'ops-card' },
      React.createElement('p', { className: 'ops-ok' }, `Consent active (${consent.consentId})`),
      React.createElement(
        'button',
        { onClick: () => void revoke(consent.consentId), disabled: busy },
        'Revoke consent',
      ),
    );
  }

  return React.createElement(
    'div',
    { className: 'ops-card' },
    React.createElement('h3', null, 'Consent'),
    React.createElement('p', null, `Requested by https://ops.example.com for chain ${chainId}.`),
    React.createElement(
      'ul',
      { className: 'ops-scope-list' },
      ALL_SCOPES.map((scope) =>
        React.createElement(
          'li',
          { key: scope },
          React.createElement('label', null,
            React.createElement('input', {
              type: 'checkbox',
              checked: scopes.includes(scope),
              onChange: () => toggle(scope),
            }),
            ` ${SCOPE_LABELS[scope]}`,
          ),
        ),
      ),
    ),
    React.createElement(
      'button',
      {
        className: 'ops-primary',
        disabled: busy || scopes.length === 0,
        onClick: () => void grant({ chainId, termsHash: '0x' + 'ab'.repeat(32), scopes }),
      },
      'Approve consent',
    ),
    error ? React.createElement('p', { role: 'alert', className: 'ops-danger' }, error) : null,
  );
}
