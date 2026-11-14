'use client';

import * as React from 'react';
import { useApiClient } from '../../../app/providers';
import { AuditEventTable, type AuditRow } from '../../../components/audit/AuditEventTable';

export default function AuditPage() {
  const api = useApiClient();
  const [items, setItems] = React.useState<AuditRow[]>([]);
  const [chainOk, setChainOk] = React.useState<boolean | null>(null);
  const [action, setAction] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);

  const load = React.useCallback(async () => {
    setError(null);
    try {
      const res = await api.auditEvents(action ? `?action=${encodeURIComponent(action)}` : '');
      setItems(res.items as AuditRow[]);
      setChainOk(res.chain.ok);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [api, action]);

  React.useEffect(() => {
    void load();
  }, [load]);

  return React.createElement(
    'section',
    null,
    React.createElement('h2', null, 'Audit'),
    React.createElement(
      'div',
      { className: 'ops-card' },
      React.createElement('label', { htmlFor: 'action' }, 'Filter by action'),
      React.createElement('input', {
        id: 'action',
        value: action,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setAction(e.target.value),
        style: { width: '100%', marginBottom: 8 },
      }),
      React.createElement('button', { onClick: () => void load() }, 'Search'),
      error ? React.createElement('p', { role: 'alert', className: 'ops-danger' }, error) : null,
      React.createElement(AuditEventTable, { items, chainOk }),
    ),
  );
}
