import { describe, expect, it } from "vitest";

import { checkRateAgainstSource } from "@/lib/custom-report/source-check";
import { summarizeRates } from "@/lib/data-store/fee-stats";
import { statedInOwnSource, verificationReasonCode, type RawFeeRow } from "@/lib/agents/darwin/verify";
import { traceLiveFee } from "@/lib/agents/hamilton/source-check";
import { decidePriorFee } from "@/lib/agents/hamilton/publish";
import { toRateFees } from "@/lib/data-store/rate-fees";
import { formatRateFee, percentFeeAllowed, rateDisplayParts } from "./percent-fees";

const schedule = [
  "DEBIT CARD SERVICES",
  "Card Replacement | $5.00",
  "Foreign Transaction Fee | 1.10% of the transaction amount",
  "Cash Advance Fee",
  "3%",
  "Kasasa Cash: when qualifications are not met, the interest rate earned is 0.05% APY",
].join("\n");

function rawRow(overrides: Partial<RawFeeRow> = {}): RawFeeRow {
  return {
    fee_raw_id: 1,
    institution_id: 7,
    source_url: "https://bank.example/fees.pdf",
    document_r2_key: null,
    extraction_confidence: 0.9,
    fee_name: "Foreign Transaction Fee",
    amount: null,
    frequency: "per_transaction",
    outlier_flags: ["canonical_hint:card_foreign_txn"],
    conditions: null,
    source_document_id: 55,
    amount_kind: "percent",
    rate_percent: 1.1,
    rate_basis: "transaction",
    ...overrides,
  };
}

describe("percentage fees", () => {
  it("reads as a rate of its basis", () => {
    expect(formatRateFee({ amount_kind: "percent", rate_percent: "1.1000", rate_basis: "transaction" })).toBe("1.1% of the transaction");
    expect(formatRateFee({ amount_kind: "percent", rate_percent: 3, rate_basis: "advance", rate_min_amount: 10 })).toBe("3% of the advance ($10 minimum)");
    expect(formatRateFee({ amount_kind: "flat", rate_percent: null })).toBeNull();
  });

  it("publishes rates only in categories that charge them", () => {
    expect(percentFeeAllowed("card_foreign_txn")).toBe(true);
    expect(percentFeeAllowed("cash_advance")).toBe(true);
    expect(percentFeeAllowed("coin_counting")).toBe(true);
    expect(percentFeeAllowed("late_payment")).toBe(true);
    expect(percentFeeAllowed("atm_non_network")).toBe(false);
  });

  it("traces a rate to its row, including a rate printed under its name", () => {
    expect(checkRateAgainstSource(schedule, "Foreign Transaction Fee", 1.1, ".")).toMatchObject({ ok: true });
    expect(checkRateAgainstSource(schedule, "Cash Advance Fee", 3, ".")).toMatchObject({ ok: true });
    expect(checkRateAgainstSource(schedule, "Foreign Transaction Fee", 1, ".")).toEqual({ ok: false, reason: "amount_not_the_fee" });
  });

  it("gives each rate on a shared row to the words before it", () => {
    const row = "Cash Advance Fee Either $5.00 or 3.0% of the amount. Foreign Transaction Fee Up to 1.0% of each transaction.";
    expect(checkRateAgainstSource(row, "Foreign Transaction Fee", 1, ".").ok).toBe(true);
    expect(checkRateAgainstSource(row, "Cash Advance Fee", 3, ".").ok).toBe(true);
    expect(checkRateAgainstSource(row, "Cash Advance Fee", 1, ".").ok).toBe(false);
  });

  it("takes the fee word from a heading just above, never for an interest row", () => {
    const coins = "Coin Counting Fees\nCoin Counting | 10% of total";
    expect(checkRateAgainstSource(coins, "Coin Counting", 10, ".").ok).toBe(true);
    const savings = "Savings Fees\nKasasa Saver | 2.5% APY on balances to $25,000";
    expect(checkRateAgainstSource(savings, "Kasasa Saver", 2.5, ".").ok).toBe(false);
  });

  it("never reads the end of a range as the bank's rate", () => {
    expect(checkRateAgainstSource("Most cards charge the typical 2.5-3.5% foreign transaction fee.", "foreign transaction fee", 3.5, ".").ok).toBe(false);
  });

  it("never traces an interest rate as a fee", () => {
    expect(checkRateAgainstSource(schedule, "Kasasa Cash interest rate", 0.05, ".").ok).toBe(false);
  });

  it("Darwin verifies an allowed rate and holds the rest", () => {
    expect(verificationReasonCode(rawRow(), "card_foreign_txn")).toBeNull();
    expect(verificationReasonCode(rawRow({ rate_percent: 9 }), "card_foreign_txn")).toBe("outside_envelope");
    expect(verificationReasonCode(rawRow({ amount: 1 }), "card_foreign_txn")).toBe("invalid_amount");
    expect(verificationReasonCode(rawRow({ fee_name: "Non-network ATM Fee" }), "atm_non_network")).toBe("percent_not_publishable");
    expect(statedInOwnSource(rawRow(), new Map([[55, schedule]]))).toBe(true);
    expect(statedInOwnSource(rawRow({ rate_percent: 2 }), new Map([[55, schedule]]))).toBe(false);
  });

  it("Hamilton's source check keeps a live rate that its document states", () => {
    const fee = {
      fee_published_id: 1,
      lineage_ref: 2,
      fee_raw_id: 3,
      institution_id: 7,
      source: "knox",
      source_document_id: 55,
      canonical_fee_key: "card_foreign_txn",
      fee_name: "Foreign Transaction Fee",
      amount: null,
      amount_kind: "percent",
      rate_percent: "1.1000",
    };
    expect(traceLiveFee(fee, [{ source_document_id: 55, normalized_text: schedule }])).toEqual({ kind: "traced", sourceDocumentId: 55 });
    expect(traceLiveFee({ ...fee, rate_percent: "2.0000" }, [{ source_document_id: 55, normalized_text: schedule }]).kind).toBe("untraceable");
  });

  it("a rate never matches or replaces a dollar amount", () => {
    const base = {
      fee_verified_id: 1,
      fee_raw_id: 1,
      institution_id: 7,
      source_url: "https://cu.example/fees",
      document_r2_key: null,
      extraction_confidence: 0.9,
      canonical_fee_key: "card_foreign_txn",
      variant_type: null,
      outlier_flags: [],
      verified_by_agent_event_id: "e",
      fee_name: "Foreign Transaction Fee",
      frequency: null,
      raw_agent_event_id: null,
      source_document_id: 2,
      document_crawled_at: "2026-10-02",
    };
    const priorFlat = { fee_published_id: 9, amount: "1.00", fee_name: "Foreign Transaction Fee", published_at: "2026-10-01", source_url: "https://cu.example/fees", source_document_id: 1, document_crawled_at: "2026-10-01" };
    expect(decidePriorFee({ ...base, amount: null, amount_kind: "percent", rate_percent: 1 }, [priorFlat])).toEqual({ kind: "additional_line" });
    const priorRate = { ...priorFlat, amount: null, amount_kind: "percent", rate_percent: "1.0000" };
    expect(decidePriorFee({ ...base, amount: null, amount_kind: "percent", rate_percent: 1 }, [priorRate]).kind).toBe("identical");
    expect(decidePriorFee({ ...base, amount: null, amount_kind: "percent", rate_percent: 1.1 }, [priorRate]).kind).toBe("supersede");
  });

  it("summarizes rates on their own and never pools them with dollar rows", () => {
    const rates = [1, 1, 1.1, 3, 3, 2].map((rate, i) => ({ institution_id: i + 1, rate_percent: rate, amount_kind: "percent" }));
    const stats = summarizeRates(rates);
    expect(stats.institution_count).toBe(6);
    expect(stats.median_rate).toBe(1.55);
    expect(summarizeRates([{ institution_id: 1, rate_percent: 5, amount_kind: "flat" }]).institution_count).toBe(0);
  });
});

describe("rate display", () => {
  it("splits the rate from what it is a share of", () => {
    expect(rateDisplayParts({ amount_kind: "percent", rate_percent: 3, rate_basis: "advance", rate_min_amount: 10 })).toEqual({
      rate: "3%",
      detail: "of the advance ($10 minimum)",
    });
    expect(rateDisplayParts({ amount_kind: "percent", rate_percent: "1.1" })).toEqual({ rate: "1.1%", detail: null });
    expect(rateDisplayParts({ amount_kind: "flat", rate_percent: null })).toBeNull();
  });

  it("drops catalog rows with no usable rate and labels the rest", () => {
    const fees = toRateFees([
      { id: "7", institution_id: "42", fee_name: "Foreign Transaction Fee", fee_category: "card_foreign_txn", frequency: "per_item", conditions: null, source_url: null, amount_kind: "percent", rate_percent: "1.0000", rate_basis: "transaction" },
      { id: "8", institution_id: "42", fee_name: "Broken", fee_category: "cash_advance", frequency: null, conditions: null, source_url: null, amount_kind: "percent", rate_percent: null },
    ]);
    expect(fees).toHaveLength(1);
    expect(fees[0]).toMatchObject({ id: 7, institution_id: 42, rate_percent: 1, rate_label: "1% of the transaction" });
  });
});
