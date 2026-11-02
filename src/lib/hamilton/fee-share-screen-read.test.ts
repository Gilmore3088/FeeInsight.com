import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn(), getSql: vi.fn() }));

import { loadFeeShareScreen, type FeeShareScreenReaders } from "./fee-share-screen-read";
import { parseFeeShareScreen } from "./workspace/fee-share-screen";
import { parseSegment } from "./workspace/segment";
import type { PeerRanking } from "@/lib/data-store/call-reports";
import type { FeeShareCohort, FeeShareScreenScope } from "@/lib/data-store/institution-quarterly";

const ISSUE_QUESTION = "Which credit unions in the top 25 of the $1 billion to $10 billion tier run a fee share below 4%?";

/** A $3B bank's ranking: FDIC, the $1B to $10B band, Q2 2026. */
const bankRanking = {
  institution_name: "First Example Bank",
  tier: "midsize",
  comparison: {
    source: "fdic",
    charter_type: "bank",
    report_date: "2026-06-30",
    size_criterion: { kind: "reported_assets", tier: "midsize", minimum_usd_inclusive: 1_000_000_000, maximum_usd_exclusive: 10_000_000_000 },
  },
} as unknown as PeerRanking;

/** n filers, thousands of dollars as stored, largest first; every third has a share below 4%. */
function cohort(n: number, source: "fdic" | "ncua", reportDate: string): FeeShareCohort {
  return {
    report_date: reportDate,
    source,
    charter_type: source === "fdic" ? "bank" : "credit_union",
    asset_size_tier: null,
    filers: n,
    members: Array.from({ length: n }, (_, i) => ({
      id: 500 + i,
      name: i === 0 ? "Example Credit Union" : `Example Member ${i + 1}`,
      city: null,
      state: "OH",
      total_assets: 9_500_000 - i * 100_000,
      service_charge_income: 1_000,
      total_revenue: i === 1 ? 0 : 40_000,
      fee_income_ratio: i % 3 === 0 ? 0.025 : 0.06,
    })),
  };
}

function readers(ranking: PeerRanking | null, filers: (scope: FeeShareScreenScope, date: string) => Promise<FeeShareCohort | null>) {
  return {
    ranking: vi.fn(async () => ranking),
    latestDate: vi.fn(async () => "2026-06-30"),
    filers: vi.fn(filers),
  } satisfies FeeShareScreenReaders;
}

describe("loadFeeShareScreen (#2028)", () => {
  const screen = parseFeeShareScreen(ISSUE_QUESTION)!;

  it("screens the question's peer set from call reports: the 25 largest $1B to $10B credit unions", async () => {
    const r = readers(bankRanking, async (_scope, date) => cohort(40, "ncua", date));
    const res = await loadFeeShareScreen(8109, ISSUE_QUESTION, screen, parseSegment(ISSUE_QUESTION), "First Example Bank", r);
    // The subject is a bank, so the credit union quarter comes from the NCUA filings, not its own.
    expect(r.latestDate).toHaveBeenCalledWith("ncua");
    expect(r.filers).toHaveBeenCalledWith({ charterType: "credit_union", source: "ncua", minAssets: 1_000_000, maxAssets: 10_000_000, stateCode: null }, "2026-06-30");
    // 25 largest of 40; one has no revenue, so 24 are screened; ids 500, 503, ... 524 are below 4%.
    expect(res.shortAnswer).toContain("9 of the 24 credit unions screened had fee income below 4% of total revenue in the year to date through June 30, 2026.");
    expect(res.shortAnswer).toContain("The peer set is the 25 largest credit unions with $1 billion to $10 billion in assets that filed call reports for the quarter ending June 30, 2026, ranked by filed assets.");
    expect(res.shortAnswer).toContain("Their median share was 6.0%.");
    expect(res.shortAnswer).toMatch(/Below 4%: Example Credit Union \(2\.5%\)/);
    expect(res.shortAnswer).not.toMatch(/late|overdraft|position/i);
  });

  it("screens the researched institution's charter and size band when the question names neither", async () => {
    const r = readers(bankRanking, async (_scope, date) => cohort(12, "fdic", date));
    const question = "Which institutions have a fee share below 4%?";
    const res = await loadFeeShareScreen(1, question, parseFeeShareScreen(question)!, parseSegment(question), "First Example Bank", r);
    expect(r.latestDate).not.toHaveBeenCalled();
    expect(r.filers).toHaveBeenCalledWith({ charterType: "bank", source: "fdic", minAssets: 1_000_000, maxAssets: 10_000_000, stateCode: null }, "2026-06-30");
    expect(res.shortAnswer).toContain("banks screened had deposit service charges below 4% of total revenue in the quarter ending June 30, 2026.");
    expect(res.shortAnswer).toContain("the size band of First Example Bank");
    expect(res.shortAnswer).toContain("Only banks are screened");
  });

  it("screens the whole state when only a state is named, never the subject's size band", async () => {
    const r = readers(bankRanking, async (_scope, date) => cohort(12, "fdic", date));
    const question = "Which banks in Ohio have a fee share below 4%?";
    const res = await loadFeeShareScreen(1, question, parseFeeShareScreen(question)!, parseSegment(question), "First Example Bank", r);
    expect(r.filers).toHaveBeenCalledWith({ charterType: "bank", source: "fdic", minAssets: null, maxAssets: null, stateCode: "OH" }, "2026-06-30");
    expect(res.shortAnswer).toContain("The peer set is the 12 banks in Ohio that filed call reports");
    expect(res.shortAnswer).not.toContain("size band");
  });

  it("says plainly when the filings can't be read or the charter can't be told, never a fee answer", async () => {
    const failing = readers(bankRanking, async () => { throw new Error("db down"); });
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const read = await loadFeeShareScreen(1, ISSUE_QUESTION, screen, parseSegment(ISSUE_QUESTION), undefined, failing);
    expect(read.shortAnswer).toMatch(/^Hamilton can't screen for fee income as a share of revenue below 4%: it could not read the call report filings for the 25 largest credit unions/);
    const unknown = readers(null, async () => null);
    const question = "Which institutions have a fee share below 4%?";
    const charter = await loadFeeShareScreen(1, question, parseFeeShareScreen(question)!, null, undefined, unknown);
    expect(charter.shortAnswer).toMatch(/without knowing whether to screen banks or credit unions/);
    expect(unknown.filers).not.toHaveBeenCalled();
    err.mockRestore();
  });
});
