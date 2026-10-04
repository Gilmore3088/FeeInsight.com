import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { RecommendedActionCard } from "./RecommendedActionCard";
import type { InstitutionPositionEntry } from "@/lib/hamilton/institution-position";

const gap: InstitutionPositionEntry = {
  feeCategory: "monthly_maintenance",
  displayName: "Monthly Maintenance",
  yourAmount: 15,
  benchmarkMedian: 12,
  benchmarkCount: 36,
  maturityTier: "strong",
  gapAmount: 3,
  gapPct: 25,
};

describe("RecommendedActionCard", () => {
  it("states the institution's largest gap and links that category to Simulate", () => {
    const html = renderToStaticMarkup(
      <RecommendedActionCard topGap={gap} benchmarkLabel="bank · community peers" selectedInstitutionId="2945" />,
    );

    expect(html).toContain("$15.00");
    expect(html).toContain("25% above the bank · community peers median of $12.00 (36 institutions)");
    expect(html).toContain('href="/pro/simulate?category=monthly_maintenance&amp;instId=2945"');
  });

  it("says when the selected institution has no benchmarked fees", () => {
    const html = renderToStaticMarkup(
      <RecommendedActionCard topGap={null} institutionName="First Bank" selectedInstitutionId="8109" />,
    );

    expect(html).toContain("no verified fees for First Bank");
    expect(html).toContain('href="/pro/settings?instId=8109"');
    expect(html).not.toContain("/pro/simulate");
  });

  it("asks for an institution when none is selected", () => {
    const html = renderToStaticMarkup(<RecommendedActionCard topGap={null} />);

    expect(html).toContain("Choose your institution");
    expect(html).toContain('href="/pro/settings"');
  });
});
