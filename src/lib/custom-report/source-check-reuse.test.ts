import { describe, expect, it } from "vitest";
import { checkFeeAgainstSource } from "./source-check";

describe("source page reuse (#2317)", () => {
  it("rechecks the requested name, price and category after the same page was read", () => {
    const text = "Wire Transfers\nIncoming Domestic\n$14.00\nOutgoing Domestic\n$26.00";
    const incoming = checkFeeAgainstSource(text, "Wire Transfers Incoming Domestic", 14, ".");
    const outgoing = checkFeeAgainstSource(text, "Wire Transfers Outgoing Domestic", 26, ".");
    expect(incoming.ok).toBe(true);
    expect(outgoing.ok).toBe(true);
    for (let repeat = 0; repeat < 3; repeat++) {
      expect(checkFeeAgainstSource(text, "Wire Transfers Incoming Domestic", 26, ".").ok).toBe(false);
      expect(checkFeeAgainstSource(text, "Wire Transfers Outgoing Domestic", 14, ".").ok).toBe(false);
      expect(checkFeeAgainstSource(text, "Wire Transfers Incoming Domestic", 14, "notary").ok).toBe(false);
      expect(checkFeeAgainstSource(text, "Wire Transfers Incoming Domestic", 14, ".")).toEqual(incoming);
      expect(checkFeeAgainstSource(text, "Wire Transfers Outgoing Domestic", 26, ".")).toEqual(outgoing);
    }
  });

  it("keeps right-column heading ownership separate after neighboring fees were checked", () => {
    const text = [
      "• Business | $5.00 | Overdrafts (OD)",
      "• Personal | $36.00",
      "Debit Card | FREE | when the amount of the item paid in overdraft is $4.99",
      "• Expedited delivery | $40.00 | • Business | $30.00",
    ].join("\n");
    for (let repeat = 0; repeat < 3; repeat++) {
      expect(checkFeeAgainstSource(text, "Overdrafts (OD): Business", 30, ".").ok).toBe(true);
      expect(checkFeeAgainstSource(text, "Overdrafts (OD): Personal", 36, ".").ok).toBe(true);
      expect(checkFeeAgainstSource(text, "Overdrafts (OD): Personal", 40, ".").ok).toBe(false);
      expect(checkFeeAgainstSource(text, "Overdrafts (OD): Personal", 4.99, ".").ok).toBe(false);
    }
  });

  it("cannot carry a prior document's own price or heading into the next document", () => {
    const first = "Wire Transfers\nIncoming Domestic\n$14.00\nOutgoing Domestic\n$26.00";
    const second = "Wire Transfers\nIncoming Domestic\n$19.00\nOutgoing Domestic\n$31.00";
    const noOwner = "Notary | $5.00 | Counter Checks\nChecks | $10.00";
    for (const [text, own, other] of [[first, 14, 19], [second, 19, 14], [first, 14, 19]] as const) {
      expect(checkFeeAgainstSource(text, "Wire Transfers Incoming Domestic", own, ".").ok).toBe(true);
      expect(checkFeeAgainstSource(text, "Wire Transfers Incoming Domestic", other, ".").ok).toBe(false);
      expect(checkFeeAgainstSource(noOwner, "Counter Checks", 10, ".").ok).toBe(false);
    }
  });
});
