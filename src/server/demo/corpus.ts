import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { and, eq, ne, notExists, sql } from "drizzle-orm";
import { chunks, documents, embeddingCache, traces } from "../db/schema";
import { enqueueDocument, processDocument, type IngestDeps } from "../ingest/pipeline";

// Runtime path (traced into the reset function via outputFileTracingIncludes), not a bundler import.
export const SAMPLE_CORPUS_DIR = path.resolve(/* turbopackIgnore: true */ process.cwd(), "corpus");

export interface SeedRow {
  file: string;
  status: string;
  chunks: number;
  pages: number | string;
}

/**
 * Ingest the bundled sample corpus (corpus/*.md, corpus/*.pdf) as `sample`
 * documents. Idempotent: files already present (same sha256) are adopted as
 * samples and only (re)processed if they are not ready yet.
 */
export async function seedSampleCorpus(deps: IngestDeps, dir = SAMPLE_CORPUS_DIR): Promise<SeedRow[]> {
  const files = (await readdir(dir)).filter((f) => /\.(md|pdf)$/i.test(f)).sort();
  const rows: SeedRow[] = [];
  for (const filename of files) {
    const bytes = new Uint8Array(await readFile(path.join(/* turbopackIgnore: true */ dir, filename)));
    const { document, deduplicated } = await enqueueDocument(deps.db, { filename, bytes, origin: "sample" });
    if (deduplicated && document.origin !== "sample") {
      await deps.db.update(documents).set({ origin: "sample" }).where(eq(documents.id, document.id));
    }
    const result = document.status === "ready" ? document : ((await processDocument(deps, document.id)) ?? document);
    rows.push({
      file: filename,
      status: deduplicated && document.status === "ready" ? "ready (already present)" : result.status,
      chunks: result.chunkCount,
      pages: result.pageCount ?? "-",
    });
  }
  return rows;
}

export interface DemoResetResult {
  removedDocuments: number;
  removedTraces: number;
  prunedEmbeddings: number;
  seeded: SeedRow[];
}

/**
 * Return the public demo to its initial state: drop every visitor upload
 * (chunks and blobs cascade), clear the traces (they hold visitors' questions),
 * prune cached embeddings no chunk uses any more, then re-seed the sample corpus.
 */
export async function resetDemo(deps: IngestDeps, dir = SAMPLE_CORPUS_DIR): Promise<DemoResetResult> {
  const { db } = deps;
  const removed = await db.delete(documents).where(ne(documents.origin, "sample")).returning({ id: documents.id });
  const removedTraces = await db.delete(traces).returning({ id: traces.id });
  const pruned = await db
    .delete(embeddingCache)
    .where(
      notExists(
        db
          .select({ one: sql`1` })
          .from(chunks)
          .where(and(eq(chunks.contentHash, embeddingCache.contentHash), eq(chunks.embeddingModel, embeddingCache.model))),
      ),
    )
    .returning({ hash: embeddingCache.contentHash });
  const seeded = await seedSampleCorpus(deps, dir);
  return { removedDocuments: removed.length, removedTraces: removedTraces.length, prunedEmbeddings: pruned.length, seeded };
}
