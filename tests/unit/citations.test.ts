import { describe, expect, it } from "vitest";
import { ABSTAIN_ANSWER, extractCitations, isAbstention, segmentAnswer } from "@/lib/citations";

describe("extractCitations", () => {
  it("collects single, grouped and ranged markers in order of appearance", () => {
    const text = "Retries back off [2]. Signatures use HMAC [1, 3]. Plans differ [4-5]. Again [2].";
    expect(extractCitations(text, 5)).toEqual({ cited: [2, 1, 3, 4, 5], invalid: [] });
  });

  it("reports indices outside the provided sources as invalid", () => {
    expect(extractCitations("Claim [1]. Hallucinated [9]. Zero [0].", 3)).toEqual({ cited: [1], invalid: [9, 0] });
  });

  it("ignores bracketed text that is not a citation", () => {
    expect(extractCitations("Error [KR-1029] and a [link](x) and [2025]", 3)).toEqual({ cited: [], invalid: [] });
  });
});

describe("segmentAnswer", () => {
  it("splits text and citation chips", () => {
    expect(segmentAnswer("A [1]. B [2;3]", 3)).toEqual([
      { type: "text", text: "A " },
      { type: "cite", indices: [1] },
      { type: "text", text: ". B " },
      { type: "cite", indices: [2, 3] },
    ]);
  });

  it("leaves markers for unknown sources as plain text", () => {
    expect(segmentAnswer("Fact [4].", 3)).toEqual([{ type: "text", text: "Fact [4]." }]);
  });

  it("handles partially streamed markers gracefully", () => {
    expect(segmentAnswer("Fact [1", 3)).toEqual([{ type: "text", text: "Fact [1" }]);
  });
});

describe("isAbstention", () => {
  it("recognises the abstention sentence and close variants", () => {
    expect(isAbstention(ABSTAIN_ANSWER)).toBe(true);
    expect(isAbstention("  I don’t know based on the documents.")).toBe(true);
    expect(isAbstention("I do not know.")).toBe(true);
    expect(isAbstention("The limit is 600 [1].")).toBe(false);
  });
});
