import type { DailyCapRow } from "./types";

/** Fixtures for the daily cap counters (`daily-cap.test.ts`, `cap-lines.test.ts`). */

/** A raw cap read with nothing downstream; each test adds the tier it needs. */
export function capRow(overrides: Partial<DailyCapRow>): DailyCapRow {
  return {
    fee_raw_id: 1,
    institution_id: 10,
    institution_name: "Bank A",
    source_document_id: 100,
    source_url: null,
    document_url: null,
    document_crawled_at: null,
    document_stream: null,
    raw_name: "Paid Overdraft Charge daily maximum",
    raw_amount: 150,
    product_name: null,
    outlier_flags: ["canonical_hint:od_daily_cap"],
    conditions: null,
    fee_verified_id: null,
    review_status: null,
    verified_key: null,
    verified_name: null,
    verified_amount: null,
    fee_published_id: null,
    published_key: null,
    published_name: null,
    published_amount: null,
    removed: null,
    rolled_back_reason: null,
    verify_decision: null,
    verify_reason: null,
    verify_key: null,
    ...overrides,
  };
}

// Texts from `custom-report/daily-cap-lines.test.ts`: the first two are real caps the switch gains
// (off: not-ok, on: ok); the third traces both ways; the fourth traces neither way.
export const GAINED_150 = "Paid Overdraft Charge: $30.00/item ($150.00 max daily)";
export const GAINED_100 = "Total overdraft charges/fees will not exceed $100.00 per day";
export const BOTH_175 = "Overdraft Daily Cap | $175";
export const NEITHER_36 = "Overdraft Fee | $36.00 per item";
