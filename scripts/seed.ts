/**
 * Ingest the bundled sample corpus (corpus/*.md, corpus/*.pdf).
 * Idempotent: files already present (same sha256) are skipped.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { getEnv } from "@/server/config/env";
import { createDb } from "@/server/db/client";
import { enqueueDocument, processDocument } from "@/server/ingest/pipeline";
import { describeProviders, getProviders } from "@/server/providers";

async function main() {
  const env = getEnv();
  const handle = await createDb(env.DATABASE_URL);
  const providers = getProviders();
  const deps = {
    db: handle.db,
    embeddings: providers.embeddings,
    chunkOptions: { targetTokens: env.CITELY_CHUNK_TOKENS, overlapTokens: env.CITELY_CHUNK_OVERLAP },
  };
  console.log(`Seeding with embeddings=${describeProviders(providers).embeddings}\n`);

  const dir = path.resolve("corpus");
  const files = (await readdir(dir)).filter((f) => /\.(md|pdf)$/i.test(f)).sort();
  const rows: Record<string, string | number>[] = [];
  try {
    for (const filename of files) {
      const bytes = new Uint8Array(await readFile(path.join(dir, filename)));
      const { document, deduplicated } = await enqueueDocument(handle.db, { filename, bytes });
      const result = deduplicated ? document : await processDocument(deps, document.id);
      rows.push({
        file: filename,
        status: deduplicated ? `${document.status} (already present)` : (result?.status ?? "skipped"),
        chunks: result?.chunkCount ?? 0,
        pages: result?.pageCount ?? "-",
      });
    }
  } finally {
    await handle.close();
  }
  console.table(rows);
  if (rows.some((r) => String(r.status).startsWith("failed"))) process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
