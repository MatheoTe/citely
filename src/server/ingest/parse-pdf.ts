import { extractText, getDocumentProxy } from "unpdf";
import { IngestionError } from "../errors";
import type { Block, ParsedDocument } from "./types";

const PAGE_FOOTER = /^(page\s+)?\d+(\s*(of|\/)\s*\d+)?$/i;
const NUMBERED_HEADING = /^(\d+(?:\.\d+)*)\.?\s+[A-Z][^.!?]*$/;
const BULLET = /^[•▪◦·\-–*]\s+/;

function wordCount(s: string): number {
  return s.split(/\s+/).filter(Boolean).length;
}

/**
 * PDFs have no semantic structure, only positioned lines. We rebuild
 * paragraphs and headings with layout heuristics that hold for most
 * text-based documents:
 *  - numbered short lines without terminal punctuation are headings,
 *  - a line ending in punctuation that is clearly shorter than the page's
 *    typical line width closes a paragraph,
 *  - page furniture ("Page 2 of 4") is dropped.
 * Scanned PDFs (no text layer) fail loudly instead of producing empty chunks.
 */
export function blocksFromPageTexts(pages: string[]): { blocks: Block[]; title: string | null } {
  const blocks: Block[] = [];
  let title: string | null = null;

  pages.forEach((pageText, pageIndex) => {
    const page = pageIndex + 1;
    const lines = pageText
      .split("\n")
      .map((l) => l.replace(/\s+/g, " ").trim())
      .filter((l) => l && !PAGE_FOOTER.test(l));
    const typicalWidth = Math.max(...lines.map((l) => l.length), 1);

    let paragraph: string[] = [];
    const flush = () => {
      if (paragraph.length) blocks.push({ kind: "paragraph", text: paragraph.join(" "), page });
      paragraph = [];
    };

    lines.forEach((line, i) => {
      const isFirstLineOfDoc = pageIndex === 0 && i === 0;
      if (isFirstLineOfDoc && wordCount(line) <= 12 && !/[.!?]$/.test(line)) {
        flush();
        title = line;
        blocks.push({ kind: "heading", level: 1, text: line, page });
        return;
      }
      if (NUMBERED_HEADING.test(line) && wordCount(line) <= 10) {
        flush();
        const depth = line.split(" ")[0].replace(/\.$/, "").split(".").length;
        blocks.push({ kind: "heading", level: Math.min(depth + 1, 6), text: line, page });
        return;
      }
      if (BULLET.test(line)) {
        flush();
        paragraph.push(`• ${line.replace(BULLET, "")}`);
        return;
      }
      paragraph.push(line);
      const endsSentence = /[.!?:]["')]?$/.test(line);
      if (endsSentence && line.length < typicalWidth * 0.85) flush();
    });
    flush();
  });

  return { blocks, title };
}

export async function parsePdf(bytes: Uint8Array, fallbackTitle: string): Promise<ParsedDocument> {
  let pages: string[];
  let totalPages: number;
  try {
    const pdf = await getDocumentProxy(new Uint8Array(bytes));
    const extracted = await extractText(pdf, { mergePages: false });
    pages = extracted.text;
    totalPages = extracted.totalPages;
  } catch (err) {
    throw new IngestionError("Could not read the PDF (is it corrupted or encrypted?)", err);
  }

  const { blocks, title } = blocksFromPageTexts(pages);
  if (!blocks.some((b) => b.kind === "paragraph")) {
    throw new IngestionError("The PDF has no extractable text layer (scanned documents need OCR first)");
  }
  return { title: title ?? fallbackTitle, pageCount: totalPages, blocks };
}
