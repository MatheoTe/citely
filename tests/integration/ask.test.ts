import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ABSTAIN_ANSWER } from "@/lib/citations";
import type { AskEvent } from "@/lib/ask-events";
import type { DbHandle } from "@/server/db/client";
import { ProviderError } from "@/server/errors";
import { answerQuestion } from "@/server/generation/answer";
import type { Providers } from "@/server/providers";
import { LocalHashEmbeddingProvider } from "@/server/providers/embeddings/local-hash";
import { OfflineLlmProvider } from "@/server/providers/llm/offline";
import type { LlmProvider } from "@/server/providers/llm/types";
import { getTrace } from "@/server/repositories";
import { createTestDb, ingestCorpus, testIngestDeps } from "./helpers";

let handle: DbHandle;
const embeddings = new LocalHashEmbeddingProvider(1024);
const offline: Providers = { llm: new OfflineLlmProvider(), embeddings, reranker: null, judge: null };

beforeAll(async () => {
  handle = await createTestDb();
  await ingestCorpus(testIngestDeps(handle, { embeddings }));
});
afterAll(async () => {
  await handle.close();
});

async function ask(question: string, providers: Providers = offline) {
  const events: AskEvent[] = [];
  const outcome = await answerQuestion({ db: handle.db, providers }, { question, k: 6 }, (e) => events.push(e));
  return { outcome, events };
}

describe("answerQuestion (offline providers)", () => {
  it("streams sources, deltas and a cited answer, and persists a trace", async () => {
    const { outcome, events } = await ask("How long is parental leave?");

    // meta → stage events for rewrite/retrieval → sources → generate → deltas → done
    const types = events.map((e) => e.type).filter((t) => t !== "stage");
    expect(types).toEqual(["meta", "sources", ...types.slice(2, -1).map(() => "delta"), "done"]);
    const stages = events.flatMap((e) => (e.type === "stage" && e.status !== "running" ? [`${e.stage}:${e.status}`] : []));
    expect(stages).toEqual(["rewrite:done", "fts:done", "vector:done", "fuse:done", "rerank:skipped", "generate:done"]);
    expect(events.findIndex((e) => e.type === "sources")).toBeLessThan(events.findIndex((e) => e.type === "delta"));
    const streamed = events.flatMap((e) => (e.type === "delta" ? [e.text] : [])).join("");
    expect(streamed).toBe(outcome.answer);
    expect(outcome.answerable).toBe(true);
    expect(outcome.answer).toContain("20 weeks");
    expect(outcome.citations.length).toBeGreaterThan(0);

    const cited = outcome.sources[outcome.citations[0].index - 1];
    expect(cited.chunkId).toBe(outcome.citations[0].chunkId);
    expect(cited.content).toContain("20 weeks");

    const trace = await getTrace(handle.db, outcome.traceId);
    expect(trace).toMatchObject({
      status: "ok",
      answerable: true,
      llmProvider: "offline",
      embeddingModel: "local-hash-v1@1024",
      costUsd: 0,
    });
    expect(trace.retrieval).toHaveLength(6);
    expect(trace.timings.totalMs).toBeGreaterThanOrEqual(trace.timings.retrievalMs);
    expect(trace.timings.ttftMs).not.toBeNull();
    expect(trace.timings.spans?.map((s) => s.stage)).toEqual(["rewrite", "fts", "vector", "fuse", "generate"]);
    expect(outcome.sources[0]).toMatchObject({ filename: "employee-handbook.md", fusedScore: expect.any(Number) });
  });

  it("resolves follow-up questions against the previous turn", async () => {
    const events: AskEvent[] = [];
    const outcome = await answerQuestion(
      { db: handle.db, providers: offline },
      {
        question: "And what about the Scale plan?",
        k: 6,
        history: [{ question: "How much does the Growth plan cost per month?", answer: "49 US dollars per month [1]." }],
      },
      (e) => events.push(e),
    );
    const rewrite = events.find((e) => e.type === "stage" && e.stage === "rewrite" && e.status === "done");
    expect(rewrite).toMatchObject({ detail: expect.stringContaining("Growth plan") });
    expect(outcome.answer).toContain("399 US dollars");
  });

  it("abstains explicitly when the corpus does not contain the answer", async () => {
    const { outcome, events } = await ask("Who founded Kestrel Labs and in which year?");
    expect(outcome.answer).toBe(ABSTAIN_ANSWER);
    expect(outcome.answerable).toBe(false);
    expect(outcome.citations).toEqual([]);
    const done = events.at(-1);
    expect(done).toMatchObject({ type: "done", answerable: false });
  });

  it("records failures as error traces and emits an error event", async () => {
    const broken: LlmProvider = {
      name: "anthropic",
      answerModel: "claude-sonnet-5-5",
      rewriteQuery: async (q) => ({ query: q, usage: null }),
      streamAnswer: async () => {
        throw new ProviderError("anthropic", "rate limited");
      },
    };
    const events: AskEvent[] = [];
    await expect(
      answerQuestion({ db: handle.db, providers: { ...offline, llm: broken } }, { question: "What is the rate limit?", k: 4 }, (e) =>
        events.push(e),
      ),
    ).rejects.toBeInstanceOf(ProviderError);
    const meta = events[0] as Extract<AskEvent, { type: "meta" }>;
    expect(events.at(-1)).toEqual({ type: "error", error: { code: "PROVIDER_ERROR", message: "anthropic: rate limited" } });
    const trace = await getTrace(handle.db, meta.traceId);
    expect(trace).toMatchObject({ status: "error", error: "anthropic: rate limited" });
  });

  it("costs real model usage from the pricing table", async () => {
    const paid: LlmProvider = {
      name: "anthropic",
      answerModel: "claude-sonnet-5-5",
      rewriteQuery: async (q) => ({
        query: q,
        usage: { model: "claude-haiku-4-5-20251001", inputTokens: 100, outputTokens: 20, cacheReadTokens: 0, cacheWriteTokens: 0 },
      }),
      streamAnswer: async (_req, onDelta) => {
        onDelta("Twenty weeks [1].");
        return {
          text: "Twenty weeks [1].",
          refused: false,
          usage: { model: "claude-sonnet-5-5", inputTokens: 2000, outputTokens: 100, cacheReadTokens: 1000, cacheWriteTokens: 0 },
        };
      },
    };
    const { outcome } = await ask("How long is parental leave?", { ...offline, llm: paid });
    const trace = await getTrace(handle.db, outcome.traceId);
    // haiku: 100*1e-6 + 20*5e-6 ; sonnet: 2000*2e-6 + 100*10e-6 + 1000*0.2e-6
    expect(trace.costUsd).toBeCloseTo(0.0002 + 0.004 + 0.001 + 0.0002, 6);
    expect(trace.usage.map((u) => u.step)).toEqual(["rewrite", "answer"]);
    expect(trace.llmModel).toBe("claude-sonnet-5-5");
  });
});
