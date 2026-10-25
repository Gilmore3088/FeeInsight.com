import { describe, expect, it } from "vitest";
import type { FinancialPerformanceView, FinancialQuarter } from "./financial-quarters";
import {
  MONTHLY_BRIEFING_SECTIONS,
  briefingFeeRefs,
  buildMonthlyBriefing,
  editMonthlyBriefing,
  isSectionEdited,
  monthlyBriefingEditsError,
  monthlyBriefingReport,
  type MonthlyBriefing,
  type MonthlyBriefingInput,
} from "./monthly-briefing";
import type { EconomicBackdrop, Fact } from "./workspace/types";

const NAME = "Harbor Ridge Test Bank";

function quarter(reportDate: string, label: string, fee: number | null, yoy: number | null, peerMedian: number | null, peers: number): FinancialQuarter {
  return {
    reportDate,
    key: label,
    label,
    fee: { value: fee, qoqPct: null, yoyPct: yoy, peerMedian, peers, yearToDate: null },
    deposits: { value: 2_045_000, qoqPct: null, yoyPct: 4.2, peerMedian: null, peers: 0 },
    assets: { value: 2_392_650, qoqPct: null, yoyPct: null, peerMedian: null, peers: 0 },
    evidence: { entity: NAME, regulator: "FDIC", form: "FDIC call report", quarterEnd: reportDate, retrievedAt: null, sourceUrl: "https://api.fdic.gov/banks/financials", variables: [], calculation: "", heldReason: null },
  };
}

const view: FinancialPerformanceView = {
  source: "fdic",
  institutionName: NAME,
  quarters: [quarter("2026-06-30", "Q2 2026", 1_862, -6.3, 1_510, 12)],
  short: false,
};

const economy: EconomicBackdrop = {
  place: "Ohio",
  district: 4,
  districtName: "Cleveland",
  indicators: [
    { key: "fed_funds", label: "Federal funds rate", measure: "rate", value: 4.1, yearAgo: 5.3, asOf: "2026-09-01", source: { label: "Federal Reserve Board H.15 (FEDFUNDS)", url: "https://www.federalreserve.gov/releases/h15/", asOf: "2026-09-01" } },
    { key: "cpi_bank_services", label: "Prices for checking and other bank services", measure: "change_12m", value: 3.4, yearAgo: null, asOf: "2026-09-01", source: { label: "BLS Consumer Price Index (CUSR0000SEFR)", asOf: "2026-09-01" } },
  ],
  beigeBook: { releaseDate: "2026-10-15", text: "Loan demand was flat \u2014 deposits edged up.", source: { label: "Federal Reserve Beige Book, Cleveland district", asOf: "2026-10-15" } },
};

const regulation: Fact[] = [
  { text: "Regulation E requires an opt-in before a bank charges for ATM and one-time debit card overdrafts.", source: { label: "Regulation E, 12 CFR 1005.17", asOf: null } },
  { text: `The CFPB recorded 14 complaints about ${NAME} in 2025, 3 about fees or low funds.`, source: { label: "CFPB Consumer Complaint Database", asOf: "2025" } },
];

function input(overrides: Partial<MonthlyBriefingInput> = {}): MonthlyBriefingInput {
  return {
    now: new Date("2026-10-25T12:00:00Z"),
    institution: { id: 9_701_940, name: NAME, charterType: "bank" },
    financial: view,
    financialPeerLabel: "banks in the same asset-size tier",
    competition: {
      peerLabel: "Ohio community banks",
      peerSource: "saved-peer-set",
      fallbackReason: null,
      peerAsOf: "2026-10-24T08:00:00Z",
      fees: [
        { feeCategory: "overdraft", own: 35, ownAsOf: "2026-09-02T00:00:00Z", ownUrl: "https://example.test/fees.pdf", peerMedian: 30, peerCount: 42 },
        { feeCategory: "nsf", own: 30, ownAsOf: "2026-09-02T00:00:00Z", ownUrl: null, peerMedian: 30, peerCount: 40 },
        { feeCategory: "wire_domestic_outgoing", own: 20, ownAsOf: null, ownUrl: null, peerMedian: 25, peerCount: 6 },
        { feeCategory: "monthly_maintenance", own: null, ownAsOf: null, ownUrl: null, peerMedian: 10, peerCount: 50 },
      ],
    },
    economy,
    regulation,
    ...overrides,
  };
}

/** Every number written in some words, as a whole token: "$1.9", "5.8%", "2026", "42". */
function numbersIn(text: string): string[] {
  return text.match(/\$?\d[\d,]*(?:\.\d+)?%?/g) ?? [];
}

/**
 * The rule: every number in a section's words is a whole token of one of its rows' values, or of a
 * row's period (quarters and dates sit there), or the peer count its source names ("42
 * institutions", "12 banks"). Two exemptions, each on purpose:
 * - the peer group's name, which the resolver writes and can hold a numeral ("Fed district 6"):
 *   it names the group, it is not a figure;
 * - quoted text (the Beige Book and the FOMC), a dated, sourced quotation in the source's own words
 *   whose row carries the source and date.
 */
function expectNumbersSourced(b: MonthlyBriefing): void {
  for (const section of b.sections) {
    const allowed = new Set(section.rows.flatMap((r) => [
      ...numbersIn(r.value ?? ""),
      ...numbersIn(r.period),
      ...[...r.source.matchAll(/\b(\d+) (?:institutions|banks|credit unions)\b/g)].map((m) => m[1]),
    ]));
    let words = section.draft.replace(/"[^"]*"/g, " ");
    if (b.peerGroupLabel) words = words.split(b.peerGroupLabel).join(" ");
    for (const n of numbersIn(words)) expect(allowed.has(n), `${section.id} says ${n}; allowed ${[...allowed].join(", ")}`).toBe(true);
  }
}

describe("buildMonthlyBriefing (#1897)", () => {
  const briefing = buildMonthlyBriefing(input());

  it("keeps the six fixed sections in order", () => {
    expect(briefing.sections.map((s) => s.heading)).toEqual(["Summary", "Financials", "Competition", "Market", "Regulation", "Management considerations"]);
    expect(briefing.sections.map((s) => s.id)).toEqual(MONTHLY_BRIEFING_SECTIONS.map((s) => s.id));
    expect(briefing.monthLabel).toBe("October 2026");
  });

  it("gives every figure a source and a period", () => {
    for (const section of briefing.sections) {
      for (const row of section.rows) {
        expect(row.source.trim(), `${section.id}: ${row.label}`).not.toBe("");
        expect(row.period.trim(), `${section.id}: ${row.label}`).not.toBe("");
      }
    }
  });

  it("writes no number that is not in its section's figures", () => {
    expectNumbersSourced(briefing);
  });

  it("keeps the rule with six regulation items and with no management question", () => {
    const six = Array.from({ length: 6 }, (_, i): Fact => ({ text: `Rule item ${String.fromCharCode(65 + i)} applies to overdraft.`, source: { label: `Rule source ${String.fromCharCode(65 + i)}`, asOf: null } }));
    const quiet = buildMonthlyBriefing(input({
      regulation: six,
      financial: { ...view, quarters: [quarter("2026-06-30", "Q2 2026", 1_862, 1.2, 1_510, 12)] },
      competition: { ...input().competition!, fees: [{ feeCategory: "nsf", own: 30, ownAsOf: null, ownUrl: null, peerMedian: 30, peerCount: 40 }] },
    }));
    expect(quiet.sections.find((s) => s.id === "regulation")!.text).toMatch(/^Six sourced items/);
    expect(quiet.sections.find((s) => s.id === "summary")!.text).toContain("Regulation lists six sourced items");
    const management = quiet.sections.find((s) => s.id === "management")!;
    expect(management.rows).toEqual([]);
    expect(management.text).toBe("No fee sits far from its peer median and no large change in fee income was filed. Add the points your team wants management to weigh this month.");
    expectNumbersSourced(quiet);
  });

  it("compares only fees with ten or more peers and says what it left out", () => {
    const competition = briefing.sections.find((s) => s.id === "competition")!;
    expect(competition.rows).toHaveLength(4);
    expect(competition.rows[0]).toMatchObject({ label: `Overdraft (OD), ${NAME}`, value: "$35", period: "Published Sep 2, 2026", url: "https://example.test/fees.pdf" });
    expect(competition.rows[1]).toMatchObject({ value: "$30", source: "Bank Fee Index, Ohio community banks, 42 institutions", period: "As of Oct 24, 2026" });
    expect(competition.rows.some((r) => /wire/i.test(r.label))).toBe(false);
    expect(competition.gaps.join(" ")).toMatch(/fewer than 10 peers/);
    expect(competition.gaps.join(" ")).toMatch(/several different amounts/);
    expect(competition.text).toContain("two fees are compared: one above the peer median, none below and one at it.");
    expect(competition.text).toContain("overdraft fee of $35 is above the median of $30 across 42 peers");
  });

  it("asks management questions from the figures, never a price", () => {
    const management = briefing.sections.find((s) => s.id === "management")!;
    expect(management.text).toContain("16.7% above the peer median");
    expect(management.text).toContain("fell 6.3% on a year earlier in Q2 2026");
    expect(management.text).toMatch(/CFPB/);
    expect(management.text).not.toMatch(/should (raise|lower|set|charge)|recommend/i);
  });

  it("asks about complaints only when a complaint record is listed, and names fees in sentence case", () => {
    const circularOnly = buildMonthlyBriefing(input({
      regulation: [{ text: "Overdraft fees on authorize-positive transactions can be unfair.", source: { label: "CFPB Circular 2022-06", asOf: null } }],
      competition: { ...input().competition!, fees: [{ feeCategory: "stop_payment", own: 25, ownAsOf: null, ownUrl: null, peerMedian: 31, peerCount: 14 }] },
    }));
    const management = circularOnly.sections.find((s) => s.id === "management")!;
    expect(management.text).not.toMatch(/complaint/);
    expect(management.text).toContain("The stop payment fee sits");
    expect(circularOnly.sections.find((s) => s.id === "regulation")!.rows[0].period).toBe("Read Oct 25, 2026");
  });

  it("keeps em dashes out of text read from shared readers", () => {
    const all = JSON.stringify(briefing);
    expect(all).not.toContain("\u2014");
  });

  it("says what is missing instead of inventing figures", () => {
    const empty = buildMonthlyBriefing(input({ financial: null, competition: null, economy: null, regulation: [] }));
    for (const section of empty.sections) expect(section.rows).toEqual([]);
    expect(empty.sections.find((s) => s.id === "financials")!.gaps[0]).toMatch(/No call report filings/);
    expect(empty.sections.find((s) => s.id === "summary")!.gaps[0]).toMatch(/no sourced figures/);
    expect(empty.sections.find((s) => s.id === "management")!.text).toMatch(/Add the points your team wants/);
  });

  it("names a financial peer median only with ten or more peers", () => {
    const thin = buildMonthlyBriefing(input({ financial: { ...view, quarters: [quarter("2026-06-30", "Q2 2026", 1_862, 2, null, 7)] } }));
    const fin = thin.sections.find((s) => s.id === "financials")!;
    expect(fin.rows.some((r) => /Peer median/.test(r.label))).toBe(false);
    expect(fin.gaps.join(" ")).toMatch(/Fewer than 10 banks/);
  });
});

describe("editing and saving a briefing", () => {
  const report = monthlyBriefingReport(buildMonthlyBriefing(input()));

  it("saves as a Hamilton report with its sources and a default title", () => {
    expect(report.title).toBe(`${NAME}: monthly briefing, October 2026`);
    expect(report.sources?.map((s) => s.label)).toContain("Federal Reserve Board H.15 (FEDFUNDS)");
    expect(report.exportControls.pdfEnabled).toBe(true);
  });

  it("changes only the words; figures and drafts stay as built", () => {
    const edited = editMonthlyBriefing(report, { title: "October board pack", sections: { market: "Our own reading of the market." } });
    const before = report.monthlyBriefing!.sections.find((s) => s.id === "market")!;
    const after = edited.monthlyBriefing!.sections.find((s) => s.id === "market")!;
    expect(edited.title).toBe("October board pack");
    expect(after.text).toBe("Our own reading of the market.");
    expect(after.draft).toBe(before.draft);
    expect(after.rows).toEqual(before.rows);
    expect(isSectionEdited(after)).toBe(true);
    expect(isSectionEdited(edited.monthlyBriefing!.sections[0])).toBe(false);
  });

  it("puts an emptied section back to Hamilton's words", () => {
    const edited = editMonthlyBriefing(report, { title: "", sections: { summary: "   " } });
    const summary = edited.monthlyBriefing!.sections[0];
    expect(summary.text).toBe(summary.draft);
    expect(edited.title).toBe(report.title);
  });

  it("refuses malformed edits", () => {
    expect(monthlyBriefingEditsError({ title: "ok", sections: { summary: "x" } })).toBeNull();
    expect(monthlyBriefingEditsError({ title: "ok", sections: { forecast: "x" } })).toMatch(/not part of the briefing/);
    expect(monthlyBriefingEditsError({ title: "x".repeat(201), sections: {} })).toMatch(/200 characters/);
    expect(monthlyBriefingEditsError({ title: "ok", sections: { summary: "x".repeat(5001) } })).toMatch(/5,000 characters/);
    expect(monthlyBriefingEditsError(null)).toBe("Nothing to save.");
  });

  it("records the published fee rows Competition compared", () => {
    const refs = briefingFeeRefs(9_701_940, [
      { id: 11, fee_category: "overdraft", source_document_id: 5 },
      { id: 12, fee_category: "wire_domestic_outgoing", source_document_id: 5 },
    ], report.monthlyBriefing!);
    expect(refs).toEqual([{ feePublishedId: 11, institutionId: 9_701_940, sourceDocumentId: 5, sourceContentHash: null }]);
  });
});
