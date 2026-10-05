import { describe, expect, it } from "vitest";
import { partnerReviewContext, reviewAnswerPage } from "./partner-review";

const base = {
  institutionName: "Example Bank",
  feeNames: ["Overdraft (OD)", "NSF Fee"],
  competitorNames: ["Clay County Bank"],
};

describe("reviewAnswerPage", () => {
  it("passes a specific, grounded answer page", () => {
    const narrative = [
      "HEADLINE: Example Bank charges $36 for an overdraft, $4 above the local median.",
      "DECISION: Lower the overdraft fee to $32 || WHY: Clay County Bank charges $30 and the local median is $32. || CONFIDENCE: Medium - 4 local competitors, verified",
    ].join("\n");
    expect(reviewAnswerPage({ ...base, narrative })).toEqual([]);
  });

  it("names every problem in a generic draft", () => {
    const narrative = [
      "HEADLINE: Fees are above the market.",
      "DECISION: Review pricing || WHY: Competitors are cheaper.",
    ].join("\n");
    expect(reviewAnswerPage({ ...base, narrative })).toEqual([
      "The headline must name Example Bank.",
      "The headline must carry its key figure from DATA.",
      "Decision 1 must name the price to move to or hold at.",
      "Decision 1's WHY must cite at least one figure from DATA.",
      "Decision 1 needs a confidence level (High, Medium or Low) and the reason for it.",
      "Each decision must name the fee it changes, using the fee names in DATA.",
      "Name at least one local competitor from DATA and its price where it supports a decision.",
    ]);
  });

  it("asks for the format when the page cannot be parsed, and builds the send-back context", () => {
    expect(reviewAnswerPage({ ...base, narrative: "Just prose." })).toHaveLength(1);
    expect(partnerReviewContext(["Fix A."], "DRAFT TEXT")).toContain("- Fix A.\nDRAFT:\nDRAFT TEXT");
  });
});
