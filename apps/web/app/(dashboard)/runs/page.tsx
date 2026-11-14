'use client';

import * as React from 'react';
import { useApiClient } from '../../../app/providers';

export default function RunsPage() {
  const api = useApiClient();
  const [runId, setRunId] = React.useState('');
  const [run, setRun] = React.useState<Record<string, unknown> | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const load = async () => {
    setError(null);
    try {
      setRun(await api.get<Record<string, unknown>>(`runs/${runId}`));
    } catch (e) {
      setError((e as Error).message);
      setRun(null);
    }
  };

  return React.createElement(
    'section',
    null,
    React.createElement('h2', null, 'Runs'),
    React.createElement(
      'div',
      { className: 'ops-card' },
      React.createElement('label', { htmlFor: 'runId' }, 'Run ID'),
      React.createElement('input', {
        id: 'runId',
        value: runId,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setRunId(e.target.value),
        style: { width: '100%', marginBottom: 8 },
      }),
      React.createElement('button', { className: 'ops-primary', onClick: () => void load(), disabled: !runId }, 'Load run'),
      error ? React.createElement('p', { role: 'alert', className: 'ops-danger' }, error) : null,
      run
        ? React.createElement(
            'dl',
            null,
            React.createElement('dt', null, 'Status'),
            React.createElement('dd', null, String(run.status)),
            React.createElement('dt', null, 'Intent hash'),
            React.createElement('dd', null, String(run.intentHash ?? '—')),
            React.createElement('dt', null, 'Simulation'),
            React.createElement('dd', null, JSON.stringify(run.simulation ?? null)),
            React.createElement('dt', null, 'Risk assessment'),
            React.createElement('dd', null, JSON.stringify(run.riskAssessment ?? null)),
          )
        : null,
    ),
  );
}
