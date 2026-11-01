import { describe, expect, it } from "vitest";
import { AUDIENCE_V5_LIVE, darwinAudience } from "@/lib/agents/darwin/audience";
import { feeLineIndex, suggestAudience } from "./audience-context";

// Stored texts of two schedules whose box sizes Knox v99 named "Safe Deposit Box <size>" (#2064)
// and Darwin then published as `unknown` (audience regression, Oct 22 - Nov 1). Both also price a
// business item, so a fee whose line is not found stays unknown.
// First State Bank, source document 4546 (institution 6270's schedule, read Oct 2026).
const FIRSTATE = [
  "FEE SCHEDULE",
  "www.firstate.net",
  "customerservice@firstate.net",
  "",
  "FIRSTATE BANK",
  "",
  "The following fees may be assessed against your account and the following transaction limitations, if any, may apply to your account.",
  "",
  "FEES AND CHARGES. The following fees and charges may be assessed against your account:",
  "",
  "Check printing fees vary by the style of check ordered.",
  "",
  "NSF check charge- A charge for either paying or returning an item such as check, | $33.00",
  "in-person withdrawal or electronic means. A description is included on statement if it",
  "is being paid or returned.",
  "Stop Payments Fee | $33.00",
  "Returned Deposited Items | $6.00",
  "Encoded Counter Checks per 12 checks | $5.00",
  "Night Deposit Servce (per bag per month) | $3.00",
  "Dormant Account Fee (or maximum allowed by law) per month up to 12 months - | $5.00",
  "Maximum $60",
  "Cashiers Checks each | $5.00",
  "Foreign Collection Items (Incoming or Outgoing) per item | $100.00",
  "ODP Transfer Fee ($50.00 increments) each transfer | $5.00",
  "Savings Account Excessive withdrawal fee after two free | $5.00",
  "ATM Service Charge for each withdrawal made from an ATM other than First State | $2.00",
  "Bank.",
  "Replacement Cost of Lost Mastercard Check Card | $10.00",
  "Research:",
  "Inquiry or balancing for more than 3 months | $20.00 per hour",
  "Making numerous photocopies or check images | $20.00 per hour",
  "",
  "COPIES:",
  "Statement | $ 5.00",
  "Check images | each $0.50",
  "Photocopies | per page $1.00",
  "INCOMING/OUTGOING WIRE:",
  "Domestic | $20.00",
  "International | $65.00",
  "",
  "Business ACH Origination monthly fee | $25.00",
  "Business Positive Pay monthly fee | $25.00",
  "",
  "ANNUAL SAFE DEPOSIT BOX FEE",
  "3X5 | $20.00",
  "4X5 | $25.00",
  "5X5 | $30.00",
  "5X8 | $35.00",
  "3X10 | $35.00",
  "5X10 | $45.00",
  "6X10 | $50.00",
  "10X10 | $65.00",
  "",
  "© TruStage Compliance Solutions 2012-2024",
  "Page 1 of 1",
  "73b52ca3-d5c6b878 - 2024.86.0.3",
  "Fee Schedule - DD8036",
].join("\n");
const FIRSTATE_URL = "https://www.firstate.net/_/kcms-doc/2034/61141/Checking-Fee-Schedule.pdf";

// Infuze Credit Union, source document 29554 (an excerpt: its box rows and the business line).
const INFUZE = [
  "Fee Schedule",
  "Effective: October 1, 2022",
  "Business Checking (below $1,000) | $10.00",
  "Cashier’s Check (each) | $2.00",
  "Receiver Return Item (business) | $5.00",
  "Receiver Return Item (consumer) | $5.00",
  "Special Coin Order (per box) | $3.00",
  "Safe Deposit Boxes: 3x5 | $15.00",
  "5x5 | $20.00",
  "3x10 | $30.00",
  "5x10 | $40.00",
  "10x10 | $65.00",
  "Second Chance Checking | $10.00",
].join("\n");
const INFUZE_URL = "https://www.infuzecu.org/assets/files/LpVFpUtn";

const decide = (feeName: string, amount: number, text: string, url: string, boxRows = true) =>
  darwinAudience({ fee_audience: "unknown", source_url: url, fee_name: feeName }, amount, text, { ownPriceClause: true, boxRows });

describe("audience of a box size Knox named Safe Deposit Box <size> (#2064 rename)", () => {
  it("finds the box row the name was built from", () => {
    const lines = FIRSTATE.split("\n");
    expect(lines[feeLineIndex(lines, "Safe Deposit Box 3X5", 20, { boxRows: true })]).toBe("3X5 | $20.00");
    expect(lines[feeLineIndex(lines, "Safe Deposit Box 10X10", 65, { boxRows: true })]).toBe("10X10 | $65.00");
  });

  it("reads the renamed box as the bare size was read: listed for every account", () => {
    for (const [name, amount] of [["Safe Deposit Box 3X5", 20], ["Safe Deposit Box 6X10", 50], ["Safe Deposit Box 10X10", 65]] as const) {
      expect(decide(name, amount, FIRSTATE, FIRSTATE_URL)).toEqual({
        feeAudience: "both",
        audienceEvidence: "darwin:mixed_schedule_unqualified: Business ACH Origination monthly fee | $25.00",
      });
    }
    // Infuze's live rows: the bare "5x5" was `both`; its renamed copy was `unknown`.
    expect(decide("5x5", 20, INFUZE, INFUZE_URL)?.feeAudience).toBe("both");
    expect(decide("Safe Deposit Box 5x5", 20, INFUZE, INFUZE_URL)?.feeAudience).toBe("both");
    expect(decide("Safe Deposit Box 10x10", 65, INFUZE, INFUZE_URL)?.feeAudience).toBe("both");
  });

  it("ships off: with the switch off, verification reads a renamed box as main does (unknown)", () => {
    expect(AUDIENCE_V5_LIVE).toBe(false);
    const lines = FIRSTATE.split("\n");
    expect(feeLineIndex(lines, "Safe Deposit Box 3X5", 20)).toBe(-1);
    expect(darwinAudience({ fee_audience: "unknown", source_url: FIRSTATE_URL, fee_name: "Safe Deposit Box 3X5" }, 20, FIRSTATE, { ownPriceClause: true })).toBeNull();
    expect(decide("Safe Deposit Box 5x5", 20, INFUZE, INFUZE_URL, false)).toBeNull();
    // The bare size, read as before the rename, is unchanged either way.
    expect(decide("5x5", 20, INFUZE, INFUZE_URL, false)?.feeAudience).toBe("both");
  });

  it("needs the box row at the fee's own price", () => {
    const lines = FIRSTATE.split("\n");
    expect(feeLineIndex(lines, "Safe Deposit Box 3X5", 99, { boxRows: true })).toBe(-1);
    expect(feeLineIndex(lines, "Safe Deposit Box 3X5", null, { boxRows: true })).toBe(-1);
    expect(decide("Safe Deposit Box 3X5", 99, FIRSTATE, FIRSTATE_URL)).toBeNull();
  });

  it("never takes another product's row that prints a size", () => {
    const text = ["Business Wire Fee | $25.00", "Night Deposit Bag 10x12 | $15.00"].join("\n");
    const lines = text.split("\n");
    expect(feeLineIndex(lines, "Safe Deposit Box 10x12", 15, { boxRows: true })).toBe(-1);
  });

  it("leaves a box name that is not a bare size to the full-name reader", () => {
    const lines = FIRSTATE.split("\n");
    // "Safe Deposit Box Drilling" is no box size: no box row is looked for.
    expect(feeLineIndex(lines, "Safe Deposit Box Drilling", 20, { boxRows: true })).toBe(-1);
    expect(suggestAudience({ documentUrl: FIRSTATE_URL, text: FIRSTATE, feeName: "Safe Deposit Box Drilling", amount: 20, boxRows: true })).toBeNull();
  });
});
