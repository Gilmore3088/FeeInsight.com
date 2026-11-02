import { describe, expect, it } from "vitest";
import { matchFeeCategory } from "./ask";
import { buildFeeShareScreen, feeShareScreenUnavailable, meetsScreen, parseFeeShareScreen, type FeeShareScreenData, type FeeShareScreenRow } from "./fee-share-screen";
import { parseSegment } from "./segment";

const ISSUE_QUESTION = "Which credit unions in the top 25 of the $1 billion to $10 billion tier run a fee share below 4%?";

describe("parseFeeShareScreen (#2028)", () => {
  it("reads the threshold and direction of a fee-share screen", () => {
    expect(parseFeeShareScreen(ISSUE_QUESTION)).toEqual({ thresholdPct: 4, comparison: "below" });
    expect(parseFeeShareScreen("Show institutions where service charges are below 3% of revenue")).toEqual({ thresholdPct: 3, comparison: "below" });
    expect(parseFeeShareScreen("Which banks have a fee income share under 2.5%?")).toEqual({ thresholdPct: 2.5, comparison: "below" });
    expect(parseFeeShareScreen("Banks whose fee income is over 10 percent of total revenue")).toEqual({ thresholdPct: 10, comparison: "above" });
    expect(parseFeeShareScreen("credit unions with a fee share of at least 5%")).toEqual({ thresholdPct: 5, comparison: "at_least" });
    expect(parseFeeShareScreen("credit unions with a fee share at most 5%")).toEqual({ thresholdPct: 5, comparison: "at_most" });
  });

  it("is no screen when the share measured is the asker's own: those stay on the income answer", () => {
    expect(parseFeeShareScreen("Is our fee income above 5% of revenue?")).toBeNull();
    expect(parseFeeShareScreen("What share of our revenue is fee income? Is it below 5%?")).toBeNull();
    expect(parseFeeShareScreen("Do we run a fee share below 4%?")).toBeNull();
    // "Our peers" are the set being screened, not the asker's own share.
    expect(parseFeeShareScreen("Which of our peers have a fee share below 4%?")).toEqual({ thresholdPct: 4, comparison: "below" });
  });

  it("takes the threshold first after the share phrase, not the first comparison word listed", () => {
    expect(parseFeeShareScreen("Which banks with a fee share above 4% grew deposits by less than 10%?")).toEqual({ thresholdPct: 4, comparison: "above" });
    expect(parseFeeShareScreen("Which banks that grew deposits by less than 10% have a fee share above 4%?")).toEqual({ thresholdPct: 4, comparison: "above" });
  });

  it("reads 'fee-share' with a hyphen and a direction after the number", () => {
    expect(parseFeeShareScreen("Which credit unions have a fee-share below 3%?")).toEqual({ thresholdPct: 3, comparison: "below" });
    expect(parseFeeShareScreen("Which banks have a fee share of 4% or less?")).toEqual({ thresholdPct: 4, comparison: "at_most" });
    expect(parseFeeShareScreen("Which banks have a fee share of 4% or more?")).toEqual({ thresholdPct: 4, comparison: "at_least" });
  });

  it("is no screen without a share of revenue or without a threshold", () => {
    expect(parseFeeShareScreen("How does our fee share compare with peers?")).toBeNull();
    expect(parseFeeShareScreen("Which banks charge an overdraft fee below $30?")).toBeNull();
    expect(parseFeeShareScreen("What are 1b - <10b institutions doing around service fee income")).toBeNull();
    expect(parseFeeShareScreen("Which banks grew assets more than 5%?")).toBeNull();
  });

  it("names no fee and no asset size from the percent", () => {
    expect(matchFeeCategory(ISSUE_QUESTION)).toBeNull();
    expect(matchFeeCategory("Show institutions where service charges are below 3% of revenue")).toBeNull();
    expect(parseSegment(ISSUE_QUESTION)).toMatchObject({ minAssets: 1_000_000, maxAssets: 10_000_000, charterType: "credit_union", largest: 25 });
  });

  it("compares a share with its threshold the way the question puts it", () => {
    expect(meetsScreen(0.039, { thresholdPct: 4, comparison: "below" })).toBe(true);
    expect(meetsScreen(0.04, { thresholdPct: 4, comparison: "below" })).toBe(false);
    expect(meetsScreen(0.04, { thresholdPct: 4, comparison: "at_most" })).toBe(true);
    expect(meetsScreen(0.04, { thresholdPct: 4, comparison: "above" })).toBe(false);
    expect(meetsScreen(0.04, { thresholdPct: 4, comparison: "at_least" })).toBe(true);
    // 0.07 * 100 is 7.000000000000001 and 0.29 * 100 is 28.999999999999996: the threshold is
    // turned into a fraction, so a share exactly at it is at it.
    expect(meetsScreen(0.07, { thresholdPct: 7, comparison: "at_most" })).toBe(true);
    expect(meetsScreen(0.29, { thresholdPct: 29, comparison: "below" })).toBe(false);
  });
});

const row = (i: number, share: number | null, name = `Example Credit Union ${i}`): FeeShareScreenRow => ({
  institutionId: 100 + i,
  name,
  stateCode: "OH",
  totalAssets: 9_000_000_000 - i * 100_000_000,
  serviceCharges: share === null ? null : Math.round(share * 200_000_000),
  revenue: 200_000_000,
  share,
});

function data(rows: FeeShareScreenRow[], extra: Partial<FeeShareScreenData> = {}): FeeShareScreenData {
  const largest = Math.min(25, rows.length);
  return {
    source: "ncua",
    reportDate: "2026-06-30",
    peerSet: { minAssets: 1_000_000, maxAssets: 10_000_000, charterType: "credit_union", stateCode: null, largest, label: `the ${largest} largest credit unions with $1 billion to $10 billion in assets` },
    charterFrom: "question",
    rows,
    ...extra,
  };
}

describe("buildFeeShareScreen (#2028)", () => {
  const screen = { thresholdPct: 4, comparison: "below" as const };
  // 25 filers: 24 with a share (3 below 4%), 1 with none on file.
  const shares = [0.031, 0.027, 0.019, 0.05, 0.06, 0.07, 0.045, 0.052, 0.061, 0.071, 0.08, 0.055, 0.065, 0.075, 0.085, 0.042, 0.048, 0.058, 0.068, 0.078, 0.088, 0.044, 0.054, 0.064, null];
  const rows = shares.map((s, i) => row(i + 1, s, i === 0 ? "First Example Credit Union" : undefined));

  it("answers with the threshold, the count, the peer set, the filing date and the source", () => {
    const res = buildFeeShareScreen(screen, data(rows));
    expect(res.kind).toBe("research");
    expect(res.pageChange).toEqual({ screen: "none" });
    expect(res.shortAnswer).toContain("3 of the 24 credit unions screened had fee income below 4% of total revenue in the year to date through June 30, 2026.");
    expect(res.shortAnswer).toContain("The peer set is the 25 largest credit unions with $1 billion to $10 billion in assets that filed call reports for the quarter ending June 30, 2026, ranked by filed assets.");
    expect(res.shortAnswer).toContain("1 had no fee income or revenue on file and is not counted.");
    // The 12th and 13th of 24 shares are 5.8% and 6.0%.
    expect(res.shortAnswer).toContain("Their median share was 5.9%.");
    expect(res.shortAnswer).toContain("Below 4%: Example Credit Union 3 (1.9%), Example Credit Union 2 (2.7%), First Example Credit Union (3.1%).");
    // Every fact carries the call report source and its date.
    for (const fact of res.facts ?? []) {
      expect(fact.source).toMatchObject({ table: "institution_financial_records", asOf: "2026-06-30" });
      expect(fact.source.label).toMatch(/^NCUA 5300 call reports: fee income as a share of total revenue/);
    }
  });

  it("is never a fee price answer", () => {
    const res = buildFeeShareScreen(screen, data(rows));
    expect(res.answer).toBeUndefined();
    expect(res.shortAnswer).not.toMatch(/late|overdraft|nsf|position|peer median \$/i);
    expect(res.shortAnswer).not.toMatch(/—|Hamilton Pro|Magellan|Rosetta|Knox|Darwin|Deming|Hoovie|Atlas/);
  });

  it("gives no median below 10 institutions screened, but still the count", () => {
    const res = buildFeeShareScreen(screen, data(rows.slice(0, 6)));
    expect(res.shortAnswer).toContain("3 of the 6 credit unions screened");
    expect(res.shortAnswer).toContain("With fewer than 10 institutions screened, no median is given.");
    expect(res.shortAnswer).not.toMatch(/median share was/);
  });

  it("says plainly when none meets it, and when none filed a share", () => {
    expect(buildFeeShareScreen({ thresholdPct: 1, comparison: "below" }, data(rows)).shortAnswer).toMatch(/^None of the 24 credit unions screened had fee income below 1% of total revenue/);
    const none = buildFeeShareScreen(screen, data([row(1, null), row(2, 0)]));
    expect(none.shortAnswer).toMatch(/^None of the 2 largest credit unions .* has fee income as a share of total revenue on file/);
    const empty = buildFeeShareScreen(screen, data([], { peerSet: { minAssets: 1_000_000, maxAssets: 10_000_000, charterType: "credit_union", stateCode: null, largest: null, label: "credit unions with $1 billion to $10 billion in assets" } }));
    expect(empty.shortAnswer).toBe("No credit unions with $1 billion to $10 billion in assets filed call reports for the quarter ending June 30, 2026, so Hamilton can't screen them for a share below 4%.");
  });

  it("names banks' measure and quarter, and says when the charter came from the researched institution", () => {
    const res = buildFeeShareScreen(screen, data(rows.slice(0, 12), {
      source: "fdic",
      charterFrom: "subject",
      sizeOf: "First Example Bank",
      peerSet: { minAssets: 1_000_000, maxAssets: 10_000_000, charterType: "bank", stateCode: null, largest: null, label: "banks with $1 billion to $10 billion in assets" },
    }));
    expect(res.shortAnswer).toContain("3 of the 12 banks screened had deposit service charges below 4% of total revenue in the quarter ending June 30, 2026.");
    expect(res.shortAnswer).toContain("The peer set is the 12 banks with $1 billion to $10 billion in assets, the size band of First Example Bank, that filed call reports for the quarter ending June 30, 2026.");
    expect(res.shortAnswer).toContain("Only banks are screened: credit unions file a different fee income measure, so the two are never pooled.");
    expect(res.facts?.[0].source.label).toMatch(/^FDIC call reports: service charges on deposit accounts as a share of total revenue, quarter ending June 30, 2026/);
  });

  it("counts Frost Bank and Space Coast Credit Union but never names them", () => {
    const listed = [row(1, 0.02, "Frost Bank"), row(2, 0.021, "Space Coast Credit Union"), row(3, 0.022, "First Example Credit Union"), ...rows.slice(3, 12)];
    const res = buildFeeShareScreen(screen, data(listed));
    expect(res.shortAnswer).toMatch(/^3 of the 12 credit unions screened/);
    // The two never-named institutions stay in the count as "2 more".
    expect(res.shortAnswer).toContain("Below 4%: First Example Credit Union (2.2%), and 2 more.");
    expect(JSON.stringify(res)).not.toMatch(/frost|space coast/i);
  });

  it("caps the names and counts the rest", () => {
    const many = Array.from({ length: 14 }, (_, i) => row(i + 1, 0.01 + i * 0.001));
    const res = buildFeeShareScreen(screen, data(many));
    expect(res.shortAnswer).toMatch(/^All 14 credit unions screened had fee income below 4% of total revenue/);
    expect(res.shortAnswer).toMatch(/, and 4 more\./);
  });

  it("shows two decimals when a listed share would round onto the threshold", () => {
    const res = buildFeeShareScreen(screen, data([row(1, 0.0399, "First Example Credit Union"), row(2, 0.031, "Example Credit Union"), row(3, 0.05)]));
    expect(res.shortAnswer).toContain("Below 4%: Example Credit Union (3.1%), First Example Credit Union (3.99%).");
  });

  it("says plainly what it could not read, never a fee in its place", () => {
    for (const gap of ["charter", "quarter", "read"] as const) {
      const res = feeShareScreenUnavailable(screen, gap, "the 25 largest credit unions with $1 billion to $10 billion in assets");
      expect(res.shortAnswer).toMatch(/^Hamilton can't screen for fee income as a share of revenue below 4%/);
      expect(res.answer).toBeUndefined();
      expect(res.shortAnswer).not.toMatch(/late|overdraft|—/i);
    }
  });
});
