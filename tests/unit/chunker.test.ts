import { describe, expect, it } from "vitest";
import { chunkBlocks, embeddingInput } from "@/server/ingest/chunker";
import { estimateTokens } from "@/server/ingest/text";
import type { Block } from "@/server/ingest/types";

const sentence = (n: number) => `Sentence number ${n} talks about webhook retries in some detail.`;
const paragraph = (from: number, count: number) =>
  Array.from({ length: count }, (_, i) => sentence(from + i)).join(" ");

describe("chunkBlocks", () => {
  it("never lets a chunk cross a heading boundary", () => {
    const blocks: Block[] = [
      { kind: "heading", level: 1, text: "Guide", page: null },
      { kind: "heading", level: 2, text: "Retries", page: null },
      { kind: "paragraph", text: "Short retry section.", page: null },
      { kind: "heading", level: 2, text: "Signatures", page: null },
      { kind: "paragraph", text: "Short signature section.", page: null },
    ];
    const chunks = chunkBlocks(blocks, { targetTokens: 500, overlapTokens: 50 });
    expect(chunks.map((c) => c.headingPath)).toEqual(["Guide > Retries", "Guide > Signatures"]);
    expect(chunks[0].content).toBe("Short retry section.");
  });

  it("tracks nested heading paths and pops siblings correctly", () => {
    const blocks: Block[] = [
      { kind: "heading", level: 1, text: "Handbook", page: null },
      { kind: "heading", level: 2, text: "Time off", page: null },
      { kind: "heading", level: 3, text: "Sick leave", page: null },
      { kind: "paragraph", text: "Unlimited.", page: null },
      { kind: "heading", level: 2, text: "Benefits", page: null },
      { kind: "paragraph", text: "Stipend.", page: null },
    ];
    const paths = chunkBlocks(blocks, { targetTokens: 100, overlapTokens: 10 }).map((c) => c.headingPath);
    expect(paths).toEqual(["Handbook > Time off > Sick leave", "Handbook > Benefits"]);
  });

  it("packs paragraphs up to the target size and overlaps consecutive chunks", () => {
    const blocks: Block[] = [
      { kind: "heading", level: 1, text: "Doc", page: null },
      ...Array.from({ length: 6 }, (_, i): Block => ({ kind: "paragraph", text: paragraph(i * 4, 4), page: null })),
    ];
    const target = 120;
    const chunks = chunkBlocks(blocks, { targetTokens: target, overlapTokens: 20 });
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.tokenCount).toBeLessThanOrEqual(target + 20);
    // the last sentence of chunk N reappears at the start of chunk N+1
    for (let i = 0; i < chunks.length - 1; i++) {
      const lastSentence = chunks[i].content.split(/(?<=\.)\s+/).pop()!;
      expect(chunks[i + 1].content.startsWith(lastSentence)).toBe(true);
    }
  });

  it("splits an oversized paragraph on sentence boundaries", () => {
    const blocks: Block[] = [{ kind: "paragraph", text: paragraph(0, 40), page: 3 }];
    const chunks = chunkBlocks(blocks, { targetTokens: 64, overlapTokens: 0 });
    expect(chunks.length).toBeGreaterThan(4);
    for (const c of chunks) {
      expect(c.content.endsWith(".")).toBe(true);
      expect(c.pageStart).toBe(3);
    }
    // nothing lost, nothing duplicated without overlap
    const rebuilt = chunks.map((c) => c.content.replace(/\n\n/g, " ")).join(" ");
    expect(rebuilt).toBe(paragraph(0, 40));
  });

  it("records the page span of multi-page chunks", () => {
    const blocks: Block[] = [
      { kind: "paragraph", text: "End of page one.", page: 1 },
      { kind: "paragraph", text: "Start of page two.", page: 2 },
    ];
    const [chunk] = chunkBlocks(blocks, { targetTokens: 200, overlapTokens: 0 });
    expect(chunk.pageStart).toBe(1);
    expect(chunk.pageEnd).toBe(2);
  });

  it("is deterministic and numbers chunks sequentially", () => {
    const blocks: Block[] = Array.from({ length: 5 }, (_, i): Block => ({ kind: "paragraph", text: paragraph(i, 5), page: null }));
    const a = chunkBlocks(blocks, { targetTokens: 80, overlapTokens: 16 });
    const b = chunkBlocks(blocks, { targetTokens: 80, overlapTokens: 16 });
    expect(a).toEqual(b);
    expect(a.map((c) => c.ordinal)).toEqual(a.map((_, i) => i));
  });

  it("rejects overlap that is not smaller than the target", () => {
    expect(() => chunkBlocks([], { targetTokens: 50, overlapTokens: 50 })).toThrow(/overlap/);
  });
});

describe("embeddingInput", () => {
  it("prefixes the document title and heading path", () => {
    expect(embeddingInput("API Reference", { headingPath: "Delivery > Retries", content: "Eight attempts." })).toBe(
      "API Reference — Delivery > Retries\n\nEight attempts.",
    );
  });
});

describe("estimateTokens", () => {
  it("approximates four characters per token", () => {
    expect(estimateTokens("")).toBe(0);
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});

describe("uuidFromString", () => {
  it("produces stable, well-formed UUIDs", async () => {
    const { uuidFromString } = await import("@/server/ingest/text");
    const id = uuidFromString("doc:0:hash");
    expect(id).toBe(uuidFromString("doc:0:hash"));
    expect(id).not.toBe(uuidFromString("doc:1:hash"));
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-8[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe("chunkBlocks without heading boundaries", () => {
  it("treats the document as one stream and keeps headings as text", () => {
    const blocks: Block[] = [
      { kind: "heading", level: 2, text: "Retries", page: null },
      { kind: "paragraph", text: "Short retry section.", page: null },
      { kind: "heading", level: 2, text: "Signatures", page: null },
      { kind: "paragraph", text: "Short signature section.", page: null },
    ];
    const chunks = chunkBlocks(blocks, { targetTokens: 500, overlapTokens: 0, respectHeadings: false });
    expect(chunks).toHaveLength(1);
    expect(chunks[0].headingPath).toBe("");
    expect(chunks[0].content).toBe("Retries\n\nShort retry section.\n\nSignatures\n\nShort signature section.");
  });
});
