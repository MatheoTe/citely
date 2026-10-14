/**
 * Citevia evaluation harness.
 *
 *   npm run eval            retrieval + generation with the configured providers
 *   npm run eval -- --retrieval-only
 *   npm run eval:ci         offline providers only, fails under eval/thresholds.json
 *   npm run eval:sweep      chunk-size sweep (retrieval metrics per chunk size)
 *
 * Every run builds a fresh in-memory Postgres (PGlite + pgvector) from the
 * bundled corpus, so results are hermetic and reproducible.
 */
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { eq } from "drizzle-orm";
import { getEnv } from "@/server/config/env";
import { createDb, type DbHandle } from "@/server/db/client";
import { chunks, documents, traces } from "@/server/db/schema";
import { runMigrations } from "@/server/db/migrate";
import { answerQuestion, toPassage } from "@/server/generation/answer";
import { llmCostUsd } from "@/server/observability/pricing";
import { enqueueDocument, processDocument } from "@/server/ingest/pipeline";
import { type Providers, describeProviders, resolveProviders } from "@/server/providers";
import { LocalHashEmbeddingProvider } from "@/server/providers/embeddings/local-hash";
import { OfflineLlmProvider } from "@/server/providers/llm/offline";
import { type RetrievalMode, retrieve } from "@/server/retrieval/hybrid";
import { isAbstention } from "@/lib/citations";
import { estimateTokens } from "@/server/ingest/text";
import { loadGoldenSet, type GoldenQuestion } from "./dataset";
import { citationPrecision, containsKeyFacts, matchesItem, recallAtBudget, mean, reciprocalRank, recallAtK } from "./metrics";

const args = new Set(process.argv.slice(2));
const CI = args.has("--ci");
const SWEEP = args.has("--sweep");
const RETRIEVAL_ONLY = args.has("--retrieval-only");
const KS = [1, 3, 5, 10] as const;
const GENERATION_K = 6;

interface Index {
  handle: DbHandle;
  chunkCount: number;
  avgChunkTokens: number;
}

async function buildIndex(providers: Providers, targetTokens: number, overlapTokens: number, respectHeadings = true): Promise<Index> {
  const handle = await createDb("pglite://memory");
  await runMigrations(handle);
  const deps = { db: handle.db, embeddings: providers.embeddings, chunkOptions: { targetTokens, overlapTokens, respectHeadings } };
  const dir = path.resolve("corpus");
  for (const filename of (await readdir(dir)).filter((f) => /\.(md|pdf)$/.test(f)).sort()) {
    const bytes = new Uint8Array(await readFile(path.join(dir, filename)));
    const { document } = await enqueueDocument(handle.db, { filename, bytes });
    const result = await processDocument(deps, document.id);
    if (result?.status !== "ready") throw new Error(`failed to ingest ${filename}: ${result?.error}`);
  }
  const rows = await handle.db.select({ tokens: chunks.tokenCount }).from(chunks);
  return {
    handle,
    chunkCount: rows.length,
    avgChunkTokens: Math.round(rows.reduce((n, r) => n + r.tokens, 0) / rows.length),
  };
}

/** Guard against label rot: every evidence string must exist in some chunk of its document. */
async function assertEvidenceExists(index: Index, questions: GoldenQuestion[]) {
  const rows = await index.handle.db
    .select({ filename: documents.filename, content: chunks.content })
    .from(chunks)
    .innerJoin(documents, eq(documents.id, chunks.documentId));
  const missing = questions.flatMap((q) =>
    q.expected.filter((item) => !rows.some((r) => matchesItem(r, item))).map((item) => `${q.id} → ${item.document}: ${item.evidence.join(" | ")}`),
  );
  if (missing.length) throw new Error(`golden labels not found in corpus:\n  ${missing.join("\n  ")}`);
}

interface RetrievalSummary {
  config: string;
  recall: Record<`@${(typeof KS)[number]}`, number>;
  mrr: number;
  /** Recall within a 500 / 1,000-token context budget. */
  budgeted: { "500": number; "1000": number };
  p50Ms: number;
  p95Ms: number;
  perQuestion: { id: string; tags: string[]; recallAt5: number; rr: number }[];
}

const percentile = (values: number[], p: number) => {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))] ?? 0;
};

async function evalRetrieval(
  index: Index,
  providers: Providers,
  questions: GoldenQuestion[],
  config: { name: string; mode: RetrievalMode; rerank: boolean },
): Promise<RetrievalSummary> {
  const answerable = questions.filter((q) => q.answerable);
  const recalls: Record<number, number[]> = Object.fromEntries(KS.map((k) => [k, []]));
  const rrs: number[] = [];
  const budget500: number[] = [];
  const budget1000: number[] = [];
  const latencies: number[] = [];
  const perQuestion: RetrievalSummary["perQuestion"] = [];

  for (const q of answerable) {
    const start = performance.now();
    const res = await retrieve(
      { db: index.handle.db, embeddings: providers.embeddings, reranker: config.rerank ? providers.reranker : null },
      q.question,
      { k: Math.max(...KS), mode: config.mode, rerank: config.rerank },
    );
    latencies.push(performance.now() - start);
    for (const k of KS) recalls[k].push(recallAtK(res.chunks, q, k));
    const sized = res.chunks.map((c) => ({ ...c, tokens: estimateTokens(c.content) }));
    budget500.push(recallAtBudget(sized, q, 500));
    budget1000.push(recallAtBudget(sized, q, 1000));
    const rr = reciprocalRank(res.chunks, q);
    rrs.push(rr);
    perQuestion.push({ id: q.id, tags: q.tags, recallAt5: recallAtK(res.chunks, q, 5), rr });
  }

  return {
    config: config.name,
    recall: Object.fromEntries(KS.map((k) => [`@${k}`, mean(recalls[k]) ?? 0])) as RetrievalSummary["recall"],
    mrr: mean(rrs) ?? 0,
    budgeted: { "500": mean(budget500) ?? 0, "1000": mean(budget1000) ?? 0 },
    p50Ms: Math.round(percentile(latencies, 50)),
    p95Ms: Math.round(percentile(latencies, 95)),
    perQuestion,
  };
}

interface GenerationRow {
  id: string;
  answerable: boolean;
  abstained: boolean;
  keyFacts: boolean | null;
  citationPrecision: number | null;
  faithfulness: number | null;
  answer: string;
}

/** Cost and latency of the answers themselves, read back from the traces the pipeline wrote. */
async function servingStats(index: Index) {
  const rows = await index.handle.db.select({ cost: traces.costUsd, total: traces.totalMs, timings: traces.timings }).from(traces);
  const ttfts = rows.flatMap((r) => (r.timings.ttftMs === null ? [] : [r.timings.ttftMs]));
  return {
    answerCostUsd: rows.reduce((n, r) => n + (r.cost ?? 0), 0),
    latencyP50Ms: Math.round(percentile(rows.map((r) => r.total), 50)),
    latencyP95Ms: Math.round(percentile(rows.map((r) => r.total), 95)),
    ttftP50Ms: Math.round(percentile(ttfts, 50)),
  };
}

async function evalGeneration(index: Index, providers: Providers, questions: GoldenQuestion[]) {
  const filenames = new Map(
    (await index.handle.db.select({ id: documents.id, filename: documents.filename }).from(documents)).map((d) => [d.id, d.filename]),
  );
  const rows: GenerationRow[] = [];
  let judgeCost = 0;
  let judgeErrors = 0;

  for (const q of questions) {
    const outcome = await answerQuestion({ db: index.handle.db, providers }, { question: q.question, k: GENERATION_K }, () => {});
    const abstained = isAbstention(outcome.answer);
    const cited = outcome.citations.map((c) => {
      const s = outcome.sources[c.index - 1];
      return { filename: filenames.get(s.documentId) ?? "", content: s.content };
    });

    let faithfulness: number | null = null;
    if (providers.judge && q.answerable && !abstained) {
      try {
        const verdict = await providers.judge.judge({
          question: q.question,
          answer: outcome.answer,
          sources: outcome.sources.map(toPassage),
        });
        faithfulness = verdict.score;
        judgeCost += llmCostUsd(verdict.usage) ?? 0;
      } catch (err) {
        // A judge failure must not sink the run: the row is reported without a faithfulness score.
        judgeErrors++;
        console.warn(`judge failed on ${q.id}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    rows.push({
      id: q.id,
      answerable: q.answerable,
      abstained,
      keyFacts: q.answerable ? !abstained && containsKeyFacts(outcome.answer, q.mustInclude) : null,
      citationPrecision: q.answerable ? citationPrecision(cited, q) : null,
      faithfulness,
      answer: outcome.answer,
    });
  }

  const answerable = rows.filter((r) => r.answerable);
  const unanswerable = rows.filter((r) => !r.answerable);
  const summary = {
    keyFactAccuracy: mean(answerable.map((r) => (r.keyFacts ? 1 : 0))) ?? 0,
    citationPrecision: mean(answerable.flatMap((r) => (r.citationPrecision === null ? [] : [r.citationPrecision]))),
    answeredWithCitation: mean(answerable.map((r) => (!r.abstained && r.citationPrecision !== null ? 1 : 0))) ?? 0,
    falseAbstentionRate: mean(answerable.map((r) => (r.abstained ? 1 : 0))) ?? 0,
    abstentionAccuracy: mean(unanswerable.map((r) => (r.abstained ? 1 : 0))) ?? 0,
    faithfulness: mean(answerable.flatMap((r) => (r.faithfulness === null ? [] : [r.faithfulness]))),
    judgeCostUsd: judgeCost,
    judgeErrors,
    ...(await servingStats(index)),
  };
  return { summary, rows };
}

const pct = (v: number | null) => (v === null ? "—" : `${(v * 100).toFixed(1)}%`);
const num = (v: number) => v.toFixed(3);

function markdownTable(headers: string[], rows: (string | number)[][]): string {
  const line = (cells: (string | number)[]) => `| ${cells.join(" | ")} |`;
  return [line(headers), line(headers.map(() => "---")), ...rows.map(line)].join("\n");
}

function offlineProviders(): Providers {
  return { llm: new OfflineLlmProvider(), embeddings: new LocalHashEmbeddingProvider(1024), reranker: null, judge: null };
}

async function writeReport(name: string, report: unknown) {
  const dir = path.resolve("eval/reports");
  await mkdir(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  await writeFile(path.join(dir, `${name}-${stamp}.json`), `${JSON.stringify(report, null, 2)}\n`);
  await writeFile(path.join(dir, `${name}-latest.json`.replace(/^eval-/, "")), `${JSON.stringify(report, null, 2)}\n`);
}

async function runSweep(providers: Providers, questions: GoldenQuestion[]) {
  const sizes = [128, 256, 512, 1024];
  const results = [];
  for (const respectHeadings of [true, false]) {
    for (const size of sizes) {
      const overlap = Math.round(size * 0.1875);
      const index = await buildIndex(providers, size, overlap, respectHeadings);
      const r = await evalRetrieval(index, providers, questions, { name: "hybrid", mode: "hybrid", rerank: false });
      results.push({
        strategy: respectHeadings ? "heading-aware" : "fixed window",
        chunkTokens: size,
        overlapTokens: overlap,
        chunks: index.chunkCount,
        avgChunkTokens: index.avgChunkTokens,
        contextTokensAtK6: index.avgChunkTokens * GENERATION_K,
        recall: r.recall,
        mrr: r.mrr,
        budgeted: r.budgeted,
      });
      await index.handle.close();
    }
  }
  console.log(`\nChunking sweep (hybrid retrieval, embeddings=${providers.embeddings.model})\n`);
  console.log(
    markdownTable(
      ["Strategy", "Target", "Chunks", "Avg tokens", "Recall@1", "Recall@5", "MRR@10", "Recall ≤500 tok", "Recall ≤1000 tok"],
      results.map((r) => [r.strategy, r.chunkTokens, r.chunks, r.avgChunkTokens, pct(r.recall["@1"]), pct(r.recall["@5"]), num(r.mrr), pct(r.budgeted["500"]), pct(r.budgeted["1000"])]),
    ),
  );
  await writeReport("sweep", { generatedAt: new Date().toISOString(), embeddings: providers.embeddings.model, results });
}

async function main() {
  const env = getEnv();
  const providers = CI ? offlineProviders() : resolveProviders(env);
  const mode = describeProviders(providers);
  const questions = await loadGoldenSet();
  console.log(
    `Citevia eval — ${questions.length} questions (${questions.filter((q) => !q.answerable).length} unanswerable)\n` +
      `providers: llm=${mode.llm} · embeddings=${mode.embeddings} · reranker=${mode.reranker ?? "none"} · judge=${providers.judge?.model ?? "skipped (no ANTHROPIC_API_KEY)"}`,
  );

  if (SWEEP) return runSweep(providers, questions);

  const chunkTokens = env.CITELY_CHUNK_TOKENS;
  const overlapTokens = env.CITELY_CHUNK_OVERLAP;
  const index = await buildIndex(providers, chunkTokens, overlapTokens);
  await assertEvidenceExists(index, questions);
  console.log(`index: ${index.chunkCount} chunks (target ${chunkTokens} tokens, overlap ${overlapTokens})\n`);

  const configs: { name: string; mode: RetrievalMode; rerank: boolean }[] = [
    { name: "fts only", mode: "fts", rerank: false },
    { name: "vector only", mode: "vector", rerank: false },
    { name: "hybrid (RRF)", mode: "hybrid", rerank: false },
  ];
  if (providers.reranker) configs.push({ name: "hybrid + rerank", mode: "hybrid", rerank: true });

  const retrieval: RetrievalSummary[] = [];
  for (const config of configs) retrieval.push(await evalRetrieval(index, providers, questions, config));

  console.log("Retrieval (answerable questions)\n");
  console.log(
    markdownTable(
      ["Retriever", "Recall@1", "Recall@3", "Recall@5", "Recall@10", "MRR@10", "Recall ≤500 tok", "p50 ms", "p95 ms"],
      retrieval.map((r) => [r.config, pct(r.recall["@1"]), pct(r.recall["@3"]), pct(r.recall["@5"]), pct(r.recall["@10"]), num(r.mrr), pct(r.budgeted["500"]), r.p50Ms, r.p95Ms]),
    ),
  );

  const tags = ["lexical", "identifier", "paraphrase", "table", "pdf", "multi-source"];
  const byTag = tags.map((tag) => [
    `${tag} (n=${retrieval[0].perQuestion.filter((q) => q.tags.includes(tag)).length})`,
    ...retrieval.map((r) => num(mean(r.perQuestion.filter((q) => q.tags.includes(tag)).map((q) => q.rr)) ?? 0)),
  ]);
  console.log("\nMRR@10 by question type\n");
  console.log(markdownTable(["Question type", ...retrieval.map((r) => r.config)], byTag));

  const hybrid = retrieval.find((r) => r.config === "hybrid (RRF)")!;
  const misses = hybrid.perQuestion.filter((q) => q.recallAt5 < 1);
  if (misses.length) console.log(`\nHybrid misses @5: ${misses.map((m) => `${m.id} (${m.recallAt5.toFixed(2)})`).join(", ")}`);

  let generation: Awaited<ReturnType<typeof evalGeneration>> | null = null;
  if (!RETRIEVAL_ONLY) {
    generation = await evalGeneration(index, providers, questions);
    const s = generation.summary;
    console.log(`\nGeneration (llm=${mode.llm}, k=${GENERATION_K})\n`);
    console.log(
      markdownTable(
        ["Key-fact accuracy", "Citation precision", "Answered w/ citation", "False abstention", "Abstention accuracy", "Faithfulness (judge)"],
        [[pct(s.keyFactAccuracy), pct(s.citationPrecision), pct(s.answeredWithCitation), pct(s.falseAbstentionRate), pct(s.abstentionAccuracy), s.faithfulness === null ? "skipped" : pct(s.faithfulness)]],
      ),
    );
    console.log(
      `\nserving: answer cost $${s.answerCostUsd.toFixed(4)} total · latency p50 ${s.latencyP50Ms} ms / p95 ${s.latencyP95Ms} ms · first token p50 ${s.ttftP50Ms} ms` +
        (providers.judge ? ` · judge cost $${s.judgeCostUsd.toFixed(4)}${s.judgeErrors ? ` (${s.judgeErrors} judge errors)` : ""}` : ""),
    );
    const wrong = generation.rows.filter((r) => (r.answerable ? !r.keyFacts : !r.abstained));
    if (wrong.length) console.log(`\nIncorrect / unsupported: ${wrong.map((r) => r.id).join(", ")}`);
  }
  await index.handle.close();

  const report = {
    generatedAt: new Date().toISOString(),
    providers: { ...mode, judge: providers.judge?.model ?? null },
    corpus: { chunks: index.chunkCount, avgChunkTokens: index.avgChunkTokens, chunkTokens, overlapTokens },
    questions: { total: questions.length, unanswerable: questions.filter((q) => !q.answerable).length },
    retrieval: retrieval.map(({ perQuestion, ...r }) => ({ ...r, misses: perQuestion.filter((q) => q.recallAt5 < 1).map((q) => q.id) })),
    generation,
  };
  // The offline run is the committed CI baseline (latest.json); live runs are kept apart.
  const reportName = mode.offline ? "eval" : "live";
  await writeReport(reportName, report);
  console.log(`\nreport → eval/reports/${mode.offline ? "latest" : "live-latest"}.json`);

  if (CI) {
    const thresholds = JSON.parse(await readFile(path.resolve("eval/thresholds.json"), "utf8")) as {
      hybridRecallAt5: number;
      hybridMrr: number;
      keyFactAccuracy: number;
      citationPrecision: number;
      abstentionAccuracy: number;
    };
    const checks: [string, number | null, number][] = [
      ["hybrid recall@5", hybrid.recall["@5"], thresholds.hybridRecallAt5],
      ["hybrid MRR", hybrid.mrr, thresholds.hybridMrr],
      ["key-fact accuracy", generation?.summary.keyFactAccuracy ?? null, thresholds.keyFactAccuracy],
      ["citation precision", generation?.summary.citationPrecision ?? null, thresholds.citationPrecision],
      ["abstention accuracy", generation?.summary.abstentionAccuracy ?? null, thresholds.abstentionAccuracy],
    ];
    const failed = checks.filter(([, value, min]) => value === null || value < min);
    for (const [name, value, min] of checks) console.log(`${value !== null && value >= min ? "✔" : "✘"} ${name}: ${value === null ? "n/a" : value.toFixed(3)} (min ${min})`);
    if (failed.length) {
      console.error(`\nEval regression: ${failed.map(([n]) => n).join(", ")} below threshold`);
      process.exit(1);
    }
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

