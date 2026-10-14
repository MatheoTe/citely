import { and, eq, inArray, lt, or, sql } from "drizzle-orm";
import type { Db } from "../db/client";
import { chunks, documentBlobs, documents, embeddingCache, type DocumentRow } from "../db/schema";
import { IngestionError, errorMessage } from "../errors";
import type { EmbeddingProvider } from "../providers/embeddings/types";
import { chunkBlocks, embeddingInput } from "./chunker";
import { detectSourceType, parseDocument, titleFromFilename, type SourceType } from "./parse";
import { sha256 } from "./text";
import type { ChunkOptions } from "./types";

const PROCESSING_LEASE_MS = 10 * 60 * 1000;

export interface IngestDeps {
  db: Db;
  embeddings: EmbeddingProvider;
  chunkOptions: ChunkOptions;
}

export interface EnqueueResult {
  document: DocumentRow;
  /** True when identical bytes were uploaded before; nothing new was stored. */
  deduplicated: boolean;
}

/**
 * Step 1 — accept an upload. Content-addressed: the sha256 of the bytes is a
 * unique key, so uploading the same file twice (or two concurrent uploads of
 * it) yields one document. Returns immediately with status "queued"; the
 * expensive work happens in `processDocument`.
 */
export async function enqueueDocument(db: Db, file: { filename: string; bytes: Uint8Array }): Promise<EnqueueResult> {
  const sourceType: SourceType = detectSourceType(file.filename, file.bytes);
  const contentHash = sha256(file.bytes);

  const existing = await db.query.documents.findFirst({ where: eq(documents.contentHash, contentHash) });
  if (existing) return { document: existing, deduplicated: true };

  const inserted = await db.transaction(async (tx) => {
    const [doc] = await tx
      .insert(documents)
      .values({
        title: titleFromFilename(file.filename),
        filename: file.filename,
        sourceType,
        contentHash,
        byteSize: file.bytes.byteLength,
      })
      .onConflictDoNothing({ target: documents.contentHash })
      .returning();
    if (doc) await tx.insert(documentBlobs).values({ documentId: doc.id, data: Buffer.from(file.bytes) });
    return doc;
  });

  if (inserted) return { document: inserted, deduplicated: false };
  // Lost a race with a concurrent upload of the same bytes.
  const winner = await db.query.documents.findFirst({ where: eq(documents.contentHash, contentHash) });
  if (!winner) throw new IngestionError("Upload conflicted with a concurrent request; retry");
  return { document: winner, deduplicated: true };
}

/** Embed texts, reusing vectors already computed for identical inputs with the same model. */
export async function embedWithCache(
  db: Db,
  embeddings: EmbeddingProvider,
  inputs: { hash: string; text: string }[],
): Promise<{ vectors: number[][]; cacheHits: number; tokens: number }> {
  const uniqueHashes = [...new Set(inputs.map((i) => i.hash))];
  const cached = new Map<string, number[]>();
  for (let i = 0; i < uniqueHashes.length; i += 500) {
    const rows = await db
      .select({ hash: embeddingCache.contentHash, embedding: embeddingCache.embedding })
      .from(embeddingCache)
      .where(and(eq(embeddingCache.model, embeddings.model), inArray(embeddingCache.contentHash, uniqueHashes.slice(i, i + 500))));
    for (const r of rows) cached.set(r.hash, r.embedding);
  }

  const missing = uniqueHashes
    .filter((h) => !cached.has(h))
    .map((h) => inputs.find((i) => i.hash === h)!);
  let tokens = 0;
  if (missing.length) {
    const batch = await embeddings.embedDocuments(missing.map((m) => m.text));
    tokens = batch.tokens;
    const fresh = missing.map((m, i) => ({ contentHash: m.hash, model: embeddings.model, embedding: batch.vectors[i] }));
    for (const f of fresh) cached.set(f.contentHash, f.embedding);
    for (let i = 0; i < fresh.length; i += 200) {
      await db.insert(embeddingCache).values(fresh.slice(i, i + 200)).onConflictDoNothing();
    }
  }

  const cacheHits = inputs.length - missing.length;
  return { vectors: inputs.map((i) => cached.get(i.hash)!), cacheHits, tokens };
}

/**
 * Step 2 — parse, chunk, embed and index one document.
 *
 * The status transition queued|failed → processing is a compare-and-set, so
 * two workers (an `after()` callback and the `ingest:pending` script, say)
 * can never process the same document concurrently. A "processing" row whose
 * lease expired is considered abandoned and can be claimed again. Chunks are swapped in a
 * single transaction: readers see either the old index or the new one.
 */
export async function processDocument(deps: IngestDeps, documentId: string): Promise<DocumentRow | null> {
  const { db, embeddings, chunkOptions } = deps;
  const [claimed] = await db
    .update(documents)
    .set({ status: "processing", attempts: sql`${documents.attempts} + 1`, updatedAt: new Date(), error: null })
    .where(
      and(
        eq(documents.id, documentId),
        or(
          inArray(documents.status, ["queued", "failed"]),
          // a worker that died mid-flight leaves "processing" behind; reclaim it after a lease timeout
          and(eq(documents.status, "processing"), lt(documents.updatedAt, new Date(Date.now() - PROCESSING_LEASE_MS))),
        ),
      ),
    )
    .returning();
  if (!claimed) return null;

  try {
    const blob = await db.query.documentBlobs.findFirst({ where: eq(documentBlobs.documentId, documentId) });
    if (!blob) throw new IngestionError("Original upload is missing");

    const parsed = await parseDocument(claimed.sourceType, new Uint8Array(blob.data), claimed.filename);
    const drafts = chunkBlocks(parsed.blocks, chunkOptions);
    if (drafts.length === 0) throw new IngestionError("Document contains no indexable text");

    const inputs = drafts.map((d) => {
      const text = embeddingInput(parsed.title, d);
      return { text, hash: sha256(text) };
    });
    const { vectors } = await embedWithCache(db, embeddings, inputs);

    const rows = drafts.map((d, i) => ({
      documentId,
      ordinal: d.ordinal,
      content: d.content,
      headingPath: d.headingPath,
      pageStart: d.pageStart,
      pageEnd: d.pageEnd,
      tokenCount: d.tokenCount,
      contentHash: inputs[i].hash,
      embedding: vectors[i],
      embeddingModel: embeddings.model,
    }));

    const [ready] = await db.transaction(async (tx) => {
      await tx.delete(chunks).where(eq(chunks.documentId, documentId));
      for (let i = 0; i < rows.length; i += 100) await tx.insert(chunks).values(rows.slice(i, i + 100));
      return tx
        .update(documents)
        .set({
          status: "ready",
          title: parsed.title,
          pageCount: parsed.pageCount,
          chunkCount: rows.length,
          embeddingModel: embeddings.model,
          error: null,
          processedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(documents.id, documentId))
        .returning();
    });
    return ready;
  } catch (err) {
    const [failed] = await db
      .update(documents)
      .set({ status: "failed", error: errorMessage(err).slice(0, 500), updatedAt: new Date() })
      .where(eq(documents.id, documentId))
      .returning();
    if (!(err instanceof IngestionError)) console.error(`[citely] ingestion of ${documentId} failed`, err);
    return failed;
  }
}

/** Mark ready documents indexed with a different embedding model for reprocessing. */
export async function requeueStaleDocuments(db: Db, currentModel: string): Promise<number> {
  const rows = await db
    .update(documents)
    .set({ status: "queued", updatedAt: new Date() })
    .where(and(eq(documents.status, "ready"), sql`${documents.embeddingModel} is distinct from ${currentModel}`))
    .returning({ id: documents.id });
  return rows.length;
}

/** Process every queued document; used by the seed script and crash recovery. */
export async function processPending(deps: IngestDeps): Promise<DocumentRow[]> {
  const queued = await deps.db
    .select({ id: documents.id })
    .from(documents)
    .where(eq(documents.status, "queued"))
    .orderBy(documents.createdAt);
  const results: DocumentRow[] = [];
  for (const { id } of queued) {
    const row = await processDocument(deps, id);
    if (row) results.push(row);
  }
  return results;
}
