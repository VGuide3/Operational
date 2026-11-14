'use client';

import * as React from 'react';
import { useApiClient } from '../../../app/providers';
import type { Delegation } from '../../../lib/types';

export default function DelegationsPage() {
  const api = useApiClient();
  const [rows, setRows] = React.useState<Delegation[]>([]);
  const [form, setForm] = React.useState(
    JSON.stringify(
      {
        grantor: '0x1111111111111111111111111111111111111111',
        delegate: '0x2222222222222222222222222222222222222222',
        chainId: 1,
        scope: { tokens: ['0x0000000000000000000000000000000000000002'], maxPerTx: '1000000', maxDailyUsd: '50000' },
        validFrom: new Date().toISOString(),
        validUntil: new Date(Date.now() + 7 * 86400_000).toISOString(),
      },
      null,
      2,
    ),
  );
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    try {
      const res = await api.listDelegations();
      setRows(res.items);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api]);

  React.useEffect(() => {
    void load();
  }, [load]);

  const create = async () => {
    setError(null);
    try {
      await api.createDelegation(JSON.parse(form));
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const revoke = async (id: string) => {
    try {
      await api.revokeDelegation(id);
      await load();
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return React.createElement(
    'section',
    null,
    React.createElement('h2', null, 'Delegations'),
    React.createElement(
      'div',
      { className: 'ops-card' },
      React.createElement('label', { htmlFor: 'delegation' }, 'Delegation proposal (JSON)'),
      React.createElement('textarea', {
        id: 'delegation',
        value: form,
        rows: 12,
        style: { width: '100%' },
        onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setForm(e.target.value),
      }),
      React.createElement(
        'div',
        { style: { marginTop: 8 } },
        React.createElement('button', { className: 'ops-primary', onClick: () => void create() }, 'Propose delegation'),
      ),
      error ? React.createElement('p', { role: 'alert', className: 'ops-danger' }, error) : null,
    ),
    React.createElement(
      'div',
      { className: 'ops-card' },
      React.createElement(
        'table',
        null,
        React.createElement(
          'thead',
          null,
          React.createElement(
            'tr',
            null,
            React.createElement('th', null, 'Delegate'),
            React.createElement('th', null, 'Chain'),
            React.createElement('th', null, 'Status'),
            React.createElement('th', null, 'Valid until'),
            React.createElement('th', null, 'Daily spend / limit'),
            React.createElement('th', null, ''),
          ),
        ),
        React.createElement(
          'tbody',
          null,
          rows.length === 0
            ? React.createElement('tr', null, React.createElement('td', { colSpan: 6 }, 'No delegations.'))
            : rows.map((d) =>
                React.createElement(
                  'tr',
                  { key: d.delegationId },
                  React.createElement('td', null, d.delegate),
                  React.createElement('td', null, d.chainId),
                  React.createElement('td', null, React.createElement('span', { className: 'ops-badge' }, d.status)),
                  React.createElement('td', null, d.validUntil),
                  React.createElement('td', null, `${d.dailySpentUsd}/${d.scope.maxDailyUsd}`),
                  React.createElement(
                    'td',
                    null,
                    d.status !== 'revoked'
                      ? React.createElement('button', { onClick: () => void revoke(d.delegationId) }, 'Revoke')
                      : null,
                  ),
                ),
              ),
        ),
      ),
    ),
  );
}
