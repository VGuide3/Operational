import { z } from 'zod';
import { AppError, ErrorCodes, newRequestId, requirePermission, type Permission } from '@ops/core';
import { hashPii } from '@ops/telemetry';
import type { AppContext } from './context.js';
import type { HttpRequest, HttpResponse } from './http.js';
import { baseHeaders, json, toErrorResponse } from './http.js';
import { createRoutes, type RouteDefinition } from './routes.js';
import type { Session } from './session.js';

export interface RouteMatch {
  route: RouteDefinition;
  params: Record<string, string>;
}

/** Compile "/strategies/:id/compile" into a matcher. */
export function compilePath(pattern: string): (path: string) => Record<string, string> | null {
  const patternParts = pattern.split('/').filter(Boolean);
  return (path: string) => {
    const pathParts = path.split('/').filter(Boolean);
    if (pathParts.length !== patternParts.length) return null;
    const params: Record<string, string> = {};
    for (let i = 0; i < patternParts.length; i++) {
      const p = patternParts[i]!;
      const v = pathParts[i]!;
      if (p.startsWith(':')) params[p.slice(1)] = decodeURIComponent(v);
      else if (p !== v) return null;
    }
    return params;
  };
}

export class ApiRouter {
  private readonly routes: RouteDefinition[];

  constructor(private readonly ctx: AppContext) {
    this.routes = createRoutes(ctx);
  }

  match(method: string, path: string): RouteMatch | null {
    for (const route of this.routes) {
      if (route.method !== method) continue;
      const matcher = compilePath(route.path);
      const params = matcher(path);
      if (params) return { route, params };
    }
    return null;
  }

  async handle(request: HttpRequest): Promise<HttpResponse> {
    const requestId = newRequestId();
    const metrics = this.ctx.metrics;
    metrics.counter('ops_requests_total', { method: request.method });

    let match: RouteMatch | null;
    try {
      match = this.match(request.method, request.path);
    } catch {
      match = null;
    }
    if (!match) {
      return json(404, { error: { code: ErrorCodes.NOT_FOUND, message: 'route not found' } }, baseHeaders(requestId));
    }

    const { route, params } = match;

    try {
      // Resolve session (unless the route is public).
      let session: Session | undefined;
      if (!route.public) {
        session = this.ctx.auth.getSession(request.sessionId ?? '');
        if (!session) {
          metrics.counter('ops_auth_failures_total');
          throw new AppError(ErrorCodes.UNAUTHENTICATED, 'authentication required', 401);
        }
        // CSRF protection for cookie-based (state-changing) requests.
        if (route.csrf && request.method !== 'GET') {
          const header = request.headers['x-csrf-token'];
          if (!header || header !== session.csrfToken) {
            throw new AppError(ErrorCodes.FORBIDDEN, 'csrf token missing or invalid', 403);
          }
        }
        if (route.permission) {
          try {
            requirePermission(session.roles, route.permission as Permission);
          } catch (e) {
            metrics.counter('ops_authz_denials_total', { route: route.path });
            throw e;
          }
        }
      }

      const response = await route.handler({
        request,
        params,
        requestId,
        session,
        ctx: this.ctx,
      });

      // Successful responses include a fresh CSRF token for the session.
      if (session && response.status < 400) {
        response.headers = { ...response.headers, ...baseHeaders(requestId, session.csrfToken) };
      }

      metrics.counter('ops_responses_total', { status: String(response.status) });
      return response;
    } catch (error) {
      const response = toErrorResponse(error, requestId);
      metrics.counter('ops_errors_total', { status: String(response.status) });
      this.ctx.audit.append({
        actorType: session_actor(request.sessionId),
        action: 'authz.denial',
        resourceType: 'request',
        resourceId: request.path,
        requestId,
        ipHash: hashPii(request.ip),
        userAgentHash: hashPii(request.userAgent),
        afterState: { status: response.status, error: errorCode(error) },
      });
      return response;
    }
  }
}

function session_actor(_sessionId: string | undefined): 'user' | 'system' {
  return 'user';
}

function errorCode(error: unknown): string {
  if (error && typeof error === 'object' && 'code' in error) return String((error as { code: unknown }).code);
  return ErrorCodes.INTERNAL;
}

export { z };
