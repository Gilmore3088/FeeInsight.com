import { describe, expect, it } from "vitest";
import { buildInsufficientEvidenceReport } from "./report-readiness";

describe("buildInsufficientEvidenceReport", () => {
  it("returns a source-diligence brief instead of generic competitive claims for empty evidence", () => {
    const report = buildInsufficientEvidenceReport({
      institutionName: "Example Credit Union",
      period: "2026-01-01 to 2026-06-30",
      statusLabel: "Source needed",
      verifiedCount: 0,
      provisionalCount: 0,
      assetSize: 125_000_000,
      latestSourceStatus: null,
      latestFinancial: {
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
      current: "0 verified / 0 provisional",
      proposed: "Needed: a verified fee schedule",
    });
    expect(report.tradeoffs).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ label: "Do not use yet" }),
        expect.objectContaining({ label: "Next diligence" }),
      ]),
    );
    expect(text).toContain("Written from the data on file, without a model-written analysis.");
    expect(text).toContain("should not receive a generic competitive position");
    expect(text).toContain("Financial context is available through 2026-03-31");
    // Call report figures are in thousands: $125 billion of assets, $420 million of fee income.
    expect(text).toContain("assets are $125.0B and reported service charge income is $420.0M");
    expect(text).not.toMatch(/provider generation|extract rows|evidence tier|source record/i);
    expect(text).not.toMatch(
      /market intelligence superiority|precision pricing|create sustainable competitive advantage/i,
    );
    expect(report.exportControls).toEqual({ pdfEnabled: true, shareEnabled: false });
  });
});
