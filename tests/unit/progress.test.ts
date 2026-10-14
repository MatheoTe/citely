import { describe, expect, it } from "vitest";
import { getProgress, trackStage } from "@/server/ingest/progress";

describe("ingestion progress registry", () => {
  it("tracks the current stage and closes durations as stages advance", () => {
    const tracker = trackStage("doc-1");
    expect(getProgress("doc-1")?.stage).toBe("parsing");
    tracker.stage("parsing");
    tracker.stage("chunking");
    expect(getProgress("doc-1")?.durations.parsing).toBeGreaterThanOrEqual(0);
    tracker.stage("embedding");
    tracker.done({ chunks: 4, cacheHits: 1 });
    expect(getProgress("doc-1")).toMatchObject({ stage: "done", chunks: 4, cacheHits: 1 });
    expect(Object.keys(getProgress("doc-1")!.durations)).toEqual(["parsing", "chunking", "embedding"]);
  });

  it("returns null for unknown documents", () => {
    expect(getProgress("nope")).toBeNull();
  });
});
