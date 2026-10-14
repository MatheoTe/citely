import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { sql } from "drizzle-orm";
import { createDb, type DbHandle } from "@/server/db/client";
import { runMigrations } from "@/server/db/migrate";
import { type IngestDeps, enqueueDocument, processDocument } from "@/server/ingest/pipeline";
import { LocalHashEmbeddingProvider } from "@/server/providers/embeddings/local-hash";

/**
 * Integration tests run against real Postgres when TEST_DATABASE_URL is set
 * (CI uses a pgvector service container; locally `docker compose up -d`),
 * and against embedded PGlite + pgvector otherwise. Same migrations, same SQL.
 */
export async function createTestDb(): Promise<DbHandle> {
  const url = process.env.TEST_DATABASE_URL ?? "pglite://memory";
  const handle = await createDb(url);
  await runMigrations(handle);
  await resetDb(handle);
  return handle;
}

export async function resetDb(handle: DbHandle): Promise<void> {
  await handle.db.execute(sql`TRUNCATE traces, embedding_cache, chunks, document_blobs, documents CASCADE`);
}

export function testIngestDeps(handle: DbHandle, overrides: Partial<IngestDeps> = {}): IngestDeps {
  return {
    db: handle.db,
    embeddings: new LocalHashEmbeddingProvider(1024),
    chunkOptions: { targetTokens: 256, overlapTokens: 48 },
    ...overrides,
  };
}

export const CORPUS_DIR = path.resolve("corpus");

export async function ingestCorpus(deps: IngestDeps): Promise<void> {
  const files = (await readdir(CORPUS_DIR)).filter((f) => /\.(md|pdf)$/.test(f)).sort();
  for (const filename of files) {
    const bytes = new Uint8Array(await readFile(path.join(CORPUS_DIR, filename)));
    const { document } = await enqueueDocument(deps.db, { filename, bytes });
    await processDocument(deps, document.id);
  }
}
