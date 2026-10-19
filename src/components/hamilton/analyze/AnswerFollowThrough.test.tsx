import { describe, expect, it, vi } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("@/app/pro/(hamilton)/analyze/answer-actions", () => ({ addAnswerToDecision: vi.fn() }));
vi.mock("@/app/pro/(hamilton)/monitor/actions", () => ({ addToWatchlist: vi.fn() }));

import { AnswerFollowThrough } from "./AnswerFollowThrough";

describe("AnswerFollowThrough (#2045)", () => {
  it("offers the four steps after a saved answer about one fee at one institution", () => {
    const html = renderToStaticMarkup(
      <AnswerFollowThrough analysisId="a-1" institutionId="8109" institutionName="Capital City Bank" feeCategory="overdraft" report={<span>REPORT</span>} />,
    );
    expect(html).toContain('aria-label="Use this answer"');
    expect(html).toContain("Saved");
    expect(html).toContain('href="/pro/saved?instId=8109"');
    expect(html).toContain("Add to a decision");
    expect(html).toContain("Watch Capital City Bank");
    expect(html).toContain("REPORT");
    expect(html).toContain("The decision and the report link to this saved answer, with its sources and peer group.");
  });

  it("leaves out the decision without a fee, and shows nothing before the answer is saved", () => {
    const noFee = renderToStaticMarkup(<AnswerFollowThrough analysisId="a-1" institutionId="8109" institutionName={null} feeCategory={null} report={null} />);
    expect(noFee).not.toContain("Add to a decision");
    expect(noFee).toContain("Watch this institution");
    expect(renderToStaticMarkup(<AnswerFollowThrough analysisId={null} institutionId="8109" institutionName={null} feeCategory="overdraft" report={null} />)).toBe("");
  });
});
