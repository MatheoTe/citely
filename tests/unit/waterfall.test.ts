import { describe, expect, it } from "vitest";
import { spansFor } from "@/components/traces/waterfall";

const base = { rewriteMs: 10, embedMs: 5, ftsMs: 20, vectorMs: 30, fuseMs: 1, rerankMs: 0, retrievalMs: 40, ttftMs: 80, generationMs: 100, totalMs: 150 };

describe("spansFor", () => {
  it("uses recorded spans when the trace has them", () => {
    const spans = [{ stage: "rewrite" as const, startMs: 0, durationMs: 10 }];
    expect(spansFor({ ...base, spans })).toBe(spans);
  });

  it("reconstructs offsets for older traces from the pipeline order", () => {
    expect(spansFor(base)).toEqual([
      { stage: "rewrite", startMs: 0, durationMs: 10 },
      { stage: "fts", startMs: 10, durationMs: 20 },
      { stage: "vector", startMs: 10, durationMs: 35 },
      { stage: "fuse", startMs: 45, durationMs: 1 },
      { stage: "generate", startMs: 50, durationMs: 100 },
    ]);
  });
});
