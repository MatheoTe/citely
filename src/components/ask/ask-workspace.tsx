"use client";

import Link from "next/link";
import {
  AlertCircle,
  ArrowRight,
  ArrowUp,
  Check,
  CircleSlash,
  Clock,
  Coins,
  Combine,
  Copy,
  CornerDownRight,
  Loader2,
  Quote,
  RotateCcw,
  ScanSearch,
  Sparkles,
  SquarePen,
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { type ReactNode, useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { answerForClipboard } from "@/lib/citations";
import { cn, formatMs, formatUsd, sectionLabel } from "@/lib/utils";
import { AnswerMarkdown } from "./answer-markdown";
import { PipelineView } from "./pipeline-view";
import { SourceCard } from "./source-card";
import { SourcePanel } from "./source-panel";
import { type Turn, useAsk } from "./use-ask";

const SUGGESTIONS = [
  "How long are dead-lettered events kept?",
  "What does error KR-4291 mean?",
  "How long is parental leave?",
  "Which laptops can new engineers choose from?",
  "How long did the March 2025 delivery incident last?",
  "How much does the Scale plan cost?",
];

const FEATURES = [
  { icon: Combine, title: "Hybrid retrieval", body: "Postgres full-text and pgvector, fused with Reciprocal Rank Fusion." },
  { icon: Quote, title: "Every claim cited", body: "Inline citations open the exact chunk and page they came from." },
  { icon: ScanSearch, title: "Measured, not vibes", body: "A golden-set eval gates CI on recall, MRR and citation precision." },
];

interface Selection {
  turnId: string;
  index: number;
  claim: string | null;
}

const ease = [0.2, 0.8, 0.2, 1] as const;

export function AskWorkspace({ stats }: { stats?: ReactNode }) {
  const { turns, ask, regenerate, reset, busy } = useAsk();
  const [selection, setSelection] = useState<Selection | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const last = turns.at(-1);
  const progressKey = `${turns.length}:${last?.answer.length ?? 0}:${last?.sources.length ?? 0}`;
  useEffect(() => {
    if (turns.length) bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [progressKey, turns.length]);

  const submit = (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 3 || busy) return false;
    setSelection(null);
    ask(trimmed);
    return true;
  };

  const selectedTurn = selection ? turns.find((t) => t.id === selection.turnId) : undefined;
  const selectedSource = selectedTurn?.sources.find((s) => s.index === selection?.index);
  const maxFused = Math.max(...(selectedTurn?.sources.map((s) => s.fusedScore) ?? [0]));

  if (turns.length === 0) {
    return <Hero onSubmit={submit} stats={stats} />;
  }

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-6 flex items-center justify-between">
        <p className="text-xs text-muted-foreground">
          {turns.length} {turns.length === 1 ? "question" : "questions"} · follow-ups use the conversation as context
        </p>
        <Button variant="ghost" size="sm" onClick={reset}>
          <SquarePen /> New conversation
        </Button>
      </div>

      <ol className="space-y-10 pb-44">
        {turns.map((turn) => (
          <TurnView
            key={turn.id}
            turn={turn}
            activeIndex={selection?.turnId === turn.id ? selection.index : null}
            onCite={(index, claim) => setSelection({ turnId: turn.id, index, claim })}
            onRegenerate={() => regenerate(turn.id)}
            onFollowUp={(q) => submit(q)}
            busy={busy}
          />
        ))}
      </ol>
      <div ref={bottomRef} />

      <div className="fixed inset-x-0 bottom-0 z-30 bg-gradient-to-t from-background via-background/85 to-transparent px-4 pb-5 pt-10">
        <div className="mx-auto max-w-3xl">
          <Composer onSubmit={submit} busy={busy} placeholder="Ask a follow-up…" />
        </div>
      </div>

      <AnimatePresence>
        {selectedSource && selectedTurn && (
          <SourcePanel
            key={`${selectedTurn.id}-${selectedSource.index}`}
            source={selectedSource}
            claim={selection?.claim ?? null}
            maxFused={maxFused}
            onClose={() => setSelection(null)}
          />
        )}
      </AnimatePresence>
    </div>
  );
}

function Hero({ onSubmit, stats }: { onSubmit: (q: string) => boolean; stats?: ReactNode }) {
  return (
    <div className="mx-auto flex max-w-3xl flex-col items-center pt-6 text-center sm:pt-12">
      <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease }}>
        <Badge className="mb-6 gap-1.5 px-3 py-1 text-xs">
          <Sparkles /> Hybrid retrieval · grounded answers · evals in CI
        </Badge>
      </motion.div>
      <motion.h1
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.05, ease }}
        className="text-balance text-5xl font-semibold leading-[1.02] tracking-[-0.035em] sm:text-7xl"
      >
        Ask your documents.
        <br />
        <span className="text-gradient font-serif text-[1.08em] font-normal italic tracking-[-0.01em]">Verify every answer.</span>
      </motion.h1>
      <motion.p
        initial={{ opacity: 0, y: 14 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.7, delay: 0.12, ease }}
        className="mt-6 max-w-xl text-pretty text-[15.5px] leading-relaxed text-muted-foreground"
      >
        Citevia finds the passages that matter with hybrid search and answers only from them. Every claim links to the exact
        chunk and page it came from — and when the documents don&apos;t say, neither does Citevia.
      </motion.p>

      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.7, delay: 0.2, ease }}
        className="mt-10 w-full"
      >
        <Composer onSubmit={onSubmit} busy={false} autoFocus size="lg" placeholder="Ask anything about the corpus…" />
      </motion.div>

      <div className="mt-5 flex flex-wrap justify-center gap-2">
        {SUGGESTIONS.map((q, i) => (
          <motion.button
            key={q}
            type="button"
            data-testid="suggestion"
            onClick={() => onSubmit(q)}
            initial={{ opacity: 0, y: 8 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.3 + i * 0.05, ease }}
            className="surface surface-interactive group inline-flex items-center gap-1.5 rounded-full px-3.5 py-1.5 text-[13px] text-foreground/85"
          >
            {q}
            <ArrowRight className="size-3 -translate-x-0.5 opacity-0 transition-all group-hover:translate-x-0 group-hover:opacity-100" />
          </motion.button>
        ))}
      </div>

      {stats && (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.55, ease }}
          className="mt-12 w-full"
        >
          {stats}
        </motion.div>
      )}

      <div className="mt-4 grid w-full gap-3 text-left sm:grid-cols-3">
        {FEATURES.map(({ icon: Icon, title, body }, i) => (
          <motion.div
            key={title}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.6, delay: 0.65 + i * 0.07, ease }}
            className="surface surface-interactive p-4"
          >
            <span className="mb-3 grid size-8 place-items-center rounded-lg bg-primary/15 text-primary ring-1 ring-primary/25">
              <Icon className="size-4" />
            </span>
            <p className="font-display text-sm font-semibold">{title}</p>
            <p className="mt-1 text-[13px] leading-relaxed text-muted-foreground">{body}</p>
          </motion.div>
        ))}
      </div>
    </div>
  );
}

function Composer({
  onSubmit,
  busy,
  placeholder,
  autoFocus,
  size = "default",
}: {
  onSubmit: (q: string) => boolean;
  busy: boolean;
  placeholder: string;
  autoFocus?: boolean;
  size?: "default" | "lg";
}) {
  const [value, setValue] = useState("");
  const send = () => {
    if (onSubmit(value)) setValue("");
  };
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        send();
      }}
      className={cn(
        "surface group relative flex items-end gap-2 rounded-2xl p-2 transition-shadow duration-300 focus-within:shadow-[var(--shadow-elevated),var(--shadow-glow)]",
        size === "lg" && "p-2.5",
      )}
    >
      <textarea
        aria-label="Question"
        placeholder={placeholder}
        value={value}
        rows={1}
        maxLength={1000}
        autoFocus={autoFocus}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            send();
          }
        }}
        className={cn(
          "field-sizing-content max-h-40 min-h-10 flex-1 resize-none bg-transparent px-3 py-2 text-[15px] outline-none placeholder:text-muted-foreground/80",
          size === "lg" && "min-h-12 py-3 text-base",
        )}
      />
      <span className="mb-2.5 hidden select-none font-mono text-[10px] text-muted-foreground/70 sm:block">⏎ to ask</span>
      <Button type="submit" size="icon" disabled={busy || value.trim().length < 3} aria-label="Ask" className={cn(size === "lg" && "size-11")}>
        {busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
      </Button>
    </form>
  );
}

function TurnView({
  turn,
  activeIndex,
  onCite,
  onRegenerate,
  onFollowUp,
  busy,
}: {
  turn: Turn;
  activeIndex: number | null;
  onCite: (index: number, claim: string | null) => void;
  onRegenerate: () => void;
  onFollowUp: (q: string) => void;
  busy: boolean;
}) {
  const cited = new Set(turn.citedIndices);
  const fused = turn.sources.map((s) => s.fusedScore);
  const maxFused = Math.max(...fused, 0);
  const minFused = Math.min(...fused, maxFused);
  // RRF scores of a result set are close together; stretch them so the bars show the actual ordering.
  const relevance = (score: number) => (maxFused === minFused ? 1 : 0.15 + (0.85 * (score - minFused)) / (maxFused - minFused));
  const settled = turn.status !== "streaming";
  const followUps = settled
    ? turn.sources
        .filter((s) => !cited.has(s.index) && sectionLabel(s.headingPath))
        .map((s) => ({ label: sectionLabel(s.headingPath).split(" › ").at(-1)!, question: `What does the ${s.documentTitle} say about ${sectionLabel(s.headingPath).split(" › ").at(-1)!.toLowerCase()}?` }))
        .filter((f, i, arr) => arr.findIndex((o) => o.label === f.label) === i)
        .slice(0, 3)
    : [];

  return (
    <motion.li initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, ease }} className="space-y-4">
      <div className="flex justify-end">
        <p className="max-w-[85%] rounded-2xl rounded-br-md bg-gradient-to-b from-primary/90 to-primary px-4 py-2.5 text-[14.5px] text-primary-foreground shadow-[inset_0_1px_0_0_rgb(255_255_255/0.2),0_8px_24px_-10px_var(--primary)]">
          {turn.question}
        </p>
      </div>

      <div className="surface overflow-hidden" data-testid="answer">
        <div className={cn("border-b border-border/60 px-5 pb-3 pt-4 transition-colors", settled && "bg-muted/20")}>
          <PipelineView stages={turn.stages} compact={settled} />
        </div>

        <div className="px-6 py-5">
          {turn.status === "error" ? (
            <p className="flex items-center gap-2 text-sm text-destructive">
              <AlertCircle className="size-4" /> {turn.error}
            </p>
          ) : turn.answer === "" ? (
            <div className="space-y-2.5 py-1">
              <div className="shimmer h-3 w-11/12 rounded" />
              <div className="shimmer h-3 w-9/12 rounded" />
              <div className="shimmer h-3 w-10/12 rounded" />
            </div>
          ) : (
            <AnswerMarkdown
              text={turn.answer}
              sources={turn.sources}
              streaming={turn.status === "streaming"}
              activeIndex={activeIndex}
              onCite={onCite}
            />
          )}
        </div>

        {settled && (
          <div className="flex flex-wrap items-center gap-2 border-t border-border/60 px-4 py-2.5 text-xs text-muted-foreground">
            {turn.answerable === false && (
              <Badge variant="warning">
                <CircleSlash /> Not in documents
              </Badge>
            )}
            {turn.answerable && turn.citedIndices.length > 0 && (
              <Badge variant="success">
                <Check /> {turn.citedIndices.length} {turn.citedIndices.length === 1 ? "source" : "sources"} cited
              </Badge>
            )}
            {turn.timings && (
              <span className="inline-flex items-center gap-1" title={`retrieval ${formatMs(turn.timings.retrievalMs)} · first token ${formatMs(turn.timings.ttftMs)}`}>
                <Clock className="size-3" /> {formatMs(turn.timings.totalMs)}
              </span>
            )}
            <span className="inline-flex items-center gap-1">
              <Coins className="size-3" /> {formatUsd(turn.costUsd)}
            </span>
            <span className="ml-auto flex items-center gap-1">
              <CopyButton text={answerForClipboard(turn.answer, turn.sources, turn.citedIndices)} />
              <Button variant="ghost" size="sm" onClick={onRegenerate} disabled={busy} aria-label="Regenerate answer">
                <RotateCcw /> Regenerate
              </Button>
              {turn.traceId && (
                <Button asChild variant="ghost" size="sm">
                  <Link href={`/traces#trace-${turn.traceId}`}>Trace</Link>
                </Button>
              )}
            </span>
          </div>
        )}
      </div>

      {turn.sources.length > 0 && (
        <div className="grid gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
          {turn.sources.map((source, i) => (
            <SourceCard
              key={source.chunkId}
              source={source}
              order={i}
              relevance={relevance(source.fusedScore)}
              cited={cited.has(source.index)}
              settled={settled}
              active={activeIndex === source.index}
              onOpen={() => onCite(source.index, null)}
            />
          ))}
        </div>
      )}

      {followUps.length > 0 && (
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="inline-flex items-center gap-1 text-xs text-muted-foreground">
            <CornerDownRight className="size-3" /> Related
          </span>
          {followUps.map((f) => (
            <button
              key={f.label}
              type="button"
              disabled={busy}
              onClick={() => onFollowUp(f.question)}
              className="rounded-full border border-border bg-muted/40 px-3 py-1 text-xs text-foreground/80 transition-colors hover:border-primary/40 hover:text-foreground disabled:opacity-50"
            >
              {f.label}
            </button>
          ))}
        </div>
      )}
    </motion.li>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <Button
      variant="ghost"
      size="sm"
      aria-label="Copy answer"
      onClick={async () => {
        await navigator.clipboard.writeText(text).catch(() => {});
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
    >
      {copied ? <Check /> : <Copy />} {copied ? "Copied" : "Copy"}
    </Button>
  );
}
