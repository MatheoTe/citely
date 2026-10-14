import type { Metadata } from "next";
import { connection } from "next/server";
import { Suspense } from "react";
import { OpenHashTarget } from "@/components/traces/open-hash-target";
import { StageBars } from "@/components/traces/stage-bar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { formatMs, formatUsd } from "@/lib/utils";
import { getDb } from "@/server/db/client";
import type { TraceRow } from "@/server/db/schema";
import { listTraces } from "@/server/repositories";

export const metadata: Metadata = { title: "Traces" };

function percentile(values: number[], p: number): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <Card>
      <CardHeader className="pb-1">
        <CardDescription>{label}</CardDescription>
        <CardTitle className="text-2xl tabular-nums">{value}</CardTitle>
      </CardHeader>
      {hint && <CardContent className="text-xs text-muted-foreground">{hint}</CardContent>}
    </Card>
  );
}

function TraceItem({ trace }: { trace: TraceRow }) {
  const tokens = trace.usage.reduce((n, u) => n + u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens, 0);
  const cited = new Set(trace.citations.map((c) => c.chunkId));
  return (
    <details id={`trace-${trace.id}`} className="group scroll-mt-24 border-b last:border-0" data-testid="trace-row">
      <summary className="grid cursor-pointer list-none grid-cols-[1fr_auto] items-center gap-3 p-4 hover:bg-muted/50 sm:grid-cols-[150px_1fr_110px_80px_80px]">
        <time className="hidden font-mono text-xs text-muted-foreground sm:block" dateTime={trace.createdAt.toISOString()}>
          {trace.createdAt.toISOString().replace("T", " ").slice(0, 19)}
        </time>
        <span className="truncate text-sm">{trace.question}</span>
        <span className="hidden sm:block">
          {trace.status === "error" ? (
            <Badge variant="destructive">error</Badge>
          ) : trace.answerable ? (
            <Badge variant="success">answered</Badge>
          ) : (
            <Badge variant="warning">abstained</Badge>
          )}
        </span>
        <span className="text-right font-mono text-xs tabular-nums">{formatMs(trace.totalMs)}</span>
        <span className="hidden text-right font-mono text-xs tabular-nums sm:block">{formatUsd(trace.costUsd)}</span>
      </summary>

      <div className="grid gap-6 bg-muted/30 p-4 lg:grid-cols-2">
        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Latency</h3>
          <StageBars timings={trace.timings} />
          <p className="text-xs text-muted-foreground">
            Time to first token {formatMs(trace.timings.ttftMs)} · retrieval {formatMs(trace.timings.retrievalMs)} · total{" "}
            {formatMs(trace.totalMs)}
          </p>
          <h3 className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Pipeline</h3>
          <dl className="grid grid-cols-[120px_1fr] gap-y-1 text-xs">
            <dt className="text-muted-foreground">LLM</dt>
            <dd className="font-mono">{trace.llmModel ?? trace.llmProvider}</dd>
            <dt className="text-muted-foreground">Embeddings</dt>
            <dd className="font-mono">{trace.embeddingModel}</dd>
            <dt className="text-muted-foreground">Reranker</dt>
            <dd className="font-mono">{trace.reranker ?? "none"}</dd>
            <dt className="text-muted-foreground">Search query</dt>
            <dd className="font-mono">{trace.rewrittenQuery ?? "—"}</dd>
            <dt className="text-muted-foreground">Tokens</dt>
            <dd className="font-mono">{tokens.toLocaleString()}</dd>
          </dl>
          {trace.error && <p className="text-xs text-destructive">{trace.error}</p>}
        </section>

        <section className="space-y-3">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Usage &amp; cost</h3>
          {trace.usage.length === 0 ? (
            <p className="text-xs text-muted-foreground">No paid model calls (offline providers).</p>
          ) : (
            <table className="w-full text-xs">
              <thead className="text-muted-foreground">
                <tr className="text-left">
                  <th className="font-normal">Step</th>
                  <th className="font-normal">Model</th>
                  <th className="text-right font-normal">In</th>
                  <th className="text-right font-normal">Cached</th>
                  <th className="text-right font-normal">Out</th>
                  <th className="text-right font-normal">Cost</th>
                </tr>
              </thead>
              <tbody className="font-mono tabular-nums">
                {trace.usage.map((u, i) => (
                  <tr key={i}>
                    <td className="font-sans">{u.step}</td>
                    <td className="truncate">{u.model}</td>
                    <td className="text-right">{u.inputTokens}</td>
                    <td className="text-right">{u.cacheReadTokens}</td>
                    <td className="text-right">{u.outputTokens}</td>
                    <td className="text-right">{formatUsd(u.costUsd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}

          <h3 className="pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Retrieved chunks</h3>
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="font-normal">#</th>
                <th className="font-normal">Chunk</th>
                <th className="text-right font-normal">FTS rank</th>
                <th className="text-right font-normal">Vector rank</th>
                <th className="text-right font-normal">RRF</th>
                <th className="text-right font-normal">Cited</th>
              </tr>
            </thead>
            <tbody className="font-mono tabular-nums">
              {trace.retrieval.map((r, i) => (
                <tr key={r.chunkId}>
                  <td>{i + 1}</td>
                  <td>{r.chunkId.slice(0, 8)}</td>
                  <td className="text-right">{r.ftsRank ?? "—"}</td>
                  <td className="text-right">{r.vectorRank ?? "—"}</td>
                  <td className="text-right">{r.fusedScore.toFixed(4)}</td>
                  <td className="text-right">{cited.has(r.chunkId) ? "✓" : ""}</td>
                </tr>
              ))}
            </tbody>
          </table>
          {trace.answer && <p className="whitespace-pre-wrap rounded-lg border bg-card p-3 text-xs leading-5">{trace.answer}</p>}
        </section>
      </div>
    </details>
  );
}

async function TraceList() {
  await connection();
  const traces = await listTraces(await getDb(), 100);
  const ok = traces.filter((t) => t.status === "ok");
  const costs = ok.map((t) => t.costUsd).filter((c): c is number => c !== null);
  const p50 = percentile(ok.map((t) => t.totalMs), 50);
  const p95 = percentile(ok.map((t) => t.totalMs), 95);
  const ttft = percentile(ok.flatMap((t) => (t.timings.ttftMs === null ? [] : [t.timings.ttftMs])), 50);
  const abstained = ok.filter((t) => t.answerable === false).length;

  return (
    <>
      <OpenHashTarget />
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Requests" value={String(traces.length)} hint={`${traces.length - ok.length} errors`} />
        <Stat label="Latency p50 / p95" value={`${formatMs(p50)} / ${formatMs(p95)}`} hint={`first token p50 ${formatMs(ttft)}`} />
        <Stat
          label="Avg cost / request"
          value={costs.length ? formatUsd(costs.reduce((a, b) => a + b, 0) / costs.length) : "—"}
          hint="estimated from token usage"
        />
        <Stat label="Abstention rate" value={ok.length ? `${Math.round((abstained / ok.length) * 100)}%` : "—"} hint="answers outside the documents" />
      </div>
      <Card className="overflow-hidden">
        {traces.length === 0 ? (
          <p className="p-8 text-center text-sm text-muted-foreground">No requests yet. Ask a question to record a trace.</p>
        ) : (
          traces.map((trace) => <TraceItem key={trace.id} trace={trace} />)
        )}
      </Card>
    </>
  );
}

export default function TracesPage() {
  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Traces</h1>
        <p className="text-sm text-muted-foreground">
          Every question records per-stage latency, retrieval ranks, token usage and an estimated cost (last 100 requests).
        </p>
      </div>
      <Suspense
        fallback={
          <div className="space-y-3">
            <Skeleton className="h-24 w-full" />
            <Skeleton className="h-64 w-full" />
          </div>
        }
      >
        <TraceList />
      </Suspense>
    </div>
  );
}
