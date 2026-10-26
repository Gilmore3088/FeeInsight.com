import { describe, expect, it } from "vitest";

import { reproducibleFees } from "@/lib/agents/hamilton/rules-recheck";
import { centeredHeadingRows, withCenteredHeadingCells } from "@/lib/custom-report/centered-heading-cell";
import { sourceOwnedWireScope } from "@/lib/custom-report/own-wire-scope";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { withCenteredBlockHeadings } from "./rules";
import { KNOX_RULES_STRATEGY, runFreeSpecialists } from "./specialists";

// #1912: Sound Community Bank (institution 978), agent_source_texts 2527, document 14765, as stored.
// "Wire Transfers" is a vertically centred merged cell; the PDF reader printed it on the middle row.
const SOUND_COMMUNITY = [
  "Statement Copy $5.00 per copy",
  "Incoming Domestic & International: $15.00",
  "Outgoing Domestic: $30.00",
  "Wire Transfers | Outgoing Domestic - Not in Person: $60.00",
  "Outgoing International: $45.00 plus international wire fee",
  "assessed by correspondent bank",
  "November 2024 Page 1 of 2",
].join("\n");

const reads = (text: string) => runFreeSpecialists(text).candidates.map((read) => `${read.canonicalHint} ${read.amount} ${read.feeName}`);

describe("a heading in a vertically centred merged cell (Knox v130, #1912)", () => {
  it("bumps the rules strategy so Hamilton's rules re-check revisits live documents", () => {
    expect(KNOX_RULES_STRATEGY.version).toBe(130);
  });

  it("lends the middle row's heading to its sibling rows above and below", () => {
    expect(withCenteredBlockHeadings(SOUND_COMMUNITY).split("\n")).toEqual([
      "Statement Copy $5.00 per copy",
      "Wire Transfers | Incoming Domestic & International: $15.00",
      "Wire Transfers | Outgoing Domestic: $30.00",
      "Wire Transfers | Outgoing Domestic - Not in Person: $60.00",
      "Wire Transfers | Outgoing International: $45.00 plus international wire fee",
      "assessed by correspondent bank",
      "November 2024 Page 1 of 2",
    ]);
  });

  it("reads the bank's $30 outgoing wire beside the $60 not-in-person one, and its $45 international wire", () => {
    const fees = reproducibleFees(SOUND_COMMUNITY);
    expect(fees).toContain("wire_domestic_outgoing:3000");
    expect(fees).toContain("wire_domestic_outgoing:6000");
    expect(fees).toContain("wire_intl_outgoing:4500");
    expect(fees).toContain("document_reproduction:500");
    expect(reads(SOUND_COMMUNITY)).toEqual(expect.arrayContaining([
      "wire_domestic_outgoing 30 Wire Transfers: Outgoing Domestic",
      "wire_domestic_outgoing 60 Wire Transfers: Outgoing Domestic - Not in Person",
      "wire_intl_outgoing 45 Wire Transfers: Outgoing International",
    ]));
  });

  it("reads the shared incoming row as Knox reads any 'Domestic & International' wire, and Darwin's guard decides it", () => {
    // v18 files one price for "Domestic & International" as the domestic wire; the category guard refuses a
    // domestic wire whose name says International, so it is not among the fees Darwin would accept. The
    // row now reads at all; how a shared price publishes is a separate question (finding 2026-10-26).
    expect(reads(SOUND_COMMUNITY)).toContain("wire_domestic_incoming 15 Wire Transfers: Incoming Domestic & International");
    expect(reproducibleFees(SOUND_COMMUNITY)).not.toContain("wire_domestic_incoming:1500");
    expect(reproducibleFees(SOUND_COMMUNITY)).not.toContain("wire_intl_incoming:1500");
  });

  it("traces each borrowed row's read on the stored text with the shared source check", () => {
    for (const [name, amount] of [["Wire Transfers: Outgoing Domestic", 30], ["Wire Transfers: Outgoing International", 45], ["Wire Transfers: Outgoing Domestic - Not in Person", 60]] as const) {
      expect(checkFeeAgainstSource(SOUND_COMMUNITY, name, amount, "wire")).toMatchObject({ ok: true });
    }
    // The $30 is not the not-in-person wire's price.
    expect(checkFeeAgainstSource(SOUND_COMMUNITY, "Wire Transfers: Outgoing Domestic - Not in Person", 30, "wire").ok).toBe(false);
  });

  it("keeps an international wire's scope when its price adds the same wire's correspondent fee", () => {
    expect(sourceOwnedWireScope(SOUND_COMMUNITY, "Wire Transfers: Outgoing International", 45)).toMatchObject({
      kind: "owned", geography: "international", directions: ["outgoing"],
    });
    // A tail naming another scope than the row's own still leaves the scope unresolved.
    expect(sourceOwnedWireScope("Wire Transfers\nOutgoing: $25.00 plus international fee", "Wire Transfers: Outgoing", 25).kind).toBe("unresolved");
  });

  it("never lends the heading into a neighbouring section under its own heading", () => {
    const text = [
      "Stop Payments",
      "Online: $20.00",
      "Wire Transfers | Outgoing Domestic: $30.00",
      "Outgoing International: $45.00",
    ].join("\n");
    expect(withCenteredBlockHeadings(text).split("\n")[1]).toBe("Online: $20.00");
    const fees = reproducibleFees(text);
    expect(fees).toContain("stop_payment:2000");
    expect(fees).not.toContain("wire_domestic_outgoing:2000");
    expect(fees).toContain("wire_intl_outgoing:4500");
  });

  it("never lends the heading to a row that names its own fee, nor past it", () => {
    const text = [
      "Outgoing International: $50.00",
      "Check Printing: $15.00",
      "Outgoing Domestic: $25.00",
      "Wire Transfers | Outgoing Domestic - Not in Person: $60.00",
      "Outgoing International: $45.00",
    ].join("\n");
    const lent = withCenteredBlockHeadings(text).split("\n");
    expect(lent.slice(0, 2)).toEqual(["Outgoing International: $50.00", "Check Printing: $15.00"]);
    expect(lent[2]).toBe("Wire Transfers | Outgoing Domestic: $25.00");
    expect(reproducibleFees(text)).not.toContain("wire_intl_outgoing:5000");
  });

  it("leaves a block that is not centred, and a row two middle rows both reach, unlent", () => {
    const lopsided = [
      "Outgoing Domestic: $25.00",
      "Incoming Domestic: $10.00",
      "Outgoing International: $40.00",
      "Wire Transfers | Outgoing Domestic - Not in Person: $60.00",
    ].join("\n");
    expect(withCenteredHeadingCells(lopsided)).toBe(lopsided);
    const shared = [
      "Wire Transfers | Outgoing Domestic: $30.00",
      "Outgoing International: $45.00",
      "Wire Services | Outgoing International - Online: $40.00",
    ];
    expect(centeredHeadingRows(shared).has(1)).toBe(false);
  });

  it("lends nothing when the heading names no fee family or the middle row names its own fee", () => {
    const notAFee = ["Outgoing Domestic: $30.00", "November | Outgoing Domestic - Not in Person: $60.00", "Outgoing International: $45.00"].join("\n");
    expect(withCenteredBlockHeadings(notAFee)).toBe(notAFee);
    const ownFee = ["Outgoing Domestic: $30.00", "Wire Transfers | Stop Payment: $60.00", "Outgoing International: $45.00"].join("\n");
    expect(withCenteredBlockHeadings(ownFee)).toBe(ownFee);
  });

  // agent_source_texts 7728, as stored: a two-column page read across. "OVERDRAFT PRIVILEGE" is the left
  // column's heading beside the right column's wire row, not a centred cell over "Outgoing Domestic".
  const TWO_COLUMN = [
    "• $2.50/item. Call Center assisted or automatic overdraft. | WIRE TRANSFERS",
    "Outgoing Domestic: $30",
    "OVERDRAFT PRIVILEGE | Outgoing International: $50",
    "Checks, ACH, Point-of-Sale, ATM, withdrawals, in-person | Incoming: $15",
  ].join("\n");

  it("lends no heading to a row under a line whose last cell is a heading (two-column page, text 7728)", () => {
    expect(centeredHeadingRows(TWO_COLUMN.split("\n")).size).toBe(0);
    expect(withCenteredHeadingCells(TWO_COLUMN)).toBe(TWO_COLUMN);
    expect(reads(TWO_COLUMN).some((read) => read.includes("OVERDRAFT PRIVILEGE | Outgoing Domestic"))).toBe(false);
    expect(checkFeeAgainstSource(TWO_COLUMN, "OVERDRAFT PRIVILEGE | Outgoing Domestic", 30, ".", "overdraft").ok).toBe(false);
  });
});
