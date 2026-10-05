import { describe, expect, it } from "vitest";
import { parseAnalyzeResponse, parseEvidenceMetrics, parseFollowUps, shapeHamiltonView, splitSentences } from "./parse-response";

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
