'use client';

import * as React from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { WagmiProvider, createConfig, http, injected, type Config } from 'wagmi';
import { mainnet, arbitrum, base, optimism, polygon } from 'wagmi/chains';
import { ApiClient } from '../lib/api-client';

/**
 * Client providers. Wagmi wraps the app for wallet connection; React Query
 * backs data fetching. The ApiClient is created once and shared.
 */

export const wagmiConfig: Config = createConfig({
  chains: [mainnet, arbitrum, base, optimism, polygon],
  connectors: [injected()],
  transports: {
    [mainnet.id]: http(),
    [arbitrum.id]: http(),
    [base.id]: http(),
    [optimism.id]: http(),
    [polygon.id]: http(),
  },
  ssr: true,
});

const ApiClientContext = React.createContext<ApiClient | null>(null);

export function useApiClient(): ApiClient {
  const client = React.useContext(ApiClientContext);
  if (!client) throw new Error('ApiClient is not available; wrap the tree in <Providers>');
  return client;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = React.useState(() => new QueryClient({ defaultOptions: { queries: { retry: 1 } } }));
  const [apiClient] = React.useState(
    () =>
      new ApiClient({
        getCsrfToken: () => {
          if (typeof document === 'undefined') return undefined;
          return document.cookie
            .split('; ')
            .find((c) => c.startsWith('ops_csrf='))
            ?.split('=')[1];
        },
      }),
  );

  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <ApiClientContext.Provider value={apiClient}>{children}</ApiClientContext.Provider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
