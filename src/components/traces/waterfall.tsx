import type { PipelineStage, TimingsView, TraceSpanView } from "@/lib/ask-events";
import { formatMs } from "@/lib/utils";

const ROWS: { stage: PipelineStage; label: string; color: string }[] = [
  { stage: "rewrite", label: "Rewrite query", color: "from-violet-400 to-violet-500" },
  { stage: "fts", label: "Full-text search", color: "from-amber-300 to-amber-500" },
  { stage: "vector", label: "Embed + vector", color: "from-sky-300 to-sky-500" },
  { stage: "fuse", label: "RRF fusion", color: "from-fuchsia-300 to-fuchsia-500" },
  { stage: "rerank", label: "Rerank", color: "from-orange-300 to-orange-500" },
  { stage: "generate", label: "Generate", color: "from-indigo-300 to-primary" },
];

/** Spans recorded on the trace; older traces only have durations, so offsets are reconstructed from the pipeline order. */
export function spansFor(t: TimingsView): TraceSpanView[] {
  if (t.spans?.length) return t.spans;
  const r = t.rewriteMs;
  const retrievalEnd = r + t.retrievalMs;
  return [
    { stage: "rewrite", startMs: 0, durationMs: r },
    { stage: "fts", startMs: r, durationMs: t.ftsMs },
    { stage: "vector", startMs: r, durationMs: t.embedMs + t.vectorMs },
    { stage: "fuse", startMs: r + Math.max(t.ftsMs, t.embedMs + t.vectorMs), durationMs: t.fuseMs },
    ...(t.rerankMs ? [{ stage: "rerank" as const, startMs: retrievalEnd - t.rerankMs, durationMs: t.rerankMs }] : []),
    { stage: "generate", startMs: retrievalEnd, durationMs: t.generationMs },
  ];
}

export function Waterfall({ timings }: { timings: TimingsView }) {
  const spans = spansFor(timings);
  const total = Math.max(timings.totalMs, ...spans.map((s) => s.startMs + s.durationMs), 1);
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  return (
    <div className="space-y-2" data-testid="waterfall">
      <div className="relative ml-[118px] h-4 text-[10px] text-muted-foreground">
        {ticks.map((t) => (
          <span
            key={t}
            className={`absolute whitespace-nowrap font-mono ${t === 0 ? "" : t === 1 ? "-translate-x-full" : "-translate-x-1/2"}`}
            style={{ left: `${t * 100}%` }}
          >
            {formatMs(Math.round(t * total))}
          </span>
        ))}
      </div>
      <div className="relative">
        <div className="pointer-events-none absolute inset-y-0 left-[118px] right-0">
          {ticks.map((t) => (
            <span key={t} className="absolute inset-y-0 w-px bg-border/70" style={{ left: `${t * 100}%` }} />
          ))}
          {timings.ttftMs !== null && (
            <span className="absolute inset-y-0 w-px bg-success/80" style={{ left: `${(timings.ttftMs / total) * 100}%` }} title="First token">
              <span className="absolute -top-0.5 left-1 whitespace-nowrap rounded bg-success/15 px-1 font-mono text-[9px] text-success">TTFT</span>
            </span>
          )}
        </div>
        <ul className="space-y-1.5">
          {ROWS.map(({ stage, label, color }) => {
            const span = spans.find((s) => s.stage === stage);
            return (
              <li key={stage} className="grid grid-cols-[110px_1fr] items-center gap-2 text-[11px]">
                <span className="truncate text-muted-foreground">{label}</span>
                <span className="relative h-5">
                  {span ? (
                    <span
                      className={`absolute top-0.5 flex h-4 min-w-[3px] items-center rounded-[5px] bg-gradient-to-r ${color} shadow-[0_0_14px_-4px_currentColor]`}
                      style={{ left: `${(span.startMs / total) * 100}%`, width: `${Math.max((span.durationMs / total) * 100, 0.4)}%` }}
                    >
                      <span
                        className={
                          (span.startMs + span.durationMs) / total <= 0.8
                            ? "absolute left-full ml-1.5 whitespace-nowrap font-mono text-[10px] text-foreground/80"
                            : span.durationMs / total > 0.12
                              ? "absolute right-1.5 whitespace-nowrap font-mono text-[10px] font-medium text-black/75"
                              : "absolute right-full mr-1.5 whitespace-nowrap font-mono text-[10px] text-foreground/80"
                        }
                      >
                        {formatMs(span.durationMs)}
                      </span>
                    </span>
                  ) : (
                    <span className="absolute top-1 font-mono text-[10px] text-muted-foreground/70">skipped</span>
                  )}
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
