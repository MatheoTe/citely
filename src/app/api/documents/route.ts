import { after, connection } from "next/server";
import { getEnv, maxUploadBytes } from "@/server/config/env";
import { getIngestDeps, getUploadRateLimiter } from "@/server/context";
import { PayloadTooLargeError, RateLimitedError, ValidationError } from "@/server/errors";
import { clientKey } from "@/server/http/rate-limit";
import { withErrors } from "@/server/http/route";
import { parseOrThrow, uploadSchema } from "@/server/http/schemas";
import { enqueueDocument, processDocument } from "@/server/ingest/pipeline";
import { getProgress } from "@/server/ingest/progress";
import { countUploads, listDocuments } from "@/server/repositories";

// Ingestion runs in `after()`, which on Vercel keeps the function alive (waitUntil)
// within this same budget; the demo's 2 MB cap keeps it to a few seconds.
export const maxDuration = 60;

export const GET = withErrors(async () => {
  await connection(); // always read the live table, never a build-time snapshot
  const { db } = await getIngestDeps();
  const rows = await listDocuments(db);
  return Response.json({ documents: rows.map((d) => ({ ...d, progress: getProgress(d.id) })) });
});

/**
 * POST /api/documents (multipart, field "file").
 * Responds 202 as soon as the upload is stored; parsing, chunking and
 * embedding run after the response via `after()`. Clients poll the
 * document status. Identical bytes are deduplicated (200 + deduplicated).
 * In demo mode uploads are also rate limited per IP, capped in size
 * (DEMO_MAX_UPLOAD_MB) and in number, and wiped by the nightly reset.
 */
export const POST = withErrors(async (request: Request) => {
  const env = getEnv();
  if (env.DEMO_MODE) {
    const decision = getUploadRateLimiter().consume(clientKey(request.headers));
    if (!decision.allowed) throw new RateLimitedError(Math.ceil(decision.retryAfterMs / 1000));
  }
  const maxBytes = maxUploadBytes(env);
  const declared = Number(request.headers.get("content-length"));
  if (declared && declared > maxBytes + 64 * 1024) throw new PayloadTooLargeError(maxBytes);

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    throw new ValidationError("Expected a multipart/form-data body");
  }
  const { file } = parseOrThrow(uploadSchema, { file: form.get("file") });
  if (file.size === 0) throw new ValidationError("File is empty");
  if (file.size > maxBytes) throw new PayloadTooLargeError(maxBytes);

  const deps = await getIngestDeps();
  if (env.DEMO_MODE && (await countUploads(deps.db)) >= env.DEMO_MAX_UPLOADS) {
    throw new RateLimitedError(60 * 60, "The demo library is full for today; it resets nightly.");
  }
  const { document, deduplicated } = await enqueueDocument(deps.db, {
    filename: file.name,
    bytes: new Uint8Array(await file.arrayBuffer()),
  });

  if (!deduplicated) {
    after(async () => {
      await processDocument(deps, document.id);
    });
  }
  return Response.json({ document, deduplicated }, { status: deduplicated ? 200 : 202 });
});
