"use client";

import { useCallback, useRef, useState } from "react";
import type { AskEvent, SourceView, TimingsView } from "@/lib/ask-events";

export interface Turn {
  id: string;
  question: string;
  status: "streaming" | "done" | "error";
  answer: string;
  sources: SourceView[];
  citedIndices: number[];
  answerable: boolean | null;
  traceId: string | null;
  timings: TimingsView | null;
  costUsd: number | null;
  error: string | null;
}

/** Reads the NDJSON event stream of POST /api/ask and folds it into conversation turns. */
export function useAsk() {
  const [turns, setTurns] = useState<Turn[]>([]);
  const abortRef = useRef<AbortController | null>(null);

  const update = (id: string, patch: (t: Turn) => Partial<Turn>) =>
    setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch(t) } : t)));

  const ask = useCallback(async (question: string) => {
    abortRef.current?.abort();
    const controller = new AbortController();
    abortRef.current = controller;
    const id = crypto.randomUUID();
    setTurns((prev) => [
      ...prev,
      {
        id,
        question,
        status: "streaming",
        answer: "",
        sources: [],
        citedIndices: [],
        answerable: null,
        traceId: null,
        timings: null,
        costUsd: null,
        error: null,
      },
    ]);

    const apply = (event: AskEvent) => {
      switch (event.type) {
        case "meta":
          update(id, () => ({ traceId: event.traceId }));
          break;
        case "sources":
          update(id, () => ({ sources: event.sources }));
          break;
        case "delta":
          update(id, (t) => ({ answer: t.answer + event.text }));
          break;
        case "done":
          update(id, () => ({
            status: "done",
            answer: event.answer,
            answerable: event.answerable,
            citedIndices: event.citations.map((c) => c.index),
            timings: event.timings,
            costUsd: event.costUsd,
          }));
          break;
        case "error":
          update(id, () => ({ status: "error", error: event.error.message }));
          break;
      }
    };

    try {
      const res = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question }),
        signal: controller.signal,
      });
      if (!res.ok || !res.body) {
        const body = (await res.json().catch(() => null)) as { error?: { message?: string } } | null;
        update(id, () => ({ status: "error", error: body?.error?.message ?? `Request failed (${res.status})` }));
        return;
      }
      const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
      let buffer = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let newline: number;
        while ((newline = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newline).trim();
          buffer = buffer.slice(newline + 1);
          if (line) apply(JSON.parse(line) as AskEvent);
        }
      }
    } catch (err) {
      if ((err as Error).name !== "AbortError") update(id, () => ({ status: "error", error: "Network error, please retry." }));
    }
  }, []);

  return { turns, ask, busy: turns.at(-1)?.status === "streaming" };
}
