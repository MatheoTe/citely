import { ABSTAIN_ANSWER } from "@/lib/citations";
import type { SourcePassage } from "../../generation/prompt";
import { splitSentences } from "../../ingest/text";
import { contentTerms } from "../../text/terms";
import type { AnswerRequest, AnswerResult, LlmProvider } from "./types";

/** Interrogatives and filler that carry no evidence ("how many days…"). */
const QUESTION_NOISE = new Set(["much", "many", "long", "often", "kind", "happen", "happens", "mean", "allow", "allowed"]);

interface Candidate {
  sourceIndex: number;
  sentence: string;
  coverage: number;
}

export interface OfflineAnswerOptions {
  /** Minimum share of (idf-weighted) question terms a sentence must cover. */
  minCoverage?: number;
  maxSentences?: number;
}

/**
 * Deterministic extractive answerer used when no API key is configured.
 *
 * It scores every sentence of every retrieved passage by idf-weighted overlap
 * with the question terms (headings count at half weight), then returns the
 * best one or two sentences verbatim with their citation markers — or the
 * standard abstention if nothing covers enough of the question. It cannot
 * reason or synthesise, but it exercises the exact same contract as the LLM:
 * streaming, inline [n] citations and explicit "I don't know".
 */
export function extractiveAnswer(question: string, sources: SourcePassage[], options: OfflineAnswerOptions = {}): string {
  const { minCoverage = 0.5, maxSentences = 2 } = options;
  const qTerms = [...new Set(contentTerms(question).filter((t) => !QUESTION_NOISE.has(t)))];
  if (qTerms.length === 0 || sources.length === 0) return ABSTAIN_ANSWER;

  const sentencesBySource = sources.map((s) =>
    s.content.split(/\n+/).flatMap((line) => splitSentences(line.replace(/^•\s*/, ""))),
  );
  const allSentences = sentencesBySource.flat();
  const df = new Map<string, number>();
  for (const sentence of allSentences) {
    for (const term of new Set(contentTerms(sentence))) df.set(term, (df.get(term) ?? 0) + 1);
  }
  const idf = (t: string) => Math.log(1 + (allSentences.length + 1) / ((df.get(t) ?? 0) + 1));
  const totalWeight = qTerms.reduce((n, t) => n + idf(t), 0);

  const candidates: Candidate[] = [];
  sources.forEach((source, i) => {
    const headingTerms = new Set(contentTerms(`${source.documentTitle} ${source.headingPath}`));
    for (const sentence of sentencesBySource[i]) {
      const terms = new Set(contentTerms(sentence));
      let weight = 0;
      for (const t of qTerms) {
        if (terms.has(t)) weight += idf(t);
        else if (headingTerms.has(t)) weight += idf(t) * 0.5;
      }
      candidates.push({ sourceIndex: source.index, sentence, coverage: weight / totalWeight });
    }
  });

  candidates.sort((a, b) => b.coverage - a.coverage || a.sourceIndex - b.sourceIndex);
  const best = candidates[0];
  if (!best || best.coverage < minCoverage) return ABSTAIN_ANSWER;

  const picked = candidates
    .filter((c) => c.coverage >= Math.max(minCoverage, best.coverage * 0.8))
    .filter((c, i, arr) => arr.findIndex((o) => o.sentence === c.sentence) === i)
    .slice(0, maxSentences);

  return picked.map((c) => `${c.sentence.replace(/[.:;]?$/, ".")} [${c.sourceIndex}]`).join(" ");
}

export class OfflineLlmProvider implements LlmProvider {
  readonly name = "offline" as const;
  readonly answerModel = "offline-extractive-v1";

  constructor(private readonly options: OfflineAnswerOptions = {}) {}

  async rewriteQuery(question: string) {
    return { query: question.trim(), usage: null };
  }

  async streamAnswer(request: AnswerRequest, onDelta: (text: string) => void): Promise<AnswerResult> {
    const text = extractiveAnswer(request.question, request.sources, this.options);
    // Stream word by word so the UI path is identical to the real provider.
    for (const piece of text.match(/\S+\s*/g) ?? []) {
      if (request.signal?.aborted) break;
      onDelta(piece);
      await new Promise((r) => setTimeout(r, 4));
    }
    return { text, usage: null, refused: false };
  }
}
