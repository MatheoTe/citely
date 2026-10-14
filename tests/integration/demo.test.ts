import { readFile } from "node:fs/promises";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { DbHandle } from "@/server/db/client";
import { documents, traces } from "@/server/db/schema";
import { seedSampleCorpus } from "@/server/demo/corpus";
import { createTestDb, testIngestDeps } from "./helpers";

const background = vi.hoisted(() => [] as Promise<void>[]);
vi.mock("next/server", () => ({
  after: (fn: () => Promise<void>) => void background.push(fn()),
  connection: async () => {},
}));

const TOKEN = "integration-reset-token";
let handle: DbHandle;

async function setEnv(vars: Record<string, string | undefined>) {
  for (const [k, v] of Object.entries(vars)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  vi.resetModules();
  delete (globalThis as { __citelyUploadLimiter?: unknown }).__citelyUploadLimiter;
  (await import("@/server/config/env")).resetEnvCache();
}

function uploadRequest(file: File, ip = "10.0.0.1") {
  const form = new FormData();
  form.append("file", file);
  return new Request("http://test/api/documents", { method: "POST", body: form, headers: { "x-forwarded-for": ip } });
}

beforeAll(async () => {
  await setEnv({ DEMO_MODE: "1", DEMO_RESET_TOKEN: TOKEN, CRON_SECRET: undefined, DEMO_UPLOADS_PER_HOUR: "100" });
  handle = await createTestDb();
  (globalThis as { __citelyDb?: Promise<DbHandle> }).__citelyDb = Promise.resolve(handle);
  await seedSampleCorpus(testIngestDeps(handle));
});
afterAll(async () => {
  await setEnv({ DEMO_MODE: undefined, DEMO_RESET_TOKEN: undefined, DEMO_UPLOADS_PER_HOUR: undefined });
  await handle.close();
});

describe("public demo guards", () => {
  it("seeds the corpus as sample documents", async () => {
    const rows = await handle.db.select().from(documents);
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((d) => d.origin === "sample" && d.status === "ready")).toBe(true);
  });

  it("accepts a small upload as a demo upload and rejects anything over 2 MB", async () => {
    const { POST: upload } = await import("@/app/api/documents/route");
    const bytes = await readFile(path.resolve("tests/fixtures/coffee-club.md"));
    const ok = await upload(uploadRequest(new File([bytes], "coffee-club.md", { type: "text/markdown" })));
    expect(ok.status).toBe(202);
    expect((await ok.json()).document.origin).toBe("upload");
    await Promise.all(background);

    const big = new File([new Uint8Array(2 * 1024 * 1024 + 1).fill(0x61)], "big.md", { type: "text/markdown" });
    const tooBig = await upload(uploadRequest(big));
    expect(tooBig.status).toBe(413);
    expect((await tooBig.json()).error.code).toBe("PAYLOAD_TOO_LARGE");
  });

  it("rate limits uploads per IP", async () => {
    await setEnv({ DEMO_UPLOADS_PER_HOUR: "1" });
    const { POST: upload } = await import("@/app/api/documents/route");
    const file = () => new File(["# x"], "x.png", { type: "image/png" });
    expect((await upload(uploadRequest(file(), "10.9.9.9"))).status).toBe(415); // consumes the only token
    expect((await upload(uploadRequest(file(), "10.9.9.9"))).status).toBe(429);
    await setEnv({ DEMO_UPLOADS_PER_HOUR: "100" });
  });

  it("refuses to delete sample documents", async () => {
    const { DELETE } = await import("@/app/api/documents/[id]/route");
    const [sample] = await handle.db.select().from(documents).where(eq(documents.origin, "sample")).limit(1);
    const res = await DELETE(new Request("http://test", { method: "DELETE" }), { params: Promise.resolve({ id: sample.id }) });
    expect(res.status).toBe(403);
    expect((await res.json()).error.code).toBe("FORBIDDEN");
  });

  it("protects /api/demo/reset with the token, then wipes uploads and traces and keeps the samples", async () => {
    const { POST: reset, GET: cron } = await import("@/app/api/demo/reset/route");
    const before = await handle.db.select().from(documents);
    const samples = before.filter((d) => d.origin === "sample").length;
    expect(before.some((d) => d.origin === "upload")).toBe(true);
    await handle.db.insert(traces).values({
      question: "q",
      status: "ok",
      llmProvider: "offline",
      embeddingModel: "local",
      timings: { rewriteMs: 0, embedMs: 0, ftsMs: 0, vectorMs: 0, fuseMs: 0, rerankMs: 0, retrievalMs: 0, ttftMs: null, generationMs: 0, totalMs: 0 },
      retrieval: [],
      citations: [],
      usage: [],
      totalMs: 0,
    });

    expect((await reset(new Request("http://test/api/demo/reset", { method: "POST" }))).status).toBe(401);
    const wrong = await reset(new Request("http://test/api/demo/reset", { method: "POST", headers: { "x-demo-reset-token": "nope" } }));
    expect(wrong.status).toBe(401);

    const res = await cron(new Request("http://test/api/demo/reset", { headers: { authorization: `Bearer ${TOKEN}` } }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.removedDocuments).toBe(1);
    expect(body.removedTraces).toBe(1);

    const after = await handle.db.select().from(documents);
    expect(after).toHaveLength(samples);
    expect(after.every((d) => d.origin === "sample" && d.status === "ready")).toBe(true);
    expect(await handle.db.select().from(traces)).toHaveLength(0);
  });

  it("does not exist outside demo mode", async () => {
    await setEnv({ DEMO_MODE: undefined });
    const { POST: reset } = await import("@/app/api/demo/reset/route");
    const res = await reset(new Request("http://test/api/demo/reset", { method: "POST", headers: { "x-demo-reset-token": TOKEN } }));
    expect(res.status).toBe(404);
    await setEnv({ DEMO_MODE: "1" });
  });
});
