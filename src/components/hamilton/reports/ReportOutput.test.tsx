import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { ReportSummaryResponse } from "@/lib/hamilton/types";
import { ReportOutput } from "./ReportOutput";
import { REPORT_SECTION_HEADINGS } from "./report-labels";

const report: ReportSummaryResponse = {
  title: "Overdraft fees against your state peers",
  executiveSummary: ["You charge $35; the state median is $32."],
  snapshot: [{ label: "Overdraft", current: "$35", proposed: "$30" }],
  strategicRationale: "Most peers sit between $29 and $35.",
  tradeoffs: [{ label: "Fee income per 1,000 items", value: "−$5,000" }],
  recommendation: "Management could hold at $35 or test $30.",
  implementationNotes: ["Reg DD requires 30 days' notice."],
  exportControls: { pdfEnabled: true, shareEnabled: false },
};

describe("ReportOutput", () => {
  const html = renderToStaticMarkup(<ReportOutput report={report} reportType="category_deep_dive" />);

  it("renders every section under its plain-language heading", () => {
    for (const heading of [
      REPORT_SECTION_HEADINGS.summary,
      REPORT_SECTION_HEADINGS.snapshot,
      REPORT_SECTION_HEADINGS.rationale,
      REPORT_SECTION_HEADINGS.tradeoffs,
      REPORT_SECTION_HEADINGS.position,
      REPORT_SECTION_HEADINGS.implementation,
    ]) {
      expect(html).toContain(heading);
    }
    expect(html).toContain("Category Deep Dive");
  });

  it("uses site tokens, not the legacy Hamilton styles or recommendation language", () => {
    expect(html).not.toContain("--hamilton-");
    expect(html).not.toContain("hamilton-card");
    expect(html).not.toMatch(/class="([^"]*\s)?tabular-nums[\s"]/);
    expect(html).not.toMatch(/Recommended|Proposed/);
  });
});
