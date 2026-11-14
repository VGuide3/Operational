'use client';

import * as React from 'react';

import type { BalanceReading } from '../../lib/types';

export type { BalanceReading };

/** Balance table with source attribution and a freshness indicator. */
export function BalanceTable({ readings }: { readings: BalanceReading[] }) {
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
        React.createElement('th', null, 'Balance'),
        React.createElement('th', null, 'Source'),
        React.createElement('th', null, 'Freshness'),
      ),
    ),
    React.createElement(
      'tbody',
      null,
      readings.length === 0
        ? React.createElement('tr', null, React.createElement('td', { colSpan: 4 }, 'No data yet. Connect a wallet and scan.'))
        : readings.map((r) =>
            React.createElement(
              'tr',
              { key: r.token },
              React.createElement('td', null, r.symbol ?? r.token),
              React.createElement('td', null, r.indexed ? r.balance : 'not indexed'),
              React.createElement('td', null, React.createElement('span', { className: 'ops-badge' }, r.source)),
              React.createElement(
                'td',
                null,
                React.createElement('span', { className: r.stale ? 'ops-danger' : 'ops-ok' }, r.stale ? 'stale' : 'fresh'),
              ),
            ),
          ),
    ),
  );
}
