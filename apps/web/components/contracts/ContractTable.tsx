'use client';

import * as React from 'react';

import type { ContractRow } from '../../lib/types';

export type { ContractRow };

/** Imported-contract table with an approval control for staged manifests. */
export function ContractTable({
  items,
  onApprove,
}: {
  items: ContractRow[];
  onApprove?: (manifestId: string) => void;
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
        React.createElement('th', null, 'Name'),
        React.createElement('th', null, 'Chain'),
        React.createElement('th', null, 'Address'),
        React.createElement('th', null, 'Status'),
        React.createElement('th', null, ''),
      ),
    ),
    React.createElement(
      'tbody',
      null,
      items.length === 0
        ? React.createElement('tr', null, React.createElement('td', { colSpan: 5 }, 'No contracts imported.'))
        : items.map((c) =>
            React.createElement(
              'tr',
              { key: c.id ?? `${c.chainId}:${c.address}` },
              React.createElement('td', null, c.name),
              React.createElement('td', null, c.chainId),
              React.createElement('td', null, c.address),
              React.createElement('td', null, React.createElement('span', { className: 'ops-badge' }, c.status ?? 'active')),
              React.createElement(
                'td',
                null,
                c.manifestId && onApprove
                  ? React.createElement('button', { onClick: () => onApprove(c.manifestId!) }, 'Approve')
                  : null,
              ),
            ),
          ),
    ),
  );
}
