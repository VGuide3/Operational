import { describe, expect, it } from 'vitest';
import { checkConsent, createConsent, hasScope } from './consent.js';
import { initialModalContext, scopesForState, transition } from './wallet-machine.js';

const WALLET = '0x1111111111111111111111111111111111111111';

describe('consent', () => {
  it('creates a valid consent record', () => {
    const consent = createConsent({
      userId: 'usr_1',
      walletAddress: WALLET,
      chainId: 1,
      appOrigin: 'https://ops.example.com',
      termsHash: '0xabc',
    });
    expect(consent.consentId.startsWith('cns_')).toBe(true);
    expect(hasScope(consent, 'balance:read')).toBe(true);
  });

  it('accepts a matching context', () => {
    const consent = createConsent({
      userId: 'usr_1',
      walletAddress: WALLET,
      chainId: 1,
      appOrigin: 'https://ops.example.com',
      termsHash: '0xabc',
    });
    expect(checkConsent({ consent, walletAddress: WALLET, chainId: 1 }).ok).toBe(true);
  });

  it('invalidates on wallet change', () => {
    const consent = createConsent({ userId: 'usr_1', walletAddress: WALLET, chainId: 1, appOrigin: 'a', termsHash: '0x' });
    const result = checkConsent({ consent, walletAddress: '0x2222222222222222222222222222222222222222', chainId: 1 });
    expect(result).toEqual({ ok: false, reason: 'wallet_changed' });
  });

  it('invalidates on chain change', () => {
    const consent = createConsent({ userId: 'usr_1', walletAddress: WALLET, chainId: 1, appOrigin: 'a', termsHash: '0x' });
    expect(checkConsent({ consent, walletAddress: WALLET, chainId: 10 })).toEqual({ ok: false, reason: 'chain_changed' });
  });

  it('invalidates on embed origin change', () => {
    const consent = createConsent({
      userId: 'usr_1',
      walletAddress: WALLET,
      chainId: 1,
      appOrigin: 'a',
      embedOrigin: 'https://partner.example.com',
      termsHash: '0x',
    });
    expect(checkConsent({ consent, walletAddress: WALLET, chainId: 1, embedOrigin: 'https://evil.example.com' })).toEqual({
      ok: false,
      reason: 'origin_changed',
    });
  });

  it('detects expiry and revocation', () => {
    const consent = createConsent({
      userId: 'usr_1',
      walletAddress: WALLET,
      chainId: 1,
      appOrigin: 'a',
      termsHash: '0x',
      ttlSeconds: 1,
    });
    expect(checkConsent({ consent, walletAddress: WALLET, chainId: 1, now: Date.now() + 10000 })).toEqual({
      ok: false,
      reason: 'expired',
    });
    expect(checkConsent({ consent: { ...consent, revokedAt: new Date().toISOString() }, walletAddress: WALLET, chainId: 1 })).toEqual({
      ok: false,
      reason: 'revoked',
    });
  });
});

describe('wallet state machine', () => {
  it('moves discovery -> connecting -> consent -> connected', () => {
    let ctx = transition(initialModalContext, { type: 'OPEN' }).context;
    expect(ctx.state).toBe('discovery');
    ctx = transition(ctx, { type: 'SELECT_WALLET', walletId: 'metamask' }).context;
    expect(ctx.state).toBe('connecting');
    const connected = transition(ctx, { type: 'CONNECTED', address: WALLET, chainId: 1 });
    expect(connected.context.state).toBe('consent');
    expect(connected.audit).toBe('wallet.connect');
    ctx = transition(connected.context, { type: 'CONSENT_APPROVED' }).context;
    expect(ctx.state).toBe('connected');
    expect(ctx.consentGranted).toBe(true);
  });

  it('skips consent when already granted', () => {
    const ctx = { ...initialModalContext, state: 'connecting' as const, consentGranted: true };
    expect(transition(ctx, { type: 'CONNECTED', address: WALLET, chainId: 1 }).context.state).toBe('connected');
  });

  it('clears session and audits on rejection', () => {
    const ctx = { ...initialModalContext, state: 'connecting' as const };
    const result = transition(ctx, { type: 'REJECTED' });
    expect(result.clearSession).toBe(true);
    expect(result.audit).toBe('auth.failure');
    expect(result.context.consentGranted).toBe(false);
  });

  it('invalidates consent on account change', () => {
    const ctx = { ...initialModalContext, state: 'connected' as const, consentGranted: true, address: WALLET, chainId: 1 };
    const result = transition(ctx, { type: 'ACCOUNT_CHANGED', address: '0x2222222222222222222222222222222222222222' });
    expect(result.context.state).toBe('consent');
    expect(result.context.consentGranted).toBe(false);
    expect(result.audit).toBe('consent.invalidated');
  });

  it('resets fully on disconnect', () => {
    const ctx = { ...initialModalContext, state: 'connected' as const, consentGranted: true, address: WALLET };
    const result = transition(ctx, { type: 'DISCONNECT' });
    expect(result.context.state).toBe('idle');
    expect(result.clearSession).toBe(true);
  });

  it('exposes scopes only when connected', () => {
    expect(scopesForState('connected')).toContain('transaction:submit');
    expect(scopesForState('consent')).toEqual(['wallet:connect']);
    expect(scopesForState('discovery')).toEqual([]);
  });
});
