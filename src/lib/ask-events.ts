/**
 * Wire protocol of POST /api/ask: newline-delimited JSON events.
 *
 *   meta → stage* → sources → stage* → delta* → done      (happy path)
 *   meta → … → error                    (failure at any stage)
 *
 * NDJSON instead of SSE keeps the client a plain fetch() + reader with no
 * EventSource limitations (POST bodies, custom headers).
 */
export interface SourceView {
  index: number;
  chunkId: string;
  documentId: string;
  documentTitle: string;
  filename: string;
  headingPath: string;
  pageStart: number | null;
  pageEnd: number | null;
  content: string;
  /** 1-based rank in each retriever (null = not found by it). */
  ftsRank: number | null;
  vectorRank: number | null;
  vectorSimilarity: number | null;
  fusedScore: number;
  rerankScore: number | null;
}

export type PipelineStage = "rewrite" | "fts" | "vector" | "fuse" | "rerank" | "generate";
export type StageStatus = "running" | "done" | "skipped";

export interface TraceSpanView {
  stage: PipelineStage;
  /** Offset from the start of the request. */
  startMs: number;
  durationMs: number;
}

export interface HistoryTurn {
  question: string;
  answer: string;
}

export interface ProviderModeView {
  llm: string;
  embeddings: string;
  reranker: string | null;
  offline: boolean;
}

export interface TimingsView {
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
  spans?: TraceSpanView[];
}

export type AskEvent =
  | { type: "meta"; traceId: string; mode: ProviderModeView }
  | { type: "stage"; stage: PipelineStage; status: StageStatus; ms?: number; detail?: string }
  | { type: "sources"; sources: SourceView[] }
  | { type: "delta"; text: string }
  | {
      type: "done";
      traceId: string;
      answer: string;
      answerable: boolean;
      citations: { index: number; chunkId: string }[];
      invalidCitations: number[];
      timings: TimingsView;
      costUsd: number | null;
    }
  | { type: "error"; error: { code: string; message: string } };
