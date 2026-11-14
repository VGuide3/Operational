import { handleApiRequest } from '../../../../lib/next-adapter';

/**
 * Catch-all Route Handler for /api/v1/*.
 *
 * Delegates to the framework-agnostic ApiRouter, which owns authentication,
 * authorization, CSRF, validation, idempotency, and audit logging.
 */

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

type Params = { params: Promise<{ path: string[] }> };

async function handle(request: Request, ctx: Params): Promise<Response> {
  const { path } = await ctx.params;
  return handleApiRequest(request, path ?? []);
}

export const GET = handle;
export const POST = handle;
export const DELETE = handle;
export const PATCH = handle;
export const PUT = handle;
