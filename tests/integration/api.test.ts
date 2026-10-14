import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AskEvent } from "@/lib/ask-events";
import type { DbHandle } from "@/server/db/client";
import { CORPUS_DIR, createTestDb } from "./helpers";

// `after()` needs a Next.js request scope; in tests, run the callback and keep its promise.
const background = vi.hoisted(() => [] as Promise<void>[]);
vi.mock("next/server", () => ({ after: (fn: () => Promise<void>) => void background.push(fn()) }));

let handle: DbHandle;

beforeAll(async () => {
  process.env.CITELY_RATE_LIMIT_PER_MINUTE = "1000";
  process.env.CITELY_LLM_PROVIDER = "offline";
  process.env.CITELY_EMBEDDINGS_PROVIDER = "local";
  process.env.CITELY_RERANKER = "none";
  handle = await createTestDb();
  // Route handlers use the process-wide DB singleton: point it at the test database.
  (globalThis as { __citelyDb?: Promise<DbHandle> }).__citelyDb = Promise.resolve(handle);
});
afterAll(async () => {
  await handle.close();
});

async function readEvents(res: Response): Promise<AskEvent[]> {
  return (await res.text())
    .split("\n")
    .filter(Boolean)
    .map((l) => JSON.parse(l) as AskEvent);
}

describe("HTTP API", () => {
  it("uploads a document (202), processes it and answers a question over it", async () => {
    const { POST: upload, GET: list } = await import("@/app/api/documents/route");
    const { POST: ask } = await import("@/app/api/ask/route");

    const form = new FormData();
    const bytes = await readFile(path.join(CORPUS_DIR, "pricing-and-plans.md"));
    form.append("file", new File([bytes], "pricing-and-plans.md", { type: "text/markdown" }));
    const uploaded = await upload(new Request("http://test/api/documents", { method: "POST", body: form }));
    expect(uploaded.status).toBe(202);
    expect((await uploaded.json()).document.status).toBe("queued");
    await Promise.all(background);

    const listed = await (await list()).json();
    expect(listed.documents[0]).toMatchObject({ filename: "pricing-and-plans.md", status: "ready" });

    const res = await ask(
      new Request("http://test/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ question: "How much does the Growth plan cost per month?" }),
      }),
    );
    expect(res.headers.get("content-type")).toContain("application/x-ndjson");
    const events = await readEvents(res);
    const done = events.at(-1);
    expect(done?.type).toBe("done");
    if (done?.type === "done") {
      expect(done.answer).toContain("49 US dollars");
      expect(done.citations.length).toBeGreaterThan(0);
    }
  });

  it("returns typed 400 errors for invalid input", async () => {
    const { POST: ask } = await import("@/app/api/ask/route");
    const res = await ask(new Request("http://test/api/ask", { method: "POST", body: JSON.stringify({ question: "" }) }));
    expect(res.status).toBe(400);
    expect((await res.json()).error.code).toBe("VALIDATION_FAILED");

    const bad = await ask(new Request("http://test/api/ask", { method: "POST", body: "{not json" }));
    expect(bad.status).toBe(400);
  });

  it("rejects unsupported uploads with 415", async () => {
    const { POST: upload } = await import("@/app/api/documents/route");
    const form = new FormData();
    form.append("file", new File([new Uint8Array([1, 2, 3])], "photo.png", { type: "image/png" }));
    const res = await upload(new Request("http://test/api/documents", { method: "POST", body: form }));
    expect(res.status).toBe(415);
    expect((await res.json()).error.code).toBe("UNSUPPORTED_FILE");
  });

  it("returns 404 for unknown documents and 400 for malformed ids", async () => {
    const { GET } = await import("@/app/api/documents/[id]/route");
    const missing = await GET(new Request("http://test"), { params: Promise.resolve({ id: crypto.randomUUID() }) });
    expect(missing.status).toBe(404);
    const malformed = await GET(new Request("http://test"), { params: Promise.resolve({ id: "nope" }) });
    expect(malformed.status).toBe(400);
  });

  it("rate limits /api/ask with 429 and Retry-After", async () => {
    vi.resetModules();
    process.env.CITELY_RATE_LIMIT_PER_MINUTE = "2";
    delete (globalThis as { __citelyAskLimiter?: unknown }).__citelyAskLimiter;
    const { resetEnvCache } = await import("@/server/config/env");
    resetEnvCache();
    const { POST: ask } = await import("@/app/api/ask/route");
    const call = () =>
      ask(
        new Request("http://test/api/ask", {
          method: "POST",
          headers: { "x-forwarded-for": "9.9.9.9" },
          body: JSON.stringify({ question: "x" }),
        }),
      );
    expect((await call()).status).toBe(400); // consumes a token, then fails validation
    expect((await call()).status).toBe(400);
    const limited = await call();
    expect(limited.status).toBe(429);
    expect(Number(limited.headers.get("retry-after"))).toBeGreaterThan(0);
  });
});
