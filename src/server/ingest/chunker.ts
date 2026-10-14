import { estimateTokens, splitSentences } from "./text";
import type { Block, ChunkOptions, DraftChunk } from "./types";

interface Unit {
  text: string;
  tokens: number;
  page: number | null;
}

interface Section {
  headingPath: string;
  units: Unit[];
}

/**
 * Group blocks into sections. A section is the run of content under one
 * heading path, e.g. "Handbook > Time off > Parental leave". Chunks never
 * cross a section boundary: a chunk that mixes two topics retrieves poorly
 * for both, and its citation would point at the wrong heading.
 */
function toSections(blocks: Block[], targetTokens: number, respectHeadings: boolean): Section[] {
  const sections: Section[] = [];
  const stack: { level: number; text: string }[] = [];
  let current: Section | null = null;

  for (const block of blocks) {
    if (block.kind === "heading" && !respectHeadings) {
      // Naive mode: a heading is just more text in the stream.
      current ??= sections[sections.push({ headingPath: "", units: [] }) - 1];
      current.units.push({ text: block.text, tokens: estimateTokens(block.text), page: block.page });
      continue;
    }
    if (block.kind === "heading") {
      while (stack.length && stack[stack.length - 1].level >= block.level) stack.pop();
      stack.push({ level: block.level, text: block.text });
      current = null;
      continue;
    }
    if (!current) {
      current = { headingPath: stack.map((h) => h.text).join(" > "), units: [] };
      sections.push(current);
    }
    const tokens = estimateTokens(block.text);
    if (tokens <= targetTokens) {
      current.units.push({ text: block.text, tokens, page: block.page });
    } else {
      // Oversized paragraph: fall back to sentence units so it can be packed.
      for (const sentence of splitSentences(block.text)) {
        current.units.push({ text: sentence, tokens: estimateTokens(sentence), page: block.page });
      }
    }
  }
  return sections;
}

/** Trailing sentences of `units` that fit in `budget` tokens, used as overlap. */
function overlapTail(units: Unit[], budget: number): Unit[] {
  if (budget <= 0) return [];
  const sentences: Unit[] = units.flatMap((u) =>
    splitSentences(u.text).map((s) => ({ text: s, tokens: estimateTokens(s), page: u.page })),
  );
  const tail: Unit[] = [];
  let used = 0;
  for (let i = sentences.length - 1; i >= 0; i--) {
    if (used + sentences[i].tokens > budget) break;
    tail.unshift(sentences[i]);
    used += sentences[i].tokens;
  }
  return tail;
}

/**
 * Structure-aware chunker:
 *  1. split by heading-delimited sections,
 *  2. greedily pack paragraphs (or sentences, for long paragraphs) up to
 *     `targetTokens`,
 *  3. seed each follow-up chunk in the same section with up to
 *     `overlapTokens` of trailing sentences, so facts that straddle a
 *     boundary remain retrievable from either side.
 */
export function chunkBlocks(blocks: Block[], options: ChunkOptions): DraftChunk[] {
  const { targetTokens, overlapTokens, respectHeadings = true } = options;
  if (targetTokens <= 0) throw new Error("targetTokens must be positive");
  if (overlapTokens >= targetTokens) throw new Error("overlapTokens must be smaller than targetTokens");

  const chunks: DraftChunk[] = [];
  const emit = (headingPath: string, units: Unit[]) => {
    const content = units.map((u) => u.text).join("\n\n").trim();
    if (!content) return;
    const pages = units.map((u) => u.page).filter((p): p is number => p !== null);
    chunks.push({
      ordinal: chunks.length,
      content,
      headingPath,
      pageStart: pages.length ? Math.min(...pages) : null,
      pageEnd: pages.length ? Math.max(...pages) : null,
      tokenCount: estimateTokens(content),
    });
  };

  for (const section of toSections(blocks, targetTokens, respectHeadings)) {
    let buffer: Unit[] = [];
    let bufferTokens = 0;
    let freshTokens = 0; // tokens not inherited from overlap

    for (const unit of section.units) {
      if (freshTokens > 0 && bufferTokens + unit.tokens > targetTokens) {
        emit(section.headingPath, buffer);
        buffer = overlapTail(buffer, overlapTokens);
        bufferTokens = buffer.reduce((n, u) => n + u.tokens, 0);
        freshTokens = 0;
      }
      buffer.push(unit);
      bufferTokens += unit.tokens;
      freshTokens += unit.tokens;
    }
    if (freshTokens > 0) emit(section.headingPath, buffer);
  }

  return chunks;
}

/**
 * The text that gets embedded. Prepending the document title and heading
 * path ("contextual chunk header") lets a chunk that says "it is kept for 14
 * days" match a query about dead-letter retention in the API docs.
 */
export function embeddingInput(documentTitle: string, chunk: Pick<DraftChunk, "headingPath" | "content">): string {
  const header = [documentTitle, chunk.headingPath].filter(Boolean).join(" — ");
  return `${header}\n\n${chunk.content}`;
}
