'use client';

import * as React from 'react';
import { useAccount, useConnect, useDisconnect, useSwitchChain } from 'wagmi';
import { initialModalContext, transition, type ModalContext, type ModalEvent } from '@ops/ui';
import { useApiClient } from '../app/providers';
import { WalletConnectModal } from './wallet/WalletConnectModal';
import { ConsentPanel } from './wallet/ConsentPanel';
import { ChainSwitcher } from './wallet/ChainSwitcher';

/**
 * Wallet bar + canonical modal host.
 *
 * The modal is the single @ops/ui component shared with the embed runtime.
 * Connection state flows into the same state machine so consent semantics
 * cannot drift between surfaces.
 */
export function WalletBar() {
  const api = useApiClient();
  const account = useAccount();
  const { connectAsync, connectors } = useConnect();
  const { disconnect } = useDisconnect();
  const { switchChainAsync } = useSwitchChain();

  const [modal, setModal] = React.useState<ModalContext>(initialModalContext);
  const [authenticated, setAuthenticated] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>(undefined);

  const dispatch = React.useCallback((event: ModalEvent) => {
    setModal((ctx) => transition(ctx, event).context);
  }, []);

  // Issue a server challenge + verify signature once the wallet connects.
  const startAuth = React.useCallback(
    async (address: string, chainId: number) => {
      try {
        const challenge = await api.post<{ nonce: string; message: string }>('auth/wallet-challenge', {
          walletAddress: address,
          chainId,
        });
        // Signing happens in the user's wallet; the client never sees a key.
        const provider = (window as unknown as { ethereum?: { request: (a: unknown) => Promise<unknown> } }).ethereum;
        const signature = provider
          ? await provider.request({ method: 'personal_sign', params: [challenge.message, address] })
          : undefined;
        if (!signature) throw new Error('wallet did not return a signature');
        await api.post('auth/wallet-verify', { walletAddress: address, chainId, nonce: challenge.nonce, signature });
        setAuthenticated(true);
      } catch (e) {
        setError((e as Error).message);
        dispatch({ type: 'REJECTED' });
      }
    },
    [api, dispatch],
  );

  return React.createElement(
    React.Fragment,
    null,
    React.createElement(
      'div',
      { className: 'ops-card', style: { display: 'flex', justifyContent: 'space-between', alignItems: 'center' } },
      React.createElement(
        'div',
        null,
        account.address
          ? React.createElement(
              'span',
              null,
              React.createElement('strong', null, `${account.address.slice(0, 6)}…${account.address.slice(-4)}`),
              ' ',
              React.createElement('span', { className: 'ops-badge' }, `chain ${account.chainId ?? '—'}`),
            )
          : React.createElement('span', { className: 'ops-badge' }, 'Not connected'),
      ),
      React.createElement(
        'div',
        { style: { display: 'flex', gap: 8, alignItems: 'center' } },
        React.createElement(ChainSwitcher),
        !account.address
          ? React.createElement(
              'button',
              { className: 'ops-primary', onClick: () => dispatch({ type: 'OPEN' }) },
              'Connect wallet',
            )
          : React.createElement(
              'button',
              {
                onClick: () => {
                  disconnect();
                  dispatch({ type: 'DISCONNECT' });
                  setAuthenticated(false);
                },
              },
              'Disconnect',
            ),
      ),
    ),
    authenticated && account.address
      ? React.createElement(ConsentPanel, { chainId: account.chainId ?? 1 })
      : null,
    React.createElement(WalletConnectModal, {
      context: modal,
      requestingOrigin: typeof window !== 'undefined' ? window.location.origin : 'https://ops.example.com',
      appOrigin: 'https://ops.example.com',
      onEvent: (event) => {
        void (async () => {
          dispatch(event);
          if (event.type === 'SELECT_WALLET') {
            try {
              const connector = connectors.find((c) => c.id === event.walletId);
              if (!connector) return;
              const result = await connectAsync({ connector });
              const chainId = result.chainId;
              const address = result.accounts[0]!;
              dispatch({ type: 'CONNECTED', address, chainId });
              if (chainId !== 1) {
                // Switching chains invalidates prior consent server-side.
                await switchChainAsync({ chainId: 1 }).catch(() => undefined);
              }
              await startAuth(address, chainId);
            } catch {
              dispatch({ type: 'REJECTED' });
            }
          }
        })();
      },
    }),
    error ? React.createElement('p', { role: 'alert', className: 'ops-danger' }, error) : null,
  );
}
