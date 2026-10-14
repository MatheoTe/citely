/**
 * Fine-grained ingestion progress (parsing → chunking → embedding → indexing).
 *
 * The durable state machine is `documents.status`; this registry only adds
 * the in-flight sub-stage and per-stage durations so the UI can animate real
 * progress. It is process-local by design: it lives where `processDocument`
 * runs (the web process via `after()`), costs no writes, and losing it on a
 * restart loses nothing but the animation.
 */
export type IngestStage = "parsing" | "chunking" | "embedding" | "indexing";

export interface IngestProgress {
  stage: IngestStage | "done";
  durations: Partial<Record<IngestStage, number>>;
  /** Embedding cache hits / total chunks, once known. */
  cacheHits?: number;
  chunks?: number;
  updatedAt: number;
}

const MAX_ENTRIES = 500;
const store = globalThis as unknown as { __citelyIngestProgress?: Map<string, IngestProgress> };
const registry = (store.__citelyIngestProgress ??= new Map());

export function trackStage(documentId: string): {
  stage: (stage: IngestStage) => void;
  done: (extra?: Pick<IngestProgress, "cacheHits" | "chunks">) => void;
} {
  let current: IngestStage | null = null;
  let startedAt = performance.now();
  const entry: IngestProgress = { stage: "parsing", durations: {}, updatedAt: Date.now() };
  registry.delete(documentId);
  registry.set(documentId, entry);
  if (registry.size > MAX_ENTRIES) registry.delete(registry.keys().next().value!);

  const close = () => {
    if (current) entry.durations[current] = Math.round(performance.now() - startedAt);
  };
  return {
    stage(next) {
      close();
      current = next;
      startedAt = performance.now();
      entry.stage = next;
      entry.updatedAt = Date.now();
    },
    done(extra) {
      close();
      current = null;
      Object.assign(entry, extra, { stage: "done", updatedAt: Date.now() });
    },
  };
}

export function getProgress(documentId: string): IngestProgress | null {
  return registry.get(documentId) ?? null;
}
