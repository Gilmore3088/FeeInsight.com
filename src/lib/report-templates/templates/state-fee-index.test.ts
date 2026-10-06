import { describe, expect, it } from "vitest";
import { renderStateFeeIndexReport } from "./state-fee-index";
import { FIXTURE_EMPTY_STATE_REPORT, FIXTURE_STATE_REPORT } from "./__fixtures__/state-report.fixture";

const html = renderStateFeeIndexReport({ data: FIXTURE_STATE_REPORT, generatedAt: "2026-10-06" });
const empty = renderStateFeeIndexReport({ data: FIXTURE_EMPTY_STATE_REPORT, generatedAt: "2026-10-06" });

describe("renderStateFeeIndexReport", () => {
  it("is a complete document with no placeholder text", () => {
    for (const doc of [html, empty]) {
      expect(doc.startsWith("<!DOCTYPE html>")).toBe(true);
      expect(doc).not.toMatch(/under development|future release|lorem/i);
      expect(doc.slice(doc.indexOf("<body>"))).not.toContain("—"); // no em-dashes in report copy
    }
  });

  it("renders the state's data rows against national", () => {
    expect(html).toContain("Fixture State Bank and Credit Union Fees");
    // Everyday fee table: state median, middle half and national median for overdraft.
    expect(html).toContain("Overdraft");
    expect(html).toContain("$32.00");
    expect(html).toContain("$25.60 to $36.80");
    expect(html).toContain("$30.00");
    // Position against national: overdraft +7%, monthly maintenance -20%.
    expect(html).toContain("+7%");
    expect(html).toContain("−20%");
    // Small sample is marked.
    expect(html).toContain("small sample");
  });

  it("includes key findings, the charter comparison and coverage", () => {
    expect(html).toContain("The typical Fixture State overdraft fee");
    expect(html).toContain("Credit unions");
    expect(html).toMatch(/credit unions are cheaper on \d+ of \d+ fees/);
    expect(html).toContain("Banks with verified fees");
    expect(html).toContain("of 250 monitored");
  });

  it("states the source, as-of date and institution counts", () => {
    expect(html).toContain("live verified fees from the Bank Fee Index (published_fee_catalog), as of FIXTURE DATE");
    expect(html).toContain("150 institutions of 400 monitored in Fixture State have verified fees");
  });

  it("says plainly when a section has no data instead of showing numbers", () => {
    expect(empty).toContain("Not enough Fixture State institutions have verified fees yet for a headline finding");
    expect(empty).toContain("Not enough Fixture State institutions have verified everyday fees yet");
    expect(empty).toContain("nothing to compare");
    expect(empty).toContain("Too few Fixture State banks and credit unions publish the same fees");
    expect(empty).toContain("refresh date not available");
    expect(empty).not.toContain("report-table\"");
    expect(empty).not.toContain("$");
  });

  it("escapes state names", () => {
    const doc = renderStateFeeIndexReport({
      data: { ...FIXTURE_EMPTY_STATE_REPORT, stateName: "<script>x</script>" },
      generatedAt: "2026-10-06",
    });
    expect(doc).not.toContain("<script>x</script>");
  });
});
