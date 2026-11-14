'use client';

import * as React from 'react';

import type { AllowanceReading } from '../../lib/types';

export type { AllowanceReading };

/**
 * Allowance table. Unlimited approvals are clearly labeled and can be queued
 * for revocation with explicit confirmation.
 */
export function AllowanceTable({
  readings,
  onRevoke,
}: {
  readings: AllowanceReading[];
  onRevoke?: (reading: AllowanceReading) => void;
}) {
  return React.createElement(
    'table',
    null,
    React.createElement(
      'thead',
      null,
      React.createElement(
        'tr',
        null,
        React.createElement('th', null, 'Token'),
        React.createElement('th', null, 'Spender'),
        React.createElement('th', null, 'Allowance'),
        React.createElement('th', null, 'Risk'),
        React.createElement('th', null, ''),
      ),
    ),
    React.createElement(
      'tbody',
      null,
      readings.length === 0
        ? React.createElement('tr', null, React.createElement('td', { colSpan: 5 }, 'No allowances scanned.'))
        : readings.map((r) =>
            React.createElement(
              'tr',
              { key: `${r.token}:${r.spender}` },
              React.createElement('td', null, r.token),
              React.createElement('td', null, r.spender),
              React.createElement(
                'td',
                null,
                r.allowanceIsMax
                  ? React.createElement('span', { className: 'ops-danger' }, 'UNLIMITED')
                  : r.allowanceRaw,
              ),
              React.createElement(
                'td',
                null,
                r.spenderRisk
                  ? React.createElement(
                      'span',
                      { className: r.spenderRisk.verified && !r.spenderRisk.newlyCreated ? 'ops-ok' : 'ops-danger' },
                      `score ${r.spenderRisk.score}${r.spenderRisk.newlyCreated ? ' · new' : ''}`,
                    )
                  : '—',
              ),
              React.createElement(
                'td',
                null,
                onRevoke
                  ? React.createElement('button', { onClick: () => onRevoke(r) }, 'Queue revocation')
                  : null,
              ),
            ),
          ),
    ),
  );
}
