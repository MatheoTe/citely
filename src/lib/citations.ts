/**
 * Citation protocol shared by the server (validation, eval metrics) and the
 * browser (rendering). The model cites numbered sources inline as `[1]`,
 * `[1, 3]` or `[2-4]`; anything else in square brackets is plain text.
 */
export const ABSTAIN_ANSWER = "I don't know based on the provided documents.";

const MARKER = /\[(\s*\d{1,3}\s*(?:(?:[,;]|-|–)\s*\d{1,3}\s*)*)\]/g;

export type AnswerSegment = { type: "text"; text: string } | { type: "cite"; indices: number[] };

function expand(body: string): number[] {
  const out: number[] = [];
  for (const part of body.split(/[,;]/)) {
    const range = part.split(/-|–/).map((n) => Number.parseInt(n.trim(), 10));
    if (range.length === 2 && range[0] <= range[1] && range[1] - range[0] <= 20) {
      for (let i = range[0]; i <= range[1]; i++) out.push(i);
    } else {
      out.push(...range.filter((n) => Number.isFinite(n)));
    }
  }
  return out;
}

/**
 * Split an answer into text and citation segments. Markers referencing a
 * source that does not exist are left as literal text so a hallucinated
 * "[7]" can never render as a clickable citation.
 */
export function segmentAnswer(text: string, sourceCount: number): AnswerSegment[] {
  const segments: AnswerSegment[] = [];
  let last = 0;
  for (const match of text.matchAll(MARKER)) {
    const indices = expand(match[1]);
    const valid = indices.length > 0 && indices.every((i) => i >= 1 && i <= sourceCount);
    if (!valid) continue;
    if (match.index > last) segments.push({ type: "text", text: text.slice(last, match.index) });
    segments.push({ type: "cite", indices: [...new Set(indices)] });
    last = match.index + match[0].length;
  }
  if (last < text.length) segments.push({ type: "text", text: text.slice(last) });
  return segments;
}

export interface CitationExtraction {
  /** Valid source indices in order of first appearance. */
  cited: number[];
  /** Indices the model referenced that were not in the provided sources. */
  invalid: number[];
}

export function extractCitations(text: string, sourceCount: number): CitationExtraction {
  const cited: number[] = [];
  const invalid: number[] = [];
  for (const match of text.matchAll(MARKER)) {
    for (const i of expand(match[1])) {
      const bucket = i >= 1 && i <= sourceCount ? cited : invalid;
      if (!bucket.includes(i)) bucket.push(i);
    }
  }
  return { cited, invalid };
}

export function isAbstention(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[’`]/g, "'");
  return normalized.startsWith("i don't know") || normalized.startsWith("i do not know");
}
