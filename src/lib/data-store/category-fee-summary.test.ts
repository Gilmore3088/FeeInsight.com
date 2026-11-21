import { describe, expect, it } from "vitest";
import { categoryFeeSummary } from "./category-fee-summary";
import { summarizeFees, summarizeFeesBy } from "./fee-stats";
import type { FeeInstance } from "./fees";

function fee(i: number, overrides: Partial<FeeInstance> = {}): FeeInstance {
  return {
    id: i,
    institution_name: `Inst ${i % 40}`,
    institution_id: 1 + (i % 40),
    amount: [10, 25, 30, 0, 45][i % 5],
    frequency: null,
    conditions: null,
    charter_type: i % 2 === 0 ? "bank" : "credit_union",
    state_code: "TX",
    asset_size_tier: null,
    asset_size: null,
    review_status: "approved",
    extraction_confidence: 1,
    canonical_fee_key: null,
    variant_type: null,
    source_document_id: i % 9 === 0 ? null : 700 + (i % 40),
    schedule_keys: [`u:inst${i % 40}.example/fees`],
    schedule_group: i % 4 === 0 ? "77" : null,
    product_exception: i % 17 === 0,
    ...overrides,
  };
}

/** The computation /fees/[category] ran on every cached fee row before the rows left the cache. */
function previousPageFigures(category: string, fees: FeeInstance[]) {
  const rows = fees.filter((f) => f.source_document_id !== null).map((f) => ({ ...f, fee_category: category }));
  if (rows.length === 0) return null;
  const byCharter = summarizeFeesBy(rows, (r) => (r.charter_type === "bank" || r.charter_type === "credit_union" ? r.charter_type : null));
  return {
    all: summarizeFees(rows),
    bank_median_amount: byCharter.get("bank")?.median_amount ?? null,
    cu_median_amount: byCharter.get("credit_union")?.median_amount ?? null,
  };
}

describe("categoryFeeSummary", () => {
  it.each(["overdraft", "safe_deposit_box", "wire_domestic_outgoing"])("matches the page's previous figures for %s", (category) => {
    const fees = Array.from({ length: 400 }, (_, i) => fee(i));
    const summary = JSON.parse(JSON.stringify(categoryFeeSummary(category, fees)));
    expect(summary).toStrictEqual(previousPageFigures(category, fees));
    expect(summary.all.institution_count).toBeGreaterThan(0);
  });

  it("is null when no row has a source document, so the page falls back to the snapshot", () => {
    expect(categoryFeeSummary("overdraft", [fee(1, { source_document_id: null })])).toBeNull();
  });
});
