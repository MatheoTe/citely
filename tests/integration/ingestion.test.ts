import { readFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { DbHandle } from "@/server/db/client";
import { chunks, documents, embeddingCache } from "@/server/db/schema";
import { UnsupportedFileError } from "@/server/errors";
import { enqueueDocument, processDocument, processPending, requeueStaleDocuments } from "@/server/ingest/pipeline";
import { LocalHashEmbeddingProvider } from "@/server/providers/embeddings/local-hash";
import { getProgress } from "@/server/ingest/progress";
import { deleteDocument, getCorpusStats } from "@/server/repositories";
import { CORPUS_DIR, createTestDb, resetDb, testIngestDeps } from "./helpers";

let handle: DbHandle;
const corpusFile = async (name: string) => new Uint8Array(await readFile(path.join(CORPUS_DIR, name)));

beforeAll(async () => {
  handle = await createTestDb();
});
afterAll(async () => {
  await handle.close();
});
beforeEach(async () => {
  await resetDb(handle);
});

describe("ingestion pipeline", () => {
  it("moves a markdown document from queued to ready with heading-aware chunks", async () => {
    const deps = testIngestDeps(handle);
    const { document, deduplicated } = await enqueueDocument(handle.db, {
      filename: "relay-api-reference.md",
      bytes: await corpusFile("relay-api-reference.md"),
    });
    expect(deduplicated).toBe(false);
    expect(document.status).toBe("queued");

    const ready = await processDocument(deps, document.id);
    expect(ready).toMatchObject({ status: "ready", title: "Kestrel Relay API Reference", embeddingModel: "local-hash-v1@1024" });
    expect(ready!.chunkCount).toBeGreaterThan(5);

    const rows = await handle.db.select().from(chunks).where(eq(chunks.documentId, document.id)).orderBy(chunks.ordinal);
    expect(rows).toHaveLength(ready!.chunkCount);
    expect(rows.map((r) => r.ordinal)).toEqual(rows.map((_, i) => i));
    const retries = rows.find((r) => r.content.includes("dead-letter queue"));
    expect(retries?.headingPath).toBe("Kestrel Relay API Reference > Delivery and retries");
    expect(rows[0].embedding).toHaveLength(1024);

    expect(getProgress(document.id)).toMatchObject({ stage: "done", chunks: ready!.chunkCount, cacheHits: 0 });
    expect(Object.keys(getProgress(document.id)!.durations)).toEqual(["parsing", "chunking", "embedding", "indexing"]);
    expect(await getCorpusStats(handle.db)).toMatchObject({ documents: 1, readyDocuments: 1, chunks: ready!.chunkCount, pages: 0 });
    expect((await getCorpusStats(handle.db)).lastIndexedAt).toBeInstanceOf(Date);
  });

  it("extracts page numbers from PDFs", async () => {
    const deps = testIngestDeps(handle);
    const { document } = await enqueueDocument(handle.db, {
      filename: "onboarding-guide.pdf",
      bytes: await corpusFile("onboarding-guide.pdf"),
    });
    const ready = await processDocument(deps, document.id);
    expect(ready).toMatchObject({ status: "ready", pageCount: 4, sourceType: "pdf" });
    const rows = await handle.db.select().from(chunks).where(eq(chunks.documentId, document.id));
    const kite = rows.find((r) => r.content.includes("Kite"));
    expect(kite).toMatchObject({ pageStart: 3, pageEnd: 3, headingPath: "Engineering Onboarding Guide > 3. Weeks two to four" });
  });

  it("deduplicates identical uploads by content hash", async () => {
    const bytes = await corpusFile("pricing-and-plans.md");
    const first = await enqueueDocument(handle.db, { filename: "pricing.md", bytes });
    const second = await enqueueDocument(handle.db, { filename: "pricing-copy.md", bytes });
    expect(second).toEqual({ document: first.document, deduplicated: true });
    expect(await handle.db.$count(documents)).toBe(1);
  });

  it("never processes the same document twice concurrently", async () => {
    const deps = testIngestDeps(handle);
    const { document } = await enqueueDocument(handle.db, {
      filename: "pricing-and-plans.md",
      bytes: await corpusFile("pricing-and-plans.md"),
    });
    const results = await Promise.all([processDocument(deps, document.id), processDocument(deps, document.id)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    // a ready document is not re-claimed
    expect(await processDocument(deps, document.id)).toBeNull();
  });

  it("reuses cached embeddings when a document is re-indexed", async () => {
    const embeddings = new LocalHashEmbeddingProvider(1024);
    const spy = vi.spyOn(embeddings, "embedDocuments");
    const deps = testIngestDeps(handle, { embeddings });
    const { document } = await enqueueDocument(handle.db, {
      filename: "employee-handbook.md",
      bytes: await corpusFile("employee-handbook.md"),
    });
    const first = await processDocument(deps, document.id);
    const embeddedTexts = spy.mock.calls[0][0].length;
    expect(embeddedTexts).toBe(first!.chunkCount);
    expect(await handle.db.$count(embeddingCache)).toBe(first!.chunkCount);

    // pretend the active model changed, then come back: every vector is a cache hit
    expect(await requeueStaleDocuments(handle.db, "some-other-model")).toBe(1);
    const [second] = await processPending(deps);
    expect(second.status).toBe("ready");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(await handle.db.$count(chunks)).toBe(first!.chunkCount);
  });

  it("marks unreadable documents as failed with a reason", async () => {
    const deps = testIngestDeps(handle);
    const { document } = await enqueueDocument(handle.db, {
      filename: "broken.pdf",
      bytes: new TextEncoder().encode("%PDF-1.7\nthis is not really a pdf"),
    });
    const failed = await processDocument(deps, document.id);
    expect(failed).toMatchObject({ status: "failed", chunkCount: 0 });
    expect(failed!.error).toMatch(/Could not read the PDF/);
  });

  it("rejects unsupported uploads before storing anything", async () => {
    await expect(
      enqueueDocument(handle.db, { filename: "photo.png", bytes: new Uint8Array([1, 2, 3]) }),
    ).rejects.toBeInstanceOf(UnsupportedFileError);
    expect(await handle.db.$count(documents)).toBe(0);
  });

  it("cascades chunk deletion when a document is deleted", async () => {
    const deps = testIngestDeps(handle);
    const { document } = await enqueueDocument(handle.db, {
      filename: "pricing-and-plans.md",
      bytes: await corpusFile("pricing-and-plans.md"),
    });
    await processDocument(deps, document.id);
    await deleteDocument(handle.db, document.id);
    expect(await handle.db.$count(chunks)).toBe(0);
  });
});
