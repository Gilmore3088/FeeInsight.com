import { describe, expect, it } from "vitest";
import type { FiledFeeIncome } from "@/lib/data-store/fee-revenue";
import { feeIncomeAgainstPeers } from "./fee-income-peers";
import { writtenAnswerCheck } from "@/lib/hamilton/answer-save";

// Invented rows for tests only; no figure here is live data.
function row(id: number, ratio: number | null, extra: Partial<FiledFeeIncome> = {}): FiledFeeIncome {
  return {
    institution_id: id,
    institution_name: `Synthetic ${id}`,
    charter_type: "bank",
    state_code: "MN",
    asset_size_tier: "community_small",
    fed_district: 9,
    report_date: "2026-06-30",
    financial_source: "fdic",
    total_assets: 1_000_000 * id,
    service_charge_income: 100 * id,
    fee_income_ratio: ratio,
    ...extra,
  };
}

describe("feeIncomeAgainstPeers", () => {
  const rows = [row(1, 3), row(2, 1), row(3, 2), row(4, 4), row(5, 5), row(6, 6), row(7, 7)];

  it("compares the institution with the median of its peers, itself left out", () => {
    const result = feeIncomeAgainstPeers(rows, 1, {});
    expect(result).toMatchObject({ view: "peers", quarter: "2026-06-30", peer_count: 6, peer_median_income_per_10k_assets: 4.5, peers_below_subject: 2 });
    expect("peers" in result && result.peers.map((p) => p.institution_id)).not.toContain(1);
    expect(result).toMatchObject({ comparison: {
      population_basis: "filed_financials", fee_schedule_coverage_required: false,
      minimum_median_count: 5, subject_included: false,
    } });
    expect(result).not.toHaveProperty("subject.avg_fee");
    expect(result).not.toHaveProperty("subject.fee_count");
  });

  it("uses only the hand-picked peers of a saved set, with its other filters too", () => {
    expect(feeIncomeAgainstPeers(rows, 1, { institutionIds: [2, 3], states: ["TX"] })).toMatchObject({ peer_count: 0 });
    const result = feeIncomeAgainstPeers(rows, 1, { institutionIds: [2, 3], states: ["MN"] });
    expect(result).toMatchObject({ peer_count: 2, peer_median_income_per_10k_assets: null });
    expect("message" in result && result.message).toContain("below 5 there is no median");
  });

  it("never mixes another quarter or the other regulator's income", () => {
    const mixed = [...rows, row(8, 50, { report_date: "2026-03-31" }), row(9, 50, { financial_source: "ncua" })];
    expect(feeIncomeAgainstPeers(mixed, 1, {})).toMatchObject({ peer_count: 6, peer_median_income_per_10k_assets: 4.5 });
  });

  it("filters by state, charter, asset tier and district", () => {
    const varied = [...rows, row(10, 9, { state_code: "WI" }), row(11, 9, { charter_type: "credit_union" }), row(12, 9, { asset_size_tier: "large" }), row(13, 9, { fed_district: 7 })];
    expect(feeIncomeAgainstPeers(varied, 1, { states: ["MN"], charterType: "bank", assetTiers: ["community_small"], fedDistricts: [9] })).toMatchObject({ peer_count: 6 });
    expect(feeIncomeAgainstPeers(varied, 1, {})).toMatchObject({ peer_count: 9 });
  });

  it("rejects missing or unknown source identity, including equal invalid sources", () => {
    for (const financial_source of [null, undefined, "ffiec", "mystery", "FDIC"]) {
      const invalid = [row(1, 3, { financial_source }), row(2, 4, { financial_source })];
      expect(feeIncomeAgainstPeers(invalid, 1, {})).toMatchObject({ error: expect.stringContaining("cannot be compared") });
    }
  });

  it("excludes the same regulator attached to the wrong charter, and requires a dated subject", () => {
    const mixed = [...rows, row(8, 100, { charter_type: "credit_union" }), row(9, 200, { charter_type: "unknown" })];
    expect(feeIncomeAgainstPeers(mixed, 1, {})).toMatchObject({ peer_count: 6, peer_median_income_per_10k_assets: 4.5 });
    expect(feeIncomeAgainstPeers([row(1, 3, { report_date: null })], 1, {})).toHaveProperty("error");
  });

  it("carries source, definition, period, date, count, filters and subject inclusion with its figures", () => {
    expect(feeIncomeAgainstPeers(rows, 1, { states: ["MN"] })).toMatchObject({
      comparison: { source: "fdic", charter_type: "bank", definition: expect.stringContaining("deposit"), period_basis: "standalone_quarter", report_date: "2026-06-30", sample_size: 6, subject_included: false, filters: { states: ["MN"] } },
    });
  });

  it("says so when the institution has no fee income on file", () => {
    const result = feeIncomeAgainstPeers(rows, 99, {});
    expect(result).toMatchObject({ view: "peers", error: expect.stringContaining("canonical financial filing") });
    expect(result).toMatchObject({ error: expect.stringContaining("Published fee-schedule coverage is not required") });
    expect(JSON.stringify(result)).not.toContain("three published fees");
  });

  it("suppresses four comparable filers, publishes five, and preserves a genuine zero", () => {
    const financials = [row(1, 0, { service_charge_income: 0 }), ...rows.slice(1, 6)];
    expect(feeIncomeAgainstPeers(financials.slice(0, 5), 1, {})).toMatchObject({
      peer_count: 4, peer_median_income_per_10k_assets: null, peer_median_service_charge_income: null,
      subject: { service_charge_income: 0, income_per_10k_assets: 0 },
    });
    expect(feeIncomeAgainstPeers(financials, 1, {})).toMatchObject({
      peer_count: 5, peer_median_income_per_10k_assets: 4, peer_median_service_charge_income: 400,
    });
  });

  it.each([
    ["ncua", "credit_union"], ["fdic", "bank"],
  ] as const)("preserves an inactive selected %s subject while excluding inactive peers", (source, charter) => {
    const financials = rows.map((item) => ({ ...item, financial_source: source, charter_type: charter,
      regulatory_status: item.institution_id <= 2 ? "inactive" : item.institution_id === 3 ? "active" : null,
    }));
    const result = feeIncomeAgainstPeers(financials, 1, {});
    expect(result).toMatchObject({
      subject: { institution_id: 1, regulatory_status: "inactive", service_charge_income: 100 },
      peer_count: 5, peer_median_income_per_10k_assets: 5, peer_median_service_charge_income: 500,
      comparison: { status_basis: "current_registry_status", inactive_peers_excluded: true, sample_size: 5 },
    });
    expect("peers" in result && result.peers.map((item) => item.institution_id)).not.toContain(2);
    expect("comparison" in result && result.comparison.eligibility).toContain("does not establish historical activity");
    financials[6].regulatory_status = "inactive";
    expect(feeIncomeAgainstPeers(financials, 1, {})).toMatchObject({
      subject: { institution_id: 1, regulatory_status: "inactive" }, peer_count: 4,
      peer_median_service_charge_income: null, peer_median_income_per_10k_assets: null,
    });
  });

  it("passes the full answer gate for dollar totals without treating asset intensity as a dollar total or revenue share (#2358)", () => {
    const cus = rows.map((r) => ({ ...r, fee_income_ratio: r.institution_id === 1 ? 7.49 : r.fee_income_ratio, financial_source: "ncua", charter_type: "credit_union" }));
    const result = feeIncomeAgainstPeers(cus, 1, {});
    expect(writtenAnswerCheck("The credit union reported $100,000 in quarterly broad fee income, against a peer median of $450,000.", [result])).toMatchObject({ passed: true, problems: [] });
    expect(writtenAnswerCheck("The peer median was $450.", [result]).passed).toBe(false);
    expect(writtenAnswerCheck("The peer median share of revenue was 4.5%.", [result]).passed).toBe(false);
    expect(writtenAnswerCheck("The peer median income was $4,500.", [result]).passed).toBe(false);
    expect(writtenAnswerCheck("Fee income was $7.49 per $10,000 of total assets.", [result])).toMatchObject({ passed: true, figureCheck: { checked: 1, unmatched: [] } });
    expect(writtenAnswerCheck("Fee income per ten thousand dollars of assets was $7.49.", [result]).passed).toBe(true);
    for (const text of ["Fee income was $7.49.", "Fee income was 7.49% of revenue.", "Fee income was $7.49 per account.", "Fee income was $7.49 per $1,000 of total assets."]) {
      expect(writtenAnswerCheck(text, [result]).passed, text).toBe(false);
    }
  });
});

describe("income basis label (#1245)", () => {
  it("calls a credit union's figure the quarter's own income, never year to date", () => {
    const cus = [1, 2, 3, 4, 5, 6, 7].map((id) => row(id, id, { financial_source: "ncua", charter_type: "credit_union" }));
    const result = feeIncomeAgainstPeers(cus, 1, {});
    expect(result).toMatchObject({ income_basis: expect.stringContaining("for this quarter") });
    expect(JSON.stringify(result)).not.toContain("year to date at this quarter");
  });
});
