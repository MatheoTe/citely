"use client";

import Link from "next/link";
import { AlertCircle, ArrowUp, CircleSlash, Clock, Coins, Loader2, Sparkles } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn, formatMs, formatUsd, pageLabel, sectionLabel } from "@/lib/utils";
import { AnswerText } from "./answer-text";
import { SourcePanel } from "./source-panel";
import { type Turn, useAsk } from "./use-ask";

const EXAMPLES = [
  "How long are dead-lettered events kept?",
  "What does error KR-4291 mean?",
  "How long is parental leave?",
  "Which laptops can new engineers choose from?",
];

interface Selection {
  turnId: string;
  index: number;
}

export function AskWorkspace() {
  const { turns, ask, busy } = useAsk();
  const [question, setQuestion] = useState("");
  const [selection, setSelection] = useState<Selection | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);

  const lastAnswerLength = turns.at(-1)?.answer.length ?? 0;
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [turns.length, lastAnswerLength]);

  const submit = (q: string) => {
    const trimmed = q.trim();
    if (trimmed.length < 3 || busy) return;
    setQuestion("");
    setSelection(null);
    void ask(trimmed);
  };

  const selectedTurn = selection ? turns.find((t) => t.id === selection.turnId) : undefined;
  const selectedSource = selectedTurn?.sources.find((s) => s.index === selection?.index);

  return (
    <div className={cn("grid gap-6", selectedSource && "lg:grid-cols-[minmax(0,1fr)_380px]")}>
      <section className="min-w-0">
        {turns.length === 0 ? (
          <EmptyState onPick={submit} />
        ) : (
          <ol className="space-y-8 pb-40">
            {turns.map((turn) => (
              <TurnView
                key={turn.id}
                turn={turn}
                activeIndex={selection?.turnId === turn.id ? selection.index : null}
                onCite={(index) => setSelection({ turnId: turn.id, index })}
              />
            ))}
          </ol>
        )}
        <div ref={bottomRef} />

        <form
          className="sticky bottom-4 mt-6"
          onSubmit={(e) => {
            e.preventDefault();
            submit(question);
          }}
        >
          <div className="flex items-end gap-2 rounded-2xl border bg-card p-2 shadow-lg">
            <Textarea
              aria-label="Question"
              placeholder="Ask a question about your documents…"
              value={question}
              rows={1}
              maxLength={1000}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  submit(question);
                }
              }}
              className="min-h-10 border-0 shadow-none focus-visible:ring-0"
            />
            <Button type="submit" size="icon" disabled={busy || question.trim().length < 3} aria-label="Ask">
              {busy ? <Loader2 className="animate-spin" /> : <ArrowUp />}
            </Button>
          </div>
        </form>
      </section>

      {selectedSource && (
        <div className="lg:sticky lg:top-20 lg:self-start">
          <SourcePanel source={selectedSource} onClose={() => setSelection(null)} />
        </div>
      )}
    </div>
  );
}

function EmptyState({ onPick }: { onPick: (q: string) => void }) {
  return (
    <div className="mx-auto max-w-2xl py-12 text-center">
      <Badge className="mb-4">
        <Sparkles /> Grounded answers with citations
      </Badge>
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">Ask your documents.</h1>
      <p className="mt-3 text-muted-foreground">
        Citely retrieves the most relevant passages with hybrid search and answers only from them. Every claim links to the
        exact chunk and page it came from — and when the documents don&apos;t say, it says so.
      </p>
      <div className="mt-8 grid gap-2 text-left sm:grid-cols-2">
        {EXAMPLES.map((example) => (
          <button
            key={example}
            type="button"
            onClick={() => onPick(example)}
            className="rounded-xl border bg-card p-4 text-sm transition-colors hover:border-primary/50 hover:bg-accent/40"
          >
            {example}
          </button>
        ))}
      </div>
      <p className="mt-6 text-xs text-muted-foreground">
        The sample corpus is a fictional company handbook, API reference, postmortem and policies.{" "}
        <Link href="/documents" className="underline underline-offset-2">
          Upload your own
        </Link>
        .
      </p>
    </div>
  );
}

function TurnView({ turn, activeIndex, onCite }: { turn: Turn; activeIndex: number | null; onCite: (i: number) => void }) {
  const cited = new Set(turn.citedIndices);
  return (
    <li className="space-y-3">
      <p className="ml-auto w-fit max-w-[85%] rounded-2xl rounded-br-sm bg-primary px-4 py-2 text-sm text-primary-foreground">
        {turn.question}
      </p>

      <div className="rounded-2xl border bg-card p-5 shadow-xs" data-testid="answer">
        {turn.status === "error" ? (
          <p className="flex items-center gap-2 text-sm text-destructive">
            <AlertCircle className="size-4" /> {turn.error}
          </p>
        ) : turn.answer === "" ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="size-4 animate-spin" /> {turn.sources.length ? "Writing answer…" : "Searching documents…"}
          </p>
        ) : (
          <AnswerText
            text={turn.answer}
            sourceCount={turn.sources.length}
            streaming={turn.status === "streaming"}
            activeIndex={activeIndex}
            onCite={onCite}
          />
        )}

        {turn.status === "done" && (
          <div className="mt-4 flex flex-wrap items-center gap-2 border-t pt-3 text-xs text-muted-foreground">
            {turn.answerable === false && (
              <Badge variant="warning">
                <CircleSlash /> Not in documents
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
            {turn.traceId && (
              <Link href={`/traces#trace-${turn.traceId}`} className="ml-auto underline-offset-2 hover:underline">
                View trace
              </Link>
            )}
          </div>
        )}
      </div>

      {turn.sources.length > 0 && (
        <div className="grid gap-2 sm:grid-cols-2">
          {turn.sources.map((source) => {
            const isCited = cited.has(source.index);
            const page = pageLabel(source.pageStart, source.pageEnd);
            return (
              <button
                key={source.chunkId}
                type="button"
                data-testid="source-card"
                onClick={() => onCite(source.index)}
                className={cn(
                  "flex items-start gap-2 rounded-lg border p-3 text-left text-xs transition-colors hover:border-primary/50",
                  activeIndex === source.index && "border-primary bg-accent/40",
                  turn.status === "done" && !isCited && "opacity-60",
                )}
              >
                <span
                  className={cn(
                    "grid size-5 shrink-0 place-items-center rounded font-mono text-[11px] font-semibold",
                    isCited ? "bg-primary text-primary-foreground" : "bg-muted",
                  )}
                >
                  {source.index}
                </span>
                <span className="min-w-0">
                  <span className="block truncate font-medium">{source.documentTitle}</span>
                  <span className="block truncate text-muted-foreground">
                    {[sectionLabel(source.headingPath), page].filter(Boolean).join(" · ") || "—"}
                  </span>
                </span>
              </button>
            );
          })}
        </div>
      )}
    </li>
  );
}
