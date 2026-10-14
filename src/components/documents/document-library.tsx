"use client";

import Link from "next/link";
import { ArrowRight, FileText, FileType2, Trash2, UploadCloud } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useCallback, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn, formatBytes } from "@/lib/utils";
import { INGEST_STEPS, IngestionSteps } from "./ingestion-steps";
import { StatusBadge } from "./status-badge";

export interface IngestProgressView {
  stage: "parsing" | "chunking" | "embedding" | "indexing" | "done";
  durations: Partial<Record<"parsing" | "chunking" | "embedding" | "indexing", number>>;
  cacheHits?: number;
  chunks?: number;
}

export interface DocumentItem {
  id: string;
  title: string;
  filename: string;
  sourceType: "pdf" | "markdown";
  byteSize: number;
  pageCount: number | null;
  status: "queued" | "processing" | "ready" | "failed";
  error: string | null;
  chunkCount: number;
  embeddingModel: string | null;
  createdAt: string;
  progress?: IngestProgressView | null;
}

const ACCEPT = ".pdf,.md,.markdown,.txt";
const STEP_DWELL_MS = 420;

/** Index of the furthest step the server says this document has reached. */
function realStep(doc: DocumentItem): number {
  if (doc.status === "ready") return 4;
  if (doc.status === "queued") return 0;
  if (doc.status === "failed") return Math.max(1, ["parsing", "chunking", "embedding", "indexing"].indexOf(doc.progress?.stage ?? "parsing") + 1);
  const stage = doc.progress?.stage ?? "parsing";
  return { parsing: 1, chunking: 2, embedding: 3, indexing: 3, done: 4 }[stage];
}

export function DocumentLibrary({ initialDocuments }: { initialDocuments: DocumentItem[] }) {
  const [documents, setDocuments] = useState<DocumentItem[]>(initialDocuments);
  // Steps shown on screen advance one at a time so fast ingestions still read as a pipeline.
  const [shown, setShown] = useState<Record<string, number>>(() =>
    Object.fromEntries(initialDocuments.map((d) => [d.id, realStep(d)])),
  );
  const [notice, setNotice] = useState<{ kind: "error" | "info"; text: string } | null>(null);
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    const res = await fetch("/api/documents", { cache: "no-store" });
    if (res.ok) setDocuments(((await res.json()) as { documents: DocumentItem[] }).documents);
  }, []);

  const pending = documents.some((d) => d.status === "queued" || d.status === "processing");
  const animating = documents.some((d) => (shown[d.id] ?? 0) < realStep(d));

  useEffect(() => {
    if (!pending) return;
    const timer = setInterval(() => void refresh(), 600);
    return () => clearInterval(timer);
  }, [pending, refresh]);

  useEffect(() => {
    if (!animating) return;
    const timer = setInterval(() => {
      setShown((prev) => {
        const next = { ...prev };
        for (const d of documents) next[d.id] = Math.min(realStep(d), (prev[d.id] ?? 0) + 1);
        return next;
      });
    }, STEP_DWELL_MS);
    return () => clearInterval(timer);
  }, [animating, documents]);

  const upload = async (files: FileList | File[]) => {
    setUploading(true);
    setNotice(null);
    try {
      for (const file of Array.from(files)) {
        const form = new FormData();
        form.append("file", file);
        const res = await fetch("/api/documents", { method: "POST", body: form });
        const body = (await res.json()) as { document?: DocumentItem; deduplicated?: boolean; error?: { message: string } };
        if (!res.ok) setNotice({ kind: "error", text: `${file.name}: ${body.error?.message ?? res.statusText}` });
        else if (body.deduplicated) setNotice({ kind: "info", text: `${file.name} is already in the library (same content).` });
        else if (body.document) setShown((prev) => ({ ...prev, [body.document!.id]: 0 }));
      }
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = "";
      await refresh();
    }
  };

  const remove = async (id: string) => {
    await fetch(`/api/documents/${id}`, { method: "DELETE" });
    await refresh();
  };

  const totalChunks = documents.reduce((n, d) => n + d.chunkCount, 0);

  return (
    <div className="space-y-6">
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          if (e.dataTransfer.files.length) void upload(e.dataTransfer.files);
        }}
        className={cn(
          "surface surface-interactive group relative flex cursor-pointer flex-col items-center gap-3 overflow-hidden rounded-2xl px-6 py-10 text-center",
          dragging && "shadow-[var(--shadow-elevated),var(--shadow-glow)]",
        )}
      >
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-0 rounded-2xl opacity-0 transition-opacity duration-500 group-hover:opacity-100",
            "bg-[radial-gradient(60%_80%_at_50%_0%,color-mix(in_oklch,var(--primary)_22%,transparent),transparent)]",
            dragging && "opacity-100",
          )}
        />
        <motion.span
          animate={dragging ? { y: -4, scale: 1.08 } : { y: 0, scale: 1 }}
          className="relative grid size-12 place-items-center rounded-2xl bg-primary/15 text-primary ring-1 ring-primary/30 shadow-[0_0_30px_-8px_var(--primary)]"
        >
          <UploadCloud className="size-5" />
        </motion.span>
        <span className="relative font-display text-[15px] font-semibold">
          {uploading ? "Uploading…" : dragging ? "Drop to ingest" : "Drop PDF or Markdown files, or click to browse"}
        </span>
        <span className="relative text-xs text-muted-foreground">
          Parsed with page numbers · chunked along headings · embedded and indexed for hybrid search · identical files are deduplicated
        </span>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPT}
          multiple
          className="sr-only"
          data-testid="file-input"
          disabled={uploading}
          onChange={(e) => e.target.files?.length && void upload(e.target.files)}
        />
      </label>

      <AnimatePresence>
        {notice && (
          <motion.p
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            className={cn("text-sm", notice.kind === "error" ? "text-destructive" : "text-muted-foreground")}
            role="status"
          >
            {notice.text}
          </motion.p>
        )}
      </AnimatePresence>

      <div className="flex items-baseline justify-between">
        <h2 className="text-sm font-semibold">Library</h2>
        <p className="text-xs text-muted-foreground">
          {documents.length} documents · {totalChunks} chunks
        </p>
      </div>

      {documents.length === 0 ? (
        <div className="surface p-10 text-center text-sm text-muted-foreground">
          No documents yet. Upload one above, or run <code className="font-mono text-foreground">npm run seed</code>.
        </div>
      ) : (
        <ul className="space-y-3">
          <AnimatePresence initial={false}>
            {documents.map((doc) => {
              const Icon = doc.sourceType === "pdf" ? FileType2 : FileText;
              const step = Math.min(shown[doc.id] ?? realStep(doc), realStep(doc));
              const settled = step === realStep(doc) && (doc.status === "ready" || doc.status === "failed");
              const durations = doc.progress?.durations
                ? { parsing: doc.progress.durations.parsing, chunking: doc.progress.durations.chunking, embedding: (doc.progress.durations.embedding ?? 0) + (doc.progress.durations.indexing ?? 0) || undefined }
                : undefined;
              return (
                <motion.li
                  key={doc.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, x: -12 }}
                  transition={{ duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
                  className="surface surface-interactive grid items-center gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_280px_auto]"
                  data-testid="document-row"
                  data-filename={doc.filename}
                >
                  <div className="flex min-w-0 items-center gap-3.5">
                    <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground ring-1 ring-border">
                      <Icon className="size-[18px]" />
                    </span>
                    <div className="min-w-0">
                      <Link href={`/documents/${doc.id}`} className="block truncate font-medium hover:text-primary">
                        {doc.title}
                      </Link>
                      <p className="truncate text-xs text-muted-foreground">
                        {doc.filename} · {formatBytes(doc.byteSize)}
                        {doc.pageCount ? ` · ${doc.pageCount} pages` : ""}
                      </p>
                      {doc.error && <p className="mt-0.5 truncate text-xs text-destructive">{doc.error}</p>}
                    </div>
                  </div>

                  <IngestionSteps step={step} failed={doc.status === "failed" && settled} durations={settled ? durations : undefined} />

                  <div className="flex items-center gap-2 justify-self-end">
                    {settled && doc.status === "ready" ? (
                      <Badge variant="outline" className="font-mono">
                        {doc.chunkCount} chunks
                      </Badge>
                    ) : null}
                    <StatusBadge status={settled ? doc.status : step === 0 ? "queued" : step >= 4 ? "ready" : "processing"} label={settled ? undefined : INGEST_STEPS[step]} />
                    <Button asChild variant="ghost" size="icon-sm" aria-label={`Explore chunks of ${doc.title}`}>
                      <Link href={`/documents/${doc.id}`}>
                        <ArrowRight />
                      </Link>
                    </Button>
                    <Button variant="ghost" size="icon-sm" aria-label={`Delete ${doc.title}`} onClick={() => void remove(doc.id)}>
                      <Trash2 />
                    </Button>
                  </div>
                </motion.li>
              );
            })}
          </AnimatePresence>
        </ul>
      )}
    </div>
  );
}
