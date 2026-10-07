import { describe, expect, it } from "vitest";
import { answerTitle, parseAnalyzeResponse, parseEvidenceMetrics, parseFollowUps, humanizeAnswerText, shapeHamiltonView, splitSentences, tidyEvidence } from "./parse-response";

describe("parseEvidenceMetrics", () => {
  it("keeps dates, ranges and hyphenated words inside the value", () => {
    const rows = parseEvidenceMetrics(
      [
        "- **Stale source:** Fees were last collected on 2026-02-17, about 6 months ago.",
        "- **Thin samples**: Overdraft-protection transfer ($8) rests on 6 institutions.",
        "- Revenue trend: The trend shows a -100% drop for 2025-Q3.",
      ].join("\n"),
    );
    expect(rows).toEqual([
      { label: "Stale source", value: "Fees were last collected on 2026-02-17, about 6 months ago." },
      { label: "Thin samples", value: "Overdraft-protection transfer ($8) rests on 6 institutions." },
      { label: "Revenue trend", value: "The trend shows a -100% drop for 2025-Q3." },
    ]);
  });

  it("turns a label with no value into a group heading and reads nested bullets", () => {
    const rows = parseEvidenceMetrics(
      "- **Data and pipeline problems:**\n  - **Tier mismatch:** The profile says one tier.\n    The ranking uses another.",
    );
    expect(rows).toEqual([
      { label: "Data and pipeline problems", value: "" },
      { label: "Tier mismatch", value: "The profile says one tier. The ranking uses another." },
    ]);
  });

  it("never leaves a stray bold marker in a value", () => {
    expect(parseEvidenceMetrics("- **NSF fee:** ** $35, against a $30 median")[0].value).toBe(
      "$35, against a $30 median",
    );
  });
});

describe("shapeHamiltonView", () => {
  it("splits a wall of text into a lead and short paragraphs", () => {
    const view =
      "Angelina prices most services below medians. Its NSF fee is $35. The median is $30.00 (13 institutions). " +
      "That wording is a U.S. compliance exposure. Revenue raises a second issue.";
    const { lead, paragraphs } = shapeHamiltonView(view);
    expect(lead).toBe("Angelina prices most services below medians.");
    expect(paragraphs).toEqual([
      "Its NSF fee is $35. The median is $30.00 (13 institutions). That wording is a U.S. compliance exposure.",
      "Revenue raises a second issue.",
    ]);
  });

  it("does not split on decimals or abbreviations", () => {
    expect(splitSentences("ATM is $1.75 vs. $1.50 at peers. Next.")).toEqual([
      "ATM is $1.75 vs. $1.50 at peers.",
      "Next.",
    ]);
  });

  it("parses a full answer end to end", () => {
    const parsed = parseAnalyzeResponse(
      "## Hamilton's View\nLead. Body.\n\n## Evidence\n- **NSF:** $35\n\n## Explore Further\n- Next question?",
    );
    expect(parsed.evidence).toEqual([{ label: "NSF", value: "$35" }]);
    expect(parsed.exploreFurther).toEqual(["Next question?"]);
  });
});

describe("parseFollowUps", () => {
  it("keeps real questions and drops ops notes, quotes and stray markdown", () => {
    const prompts = parseFollowUps(
      [
        '- "Which District 11 banks have both NSF and maintenance fees?"',
        "- “How does the overdraft fee compare with Texas credit unions?”",
        '- "Operational flags:** 746 decisions are pending review and 17 runs are active."',
        "- **Board question:** what would a $5 cut cost?",
        "1. Which peers moved first?",
      ].join("\n"),
    );
    expect(prompts).toEqual([
      "Which District 11 banks have both NSF and maintenance fees?",
      "How does the overdraft fee compare with Texas credit unions?",
      "Which peers moved first?",
    ]);
  });
});

describe("humanizeAnswerText", () => {
  it("replaces raw tier keys in any case and drops code backticks", () => {
    expect(humanizeAnswerText("Peer tier `COMMUNITY_MID` vs community_small banks")).toBe(
      "Peer tier $300M to $1B peers vs under $300M banks",
    );
  });

  it("is applied to every parsed section", () => {
    const parsed = parseAnalyzeResponse("## Hamilton's View\nCompared with community_mid peers.\n\n## Evidence\n- **Tier:** COMMUNITY_MID");
    expect(parsed.hamiltonView).toBe("Compared with $300M to $1B peers.");
    expect(parsed.evidence).toEqual([{ label: "Tier", value: "$300M to $1B peers" }]);
  });
});

// From the Space Coast answer of Oct 7, 2026 (hamilton_saved_analyses 53b3d2cd), shortened.
describe("Evidence rows a reader can scan", () => {
  it("starts a new row at every bullet, even when the label ends in a year", () => {
    const rows = parseEvidenceMetrics(
      [
        "- Fee income as a share of revenue: 6.3% against a 7.1% peer median — MidFlorida at 7.8%",
        "- Year-over-year service-charge growth, Q2 2026: 8.2% against a 9.9% peer median",
      ].join("\n"),
    );
    expect(rows).toEqual([
      { label: "Fee income as a share of revenue", value: "6.3% against a 7.1% peer median", note: "MidFlorida at 7.8%" },
      { label: "Year-over-year service-charge growth, Q2 2026", value: "8.2% against a 9.9% peer median" },
    ]);
  });

  it("leaves out prose written under the list", () => {
    const rows = parseEvidenceMetrics("- ATM: $2.50 against a $1.50 median\nConfidence is strong on income figures.");
    expect(rows).toEqual([{ label: "ATM", value: "$2.50 against a $1.50 median" }]);
  });

  it("writes thousands of thousands as millions", () => {
    expect(humanizeAnswerText("$962 thousand against a $1,063 thousand median; $1,000 thousand; $100,000 thousand")).toBe(
      "$962 thousand against a $1.06 million median; $1 million; $100 million",
    );
  });

  it("titles an answer with its whole first sentence", () => {
    expect(answerTitle("Space Coast's national rank of 23rd out of 1,325 midsize institutions overstates its position. Among the 9 peers, it earns less.")).toBe(
      "Space Coast's national rank of 23rd out of 1,325 midsize institutions overstates its position.",
    );
  });

  it("splits notes out of rows saved before the split", () => {
    expect(tidyEvidence([{ label: "ROA", value: "0.79% against a 1.06% peer median — Eastman at 1.95%" }])).toEqual([
      { label: "ROA", value: "0.79% against a 1.06% peer median", note: "Eastman at 1.95%" },
    ]);
  });
});
