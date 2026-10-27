import { describe, expect, it } from "vitest";

import { reproducibleFees } from "@/lib/agents/hamilton/rules-recheck";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { valuePerInstitution } from "@/lib/data-store/fee-stats";
import { KNOX_RULES_STRATEGY, runFreeSpecialists } from "./specialists";
import { wireChannelClause, withWireChannelClause } from "./wire-channel-clause";

// #1912: agent_source_texts 21982 (institution 7711, document 24816; text 83 of document 12704 is the
// same page), the wire rows as stored. Two price columns of a flattened PDF share each line.
const PHONE_REQUEST = [
  "Limitations Apply | Incoming Wire Transfer $10.00 per wire",
  "Outgoing Domestic Wire Transfer $25.00 - in person or recurring agreement request",
  "High Yield Check Fee $.10 each + tax Outgoing Domestic Wire Transfer $30.00 - phone request",
  "(After first 20 per month at no charge) | Outgoing Foreign Wire Transfer $50.00 - in person or recurring agreement request",
  "Money Order Fee $3.00 each",
].join("\n");

// #1912: agent_source_texts 36830 (institution 4366, document 38548), as stored.
const RECURRING_NEW = [
  "Official Check | $5.00",
  "",
  "Outgoing Domestic Wire fee | $15.00 Recurring / $25.00 New",
  "",
  "Re-Open Account (if re-opened within 45 days) | $15.00",
].join("\n");

// #1912: Sound Community Bank (institution 978), agent_source_texts 2527, document 14765, as stored.
const SOUND_COMMUNITY = [
  "Statement Copy $5.00 per copy",
  "Incoming Domestic & International: $15.00",
  "Outgoing Domestic: $30.00",
  "Wire Transfers | Outgoing Domestic - Not in Person: $60.00",
  "Outgoing International: $45.00 plus international wire fee",
  "assessed by correspondent bank",
  "November 2024 Page 1 of 2",
].join("\n");

const wireReads = (text: string) => runFreeSpecialists(text).candidates
  .filter((read) => read.canonicalHint.startsWith("wire_"))
  .map((read) => `${read.canonicalHint} ${read.amount} ${read.feeName}`);

/** The bank's value for one wire category over Knox's reads, as statistics rule 11 sets it. */
function wireValue(text: string, category: string): number | undefined {
  const rows = runFreeSpecialists(text).candidates
    .filter((read) => read.canonicalHint === category)
    .map((read) => ({ institution_id: 1, amount: read.amount, fee_category: category, fee_name: read.feeName }));
  return valuePerInstitution(rows).get(1);
}

describe("a wire's channel printed after its price (Knox v134, #1912)", () => {
  it("bumps the rules strategy so Hamilton's rules re-check revisits live documents", () => {
    expect(KNOX_RULES_STRATEGY.version).toBeGreaterThanOrEqual(134);
  });

  it("names the phone request's price with its channel, and leaves the in-person price general", () => {
    expect(wireReads(PHONE_REQUEST)).toEqual(expect.arrayContaining([
      "wire_domestic_outgoing 25 Outgoing Domestic Wire Transfer",
      "wire_domestic_outgoing 30 Outgoing Domestic Wire Transfer (phone request)",
    ]));
    // Rule 11: the bank's domestic wire value is its general $25, not the $27.50 blend.
    expect(wireValue(PHONE_REQUEST, "wire_domestic_outgoing")).toBe(25);
  });

  it("names a recurring wire's price as recurring", () => {
    expect(wireReads(RECURRING_NEW)).toContain("wire_domestic_outgoing 15 Outgoing Domestic Wire fee (Recurring)");
  });

  it("traces every new name on the stored text with the shared source check", () => {
    expect(checkFeeAgainstSource(PHONE_REQUEST, "Outgoing Domestic Wire Transfer (phone request)", 30, ".", "wire_domestic_outgoing")).toMatchObject({ ok: true });
    expect(checkFeeAgainstSource(RECURRING_NEW, "Outgoing Domestic Wire fee (Recurring)", 15, ".", "wire_domestic_outgoing")).toMatchObject({ ok: true });
  });

  it("reproduces the same fees for the rules re-check: only names change", () => {
    expect(reproducibleFees(PHONE_REQUEST)).toEqual(new Set(["wire_domestic_incoming:1000", "wire_domestic_outgoing:2500", "wire_domestic_outgoing:3000", "wire_intl_outgoing:5000", "money_order:300"]));
    expect(reproducibleFees(RECURRING_NEW)).toContain("wire_domestic_outgoing:1500");
  });

  it("sets Sound Community's not-in-person wire aside, so its value is the standard $30", () => {
    expect(wireReads(SOUND_COMMUNITY)).toEqual(expect.arrayContaining([
      "wire_domestic_outgoing 30 Wire Transfers: Outgoing Domestic",
      "wire_domestic_outgoing 60 Wire Transfers: Outgoing Domestic - Not in Person",
    ]));
    expect(wireValue(SOUND_COMMUNITY, "wire_domestic_outgoing")).toBe(30);
  });
});

describe("wireChannelClause", () => {
  const OUT = "wire_domestic_outgoing";

  it("reads the channel words right after the fee's own price", () => {
    expect(wireChannelClause("Outgoing Domestic Wire Transfer $30.00 - phone request", "Outgoing Domestic Wire Transfer", 30, OUT)).toBe("phone request");
    expect(wireChannelClause("Outgoing Domestic Wire fee | $15.00 Recurring / $25.00 New", "Outgoing Domestic Wire fee", 15, OUT)).toBe("Recurring");
    expect(wireChannelClause("Outgoing Wire | $20.00 (online)", "Outgoing Wire", 20, OUT)).toBe("online");
    expect(wireChannelClause("Outgoing Wire $45.00 – not in person", "Outgoing Wire", 45, OUT)).toBe("not in person");
  });

  it("reads nothing for the standard channel, a mixed clause, a unit or a long note", () => {
    for (const line of [
      "Outgoing Wire $25.00 - in person or recurring agreement request",
      "Outgoing Wire $25.00 per wire",
      "Outgoing Wire $25.00 in branch",
      "Outgoing Wire $25.00 plus any fee the receiving bank charges for wires sent online",
      "Outgoing Wire $25.00",
    ]) {
      expect(wireChannelClause(line, "Outgoing Wire", 25, OUT), line).toBeNull();
    }
  });

  it("reads nothing where the words may be the next price's label or another fee (stored lines, prod)", () => {
    const cases: Array<[string, string, number]> = [
      // text 18401: the label comes before each price.
      ["Outgoing Domestic: ------------------ In-Person - $30.00 Fax/Manual - $75.00", "Outgoing Domestic: In-Person", 30],
      ["Incoming Wires: | $12.00 Email or Fax Confirmation: $5.00 per wire", "Incoming Wires", 12],
      // text 20334: the online wire is the next fee.
      ["| Wire Transfer | Incoming $15.00 Outgoing $25.00 Online Outgoing Wire Transfer $25.00 International $60.00 |", "Wire Transfer: Outgoing", 25],
      // text 36352: "Recurring" labels the $15 printed after it.
      ["Wire Transfer Fees (Outgoing) | One time - $20 Recurring - $15 (signed agreement)", "Wire Transfer Fees (Outgoing)", 20],
      // text 27277: another service, priced "Free".
      ["Wire Transfer (Outgoing) - $25.00 E-mail Alerts - Free", "Wire Transfer (Outgoing)", 25],
      // text 11977: both channels at one price is the general price.
      ["Outgoing wire – Domestic | $20 (Online or Branch Assisted)", "Outgoing wire – Domestic", 20],
      // Live wire fees 24971, 47717, 89928, 147510, 128316: the words after the price are another
      // service, a sentence or a condition, not the wire's channel.
      ["Outgoing Wire Transfer $20 Pay Anyone service in online banking", "Outgoing Wire Transfer", 20],
      ["Outgoing Domestic USA Wire Transfer $35.00 CuCheck Card - PIN-based Withdrawals,", "Outgoing Domestic USA Wire Transfer", 35],
      ["Wire Transfer Fee- International $45.00 Use Online BillPay, HonorPay or Account-To-Account Transfers", "Wire Transfer Fee- International", 45],
      ["Wire Transfer | $33/$15 each Outgoing Wires processed by the Branch $33. Online Banking outgoing wires", "Wire Transfer - Outgoing (Branch)", 33],
      ["(Outgoing Wire Transfers for Treasury Management Customers can be reduced by $10.00 if completed through Online Banking)", "Outgoing Wire Transfers for Treasury Management Customers can be reduced by", 10],
      ["Outgoing Wire $25.00 Online Banking", "Outgoing Wire", 25],
      // Review of #2761: bare words after the last price, with no dash, colon or bracket tying them to
      // it, may be the next row's label on a flattened two-column page.
      ["Outgoing Wire $25.00 Phone Inquiry", "Outgoing Wire", 25],
      ["Outgoing Wire $25.00 Mobile Wallet", "Outgoing Wire", 25],
      ["Outgoing Wire $25.00 Online Wire", "Outgoing Wire", 25],
      ["Outgoing Wire $25.00 Fax Number 555-1212", "Outgoing Wire", 25],
    ];
    for (const [line, name, amount] of cases) expect(wireChannelClause(line, name, amount, OUT), line).toBeNull();
  });

  it("reads nothing off another fee's price, another category, or a name that already says its channel", () => {
    // The phone words follow the $55 foreign wire, not the $50 domestic one.
    expect(wireChannelClause("Outgoing Domestic Wire $50.00 Outgoing Foreign Wire $55.00 - phone request", "Outgoing Domestic Wire", 50, OUT)).toBeNull();
    expect(wireChannelClause("Stop Payment $30.00 - phone request", "Stop Payment", 30, "stop_payment")).toBeNull();
    expect(withWireChannelClause("Online Outgoing Wire $15.00 (online)", "Online Outgoing Wire", 15, OUT)).toBe("Online Outgoing Wire");
    expect(withWireChannelClause("Outgoing Wire $30.00 - phone request", "Outgoing Wire", 30, OUT)).toBe("Outgoing Wire (phone request)");
  });
});
