import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "@/server/db/client";
import { LocalHashEmbeddingProvider } from "@/server/providers/embeddings/local-hash";
import type { Reranker } from "@/server/providers/rerank";
import { retrieve } from "@/server/retrieval/hybrid";
import { createTestDb, ingestCorpus, testIngestDeps } from "./helpers";

let handle: DbHandle;
const embeddings = new LocalHashEmbeddingProvider(1024);

beforeAll(async () => {
  handle = await createTestDb();
  await ingestCorpus(testIngestDeps(handle, { embeddings }));
});
afterAll(async () => {
  await handle.close();
});

describe("hybrid retrieval over the sample corpus", () => {
  it("finds an exact identifier through full-text search", async () => {
    const res = await retrieve({ db: handle.db, embeddings }, "What does error KR-4291 mean?", { k: 5, mode: "fts" });
    expect(res.chunks[0].content).toContain("KR-4291");
    expect(res.chunks[0].ftsRank).toBe(1);
    expect(res.chunks[0].vectorRank).toBeNull();
  });

  it("fuses both retrievers and reports per-retriever ranks", async () => {
    const res = await retrieve({ db: handle.db, embeddings }, "How many times is a failed webhook delivery retried?", { k: 5 });
    expect(res.chunks).toHaveLength(5);
    const top = res.chunks[0];
    expect(top.content).toContain("at most 8 times");
    expect(top.ftsRank).not.toBeNull();
    expect(top.vectorRank).not.toBeNull();
    expect(top.vectorSimilarity).toBeGreaterThan(0);
    // fused scores are non-increasing
    const scores = res.chunks.map((c) => c.fusedScore);
    expect([...scores].sort((a, b) => b - a)).toEqual(scores);
  });

  it("vector-only retrieval works without lexical overlap on stopwords", async () => {
    const res = await retrieve({ db: handle.db, embeddings }, "parental leave weeks", { k: 3, mode: "vector" });
    expect(res.chunks[0].content).toContain("20 weeks");
    expect(res.chunks.every((c) => c.ftsRank === null)).toBe(true);
  });

  it("can be scoped to specific documents", async () => {
    const all = await retrieve({ db: handle.db, embeddings }, "retention days", { k: 10 });
    const target = all.chunks.find((c) => c.documentTitle === "Security and Data Retention Policy")!.documentId;
    const scoped = await retrieve({ db: handle.db, embeddings }, "retention days", { k: 10, documentIds: [target] });
    expect(scoped.chunks.length).toBeGreaterThan(0);
    expect(scoped.chunks.every((c) => c.documentId === target)).toBe(true);
  });

  it("applies a reranker to the fused candidates", async () => {
    const reverse: Reranker = {
      model: "reverse-test",
      async rerank(_q, docs, topK) {
        return { results: docs.map((_, i) => ({ index: docs.length - 1 - i, score: i })).slice(0, topK).map((r, i) => ({ index: r.index, score: 1 - i / 10 })), tokens: 7 };
      },
    };
    const plain = await retrieve({ db: handle.db, embeddings }, "signing secret roll", { k: 3, rerank: false });
    const reranked = await retrieve({ db: handle.db, embeddings, reranker: reverse }, "signing secret roll", { k: 3 });
    expect(reranked.rerankTokens).toBe(7);
    expect(reranked.chunks).toHaveLength(3);
    expect(reranked.chunks[0].rerankScore).toBe(1);
    expect(reranked.chunks[0].chunkId).not.toBe(plain.chunks[0].chunkId);
  });

  it("returns nothing for a query with no searchable terms", async () => {
    const res = await retrieve({ db: handle.db, embeddings }, "what is the", { k: 5 });
    expect(res.chunks).toEqual([]);
  });
});
