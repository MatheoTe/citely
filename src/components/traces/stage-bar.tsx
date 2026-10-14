import type { TraceTimings } from "@/server/db/schema";
import { formatMs } from "@/lib/utils";

const STAGES: { key: keyof TraceTimings; label: string; color: string }[] = [
  { key: "rewriteMs", label: "Rewrite", color: "bg-violet-500" },
  { key: "embedMs", label: "Embed query", color: "bg-sky-500" },
  { key: "ftsMs", label: "Full-text", color: "bg-emerald-500" },
  { key: "vectorMs", label: "Vector", color: "bg-teal-500" },
  { key: "rerankMs", label: "Rerank", color: "bg-amber-500" },
  { key: "generationMs", label: "Generation", color: "bg-primary" },
];

/**
 * Latency breakdown. FTS and vector search run concurrently, so stage bars
 * are drawn relative to total time rather than stacked.
 */
export function StageBars({ timings }: { timings: TraceTimings }) {
  const total = Math.max(timings.totalMs, 1);
  return (
    <div className="space-y-1.5">
      {STAGES.map(({ key, label, color }) => {
        const value = (timings[key] as number | null) ?? 0;
        return (
          <div key={key} className="grid grid-cols-[110px_1fr_70px] items-center gap-3 text-xs">
            <span className="text-muted-foreground">{label}</span>
            <span className="h-2 overflow-hidden rounded-full bg-muted">
              <span className={`block h-full rounded-full ${color}`} style={{ width: `${Math.min(100, (value / total) * 100)}%` }} />
            </span>
            <span className="text-right font-mono tabular-nums">{formatMs(value)}</span>
          </div>
        );
      })}
    </div>
  );
}
