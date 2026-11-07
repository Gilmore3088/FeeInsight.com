// @vitest-environment node
import { describe, expect, it } from "vitest";
import { runFreeSpecialists } from "@/lib/agents/knox/specialists";
import { columnHeadingRows } from "@/lib/agents/knox/column-heading-rows";
import { extractCandidatesFromText, usableName } from "@/lib/agents/knox/rules";
import { closedLeaderCell } from "@/lib/agents/knox/layout";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";

/**
 * Knox v186 (cohort Knox misses, Nov 7): two-column PDF schedules whose cells are whole dot-leader rows. Lines are
 * the banks' own stored text (Austin Bank text 2412, Utility District FCU text 6730, Rabun County Bank text 41042,
 * Bank of Gueydan text 20531), leaders shortened.
 */
const AUSTIN = [
  "Miscellaneous Fee Schedule",
  "Balance Inquiries | Undeliverable Statement/Bad Address................................................$5.00",
  "Austin Bank ATM .....................................................FREE | Wire Transfer",
  "Mobile Banking ........................................................FREE | Incoming (each) ................................ $15.00",
  "One Plus Banking.....................................................FREE | Returned Incoming (each)...........................$20.00",
  "Online Banking.......................................................FREE | International (each) ............................$50.00",
  "One Plus Banking Fax ................................................$1.00 | Outgoing (each)....................................$25.00",
].join("\n");

const UDCU = [
  "FEE SCHEDULE",
  "Debit/ATM card replacement………………………………......………….….……$10.00 | Stop payments-draft...........................................$15.00",
  "Debit/ATM PIN replacement……………………………………......….……….…...$5.00 | Wire transfers (outgoing)",
  "Check printing…………………………………………………......…...…(varies by style) | Domestic.................................................$20.00",
  "Official checks………………………………………………….......……………….…$5.00 | Foreign..................................................$30.00",
  "Deposited checks returned unpaid……......……………………………………….$30.00 | Copy of draft (first two draft copies free)....................$5.00",
  "Garnishments/Executions/Levies……………………………………...…......……$30.00 | 2nd Checking account (per month)...............................$6.00",
  "Overdraft (each debit or draft paid)...……………………………….....…….…….$30.00 | Loan payment late fee 10 days after due date........$20.00",
  "Non-sufficient funds item...................................................................$30.00 | Loan cancellation fee.................................$25.00",
].join("\n");

const reads = (text: string) => runFreeSpecialists(text).candidates.map((read) => [read.canonicalHint, read.feeName, read.amount]);

describe("Knox v186 dot-leader cells in a two-column PDF", () => {
  it("pairs a leader cell as its name and price, so the right column's heading names its bare rows", () => {
    const rows = columnHeadingRows(AUSTIN.split("\n"));
    expect(rows.map((row) => [row.heading, ...row.cells])).toEqual(expect.arrayContaining([
      ["Wire Transfer", "Incoming (each)", "$15.00"],
      ["Wire Transfer", "Outgoing (each)", "$25.00"],
    ]));
    expect(reads(AUSTIN)).toEqual(expect.arrayContaining([
      ["wire_domestic_incoming", "Wire Transfer: Incoming (each)", 15],
      ["wire_domestic_outgoing", "Wire Transfer: Outgoing (each)", 25],
    ]));
    // A bare "International" under a heading that names no direction stays with #2278's direction review: not read.
    expect(reads(AUSTIN).some(([hint]) => hint === "wire_intl_outgoing")).toBe(false);
  });

  it("reads Utility District's outgoing wires under their right-column heading, never as check printing", () => {
    expect(reads(UDCU)).toEqual(expect.arrayContaining([
      ["wire_domestic_outgoing", "Wire transfers (outgoing): Domestic", 20],
      ["wire_intl_outgoing", "Wire transfers (outgoing): Foreign", 30],
    ]));
    // The left cell is a closed row priced in words: its name never takes the $20 beside it, in any pass Knox runs
    // (the rules pass, the table pass and the family experts).
    expect(reads(UDCU).some(([hint, , amount]) => hint === "check_printing" && amount === 20)).toBe(false);
    expect(extractCandidatesFromText(UDCU).candidates.some((read) => read.canonicalHint === "check_printing" && read.amount === 20)).toBe(false);
    expect(extractCandidatesFromText(UDCU).held).toEqual(expect.arrayContaining([expect.objectContaining({ shape: "varies", canonicalHint: "check_printing" })]));
  });

  it("treats only a row priced in words as closed", () => {
    expect(closedLeaderCell("Check printing…………………(varies by style)")).toBe(true);
    expect(closedLeaderCell("Check Orders .......... Prices Vary")).toBe(true);
    expect(closedLeaderCell("Domestic.............$20.00")).toBe(false);
    expect(closedLeaderCell("Check printing (varies by style)")).toBe(false);
  });

  it("keeps a free leader cell's reading: its free word is its own price", () => {
    const FREE = [
      "FEE SCHEDULE",
      "E-Statements ......................FREE | Stop Payment ............ $25.00",
      "Online Banking ......FREE | Domestic Wire (outgoing) ......$20.00",
    ].join("\n");
    expect(reads(FREE)).toEqual(expect.arrayContaining([
      ["stop_payment", "Stop Payment", 25],
      ["wire_domestic_outgoing", "Domestic Wire (outgoing)", 20],
    ]));
    expect(runFreeSpecialists(FREE).held).toEqual(expect.arrayContaining([
      expect.objectContaining({ shape: "zero", canonicalHint: "estatement_fee", feeName: "E-Statements", amount: 0 }),
    ]));
  });

  it("never files a left heading's label at the right column's price", () => {
    const BOX = ["FEE SCHEDULE", "Safe Deposit Box | Annual Rent", "Wire Transfers | Incoming ...... $15.00"].join("\n");
    expect(reads(BOX)).toEqual(expect.arrayContaining([["wire_domestic_incoming", "Wire Transfers: Incoming", 15]]));
    expect(reads(BOX).some(([hint, name]) => hint === "safe_deposit_box" || /annual rent/i.test(String(name)))).toBe(false);
  });

  it("traces each new read to its own row with the shared source check", () => {
    expect(checkFeeAgainstSource(AUSTIN, "Wire Transfer: Incoming (each)", 15, ".", "wire_domestic_incoming").ok).toBe(true);
    expect(checkFeeAgainstSource(UDCU, "Wire transfers (outgoing): Domestic", 20, ".", "wire_domestic_outgoing").ok).toBe(true);
    expect(checkFeeAgainstSource(UDCU, "Wire transfers (outgoing): Foreign", 30, ".", "wire_intl_outgoing").ok).toBe(true);
  });
});

describe("Knox v186 box sizes written with the times sign", () => {
  const RABUN = ["Schedule of Fees", "SAFE BOX FEES", "3 x 5 | $35.00", "5 x 5 | $45.00", "3×10 | $55.00", "5 x 10 | $75.00"].join("\n");

  it("reads \"3×10\" as the box's name and traces it to its own row", () => {
    expect(usableName("3×10")).toBe(true);
    expect(usableName("×")).toBe(false);
    expect(reads(RABUN)).toEqual(expect.arrayContaining([["safe_deposit_box", "Safe Deposit Box 3×10", 55]]));
    const traced = checkFeeAgainstSource(RABUN, "Safe Deposit Box 3×10", 55, ".", "safe_deposit_box");
    expect(traced.ok && traced.sourceLine).toBe("3×10 | $55.00");
    // A size is matched whole: 3×10 never takes the 5 x 10 row's price.
    expect(checkFeeAgainstSource(RABUN, "Safe Deposit Box 3×10", 75, ".", "safe_deposit_box").ok).toBe(false);
  });
});
