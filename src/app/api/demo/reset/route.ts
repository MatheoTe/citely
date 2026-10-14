import { getEnv } from "@/server/config/env";
import { getIngestDeps } from "@/server/context";
import { isResetAuthorized } from "@/server/demo/auth";
import { resetDemo } from "@/server/demo/corpus";
import { NotFoundError, UnauthorizedError } from "@/server/errors";
import { withErrors } from "@/server/http/route";

// Re-seeding re-uses cached embeddings, so this takes seconds; the headroom covers a cold start.
export const maxDuration = 120;

/**
 * POST /api/demo/reset (header `x-demo-reset-token: $DEMO_RESET_TOKEN`) and
 * GET for Vercel Cron (`Authorization: Bearer $CRON_SECRET`, see vercel.json).
 * Only exists in demo mode.
 */
const handler = withErrors(async (request: Request) => {
  const env = getEnv();
  if (!env.DEMO_MODE) throw new NotFoundError("Route", "/api/demo/reset");
  if (!isResetAuthorized(request.headers, env)) throw new UnauthorizedError();
  const result = await resetDemo(await getIngestDeps());
  return Response.json({ ok: true, ...result }, { headers: { "cache-control": "no-store" } });
});

export const GET = handler;
export const POST = handler;
