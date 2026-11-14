'use client';

import * as React from 'react';
import { useAccount } from 'wagmi';
import { useApiClient } from '../../../app/providers';
import { AllowanceTable, type AllowanceReading } from '../../../components/allowances/AllowanceTable';

export default function AllowancesPage() {
  const api = useApiClient();
  const account = useAccount();
  const [tokens, setTokens] = React.useState('');
  const [spenders, setSpenders] = React.useState('');
  const [readings, setReadings] = React.useState<AllowanceReading[]>([]);
  const [unlimitedOnly, setUnlimitedOnly] = React.useState(false);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [revocation, setRevocation] = React.useState<{ token: string; spender: string } | null>(null);

  const queueRevocation = React.useCallback(
    async (reading: AllowanceReading) => {
      if (!account.address || !account.chainId) return;
      setError(null);
      try {
        await api.revokeAllowance({
          chainId: account.chainId,
          token: reading.token,
          spender: reading.spender,
          // Explicit confirmation is required to queue a revocation.
          confirm: true,
        });
        setRevocation({ token: reading.token, spender: reading.spender });
      } catch (e) {
        setError((e as Error).message);
      }
    },
    [api, account.address, account.chainId],
  );

  const scan = React.useCallback(async () => {
    if (!account.address || !account.chainId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await api.scanAllowances({
        chainId: account.chainId,
        owner: account.address,
        tokens: tokens.split(',').map((t) => t.trim()).filter(Boolean),
        spenders: spenders.split(',').map((s) => s.trim()).filter(Boolean),
      });
      setReadings(result.readings as AllowanceReading[]);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api, account.address, account.chainId, tokens, spenders]);

  const visible = unlimitedOnly ? readings.filter((r) => r.allowanceIsMax) : readings;

  return React.createElement(
    'section',
    null,
    React.createElement('h2', null, 'Allowances'),
    React.createElement(
      'div',
      { className: 'ops-card' },
      React.createElement('label', null, 'Tokens (comma-separated addresses)'),
      React.createElement('input', {
        'aria-label': 'Tokens',
        value: tokens,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setTokens(e.target.value),
        style: { width: '100%', marginBottom: 8 },
      }),
      React.createElement('label', null, 'Spenders (comma-separated addresses)'),
      React.createElement('input', {
        'aria-label': 'Spenders',
        value: spenders,
        onChange: (e: React.ChangeEvent<HTMLInputElement>) => setSpenders(e.target.value),
        style: { width: '100%', marginBottom: 8 },
      }),
      React.createElement(
        'div',
        { style: { display: 'flex', gap: 8, alignItems: 'center' } },
        React.createElement(
          'button',
          { className: 'ops-primary', onClick: () => void scan(), disabled: !account.address || loading },
          loading ? 'Scanning…' : 'Scan allowances',
        ),
        React.createElement(
          'label',
          null,
          React.createElement('input', {
            type: 'checkbox',
            checked: unlimitedOnly,
            onChange: (e: React.ChangeEvent<HTMLInputElement>) => setUnlimitedOnly(e.target.checked),
          }),
          ' Unlimited only',
        ),
      ),
      error ? React.createElement('p', { role: 'alert', className: 'ops-danger' }, error) : null,
      revocation
        ? React.createElement(
            'p',
            { className: 'ops-fresh' },
            `Revocation intent queued for ${revocation.spender} (${revocation.token}).`,
          )
        : null,
      React.createElement(AllowanceTable, { readings: visible, onRevoke: queueRevocation }),
    ),
  );
}
