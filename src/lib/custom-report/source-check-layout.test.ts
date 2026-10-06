import { describe, expect, it } from "vitest";
import { checkFeeAgainstSource } from "./source-check";

describe("checkFeeAgainstSource layouts", () => {
  it("reads a price printed under its fee's name", () => {
    const text = "Overnight Courier Service\n$50.00\n/Item";
    expect(checkFeeAgainstSource(text, "Overnight Courier Service", 50, ".").ok).toBe(true);
  });

  it("does not give a name the next fee's price", () => {
    const text = "Wire Transfer - Incoming\nWire Transfer - Outgoing\n$25.00";
    expect(checkFeeAgainstSource(text, "Wire Transfer - Incoming", 25, ".").ok).toBe(false);
  });

  it("reads a name split under a heading, past the rows before it", () => {
    const text = "Wire Transfers\nIncoming Domestic\n$14.00\nOutgoing Domestic\n$26.00";
    expect(checkFeeAgainstSource(text, "Wire Transfers Outgoing Domestic", 26, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(text, "Wire Transfers Incoming Domestic", 14, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(text, "Wire Transfers Incoming Domestic", 26, ".").ok).toBe(false);
  });

  it("reads a line under a heading that names most of the fee", () => {
    const text = "CASHIERS CHECK | $5.00 / EACH\n\nWIRE TRANSFERS (OUTGOING)\n\nDOMESTIC WIRE | $35.00\n\nINTERNATIONAL | $55.00";
    expect(checkFeeAgainstSource(text, "WIRE TRANSFERS (OUTGOING): DOMESTIC WIRE", 35, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(text, "WIRE TRANSFERS (OUTGOING): DOMESTIC WIRE", 55, ".").ok).toBe(false);
    const overdraft = "Account Fees\nOverdraft/Non-Sufficient Funds\n...Item Paid $30.00\n...Item Returned $30.00";
    expect(checkFeeAgainstSource(overdraft, "Overdraft/Non-Sufficient Funds: Item Paid", 30, ".").ok).toBe(true);
  });

  it("reads a price printed under its name after a bullet or a tilde", () => {
    expect(checkFeeAgainstSource("Photocopies\n• $1.00 per page", "Photocopies", 1, ".").ok).toBe(true);
    expect(checkFeeAgainstSource("Stop Payment (per request)\n\n~$25\n\nFREE", "Stop Payment (per request)", 25, ".").ok).toBe(true);
  });

  it("takes the row's first figure that is not a limit as the price", () => {
    const text = "Official Teller Check | $4.00 | per check, if not made payable to member, minimum $500";
    expect(checkFeeAgainstSource(text, "Official Teller Check", 4, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(text, "Official Teller Check", 500, ".")).toEqual({ ok: false, reason: "amount_is_a_threshold" });
    const overdraft = "$35 Overdraft Fee for each item we pay that overdraws your account more than $9.99";
    expect(checkFeeAgainstSource(overdraft, "Overdraft Fee for each item we pay", 35, ".").ok).toBe(true);
  });

  it("reads each fee's own price when one line carries several fees", () => {
    const line = "Title Draft $50.00 Incoming Wire Fee (domestic) $18.00";
    expect(checkFeeAgainstSource(line, "Incoming Wire Fee (domestic)", 18, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(line, "Incoming Wire Fee (domestic)", 50, ".").ok).toBe(false);
    expect(checkFeeAgainstSource(line, "Title Draft", 18, ".").ok).toBe(false);
    const paragraph =
      "Overdraft Transfer $3 per occurrence Stop Payment (Valid for six months) $32 per item or series " +
      "Wire Transfers • Outgoing — domestic $33.00 • Incoming6 $15.00 Lost ATM/debit card replacement $5.00";
    expect(checkFeeAgainstSource(paragraph, "Stop Payment (Valid for six months)", 32, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(paragraph, "Lost ATM/debit card replacement", 5, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(paragraph, "Stop Payment (Valid for six months)", 3, ".").ok).toBe(false);
    expect(checkFeeAgainstSource("$1.95 each thereafter) | $1.95 | NSF/Overdraft Fee | $32.00", "NSF/Overdraft Fee", 32, ".").ok).toBe(true);
  });
  it("reads layouts the live dry run of Oct 6 showed it missing", () => {
    // Dot leaders before a bare amount.
    expect(checkFeeAgainstSource("Courtesy Pay .......................30.00", "Courtesy Pay", 30, ".").ok).toBe(true);
    // A minimum charge before the hourly price.
    expect(checkFeeAgainstSource("Account Research/Balancing | $10.00 minimum / $25.00 per hour", "Account Research/Balancing", 25, ".").ok).toBe(true);
    // A range in the name is not the price.
    expect(checkFeeAgainstSource("VISA Gift Cards (load $10-$1000) | $4.00 each", "VISA Gift Cards", 4, ".").ok).toBe(true);
    // A heading over sub-rows that carry their own names and prices.
    const wires = "Wire Transfer\nIncoming | $10.00\nOutgoing | $30.00";
    expect(checkFeeAgainstSource(wires, "Wire Transfer: Outgoing", 30, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(wires, "Wire Transfer: Outgoing", 10, ".").ok).toBe(false);
    expect(checkFeeAgainstSource("Stop Payment Fee:\nPer Item | $25.00", "Stop Payment Fee: Per Item", 25, ".").ok).toBe(true);
    // Box sizes are matched whole, and a price-first list names each box after its price.
    expect(checkFeeAgainstSource("5 x 10 | $60.00\n15 x 10 | $90.00", "5 x 10", 60, ".").ok).toBe(true);
    expect(checkFeeAgainstSource("5 x 10 | $60.00\n15 x 10 | $90.00", "5 x 10", 90, ".").ok).toBe(false);
    const prices = "$25 (3 X 5), $35 (3 X 10), $55 (5 X 10), $80 (10 X 10)";
    expect(checkFeeAgainstSource(prices, "(5 X 10)", 55, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(prices, "(5 X 10)", 80, ".").ok).toBe(false);
  });
});
