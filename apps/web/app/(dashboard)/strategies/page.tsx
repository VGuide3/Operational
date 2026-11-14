'use client';

import * as React from 'react';
import { useApiClient } from '../../../app/providers';
import { IntentPreview, type Intent } from '../../../components/strategy/IntentPreview';

export default function StrategiesPage() {
  const api = useApiClient();
  const [name, setName] = React.useState('Weekly treasury rebalance');
  const chainId = 1;
  const [definition, setDefinition] = React.useState(
    JSON.stringify(
      {
        name: 'Weekly treasury rebalance',
        chainId: 1,
        trigger: { type: 'manual', allowedRoles: ['treasury_operator'] },
        preconditions: [],
        steps: [
          { id: 'revoke', type: 'erc20_approve', token: '0x0000000000000000000000000000000000000002', spender: '0x0000000000000000000000000000000000000003', amount: '0' },
        ],
        riskPolicy: { maxNativeValueUsd: '25000', requireTelegramApproval: true, requireSimulation: true, blockedRecipients: [] },
      },
      null,
      2,
    ),
  );
  const [strategyId, setStrategyId] = React.useState<string | null>(null);
  const [intents, setIntents] = React.useState<Intent[]>([]);
  const [intentHash, setIntentHash] = React.useState<string | null>(null);
  const [riskFlags, setRiskFlags] = React.useState<string[]>([]);
  const [runId, setRunId] = React.useState<string | null>(null);
  const [jobId, setJobId] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const create = async () => {
    setError(null);
    setBusy(true);
    try {
      const body = JSON.parse(definition);
      const record = await api.createStrategy({ ...body, name, chainId });
      setStrategyId(record.id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const compile = async () => {
    if (!strategyId) return;
    setError(null);
    try {
      const res = await api.compileStrategy(strategyId);
      setIntents(res.intents as Intent[]);
      setIntentHash(res.intentHash);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const simulate = async () => {
    if (!strategyId) return;
    setError(null);
    try {
      const res = await api.simulateStrategy(strategyId);
      setRunId(res.runId);
      setRiskFlags(res.assessment.riskFlags);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  const execute = async (dryRun: boolean) => {
    if (!strategyId) return;
    setError(null);
    try {
      const res = await api.executeStrategy(strategyId, {
        dryRun,
        idempotencyKey: `${strategyId}:${Date.now()}`,
      });
      setRunId(res.runId);
      if (res.jobId) setJobId(res.jobId);
    } catch (e) {
      setError((e as Error).message);
    }
  };

  return React.createElement(
    'section',
    null,
    React.createElement('h2', null, 'Strategies'),
    React.createElement(
      'div',
      { className: 'ops-card' },
      React.createElement('label', null, 'Name'),
      React.createElement('input', {
        'aria-label': 'Name',
        value: name,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value),
        style: { width: '100%', marginBottom: 8 },
      }),
      React.createElement('label', { htmlFor: 'definition' }, 'Strategy document (JSON)'),
      React.createElement('textarea', {
        id: 'definition',
        value: definition,
        rows: 14,
        style: { width: '100%' },
        onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => setDefinition(e.target.value),
      }),
      React.createElement(
        'div',
        { style: { display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' } },
        React.createElement('button', { className: 'ops-primary', onClick: () => void create(), disabled: busy }, 'Create draft'),
        React.createElement('button', { onClick: () => void compile(), disabled: !strategyId }, 'Compile'),
        React.createElement('button', { onClick: () => void simulate(), disabled: !strategyId }, 'Simulate'),
        React.createElement('button', { onClick: () => void execute(true), disabled: !strategyId }, 'Dry run'),
        React.createElement('button', { className: 'ops-primary', onClick: () => void execute(false), disabled: !strategyId }, 'Request execution'),
      ),
      error ? React.createElement('p', { role: 'alert', className: 'ops-danger' }, error) : null,
      strategyId ? React.createElement('p', null, `Strategy ${strategyId}`) : null,
      intentHash ? React.createElement('p', { className: 'ops-fresh' }, `Intent hash: ${intentHash}`) : null,
      runId ? React.createElement('p', null, `Run ${runId}`) : null,
      jobId
        ? React.createElement(
            'p',
            null,
            `Awaiting approval: job ${jobId} `,
            React.createElement('span', { className: 'ops-badge' }, 'Telegram + dashboard dual control'),
          )
        : null,
      riskFlags.length > 0
        ? React.createElement(
            'ul',
            { className: 'ops-danger' },
            riskFlags.map((f) => React.createElement('li', { key: f }, f)),
          )
        : null,
    ),
    React.createElement(IntentPreview, { intents, intentHash }),
  );
}
