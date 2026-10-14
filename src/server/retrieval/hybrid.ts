import { and, asc, cosineDistance, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { Db } from "../db/client";
import { chunks, documents } from "../db/schema";
import { embeddingInput } from "../ingest/chunker";
import type { EmbeddingProvider } from "../providers/embeddings/types";
import type { Reranker } from "../providers/rerank";
import { buildTsQuery } from "./fts-query";
import { reciprocalRankFusion } from "./rrf";

export type RetrievalMode = "hybrid" | "fts" | "vector";

export interface RetrievalOptions {
  /** Number of chunks returned. */
  k: number;
  mode?: RetrievalMode;
  /** Candidates pulled from each retriever before fusion. */
  candidates?: number;
  /** RRF damping constant. */
  rrfK?: number;
  /** Apply the reranker (if one is configured) to the fused candidates. */
  rerank?: boolean;
  documentIds?: string[];
  /** Progress callback for live pipeline visualisation (stage start / end with duration). */
  onStage?: (stage: RetrievalStage, status: "running" | "done" | "skipped", ms?: number) => void;
}

export type RetrievalStage = "fts" | "vector" | "fuse" | "rerank";

export interface RetrievedChunk {
  chunkId: string;
  documentId: string;
  documentTitle: string;
  filename: string;
  content: string;
  headingPath: string;
  pageStart: number | null;
  pageEnd: number | null;
  ftsRank: number | null;
  vectorRank: number | null;
  vectorSimilarity: number | null;
  fusedScore: number;
  rerankScore: number | null;
}

export interface RetrievalResult {
  chunks: RetrievedChunk[];
  timings: { embedMs: number; ftsMs: number; vectorMs: number; fuseMs: number; rerankMs: number };
  embedTokens: number;
  rerankTokens: number;
}

export interface RetrievalDeps {
  db: Db;
  embeddings: EmbeddingProvider;
  reranker?: Reranker | null;
}

const since = (start: number) => Math.round(performance.now() - start);

async function lexicalSearch(db: Db, query: string, limit: number, scope: SQL | undefined) {
  const tsQuery = buildTsQuery(query);
  if (!tsQuery) return [];
  const q = sql`to_tsquery('english', ${tsQuery})`;
  const score = sql<number>`ts_rank_cd(${chunks.tsv}, ${q}, 32)`;
  // ts_rank_cd ties are common for short queries; ts_rank (term frequency) breaks most of them.
  const tieBreak = sql<number>`ts_rank(${chunks.tsv}, ${q})`;
  return db
    .select({ id: chunks.id, score })
    .from(chunks)
    .innerJoin(documents, eq(documents.id, chunks.documentId))
    .where(and(sql`${chunks.tsv} @@ ${q}`, eq(documents.status, "ready"), scope))
    .orderBy(desc(score), desc(tieBreak), asc(chunks.id))
    .limit(limit);
}

async function vectorSearch(db: Db, vector: number[], model: string, limit: number, scope: SQL | undefined) {
  if (vector.every((v) => v === 0)) return [];
  const distance = cosineDistance(chunks.embedding, vector);
  return db
    .select({ id: chunks.id, similarity: sql<number>`1 - (${distance})` })
    .from(chunks)
    .innerJoin(documents, eq(documents.id, chunks.documentId))
    .where(and(eq(chunks.embeddingModel, model), eq(documents.status, "ready"), scope))
    .orderBy(distance, asc(chunks.id))
    .limit(limit);
}

/**
 * Hybrid retrieval: Postgres full-text search and pgvector similarity run
 * independently, then Reciprocal Rank Fusion merges the two rankings. An
 * optional cross-encoder reranker reorders the fused candidates.
 */
export async function retrieve(deps: RetrievalDeps, query: string, options: RetrievalOptions): Promise<RetrievalResult> {
  const { db, embeddings, reranker } = deps;
  const mode = options.mode ?? "hybrid";
  const candidates = Math.max(options.candidates ?? 30, options.k);
  const scope = options.documentIds?.length ? inArray(chunks.documentId, options.documentIds) : undefined;
  const timings = { embedMs: 0, ftsMs: 0, vectorMs: 0, fuseMs: 0, rerankMs: 0 };
  let embedTokens = 0;
  const onStage = options.onStage ?? (() => {});

  const runFts = async () => {
    if (mode === "vector") {
      onStage("fts", "skipped");
      return [];
    }
    onStage("fts", "running");
    const start = performance.now();
    const rows = await lexicalSearch(db, query, candidates, scope);
    timings.ftsMs = since(start);
    onStage("fts", "done", timings.ftsMs);
    return rows;
  };

  const runVector = async () => {
    if (mode === "fts") {
      onStage("vector", "skipped");
      return [];
    }
    onStage("vector", "running");
    let start = performance.now();
    const embedded = await embeddings.embedQuery(query);
    timings.embedMs = since(start);
    embedTokens = embedded.tokens;
    start = performance.now();
    const rows = await vectorSearch(db, embedded.vectors[0], embeddings.model, candidates, scope);
    timings.vectorMs = since(start);
    onStage("vector", "done", timings.embedMs + timings.vectorMs);
    return rows;
  };

  const [ftsRows, vectorRows] = await Promise.all([runFts(), runVector()]);

  onStage("fuse", "running");
  let start = performance.now();
  const fused = reciprocalRankFusion(
    [
      { name: "fts", ids: ftsRows.map((r) => r.id) },
      { name: "vector", ids: vectorRows.map((r) => r.id) },
    ],
    options.rrfK ?? 60,
  );
  timings.fuseMs = since(start);
  onStage("fuse", "done", timings.fuseMs);

  const useReranker = options.rerank !== false && !!reranker;
  const pool = fused.slice(0, useReranker ? Math.min(candidates, 20) : options.k);
  if (pool.length === 0) {
    onStage("rerank", "skipped");
    return { chunks: [], timings, embedTokens, rerankTokens: 0 };
  }

  const rows = await db
    .select({
      chunkId: chunks.id,
      documentId: chunks.documentId,
      documentTitle: documents.title,
      filename: documents.filename,
      content: chunks.content,
      headingPath: chunks.headingPath,
      pageStart: chunks.pageStart,
      pageEnd: chunks.pageEnd,
    })
    .from(chunks)
    .innerJoin(documents, eq(documents.id, chunks.documentId))
    .where(
      inArray(
        chunks.id,
        pool.map((p) => p.id),
      ),
    );
  const byId = new Map(rows.map((r) => [r.chunkId, r]));
  const similarity = new Map(vectorRows.map((r) => [r.id, Number(r.similarity)]));

  let results: RetrievedChunk[] = pool.flatMap((item) => {
    const row = byId.get(item.id);
    if (!row) return [];
    return [
      {
        ...row,
        ftsRank: item.ranks.fts,
        vectorRank: item.ranks.vector,
        vectorSimilarity: similarity.get(item.id) ?? null,
        fusedScore: item.score,
        rerankScore: null,
      },
    ];
  });

  let rerankTokens = 0;
  if (useReranker && reranker) {
    onStage("rerank", "running");
    start = performance.now();
    const reranked = await reranker.rerank(
      query,
      results.map((r) => embeddingInput(r.documentTitle, r)),
      options.k,
    );
    timings.rerankMs = since(start);
    rerankTokens = reranked.tokens;
    results = reranked.results.slice(0, options.k).map(({ index, score }) => ({ ...results[index], rerankScore: score }));
    onStage("rerank", "done", timings.rerankMs);
  } else {
    onStage("rerank", "skipped");
  }

  return { chunks: results.slice(0, options.k), timings, embedTokens, rerankTokens };
}
