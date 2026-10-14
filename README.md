# Citevia

[![Live demo](https://img.shields.io/badge/Live%20demo-citevia.vercel.app-7c5cff?style=for-the-badge&logo=vercel&logoColor=white)](https://citevia.vercel.app)
[![Open in GitHub Codespaces](https://github.com/codespaces/badge.svg)](https://codespaces.new/MatheoTe/citevia)

**Answers you can verify.** Citevia is a retrieval-augmented generation (RAG) app: upload PDFs or Markdown, ask questions, and get answers grounded in your documents — every claim carries an inline citation that opens the exact chunk (and PDF page) it came from. When the documents don't contain the answer, Citevia says so instead of guessing.

It is built like a production service rather than a notebook demo: an idempotent ingestion pipeline, hybrid search inside Postgres, streamed generation with validated citations, per-request traces with cost, rate limiting, typed errors, and an evaluation harness that gates CI.

[![CI](https://img.shields.io/badge/CI-GitHub%20Actions-2088FF?logo=githubactions&logoColor=white)](.github/workflows/ci.yml)
![Next.js](https://img.shields.io/badge/Next.js-16-black?logo=nextdotjs)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-3178C6?logo=typescript&logoColor=white)
![Postgres](https://img.shields.io/badge/Postgres-pgvector-4169E1?logo=postgresql&logoColor=white)
![License](https://img.shields.io/badge/license-MIT-green)

![A Claude answer with inline citation pills; hovering one previews the cited passage with the supporting sentence highlighted](docs/screenshots/citation-preview.jpg)

> **Demo GIF — to record.** A 20–30 s capture with real API keys configured:
> 1. Drag a PDF onto **Documents** and watch it go *Queued → Processing → Ready*.
> 2. On **Ask**, type a question about it; show the answer streaming in.
> 3. Click a citation chip → the source panel opens → **Open in document** jumps to the highlighted chunk/page.
> 4. Ask something the document doesn't cover → *"I don't know based on the provided documents."*
> 5. Open **Traces** and expand the request: latency waterfall, retrieval ranks, tokens and cost.
>
> Save it as `docs/demo.gif` and replace this note with `![Citevia demo](docs/demo.gif)`.

## Contents

- [Features](#features)
- [Architecture](#architecture)
- [Design decisions & trade-offs](#design-decisions--trade-offs)
- [Evaluation](#evaluation)
- [Live demo](#live-demo)
- [Running locally](#running-locally)
- [Testing](#testing)
- [Project structure](#project-structure)
- [Roadmap](#roadmap)

## Features

- **Ingestion pipeline** — PDF text extraction with page numbers and Markdown parsing into one block model; heading-aware chunking with sentence-level overlap; sha256 content addressing so re-uploads are no-ops; background processing with `queued → processing → ready | failed` status, a compare-and-set claim with a lease for crashed workers, and atomic chunk swaps.
- **Hybrid retrieval** — Postgres full-text search (`tsvector`, `ts_rank_cd`, heading-weighted) and pgvector cosine similarity (HNSW), fused with Reciprocal Rank Fusion, plus an optional cross-encoder reranking stage.
- **Grounded generation** — Claude answers only from numbered passages, cites every factual sentence as `[n]`, and returns a fixed abstention sentence when the context is insufficient. Citations are parsed and validated server-side: a marker pointing at a passage that doesn't exist is never rendered as a link.
- **Answer experience** — a live pipeline view (rewrite → full-text → vector → RRF → rerank → generate) whose stage timings fill in as events stream; markdown answers with citation pills; hovering a pill previews the passage with the supporting sentence highlighted, clicking opens a slide-over document view scrolled to the chunk with its FTS rank, vector rank and fused score; source cards with relevance bars and *FTS / vector / both* badges; multi-turn conversations whose follow-ups are rewritten into standalone queries, plus copy and regenerate.
- **Observability** — every request stores a trace: each stage's start offset and duration (rendered as a waterfall with a time-to-first-token marker), the FTS/vector/RRF ranks of each retrieved chunk, token usage including prompt-cache reads, and an estimated cost split per step. The **Traces** page adds p50/p95 latency, cost per request and abstention rate.
- **Ingestion you can watch** — drag-and-drop uploads show live progress (queued → parsing → chunking → embedding → ready) with per-stage timings, and a chunk explorer with an outline, filtering and deep links.
- **Evaluation harness** — `npm run eval` scores retrieval (recall@k, MRR, recall under a token budget) and generation (key-fact accuracy, citation precision, abstention accuracy, LLM-as-judge faithfulness) on a labelled golden set. CI fails if the offline metrics regress.
- **Runs with zero API keys** — every provider sits behind an interface with a deterministic local implementation, so the app, the test suite and CI work offline end to end.
- **Hardening** — zod validation on every input (bodies, params, query strings, env), typed errors mapped to stable JSON responses, token-bucket rate limiting on `/api/ask`, upload size/type checks with magic-number sniffing, a system prompt that treats passages as untrusted data.

### Screenshots

All captured from the running app (dark theme is the default; Claude Sonnet 5.5 answering, local embeddings).

| | |
| --- | --- |
| ![Hero with suggested questions and live corpus stats](docs/screenshots/home.jpg) | ![Live pipeline: stage timings fill in while the answer is generated](docs/screenshots/pipeline-live.jpg) |
| **Empty state** — pitch, suggested questions from the corpus, live corpus stats. | **Live pipeline** — each stage lights up with its timing; the rewritten search query is shown. |
| ![Source panel scrolled to the cited chunk with retrieval evidence bars](docs/screenshots/source-panel.jpg) | ![Trace with latency waterfall, token and cost breakdown](docs/screenshots/traces.jpg) |
| **Source panel** — the document, scrolled to the cited chunk, supporting sentence highlighted, FTS/vector/fused evidence. | **Traces** — latency waterfall with TTFT marker, token split, cost per step, retrieval ranks. |
| ![Documents with animated ingestion progress](docs/screenshots/documents.jpg) | ![Chunk explorer with outline and filter](docs/screenshots/chunk-explorer.jpg) |
| **Documents** — drag-and-drop upload with live five-step ingestion progress. | **Chunk explorer** — outline, filter, page and token badges, deep links from citations. |

The light theme is tuned too: [`docs/screenshots/home-light.jpg`](docs/screenshots/home-light.jpg).

## Architecture

**Ingestion** — `POST /api/documents` stores the upload and returns `202`; the rest runs after the response.

```mermaid
flowchart LR
  U[Upload] --> V{zod + type sniffing}
  V --> H[sha256 content hash]
  H -->|duplicate| D[(existing document)]
  H -->|new| Q[documents: queued<br/>+ document_blobs]
  Q --> C[claim queued → processing<br/>compare-and-set + lease]
  C --> P[parse<br/>PDF pages · Markdown blocks]
  P --> K[heading-aware chunker<br/>256-token target · 48 overlap]
  K --> E[embed via content-addressed cache]
  E --> T[(chunks<br/>HNSW vector index · GIN tsvector)]
  T --> R[documents: ready / failed]
```

**Query** — `POST /api/ask` streams NDJSON events.

```mermaid
flowchart LR
  A[question] --> L{rate limit + zod}
  L --> W[query rewrite<br/>Claude Haiku 4.5]
  W --> F[Postgres FTS<br/>ts_rank_cd]
  W --> VS[pgvector cosine<br/>HNSW]
  F --> RRF[Reciprocal Rank Fusion]
  VS --> RRF
  RRF --> RR[optional rerank<br/>Voyage rerank-3]
  RR --> G[grounded answer<br/>Claude Sonnet 5.5, streamed]
  G --> CP[citation parser<br/>validate n → chunk id]
  CP --> TR[(trace: latency · ranks · tokens · cost)]
  CP --> UI[UI: chip → source panel → chunk/page]
```

| Layer | Choice |
| --- | --- |
| App | Next.js 16 (App Router, Cache Components), React 19, TypeScript strict |
| UI | Tailwind CSS v4 design tokens, shadcn/ui-style components, `motion`, `react-markdown`, Inter Tight + Instrument Serif + Geist, CSS-only animated backdrop (respects `prefers-reduced-motion`) |
| Data | Postgres 17 + pgvector (Docker), Drizzle ORM + SQL migrations; PGlite (WASM Postgres + pgvector) as embedded fallback |
| LLM | `@anthropic-ai/sdk` — `claude-sonnet-5-5` for answers, `claude-haiku-4-5-20251001` for query rewriting and the judge |
| Embeddings / rerank | Voyage `voyage-4` (1024-d) and `rerank-3`; deterministic hashed n-gram embeddings offline |
| Quality | Vitest (unit + integration), Playwright (E2E), ESLint, GitHub Actions |

## Design decisions & trade-offs

### Why hybrid search

Lexical and semantic retrieval fail in opposite places. Full-text search is precise on identifiers, error codes and rare terms (`KR-4291`, `HMAC-SHA256`, `security@kestrel.example`), where embeddings blur; embeddings handle paraphrase and vocabulary mismatch ("holidays" vs "paid time off"), where keywords miss. Running both inside Postgres keeps one datastore and lets a single SQL filter (document scope, status, embedding model) apply to both retrievers.

The full-text query ORs the content terms instead of using `websearch_to_tsquery`, which ANDs every word — for natural-language questions that collapses recall (a chunk would need *how*, *long*, *dead-lettered*, *events* and *kept*). `ts_rank_cd` over a tsvector that weighs headings (A) above body text (B) then rewards chunks matching more, and denser, terms — much closer to BM25 behaviour.

### Why Reciprocal Rank Fusion

`ts_rank_cd` scores and cosine similarities live on unrelated scales that shift with corpus size and query length; a weighted sum needs per-corpus calibration and silently breaks when the embedding model changes. RRF (`Σ 1/(k + rank)`, k = 60) uses only ranks, needs no tuning, and rewards chunks both retrievers agree on. Every trace records the FTS rank, vector rank and fused score of each retrieved chunk, so fusion is inspectable on the Traces page. The cost: RRF discards score magnitudes — a very confident retriever counts the same as one that barely ranked something first. That is what the optional reranker is for.

### Chunking: heading-aware, 256-token target

Chunks never cross a heading boundary, carry their heading path (`Handbook > Time off > Parental leave`), and are embedded with a contextual header (document title + heading path), so a chunk that only says "kept for 14 days" is still findable as *dead-letter retention in the API reference*. Consecutive chunks inside a section overlap by trailing sentences.

The 256-token default comes from `npm run eval:sweep` (offline providers, hybrid retrieval, 39 answerable questions):

| Strategy | Target | Chunks | Avg tokens | Recall@1 | Recall@5 | MRR@10 | Recall ≤500 tok | Recall ≤1000 tok |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| heading-aware | 128 | 66 | 80 | 83.3% | 97.4% | 0.905 | 97.4% | 100.0% |
| **heading-aware** | **256** | **54** | **96** | **85.9%** | **97.4%** | **0.923** | **97.4%** | **100.0%** |
| heading-aware | 512 | 54 | 96 | 85.9% | 97.4% | 0.923 | 97.4% | 100.0% |
| heading-aware | 1024 | 54 | 96 | 85.9% | 97.4% | 0.923 | 97.4% | 100.0% |
| fixed window | 128 | 63 | 95 | 80.8% | 97.4% | 0.884 | 97.4% | 100.0% |
| fixed window | 256 | 29 | 210 | 91.0% | 100.0% | 0.953 | 93.6% | 100.0% |
| fixed window | 512 | 14 | 439 | 91.0% | 100.0% | 0.962 | 91.0% | 100.0% |
| fixed window | 1024 | 8 | 727 | 91.0% | 100.0% | 0.962 | 91.0% | 91.0% |

How to read it:

- **Chunk-level recall@k rewards big chunks.** A 1,024-token window "contains" the answer because it contains half the document. The sweep therefore also reports *recall under a context budget* (take ranked chunks until 500 / 1,000 tokens are spent). At a 500-token budget heading-aware/256 wins (97.4% vs 93.6% for the best fixed window), and it gives the LLM — and the reader who clicks the citation — a focused passage instead of a page of text.
- **Above 256 the target is a no-op on this corpus**: every section already fits, so heading boundaries decide. 128 starts splitting sections and loses ranking quality (recall@1 83.3% vs 85.9%, MRR 0.905 vs 0.923). 256 is the smallest target that keeps sections whole, with headroom for longer real-world sections.
- **Fixed windows rank the right region first more often** (recall@1 91.0% vs 85.9%), because larger chunks match more query terms. If answers routinely span sections, that is the trade-off to revisit — with the eval harness, not by intuition. (The fixed-window mode stays in the chunker as `respectHeadings: false` for exactly that.)

### Grounding and abstention

The system prompt is frozen (no per-request data), carries the citation rules and the exact abstention sentence, and treats passages as untrusted data. The server then:

1. skips the LLM entirely when retrieval returns nothing (abstaining for free);
2. parses `[n]`, `[1, 3]` and `[2-4]` markers, drops indices that don't map to a retrieved chunk, and stores the valid `(index → chunk id)` pairs on the trace;
3. marks the response *not answerable* on abstention or on a safety refusal (`stop_reason: "refusal"`). Answer requests enable the server-side refusal fallback (`fallbacks: "default"`), so a classifier decline is retried on a fallback model before giving up.

### Claude usage and cost control

- **Model split** — Haiku 4.5 rewrites the question into a keyword-rich search query (short output, cheap); Sonnet 5.5 writes the answer at `effort: low` (configurable): grounded QA over six short passages does not need deep reasoning, and latency matters in a chat UX.
- **Prompt caching** — the frozen system prompt carries `cache_control`; the retrieved passages vary per request and sit after the breakpoint. Cache reads and writes are recorded on each trace and priced separately. Honest status: at ~400 tokens today's system prompt is below the minimum cacheable prefix, so traces show 0 cached tokens; the breakpoint starts paying off as soon as the prompt grows (few-shot examples, longer policies). The rewrite prompt is deliberately left unmarked for the same reason.
- **Cost estimates** come from a pricing table (`src/server/observability/pricing.ts`); unknown models are reported as *n/a*, never as $0.

### Offline providers for reproducibility

`EmbeddingProvider`, `Reranker` and `LlmProvider` are interfaces, each with a real and a local implementation, picked in `auto` mode by the presence of API keys:

- **Hashed n-gram embeddings** — stemmed words, word bigrams and character trigrams, signed feature hashing into 1,024 dimensions, L2-normalised. Deterministic and free, but lexical rather than semantic.
- **Extractive answerer** — scores each sentence of the retrieved passages by idf-weighted overlap with the question, then stitches a cited answer from verbatim sentences: the best sentence and its on-topic continuation, plus supporting sentences from other passages as a markdown list — or the abstention sentence. It resolves follow-ups by borrowing the previous question's terms and streams through the same code path as Claude.

The whole stack — pgvector, HNSW, RRF, streaming, citations, traces, evals — is therefore testable in CI without secrets or flakiness. Vectors are stored with the model that produced them and retrieval only compares vectors from the active model; `npm run ingest:pending -- --reindex` re-embeds after a provider switch, reusing the content-addressed embedding cache. Chunk ids are name-based UUIDs derived from content, so rankings (including tie-breaks) are reproducible across re-ingestion.

### Embedded Postgres fallback

`DATABASE_URL=pglite://…` runs the same migrations and SQL on PGlite (Postgres compiled to WASM, with the pgvector extension). The eval harness always uses an in-memory instance, so every run is hermetic; integration tests use real Postgres when `TEST_DATABASE_URL` is set (CI) and PGlite otherwise. In the web app, ingestion runs in-process via `after()`; a real deployment would move `processDocument` to a queue consumer — the claim/lease protocol already makes it safe to run from several workers.

## Evaluation

The golden set (`eval/golden.json`) has **43 questions** over the bundled corpus — a fictional company's API reference, handbook, incident postmortem, security policy, pricing page and a 4-page PDF onboarding guide. 39 are answerable (tagged lexical, identifier, paraphrase, table, PDF, multi-source) and 4 are deliberately unanswerable. Relevance is defined by **evidence strings** (a chunk is relevant if it comes from the expected document and contains the evidence), not chunk ids, so the labels stay valid when chunking changes; the harness refuses to run if an evidence string disappears from the corpus.

Current baseline from `npm run eval:ci` — offline providers (`local-hash-v1` embeddings, extractive answerer, no reranker), 54 chunks:

**Retrieval** (39 answerable questions)

| Retriever | Recall@1 | Recall@3 | Recall@5 | Recall@10 | MRR@10 | Recall ≤500 tok |
| --- | --- | --- | --- | --- | --- | --- |
| FTS only | 76.9% | 98.7% | 100.0% | 100.0% | 0.872 | 100.0% |
| Vector only | 83.3% | 97.4% | 97.4% | 100.0% | 0.905 | 97.4% |
| Hybrid (RRF) | 85.9% | 97.4% | 97.4% | 100.0% | 0.923 | 97.4% |

By question type (MRR@10): FTS leads on *lexical* questions (0.947 vs 0.912 for vector), the vector side leads on *paraphrase* (0.926 vs 0.847), and hybrid keeps the better of the two on each (0.947 lexical, 0.931 paraphrase).

**Generation** (k = 6, same retrieval; offline row from `npm run eval:ci`, Claude row from one `npm run eval` with `ANTHROPIC_API_KEY` set)

| Answerer | Key-fact accuracy | Citation precision | False abstention | Abstention accuracy | Faithfulness (Haiku judge) | Latency p50 / p95 | First token p50 | Cost, 43 answers |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Offline extractive | 74.4% | 90.0% | 23.1% | 2 / 4 | — | 0.3 s / 0.8 s | — | $0 |
| **Claude Sonnet 5.5** (+ Haiku 4.5 rewrite) | **97.4%** | **92.1%** | **2.6%** | **4 / 4** | **98.2%** | 2.2 s / 3.1 s | 1.6 s | $0.18 (+ $0.06 judge) |

The single Claude miss is instructive: for *"How old can a webhook timestamp be before the receiver should reject it?"* the local embeddings surfaced incident-postmortem chunks instead of the signatures section, and Claude correctly answered *"I don't know based on the provided documents"* rather than reaching for prior knowledge — a retrieval miss, not a hallucination. Report: [`eval/reports/live-latest.json`](eval/reports/live-latest.json).

What these numbers do and don't say:

- **Offline, hybrid beats vector-only only narrowly.** Recall@1 85.9% vs 83.3% and MRR 0.923 vs 0.905, with identical recall@5 (97.4%, the same `pm-root-cause` miss). The offline "vector" retriever is itself lexical (hashed n-grams), so fusion combines two correlated lexical signals. The case for hybrid is a *semantic* embedder plus FTS for identifiers — run `npm run eval` with `VOYAGE_API_KEY` set to measure that configuration (a `hybrid + rerank` row appears automatically when a reranker is configured).
- **The corpus is small** (54 chunks): recall@5 and @10 saturate, so recall@1 and MRR carry the signal. A larger, noisier corpus is on the roadmap.
- **The eval gate earns its keep.** The first version of the stitched offline answers accepted supporting sentences scoring 60% of the lead; CI's eval gate failed it (citation precision fell to 83.9%, below the 85% minimum). Tightening to 75% gave 74.4% key-fact accuracy (up from 71.8% for one-sentence answers) at 90.0% citation precision.
- **Faithfulness** is scored by Claude Haiku 4.5 as an LLM judge with structured output; it only runs when `ANTHROPIC_API_KEY` is set, and a failing judge call is recorded rather than aborting the run.

Metric definitions live in [`eval/metrics.ts`](eval/metrics.ts). Each run writes a JSON report with per-question rows to `eval/reports/`; the committed baseline is [`eval/reports/latest.json`](eval/reports/latest.json). CI fails below the minimums in [`eval/thresholds.json`](eval/thresholds.json).

## Live demo

**[citevia.vercel.app](https://citevia.vercel.app)** runs the app in demo mode against the fictional sample corpus (a made-up webhook company, *Kestrel Relay*). Ask about pricing, retries or the incident postmortem and follow the citations.

- **Offline on purpose** — extractive answers and hashed embeddings, so the public demo makes no paid API calls. The screenshots above show the same UI with Claude answering.
- **Uploads** — PDF or Markdown up to 2 MB, labelled *Demo upload*, visible to other visitors. Sample documents can't be deleted.
- **Resets nightly** — a Vercel Cron call to `/api/demo/reset` drops visitor uploads and traces and re-seeds the corpus.
- **Rate limits** — `/api/ask` and uploads are limited per IP with the in-memory token bucket. On serverless each warm instance keeps its own buckets, so the limit is per instance, not global; a shared store (Upstash/Redis) behind the same `RateLimiter` interface would make it exact.

**Or run it yourself in one click:** [Open in Codespaces](https://codespaces.new/MatheoTe/citevia) — no secrets needed. The dev container (Node 22) uses embedded PGlite, runs migrations and the seed on create, and starts `npm run dev` in demo mode on port 3000.

<details>
<summary>Deploying your own demo on Vercel</summary>

1. Create a Postgres database with pgvector (Neon works; `CREATE EXTENSION vector` runs in the first migration).
2. Import the repo in Vercel. `vercel.json` sets the build command to `npm run vercel-build` (migrate → seed → `next build`) and schedules the nightly reset.
3. Set the environment variables:

| Variable | Value |
| --- | --- |
| `DATABASE_URL` | pooled connection string (Neon: the `-pooler` host, `?sslmode=require`) |
| `DATABASE_URL_UNPOOLED` | direct connection string, used only by migrations |
| `DEMO_MODE` | `1` |
| `DEMO_RESET_TOKEN` | long random string — `POST /api/demo/reset` with header `x-demo-reset-token` |
| `CRON_SECRET` | long random string — Vercel Cron sends it as `Authorization: Bearer …` |
| `CITELY_RATE_LIMIT_PER_MINUTE` | optional, e.g. `10` |
| `DEMO_MAX_UPLOAD_MB` · `DEMO_MAX_UPLOADS` · `DEMO_UPLOADS_PER_HOUR` | optional: `2` · `30` · `10` |
| `DEMO_ALLOW_LIVE` | optional: `1` lets configured API keys switch on Claude/Voyage in demo mode |

Ingestion runs after the upload response (`after()`, which Vercel keeps alive within the route's `maxDuration` of 60 s); with the 2 MB cap and local embeddings it takes a few seconds. Live ingestion progress is kept in memory, so on multi-instance deployments the list may jump straight from *queued* to *ready* — the status itself always comes from the database.

</details>

## Running locally

Requirements: Node.js ≥ 22 and, optionally, Docker.

```bash
cp .env.example .env              # API keys are optional
docker compose up -d              # Postgres 17 + pgvector on :5432
npm install
npm run db:migrate
npm run seed                      # ingests corpus/ (idempotent)
npm run dev                       # http://localhost:3000
```

**No Docker?** Point the app at the embedded database and run the same commands:

```bash
# .env
DATABASE_URL=pglite://./.data/citevia
```

**Real providers.** Add `ANTHROPIC_API_KEY` and/or `VOYAGE_API_KEY` to `.env`. In `auto` mode each key independently switches its provider on; the header badge shows the active mode. After changing the embedding provider, re-index with `npm run ingest:pending -- --reindex`.

| Variable | Default | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | `postgres://citely:citely@localhost:5432/citely` | `postgres://…`, `pglite://<dir>` or `pglite://memory` |
| `ANTHROPIC_API_KEY`, `VOYAGE_API_KEY` | — | enable Claude / Voyage |
| `CITELY_LLM_PROVIDER` · `CITELY_EMBEDDINGS_PROVIDER` · `CITELY_RERANKER` | `auto` | force `anthropic`/`offline`, `voyage`/`local`, `voyage`/`none` |
| `CITELY_ANSWER_MODEL` · `CITELY_FAST_MODEL` | `claude-sonnet-5-5` · `claude-haiku-4-5-20251001` | answer model · rewrite/judge model |
| `CITELY_ANSWER_EFFORT` | `low` | effort level for answers |
| `CITELY_CHUNK_TOKENS` · `CITELY_CHUNK_OVERLAP` | `256` · `48` | chunking |
| `CITELY_RETRIEVAL_K` | `6` | passages sent to the LLM |
| `CITELY_RATE_LIMIT_PER_MINUTE` | `20` | per-client limit on `/api/ask` |
| `CITELY_MAX_UPLOAD_MB` | `10` | upload size limit |
| `DEMO_MODE` | off | public demo: forced offline providers, 2 MB uploads, read-only samples, `/api/demo/reset` — see [Live demo](#live-demo) |

### API

| Method & path | Description |
| --- | --- |
| `POST /api/ask` | `{ question, k?, documentIds? }` → NDJSON stream of `meta`, `sources`, `delta`, then `done` or `error` |
| `GET /api/documents` · `POST /api/documents` | list · upload (multipart `file`; `202` when queued, `200` when deduplicated) |
| `GET /api/documents/:id` · `DELETE /api/documents/:id` | document with its chunks · delete (cascades) |
| `GET /api/chunks/:id` | one chunk with its document |
| `GET /api/traces?limit=` | recent traces |
| `GET /api/health` | database connectivity and active providers |
| `POST /api/demo/reset` | demo mode only: wipe uploads and traces, re-seed (`x-demo-reset-token` header; `GET` with `Bearer $CRON_SECRET` for Vercel Cron) |

Errors always look like `{ "error": { "code": "VALIDATION_FAILED", "message": "…", "details": [...] } }`, with the matching status (400, 401, 403, 404, 413, 415, 429 + `Retry-After`, 502).

## Testing

```bash
npm run typecheck          # next typegen + tsc --noEmit
npm run lint
npm run test:unit          # 90 tests: chunker, parsers, RRF, tsquery, citations + highlighting, providers, rate limiter, waterfall, eval metrics, demo guards…
npm run test:integration   # 31 tests: ingestion + progress, hybrid retrieval, answer pipeline + follow-ups, HTTP routes, demo reset
npm run eval:ci            # offline eval + thresholds
npm run build && npm run test:e2e   # Playwright: upload → live pipeline → citation preview → source panel → follow-up → document → waterfall
```

- **Integration tests** run against Postgres + pgvector when `TEST_DATABASE_URL` is set (`docker compose up -d`, or the CI service container) and against embedded PGlite + pgvector otherwise — same migrations, same SQL.
- **Tests never call paid APIs**: Vitest and Playwright force the offline providers even if `.env` holds keys; CI sets them too.
- **E2E** boots `next start` with offline providers and a throwaway database (`E2E_DATABASE_URL`, PGlite by default). Locally, `PW_CHANNEL=chrome npm run test:e2e` reuses an installed Google Chrome instead of downloading Chromium.
- **CI** ([`.github/workflows/ci.yml`](.github/workflows/ci.yml)): typecheck · lint · unit tests · offline eval gate → integration tests on `pgvector/pgvector:pg17` → production build · Playwright E2E against Postgres.

## Project structure

```
src/
  app/                    routes: Ask (/), /documents, /documents/[id], /traces, /api/*
  components/             ask workspace, source panel, document library, traces, ui/ primitives
  lib/                    browser-safe code: citation protocol, NDJSON event types, formatting
  server/
    config/env.ts         zod-validated configuration
    db/                   Drizzle schema, driver selection (node-postgres | PGlite), migrator
    ingest/               parsers (PDF, Markdown) → chunker → idempotent pipeline
    retrieval/            tsquery builder, RRF, hybrid retrieve()
    generation/           prompts and the answer pipeline (rewrite → retrieve → stream → cite → trace)
    demo/                 sample-corpus seeding, demo reset, reset-token check
    providers/            Voyage / local embeddings, Voyage reranker, Claude / offline LLM, judge
    observability/        pricing table for cost estimates
    http/                 request schemas, rate limiter, error-mapping wrapper
    errors.ts             typed AppError hierarchy
drizzle/                  SQL migrations
corpus/                   fictional sample corpus, PDF source text
eval/                     golden set, metrics, harness, thresholds, baseline reports
scripts/                  migrate, seed, ingest:pending worker, sample PDF builder
tests/                    unit/, integration/, e2e/, fixtures/
```

## Roadmap

Tracked publicly on the [Roadmap board](https://github.com/users/MatheoTe/projects/1).

- Measure Voyage + Claude on the golden set and publish it next to the offline baseline.
- A larger, noisier evaluation corpus (hundreds of documents with near-duplicate distractors) so recall@k stops saturating.
- Move ingestion to a durable queue — the claim/lease protocol already supports multiple workers.
- Per-user workspaces and auth.
- OCR for scanned PDFs; DOCX and HTML parsers.
- Redis-backed rate limiter for multi-instance deployments; OpenTelemetry export of traces.

---

Built by **Matheo Telesca** · [LinkedIn](https://www.linkedin.com/in/matheo-telesca-084a20209/)

Released under the [MIT License](LICENSE). The sample corpus describes a fictional company.
