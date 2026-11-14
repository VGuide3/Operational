import { createAppContext, type AppContext } from '@ops/service-api';

/**
 * Server-side singleton container.
 *
 * In a real deployment this is backed by Postgres/Redis; here it is an
 * in-process instance so the API routes are exercised end to end. Route
 * handlers never import this from the client bundle.
 */
declare global {
  // eslint-disable-next-line no-var
  var __opsAppContext: AppContext | undefined;
}

export function getServerContext(): AppContext {
  if (!globalThis.__opsAppContext) {
    globalThis.__opsAppContext = createAppContext({
      domain: process.env.OPS_DOMAIN ?? 'ops.example.com',
    });
  }
  return globalThis.__opsAppContext;
}
