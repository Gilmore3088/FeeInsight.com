import { describe, expect, it } from "vitest";

import { findPaydayReportLink, parsePaydayPartition, paydayFetch, paydayPartitionKeys, PAYDAY_REPORT_SOURCES, readPaydayFigures } from "./payday-reports";

const WA = PAYDAY_REPORT_SOURCES.find((s) => s.state === "WA")!;

describe("state payday reports", () => {
  it("lists state-year partitions newest first", () => {
    const keys = paydayPartitionKeys(new Date("2026-10-17T00:00:00Z"));
    expect(keys.slice(0, 4)).toEqual(["WA-2025", "TX-2025", "WA-2024", "TX-2024"]);
    expect(keys.at(-1)).toBe("TX-2018");
    expect(parsePaydayPartition("WA-2024")?.source.state).toBe("WA");
    expect(parsePaydayPartition("CA-2024")).toBeNull();
  });

  it("finds exactly the year's report on the index page", () => {
    const html = `<a href="/sites/default/files/reports/2025-payday-loan-report.pdf">2025</a><a href="/sites/default/files/reports/2024-payday-loan-report.pdf">2024</a><a href="/other-2025.pdf">x</a>`;
    expect(findPaydayReportLink(html, WA, "2025")).toEqual(["https://dfi.wa.gov/sites/default/files/reports/2025-payday-loan-report.pdf"]);
  });

  it("reads labelled figures and refuses ambiguous ones", () => {
    const text = [
      "2023 Payday Lending Report",
      "Total number of small loans made 298,571",
      "Total dollar amount of small loans $141,821,891",
      "Average loan amount $475.00",
      "Average fee per loan $68.21",
      "Average APR 391%",
      "Number of borrowers 2022 50,000 2023 52,000",
      "Average number of loans per borrower 4.2",
      "Total fees collected $20,000,000",
      "Total fees charged in Q4 $5,000,000",
    ].join("\n");
    const read = readPaydayFigures(text, "WA", "2023", "https://x.pdf");
    expect(read.stats.map((s) => [s.series_key, s.value, s.unit])).toEqual([
      ["payday_loans_made", 298571, "count"],
      ["payday_loan_volume", 141821891, "dollars"],
      ["payday_avg_loan_amount", 475, "dollars"],
      ["payday_avg_fee_per_loan", 68.21, "dollars"],
      ["payday_avg_apr", 391, "percent"],
      ["payday_loans_per_borrower", 4.2, "ratio"],
    ]);
    expect(read.missing).toEqual({
      payday_total_fees: "label_on_several_lines",
      payday_borrowers: "several_numbers_on_line",
      payday_repeat_borrower_share: "not_found",
    });
    expect(paydayFetch(read, null).missingFields).toContain("payday_borrowers (several_numbers_on_line)");
  });

  it("reports an empty read instead of guessing", () => {
    const out = paydayFetch(readPaydayFigures("Annual report\nTable 1", "TX", "2025", null), null);
    expect(out.rows).toEqual([]);
    expect(out.emptyReason).toMatch(/No labelled figure/);
  });
});
