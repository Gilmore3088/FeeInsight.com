import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildFinancialPerformance, type FiledQuarterRow } from "@/lib/hamilton/financial-quarters";

/**
 * /pro/financials (#1892): the subscriber's filed quarters, the year-to-date figure kept apart and
 * labelled, the peer median only with 10 peers, and each quarter's evidence one click away.
 */
const state = vi.hoisted(() => ({
  institution: null as null | { id: number; name: string; charterType: string; assetTierLabel: string | null },
  rows: [] as unknown[],
  peers: [] as unknown[],
}));

vi.mock("next/navigation", () => ({ redirect: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn(async () => ({ id: 1 })) }));
vi.mock("@/lib/team-billing", () => ({ redirectWithoutPremium: vi.fn(async () => undefined) }));
vi.mock("@/lib/hamilton/workspace-context", () => ({
  resolveHamiltonInstitutionContext: vi.fn(async () => ({ institution: state.institution, error: null, source: "manual" })),
}));
vi.mock("@/lib/hamilton/financial-performance-read", () => ({
  readFinancialPerformance: vi.fn(async () => ({
    view: buildFinancialPerformance(state.rows as FiledQuarterRow[], state.peers as never[]),
    peerReadFailed: false,
  })),
}));

import FinancialsPage from "./page";

function ncua(reportDate: string, ytd: number, id: number): FiledQuarterRow {
  return {
    recordId: id, reportDate, source: "ncua", institutionName: "Sample Credit Union", certNumber: "678",
    feeIncome: ytd, totalDeposits: 50_000, totalAssets: 60_000,
    rawFeeIncome: ytd * 1000, rawDeposits: 50_000_000, rawAssets: 60_000_000,
    sourceUrl: null, retrievedAt: "2026-08-20",
  };
}

async function render(params: Record<string, string> = {}) {
  const markup = renderToStaticMarkup(await FinancialsPage({ searchParams: Promise.resolve(params) }));
  return { markup, text: new DOMParser().parseFromString(markup, "text/html").body.textContent ?? "" };
}

describe("/pro/financials (#1892)", () => {
  beforeEach(() => {
    state.institution = { id: 9, name: "Sample Credit Union", charterType: "credit_union", assetTierLabel: "$100M to $300M" };
    state.rows = [ncua("2026-03-31", 120, 1), ncua("2026-06-30", 250, 2)];
    state.peers = [
      { reportDate: "2026-06-30", feeMedian: 140, feePeers: 10, depositsMedian: 40_000, depositsPeers: 10, assetsMedian: 50_000, assetsPeers: 10 },
      { reportDate: "2026-03-31", feeMedian: 110, feePeers: 9, depositsMedian: 40_000, depositsPeers: 9, assetsMedian: 50_000, assetsPeers: 9 },
    ];
  });

  it("asks for an institution when none is chosen", async () => {
    state.institution = null;
    const { text } = await render();
    expect(text).toContain("Choose your institution");
  });

  it("labels the standalone quarter and the filed year to date apart", async () => {
    const { text } = await render();
    expect(text).toContain("Fee income, quarter");
    expect(text).toContain("Fee income, year to date as filed");
    expect(text).toContain("$130 thousand");
    expect(text).toContain("$250 thousand");
    expect(text).toContain("is never a single quarter");
  });

  it("shows the peer median only where 10 peers report", async () => {
    const { text } = await render();
    expect(text).toContain("$140 thousand10 in peer group");
    expect(text).toContain("Too few in peer group (9)");
  });

  it("opens the chosen quarter's evidence with its variables and calculation", async () => {
    const { markup, text } = await render({ quarter: "2026-06-30" });
    expect(markup).toMatch(/<details id="evidence-2026-06-30" open=""/);
    expect(markup).not.toMatch(/<details id="evidence-2026-03-31" open=""/);
    expect(text).toContain("Sample Credit Union, NCUA charter 678");
    expect(text).toContain("ACCT_131");
    expect(text).toContain("Matches the filing");
    expect(text).toContain("less ACCT_131 year to date at Mar 31, 2026");
  });

  it("keeps the researched institution in each quarter's evidence link", async () => {
    const { markup } = await render({ instId: "9" });
    expect(markup).toContain('href="/pro/financials?instId=9&amp;quarter=2026-06-30#evidence-2026-06-30"');
  });

  it("uses no em dashes and names no internal agents", async () => {
    const { text } = await render({ quarter: "2026-06-30" });
    expect(text).not.toMatch(/\u2014/);
    expect(text).not.toMatch(/\b(Knox|Darwin|Magellan|Rosetta|Gutenberg|Hoovie|Atlas)\b/);
  });

  it("reads stored values as thousands of dollars: a bank's 2,640 is $2.6 million, not $2,640", async () => {
    state.institution = { id: 7, name: "Sample Bank", charterType: "bank", assetTierLabel: null };
    // FDIC BankFind states ISERCHGQ, DEP and ASSET in thousands; the importer stores them unchanged.
    state.rows = [{
      recordId: 1, reportDate: "2026-06-30", source: "fdic", institutionName: "Sample Bank", certNumber: "12345",
      feeIncome: 2_640, totalDeposits: 1_845_300, totalAssets: 2_310_000,
      rawFeeIncome: 2_640, rawDeposits: 1_845_300, rawAssets: 2_310_000, sourceUrl: null, retrievedAt: "2026-08-20",
    } satisfies FiledQuarterRow];
    state.peers = [];
    const { text } = await render({ quarter: "2026-06-30" });
    expect(text).toContain("$2.6 million");
    expect(text).toContain("$1.85 billion");
    expect(text).toContain("$2.31 billion");
    expect(text).toContain("2,640 thousand dollars");
    expect(text).not.toMatch(/\$2,640(?! thousand)/);
  });

  it("reads a credit union's whole-dollar filing against its stored thousands", async () => {
    // NCUA files ACCT_131 in dollars; the importer stores Math.round(dollars / 1000).
    state.rows = [{ ...ncua("2026-03-31", 3_512, 1), rawFeeIncome: 3_512_449 }];
    state.peers = [];
    const { text } = await render({ quarter: "2026-03-31" });
    expect(text).toContain("$3.5 million");
    expect(text).toContain("3,512,449 dollars");
    expect(text).toContain("Matches the filing");
  });
});
