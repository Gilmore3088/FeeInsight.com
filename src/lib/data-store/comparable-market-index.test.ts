import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => {
  const sql = vi.fn() as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
  sql.unsafe = vi.fn();
  return { sql, getSql: () => sql };
});

import { comparableMarketRows, getComparableMarketIndex, type ComparableMarketRow } from "./fee-index";
import { sql } from "./connection";
import type { ExtractedFee } from "./types";
import { COMPARABILITY_SCREEN, SAFE_DEPOSIT_SERVICE_REASON, notComparableReason } from "@/lib/fee-comparability";
import { BUSINESS_URL_SCREEN, MARKET_AUDIENCES, countsInMarketComparison, marketIneligibleReason } from "@/lib/market-eligibility";
import { marketEligibilityOf, pickHeadlineValues } from "@/app/(public)/institution/[id]/profile-data";
import { SPECIAL_UNIT_FREQUENCIES } from "@/lib/fee-unit";

type Mock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
const db = sql as unknown as Mock;

/** A published catalog row as both sides see it: the subject's ExtractedFee and the market's raw columns. */
interface CatalogFee {
  id: number;
  institution_id: number;
  fee_category: string;
  fee_name: string;
  amount: number | null;
  fee_audience: "consumer" | "business" | "both" | "unknown" | null;
  source_document_id: number | null;
  source_url: string | null;
  account_product_type: string | null;
  /** The stored note the catalog keeps; the schedule line is its excerpt="..." tail. */
  extraction_note: string | null;
  frequency?: string | null;
}

const line = (note: string | null) => note?.match(/excerpt="(.*)"$/)?.[1] ?? null;

/** The subject side: the row as getFeesByInstitution returns it to the profile. */
function asSubject(fee: CatalogFee): ExtractedFee {
  return {
    id: fee.id,
    institution_id: fee.institution_id,
    institution_name: "Bank",
    fee_name: fee.fee_name,
    fee_category: fee.fee_category,
    amount: fee.amount,
    fee_audience: fee.fee_audience ?? undefined,
    source_document_id: fee.source_document_id,
    source_url: fee.source_url,
    account_product_type: fee.account_product_type,
    source_line: line(fee.extraction_note),
    frequency: fee.frequency ?? null,
    conditions: null,
    extraction_confidence: 1,
    review_status: "approved",
    validation_flags: null,
  };
}

/**
 * The market side: what getComparableMarketIndex's SQL returns for the row, emulated in
 * JavaScript (its WHERE clauses, then its CASE screens), or null when the WHERE drops it.
 */
function asMarketRead(fee: CatalogFee): ComparableMarketRow | null {
  const where =
    fee.amount !== null &&
    fee.amount >= 0 &&
    fee.source_document_id !== null &&
    MARKET_AUDIENCES.includes(fee.fee_audience ?? "unknown");
  if (!where) return null;
  const text = new RegExp(COMPARABILITY_SCREEN, "i").test(
    [fee.fee_name, fee.account_product_type, fee.extraction_note].filter((v) => v != null).join(" "),
  );
  return {
    fee_category: fee.fee_category,
    amount: fee.amount,
    institution_id: fee.institution_id,
    review_status: "approved",
    created_at: "2026-10-17T00:00:00Z",
    charter_type: "bank",
    fee_audience: fee.fee_audience,
    source_document_id: fee.source_document_id,
    source_url: fee.source_url && new RegExp(BUSINESS_URL_SCREEN, "i").test(fee.source_url) ? fee.source_url : null,
    fee_name: text ? fee.fee_name : null,
    account_product_type: text ? fee.account_product_type : null,
    source_line: text ? line(fee.extraction_note) : null,
    frequency: fee.frequency ?? null,
  };
}

let nextId = 1;
function catalogFee(overrides: Partial<CatalogFee>): CatalogFee {
  return {
    id: nextId++,
    institution_id: 1,
    fee_category: "overdraft",
    fee_name: "Overdraft Fee",
    amount: 30,
    fee_audience: "unknown",
    source_document_id: 10,
    source_url: "https://bank.example/personal-fee-schedule.pdf",
    account_product_type: null,
    extraction_note: null,
    ...overrides,
  };
}

/** Every eligibility rule, with a row it keeps and a row it drops. */
const CASES: Array<{ label: string; fee: CatalogFee; counts: boolean }> = [
  ...SPECIAL_UNIT_FREQUENCIES.map(frequency => ({
    label: `a literal ${frequency} research price`,
    fee: catalogFee({ fee_category: "account_research", fee_name: "Research Fee", frequency: `\u00a0${frequency.toUpperCase()}\v` }),
    counts: false,
  })),
  { label: "a plain personal fee", fee: catalogFee({}), counts: true },
  { label: "a consumer fee", fee: catalogFee({ fee_audience: "consumer" }), counts: true },
  { label: "a fee for both audiences", fee: catalogFee({ fee_audience: "both" }), counts: true },
  { label: "a blank audience (unstated)", fee: catalogFee({ fee_audience: null }), counts: true },
  { label: "a $0 fee", fee: catalogFee({ amount: 0 }), counts: true },
  { label: "a business fee", fee: catalogFee({ fee_audience: "business" }), counts: false },
  { label: "a fee from a business-only schedule", fee: catalogFee({ source_url: "https://bank.example/Business-Fee-Schedule.pdf" }), counts: false },
  { label: "a fee from an encoded business address", fee: catalogFee({ source_url: "https://bank.example/Commercial%20Fees.pdf" }), counts: false },
  { label: "a business schedule that also names personal accounts", fee: catalogFee({ source_url: "https://bank.example/personal-and-business-fees.pdf" }), counts: true },
  { label: "an unsourced fee", fee: catalogFee({ source_document_id: null }), counts: false },
  { label: "a fee with no amount", fee: catalogFee({ amount: null }), counts: false },
  { label: "a CD fee under early closure", fee: catalogFee({ fee_category: "early_closure", fee_name: "Early closure of CD (fee to close prior to maturity)", amount: 50 }), counts: false },
  { label: "an IRA fee under early closure", fee: catalogFee({ fee_category: "early_closure", fee_name: "Individual Retirement Account Closing Fee", amount: 50 }), counts: false },
  { label: "a CD fee named only by its account", fee: catalogFee({ fee_category: "early_closure", fee_name: "Early withdrawal", account_product_type: "12 Month CD" }), counts: false },
  { label: "a checking account's early closure", fee: catalogFee({ fee_category: "early_closure", fee_name: "Account Closed Within 180 Days of Opening Fee" }), counts: true },
  { label: "an IRA fee under its own category", fee: catalogFee({ fee_category: "ira_termination", fee_name: "IRA Closing Fee", amount: 25 }), counts: true },
  { label: "a card's inactivity fee by its schedule line", fee: catalogFee({ fee_category: "dormant_account", fee_name: "Inactivity Fee", amount: 5, extraction_note: 'page 2 excerpt="Inactivity Fee (After 12 months, the card will be charged $5.00 per month"' }), counts: false },
  { label: "a dormant account fee", fee: catalogFee({ fee_category: "dormant_account", fee_name: "Dormant Checking fee", amount: 3 }), counts: true },
  { label: "box drilling under safe deposit box", fee: catalogFee({ fee_category: "safe_deposit_box", fee_name: "Box Drilling Fee (both keys lost)", amount: 250 }), counts: false },
  { label: "a key deposit under safe deposit box", fee: catalogFee({ fee_category: "safe_deposit_box", fee_name: "Key Deposit Fee", amount: 25 }), counts: false },
  { label: "a lost key under safe deposit box", fee: catalogFee({ fee_category: "safe_deposit_box", fee_name: "Lost Key Replacement", amount: 35 }), counts: false },
  { label: "late rent under safe deposit box", fee: catalogFee({ fee_category: "safe_deposit_box", fee_name: "Safe Deposit Late Payment Fee", amount: 10 }), counts: false },
  { label: "a safe deposit box's rent", fee: catalogFee({ fee_category: "safe_deposit_box", fee_name: "Safe Deposit Box 3x5", amount: 40 }), counts: true },
  { label: "a quarterly dormant fee (#1901)", fee: catalogFee({ fee_category: "dormant_account", fee_name: "Dormant Checking fee", amount: 3, frequency: "quarterly" }), counts: false },
  { label: "a monthly dormant fee", fee: catalogFee({ fee_category: "dormant_account", fee_name: "Dormant Checking fee", amount: 5, frequency: "monthly" }), counts: true },
  { label: "a per-item dormant fee keeps its place", fee: catalogFee({ fee_category: "dormant_account", fee_name: "Dormant Account Fee", amount: 5, frequency: "per_item" }), counts: true },
  { label: "a monthly safe deposit rent", fee: catalogFee({ fee_category: "safe_deposit_box", fee_name: "Safe Deposit Box 3x5", amount: 4, frequency: "monthly" }), counts: false },
  { label: "an annual safe deposit rent", fee: catalogFee({ fee_category: "safe_deposit_box", fee_name: "Safe Deposit Box 3x5", amount: 40, frequency: "annual" }), counts: true },
  { label: "a quarterly paper statement fee (#1901)", fee: catalogFee({ fee_category: "paper_statement", fee_name: "Paper Statement", amount: 6, frequency: "quarterly" }), counts: false },
  { label: "a monthly price in a per-event category (#1901)", fee: catalogFee({ fee_category: "document_reproduction", fee_name: "Statement Copies", amount: 5, frequency: "monthly" }), counts: false },
  { label: "a per-item returned mail fee beside the monthly median (#1901)", fee: catalogFee({ fee_category: "returned_mail", fee_name: "Returned Mail", amount: 5, frequency: "per_item" }), counts: false },
  { label: "a monthly returned mail fee", fee: catalogFee({ fee_category: "returned_mail", fee_name: "Bad Address Fee", amount: 5, frequency: "monthly" }), counts: true },
  { label: "a night depository key, under night deposit", fee: catalogFee({ fee_category: "night_deposit", fee_name: "Night Depository Key, per additional key", amount: 15 }), counts: true },
];

describe("market eligibility: the institution and its medians use the same rules", () => {
  it.each(CASES)("$label: counts on the profile exactly when it counts in a median", ({ fee, counts }) => {
    const subject = countsInMarketComparison(marketEligibilityOf(asSubject(fee)));
    const read = asMarketRead(fee);
    const market = read !== null && comparableMarketRows([read]).length === 1;
    expect(subject).toBe(counts);
    expect(market).toBe(subject);
  });

  it("the market read's text screens never hide a row the rule would flag", () => {
    // Fetching the name, account and line only for screened rows is safe only if every row the
    // rule flags passes the screen: a flagged row with its text nulled would slip into the median.
    for (const { fee } of CASES) {
      const read = asMarketRead(fee);
      if (!read) continue;
      if (notComparableReason(fee.fee_category, fee.fee_name, fee.account_product_type, line(fee.extraction_note))) {
        expect(read.fee_name, fee.fee_name).toBe(fee.fee_name);
      }
      if (marketIneligibleReason(marketEligibilityOf(asSubject(fee))) === "business_schedule") {
        expect(read.source_url, fee.source_url ?? "").toBe(fee.source_url);
      }
    }
  });

  it("the profile's compared value and the median leave out the same safe deposit rows", () => {
    const own = [
      catalogFee({ institution_id: 323, fee_category: "safe_deposit_box", fee_name: "Box Drilling Fee (both keys lost)", amount: 250 }),
      catalogFee({ institution_id: 323, fee_category: "safe_deposit_box", fee_name: "Key Deposit Fee", amount: 25 }),
    ];
    // Drilling and a key deposit alone leave no rent to compare: the page shows no comparison row.
    const values = pickHeadlineValues(own.map(asSubject), ["safe_deposit_box"]);
    expect(values).toEqual([]);
    const withRent = pickHeadlineValues(
      [...own, catalogFee({ institution_id: 323, fee_category: "safe_deposit_box", fee_name: "Safe Deposit Box 3x5", amount: 40 })].map(asSubject),
      ["safe_deposit_box"],
    );
    expect(withRent[0]).toMatchObject({ amount: 40, count: 1, excludedSafeDeposit: 2 });
    expect(notComparableReason("safe_deposit_box", "Key Deposit Fee", null)).toBe(SAFE_DEPOSIT_SERVICE_REASON);
  });
});

describe("getComparableMarketIndex", () => {
  beforeEach(() => db.unsafe.mockReset());

  it("reads only approved, sourced, priced, personal rows, scoped to the market", async () => {
    db.unsafe.mockResolvedValue([]);
    await getComparableMarketIndex({ kind: "state", code: "FL" });
    const [text, params] = db.unsafe.mock.calls[0];
    expect(text).toContain("FROM published_fee_catalog");
    expect(text).toContain("ct.state_code = $1");
    expect(text).toContain("ef.review_status = 'approved'");
    expect(text).toContain("ef.source_document_id IS NOT NULL");
    expect(text).toContain("COALESCE(ef.fee_audience, 'unknown') IN ('consumer','both','unknown')");
    expect(text).toContain(`~* '${COMPARABILITY_SCREEN}'`);
    expect(text).toContain(`~* '${BUSINESS_URL_SCREEN}'`);
    expect(params).toEqual(["FL"]);

    await getComparableMarketIndex({ kind: "district", district: 6 });
    expect(db.unsafe.mock.calls[1][0]).toContain("ct.fed_district = $1");
    expect(db.unsafe.mock.calls[1][1]).toEqual([6]);
    await getComparableMarketIndex({ kind: "us" });
    expect(db.unsafe.mock.calls[2][0]).toContain("ef.fee_category = ANY(ARRAY[");
    expect(db.unsafe.mock.calls[2][1]).toEqual([]);
  });

  it("builds the median from the rows the profile would compare: a CD fee or box drilling never moves it", async () => {
    const rows = [
      ...[1, 2, 3, 4, 5].map((id) => catalogFee({ institution_id: id, fee_category: "safe_deposit_box", fee_name: "Safe Deposit Box 3x5", amount: 40 })),
      ...[1, 2, 3].map((id) => catalogFee({ institution_id: id, fee_category: "safe_deposit_box", fee_name: "Box Drilling Fee", amount: 250 })),
      ...[6, 7, 8].map((id) => catalogFee({ institution_id: id, fee_category: "safe_deposit_box", fee_name: "Drilling of Box", amount: 200 })),
      ...[1, 2, 3, 4, 5].map((id) => catalogFee({ institution_id: id, fee_category: "early_closure", fee_name: "Account closed within 90 days", amount: 25 })),
      ...[6, 7, 8, 9].map((id) => catalogFee({ institution_id: id, fee_category: "early_closure", fee_name: "CD early withdrawal", amount: 150 })),
    ]
      .map(asMarketRead)
      .filter((row): row is ComparableMarketRow => row !== null);
    db.unsafe.mockResolvedValue(rows);
    const index = await getComparableMarketIndex({ kind: "us" });
    const box = index.find((e) => e.fee_category === "safe_deposit_box");
    expect(box).toMatchObject({ median_amount: 40, institution_count: 5 });
    const closure = index.find((e) => e.fee_category === "early_closure");
    expect(closure).toMatchObject({ median_amount: 25, institution_count: 5 });
  });
});
