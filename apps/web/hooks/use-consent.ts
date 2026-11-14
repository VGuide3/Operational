'use client';

import * as React from 'react';
import { useApiClient } from '../app/providers';

export interface ConsentState {
  consentId: string;
  scopes: string[];
  expiresAt: string;
}

/**
 * Grants and revokes session-scoped consent.
 *
 * Privileged operations require an unexpired consent record; changing wallet,
 * chain, or embed origin invalidates it server-side.
 */
export function useConsent() {
  const api = useApiClient();
  const [consent, setConsent] = React.useState<ConsentState | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  const grant = React.useCallback(
    async (input: { chainId: number; termsHash: string; scopes?: string[] }) => {
      setBusy(true);
      setError(null);
      try {
        const res = await api.createConsent(input);
        setConsent({ consentId: res.consentId, scopes: input.scopes ?? [], expiresAt: res.expiresAt ?? '' });
        return res.consentId;
      } catch (e) {
        setError((e as Error).message);
        throw e;
      } finally {
        setBusy(false);
      }
    },
    [api],
  );

  const revoke = React.useCallback(
    async (consentId: string) => {
      setBusy(true);
      setError(null);
      try {
        await api.del(`consent/${consentId}`);
        setConsent(null);
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [api],
  );

  return { consent, error, busy, grant, revoke };
}
