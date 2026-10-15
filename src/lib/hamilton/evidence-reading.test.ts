import { describe, expect, it } from "vitest";
import { deriveDifference, derivePercentChange, type HamiltonEvidenceFact } from "./evidence-contract";
import { readDerivation } from "./evidence-reading";

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
