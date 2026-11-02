import { describe, expect, it } from "vitest";
import { bulletCellStart, bulletItemRead } from "./bullet-cell-rows";
import type { ExtractedFeeCandidate } from "./rules";
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

// Elite Community CU (institution 7106, document 18405, agent_source_texts 13895), the first rows as
// stored. The left column is itself a wrapping bullet list. The first #2952 version moved the right
// column's cells and read a $5 "IRA administration: Accounts" (the dormant-account fee) here.
const ELITE_13895 = [
  "Elite Community Credit Union",
  "Membership Deposit & Fee Schedule",
  "Credit Union Membership | Other Service Fees",
  "• Minimum balance – Regular | • Cash N’ Dash fee.…….$35.00*",
  "share account…..……..$25.00 | • Domestic wire transfer",
  "• Minimum balance with a Visa, | outgoing fee…………....$25.00*",
  "Loan, IRA, Checking, Certificate | • Domestic Wire-In fee…$15.00",
  "of deposit, and Visa Debit/ATM | • Foreign wire transfer",
  "card…............………….$50.00 | outgoing……………..….$75.00",
  "• Foreign Wire-In fee…...$35.00",
  "Savings Account Fees | • Money order…….…..…...$2.00",
  "• Certified check….….…...$3.00",
  "• Early exit fee..……..…….$25.00 | • Teller check (after limit (3) per",
  "(Account must be open for 6 | month)……………….….….$6.00",
  "months) | • Loan late fee……...…....$30.00",
  "• IRA administration | • Check cashing fee….......$1.00",
  "fee…………………….$15.00/year | per $100.00 (If member has",
  "• IRA closing.…………….….$6.00 | Visa, loan or $125.00 in",
  "• Reg D fee………….…$5.00/item | account, no check cashing",
  "• Dorman | fee.)",
  "Accounts……………….$5/month | • Portal Pay (Internal/External)",
  "……….………….…$5.00/$3.00*",
  "Checking Account Fees | • Returned Mail/Bad Address",
  "• Overdraft transfer fee…..$5.00 | ………………..…………….$5.00*",
  "• NSF fee..………..............$30.00* | • Send/Receive Fax$1.00/page*",
].join("\n");

describe("a bullet item in a later cell is named by its own cell (Knox v164)", () => {
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

  it("keeps Elite Community's $15 IRA fee and reads no $5 IRA fee (review of #2952, text 13895)", () => {
    const found = reads(ELITE_13895);
    const ira = found.filter(([, , key]) => key === "ira_administration");
    expect(ira.map(([, amount]) => amount)).toContain(15);
    expect(ira.filter(([, amount]) => amount === 5)).toEqual([]);
    expect(found.filter(([name]) => /IRA administration: Accounts/i.test(name))).toEqual([]);
    // The two renames this page gets: the bullet cell's own words.
    expect(found.map(([name]) => name)).toEqual(expect.arrayContaining(["Domestic Wire-In fee", "Money order"]));
    for (const [name] of found) expect(name).not.toMatch(/Loan, IRA, Checking|Savings Account Fees:/);
  });

  it("keeps a read Knox had when another column's bullet list stands before it (text 15434)", () => {
    const text = [
      "IRA/SEP | DEBIT CARD FEES (VISA AND CASHPOINTS DEBIT CARDS)",
      "· Minimum balance that must be maintained – $25 | • Debit card reissue fee – $0",
      "minimum balance on statement date) | • Debit card rush delivery fee – $15",
      "· No minimum balance required to earn dividends | • Debit card PIN rush delivery fee - $15",
      "CESA",
    ].join("\n");
    expect(reads(text)).toContainEqual(["Debit card PIN rush delivery fee", 15, "rush_card"]);
  });

  it("drops the other column's heading or feature bullet in front of an item", () => {
    expect(reads("FEES\nAbandoned Property | • Teller Check | $2.00")).toContainEqual(["Teller Check", 2, "cashiers_check"]);
    expect(reads("FEES\n• Unlimited check writing | • Stop Payments - $30.00 per item")).toContainEqual(["Stop Payments", 30, "stop_payment"]);
    expect(reads("FEES\nSize: | Fee | ● ATM Withdrawal Fee | $1.00 per item if out‐of‐network ATM")).toContainEqual(["ATM Withdrawal Fee", 1, "atm_non_network"]);
  });

  it("keeps the heading when it names the fee, an audience, or the item alone names no fee", () => {
    // The item alone ("Outgoing Domestic") reads no wire: the heading stays in the name.
    expect(reads("FEES\nWire Transfers | • Outgoing Domestic | $35.00")).toEqual([["Wire Transfers: Outgoing Domestic", 35, "wire_domestic_outgoing"]]);
    // The heading is the fee's own name.
    expect(reads("FEES\nNSF Fee | • Per Item | $30.00")).toEqual([["NSF Fee", 30, "nsf"]]);
    // An audience is part of the fee.
    expect(reads("FEES\nBusiness Accounts | • Stop Payment | $30.00")).toContainEqual(["Business Accounts: Stop Payment", 30, "stop_payment"]);
    expect(reads("FEES\nNon-Customer Services | • Notary Fee | $10.00")).toEqual([["Non-Customer Services: Notary Fee", 10, "notary_fee"]]);
    // "Stop Payment" is the left column's; the $14.95 is the overnight check's, never a stop payment.
    expect(reads("FEES\nStop Payment | • Overnight Check | $14.95").filter(([, , key]) => key === "stop_payment")).toEqual([]);
  });

  it("renames only: the read keeps its amount, category and excerpt", () => {
    const read = {
      feeName: "Abandoned Property: Teller Check", amount: 2, canonicalHint: "cashiers_check",
      excerpt: "Abandoned Property | • Teller Check | $2.00",
    } as ExtractedFeeCandidate;
    expect(bulletItemRead(read)).toEqual({ ...read, feeName: "Teller Check" });
    const heading = { ...read, feeName: "Teller Check" };
    expect(bulletItemRead(heading)).toBe(heading);
    const business = { ...read, feeName: "Business Accounts: Teller Check", excerpt: "Business Accounts | • Teller Check | $2.00" };
    expect(bulletItemRead(business)).toBe(business);
  });

  it("finds no bullet cell when the bullet is first, bare, after a price, or an account's own fee", () => {
    expect(bulletCellStart("• Cashier’s Check: Non-Member | $10.00 | • Overdraft Protection Transfer Fee | $5.00/Item")).toBe(-1);
    expect(bulletCellStart("Dividend Checking Account Fees | • | Monthly Service Fee ........ $15")).toBe(-1);
    expect(bulletCellStart("• Withdrawals at Telco ATM | Free | • Temporary Checks")).toBe(-1);
    expect(bulletCellStart("Four Star Banking with Interest | • Monthly maintenance fee is $10")).toBe(-1);
    expect(bulletCellStart("Stop Payment | $30.00 | • per item")).toBe(-1);
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
    // An audience word is part of the fee: business, and the review's non-customer, corporate and
    // organization words (`AUDIENCE_WORDS`, shared with Knox).
    expect(bulletItemName(fee(3, "Business Accounts: Teller Check", 2, "cashiers_check"), [text])).toBeNull();
    const notary = "FEES\nNon-Customer Services | • Notary Fee | $10.00";
    expect(bulletItemName(fee(7, "Non-Customer Services: Notary Fee", 10, "notary_fee"), [notary])).toBeNull();
    const corporate = "FEES\nCorporate | • Teller Check | $2.00";
    expect(bulletItemName(fee(8, "Corporate: Teller Check", 2, "cashiers_check"), [corporate])).toBeNull();
    const organization = "FEES\nOrganization Accounts | • Teller Check | $2.00";
    expect(bulletItemName(fee(9, "Organization Accounts: Teller Check", 2, "cashiers_check"), [organization])).toBeNull();
    // Another price: Knox reads no teller check at $3.
    expect(bulletItemName(fee(4, "Abandoned Property: Teller Check", 3, "cashiers_check"), [text])).toBeNull();
    // An account's own fee keeps its account.
    expect(bulletItemName(fee(5, "Four Star Banking with Interest: Monthly maintenance fee", 10, "monthly_maintenance"), ["FEES\nFour Star Banking with Interest | • Monthly maintenance fee is $10"])).toBeNull();
    // A whole name with no glued cell is left alone.
    expect(bulletItemName(fee(6, "Teller Check", 2, "cashiers_check"), [text])).toBeNull();
  });
});
