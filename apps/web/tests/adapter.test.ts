import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { ApiRouter, createAppContext } from '@ops/service-api';
import { handleApiRequest, SESSION_COOKIE } from '../lib/next-adapter';

/**
 * End-to-end test of the Next.js Route Handler adapter: a Request goes in,
 * a Response comes out, exercising auth, CSRF, and a privileged route.
 */
const account = privateKeyToAccount('0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d');
const WALLET = account.address;

async function makeSession(router: ApiRouter) {
  const challengeRes = await router.handle({
    method: 'POST',
    path: 'auth/wallet-challenge',
    query: {},
    headers: {},
    body: { walletAddress: WALLET, chainId: 1 },
  });
  const challenge = challengeRes.body as { nonce: string; message: string };
  const signature = await account.signMessage({ message: challenge.message });
  const verifyRes = await router.handle({
    method: 'POST',
    path: 'auth/wallet-verify',
    query: {},
    headers: {},
    body: { walletAddress: WALLET, chainId: 1, nonce: challenge.nonce, signature },
  });
  return (verifyRes.body as { session: { id: string; csrfToken: string } }).session;
}

describe('next route handler adapter', () => {
  it('serves public health through the catch-all handler', async () => {
    const router = new ApiRouter(createAppContext());
    const response = await handleApiRequest(new Request('http://localhost/api/v1/health'), ['health'], router);
    expect(response.status).toBe(200);
    expect(response.headers.get('content-type')).toBe('application/json');
    const body = (await response.json()) as { status: string };
    expect(body.status).toBe('ok');
  });

  it('rejects unauthenticated protected requests with a stable error shape', async () => {
    const router = new ApiRouter(createAppContext());
    const response = await handleApiRequest(new Request('http://localhost/api/v1/me'), ['me'], router);
    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: { code: string } };
    expect(body.error.code).toBeTruthy();
  });

  it('accepts a session cookie and returns the wallet', async () => {
    const router = new ApiRouter(createAppContext());
    const session = await makeSession(router);
    const response = await handleApiRequest(
      new Request('http://localhost/api/v1/me', { headers: { cookie: `${SESSION_COOKIE}=${session.id}` } }),
      ['me'],
      router,
    );
    expect(response.status).toBe(200);
    const body = (await response.json()) as { wallet: { address: string } };
    expect(body.wallet.address).toBe(WALLET);
  });

  it('enforces CSRF for state-changing requests via header', async () => {
    const router = new ApiRouter(createAppContext());
    const session = await makeSession(router);
    const withoutCsrf = await handleApiRequest(
      new Request('http://localhost/api/v1/consent', {
        method: 'POST',
        headers: { cookie: `${SESSION_COOKIE}=${session.id}`, 'content-type': 'application/json' },
        body: JSON.stringify({ chainId: 1, termsHash: '0x' + 'ab'.repeat(32) }),
      }),
      ['consent'],
      router,
    );
    expect(withoutCsrf.status).toBe(403);

    const withCsrf = await handleApiRequest(
      new Request('http://localhost/api/v1/consent', {
        method: 'POST',
        headers: {
          cookie: `${SESSION_COOKIE}=${session.id}`,
          'content-type': 'application/json',
          'x-csrf-token': session.csrfToken,
        },
        body: JSON.stringify({ chainId: 1, termsHash: '0x' + 'ab'.repeat(32) }),
      }),
      ['consent'],
      router,
    );
    expect(withCsrf.status).toBeLessThan(400);
  });
});
