'use client';

import * as React from 'react';
import { useApiClient } from '../../../app/providers';
import { ContractTable, type ContractRow } from '../../../components/contracts/ContractTable';

export default function ContractsPage() {
  const api = useApiClient();
  const [manifest, setManifest] = React.useState('');
  const [items, setItems] = React.useState<ContractRow[]>([]);
  const [result, setResult] = React.useState<{ manifestId: string; status: string } | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Array<{ path: string; message: string }>>([]);

  const load = React.useCallback(async () => {
    const page = await api.listContracts();
    setItems(page.items);
  }, [api]);

  React.useEffect(() => {
    void load().catch(() => undefined);
  }, [load]);

  const submit = React.useCallback(async () => {
    setError(null);
    setFieldErrors([]);
    try {
      const parsed = JSON.parse(manifest);
      const res = await api.importContracts({ manifest: parsed, acknowledgeUnverified: false });
      setResult(res);
      await load();
    } catch (e) {
      const err = e as { error?: { details?: Array<{ path: string; message: string }>; message?: string }; message?: string };
      setError(err.error?.message ?? err.message ?? 'import failed');
      setFieldErrors(err.error?.details ?? []);
    }
  }, [api, manifest, load]);

  const approve = React.useCallback(
    async (id: string) => {
      try {
        await api.post(`contracts/${id}/approve`);
        await load();
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [api, load],
  );

  return React.createElement(
    'section',
    null,
    React.createElement('h2', null, 'Contracts'),
    React.createElement(
      'div',
      { className: 'ops-card' },
      React.createElement('label', { htmlFor: 'manifest' }, 'Contract manifest (JSON)'),
      React.createElement('textarea', {
        id: 'manifest',
        value: manifest,
        rows: 10,
        style: { width: '100%' },
        onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setManifest(e.target.value),
      }),
      React.createElement(
        'div',
        { style: { marginTop: 8 } },
        React.createElement('button', { className: 'ops-primary', onClick: () => void submit() }, 'Validate & import'),
      ),
      error ? React.createElement('p', { role: 'alert', className: 'ops-danger' }, error) : null,
      fieldErrors.length > 0
        ? React.createElement(
            'ul',
            { className: 'ops-danger' },
            fieldErrors.map((f) => React.createElement('li', { key: `${f.path}:${f.message}` }, `${f.path}: ${f.message}`)),
          )
        : null,
      result
        ? React.createElement('p', { className: 'ops-ok' }, `Staged manifest ${result.manifestId} (${result.status})`)
        : null,
    ),
    React.createElement(
      'div',
      { className: 'ops-card' },
      React.createElement('h3', null, 'Imported contracts'),
      React.createElement(ContractTable, { items, onApprove: (id) => void approve(id) }),
    ),
  );
}
