import { ZodError, type ZodTypeAny, z } from 'zod';
import { AppError, ErrorCodes, isAppError, newRequestId } from '@ops/core';

/**
 * Minimal HTTP request/response types so the router is framework-agnostic and
 * can be adapted by Next.js Route Handlers (see apps/web).
 */

export interface HttpRequest {
  method: string;
  /** Path after /api/v1, e.g. "strategies/str_1/compile". */
  path: string;
  query: Record<string, string | string[] | undefined>;
  body: unknown;
  headers: Record<string, string | undefined>;
  /** Resolved session id from a cookie or Authorization header. */
  sessionId?: string;
  ip?: string;
  userAgent?: string;
}

export interface HttpResponse {
  status: number;
  body: unknown;
  headers?: Record<string, string>;
}

export const json = (status: number, body: unknown, headers?: Record<string, string>): HttpResponse => ({
  status,
  body,
  ...(headers ? { headers } : {}),
});

/** Parse and validate a request body, converting Zod errors to field details. */
export function parseBody<T extends ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new AppError(
      ErrorCodes.VALIDATION_FAILED,
      'request validation failed',
      422,
      result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
    );
  }
  return result.data;
}

/** Extract a required path parameter. */
export function requireParam(value: string | undefined, name: string): string {
  if (!value) {
    throw new AppError(ErrorCodes.VALIDATION_FAILED, `missing path parameter: ${name}`, 422, [
      { path: name, message: 'is required' },
    ]);
  }
  return value;
}

/** Standard response headers: request id, CSRF token echo, no-store. */
export function baseHeaders(requestId: string, csrfToken?: string): Record<string, string> {
  return {
    'x-request-id': requestId,
    'cache-control': 'no-store',
    ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
  };
}

/** Convert any thrown value into a stable, machine-readable response. */
export function toErrorResponse(error: unknown, requestId: string): HttpResponse {
  if (isAppError(error)) {
    return json(error.httpStatus, error.toJSON(), baseHeaders(requestId));
  }
  if (error instanceof ZodError) {
    return json(
      422,
      {
        error: {
          code: ErrorCodes.VALIDATION_FAILED,
          message: 'request validation failed',
          details: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        },
      },
      baseHeaders(requestId),
    );
  }
  return json(
    500,
    { error: { code: ErrorCodes.INTERNAL, message: 'internal error' } },
    baseHeaders(requestId),
  );
}

export { newRequestId };
