"use client";

import { Check, X } from "lucide-react";
import { motion } from "motion/react";
import { cn } from "@/lib/utils";

export const INGEST_STEPS = ["queued", "parsing", "chunking", "embedding", "ready"] as const;
export type IngestStep = (typeof INGEST_STEPS)[number];

/** Five-step ingestion tracker with an animated progress rail. */
export function IngestionSteps({ step, failed, durations }: { step: number; failed: boolean; durations?: Partial<Record<string, number>> }) {
  return (
    <ol className="relative grid grid-cols-5 gap-1" aria-label="Ingestion progress">
      <span className="absolute inset-x-[10%] top-[9px] h-px bg-border" aria-hidden="true" />
      <motion.span
        aria-hidden="true"
        className={cn("absolute left-[10%] top-[9px] h-px", failed ? "bg-destructive/70" : "bg-gradient-to-r from-primary/50 to-success")}
        initial={false}
        animate={{ width: `${(step / (INGEST_STEPS.length - 1)) * 80}%` }}
        transition={{ duration: 0.45, ease: "easeOut" }}
      />
      {INGEST_STEPS.map((name, i) => {
        const done = i < step || (i === step && name === "ready");
        const current = i === step && name !== "ready";
        const ms = durations?.[name];
        return (
          <li key={name} className="relative flex flex-col items-center gap-1">
            <span
              className={cn(
                "relative grid size-[18px] place-items-center rounded-full border bg-card-solid transition-all duration-300",
                done && !failed && "border-success/50 bg-success/15 text-success",
                current && !failed && "border-primary/60 text-primary shadow-[0_0_14px_-2px_var(--primary)]",
                failed && i === step && "border-destructive/60 bg-destructive/15 text-destructive",
              )}
            >
              {current && !failed && <span className="absolute inset-0 animate-ping rounded-full border border-primary/50" />}
              {failed && i === step ? <X className="size-2.5" /> : done ? <Check className="size-2.5" strokeWidth={3} /> : (
                <span className={cn("size-1 rounded-full", current ? "bg-primary" : "bg-muted-foreground/40")} />
              )}
            </span>
            <span className={cn("text-[10px] capitalize leading-none", done || current ? "text-foreground/85" : "text-muted-foreground")}>{name}</span>
            <span className="h-2.5 font-mono text-[9px] leading-none text-muted-foreground">{ms !== undefined ? `${ms} ms` : ""}</span>
          </li>
        );
      })}
    </ol>
  );
}
