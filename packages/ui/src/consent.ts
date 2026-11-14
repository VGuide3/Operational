import { z } from 'zod';
import { newId } from '@ops/core';

/**
 * Consent payload + helpers shared by the dashboard and the embed runtime.
 *
 * A consent record is hash-bound and persisted before any privileged operation
 * is enabled. Changing wallet, chain, or embed origin invalidates it.
 */

export const ConsentScope = z.enum([
  'wallet:connect',
  'balance:read',
  'allowance:read',
  'strategy:propose',
  'signature:request',
  'transaction:submit',
]);
export type ConsentScope = z.infer<typeof ConsentScope>;

export const ALL_SCOPES: ConsentScope[] = [
  'wallet:connect',
  'balance:read',
  'allowance:read',
  'strategy:propose',
  'signature:request',
  'transaction:submit',
];

export const ConsentPayload = z.object({
  consentId: z.string(),
  userId: z.string(),
  walletAddress: z.string().regex(/^0x[0-9a-fA-F]{40}$/),
  chainId: z.number().int().positive(),
  appOrigin: z.string(),
  embedOrigin: z.string().nullable().optional(),
  scopes: z.array(ConsentScope).min(1),
  policyVersion: z.string(),
  termsHash: z.string(),
  expiresAt: z.string().datetime(),
  createdAt: z.string().datetime(),
  revokedAt: z.string().datetime().nullable().optional(),
});
export type ConsentPayload = z.infer<typeof ConsentPayload>;

export const DEFAULT_POLICY_VERSION = '2026-11-01';

export interface CreateConsentInput {
  userId: string;
  walletAddress: string;
  chainId: number;
  appOrigin: string;
  embedOrigin?: string | null;
  scopes?: ConsentScope[];
  policyVersion?: string;
  termsHash: string;
  ttlSeconds?: number;
}

export function createConsent(input: CreateConsentInput): ConsentPayload {
  const now = Date.now();
  return ConsentPayload.parse({
    consentId: newId('consent'),
    userId: input.userId,
    walletAddress: input.walletAddress,
    chainId: input.chainId,
    appOrigin: input.appOrigin,
    embedOrigin: input.embedOrigin ?? null,
    scopes: input.scopes ?? ALL_SCOPES,
    policyVersion: input.policyVersion ?? DEFAULT_POLICY_VERSION,
    termsHash: input.termsHash,
    expiresAt: new Date(now + (input.ttlSeconds ?? 8 * 3600) * 1000).toISOString(),
    createdAt: new Date(now).toISOString(),
    revokedAt: null,
  });
}

export interface ConsentCheckInput {
  consent: ConsentPayload | undefined;
  walletAddress: string;
  chainId: number;
  embedOrigin?: string | null;
  now?: number;
}

export type ConsentCheck =
  | { ok: true }
  | { ok: false; reason: 'missing' | 'revoked' | 'expired' | 'wallet_changed' | 'chain_changed' | 'origin_changed' };

/**
 * Determine whether a consent record still authorizes the current context.
 * Any change to wallet, chain, or embed origin invalidates the prior consent.
 */
export function checkConsent(input: ConsentCheckInput): ConsentCheck {
  const { consent } = input;
  if (!consent) return { ok: false, reason: 'missing' };
  if (consent.revokedAt) return { ok: false, reason: 'revoked' };
  const now = input.now ?? Date.now();
  if (new Date(consent.expiresAt).getTime() <= now) return { ok: false, reason: 'expired' };
  if (consent.walletAddress.toLowerCase() !== input.walletAddress.toLowerCase()) {
    return { ok: false, reason: 'wallet_changed' };
  }
  if (consent.chainId !== input.chainId) return { ok: false, reason: 'chain_changed' };
  const currentEmbed = input.embedOrigin ?? null;
  const consentEmbed = consent.embedOrigin ?? null;
  if (currentEmbed !== consentEmbed) return { ok: false, reason: 'origin_changed' };
  return { ok: true };
}

export function hasScope(consent: ConsentPayload, scope: ConsentScope): boolean {
  return consent.scopes.includes(scope);
}
