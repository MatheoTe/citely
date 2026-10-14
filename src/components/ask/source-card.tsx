"use client";

import { motion } from "motion/react";
import type { SourceView } from "@/lib/ask-events";
import { cn, pageLabel, sectionLabel } from "@/lib/utils";
import { RetrieverBadges } from "./retriever-badges";

interface Props {
  source: SourceView;
  /** Fused (RRF) relevance, min-max scaled within this answer's sources (0..1). */
  relevance: number;
  cited: boolean;
  settled: boolean;
  active: boolean;
  order: number;
  onOpen: () => void;
}

export function SourceCard({ source, relevance, cited, settled, active, order, onOpen }: Props) {
  const page = pageLabel(source.pageStart, source.pageEnd);
  return (
    <motion.button
      type="button"
      data-testid="source-card"
      onClick={onOpen}
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: settled && !cited ? 0.62 : 1, y: 0 }}
      transition={{ delay: order * 0.045, duration: 0.35, ease: [0.2, 0.8, 0.2, 1] }}
      className={cn(
        "surface surface-interactive group flex w-full flex-col gap-2.5 rounded-xl p-3.5 text-left",
        active && "shadow-[var(--shadow-elevated),var(--shadow-glow)]",
      )}
    >
      <span className="flex items-start gap-2.5">
        <span
          className={cn(
            "grid size-[22px] shrink-0 place-items-center rounded-md font-mono text-[11px] font-semibold",
            cited ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground",
          )}
        >
          {source.index}
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-medium">{source.documentTitle}</span>
          <span className="block truncate text-[11px] text-muted-foreground">
            {[sectionLabel(source.headingPath), page].filter(Boolean).join(" · ") || source.filename}
          </span>
        </span>
      </span>
      <span className="flex items-center gap-2">
        <span className="h-1 flex-1 overflow-hidden rounded-full bg-muted" title="Fused RRF score, scaled between this answer's weakest and strongest source">
          <motion.span
            className="block h-full rounded-full bg-gradient-to-r from-primary/50 to-primary"
            initial={{ width: 0 }}
            animate={{ width: `${Math.round(relevance * 100)}%` }}
            transition={{ delay: 0.15 + order * 0.05, duration: 0.7, ease: "easeOut" }}
          />
        </span>
        <span className="w-12 text-right font-mono text-[10px] tabular-nums text-muted-foreground">{source.fusedScore.toFixed(4)}</span>
      </span>
      <RetrieverBadges source={source} />
    </motion.button>
  );
}
