import { describe, expect, it } from "vitest";
import { bulletCellStart, withBulletCellRows } from "./bullet-cell-rows";
import { KNOX_RULES_STRATEGY, runFreeSpecialists } from "./specialists";
import { NAME_RETIDY_STRATEGY, bulletItemName, planRetidy, type RetidyFeeRow } from "./name-retidy";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { publishNameHold } from "@/lib/agents/hamilton/publish";

const reads = (text: string) => runFreeSpecialists(text).candidates.map((fee) => [fee.feeName, fee.amount, fee.canonicalHint] as const);

// Steel Valley FCU's Truth-in-Savings disclosure (institution 6230, document 16793), rows as Knox read
// them on Oct 6 (text_hash d2fbaf77...; Rosetta artifact 12240 has since been re-read with another
// layout). The left column is the account disclosures, the right the fee schedule, one bullet a fee.
const STEEL_VALLEY_OCT6 = [
  "TRUTH-IN-SAVINGS DISCLOSURE",
  "FEE SCHEDULE",
  "Other Service Fees",
  "Rate Schedule, dividends are calculated by applying a | • Items Sent For Collection ................ $35.00/Item",
  "Percentage Yield for that balance range will apply to the full | more than six (6) pre-authorized, automatic, or telephone | • Legal Process Fee ...........................$35.00/Item",
  "Rate Schedule. The Dividend Period is the period of time at | October 15th and the account will remain open. If you | • Photocopy Fee ................................$5.00/Copy",
  "• Postdated Item Request ..................$35.00/Request",
].join("\n");

// The same document as stored now (artifact 12240, text_hash 987ed4d8...), the fee schedule's part.
const STEEL_VALLEY_NOW = [
  "dividend period, there will be a service fee as stated in the | Checking Account Fees",
  "Rate Schedule. For Shares, Holiday Club, Vacation Club, | • Overdraft Fee .................................. $5.00/Item",
  "Other Clubs and Share Draft accounts, there is a minimum | • NSF Fee.......................................... $30.00/Item",
  "Average Daily Balance required to earn the Annual | • Returned Item Fee .......................... $30.00/Item",
  "balance is not met each day of the dividend period, you will | Other Service Fees",
  "Rate Schedule, dividends are calculated by applying a | • Items Sent For Collection ................ $35.00/Item",
  "• Statement Copy Fee ........................$2.00/Copy",
  "• Legal Process Fee ...........................$35.00/Item",
  "• Photocopy Fee ................................$5.00/Copy",
].join("\n");

describe("a bullet item in a later cell is its own row (Knox v164)", () => {
  it("is Knox v164", () => {
    expect(KNOX_RULES_STRATEGY.version).toBe(164);
  });

  it("reads Steel Valley's fees under their own names, never the other column's prose", () => {
    const found = reads(STEEL_VALLEY_OCT6);
    expect(found).toContainEqual(["Photocopy Fee", 5, "document_reproduction"]);
    expect(found).toContainEqual(["Legal Process Fee", 35, "legal_process"]);
    expect(found).toContainEqual(["Items Sent For Collection", 35, "collection_item"]);
    for (const [name] of found) expect(name).not.toMatch(/Dividend|Rate Schedule|Percentage Yield|\|/);
    const now = reads(STEEL_VALLEY_NOW);
    expect(now).toContainEqual(["Overdraft Fee", 5, "overdraft"]);
    expect(now).toContainEqual(["NSF Fee", 30, "nsf"]);
    expect(now).toContainEqual(["Returned Item Fee", 30, "nsf"]);
    for (const [name] of now) expect(name).not.toMatch(/Rate Schedule|Share Draft accounts|Annual:/);
  });

  it("names trace on the stored text with the shared check and publish holds none of them", () => {
    for (const [name, amount, key] of reads(STEEL_VALLEY_OCT6)) {
      expect(checkFeeAgainstSource(STEEL_VALLEY_OCT6, name, amount, ".", key)).toMatchObject({ ok: true });
      expect(publishNameHold(name, key, amount)).toBeNull();
    }
  });

  it("drops the other column's heading or feature bullet in front of an item", () => {
    expect(reads("FEES\nAbandoned Property | • Teller Check | $2.00")).toContainEqual(["Teller Check", 2, "cashiers_check"]);
    expect(reads("FEES\n• Unlimited check writing | • Stop Payments - $30.00 per item")).toContainEqual(["Stop Payments", 30, "stop_payment"]);
    expect(reads("FEES\nSize: | Fee | ● ATM Withdrawal Fee | $1.00 per item if out‐of‐network ATM")).toContainEqual(["ATM Withdrawal Fee", 1, "atm_non_network"]);
  });

  it("never reads the other column's text as the item's heading", () => {
    // "Stop Payment" is the left column's; the $14.95 is the overnight check's.
    expect(reads("FEES\nStop Payment | • Overnight Check | $14.95").filter(([, , key]) => key === "stop_payment")).toEqual([]);
    expect(withBulletCellRows("Stop Payment | • Overnight Check | $14.95")).toBe("• Overnight Check | $14.95\nStop Payment");
  });

  it("keeps a line whole when the bullet is first, bare, after a price, or an account's own fee", () => {
    expect(bulletCellStart("• Cashier’s Check: Non-Member | $10.00 | • Overdraft Protection Transfer Fee | $5.00/Item")).toBe(-1);
    expect(bulletCellStart("Dividend Checking Account Fees | • | Monthly Service Fee ........ $15")).toBe(-1);
    expect(bulletCellStart("• Withdrawals at Telco ATM | Free | • Temporary Checks")).toBe(-1);
    expect(bulletCellStart("Four Star Banking with Interest | • Monthly maintenance fee is $10")).toBe(-1);
    expect(bulletCellStart("Stop Payment | $30.00 | • per item")).toBe(-1);
    expect(withBulletCellRows("Overdraft Fee | $30.00\nNo bullets here")).toBe("Overdraft Fee | $30.00\nNo bullets here");
    expect(reads("FEES\nFour Star Banking with Interest | • Monthly maintenance fee is $10").map(([name]) => name).join(" ")).toMatch(/Four Star/);
  });
});

describe("name retidy v28: a live bullet item's name with another column's cells glued in front", () => {
  const fee = (id: number, name: string, amount: number, key: string, institution = 6230): RetidyFeeRow => ({
    fee_published_id: id, lineage_ref: id, fee_raw_id: id, institution_id: institution, source: "knox", source_document_id: 16793,
    canonical_fee_key: key, fee_name: name, amount, amount_kind: "flat", rate_percent: null,
  } as unknown as RetidyFeeRow);

  it("is retidy v28", () => {
    expect(NAME_RETIDY_STRATEGY.version).toBe(28);
  });

  it("gives Steel Valley's live fees the names Knox reads today on their own page", () => {
    const ownTexts = [STEEL_VALLEY_NOW];
    expect(bulletItemName(fee(54298, "Rate Schedule. The Dividend Period is the period of time at | October 15th and the account will remain open. If you | Ph", 5, "document_reproduction"), ownTexts)).toBe("Photocopy Fee");
    expect(bulletItemName(fee(54295, "Percentage Yield for that balance range will apply to the full | more than six (6) pre-authorized, automatic, or telepho", 35, "legal_process"), ownTexts)).toBe("Legal Process Fee");
    expect(bulletItemName(fee(93059, "Rate Schedule, dividends are calculated by applying a: Items Sent For Collection", 35, "collection_item"), ownTexts)).toBe("Items Sent For Collection");
  });

  it("plans the three renames through the retidy's own checks", () => {
    const fees = [
      fee(54298, "Rate Schedule. The Dividend Period is the period of time at | October 15th and the account will remain open. If you | Ph", 5, "document_reproduction"),
      fee(54295, "Percentage Yield for that balance range will apply to the full | more than six (6) pre-authorized, automatic, or telepho", 35, "legal_process"),
      fee(93059, "Rate Schedule, dividends are calculated by applying a: Items Sent For Collection", 35, "collection_item"),
    ];
    const plan = planRetidy(fees, [{ source_document_id: 16793, normalized_text: STEEL_VALLEY_NOW } as never]);
    expect(plan.renames.map((rename) => [rename.feePublishedId, rename.newName]).sort()).toEqual([
      [54295, "Legal Process Fee"],
      [54298, "Photocopy Fee"],
      [93059, "Items Sent For Collection"],
    ]);
  });

  it("renames nothing it cannot prove", () => {
    const text = ["FEES", "Abandoned Property | • Teller Check | $2.00"].join("\n");
    expect(bulletItemName(fee(1, "Abandoned Property: Teller Check", 2, "cashiers_check"), [text])).toBe("Teller Check");
    // No bullet item on the page.
    expect(bulletItemName(fee(2, "Abandoned Property: Teller Check", 2, "cashiers_check"), ["FEES\nTeller Check | $2.00"])).toBeNull();
    // An audience word is part of the fee.
    expect(bulletItemName(fee(3, "Business Accounts: Teller Check", 2, "cashiers_check"), [text])).toBeNull();
    // Another price: Knox reads no teller check at $3.
    expect(bulletItemName(fee(4, "Abandoned Property: Teller Check", 3, "cashiers_check"), [text])).toBeNull();
    // An account's own fee keeps its account.
    expect(bulletItemName(fee(5, "Four Star Banking with Interest: Monthly maintenance fee", 10, "monthly_maintenance"), ["FEES\nFour Star Banking with Interest | • Monthly maintenance fee is $10"])).toBeNull();
    // A whole name with no glued cell is left alone.
    expect(bulletItemName(fee(6, "Teller Check", 2, "cashiers_check"), [text])).toBeNull();
  });
});
