'use client';

import * as React from 'react';

import type { Intent } from '../../lib/types';

export type { Intent };

/**
 * Human-readable decoded intent preview.
 *
 * The UI renders recipient, amount, chain, and decoded calldata before any
 * signature or backend execution. Privileged actions are never signed as
 * opaque blobs.
 */
export function IntentPreview({
  intents,
  intentHash,
}: {
  intents: Intent[];
  intentHash?: string | null;
}) {
  return React.createElement(
    'div',
    { className: 'ops-card' },
    React.createElement('h3', null, 'Decoded intents'),
    intentHash ? React.createElement('p', { className: 'ops-fresh' }, `Intent hash: ${intentHash}`) : null,
    intents.length === 0
      ? React.createElement('p', null, 'Compile to see decoded calls.')
      : intents.map((intent) =>
          React.createElement(
            'div',
            { key: intent.stepId },
            React.createElement('strong', null, intent.stepId),
            React.createElement(
              'ul',
              null,
              intent.calls.map((call, i) =>
                React.createElement('li', { key: i }, `${call.to} · value ${call.value} · ${call.data.slice(0, 18)}…`),
              ),
            ),
          ),
        ),
  );
}
