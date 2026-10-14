import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { UnsupportedFileError } from "@/server/errors";
import { detectSourceType, titleFromFilename } from "@/server/ingest/parse";
import { parseMarkdown, stripInlineMarkdown } from "@/server/ingest/parse-markdown";
import { blocksFromPageTexts, parsePdf } from "@/server/ingest/parse-pdf";
import { splitSentences } from "@/server/ingest/text";

describe("parseMarkdown", () => {
  it("extracts headings, paragraphs, lists and tables", () => {
    const md = [
      "# Title",
      "",
      "Intro with **bold**, a [link](https://x.y) and `code`.",
      "Continues on the next line.",
      "",
      "## Section",
      "- first item",
      "- second item",
      "",
      "| Code | Meaning |",
      "| --- | --- |",
      "| KR-1 | Bad key |",
    ].join("\n");
    const doc = parseMarkdown(md, "fallback");
    expect(doc.title).toBe("Title");
    expect(doc.blocks).toEqual([
      { kind: "heading", level: 1, text: "Title", page: null },
      { kind: "paragraph", text: "Intro with bold, a link and code. Continues on the next line.", page: null },
      { kind: "heading", level: 2, text: "Section", page: null },
      { kind: "paragraph", text: "• first item\n• second item", page: null },
      { kind: "paragraph", text: "Code — Meaning\nKR-1 — Bad key", page: null },
    ]);
  });

  it("keeps fenced code intact and ignores headings inside it", () => {
    const doc = parseMarkdown("```\n# not a heading\nconst a = 1;\n```", "Fallback");
    expect(doc.title).toBe("Fallback");
    expect(doc.blocks).toEqual([{ kind: "paragraph", text: "# not a heading\nconst a = 1;", page: null }]);
  });

  it("strips emphasis without eating snake_case identifiers", () => {
    expect(stripInlineMarkdown("use *care* with next_cursor and __init__")).toBe("use care with next_cursor and init");
  });
});

describe("splitSentences", () => {
  it("does not split decimals, abbreviations or versions", () => {
    expect(splitSentences("Availability is 99.95% e.g. for Scale. Version 3.2 ships soon! Done?")).toEqual([
      "Availability is 99.95% e.g. for Scale.",
      "Version 3.2 ships soon!",
      "Done?",
    ]);
  });
});

describe("blocksFromPageTexts", () => {
  it("rebuilds paragraphs, numbered headings and drops page footers", () => {
    const pages = [
      "Guide Title\nA paragraph that wraps across a long line of text that fills the width\nand ends here.\nPage 1 of 2",
      "2. Second section\n• bullet one\n• bullet two that wraps onto\nthe next line.\nPage 2 of 2",
    ];
    const { blocks, title } = blocksFromPageTexts(pages);
    expect(title).toBe("Guide Title");
    expect(blocks).toEqual([
      { kind: "heading", level: 1, text: "Guide Title", page: 1 },
      {
        kind: "paragraph",
        text: "A paragraph that wraps across a long line of text that fills the width and ends here.",
        page: 1,
      },
      { kind: "heading", level: 2, text: "2. Second section", page: 2 },
      { kind: "paragraph", text: "• bullet one", page: 2 },
      { kind: "paragraph", text: "• bullet two that wraps onto the next line.", page: 2 },
    ]);
  });
});

describe("parsePdf (bundled sample)", () => {
  it("extracts text with page numbers from a real PDF", async () => {
    const bytes = await readFile(path.resolve("corpus/onboarding-guide.pdf"));
    const doc = await parsePdf(new Uint8Array(bytes), "fallback");
    expect(doc.title).toBe("Engineering Onboarding Guide");
    expect(doc.pageCount).toBe(4);
    const shadow = doc.blocks.find((b) => b.kind === "paragraph" && b.text.includes("shadow two on-call shifts"));
    expect(shadow?.page).toBe(4);
    expect(doc.blocks.some((b) => b.kind === "heading" && b.text === "3. Weeks two to four")).toBe(true);
  });

  it("rejects bytes that are not a readable PDF", async () => {
    await expect(parsePdf(new TextEncoder().encode("%PDF-1.7 garbage"), "x")).rejects.toThrow(/Could not read/);
  });
});

describe("detectSourceType", () => {
  const pdfBytes = new TextEncoder().encode("%PDF-1.7");
  const text = new TextEncoder().encode("# hi");

  it("accepts known extensions and sniffs the PDF magic number", () => {
    expect(detectSourceType("a.pdf", pdfBytes)).toBe("pdf");
    expect(detectSourceType("notes.MD", text)).toBe("markdown");
    expect(() => detectSourceType("fake.pdf", text)).toThrow(UnsupportedFileError);
    expect(() => detectSourceType("image.png", text)).toThrow(/Unsupported file type/);
  });

  it("derives a readable title from a filename", () => {
    expect(titleFromFilename("security-and_data-retention.md")).toBe("Security And Data Retention");
  });
});
