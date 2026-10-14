/**
 * Ingest the bundled sample corpus (corpus/*.md, corpus/*.pdf).
 * Idempotent: files already present (same sha256) are skipped.
 */
import { getEnv } from "@/server/config/env";
import { createDb } from "@/server/db/client";
import { seedSampleCorpus } from "@/server/demo/corpus";
import { describeProviders, getProviders } from "@/server/providers";

async function main() {
  const env = getEnv();
  const handle = await createDb(env.DATABASE_URL);
  const providers = getProviders();
  console.log(`Seeding with embeddings=${describeProviders(providers).embeddings}\n`);
  try {
    const rows = await seedSampleCorpus({
      db: handle.db,
      embeddings: providers.embeddings,
      chunkOptions: { targetTokens: env.CITELY_CHUNK_TOKENS, overlapTokens: env.CITELY_CHUNK_OVERLAP },
    });
    console.table(rows);
    if (rows.some((r) => r.status.startsWith("failed"))) process.exitCode = 1;
  } finally {
    await handle.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
