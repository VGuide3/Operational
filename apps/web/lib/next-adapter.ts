import { ApiRouter, type HttpRequest } from '@ops/service-api';
import { getServerContext } from './server-context';

/**
 * Adapter from a Next.js Route Handler request to the framework-agnostic
 * ApiRouter. All routes live under a single catch-all handler
 * (app/api/v1/[...path]/route.ts) so the route table stays in one place.
 */

export const SESSION_COOKIE = 'ops_session';

function readCookie(cookieHeader: string | null, name: string): string | undefined {
  if (!cookieHeader) return undefined;
  for (const part of cookieHeader.split(';')) {
    const [k, ...rest] = part.trim().split('=');
    if (k === name) return decodeURIComponent(rest.join('='));
  }
  return undefined;
}

export async function handleApiRequest(
  request: Request,
  segments: string[],
  router: ApiRouter = new ApiRouter(getServerContext()),
): Promise<Response> {
  const url = new URL(request.url);

  const query: Record<string, string | string[]> = {};
  url.searchParams.forEach((value, key) => {
    const existing = query[key];
    if (existing === undefined) query[key] = value;
    else if (Array.isArray(existing)) existing.push(value);
    else query[key] = [existing, value];
  });

  const headers: Record<string, string | undefined> = {};
  request.headers.forEach((value, key) => {
    headers[key.toLowerCase()] = value;
  });

  // Body: read text once, then attempt JSON parse.
  let body: unknown;
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    const text = await request.text();
    if (text) {
      try {
        body = JSON.parse(text);
      } catch {
        body = text;
      }
    }
  }

  const sessionId =
    readCookie(request.headers.get('cookie'), SESSION_COOKIE) ??
    headers['authorization']?.replace(/^Bearer\s+/i, '');

  const httpRequest: HttpRequest = {
    method: request.method,
    path: segments.join('/'),
    query,
    body,
    headers,
    ...(sessionId ? { sessionId } : {}),
    ...(headers['x-forwarded-for'] ? { ip: headers['x-forwarded-for'] } : {}),
    ...(headers['user-agent'] ? { userAgent: headers['user-agent'] } : {}),
  };

  const response = await router.handle(httpRequest);

  const responseHeaders = new Headers({ 'content-type': 'application/json' });
  for (const [k, v] of Object.entries(response.headers ?? {})) responseHeaders.set(k, v);
  return new Response(JSON.stringify(response.body), { status: response.status, headers: responseHeaders });
}
