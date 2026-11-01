import { describe, expect, it } from "vitest";
import { gluedPricePair, withoutGluedPricePairs } from "./glued-price-pair";
import { checkFeeAgainstSource } from "./source-check";
import { checkFeeCategory, CATEGORY_GUARD_VERSION } from "@/lib/fee-category-guard";
import { KNOX_RULES_STRATEGY } from "@/lib/agents/knox/specialists";
import { reproducibleFees } from "@/lib/agents/hamilton/rules-recheck";

// Access FCU (institution 4965, document 33871, text 31944), stored PDF layout text: two columns
// flattened onto one line, with clean single-column lines lower on the page.
const ACCESS = `Dormant Account Fee (annual) .............................. | $ 5.00
Dormant Account Fee (annual) ........................Stop Payment on Draft ........................................... $10.00$ 5.00
Photo Copy of Draft (each) ...............................Foreign Check Fee ................................................ $10.00$ 3.00
Stop Payment on Draft .....................................Holiday Club Early Closure..................................... $ 5.00$10.00
Card Replacement ............................................Share Draft Protest ................................................. $20.00$10.00
Change of Personal Identification Number (PIN)Wire Transfers (incoming)....................................... $ 2.00n/c*
Wire Transfers (outgoing) ....................................... | $15.00
Rush Card Replacement Fee ...........................Transactions at ACCESS FCU ATMs..................... $55.00n/c*
Change of Personal Identification Number (PIN) .. | $ 2.00
Rush Card Replacement Fee.............................. | $50.00
Check Collection Fee ....................................... $ 20.00
Domestic Wire Transfers (incoming) ................ | n/c*
Foreign Check Fee ........................................... $ 25.00
Holiday Club Early Closure ............................... $ 5.00
Share Draft Protest ........................................... $ 20.00`;

describe("two different prices glued into one cell (#1912)", () => {
  it("ships under Knox v128 and guard v98", () => {
    expect(KNOX_RULES_STRATEGY.version).toBeGreaterThanOrEqual(128);
    expect(CATEGORY_GUARD_VERSION).toBeGreaterThanOrEqual(98);
  });

  it("finds a line whose only price is two different glued prices", () => {
    expect(gluedPricePair("Card Replacement .....Share Draft Protest ..... $20.00$10.00")).toBe(true);
    expect(gluedPricePair("Change of Personal Identification Number (PIN)Wire Transfers (incoming)..... $ 2.00n/c*")).toBe(true);
    expect(gluedPricePair("Copies (non-customer), per copy | $30.00$0.10")).toBe(true);
    expect(gluedPricePair("Check Collection Fee.....(per item, each time presented) ……. | $1,020.00$25.00")).toBe(true);
  });

  it("leaves a doubled price, a separated pair and a line with another price alone", () => {
    expect(gluedPricePair("Stop Payment In Branch - per itemStop Payment In Branch - per item | $30.00$30.00")).toBe(false);
    expect(gluedPricePair("Overdraft Fee | $30.00 | $35.00")).toBe(false);
    expect(gluedPricePair("Overdraft Fee $30.00 $35.00")).toBe(false);
    expect(gluedPricePair("Purchase of Card:Up to $500.00$500.01 - $1,000.00")).toBe(false);
    expect(gluedPricePair("Wire Transfers (outgoing) ..... | $15.00")).toBe(false);
    const clean = "Wire Transfers (outgoing) | $15.00\nOverdraft | $30.00";
    expect(withoutGluedPricePairs(clean)).toBe(clean);
  });

  it("empties only the glued lines", () => {
    const lines = withoutGluedPricePairs(ACCESS).split("\n");
    expect(lines).toHaveLength(ACCESS.split("\n").length);
    expect(lines.filter((line) => line === "")).toHaveLength(6);
    expect(lines).toContain("Change of Personal Identification Number (PIN) .. | $ 2.00");
  });

  it("gives Knox no fee from a glued line, and keeps the clean lines' fees", () => {
    const fees = reproducibleFees(ACCESS);
    for (const key of ["wire_domestic_incoming:200", "card_replacement:2000", "rush_card:5500", "stop_payment:1000", "stop_payment:500", "check_image:1000", "collection_item:1000"]) {
      expect(fees.has(key), key).toBe(false);
    }
    for (const key of ["rush_card:5000", "collection_item:2000", "wire_domestic_outgoing:1500", "early_closure:500", "dormant_account:500"]) {
      expect(fees.has(key), key).toBe(true);
    }
  });

  it("traces no live fee to a glued line in the shared source check", () => {
    for (const [key, name, amount] of [
      ["wire_domestic_incoming", "Change of Personal Identification Number (PIN)Wire Transfers (incoming)", 2],
      ["card_replacement", "Card Replacement Share Draft Protest", 20],
      ["rush_card", "Rush Card Replacement Fee Transactions at ACCESS FCU ATMs", 55],
      ["stop_payment", "Dormant Account Fee (annual) Stop Payment on Draft", 10],
      ["stop_payment", "Stop Payment on Draft Holiday Club Early Closure", 5],
      ["check_image", "Photo Copy of Draft (each) Foreign Check Fee", 10],
      ["collection_item", "Foreign Check Fee", 10],
    ] as const) {
      expect(checkFeeAgainstSource(ACCESS, name, amount, ".", key).ok, `${key} ${amount}`).toBe(false);
    }
    expect(checkFeeAgainstSource(ACCESS, "Rush Card Replacement Fee", 50, ".", "rush_card").ok).toBe(true);
    expect(checkFeeAgainstSource(ACCESS, "Foreign Check Fee", 25, ".", "collection_item").ok).toBe(true);
  });
});

describe("guard v98: a rejected wire is a correction, not a wire price (#1912)", () => {
  it("fails a rejected wire under every wire type", () => {
    expect(checkFeeCategory("wire_intl_outgoing", "Foreign Wire Reject").ok).toBe(false);
    expect(checkFeeCategory("wire_domestic_outgoing", "Rejected Outgoing Wire").ok).toBe(false);
    expect(checkFeeCategory("wire_domestic_incoming", "Incoming Wire Rejected").ok).toBe(false);
  });

  it("keeps the bank's wire prices", () => {
    expect(checkFeeCategory("wire_intl_outgoing", "Foreign Wire Transfer (eBranch form)").ok).toBe(true);
    expect(checkFeeCategory("wire_domestic_outgoing", "Domestic Wire Transfer (eBranch form)").ok).toBe(true);
    expect(checkFeeCategory("wire_domestic_incoming", "Domestic Wire Transfers (incoming)").ok).toBe(true);
  });
});
