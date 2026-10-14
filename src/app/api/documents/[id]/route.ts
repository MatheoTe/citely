import { getEnv } from "@/server/config/env";
import { getDb } from "@/server/db/client";
import { withErrors } from "@/server/http/route";
import { idParamSchema, parseOrThrow } from "@/server/http/schemas";
import { deleteDocument, getDocumentWithChunks } from "@/server/repositories";

export const GET = withErrors(async (_request: Request, ctx: RouteContext<"/api/documents/[id]">) => {
  const { id } = parseOrThrow(idParamSchema, await ctx.params);
  return Response.json({ document: await getDocumentWithChunks(await getDb(), id) });
});

export const DELETE = withErrors(async (_request: Request, ctx: RouteContext<"/api/documents/[id]">) => {
  const { id } = parseOrThrow(idParamSchema, await ctx.params);
  // In the public demo visitors can remove their own uploads but not the sample corpus.
  await deleteDocument(await getDb(), id, { keepSamples: getEnv().DEMO_MODE });
  return new Response(null, { status: 204 });
});
