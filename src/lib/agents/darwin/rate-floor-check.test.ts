// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { findRateFloors, storedLine, type RateFloorRow } from "@/lib/agents/darwin/rate-floor-check";

// #1615: every live flat fee the check's prefilter selected on prod (read-only, Oct 25), with its
// name, amount, category, stored line and the rates of the bank's live same-category rate fees.
type FixtureRow = [number, number, string, number, string, string, number[]];
const fixture = JSON.parse(
  readFileSync(new URL("./__fixtures__/rate-floor-live-2026-10-25.json", import.meta.url), "utf8"),
) as FixtureRow[];
const rows: RateFloorRow[] = fixture.map(([id, institution, name, amount, key, line, rates]) => ({
  fee_published_id: id,
  fee_verified_id: id + 1_000_000,
  institution_id: institution,
  fee_name: name,
  amount,
  canonical_fee_key: key,
  source_line: `Knox deterministic extraction from Rosetta artifact #1. canonical_hint=${key}; excerpt="${line}"`,
  live_rates: rates,
}));

describe("Darwin's rate floor re-check (#1615)", () => {
  it("reads the stored excerpt out of Knox's extraction note", () => {
    expect(storedLine('Knox deterministic extraction. canonical_hint=x; excerpt="Loan Late Fee | $10 or 5%"')).toBe("Loan Late Fee | $10 or 5%");
  });

  it("matches the Oct 25 dry run: 53 of 58 live flat fees at 48 institutions, 2 with the rate fee live", () => {
    const found = findRateFloors(rows);
    expect(found.checked).toBe(58);
    expect(found.matched).toBe(53);
    expect(found.institutions).toBe(48);
    expect(found.rateTwinLive).toBe(2);
    const matched = new Set(found.matches.map((fee) => fee.feePublishedId));
    // Kept: the fee's own price, with another fee's floor beside it.
    for (const kept of [20404, 53988, 83788, 132118]) expect(matched.has(kept)).toBe(false);
    // Known miss: 80150 is a floor ("C a sh Adva nce. ......$5.00 or 2% whichever is great er", text
    // 242), missed for its misaligned excerpt and spaced OCR text.
    expect(matched.has(80150)).toBe(false);
    expect(found.matches.filter((fee) => fee.rateTwinLive).map((fee) => fee.feePublishedId)).toEqual([13406, 68415]);
  });

  it("names the rate and floor in the takedown reason", () => {
    const fee = findRateFloors(rows).matches.find((row) => row.feePublishedId === 74887);
    expect(fee).toMatchObject({ amount: 15, ratePercent: 5, canonicalFeeKey: "late_payment", rateTwinLive: false });
    expect(fee?.reason).toBe("rate_floor: 5% or $15, whichever is greater");
  });

  it("reads each fee once", () => {
    expect(findRateFloors([...rows, rows[0]]).checked).toBe(58);
  });
});
