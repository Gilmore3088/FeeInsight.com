// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  ACCOUNT_OWNER_REFILE_LIVE,
  accountOwnerFeedbackRow,
  accountOwnerVerdict,
  findAccountOwners,
  renamedForAccount,
  type AccountOwnerRow,
} from "./account-owner-check";

const gofm = readFileSync(new URL("../knox/__fixtures__/gofm-personal-checking-608.txt", import.meta.url), "utf8");
const river = readFileSync(new URL("../knox/__fixtures__/river-bank-checking-1027.txt", import.meta.url), "utf8");

/** Live 57400 as stored on prod (raw 209089, doc 34081, Knox v21 read). */
const live57400: AccountOwnerRow = {
  fee_published_id: 57400,
  fee_raw_id: 209089,
  institution_id: 608,
  institution_name: "Farmers & Merchants Bank",
  source_document_id: 34081,
  fee_name: "Gold Checking Monthly service fee",
  raw_fee_name: "monthly service fee, may be avoided if meet certain criteria. Full waiver of fee if maintain daily balance of +",
  amount: "8.00",
  canonical_fee_key: "monthly_maintenance",
  product_name: "Gold Checking",
  conditions: 'Knox deterministic extraction from Rosetta artifact #12870. canonical_hint=monthly_maintenance; text_hash=613f7e8a1eb6a4ff274c52abce933c989ce33bfd998a61e64af35c87b9ab12b9; excerpt="$8.00 monthly service fee, may be avoided if meet certain criteria.* Full waiver of fee if maintain daily balance of $20,000+"',
};

/** Live 108790 as stored on prod (raw 720313, doc 34897). */
const live108790: AccountOwnerRow = {
  fee_published_id: 108790,
  fee_raw_id: 720313,
  institution_id: 1027,
  institution_name: "River Bank",
  source_document_id: 34897,
  fee_name: "monthly maintenance fee - Fee waived with minimum daily balance",
  raw_fee_name: "monthly maintenance fee - Fee waived with minimum daily balance",
  amount: "7.00",
  canonical_fee_key: "monthly_maintenance",
  product_name: "Easy Checking",
  conditions: 'Knox deterministic extraction from Rosetta artifact #32996. canonical_hint=monthly_maintenance; excerpt="$7.00 monthly maintenance fee - Fee waived with $100.00 minimum daily balance"',
};

describe("Darwin account-owner re-check (inst 608)", () => {
  it("is off by default", () => {
    expect(ACCOUNT_OWNER_REFILE_LIVE).toBe(false);
  });

  it("re-files live 57400 from Gold Checking to 360 Checking and renames it", () => {
    const verdict = accountOwnerVerdict(live57400, gofm);
    expect(verdict).toMatchObject({ outcome: "refile", from: "Gold Checking", to: "360 Checking", newFeeName: "360 Checking Monthly service fee" });
    const feedback = accountOwnerFeedbackRow(verdict, 1);
    expect(feedback.evidence).toMatchObject({ from: "Gold Checking", to: "360 Checking", fee_name: { from: "Gold Checking Monthly service fee", to: "360 Checking Monthly service fee" } });
  });

  it("re-files live 108790 from Easy Checking to 50+ Checking and keeps a name that names no account", () => {
    expect(accountOwnerVerdict(live108790, river)).toMatchObject({ outcome: "refile", from: "Easy Checking", to: "50+ Checking", newFeeName: null });
  });

  it("keeps Gold Checking's own $3 fee", () => {
    const gold: AccountOwnerRow = {
      ...live57400, fee_published_id: 145670, fee_raw_id: 704306, fee_name: "Monthly maintenance fee",
      raw_fee_name: "monthly maintenance fee (may be avoided if maintain daily balance of +)", amount: "3.00",
      conditions: 'excerpt="$3 monthly maintenance fee (may be avoided if maintain daily balance of $5,000+)"',
    };
    expect(accountOwnerVerdict(gold, gofm).outcome).toBe("same");
  });

  it("leaves a change no numbered heading proves to its own check", () => {
    const text = ["Classic Checking", "$4.00 monthly fee", "Premier Checking", "Minimum Opening Deposit", "$9.00 monthly service fee"].join("\n\n");
    const row = { ...live57400, product_name: "Classic Checking", fee_name: "Classic Checking Monthly service fee", raw_fee_name: "monthly service fee", amount: "9.00", conditions: 'excerpt="$9.00 monthly service fee"' };
    expect(accountOwnerVerdict(row, text)).toMatchObject({ outcome: "other_reason", to: "Premier Checking" });
  });

  it("reports a fee with no stored line or no text and counts outcomes", () => {
    const found = findAccountOwners(
      [live57400, { ...live57400, fee_published_id: 1, conditions: null }, { ...live108790, source_document_id: 99 }],
      new Map([[34081, gofm]]),
    );
    expect(found.outcomes).toEqual({ refile: 1, no_excerpt: 1, no_text: 1 });
  });

  it("renames only a name that opens on the old account", () => {
    expect(renamedForAccount("Gold Checking Monthly service fee", "Gold Checking", "360 Checking")).toBe("360 Checking Monthly service fee");
    expect(renamedForAccount("Gold Checkings fee", "Gold Checking", "360 Checking")).toBeNull();
    expect(renamedForAccount("Monthly service fee", "Gold Checking", "360 Checking")).toBeNull();
  });
});
