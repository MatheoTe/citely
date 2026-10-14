/**
 * Recovery / re-index worker.
 *   npm run ingest:pending              process queued (and abandoned) documents
 *   npm run ingest:pending -- --reindex also re-embed documents indexed with another embedding model
 */
import { getEnv } from "@/server/config/env";
import { createDb } from "@/server/db/client";
import { processPending, requeueStaleDocuments } from "@/server/ingest/pipeline";
import { getProviders } from "@/server/providers";

async function main() {
  const env = getEnv();
  const handle = await createDb(env.DATABASE_URL);
  const { embeddings } = getProviders();
  try {
    if (process.argv.includes("--reindex")) {
      const n = await requeueStaleDocuments(handle.db, embeddings.model);
      console.log(`requeued ${n} document(s) not indexed with ${embeddings.model}`);
    }
    const processed = await processPending({
      db: handle.db,
      embeddings,
      chunkOptions: { targetTokens: env.CITELY_CHUNK_TOKENS, overlapTokens: env.CITELY_CHUNK_OVERLAP },
    });
    for (const doc of processed) console.log(`${doc.status.padEnd(7)} ${doc.filename}${doc.error ? ` — ${doc.error}` : ""}`);
    console.log(`processed ${processed.length} document(s)`);
  } finally {
    await handle.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
