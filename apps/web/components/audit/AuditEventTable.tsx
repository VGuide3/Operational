'use client';

import * as React from 'react';

export interface AuditRow {
  eventId: string;
  action: string;
  actorId: string | null;
  resourceType: string;
  occurredAt: string;
  eventHash: string;
}

/** Append-only audit table with a hash-chain integrity banner. */
export function AuditEventTable({ items, chainOk }: { items: AuditRow[]; chainOk: boolean | null }) {
  return React.createElement(
    React.Fragment,
    null,
    chainOk !== null
      ? React.createElement(
          'p',
          { className: chainOk ? 'ops-ok' : 'ops-danger' },
          chainOk ? 'Hash chain intact' : 'AUDIT CHAIN DISCONTINUITY',
        )
      : null,
    React.createElement(
      'table',
      null,
      React.createElement(
        'thead',
        null,
        React.createElement(
          'tr',
          null,
          React.createElement('th', null, 'When'),
          React.createElement('th', null, 'Action'),
          React.createElement('th', null, 'Actor'),
          React.createElement('th', null, 'Resource'),
          React.createElement('th', null, 'Event hash'),
        ),
      ),
      React.createElement(
        'tbody',
        null,
        items.length === 0
          ? React.createElement('tr', null, React.createElement('td', { colSpan: 5 }, 'No events.'))
          : items.map((e) =>
              React.createElement(
                'tr',
                { key: e.eventId },
                React.createElement('td', null, e.occurredAt),
                React.createElement('td', null, e.action),
                React.createElement('td', null, e.actorId ?? '—'),
                React.createElement('td', null, e.resourceType),
                React.createElement('td', null, `${e.eventHash.slice(0, 12)}…`),
              ),
            ),
      ),
    ),
  );
}
