import { describe, expect, it } from "vitest";
import { bandedZeroOf } from "@/lib/banded-zero";

// #1882: every line below is the bank's own stored text (prod, read-only, Oct 26).
const COURTESY_PAY = [
  "Overdraft share transfer fee | 3.00 | the previous 12 months)",
  "Item paid in overdraft fee (Courtesy Pay) | N/C | Early account closed fee (within 6 months) | 25.00",
  "Negative account balance $0-$9.99 | Medallion Signature guarantee, members | 5.00",
  "Item paid in overdraft fee (Courtesy Pay) | up to 19.00 | Money order | 3.00",
  "Negative account balance $10.00 or more",
].join("\n");

function od(line: string, feeName: string, documentText: string | null = null, canonicalFeeKey = "overdraft") {
  return bandedZeroOf({ line, feeName, canonicalFeeKey, documentText });
}

describe("a $0 that is not an overdraft or NSF fee's price (#1882)", () => {
  it("reads a $0 whose own cell goes on to price the fee", () => {
    expect(od("Safety Net Overdraft | $0 if the negative balance is $5 or less. $10 if the negative balance is $5.01 to $20. $35 per item** if negative balance is $20.01 or greater.", "Safety Net Overdraft"))
      .toMatchObject({ kind: "own_cell", price: 35 });
    expect(od("Privilege Pay ACH, Check, Debit Card | $0 for items ≤ $5", "Privilege Pay ACH, Check, Debit Card"))
      .toMatchObject({ kind: "own_cell", price: 5 });
  });

  it("reads a band printed on a row of its own with the same name", () => {
    const line = "Item paid in overdraft fee (Courtesy Pay) | N/C | Early account closed fee (within 6 months) | 25.00";
    // The line alone shows nothing: the next cell is another fee's.
    expect(od(line, "Item paid in overdraft fee (Courtesy Pay)")).toBeNull();
    expect(od(line, "Item paid in overdraft fee (Courtesy Pay)", COURTESY_PAY))
      .toMatchObject({ kind: "priced_twin_row", price: 19, evidence: "Item paid in overdraft fee (Courtesy Pay) | up to 19.00" });
  });

  it("reads the next column's free word after the fee's own price", () => {
    expect(od("Overdraft Fee | $12.00 | Free", "Overdraft Fee")).toMatchObject({ kind: "own_row_price", price: 12 });
  });

  it("keeps a $0 the schedule states for the whole fee", () => {
    const stated: [string, string][] = [
      ["No-Fee Overdraft | Free", "No-Fee Overdraft"],
      ["Overdraft/NSF Fee We do not charge a fee for this service $0.00", "Overdraft/NSF Fee We do not charge a fee for this service"],
      ["Overdraft Fee $0", "Overdraft Fee"],
      ["Overdraft fee $0 $0 $0", "Overdraft fee"],
      ["Overdraft Fee | $0.00 | Important: Square Checking does not allow you to overdraw your Card Account.", "Overdraft Fee"],
      ["Overdraft Fee – Item Paid | No charge", "Overdraft Fee – Item Paid"],
      ["Overdraft (per item, per presentment) NO CHARGE", "Overdraft (per item, per presentment)"],
      ["Overdraft Privilege | FREE", "Overdraft Privilege"],
      ["Overdraft fee | $0", "Overdraft fee"],
      ["Overdraft - Share Account | Free", "Overdraft - Share Account"],
      ["Courtesy Pay. . . . . . . . . . . . . . . . . . . . FREE", "Courtesy Pay"],
      ["Overdraft Fee ........................................ NO FEE", "Overdraft Fee"],
      ["NSF Paid Item created by check, ACH or other electronic means or in-person withdrawals5 $0.00", "NSF Paid Item created by check, ACH or other electronic means or in-person withdrawals"],
    ];
    for (const [line, name] of stated) expect(od(line, name, line), line).toBeNull();
  });

  it("keeps two rows of one name with no band words: two accounts' or audiences' prices", () => {
    const text = [
      "CONSUMER ACCOUNTS | Instant Issue Debit Card Fee | $5.00 Each",
      "Non-Sufficient Funds Fee (Returned Item) | No Fee | 6.",
      "damage. Fee does not apply to Branded Debit Card | ACH Return Credit Item Fee | $12.00 per Item",
      "NON-CONSUMER ACCOUNTS | Check | $25.00 per Item",
      "Non-Sufficient Funds Fee (Returned Item) $36.00 Each | Early Closure Fee | $25.00 per Account",
      "3. If the linked secondary account is a money market",
    ].join("\n");
    expect(od("Non-Sufficient Funds Fee (Returned Item) | No Fee | 6.", "Non-Sufficient Funds Fee (Returned Item)", text, "nsf")).toBeNull();
  });

  it("keeps another audience's price and a price no longer charged", () => {
    expect(od("Courtesy Pay Fee | $0 members, $5 non-members", "Courtesy Pay Fee")).toBeNull();
    expect(od("Overdraft Fee | $0 (was $35)", "Overdraft Fee")).toBeNull();
    expect(od("Overdraft Fee | $0", "Overdraft Fee", "Overdraft Fee | $0\nOverdraft Fee | $35 per item (no longer charged after June 1)")).toBeNull();
  });

  it("reads only the banded categories, and only a name with words of its own", () => {
    const line = "Safety Net Overdraft | $0 if the negative balance is $5 or less. $35 per item";
    expect(od(line, "Safety Net Overdraft", null, "monthly_maintenance")).toBeNull();
    expect(bandedZeroOf({ line, feeName: "Safety Net Overdraft", canonicalFeeKey: null })).toBeNull();
    expect(od("OD | Free if $5 or less, $30 above", "OD")).toBeNull();
    expect(od(line, "Safety Net Overdraft", null, "nsf")).toMatchObject({ kind: "own_cell" });
    expect(od(line, "Safety Net Overdraft", null, "continuous_od")).toMatchObject({ kind: "own_cell" });
  });
});
