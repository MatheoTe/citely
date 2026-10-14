import { after } from "next/server";
import { getEnv } from "@/server/config/env";
import { getIngestDeps } from "@/server/context";
import { PayloadTooLargeError, ValidationError } from "@/server/errors";
import { withErrors } from "@/server/http/route";
import { parseOrThrow, uploadSchema } from "@/server/http/schemas";
import { enqueueDocument, processDocument } from "@/server/ingest/pipeline";
import { listDocuments } from "@/server/repositories";

export const maxDuration = 60;

export const GET = withErrors(async () => {
  const { db } = await getIngestDeps();
  return Response.json({ documents: await listDocuments(db) });
});

/**
 * POST /api/documents (multipart, field "file").
 * Responds 202 as soon as the upload is stored; parsing, chunking and
 * embedding run after the response via `after()`. Clients poll the
 * document status. Identical bytes are deduplicated (200 + deduplicated).
 */
export const POST = withErrors(async (request: Request) => {
  const maxBytes = getEnv().CITELY_MAX_UPLOAD_MB * 1024 * 1024;
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
