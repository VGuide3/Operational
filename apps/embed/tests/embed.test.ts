import { describe, expect, it, vi } from 'vitest';
import {
  ALLOWED_ACTIONS,
  RPC_ALLOWLIST,
  isAllowedOrigin,
  isValidApiKey,
  isRpcAllowed,
  makeError,
  makeResponse,
  parseMessage,
} from '../src/postmessage.js';
import { RpcBridge, detectProvider } from '../src/wallet-bridge.js';

describe('postMessage protocol', () => {
  it('accepts a well-formed request', () => {
    const msg = parseMessage(
      JSON.stringify({ type: 'ops:request', requestId: 'req_1', action: 'open_allowances', payload: { chainId: 1 } }),
    );
    expect(msg).toEqual({ type: 'ops:request', requestId: 'req_1', action: 'open_allowances', payload: { chainId: 1 } });
  });

  it('rejects unknown actions and malformed payloads', () => {
    expect(parseMessage(JSON.stringify({ type: 'ops:request', requestId: 'r', action: 'sign_transaction' }))).toBeNull();
    expect(parseMessage(JSON.stringify({ type: 'ops:request', action: 'get_view' }))).toBeNull();
    expect(parseMessage('not json')).toBeNull();
    expect(parseMessage(JSON.stringify({ type: 'other' }))).toBeNull();
  });

  it('never allows a generic transaction action', () => {
    expect(ALLOWED_ACTIONS).not.toContain('eth_sendTransaction' as never);
  });

  it('builds success and error responses', () => {
    expect(makeResponse('r', { view: 'portfolio' })).toMatchObject({ type: 'ops:response', ok: true });
    expect(makeError('r', 'forbidden', 'nope')).toMatchObject({ type: 'ops:response', ok: false });
  });
});

describe('origin policy', () => {
  it('allows exact and subdomain origins, rejects others', () => {
    const policy = { allowedOrigins: ['https://partner.example.com'] };
    expect(isAllowedOrigin('https://partner.example.com', policy)).toBe(true);
    expect(isAllowedOrigin('https://app.partner.example.com', policy)).toBe(true);
    expect(isAllowedOrigin('https://evil.example.com', policy)).toBe(false);
    expect(isAllowedOrigin('http://partner.example.com', policy)).toBe(false);
  });

  it('never trusts a wildcard origin', () => {
    expect(isAllowedOrigin('https://anything.example.com', { allowedOrigins: ['*'] })).toBe(false);
  });
});

describe('api key validation', () => {
  it('accepts live and test keys and rejects others', () => {
    expect(isValidApiKey('pk_live_abcd1234')).toBe(true);
    expect(isValidApiKey('pk_test_abcd1234')).toBe(true);
    expect(isValidApiKey('pk_live_short')).toBe(false);
    expect(isValidApiKey(undefined)).toBe(false);
    expect(isValidApiKey('secret')).toBe(false);
  });
});

describe('rpc bridge', () => {
  it('exposes only allowlisted read methods', async () => {
    const request = vi.fn(async ({ method }: { method: string }) => (method === 'eth_chainId' ? '0x1' : null));
    const bridge = new RpcBridge({ chainId: 1, provider: { request } });
    await expect(bridge.request('eth_chainId')).resolves.toBe('0x1');
    await expect(bridge.request('eth_sendTransaction')).rejects.toThrow(/not allowed/);
    expect(isRpcAllowed('eth_call')).toBe(true);
    expect(RPC_ALLOWLIST).not.toContain('eth_sendTransaction' as never);
  });

  it('reports unavailability without a provider', async () => {
    const bridge = new RpcBridge({ chainId: 1 });
    expect(bridge.available).toBe(false);
    await expect(bridge.request('eth_chainId')).rejects.toThrow(/no wallet provider/);
  });

  it('detects an injected provider', () => {
    expect(detectProvider({ ethereum: { request: async () => null } })).toBeDefined();
    expect(detectProvider({})).toBeUndefined();
  });
});
