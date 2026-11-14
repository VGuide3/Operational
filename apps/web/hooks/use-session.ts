'use client';

import * as React from 'react';
import { useApiClient } from '../app/providers';

export interface SessionInfo {
  user: { id: string };
  wallet: { address: string; chainId: number };
  roles: string[];
  consent?: { consentId: string; scopes: string[]; expiresAt: string } | null;
}

/**
 * Reads the server session. Authorization is always re-derived server-side;
 * this hook is display-only and never gates a privileged call by itself.
 */
export function useSession() {
  const api = useApiClient();
  const [session, setSession] = React.useState<SessionInfo | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [loading, setLoading] = React.useState(false);

  const refresh = React.useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setSession(await api.me());
    } catch (e) {
      setSession(null);
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [api]);

  React.useEffect(() => {
    void refresh();
  }, [refresh]);

  return { session, error, loading, refresh };
}
