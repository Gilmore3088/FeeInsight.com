import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: {} }));

import { medianOf, summarizeIssuerTerms } from "./cfpb-card-agreements-aggregates";

describe("summarizeIssuerTerms", () => {
  it("counts issuers once, separates dollars from percentages and carries counts", () => {
    const rows = [
      // Issuer A: two products, $0 and $95 -> charging, issuer median of charging products $95.
      { issuerKey: "inst:1", group: "large", termType: "annual_fee", amountUsd: 0, amountPercent: null },
      { issuerKey: "inst:1", group: "large", termType: "annual_fee", amountUsd: 95, amountPercent: null },
      // Issuer B: no annual fee.
      { issuerKey: "inst:2", group: "large", termType: "annual_fee", amountUsd: 0, amountPercent: null },
      // Issuer C: $195.
      { issuerKey: "inst:3", group: "large", termType: "annual_fee", amountUsd: 195, amountPercent: null },
      { issuerKey: "inst:3", group: "large", termType: "foreign_transaction_fee", amountUsd: null, amountPercent: 3 },
      { issuerKey: "issuer:x", group: null, termType: "annual_fee", amountUsd: 50, amountPercent: null },
    ];
    const out = summarizeIssuerTerms(rows);
    expect(out.find((r) => r.group === "large" && r.term_type === "annual_fee")).toEqual({
      group: "large",
      term_type: "annual_fee",
      issuers_known: 3,
      issuers_charging: 2,
      share_charging: 2 / 3,
      median_usd: 145,
      median_usd_issuers: 2,
      median_percent: null,
      median_percent_issuers: 0,
    });
    expect(out.find((r) => r.term_type === "foreign_transaction_fee")).toMatchObject({ median_percent: 3, median_percent_issuers: 1, median_usd: null });
    expect(out.find((r) => r.group === "unmatched")).toMatchObject({ issuers_known: 1, median_usd: 50 });
  });

  it("medianOf handles empty and even lists", () => {
    expect(medianOf([])).toBeNull();
    expect(medianOf([1, 3, 2, 4])).toBe(2.5);
  });
});
