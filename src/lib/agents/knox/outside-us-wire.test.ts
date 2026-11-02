import { describe, expect, it } from "vitest";
import { namesWireOutsideUs, wireOutsideUsWords } from "@/lib/fee-fold";
import { checkFeeCategory, ownLabelOnLine, refileCategory, refileFromLine } from "@/lib/fee-category-guard";
import { restoreTarget } from "@/lib/agents/hamilton/category-guard";
import { sourceOwnedWireScope, wireScopeFacts } from "@/lib/custom-report/own-wire-scope";
import { extractCandidatesFromText } from "./rules";

// Prod sample, Nov 2: Bank Orion (institution 1399, agent_source_texts 18914, rewards checking
// disclosure) prints both outgoing wire prices on their own rows; Knox v157 filed both as the domestic
// outgoing wire and the $50 went live as 95508 (published name "Outgoing wire transfer fee").
const BANK_ORION = `Revoke unauthorized ACH debit | No charge

Incoming wire transfer fee | $25.00

Outgoing wire transfer fee (if transfer will be initially processed through a U.S. bank) | $25.00

Outgoing wire transfer fee (if transfer will not be initially processed through a U.S. bank) | $50.00

Garnishments | $75.00`;
const NOT_US_NAME = "Outgoing wire transfer fee (if transfer will not be initially processed through a U.S. bank)";
const US_NAME = "Outgoing wire transfer fee (if transfer will be initially processed through a U.S. bank)";
const note = (line: string) => `Knox deterministic extraction from Rosetta artifact #18914. canonical_hint=wire_domestic_outgoing; excerpt="${line}"`;

describe("a wire its own words send outside the U.S. (fee 95508)", () => {
  it("reads the outside-the-U.S. words, never the affirmative domestic row", () => {
    expect(wireOutsideUsWords(NOT_US_NAME)).toBe("not be initially processed through a U.S. bank");
    expect(wireOutsideUsWords(US_NAME)).toBeNull();
    // Live names of the same class (Nov 2 dry run).
    for (const name of ["Wire Transfer – Out of USA", "Outgoing Wire Out of Country", "WIRE TRANSFER: NON U.S. IN/OUT",
      "Wire transfer via Digital Banking sent outside the US and its territories | Outgoing wire transfers in USD"]) {
      expect(namesWireOutsideUs(name), name).toBe(true);
    }
    // One price that also says domestic or within the U.S., a place the member lives, an unavailable service.
    for (const name of ["Wire Transfer – Domestic (within U.S.)", "Domestic Wire (Within United States) We do not wire funds to Western Union",
      "Outgoing wires within the USA", "Wire Transfer (outgoing, domestic U.S.)", "Outgoing wire for members residing outside the U.S.",
      "Wire transfers outside of U.S. not available", "Out-going Wire (domestic): A wire transfer that you send from your account to another U.S. bank account via not going th",
      "Wire transfer - outgoing domestic U.S. dollar", "Wire Out (USA)"]) {
      expect(namesWireOutsideUs(name), name).toBe(false);
    }
  });

  it("Knox reads the $50 row as the international outgoing wire and the $25 row as domestic", () => {
    const reads = extractCandidatesFromText(BANK_ORION).candidates.filter((read) => /wire/i.test(read.feeName));
    expect(reads.map((read) => [read.amount, read.canonicalHint])).toEqual([
      [25, "wire_domestic_incoming"],
      [25, "wire_domestic_outgoing"],
      [50, "wire_intl_outgoing"],
    ]);
  });

  it("the guard refuses it as domestic and re-files it to the international wire", () => {
    const verdict = checkFeeCategory("wire_domestic_outgoing", NOT_US_NAME);
    expect(verdict.ok).toBe(false);
    expect(refileCategory("wire_domestic_outgoing", NOT_US_NAME)).toBe("wire_intl_outgoing");
    expect(checkFeeCategory("wire_intl_outgoing", NOT_US_NAME).ok).toBe(true);
    expect(checkFeeCategory("wire_domestic_outgoing", US_NAME).ok).toBe(true);
    expect(refileCategory("wire_domestic_outgoing", "Wire Transfer – Out of USA")).toBe("wire_intl_outgoing");
  });

  it("reads the live fee's own label on its stored line when the published name dropped the note", () => {
    const live = { amount: "50.00", conditions: note("Outgoing wire transfer fee (if transfer will not be initially processed through a U.S. bank) | $50.00") };
    expect(ownLabelOnLine(live)).toBe("Outgoing wire transfer fee (if transfer will not be initially processed through a U.S. bank) | ");
    const verdict = checkFeeCategory("wire_domestic_outgoing", "Outgoing wire transfer fee", live);
    expect(verdict).toMatchObject({ ok: false, code: "schedule_contradicts" });
    expect(refileFromLine("wire_domestic_outgoing", "Outgoing wire transfer fee", live)).toBe("wire_intl_outgoing");
    expect(restoreTarget({ canonical_fee_key: "wire_domestic_outgoing", fee_name: "Outgoing wire transfer fee", ...live, document_nsf_amount: null }))
      .toBe("wire_intl_outgoing");
    // Its $25 domestic twin (95507) stays.
    const domestic = { amount: "25.00", conditions: note("Outgoing wire transfer fee (if transfer will be initially processed through a U.S. bank) | $25.00") };
    expect(checkFeeCategory("wire_domestic_outgoing", "Outgoing wire transfer fee", domestic).ok).toBe(true);
  });

  it("never reads the next row's note after the price (56618, Nov 2 dry run)", () => {
    const live = { amount: "15.00", conditions: note("Incoming Wire Transfer Fee | $15.00 | Non-US Century ATM Charge | $3.00") };
    expect(checkFeeCategory("wire_domestic_incoming", "Incoming Wire Transfer Fee", live).ok).toBe(true);
  });

  it("a published name that says domestic is not moved by its line", () => {
    const live = { amount: "45.00", conditions: note("Wire Transfer – | $45.00 Charge for outgoing wire transfers to a destination outside of the United States. Additional") };
    expect(checkFeeCategory("wire_domestic_outgoing", "Domestic: Wire Transfer", live).ok).toBe(true);
  });

  it("Darwin's own-scope read states the row international, so the re-filed fee keeps its direction proof", () => {
    expect(wireScopeFacts(NOT_US_NAME)).toEqual({ geography: "international", directions: ["outgoing"] });
    expect(wireScopeFacts(US_NAME)).toEqual({ geography: "unspecified", directions: ["outgoing"] });
    const scope = sourceOwnedWireScope(BANK_ORION, NOT_US_NAME, 50);
    expect(scope).toMatchObject({ kind: "owned", geography: "international", directions: ["outgoing"] });
  });

  it("never reads a neighbouring row's label as the fee's own (review of #2926)", () => {
    const at = (line: string) => ownLabelOnLine({ conditions: `excerpt=${line}`, amount: 25 });
    expect(namesWireOutsideUs(at("Outgoing Wire Out of Country | No Charge | Outgoing Wire | $25.00") ?? "")).toBe(false);
    expect(namesWireOutsideUs(at("Outgoing Wire Out of Country 50.00 Outgoing Wire $25.00") ?? "")).toBe(false);
    expect(at("Outgoing wire (not processed through a U.S. bank) $25.00 Outgoing wire (processed through a U.S. bank) $25.00")).toBeNull();
  });
});
