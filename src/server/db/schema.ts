import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  vector,
} from "drizzle-orm/pg-core";

/**
 * Every embedding provider is projected to the same width so a single column
 * (and a single HNSW index) serves them all. Rows remember which model produced
 * them, and retrieval only compares vectors from the active model.
 */
export const EMBEDDING_DIMENSIONS = 1024;

const tsvector = customType<{ data: string }>({
  dataType: () => "tsvector",
});

const bytea = customType<{ data: Buffer; driverData: Buffer | Uint8Array }>({
  dataType: () => "bytea",
  fromDriver: (value) => (Buffer.isBuffer(value) ? value : Buffer.from(value)),
});

export const documentStatus = pgEnum("document_status", ["queued", "processing", "ready", "failed"]);
export const sourceType = pgEnum("source_type", ["pdf", "markdown"]);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    title: text("title").notNull(),
    filename: text("filename").notNull(),
    sourceType: sourceType("source_type").notNull(),
    /** sha256 of the raw upload — re-uploading identical bytes is a no-op. */
    contentHash: text("content_hash").notNull(),
    byteSize: integer("byte_size").notNull(),
    pageCount: integer("page_count"),
    status: documentStatus("status").notNull().default("queued"),
    error: text("error"),
    chunkCount: integer("chunk_count").notNull().default(0),
    embeddingModel: text("embedding_model"),
    attempts: integer("attempts").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
    processedAt: timestamp("processed_at", { withTimezone: true }),
  },
  (t) => [
    uniqueIndex("documents_content_hash_key").on(t.contentHash),
    index("documents_status_idx").on(t.status),
  ],
);

/** Raw upload bytes, kept apart so listing documents never drags blobs along. */
export const documentBlobs = pgTable("document_blobs", {
  documentId: uuid("document_id")
    .primaryKey()
    .references(() => documents.id, { onDelete: "cascade" }),
  data: bytea("data").notNull(),
});

export const chunks = pgTable(
  "chunks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentId: uuid("document_id")
      .notNull()
      .references(() => documents.id, { onDelete: "cascade" }),
    ordinal: integer("ordinal").notNull(),
    content: text("content").notNull(),
    headingPath: text("heading_path").notNull().default(""),
    pageStart: integer("page_start"),
    pageEnd: integer("page_end"),
    tokenCount: integer("token_count").notNull(),
    contentHash: text("content_hash").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    embeddingModel: text("embedding_model").notNull(),
    /** Headings weigh more than body text in lexical ranking. */
    tsv: tsvector("tsv")
      .notNull()
      .generatedAlwaysAs(
        sql`setweight(to_tsvector('english', coalesce(heading_path, '')), 'A') || setweight(to_tsvector('english', content), 'B')`,
      ),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("chunks_document_ordinal_key").on(t.documentId, t.ordinal),
    index("chunks_tsv_idx").using("gin", t.tsv),
    index("chunks_embedding_hnsw_idx").using("hnsw", t.embedding.op("vector_cosine_ops")),
    index("chunks_embedding_model_idx").on(t.embeddingModel),
  ],
);

/**
 * Content-addressed embedding cache: re-chunking or re-uploading a document
 * only pays for chunks whose text actually changed.
 */
export const embeddingCache = pgTable(
  "embedding_cache",
  {
    contentHash: text("content_hash").notNull(),
    model: text("model").notNull(),
    embedding: vector("embedding", { dimensions: EMBEDDING_DIMENSIONS }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.contentHash, t.model] })],
);

export interface TraceTimings {
  rewriteMs: number;
  embedMs: number;
  ftsMs: number;
  vectorMs: number;
  fuseMs: number;
  rerankMs: number;
  retrievalMs: number;
  ttftMs: number | null;
  generationMs: number;
  totalMs: number;
}

export interface TraceRetrievalEntry {
  chunkId: string;
  documentId: string;
  ftsRank: number | null;
  vectorRank: number | null;
  fusedScore: number;
  rerankScore: number | null;
}

export interface TraceUsageEntry {
  step: "rewrite" | "embed" | "rerank" | "answer";
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  costUsd: number | null;
}

export interface TraceCitation {
  index: number;
  chunkId: string;
}

export const traces = pgTable(
  "traces",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    question: text("question").notNull(),
    rewrittenQuery: text("rewritten_query"),
    answer: text("answer"),
    answerable: boolean("answerable"),
    status: text("status", { enum: ["ok", "error"] }).notNull(),
    error: text("error"),
    llmProvider: text("llm_provider").notNull(),
    llmModel: text("llm_model"),
    embeddingModel: text("embedding_model").notNull(),
    reranker: text("reranker"),
    timings: jsonb("timings").$type<TraceTimings>().notNull(),
    retrieval: jsonb("retrieval").$type<TraceRetrievalEntry[]>().notNull(),
    citations: jsonb("citations").$type<TraceCitation[]>().notNull(),
    usage: jsonb("usage").$type<TraceUsageEntry[]>().notNull(),
    costUsd: numeric("cost_usd", { precision: 12, scale: 6, mode: "number" }),
    totalMs: integer("total_ms").notNull(),
  },
  (t) => [index("traces_created_at_idx").on(t.createdAt.desc())],
);

export type DocumentRow = typeof documents.$inferSelect;
export type ChunkRow = typeof chunks.$inferSelect;
export type TraceRow = typeof traces.$inferSelect;
export type NewTrace = typeof traces.$inferInsert;
