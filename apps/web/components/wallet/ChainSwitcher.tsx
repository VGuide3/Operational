'use client';

import * as React from 'react';
import { useAccount, useSwitchChain } from 'wagmi';
import { listChains } from '@ops/chains';

/**
 * Chain switcher bound to the versioned chain registry.
 *
 * Switching chains invalidates the current consent record server-side, so the
 * caller is expected to re-run consent after a successful switch.
 */
export function ChainSwitcher({ onChanged }: { onChanged?: (chainId: number) => void }) {
  const account = useAccount();
  const { switchChain, isPending } = useSwitchChain();
  const chains = listChains();

  const onChange = (e: React.ChangeEvent<HTMLSelectElement>) => {
    const chainId = Number(e.target.value);
    switchChain({ chainId }, { onSuccess: () => onChanged?.(chainId) });
  };

  return React.createElement(
    'label',
    { className: 'ops-chain-switcher' },
    React.createElement('span', null, 'Chain'),
    React.createElement(
      'select',
      {
        'aria-label': 'Select chain',
        value: account.chainId ?? '',
        disabled: isPending || !account.isConnected,
        onChange,
      },
      React.createElement('option', { value: '' }, account.chainId ?? 'Not connected'),
      chains.map((c) => React.createElement('option', { key: c.chainId, value: c.chainId }, `${c.name} (${c.chainId})`)),
    ),
  );
}
