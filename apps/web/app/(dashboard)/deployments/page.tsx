'use client';

import * as React from 'react';
import { useApiClient } from '../../../app/providers';

interface DeploymentResult {
  predictedAddress: string;
  artifactHash: string;
  status?: string;
}

export default function DeploymentsPage() {
  const api = useApiClient();
  const [form, setForm] = React.useState(
    JSON.stringify(
      {
        chainId: 1,
        factory: '0x00000000000000000000000000000000000000f0',
        salt: '0x' + '00'.repeat(32),
        initCode: '0x6000',
        constructorArgs: [],
      },
      null,
      2,
    ),
  );
  const [result, setResult] = React.useState<DeploymentResult | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [fieldErrors, setFieldErrors] = React.useState<Array<{ path: string; message: string }>>([]);

  const submit = async () => {
    setError(null);
    setFieldErrors([]);
    try {
      const res = await api.create2(JSON.parse(form));
      setResult(res);
    } catch (e) {
      const err = e as { error?: { message?: string; details?: Array<{ path: string; message: string }> }; message?: string };
      setError(err.error?.message ?? err.message ?? 'deployment request failed');
      setFieldErrors(err.error?.details ?? []);
    }
  };

  return React.createElement(
    'section',
    null,
    React.createElement('h2', null, 'CREATE2 Deployments'),
    React.createElement(
      'div',
      { className: 'ops-card' },
      React.createElement('label', { htmlFor: 'deploy' }, 'Deployment inputs (JSON)'),
      React.createElement('textarea', {
        id: 'deploy',
        value: form,
        rows: 12,
        style: { width: '100%' },
        onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setForm(e.target.value),
      }),
      React.createElement(
        'div',
        { style: { marginTop: 8 } },
        React.createElement('button', { className: 'ops-primary', onClick: () => void submit() }, 'Compute & request deployment'),
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
        ? React.createElement(
            'div',
            null,
            React.createElement('p', null, 'Predicted address (reproducible):'),
            React.createElement('code', { 'data-testid': 'predicted-address' }, result.predictedAddress),
            React.createElement('p', { className: 'ops-fresh' }, `Artifact hash: ${result.artifactHash}`),
            React.createElement('p', null, 'Status: ', React.createElement('span', { className: 'ops-badge' }, result.status ?? 'pending')),
          )
        : null,
    ),
  );
}
