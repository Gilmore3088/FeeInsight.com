import { describe, test, expect } from "vitest";
import {
  FEE_FAMILIES,
  CANONICAL_KEY_MAP,
  CANONICAL_KEY_COUNT,
  TAXONOMY_COUNT,
  DISPLAY_NAMES,
  PUBLIC_FEE_TYPE_LIMIT,
  onlyPublicFeeTypes,
  publicFeeTypes,
} from "./fee-taxonomy";
import { RESEARCH_SPLIT_KEYS, RESEARCH_SPLIT_LIVE } from "./fee-fold";
import { inferFeeCategory } from "./hamilton/infer-category";

// Tripwire for Python↔TS drift. If you change these numbers, update the
// Guards the canonical taxonomy keys used by public pages and agentic admin flows.
// 52 once excess withdrawals and returned mail leave account research (#1398, `RESEARCH_SPLIT_LIVE`),
// plus International ATM split back out (James, Oct 19, #2037).
const EXPECTED_TAXONOMY_COUNT = RESEARCH_SPLIT_LIVE ? 53 : 51;
// 200 once the research split adds the `excess_withdrawal` identity key; main's 199 while it is off.
const EXPECTED_CANONICAL_KEY_COUNT = RESEARCH_SPLIT_LIVE ? 200 : 199;

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
    for (const slug of ["excessive_withdrawal_fee", "excessive_transaction_fee"]) {
      expect(CANONICAL_KEY_MAP[slug]).toBe(excess);
    }
    // Off, there is no `excess_withdrawal` key at all, so a model output of it is rejected as on main.
    expect(CANONICAL_KEY_MAP.excess_withdrawal).toBe(RESEARCH_SPLIT_LIVE ? "excess_withdrawal" : undefined);
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

// Review B2: Darwin's paid release review lists the first 12 aliases per category
// (`ALIASES_BY_KEY` in darwin/release-review.ts), so while the switch is off the order must be main's.
describe("account research aliases while the research split is off", () => {
  test("match main's first 12, in order", () => {
    const list: string[] = [];
    for (const [alias, key] of Object.entries(CANONICAL_KEY_MAP)) {
      if (alias === key || key !== "account_research") continue;
      if (list.length < 12) list.push(alias.replace(/_/g, " "));
    }
    if (RESEARCH_SPLIT_LIVE) return;
    expect(list).toEqual([
      "excessive withdrawal fee", "transaction fee", "transactions fee", "per transaction fee",
      "returned mail", "returned mail fee", "return mail", "bad address",
      "bad address fee", "incorrect address", "incorrect address fee", "invalid address fee",
    ]);
  });
});

// James, Oct 17 2026: the taxonomy may hold 52 types; the public site publishes only the top 50.
describe("public fee types (top 50 by institution count)", () => {
  const ALL = Object.values(FEE_FAMILIES).flat();

  test("never lists more than 50, and lists every type while the taxonomy holds 50 or fewer", () => {
    expect(PUBLIC_FEE_TYPE_LIMIT).toBe(50);
    const types = publicFeeTypes([]);
    expect(types.size).toBe(Math.min(50, TAXONOMY_COUNT));
    // With no counts (a failed read) the two types added after the top 50 are the ones left out.
    for (const key of RESEARCH_SPLIT_KEYS) expect(types.has(key)).toBe(!RESEARCH_SPLIT_LIVE);
    expect(types.has("atm_international")).toBe(false);
  });

  test("ranks by institution count, so a new type with more institutions is listed and the two smallest are not", () => {
    const counts = ALL.map((key, index) => ({ fee_category: key, institution_count: 1000 - index }));
    const smallest = ["night_deposit", "coin_counting"].filter((key) => ALL.includes(key));
    for (const row of counts) {
      if (RESEARCH_SPLIT_KEYS.has(row.fee_category)) row.institution_count = 5000;
      if (smallest.includes(row.fee_category)) row.institution_count = 1;
    }
    const types = publicFeeTypes(counts);
    expect(types.size).toBe(Math.min(50, ALL.length));
    if (RESEARCH_SPLIT_LIVE) {
      for (const key of RESEARCH_SPLIT_KEYS) expect(types.has(key)).toBe(true);
      for (const key of smallest) expect(types.has(key)).toBe(false);
    }
  });

  test("drops only the taxonomy rows outside the top 50 and keeps rows outside the taxonomy", () => {
    const rows = [...ALL.map((key) => ({ fee_category: key, institution_count: 100 })), { fee_category: "not_a_type", institution_count: 1 }];
    const kept = onlyPublicFeeTypes(rows);
    expect(kept.filter((row) => ALL.includes(row.fee_category))).toHaveLength(Math.min(50, ALL.length));
    expect(kept.some((row) => row.fee_category === "not_a_type")).toBe(true);
  });
});
