"use client";

import Link from "next/link";
import { ArrowUpRight, FileText, X } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { ScoreBar } from "@/components/ui/score-bar";
import type { SourceView } from "@/lib/ask-events";
import { cn, pageLabel, sectionLabel } from "@/lib/utils";
import { HighlightedPassage } from "./passage";

interface DocChunk {
  id: string;
  ordinal: number;
  content: string;
  headingPath: string;
  pageStart: number | null;
  pageEnd: number | null;
}

interface Props {
  source: SourceView;
  claim: string | null;
  /** Best fused score among this answer's sources (to scale the bar). */
  maxFused: number;
  candidates?: number;
  onClose: () => void;
}

/**
 * Slide-over document view: loads the cited document, scrolls to the cited
 * chunk and highlights the supporting sentence, with the chunk's retrieval
 * evidence (FTS rank, vector rank, fused score) as bars.
 */
export function SourcePanel({ source, claim, maxFused, candidates = 30, onClose }: Props) {
  const [chunks, setChunks] = useState<DocChunk[] | null>(null);
  const targetRef = useRef<HTMLLIElement>(null);
  const page = pageLabel(source.pageStart, source.pageEnd);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/documents/${source.documentId}`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { document?: { chunks: DocChunk[] } } | null) => {
        if (!cancelled) setChunks(body?.document?.chunks ?? []);
      })
      .catch(() => !cancelled && setChunks([]));
    return () => {
      cancelled = true;
    };
  }, [source.documentId]);

  useEffect(() => {
    targetRef.current?.scrollIntoView({ block: "center", behavior: "smooth" });
  }, [chunks, source.chunkId]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const list = chunks?.length ? chunks : [{ id: source.chunkId, ordinal: 0, content: source.content, headingPath: source.headingPath, pageStart: source.pageStart, pageEnd: source.pageEnd }];

  return (
    <>
      <motion.div
        aria-hidden="true"
        className="fixed inset-0 z-40 bg-black/35 backdrop-blur-[2px]"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        onClick={onClose}
      />
    <motion.aside
      data-testid="source-panel"
      initial={{ x: 40, opacity: 0 }}
      animate={{ x: 0, opacity: 1 }}
      exit={{ x: 40, opacity: 0 }}
      transition={{ type: "spring", stiffness: 380, damping: 36 }}
      className="surface fixed inset-y-0 right-0 z-50 flex w-full max-w-[480px] flex-col rounded-none sm:inset-y-3 sm:right-3 sm:rounded-2xl"
      style={{ background: "color-mix(in oklch, var(--card-solid) 96%, transparent)" }}
      aria-label="Cited source"
    >
      <div className="flex items-start gap-3 border-b border-border/70 p-5">
        <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-primary font-mono text-sm font-semibold text-primary-foreground shadow-[0_0_20px_-4px_var(--primary)]">
          {source.index}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-display text-[15px] font-semibold">{source.documentTitle}</p>
          <p className="truncate text-xs text-muted-foreground">{sectionLabel(source.headingPath) || source.filename}</p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            <Badge variant="outline">
              <FileText /> {source.filename}
            </Badge>
            {page && <Badge variant="default">{page}</Badge>}
          </div>
        </div>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close source">
          <X />
        </Button>
      </div>

      <div className="space-y-2 border-b border-border/70 px-5 py-4">
        <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">Retrieval evidence</p>
        <ScoreBar
          label="Full-text"
          tone="fts"
          value={source.ftsRank ? 1 - (source.ftsRank - 1) / candidates : 0}
          display={source.ftsRank ? `#${source.ftsRank}` : "—"}
        />
        <ScoreBar
          label="Vector"
          tone="vector"
          value={source.vectorSimilarity ?? 0}
          display={source.vectorRank ? `#${source.vectorRank}` : "—"}
        />
        <ScoreBar label="RRF fused" value={maxFused ? source.fusedScore / maxFused : 0} display={source.fusedScore.toFixed(4)} />
        {source.rerankScore !== null && <ScoreBar label="Rerank" value={source.rerankScore} display={source.rerankScore.toFixed(2)} />}
      </div>

      <ol className="flex-1 space-y-2 overflow-y-auto px-5 py-4" data-testid="source-document">
        {list.map((chunk) => {
          const target = chunk.id === source.chunkId;
          return (
            <li
              key={chunk.id}
              ref={target ? targetRef : undefined}
              className={cn(
                "rounded-xl border border-transparent px-3.5 py-3 text-[13px] leading-relaxed transition-colors",
                target ? "border-primary/40 bg-primary/10 shadow-[var(--shadow-glow)]" : "text-foreground/60",
              )}
            >
              <p className="mb-1.5 flex items-center gap-2 text-[10.5px] uppercase tracking-wider text-muted-foreground">
                <span className="truncate">{sectionLabel(chunk.headingPath) || "—"}</span>
                {pageLabel(chunk.pageStart, chunk.pageEnd) && <span className="shrink-0">{pageLabel(chunk.pageStart, chunk.pageEnd)}</span>}
                {target && <span className="ml-auto shrink-0 font-semibold text-primary">cited</span>}
              </p>
              {target ? (
                <HighlightedPassage content={chunk.content} claim={claim} className="whitespace-pre-wrap" />
              ) : (
                <p className="whitespace-pre-wrap">{chunk.content}</p>
              )}
            </li>
          );
        })}
      </ol>

      <div className="flex items-center justify-between gap-2 border-t border-border/70 px-5 py-3">
        <span className="font-mono text-[11px] text-muted-foreground">chunk {source.chunkId.slice(0, 8)}</span>
        <Button asChild variant="link" size="sm">
          <Link href={`/documents/${source.documentId}#chunk-${source.chunkId}`}>
            Open in document <ArrowUpRight />
          </Link>
        </Button>
      </div>
    </motion.aside>
    </>
  );
}
