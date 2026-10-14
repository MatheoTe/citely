import { describe, expect, it } from "vitest";
import type { GoldenQuestion } from "../../eval/dataset";
import { citationPrecision, containsKeyFacts, matchesItem, reciprocalRank, recallAtK } from "../../eval/metrics";

const q = (overrides: Partial<GoldenQuestion> = {}): GoldenQuestion => ({
  id: "q",
  question: "What is the rate limit?",
  tags: [],
  answerable: true,
  match: "all",
  expected: [{ document: "api.md", evidence: ["600 requests per minute"] }],
  mustInclude: ["600"],
  ...overrides,
});

const hit = { filename: "api.md", content: "The API enforces 600  requests per\nminute per workspace." };
const wrongDoc = { filename: "other.md", content: "600 requests per minute" };
const miss = { filename: "api.md", content: "Pagination uses cursors." };

describe("eval metrics", () => {
  it("matches evidence case- and whitespace-insensitively, within the right document only", () => {
    expect(matchesItem(hit, q().expected[0])).toBe(true);
    expect(matchesItem(wrongDoc, q().expected[0])).toBe(false);
    expect(matchesItem(miss, q().expected[0])).toBe(false);
  });

  it("computes recall@k and reciprocal rank", () => {
    const ranked = [miss, wrongDoc, hit];
    expect(recallAtK(ranked, q(), 2)).toBe(0);
    expect(recallAtK(ranked, q(), 3)).toBe(1);
    expect(reciprocalRank(ranked, q())).toBeCloseTo(1 / 3);
    expect(reciprocalRank([miss], q())).toBe(0);
  });

  it("gives partial recall for multi-source questions with match=all, full credit with match=any", () => {
    const expected = [
      { document: "api.md", evidence: ["600 requests"] },
      { document: "pricing.md", evidence: ["399 US dollars"] },
    ];
    expect(recallAtK([hit], q({ expected, match: "all" }), 5)).toBe(0.5);
    expect(recallAtK([hit], q({ expected, match: "any" }), 5)).toBe(1);
  });

  it("computes citation precision and leaves it undefined when nothing is cited", () => {
    expect(citationPrecision([hit, miss], q())).toBe(0.5);
    expect(citationPrecision([], q())).toBeNull();
  });

  it("checks key facts in answers", () => {
    expect(containsKeyFacts("It is 600 requests per minute [1].", ["600"])).toBe(true);
    expect(containsKeyFacts("I don't know.", ["600"])).toBe(false);
  });
});

describe("recallAtBudget", () => {
  it("only counts chunks that fit in the token budget (always at least one)", async () => {
    const { recallAtBudget } = await import("../../eval/metrics");
    const big = { ...miss, tokens: 400 };
    const answer = { ...hit, tokens: 200 };
    expect(recallAtBudget([big, answer], q(), 500)).toBe(0);
    expect(recallAtBudget([big, answer], q(), 600)).toBe(1);
    expect(recallAtBudget([{ ...hit, tokens: 900 }], q(), 500)).toBe(1);
  });
});
