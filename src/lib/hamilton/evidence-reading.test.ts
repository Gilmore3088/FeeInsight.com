import { describe, expect, it } from "vitest";
import { deriveDifference, derivePercentChange, type HamiltonEvidenceFact } from "./evidence-contract";
import { readDerivation, readRefusal } from "./evidence-reading";

function fee(id: number, institutionId: number | null, value: number, reportingDate: string): HamiltonEvidenceFact {
  return {
    id: `fee:published:${id}`,
    kind: "observed",
    scope: { institutionId, feeCategory: "overdraft", product: "Overdraft", reportingDate, effectiveDate: null, accountApplicability: "consumer" },
    value,
    unit: "usd",
    currency: "USD",
    frequency: "per item",
    conditions: null,
    status: "published",
    source: {
      label: "Published fee catalog", table: "published_fee_catalog", recordId: id, sourceDocumentIds: [id + 100],
      urls: [`https://fixture.invalid/${id}.pdf`], asOf: reportingDate, verificationEventId: null,
    },
  };
}

describe("readDerivation", () => {
  const a = fee(1, 9001, 10, "2026-06-30");
  const b = fee(2, 9002, 35, "2026-06-30");
  const derived = deriveDifference("d", a, b).fact!;

  it("reads nothing when an input is missing, rather than guessing", () => {
    expect(readDerivation(derived, [a], new Map(), "overdraft")).toBeNull();
  });

  it("names an institution it has no name for by its id", () => {
    expect(readDerivation(derived, [a, b], new Map(), "overdraft")).toBe(
      "Institution 9001's overdraft fee is $25 lower than Institution 9002's ($10 vs $35, both as of Jun 30, 2026).",
    );
  });

  it("keeps 'an unnamed institution' lower case mid-sentence and capital at the start", () => {
    const unnamed = fee(3, null, 35, "2026-06-30");
    expect(readDerivation(deriveDifference("d", a, unnamed).fact!, [a, unnamed], new Map(), "overdraft")).toBe(
      "Institution 9001's overdraft fee is $25 lower than an unnamed institution's ($10 vs $35, both as of Jun 30, 2026).",
    );
    expect(readDerivation(deriveDifference("d", unnamed, a).fact!, [unnamed, a], new Map(), "overdraft")).toMatch(/^An unnamed institution's/);
  });

  it("never says 'both as of' for inputs from different dates, or reads a value its inputs don't give", () => {
    const older = fee(4, 9002, 35, "2025-06-30");
    expect(readDerivation(derived, [a, { ...b, id: b.id, scope: older.scope }], new Map(), "overdraft")).toBeNull();
    expect(readDerivation({ ...derived, value: -20 }, [a, b], new Map(), "overdraft")).toBeNull();
  });

  it("says a change too small to show at one decimal is less than 0.1%, not 'did not change'", () => {
    const before = fee(5, 9001, 100, "2025-06-30");
    const after = fee(6, 9001, 100.04, "2026-06-30");
    const change = derivePercentChange("c", after, before).fact!;
    expect(change.value).toBe(0);
    expect(readDerivation(change, [after, before], new Map([[9001, "Bank A"]]), "overdraft")).toBe(
      "Bank A's overdraft fee rose less than 0.1%, from $100 (Jun 30, 2025) to $100.04 (Jun 30, 2026).",
    );
  });

  it("writes thousands separators for amounts with cents", () => {
    const big = fee(7, 9001, 1234.5, "2026-06-30");
    const small = fee(8, 9002, 1000, "2026-06-30");
    expect(readDerivation(deriveDifference("d", big, small).fact!, [big, small], new Map(), "overdraft")).toContain("($1,234.50 vs $1,000,");
  });
});

describe("readRefusal (#1717)", () => {
  const names = new Map([[9001, "Bank A"], [9002, "Bank B"]]);

  it("reads a fee new from $0 as new, with both dates, and never as a percent", () => {
    const before = fee(10, 9001, 0, "2025-06-30");
    const after = fee(11, 9001, 12.5, "2026-06-30");
    const result = derivePercentChange("c", after, before);
    expect(result).toEqual({ fact: null, problems: ["zero_denominator"] });
    const line = readRefusal(result.problems, after, before, names, "overdraft");
    expect(line).toBe("Bank A's overdraft fee is a new $12.50 fee (was $0 on Jun 30, 2025; $12.50 on Jun 30, 2026).");
    expect(line).not.toMatch(/%/);
  });

  it("reads $0 to $0 as no change", () => {
    const before = fee(12, 9001, 0, "2025-06-30");
    const after = fee(13, 9001, 0, "2026-06-30");
    expect(readRefusal(["zero_denominator"], after, before, names, "overdraft")).toBe(
      "Bank A's overdraft fee did not change, from $0 (Jun 30, 2025) to $0 (Jun 30, 2026).",
    );
  });

  it("shows both dated values when fees from different dates are refused", () => {
    const a = fee(14, 9001, 10, "2026-06-30");
    const b = fee(15, 9002, 35, "2024-06-30");
    expect(readRefusal(deriveDifference("d", a, b).problems, a, b, names, "overdraft")).toBe(
      "Not compared: Bank A's $10 is as of Jun 30, 2026 and Bank B's $35 is as of Jun 30, 2024; fees from different dates aren't one comparison.",
    );
  });

  it("explains a change whose older value was put first", () => {
    const older = fee(16, 9001, 100, "2025-06-30");
    const newer = fee(17, 9001, 90, "2026-06-30");
    expect(readRefusal(derivePercentChange("c", older, newer).problems, older, newer, names, "overdraft")).toBe(
      "Not compared as a change: Bank A's $100 (Jun 30, 2025) is older than its $90 (Jun 30, 2026), so it can't be the current overdraft fee.",
    );
  });

  it("reads nothing it can't explain in full: other problems, several, undated or unknown values, or another bank", () => {
    const a = fee(18, 9001, 10, "2026-06-30");
    const zeroB = fee(19, 9002, 0, "2025-06-30");
    expect(readRefusal(["unit_mismatch"], a, zeroB, names, "overdraft")).toBeNull();
    expect(readRefusal(["zero_denominator", "institution_mismatch"], a, zeroB, names, "overdraft")).toBeNull();
    expect(readRefusal(["zero_denominator"], a, zeroB, names, "overdraft")).toBeNull();
    const undated = { ...a, scope: { ...a.scope, reportingDate: null } };
    expect(readRefusal(["reporting_period_mismatch"], undated, zeroB, names, "overdraft")).toBeNull();
    expect(readRefusal(["reporting_period_mismatch"], { ...a, value: null }, zeroB, names, "overdraft")).toBeNull();
    expect(readRefusal([], a, zeroB, names, "overdraft")).toBeNull();
  });

  it("never writes an em dash", () => {
    const a = fee(20, 9001, 10, "2026-06-30");
    const b = fee(21, 9002, 35, "2024-06-30");
    expect(readRefusal(["reporting_period_mismatch"], a, b, names, "overdraft")).not.toContain("—");
  });
});
