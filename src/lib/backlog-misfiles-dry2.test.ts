import { describe, expect, it } from "vitest";
import { runFreeSpecialists, KNOX_RULES_STRATEGY, withReturnBesideNsf } from "@/lib/agents/knox/specialists";
import { boxLateColumnPrices } from "@/lib/agents/knox/box-late-column";
import { withBoxSizeCellsSplit } from "@/lib/agents/knox/rules";
import { restoreTarget } from "@/lib/agents/hamilton/category-guard";
import { CATEGORY_GUARD_VERSION, checkFeeCategory, plainReturnBesideNsf, refileCategory } from "@/lib/fee-category-guard";
import { wireNotificationName } from "@/lib/wire-notification";
import { avoidFeeAdvice, zeroWaiverRowOf } from "@/lib/zero-waiver-row";
import { findZeroWaiverRows } from "@/lib/agents/darwin/zero-waiver-row-check";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";

// Knox v168 / guard v108 (v167 is #2958's; the free-list check follows as v169): the wrong reads the second re-read
// backlog dry run found (40 sampled texts, Nov 2), each on the stored lines it was read from.
const EGLIN = [
  "Garnishments & Levies | $50.00",
  "Member Services. Once you have placed an initial order, you will be | BOX SIZE | ANNUALLY | LATE FEE",
  "able to reorder checks online through Online Banking by selecting | 3” x 5” x 24” | $20.00 | $3.00",
  "“Reorder Checks” under the “eServices” tab.",
  "3” x 10” x 24” | $35.00 | $6.00",
  "5” x 10” x 24” | $60.00 | $10.00",
  "COINSTAR® Coin Counting Service | 10” x 10” x 24” | $105.00 | $10.00",
  "Members | 5.8% of coin value counted",
  "Non-Members | 10.8% of coin value counted | A $10.00 key deposit is required for all safe deposit box rentals",
  "Key Replacement Fee: $10.00",
  "Drill Fee: $175.00",
].join("\n");
const COIN_NC = "Coin Counting................................................ NC | 5”x 10”x 24” ........................................ $40.00";
const FINANCIAL_HEALTH = [
  "e-Statements | Free | Replacement Card / PIN Change | $5.50",
  "Share Draft Copy (Picked up) | $1.00 | Foreign Transaction Fee | 1.00%",
  "Share Draft Copy (Mailed or faxed) | $2.00",
  "Bad Address Charge (Monthly) | $12.00",
  "Reconciliation/Account Assistance (per hour)",
  "",
  "Ways to Avoid",
  "FhealthFCU.org (Home Banking) | FREE | (Or Reduce)",
  "Paper Statements | Free",
  "Share Draft Copy | FREE online | Cash Advance Fee 2.00% or",
  "Only do transactions when | Bad Address Charge | FREE with good",
  "Daily NSF Fee | you have the funds to | (Monthly) | address on file",
  "Reconciliation / Account",
  "Reconcile online for FREE | Legal Order Processing Fee | $30.00",
  "Assistance (per hour)",
].join("\n");
const FIRST_FINANCIAL = [
  "Paid NSF/OD Fee (Insufficient Funds/Overdraft Fee, per item) | $32.00",
  "Returned NSF/OD Fee (Insufficient Funds/Overdraft Fee, per item) *Per item - created by check, in-person withdrawal, ATM withdrawal, or other electronic means, as applicable | $32.00",
  "Returned check charge | $7.00",
  "Stop payment fee, per item | $32.00",
].join("\n");
const CENTURY = ["Outgoing Wire – Domestic | $20.00", "Outgoing Wire – International | $65.00", "Wire Sent Confirmation: | $5.00 per item"].join("\n");

const reads = (text: string) => runFreeSpecialists(text).candidates.map((c) => `${c.canonicalHint} ${c.feeName} ${c.amount}`);

describe("second re-read backlog dry run misfiles (Knox v168, guard v108)", () => {
  it("bumps both versions", () => {
    expect(KNOX_RULES_STRATEGY.version).toBeGreaterThanOrEqual(168);
    expect(CATEGORY_GUARD_VERSION).toBeGreaterThanOrEqual(108);
  });

  it("reads a box table's late-fee column as no rent, and a glued box size cell as the box's row", () => {
    const read = reads(EGLIN);
    for (const rent of [20, 35, 60, 105]) expect(read.filter((r) => r.startsWith("safe_deposit_box ") && r.endsWith(` ${rent}`)).length, String(rent)).toBe(1);
    expect(read.filter((r) => r.startsWith("safe_deposit_box Safe Deposit Box") && / (?:3|6|10)$/.test(r))).toEqual([]);
    expect(read.some((r) => r.startsWith("coin_counting"))).toBe(false);
    expect(read).toContain("safe_deposit_box Safe Deposit Box 10” x 10” x 24” 105");
    expect(read).toContain("safe_deposit_box Key Replacement Fee 10");
    expect(checkFeeAgainstSource(EGLIN, "Safe Deposit Box 10” x 10” x 24”", 105, ".", "safe_deposit_box").ok).toBe(true);
  });

  it("keeps both prices of a box priced in two columns with no late-fee header", () => {
    expect(boxLateColumnPrices(["Box Size | Annual | Semi-annual", "3 x 5 | $40.00 | $25.00"].join("\n")).size).toBe(0);
    expect(boxLateColumnPrices(["Size | Members | Non-members", "3x5 | $25.00 | $35.00"].join("\n")).size).toBe(0);
    const twoColumn = reads(["Safe Deposit Boxes", "2” x 5” $45.00 $65.00"].join("\n"));
    expect(twoColumn.filter((r) => r.startsWith("safe_deposit_box")).length).toBe(2);
  });

  it("splits only a three-dimension size cell, never a page size", () => {
    expect(withBoxSizeCellsSplit(COIN_NC).split("\n")).toHaveLength(2);
    expect(withBoxSizeCellsSplit("Copies | 8.5” x 11” | $0.25")).toBe("Copies | 8.5” x 11” | $0.25");
    expect(withBoxSizeCellsSplit("Safe Deposit Box Rental | 10” x 10” x 24” | $105.00")).toBe("Safe Deposit Box Rental | 10” x 10” x 24” | $105.00");
    expect(reads(COIN_NC).some((r) => r.startsWith("coin_counting") && r.endsWith(" 40"))).toBe(false);
  });

  it("refuses a box size glued onto a coin counting name and moves it to the box (97753, 64741)", () => {
    for (const name of ["COINSTAR® Coin Counting Service: 10” x 10” x 24”", "Coin Counting NC: 5”x 10”x 24”"]) {
      expect(checkFeeCategory("coin_counting", name).ok, name).toBe(false);
      expect(refileCategory("coin_counting", name), name).toBe("safe_deposit_box");
      expect(restoreTarget({ canonical_fee_key: "coin_counting", fee_name: name, amount: 40 } as never), name).toBe("safe_deposit_box");
    }
    expect(checkFeeCategory("coin_counting", "COINSTAR® Coin Counting Service").ok).toBe(true);
    expect(checkFeeCategory("coin_counting", "Coin wrappers 8.5” x 11”").ok).toBe(true);
  });

  it("holds a free word that is advice in a Ways to Avoid section (89909, 105000)", () => {
    const zero = (line: string) => zeroWaiverRowOf({ line, amount: 0, documentText: FINANCIAL_HEALTH })?.kind ?? null;
    expect(zero("Reconcile online for FREE")).toBe("avoid_fee_advice");
    expect(zero("Only do transactions when | Bad Address Charge | FREE")).toBe("avoid_fee_advice");
    expect(zero("Share Draft Copy | FREE")).toBe("avoid_fee_advice");
    // A bare free cell in the section, and every line before the heading, is the bank's own price.
    expect(zero("Paper Statements | Free")).toBeNull();
    expect(zero("e-Statements | Free")).toBeNull();
    expect(zeroWaiverRowOf({ line: "Reconcile online for FREE", amount: 5, documentText: FINANCIAL_HEALTH })).toBeNull();
    expect(reads(FINANCIAL_HEALTH).some((r) => /Reconcile online/.test(r))).toBe(false);
  });

  it("opens no section under a heading that names one thing to avoid", () => {
    const text = ["How to Avoid Paying Interest on Purchases", "Balance Transfer | Free with autopay"].join("\n");
    expect(avoidFeeAdvice("Balance Transfer | Free with autopay", text)).toBe(false);
    expect(avoidFeeAdvice("Balance Transfer | Free with autopay", text.replace("How to Avoid Paying Interest on Purchases", "How to Avoid Fees"))).toBe(true);
  });

  it("Darwin's live re-check reads the advice $0s on their text", () => {
    const rows = [
      { fee_published_id: 89909, fee_verified_id: 100351, institution_id: 6465, fee_name: "Bad Address Charge", canonical_fee_key: "returned_mail",
        source_line: 'Knox read a free fee from Rosetta artifact #13478. excerpt="Only do transactions when | Bad Address Charge | FREE"', artifact_id: 13478 },
      { fee_published_id: 105000, fee_verified_id: 119841, institution_id: 6465, fee_name: "Share Draft Copy", canonical_fee_key: "check_image",
        source_line: 'Knox read a free fee from Rosetta artifact #13478. excerpt="Share Draft Copy | FREE"', artifact_id: 13478 },
    ];
    const found = findZeroWaiverRows(rows, new Map([[13478, FINANCIAL_HEALTH]]));
    expect(found.matches.map((fee) => [fee.feePublishedId, fee.kind])).toEqual([[89909, "avoid_fee_advice"], [105000, "avoid_fee_advice"]]);
  });

  it("files a returned check charge beside the page's own higher NSF fee as the deposited item return", () => {
    expect(reads(FIRST_FINANCIAL)).toContain("deposited_item_return Returned check charge 7");
    expect(reads(FIRST_FINANCIAL).some((r) => r.startsWith("nsf Returned check charge"))).toBe(false);
    const read = { feeName: "Returned Check Fee", amount: 30, canonicalHint: "nsf" };
    // At the NSF fee's own price, or with no NSF read on the page, it stays NSF.
    expect(withReturnBesideNsf([read, { feeName: "NSF Fee", amount: 30, canonicalHint: "nsf" }])[0].canonicalHint).toBe("nsf");
    expect(withReturnBesideNsf([read])[0].canonicalHint).toBe("nsf");
    expect(withReturnBesideNsf([read, { feeName: "Insufficient Funds Fee", amount: 35, canonicalHint: "nsf" }])[0].canonicalHint).toBe("deposited_item_return");
    // An NSF read at the return's own price elsewhere on the page, or the page's own deposited item
    // return, keeps it NSF (seven-state answer key 5918, Springfield City Employees FCU).
    expect(withReturnBesideNsf([{ feeName: "Return Check Fee", amount: 25, canonicalHint: "nsf" }, { feeName: "Non-Sufficient Funds", amount: 25, canonicalHint: "nsf" },
      { feeName: "ACH/ATM NSF", amount: 30, canonicalHint: "nsf" }])[0].canonicalHint).toBe("nsf");
    expect(withReturnBesideNsf([{ feeName: "Returned Item Fee", amount: 30, canonicalHint: "nsf" }, { feeName: "NSF Fee", amount: 33, canonicalHint: "nsf" },
      { feeName: "Deposited Item Return Fee", amount: 25, canonicalHint: "deposited_item_return" }])[0].canonicalHint).toBe("nsf");
    expect(withReturnBesideNsf([read, { feeName: "NSF Deposit Fee", amount: 35, canonicalHint: "deposited_item_return" }])[0].canonicalHint).toBe("nsf");
    expect(plainReturnBesideNsf("Returned check charge", 7, 32)).toBe(true);
    expect(plainReturnBesideNsf("Returned NSF check", 7, 32)).toBe(false);
    expect(checkFeeCategory("nsf", "Returned check charge", { amount: 7, document_nsf_amount: 32 }).ok).toBe(false);
  });

  it("holds a wire's confirmation, keeping its qualifier skips", () => {
    expect(wireNotificationName("Wire Sent Confirmation:")).toBe(true);
    expect(wireNotificationName("Wire Confirmation (Email, Call Back, or Fax)")).toBe(true);
    for (const name of ["Outgoing Wire with confirmation", "Outgoing Wire w/ confirmation", "Outgoing Wire w/confirmation", "Outgoing wire, confirmation included",
      "Incoming Wire (confirmation by fax)", "Outgoing Wire (no confirmation)", "Outgoing wire and confirmation"]) {
      expect(wireNotificationName(name), name).toBe(false);
    }
    const read = reads(CENTURY);
    expect(read.some((r) => /Confirmation/.test(r))).toBe(false);
    expect(read).toContain("wire_domestic_outgoing Outgoing Wire – Domestic 20");
    expect(checkFeeCategory("wire_domestic_outgoing", "Wire Sent Confirmation").ok).toBe(false);
    expect(refileCategory("wire_domestic_outgoing", "Wire Sent Confirmation")).toBe("wire_domestic_outgoing");
    expect(restoreTarget({ canonical_fee_key: "wire_domestic_outgoing", fee_name: "Wire Sent Confirmation" } as never)).toBeNull();
    expect(checkFeeCategory("wire_domestic_outgoing", "Outgoing Wire w/ confirmation").ok).toBe(true);
  });
});
