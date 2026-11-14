import { describe, expect, it } from 'vitest';
import { privateKeyToAccount } from 'viem/accounts';
import { createAppContext } from './context.js';
import { ApiRouter } from './router.js';
import type { HttpRequest } from './http.js';

const account = privateKeyToAccount(
  '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d',
);
const WALLET = account.address;
const TOKEN = '0x2222222222222222222222222222222222222222';
const SPENDER = '0x3333333333333333333333333333333333333333';

async function login(router: ApiRouter, roles: string[] = ['treasury_operator', 'viewer']) {
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
  const { session } = verifyRes.body as { session: { id: string; csrfToken: string; roles: string[] } };
  session.roles = roles;
  return session;
}

function req(partial: Partial<HttpRequest> & Pick<HttpRequest, 'method' | 'path'>): HttpRequest {
  return { query: {}, headers: {}, body: undefined, ...partial };
}

describe('api router', () => {
  it('exposes public health and readiness endpoints', async () => {
    const router = new ApiRouter(createAppContext());
    const health = await router.handle(req({ method: 'GET', path: 'health' }));
    expect(health.status).toBe(200);
    const ready = await router.handle(req({ method: 'GET', path: 'ready' }));
    expect(ready.status).toBe(200);
  });

  it('requires authentication for protected routes', async () => {
    const router = new ApiRouter(createAppContext());
    const res = await router.handle(req({ method: 'GET', path: 'me' }));
    expect(res.status).toBe(401);
  });

  it('returns 404 for unknown routes', async () => {
    const router = new ApiRouter(createAppContext());
    const res = await router.handle(req({ method: 'GET', path: 'nope' }));
    expect(res.status).toBe(404);
  });

  it('authenticates a wallet and returns a session', async () => {
    const router = new ApiRouter(createAppContext());
    const session = await login(router);
    expect(session.id).toBeTruthy();
    const me = await router.handle(req({ method: 'GET', path: 'me', sessionId: session.id }));
    expect(me.status).toBe(200);
    expect((me.body as { wallet: { address: string } }).wallet.address).toBe(WALLET);
  });

  it('enforces CSRF on state-changing requests', async () => {
    const router = new ApiRouter(createAppContext());
    const session = await login(router);
    const res = await router.handle(
      req({
        method: 'POST',
        path: 'consent',
        sessionId: session.id,
        body: { chainId: 1, termsHash: '0xabc' },
      }),
    );
    expect(res.status).toBe(403);
    expect((res.body as { error: { code: string } }).error.code).toBe('forbidden');
  });

  it('grants consent and blocks privileged routes without it', async () => {
    const router = new ApiRouter(createAppContext());
    const session = await login(router);
    // No consent yet -> allowance scan denied.
    const denied = await router.handle(
      req({
        method: 'POST',
        path: 'allowances/scan',
        sessionId: session.id,
        headers: { 'x-csrf-token': session.csrfToken },
        body: { chainId: 1, owner: WALLET, tokens: [TOKEN], spenders: [SPENDER] },
      }),
    );
    expect(denied.status).toBe(403);
    expect((denied.body as { error: { code: string } }).error.code).toBe('consent_required');

    const consent = await router.handle(
      req({
        method: 'POST',
        path: 'consent',
        sessionId: session.id,
        headers: { 'x-csrf-token': session.csrfToken },
        body: { chainId: 1, termsHash: '0xabc' },
      }),
    );
    expect(consent.status).toBe(201);

    const allowed = await router.handle(
      req({
        method: 'POST',
        path: 'allowances/scan',
        sessionId: session.id,
        headers: { 'x-csrf-token': session.csrfToken },
        body: { chainId: 1, owner: WALLET, tokens: [TOKEN], spenders: [SPENDER] },
      }),
    );
    expect(allowed.status).toBe(200);
  });

  it('denies actions the role lacks permission for', async () => {
    const router = new ApiRouter(createAppContext());
    const session = await login(router, ['viewer']);
    const res = await router.handle(
      req({
        method: 'POST',
        path: 'strategies',
        sessionId: session.id,
        headers: { 'x-csrf-token': session.csrfToken },
        body: { name: 'x', chainId: 1, steps: [{ id: 't', type: 'token_transfer', token: TOKEN, recipient: SPENDER, amount: '1' }] },
      }),
    );
    expect(res.status).toBe(403);
  });

  it('imports and lists contracts with field-level validation', async () => {
    const router = new ApiRouter(createAppContext());
    const session = await login(router, ['contract_admin', 'viewer']);
    const manifest = {
      manifestVersion: '1.0.0',
      contracts: [
        {
          key: 'treasury',
          name: 'Treasury',
          chainId: 1,
          address: '0x0000000000000000000000000000000000000001',
          abi: [{ type: 'function', name: 'transfer', inputs: [], outputs: [] }],
          verified: true,
          verification: { compilerVersion: '0.8.24' },
        },
      ],
    };
    const imported = await router.handle(
      req({
        method: 'POST',
        path: 'contracts/import',
        sessionId: session.id,
        headers: { 'x-csrf-token': session.csrfToken },
        body: {
          manifest,
          bytecodeVerified: ['1:0x0000000000000000000000000000000000000001'],
        },
      }),
    );
    expect(imported.status).toBe(201);
    const manifestId = (imported.body as { manifestId: string }).manifestId;

    const approved = await router.handle(
      req({
        method: 'POST',
        path: `contracts/${manifestId}/approve`,
        sessionId: session.id,
        headers: { 'x-csrf-token': session.csrfToken },
      }),
    );
    // Production chain requires a second approver.
    expect(approved.status).toBe(202);

    const list = await router.handle(req({ method: 'GET', path: 'contracts', sessionId: session.id }));
    expect(list.status).toBe(200);
  });

  it('rejects a malformed manifest without partial records', async () => {
    const router = new ApiRouter(createAppContext());
    const session = await login(router, ['contract_admin', 'viewer']);
    const res = await router.handle(
      req({
        method: 'POST',
        path: 'contracts/import',
        sessionId: session.id,
        headers: { 'x-csrf-token': session.csrfToken },
        body: { manifest: { manifestVersion: '1.0.0', contracts: [{ key: 'x' }] } },
      }),
    );
    expect(res.status).toBe(422);
    const list = await router.handle(req({ method: 'GET', path: 'contracts', sessionId: session.id }));
    expect((list.body as { items: unknown[] }).items).toHaveLength(0);
  });

  it('computes a deterministic CREATE2 address', async () => {
    const router = new ApiRouter(createAppContext());
    const session = await login(router, ['deployer', 'viewer']);
    const body = {
      chainId: 1,
      factory: '0x4e59b44847b379578588920cA78FbF26c0B4956C',
      salt: `0x${'11'.repeat(32)}`,
      initCode: '0x600160005260206000f3',
    };
    const res = await router.handle(
      req({ method: 'POST', path: 'deployments/create2', sessionId: session.id, headers: { 'x-csrf-token': session.csrfToken }, body }),
    );
    expect(res.status).toBe(201);
    expect((res.body as { predictedAddress: string }).predictedAddress).toMatch(/^0x[0-9a-fA-F]{40}$/);
  });

  it('records a CREATE2 deployment and returns it from the status route', async () => {
    const router = new ApiRouter(createAppContext());
    const session = await login(router, ['deployer', 'viewer']);
    const body = {
      chainId: 1,
      factory: '0x4e59b44847b379578588920cA78FbF26c0B4956C',
      salt: `0x${'11'.repeat(32)}`,
      initCode: '0x600160005260206000f3',
    };
    const created = await router.handle(
      req({ method: 'POST', path: 'deployments/create2', sessionId: session.id, headers: { 'x-csrf-token': session.csrfToken }, body }),
    );
    expect(created.status).toBe(201);
    const { deploymentId } = created.body as { deploymentId: string };
    const status = await router.handle(
      req({ method: 'GET', path: `deployments/${deploymentId}`, sessionId: session.id }),
    );
    expect(status.status).toBe(200);
    expect((status.body as { status: string }).status).toBe('pending');
  });

  it('rejects a CREATE2 request whose supplied address does not match', async () => {
    const router = new ApiRouter(createAppContext());
    const session = await login(router, ['deployer', 'viewer']);
    const res = await router.handle(
      req({
        method: 'POST',
        path: 'deployments/create2',
        sessionId: session.id,
        headers: { 'x-csrf-token': session.csrfToken },
        body: {
          chainId: 1,
          factory: '0x4e59b44847b379578588920cA78FbF26c0B4956C',
          salt: `0x${'11'.repeat(32)}`,
          initCode: '0x600160005260206000f3',
          predictedAddress: '0x0000000000000000000000000000000000009999',
        },
      }),
    );
    expect(res.status).toBe(422);
  });

  it('creates, lists, and revokes a scoped delegation', async () => {
    const router = new ApiRouter(createAppContext());
    const session = await login(router, ['delegation_manager', 'viewer']);
    const create = await router.handle(
      req({
        method: 'POST',
        path: 'delegations',
        sessionId: session.id,
        headers: { 'x-csrf-token': session.csrfToken },
        body: {
          delegate: SPENDER,
          chainId: 1,
          scope: { tokens: [TOKEN], maxPerTx: '1000000', maxDailyUsd: '50000' },
          validFrom: new Date(Date.now() - 1000).toISOString(),
          validUntil: new Date(Date.now() + 86400_000).toISOString(),
        },
      }),
    );
    expect(create.status).toBe(201);
    const { delegation } = create.body as { delegation: { delegationId: string } };

    const list = await router.handle(req({ method: 'GET', path: 'delegations', sessionId: session.id }));
    expect(list.status).toBe(200);
    expect((list.body as { items: unknown[] }).items).toHaveLength(1);

    const revoke = await router.handle(
      req({
        method: 'POST',
        path: `delegations/${delegation.delegationId}/revoke`,
        sessionId: session.id,
        headers: { 'x-csrf-token': session.csrfToken },
      }),
    );
    expect(revoke.status).toBe(200);
    expect((revoke.body as { status: string }).status).toBe('revoked');
  });

  it('stages a Permit2 signature payload and rejects duplicate intents', async () => {
    const router = new ApiRouter(createAppContext());
    const session = await login(router);
    // Grant consent with signature scope.
    await router.handle(
      req({
        method: 'POST',
        path: 'consent',
        sessionId: session.id,
        headers: { 'x-csrf-token': session.csrfToken },
        body: { chainId: 1, termsHash: '0xabc' },
      }),
    );
    const body = {
      chainId: 1,
      token: TOKEN,
      amount: '1000',
      recipient: SPENDER,
      deadlineSeconds: 600,
      intentHash: '0xintent-1',
      executor: SPENDER,
    };
    const first = await router.handle(
      req({ method: 'POST', path: 'signatures/permit2', sessionId: session.id, headers: { 'x-csrf-token': session.csrfToken }, body }),
    );
    expect(first.status).toBe(200);
    const second = await router.handle(
      req({ method: 'POST', path: 'signatures/permit2', sessionId: session.id, headers: { 'x-csrf-token': session.csrfToken }, body }),
    );
    expect(second.status).toBe(409);
  });

  it('returns audit events to auditors and reports chain integrity', async () => {
    const router = new ApiRouter(createAppContext());
    const session = await login(router, ['auditor']);
    const res = await router.handle(req({ method: 'GET', path: 'audit-events', sessionId: session.id }));
    expect(res.status).toBe(200);
    expect((res.body as { chain: { ok: boolean } }).chain.ok).toBe(true);
  });
});
