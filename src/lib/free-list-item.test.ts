import { describe, expect, it } from "vitest";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { freeListItemCells, freeListItemRead } from "@/lib/free-list-item";

/** Mountain Star FCU (institution 4467, document 38274), text 36365 as read.pdf_layout stored it before layout v6. */
const MOUNTAIN_STAR_36365 = [
  "Mailed paper | $1.00",
  "statement | Instant Issue | Other Free Services: Anytime, Notary",
  "$10.00 | Service, Signature Guarantee, Unlimited",
  "Debit Card",
  "Membership Fee $3.00 | Check Writing, Balance Inquiries,",
  "Money market | Fax Service",
  "$5.00",
  "excess check",
  "Money Orders $.75 ea.",
  "NSF Check $30.00",
].join("\n");

const traced = (text: string, name: string, amount: number) => {
  const result = checkFeeAgainstSource(text, name, amount, ".");
  return result.ok ? result.sourceLine : null;
};

describe("freeListItemRead (#1092, Mountain Star FCU, live 159428)", () => {
  it("refuses Fax Service $5: an item of the free services list priced from the line below", () => {
    const line = traced(MOUNTAIN_STAR_36365, "Fax Service", 5);
    // The shared check traces the pair, which is why the fee went live.
    expect(line).toBe("Money market | Fax Service | $5.00");
    expect(freeListItemRead({ feeName: "Fax Service", amount: 5, tracedLine: line, documentText: MOUNTAIN_STAR_36365 })).toEqual({
      nameLine: "Money market | Fax Service",
      item: "Fax Service",
      heading: "Other Free Services: Anytime, Notary",
    });
  });

  it("reads the list through the column, skipping the other column's one-cell line", () => {
    const lines = MOUNTAIN_STAR_36365.split("\n");
    expect(freeListItemCells(lines).map((cell) => cell.cell)).toEqual([
      "Anytime, Notary",
      "Service, Signature Guarantee, Unlimited",
      "Check Writing, Balance Inquiries,",
      "Fax Service",
    ]);
  });

  it("keeps a fee whose own line prints its price, and a fee priced below that is not a list item", () => {
    expect(freeListItemRead({ feeName: "Membership Fee", amount: 3, tracedLine: "Membership Fee $3.00 | Check Writing, Balance Inquiries,", documentText: MOUNTAIN_STAR_36365 })).toBeNull();
    const text = ["Free Services: Notary, Coin counting", "Wire Transfer", "$25.00"].join("\n");
    expect(freeListItemRead({ feeName: "Wire Transfer", amount: 25, tracedLine: "Wire Transfer | $25.00", documentText: text })).toBeNull();
  });

  it("ends the list at a figure, a closing colon or an item with no comma after one that ended without one", () => {
    const text = [
      "Notes | Free Services: Notary, Coin counting",
      "Overdraft | Signature Guarantee",
      "Stop Payment | Fax",
      "$30.00",
    ].join("\n");
    // "Signature Guarantee" ends the list (no comma after "Coin counting"), so "Fax" is no item.
    expect(freeListItemCells(text.split("\n")).map((cell) => cell.cell)).toEqual(["Notary, Coin counting"]);
    expect(freeListItemRead({ feeName: "Fax", amount: 30, tracedLine: "Stop Payment | Fax | $30.00", documentText: text })).toBeNull();
  });

  it("reads a list under a heading of its own, one item a line", () => {
    const text = ["NO CHARGE TO CUSTOMERS FOR THE FOLLOWING SERVICES:", "Coin Counter Usage", "Notary Public Service", "Night Depository"].join("\n");
    expect(freeListItemCells(text.split("\n")).map((cell) => cell.cell)).toEqual(["Coin Counter Usage", "Notary Public Service", "Night Depository"]);
  });

  it("does not open a list at a toll-free number, an account name or a sentence", () => {
    for (const heading of [
      "Toll-Free Customer Service Number: (888) 275-8523",
      "ATM Service Fees (excludes Free Checking): for non-",
      "ATM. There is no fee to use a MoneyPass ATM. Foreign Transaction Fees: Mastercard",
    ]) {
      expect(freeListItemCells([heading, "Wire Services, Notary"]), heading).toEqual([]);
    }
  });

  it("leaves to the shared check a name priced below another label, and a line that says free", () => {
    // Another name between a name and its price ends the row (`feeRow`): "Fax Service" never takes "$5.00".
    expect(traced(["Fax Service", "Notary", "$5.00"].join("\n"), "Fax Service", 5)).toBeNull();
    // A line that says free takes no price from the line below.
    expect(traced(["Fax Service FREE", "$5.00"].join("\n"), "Fax Service", 5)).toBeNull();
  });
});
