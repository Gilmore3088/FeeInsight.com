import { describe, test, expect } from "vitest";
import {
  FEE_FAMILIES,
  CANONICAL_KEY_MAP,
  CANONICAL_KEY_COUNT,
  TAXONOMY_COUNT,
  DISPLAY_NAMES,
} from "./fee-taxonomy";
import { RESEARCH_SPLIT_KEYS, RESEARCH_SPLIT_LIVE } from "./fee-fold";
import { inferFeeCategory } from "./hamilton/infer-category";

// Tripwire for Python↔TS drift. If you change these numbers, update the
// Guards the canonical taxonomy keys used by public pages and agentic admin flows.
// 52 once excess withdrawals and returned mail leave account research (#1398, `RESEARCH_SPLIT_LIVE`).
const EXPECTED_TAXONOMY_COUNT = RESEARCH_SPLIT_LIVE ? 52 : 50;
const EXPECTED_CANONICAL_KEY_COUNT = 200;

describe("fee-taxonomy sync", () => {
  test("every FEE_FAMILIES category is in CANONICAL_KEY_MAP", () => {
    const allCategories = Object.values(FEE_FAMILIES).flat();
    const missing: string[] = [];
    for (const cat of allCategories) {
      if (!(cat in CANONICAL_KEY_MAP)) {
        missing.push(cat);
      }
    }
    expect(missing).toEqual([]);
  });

  test("TAXONOMY_COUNT matches the expected base-category count (Python↔TS parity)", () => {
    expect(TAXONOMY_COUNT).toBe(EXPECTED_TAXONOMY_COUNT);
  });

  test("CANONICAL_KEY_COUNT matches the Python CANONICAL_KEY_MAP count (Python↔TS parity)", () => {
    expect(CANONICAL_KEY_COUNT).toBe(EXPECTED_CANONICAL_KEY_COUNT);
  });

  test("CANONICAL_KEY_MAP has at least 49 entries (base categories)", () => {
    expect(Object.keys(CANONICAL_KEY_MAP).length).toBeGreaterThanOrEqual(49);
  });

  test("base fee categories map to themselves (identity mapping)", () => {
    const allCategories = Object.values(FEE_FAMILIES).flat();
    const nonIdentity: string[] = [];
    for (const cat of allCategories) {
      if (CANONICAL_KEY_MAP[cat] !== cat) {
        nonIdentity.push(cat);
      }
    }
    expect(nonIdentity).toEqual([]);
  });

  test("CANONICAL_KEY_MAP values are non-empty strings", () => {
    for (const [key, value] of Object.entries(CANONICAL_KEY_MAP)) {
      expect(typeof value).toBe("string");
      expect(value.length).toBeGreaterThan(0);
    }
  });

  test("excess withdrawal and returned mail slugs file under their own types once the research split is on (#1398)", () => {
    const excess = RESEARCH_SPLIT_LIVE ? "excess_withdrawal" : "account_research";
    const returned = RESEARCH_SPLIT_LIVE ? "returned_mail" : "account_research";
    for (const slug of ["excess_withdrawal", "excessive_withdrawal_fee", "excessive_transaction_fee"]) {
      expect(CANONICAL_KEY_MAP[slug]).toBe(excess);
    }
    for (const slug of ["returned_mail", "return_mail", "bad_address", "incorrect_address_fee", "undeliverable_mail"]) {
      expect(CANONICAL_KEY_MAP[slug]).toBe(returned);
    }
    expect(CANONICAL_KEY_MAP.returned_statement).toBe(RESEARCH_SPLIT_LIVE ? "returned_mail" : "paper_statement");
    // Generic slugs name no excess activity: they stay account research either way.
    for (const slug of ["transaction_fee", "transactions_fee", "per_transaction_fee", "withdrawal_fee", "account_balancing_assistance", "inquiries_fee"]) {
      expect(CANONICAL_KEY_MAP[slug]).toBe("account_research");
    }
  });
});

// Review O3 (#1398): DISPLAY_NAMES is the public category list (the search modal, the /fees/[category]
// pages, category inference, guides), so it names the two research split types only once the switch is on.
describe("public category list while the research split is off", () => {
  test("lists excess withdrawals and returned mail only once the switch is on", () => {
    for (const key of RESEARCH_SPLIT_KEYS) {
      expect([key, key in DISPLAY_NAMES]).toEqual([key, RESEARCH_SPLIT_LIVE]);
    }
  });

  test("category inference never names a type no fee is filed under", () => {
    const want = (key: string) => (RESEARCH_SPLIT_LIVE ? key : null);
    expect(inferFeeCategory("What do banks charge for excess withdrawals?")).toBe(want("excess_withdrawal"));
    expect(inferFeeCategory("Returned mail fees near me")).toBe(want("returned_mail"));
  });
});
