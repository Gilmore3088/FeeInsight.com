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

  it("takes the row's first figure that is not a limit as the price", () => {
    const text = "Official Teller Check | $4.00 | per check, if not made payable to member, minimum $500";
    expect(checkFeeAgainstSource(text, "Official Teller Check", 4, ".").ok).toBe(true);
    expect(checkFeeAgainstSource(text, "Official Teller Check", 500, ".")).toEqual({ ok: false, reason: "amount_is_a_threshold" });
    const overdraft = "$35 Overdraft Fee for each item we pay that overdraws your account more than $9.99";
    expect(checkFeeAgainstSource(overdraft, "Overdraft Fee for each item we pay", 35, ".").ok).toBe(true);
  });
});
