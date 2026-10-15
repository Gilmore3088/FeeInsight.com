import { describe, expect, it } from "vitest";
import type { IndexEntry } from "@/lib/data-store/fee-index";
import type { StateComparison } from "@/lib/research-report/state-findings";
import { boardFees, charterHeadline, leadFindings, splitForAccess } from "./state-view";

function comparison(fee_category: string, median: number, institutions: number, national: number | null = 30): StateComparison {
  return {
    fee_category,
    median_amount: median,
    p25_amount: median - 5,
    p75_amount: median + 5,
    institution_count: institutions,
    bank_count: Math.floor(institutions / 2),
    cu_count: Math.ceil(institutions / 2),
    national_median: national,
    national_p25: national === null ? null : national - 5,
    national_p75: national === null ? null : national + 5,
    delta_pct: national ? ((median - national) / national) * 100 : null,
  };
}

function entry(fee_category: string, median_amount: number | null): IndexEntry {
  return {
    fee_category,
    fee_family: null,
    median_amount,
    p25_amount: null,
    p75_amount: null,
    min_amount: null,
    max_amount: null,
    institution_count: 6,
    observation_count: 6,
    approved_count: 6,
    bank_count: 6,
    cu_count: 0,
    maturity_tier: "provisional",
    last_updated: null,
  };
}

describe("state board", () => {
  const comparisons = [
    comparison("garnishment", 100, 40),
    comparison("nsf", 20, 30),
    comparison("overdraft", 40, 20),
  ];

  it("lists the everyday fees first, in their usual order, with each fee's place against the U.S.", () => {
    const fees = boardFees(comparisons, [entry("overdraft", 35)], [entry("overdraft", 30)], {
      overdraft: [
        { v: 30, c: "c" },
        { v: 35, c: "b" },
      ],
    });
    expect(fees.map((f) => f.key)).toEqual(["overdraft", "nsf", "garnishment"]);
    expect(fees[0]).toMatchObject({ median: 40, position: "above", bank: { median: 35 }, cu: { median: 30 } });
    expect(fees[0].values).toEqual([
      [30, 2],
      [35, 1],
    ]);
    // NSF at $20 sits below the U.S. middle half ($25 to $35); no values cached yet.
    expect(fees[1]).toMatchObject({ position: "below", values: [] });
  });

  it("shows free visitors the featured fees and names the rest as Hamilton's", () => {
    const fees = boardFees(comparisons, [], [], undefined);
    const free = splitForAccess(fees, false);
    expect(free.shown.map((f) => f.key)).toEqual(["overdraft", "nsf"]);
    expect(free.locked.map((f) => f.key)).toEqual(["garnishment"]);
    expect(splitForAccess(fees, true).locked).toEqual([]);
  });

  it("says which charter is lower on more fees", () => {
    const fees = boardFees(
      comparisons,
      [entry("overdraft", 35), entry("nsf", 25), entry("garnishment", 90)],
      [entry("overdraft", 30), entry("nsf", 20), entry("garnishment", 100)],
      undefined,
    );
    expect(charterHeadline(fees)).toBe("Credit unions are lower on 2 of 3 fees");
    expect(charterHeadline(fees.slice(2))).toBe("Banks are lower on 1 of 1 fee");
    expect(charterHeadline([])).toBeNull();
    const tie = boardFees(comparisons.slice(0, 1), [entry("garnishment", 90)], [entry("garnishment", 90)], undefined);
    expect(charterHeadline(tie)).toBe("Banks and credit unions charge the same on 1 fee");
  });

  it("keeps three findings, each with the figures behind it, tied to a fee the board draws", () => {
    const fees = boardFees(comparisons, [entry("overdraft", 35)], [entry("overdraft", 30)], undefined);
    const findings = leadFindings(
      [
        { key: "overdraft", figure: "$40.00", headline: "The typical overdraft fee", detail: "", exhibit: "benchmarks", fee_category: "overdraft" },
        { key: "discount", figure: "−33%", headline: "NSF / Returned Item is the biggest discount", detail: "", exhibit: "position", fee_category: "nsf" },
        { key: "charter-gap", figure: "$5", headline: "Credit unions charge less", detail: "", exhibit: "charters", fee_category: "overdraft" },
        { key: "d", figure: "$1", headline: "d", detail: "", exhibit: "x", fee_category: "nsf" },
      ],
      fees,
    );
    expect(findings).toEqual([
      { key: "overdraft", figure: "$40", headline: "The typical overdraft fee", note: "$40 vs U.S. $30 · 20 institutions", fee: "overdraft" },
      { key: "discount", figure: "−33%", headline: "NSF / returned item runs furthest below the U.S.", note: "$20 vs U.S. $30 · 30 institutions", fee: "nsf" },
      { key: "charter-gap", figure: "$5", headline: "Credit unions charge less", note: "$30 at credit unions · $35 at banks", fee: "overdraft" },
    ]);
    // A finding about a fee the board doesn't draw (or no fee at all) taps nothing.
    expect(leadFindings([{ key: "t", figure: "3 of 5", headline: "t", detail: "", exhibit: "x" }], fees)[0]).toMatchObject({ fee: null, note: "" });
  });
});
