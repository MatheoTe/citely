"use client";

import { ChevronRight } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { Fragment, useState, useSyncExternalStore } from "react";
import { Badge } from "@/components/ui/badge";
import { ScoreBar } from "@/components/ui/score-bar";
import type { TimingsView } from "@/lib/ask-events";
import { cn, formatMs, formatUsd } from "@/lib/utils";
import { Waterfall } from "./waterfall";

export interface TraceView {
  id: string;
  createdAt: string;
  question: string;
  rewrittenQuery: string | null;
  answer: string | null;
  answerable: boolean | null;
  status: "ok" | "error";
  error: string | null;
  llmProvider: string;
  llmModel: string | null;
  embeddingModel: string;
  reranker: string | null;
  timings: TimingsView;
  retrieval: { chunkId: string; ftsRank: number | null; vectorRank: number | null; fusedScore: number; rerankScore: number | null }[];
  citations: { index: number; chunkId: string }[];
  usage: { step: string; model: string; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; costUsd: number | null }[];
  costUsd: number | null;
  totalMs: number;
}

const subscribeHash = (cb: () => void) => {
  window.addEventListener("hashchange", cb);
  return () => window.removeEventListener("hashchange", cb);
};

function tokens(t: TraceView) {
  return t.usage.reduce((n, u) => n + u.inputTokens + u.outputTokens + u.cacheReadTokens + u.cacheWriteTokens, 0);
}

export function TraceTable({ traces }: { traces: TraceView[] }) {
  const hash = useSyncExternalStore(subscribeHash, () => window.location.hash, () => "");
  const [toggled, setToggled] = useState<Record<string, boolean>>({});
  const isOpen = (id: string) => toggled[id] ?? hash === `#trace-${id}`;

  if (traces.length === 0) {
    return <div className="surface p-10 text-center text-sm text-muted-foreground">No requests yet. Ask a question to record a trace.</div>;
  }

  return (
    <div className="surface overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[860px] text-left text-[13px]">
          <thead>
            <tr className="border-b border-border/70 text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="w-8 py-3 pl-4" />
              <th className="py-3 pr-3 font-medium">Time</th>
              <th className="py-3 pr-3 font-medium">Question</th>
              <th className="py-3 pr-3 font-medium">Outcome</th>
              <th className="py-3 pr-3 text-right font-medium">Total</th>
              <th className="py-3 pr-3 text-right font-medium">First token</th>
              <th className="py-3 pr-3 text-right font-medium">Retrieval</th>
              <th className="py-3 pr-3 text-right font-medium">Tokens</th>
              <th className="py-3 pr-4 text-right font-medium">Cost</th>
            </tr>
          </thead>
          <tbody>
            {traces.map((trace) => {
              const open = isOpen(trace.id);
              return (
                <Fragment key={trace.id}>
                  <tr
                    id={`trace-${trace.id}`}
                    data-testid="trace-row"
                    onClick={() => setToggled((p) => ({ ...p, [trace.id]: !open }))}
                    className={cn("cursor-pointer scroll-mt-24 border-b border-border/50 transition-colors hover:bg-muted/40", open && "bg-muted/30")}
                  >
                    <td className="py-3 pl-4">
                      <ChevronRight className={cn("size-4 text-muted-foreground transition-transform duration-200", open && "rotate-90")} />
                    </td>
                    <td className="whitespace-nowrap py-3 pr-3 font-mono text-[11px] text-muted-foreground">
                      {trace.createdAt.replace("T", " ").slice(5, 19)}
                    </td>
                    <td className="max-w-[320px] truncate py-3 pr-3">{trace.question}</td>
                    <td className="py-3 pr-3">
                      {trace.status === "error" ? (
                        <Badge variant="destructive">error</Badge>
                      ) : trace.answerable ? (
                        <Badge variant="success">answered · {trace.citations.length} cited</Badge>
                      ) : (
                        <Badge variant="warning">abstained</Badge>
                      )}
                    </td>
                    <td className="py-3 pr-3 text-right font-mono text-xs tabular-nums">{formatMs(trace.totalMs)}</td>
                    <td className="py-3 pr-3 text-right font-mono text-xs tabular-nums text-muted-foreground">{formatMs(trace.timings.ttftMs)}</td>
                    <td className="py-3 pr-3 text-right font-mono text-xs tabular-nums text-muted-foreground">{formatMs(trace.timings.retrievalMs)}</td>
                    <td className="py-3 pr-3 text-right font-mono text-xs tabular-nums text-muted-foreground">{tokens(trace).toLocaleString()}</td>
                    <td className="py-3 pr-4 text-right font-mono text-xs tabular-nums">{formatUsd(trace.costUsd)}</td>
                  </tr>
                  <AnimatePresence initial={false}>
                    {open && (
                      <tr className="border-b border-border/50">
                        <td colSpan={9} className="p-0">
                          <motion.div
                            initial={{ height: 0, opacity: 0 }}
                            animate={{ height: "auto", opacity: 1 }}
                            exit={{ height: 0, opacity: 0 }}
                            transition={{ duration: 0.3, ease: [0.2, 0.8, 0.2, 1] }}
                            className="overflow-hidden"
                          >
                            <TraceDetail trace={trace} />
                          </motion.div>
                        </td>
                      </tr>
                    )}
                  </AnimatePresence>
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Section({ title, children, className }: { title: string; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("space-y-3", className)}>
      <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

function TraceDetail({ trace }: { trace: TraceView }) {
  const cited = new Set(trace.citations.map((c) => c.chunkId));
  const maxFused = Math.max(...trace.retrieval.map((r) => r.fusedScore), 0);
  const totalCost = trace.usage.reduce((n, u) => n + (u.costUsd ?? 0), 0);
  const totalTokens = Math.max(tokens(trace), 1);
  return (
    <div className="grid gap-8 bg-gradient-to-b from-muted/30 to-transparent px-6 py-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)]">
      <div className="space-y-8">
        <Section title="Latency waterfall">
          <Waterfall timings={trace.timings} />
        </Section>
        <Section title="Pipeline">
          <dl className="grid grid-cols-[120px_1fr] gap-y-1.5 text-xs">
            <dt className="text-muted-foreground">LLM</dt>
            <dd className="font-mono">{trace.llmModel ?? trace.llmProvider}</dd>
            <dt className="text-muted-foreground">Embeddings</dt>
            <dd className="font-mono">{trace.embeddingModel}</dd>
            <dt className="text-muted-foreground">Reranker</dt>
            <dd className="font-mono">{trace.reranker ?? "none"}</dd>
            <dt className="text-muted-foreground">Search query</dt>
            <dd className="font-mono">{trace.rewrittenQuery ?? "—"}</dd>
          </dl>
          {trace.error && <p className="text-xs text-destructive">{trace.error}</p>}
        </Section>
        {trace.answer && (
          <Section title="Answer">
            <p className="surface whitespace-pre-wrap p-4 text-xs leading-relaxed text-foreground/85">{trace.answer}</p>
          </Section>
        )}
      </div>

      <div className="space-y-8">
        <Section title="Tokens & cost">
          {trace.usage.length === 0 ? (
            <p className="text-xs text-muted-foreground">No paid model calls — offline providers.</p>
          ) : (
            <div className="space-y-3">
              <div className="flex h-2 overflow-hidden rounded-full bg-muted" title="input · cached · output">
                {(["inputTokens", "cacheReadTokens", "outputTokens"] as const).map((k, i) => (
                  <span
                    key={k}
                    className={["bg-primary/80", "bg-success/80", "bg-vector/80"][i]}
                    style={{ width: `${(trace.usage.reduce((n, u) => n + u[k], 0) / totalTokens) * 100}%` }}
                  />
                ))}
              </div>
              <div className="flex gap-4 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-primary/80" /> input</span>
                <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-success/80" /> cache read</span>
                <span className="inline-flex items-center gap-1"><span className="size-2 rounded-full bg-vector/80" /> output</span>
              </div>
              <table className="w-full text-xs">
                <thead className="text-muted-foreground">
                  <tr className="text-left">
                    <th className="pb-1 font-normal">Step</th>
                    <th className="pb-1 font-normal">Model</th>
                    <th className="pb-1 text-right font-normal">In</th>
                    <th className="pb-1 text-right font-normal">Cached</th>
                    <th className="pb-1 text-right font-normal">Out</th>
                    <th className="pb-1 text-right font-normal">Cost</th>
                  </tr>
                </thead>
                <tbody className="font-mono tabular-nums">
                  {trace.usage.map((u, i) => (
                    <tr key={i} className="border-t border-border/40">
                      <td className="py-1 font-sans capitalize">{u.step}</td>
                      <td className="max-w-[130px] truncate py-1">{u.model}</td>
                      <td className="py-1 text-right">{u.inputTokens.toLocaleString()}</td>
                      <td className="py-1 text-right">{u.cacheReadTokens.toLocaleString()}</td>
                      <td className="py-1 text-right">{u.outputTokens.toLocaleString()}</td>
                      <td className="py-1 text-right">
                        {formatUsd(u.costUsd)}
                        {totalCost > 0 && u.costUsd !== null && (
                          <span className="ml-1 text-muted-foreground">({Math.round((u.costUsd / totalCost) * 100)}%)</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section title="Retrieved chunks">
          <ul className="space-y-2.5">
            {trace.retrieval.map((r, i) => (
              <li key={r.chunkId} className="space-y-1">
                <div className="flex items-center gap-2 text-xs">
                  <span className="grid size-5 place-items-center rounded bg-muted font-mono text-[10px]">{i + 1}</span>
                  <span className="font-mono text-muted-foreground">{r.chunkId.slice(0, 8)}</span>
                  {cited.has(r.chunkId) && <Badge variant="success">cited</Badge>}
                  <span className="ml-auto flex gap-1">
                    {r.ftsRank !== null && <Badge variant="fts">FTS #{r.ftsRank}</Badge>}
                    {r.vectorRank !== null && <Badge variant="vector">vec #{r.vectorRank}</Badge>}
                  </span>
                </div>
                <ScoreBar label="RRF" value={maxFused ? r.fusedScore / maxFused : 0} display={r.fusedScore.toFixed(4)} />
              </li>
            ))}
          </ul>
        </Section>
      </div>
    </div>
  );
}
