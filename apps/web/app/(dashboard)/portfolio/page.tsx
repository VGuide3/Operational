'use client';

import * as React from 'react';
import { useAccount } from 'wagmi';
import { useApiClient } from '../../../app/providers';
import { BalanceTable, type BalanceReading } from '../../../components/portfolio/BalanceTable';

export default function PortfolioPage() {
  const api = useApiClient();
  const account = useAccount();
  const [readings, setReadings] = React.useState<BalanceReading[]>([]);
  const [status, setStatus] = React.useState<'idle' | 'loading' | 'error'>('idle');
  const [error, setError] = React.useState<string | null>(null);

  const scan = React.useCallback(async () => {
    if (!account.address || !account.chainId) return;
    setStatus('loading');
    setError(null);
    try {
      const result = await api.portfolio(account.chainId, account.address);
      setReadings(result.readings as BalanceReading[]);
      setStatus('idle');
    } catch (e) {
      setError((e as Error).message);
      setStatus('error');
    }
  }, [api, account.address, account.chainId]);

  return React.createElement(
    'section',
    null,
    React.createElement('h2', null, 'Portfolio'),
    React.createElement(
      'div',
      { className: 'ops-card' },
      React.createElement(
        'div',
        { style: { display: 'flex', gap: 8, alignItems: 'center' } },
        React.createElement(
          'button',
          { className: 'ops-primary', onClick: () => void scan(), disabled: !account.address || status === 'loading' },
          status === 'loading' ? 'Scanning…' : 'Scan balances',
        ),
        React.createElement('span', { className: 'ops-fresh' }, 'Source-attributed, freshness-labeled'),
      ),
      error ? React.createElement('p', { role: 'alert', className: 'ops-danger' }, error) : null,
      React.createElement(BalanceTable, { readings }),
    ),
  );
}
