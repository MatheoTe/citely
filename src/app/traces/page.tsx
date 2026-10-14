import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { PageHeader } from "@/components/page-header";
import { TraceTable, type TraceView } from "@/components/traces/trace-table";
import { formatMs, formatUsd } from "@/lib/utils";
import { getDb } from "@/server/db/client";
import { listTraces } from "@/server/repositories";

export const metadata: Metadata = { title: "Traces" };

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function Stat({ label, value, hint, accent }: { label: string; value: string; hint: string; accent: string }) {
  return (
    <div className="surface surface-interactive relative overflow-hidden p-5">
      <span aria-hidden="true" className={`absolute -right-10 -top-10 size-28 rounded-full opacity-40 blur-2xl ${accent}`} />
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1.5 font-display text-2xl font-semibold tabular-nums tracking-tight">{value}</p>
      <p className="mt-1 text-[11px] text-muted-foreground">{hint}</p>
    </div>
  );
}

async function TraceList() {
  await connection();
  const rows = await listTraces(await getDb(), 100);
  const ok = rows.filter((t) => t.status === "ok");
  const costs = ok.map((t) => t.costUsd).filter((c): c is number => c !== null);
  const p50 = percentile(ok.map((t) => t.totalMs), 50);
  const p95 = percentile(ok.map((t) => t.totalMs), 95);
  const ttft = percentile(ok.flatMap((t) => (t.timings.ttftMs === null ? [] : [t.timings.ttftMs])), 50);
  const abstained = ok.filter((t) => t.answerable === false).length;
  const traces: TraceView[] = rows.map((t) => ({ ...t, createdAt: t.createdAt.toISOString() }));

  return (
    <div className="space-y-6">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Requests" value={String(rows.length)} hint={`${rows.length - ok.length} errors`} accent="bg-primary" />
        <Stat label="Latency p50 / p95" value={`${formatMs(p50)} / ${formatMs(p95)}`} hint={`first token p50 ${formatMs(ttft)}`} accent="bg-vector" />
        <Stat
          label="Avg cost / request"
          value={costs.length ? formatUsd(costs.reduce((a, b) => a + b, 0) / costs.length) : "—"}
          hint="estimated from token usage"
          accent="bg-success"
        />
        <Stat label="Abstention rate" value={ok.length ? `${Math.round((abstained / ok.length) * 100)}%` : "—"} hint="questions outside the documents" accent="bg-warning" />
      </div>
      <TraceTable traces={traces} />
    </div>
  );
}

export default function TracesPage() {
  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Observability"
        title="Traces"
        description="Every question records when each stage started and how long it took, how every chunk ranked in each retriever, token usage and an estimated cost. Last 100 requests."
      />
      <Suspense
        fallback={
          <div className="space-y-3">
            <div className="surface h-28 animate-pulse" />
            <div className="surface h-80 animate-pulse" />
          </div>
        }
      >
        <TraceList />
      </Suspense>
    </div>
  );
}
