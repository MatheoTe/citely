import { connection } from "next/server";
import { getDb } from "@/server/db/client";
import { withErrors } from "@/server/http/route";
import { listTracesQuerySchema, parseOrThrow } from "@/server/http/schemas";
import { listTraces } from "@/server/repositories";

export const GET = withErrors(async (request: Request) => {
  await connection();
  const query = parseOrThrow(listTracesQuerySchema, Object.fromEntries(new URL(request.url).searchParams));
  return Response.json({ traces: await listTraces(await getDb(), query.limit) });
});
