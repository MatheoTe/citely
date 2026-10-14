"use client";

import { Cpu, Sparkles } from "lucide-react";
import { HoverCard } from "@/components/ui/hover-card";
import type { ProviderModeView } from "@/lib/ask-events";
import { cn } from "@/lib/utils";

/** Header status pill; hovering explains what runs where and, offline, what is degraded and how to fix it. */
export function ModeBadge({ mode }: { mode: ProviderModeView }) {
  const live = mode.llm !== "offline (extractive)";
  return (
    <HoverCard
      width={340}
      trigger={
        <button
          type="button"
          data-testid="mode-badge"
          className={cn(
            "hidden items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-medium backdrop-blur sm:inline-flex",
            live ? "border-success/30 bg-success/10 text-success" : "border-warning/30 bg-warning/10 text-warning",
          )}
        >
          <span className="relative flex size-1.5">
            <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-60", live ? "bg-success" : "bg-warning")} />
            <span className={cn("relative inline-flex size-1.5 rounded-full", live ? "bg-success" : "bg-warning")} />
          </span>
          {live ? mode.llm : "Offline mode"}
        </button>
      }
    >
      <div className="space-y-3">
        <div className="flex items-center gap-2">
          {live ? <Sparkles className="size-4 text-success" /> : <Cpu className="size-4 text-warning" />}
          <p className="font-display font-semibold">
            {live ? "Live providers" : mode.demo ? "Public demo · offline on purpose" : "Running without API keys"}
          </p>
        </div>
        <dl className="grid grid-cols-[88px_1fr] gap-y-1 text-xs">
          <dt className="text-muted-foreground">Answers</dt>
          <dd className="font-mono">{mode.llm}</dd>
          <dt className="text-muted-foreground">Embeddings</dt>
          <dd className="font-mono">{mode.embeddings}</dd>
          <dt className="text-muted-foreground">Reranker</dt>
          <dd className="font-mono">{mode.reranker ?? "none"}</dd>
        </dl>
        {live ? (
          <p className="text-xs text-muted-foreground">
            Questions are rewritten by Claude Haiku and answered by Claude with streamed, cited output. Costs appear on each
            trace.
          </p>
        ) : (
          <div className="space-y-2 text-xs text-muted-foreground">
            <p>Everything works end to end, with two deliberate downgrades:</p>
            <ul className="list-disc space-y-1 pl-4">
              <li>Answers are extractive: verbatim sentences stitched from the top passages, no paraphrasing or reasoning.</li>
              <li>Embeddings are hashed n-grams — lexical, so paraphrases match less well.</li>
            </ul>
            {mode.demo ? (
              <p>
                This demo makes no paid API calls. Clone the repo and add{" "}
                <code className="rounded bg-muted px-1 font-mono text-foreground">ANTHROPIC_API_KEY</code> to switch on Claude.
              </p>
            ) : (
            <p>
              Add <code className="rounded bg-muted px-1 font-mono text-foreground">ANTHROPIC_API_KEY</code> (and optionally{" "}
              <code className="rounded bg-muted px-1 font-mono text-foreground">VOYAGE_API_KEY</code>) to <code className="font-mono">.env</code>{" "}
              and restart to switch on Claude.
            </p>
            )}
          </div>
        )}
      </div>
    </HoverCard>
  );
}
