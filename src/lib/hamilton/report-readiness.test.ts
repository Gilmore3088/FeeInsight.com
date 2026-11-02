import { describe, expect, it } from "vitest";
import { buildInsufficientEvidenceReport } from "./report-readiness";

describe("buildInsufficientEvidenceReport", () => {
  it("returns a source-diligence brief instead of generic competitive claims for empty evidence", () => {
    const report = buildInsufficientEvidenceReport({
      institutionName: "Example Credit Union",
      period: "2026-01-01 to 2026-06-30",
      publishedCount: 0,
      assetSize: 125_000_000,
      latestSourceStatus: null,
      latestFinancial: {
        source: "ncua",
        report_date: "2026-03-31",
        total_assets: 125_000_000,
        service_charge_income: 420_000,
      },
    });

    const text = [
      report.title,
      ...report.executiveSummary,
      ...report.snapshot.flatMap((row) => [row.label, row.current, row.proposed]),
      report.strategicRationale,
      ...report.tradeoffs.flatMap((row) => [row.label, row.value]),
      report.recommendation,
      ...report.implementationNotes,
    ].join("\n");

    expect(report.title).toBe("Data Readiness Brief - Example Credit Union");
    expect(report.snapshot).toContainEqual({
      label: "Fee evidence",
      current: "0 published fees",
      proposed: "Needed: at least 1 published fee with a peer median to compare",
    });
    // The brief speaks only of published fees (wiring audit, 2026-11-02).
    expect(text).not.toMatch(/provisional|directional|Publication status/i);
    expect(report.tradeoffs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Do not use yet", value: "Fee benchmark score or peer fee deltas" }),
        expect.objectContaining({ label: "Next diligence" }),
      ]),
    );
    expect(text).toContain("Written from the data on file, without a model-written analysis.");
    expect(text).toContain("should not receive a generic competitive position");
    expect(text).toContain("Financial context is available through 2026-03-31");
    // Call report figures are in thousands: $125 billion of assets, $420 million of fee income.
    expect(text).toContain("assets are $125.0B and reported year-to-date broad credit-union fee income is $420.0M");
    expect(text).not.toMatch(/provider generation|extract rows|evidence tier|source record/i);
    expect(text).not.toMatch(
      /market intelligence superiority|precision pricing|create sustainable competitive advantage/i,
    );
    expect(report.exportControls).toEqual({ pdfEnabled: true, shareEnabled: false });
  });

  it("says a bank with published fees has none with a peer median yet, not that it has too few", () => {
    const report = buildInsufficientEvidenceReport({
      institutionName: "First Example Bank",
      period: "2026-01-01 to 2026-06-30",
      publishedCount: 3,
      assetSize: null,
      latestSourceStatus: "fetched",
      latestFinancial: null,
    });
    expect(report.executiveSummary[0]).toBe(
      "First Example Bank has 3 published fees, but none has a peer median to compare yet, so a competitive fee brief is not possible.",
    );
    expect(report.snapshot).toContainEqual({
      label: "Fee evidence",
      current: "3 published fees",
      proposed: "Needed: at least 1 published fee with a peer median to compare",
    });
    expect(report.executiveSummary.join(" ")).not.toContain("enough published fees");
  });
});
