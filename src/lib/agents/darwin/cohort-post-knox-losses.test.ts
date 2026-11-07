import { describe, expect, it } from "vitest";
import { CATEGORY_GUARD_VERSION, checkFeeCategory } from "@/lib/fee-category-guard";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { DUPLICATE_TWIN_GONE_REREAD_LIVE, DUPLICATE_TWIN_STANDS_SQL, darwinStandingDecisionSql } from "./verify";

/**
 * #1026 (Nov 7): right fees Knox read that Darwin dropped
 * (findings/2026-11-07-cohort-post-knox-losses.md). Lines are the banks' own stored text.
 */
const guard = (key: string, name: string, line: string) => checkFeeCategory(key, name, { conditions: `excerpt="${line}"` } as never);

describe("category guard v111: a word read out of its place", () => {
  it("should_keep_an_nsf_fee_whose_tier_is_all_others", () => {
    expect(CATEGORY_GUARD_VERSION).toBeGreaterThanOrEqual(111);
    const text = "Insufficient Funds (NSF)- Flexible Checking | $37 per presentment\n\nInsufficient Funds (NSF)- Business Accounts | $40 per presentment\n\nInsufficient Funds (NSF)- All Others | $35 per presentment";
    const name = "Insufficient Funds (NSF)- All Others";
    expect(guard("nsf", name, "Insufficient Funds (NSF)- All Others | $35 per presentment").ok).toBe(true);
    expect(checkFeeAgainstSource(text, name, 35, ".", "nsf").ok).toBe(true);
  });

  it("should_keep_an_nsf_fee_charged_each_time_an_item_is_presented_or_represented", () => {
    for (const name of [
      "Returned Item Fee (Each Time Item is Presented or Represented). A Returned Item",
      "Return Item Fee (per debit or check presented or re-presented)",
      "Return Item (non-sufficient funds) Fee (per item, each time an item is presented or re-presented for payment)",
      "NSF Fee (presented/re-presented)",
    ]) {
      expect(guard("nsf", name, `${name} | $30.00`).ok, name).toBe(true);
    }
  });

  it("should_keep_a_check_debit_card_replacement", () => {
    for (const name of ["Replacement Check (Debit) Card", "Check (Debit) Card Replacement (Lost)", "Check (ATM) Card Replacement"]) {
      expect(guard("card_replacement", name, `${name} | $10.00`).ok, name).toBe(true);
    }
  });

  it("should_still_refuse_what_the_exclusions_were_for", () => {
    // A re-presentment fee, a fee on others' items and a sentence are not the member's NSF price.
    expect(guard("nsf", "Re-presentment Fee", "Re-presentment Fee | $10.00").ok).toBe(false);
    expect(guard("nsf", "NSF Checks Drawn on Others", "NSF Checks Drawn on Others | $10.00").ok).toBe(false);
    expect(guard("nsf", "Items of others returned", "Items of others returned | $10.00").ok).toBe(false);
    // "all others" is a tier label only after a dash, colon or bar, not in a sentence about others' items.
    expect(guard("nsf", "NSF checks drawn on all others", "NSF checks drawn on all others | $10.00").ok).toBe(false);
    expect(guard("nsf", "Returned checks written by all others", "Returned checks written by all others | $10.00").ok).toBe(false);
    expect(guard(
      "nsf",
      "If multiple items overdraw your account on the same day, each item presented or represented will be assessed an appropri",
      "If multiple items overdraw your account on the same day, each item presented or represented will be assessed an appropriate Paid NSF Fee or NSF Fee of $35",
    ).ok).toBe(false);
    // Checks are not a card.
    expect(guard("card_replacement", "Replacement Checks", "Replacement Checks | $10.00").ok).toBe(false);
    expect(guard("card_replacement", "Replacement Check (Cashier's)", "Replacement Check (Cashier's) | $10.00").ok).toBe(false);
    // A rushed check card stays the rush card fee (7142's live $15 row).
    expect(guard("card_replacement", "Check (Debit) Card Replacement Express/Priority Shipping", "Check (Debit) Card Replacement Express/Priority Shipping | $15.00").ok).toBe(false);
  });
});

describe("Darwin: a duplicate whose twin no longer stands", () => {
  it("should_reread_a_duplicate_with_no_standing_twin_only_with_the_switch_on", () => {
    expect(DUPLICATE_TWIN_GONE_REREAD_LIVE).toBe(false);
    const off = darwinStandingDecisionSql(true, undefined, undefined, false);
    const on = darwinStandingDecisionSql(true, undefined, undefined, true);
    expect(off).not.toContain(DUPLICATE_TWIN_STANDS_SQL);
    expect(on).toContain(DUPLICATE_TWIN_STANDS_SQL);
    expect(on).toContain("twin.institution_id = fr.institution_id");
    // Once only: a hold decided under this rule is never re-read for a gone twin, so it cannot loop.
    expect(on).toContain("pa.detail->>'twin_gone_rule' IS NULL");
    expect(darwinStandingDecisionSql(true)).toBe(off);
    // Without the current-copy column there is no duplicate re-read at all.
    expect(darwinStandingDecisionSql(false, undefined, undefined, true)).not.toContain(DUPLICATE_TWIN_STANDS_SQL);
  });
});
