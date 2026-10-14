import type { ExpectedItem, GoldenQuestion } from "./dataset";

export interface ChunkRef {
  filename: string;
  content: string;
}

const normalize = (s: string) => s.toLowerCase().replace(/\s+/g, " ").trim();

/** A chunk satisfies an expected item when it comes from that document and contains one of its evidence strings. */
export function matchesItem(chunk: ChunkRef, item: ExpectedItem): boolean {
  if (chunk.filename !== item.document) return false;
  const text = normalize(chunk.content);
  return item.evidence.some((e) => text.includes(normalize(e)));
}

export function isRelevant(chunk: ChunkRef, question: GoldenQuestion): boolean {
  return question.expected.some((item) => matchesItem(chunk, item));
}

/**
 * Recall@k. With match="all", the fraction of expected items found in the
 * top k; with match="any", 1 if any expected item is found.
 */
export function recallAtK(ranked: ChunkRef[], question: GoldenQuestion, k: number): number {
  const top = ranked.slice(0, k);
  const found = question.expected.filter((item) => top.some((c) => matchesItem(c, item))).length;
  if (question.expected.length === 0) return 1;
  return question.match === "any" ? (found > 0 ? 1 : 0) : found / question.expected.length;
}

/** Reciprocal rank of the first relevant chunk (0 if none in the list). */
export function reciprocalRank(ranked: ChunkRef[], question: GoldenQuestion): number {
  const index = ranked.findIndex((c) => isRelevant(c, question));
  return index === -1 ? 0 : 1 / (index + 1);
}

/** Fraction of cited chunks that are relevant. Null when nothing was cited (undefined, not zero). */
export function citationPrecision(cited: ChunkRef[], question: GoldenQuestion): number | null {
  if (cited.length === 0) return null;
  return cited.filter((c) => isRelevant(c, question)).length / cited.length;
}

/** Deterministic correctness proxy: the answer contains every key fact. */
export function containsKeyFacts(answer: string, mustInclude: string[]): boolean {
  const text = normalize(answer);
  return mustInclude.every((fact) => text.includes(normalize(fact)));
}

export function mean(values: number[]): number | null {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : null;
}

/**
 * Recall under a context-token budget: take ranked chunks until the budget is
 * spent. Chunk-level recall@k rewards large chunks (a 1,000-token window
 * "contains" more answers); budgeted recall compares chunking strategies at
 * the same prompt cost.
 */
export function recallAtBudget(
  ranked: (ChunkRef & { tokens: number })[],
  question: GoldenQuestion,
  budgetTokens: number,
): number {
  const included: ChunkRef[] = [];
  let used = 0;
  for (const chunk of ranked) {
    if (used + chunk.tokens > budgetTokens && included.length > 0) break;
    included.push(chunk);
    used += chunk.tokens;
  }
  return recallAtK(included, question, included.length);
}
