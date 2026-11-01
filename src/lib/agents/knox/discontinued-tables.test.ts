import { describe, expect, it } from "vitest";
import { discontinuedLines, discontinuedRow, withoutDiscontinuedLines } from "@/lib/custom-report/discontinued-rows";
import { discontinuedTablesLive, flagDiscontinuedTables, KNOX_DISCONTINUED_TABLES_SWITCH } from "./discontinued-tables";
import { runFreeSpecialists } from "./specialists";

// #2070: Knox flags a discontinued account's table before it reads the text.
const SCHEDULE = [
  "Personal Checking",
  "Essential Checking | Monthly Fee | $6.00",
  "Stop Payment | $32.00",
  "",
  "Legacy Accounts",
  "Gold Checking",
  "Monthly Fee | $15.00",
  "Paper Statement | $3.00",
  "",
  "Wire Transfers",
  "Outgoing Domestic Wire | $25.00",
  "Basic Savings Monthly Service Charge (80 Suffix) | $5.00 (this account no longer offered)",
].join("\n");

const GBC = [
  "The following accounts are no longer offered but will continue to be served to",
  "Bill Pay activity occurs in any 60 day period.",
  "existing customers.",
  "- Mobile Banking: available via our free iOS or Android apps, in addition to our",
  "Essential Business Checking | responsive mobile website.",
  "Minimum deposit to open: $50.00 | ATM Service Fees:",
  "Minimum Balance Requirement: None | - ATM cash withdrawals: $1.00 at ATMs not owned or operated by GBC Bank",
  "Monthly Maintenance Charge: None | or Visa Plus Alliance.",
].join("\n");

const NAMED_PRICES: Array<{ text: string; fees: Array<[string, number]> }> = [
  { text: SCHEDULE, fees: [["Monthly Fee", 6], ["Stop Payment", 32], ["Monthly Fee", 15], ["Paper Statement", 3], ["Outgoing Domestic Wire", 25], ["Basic Savings Monthly Service Charge (80 Suffix)", 5]] },
  { text: GBC, fees: [["ATM cash withdrawals", 1]] },
  { text: "Current Accounts\nStop Payment | $35.00\n\nLegacy Accounts\nStop Payment | $35.00", fees: [["Stop Payment", 35]] },
  { text: "Wire Transfer Fees\nDomestic Outgoing | $35.00 per wire | 10. Account type no longer offered.", fees: [["Domestic Outgoing", 35]] },
  { text: "Annual Fee | $15\nApplies only to certain accounts no longer offered | Cashier’s Check Account Holder $5", fees: [["Cashier’s Check Account Holder", 5]] },
  { text: "Monthly Fee | $10.00 (waived for grandfathered accounts)", fees: [["Monthly Fee", 10]] },
  { text: "ATM Fees\nNon-PNC ATM withdrawal | $3.00 | Check deposits are no longer available at PNC ATMs.", fees: [["Non-PNC ATM withdrawal", 3]] },
  { text: "Legacy Accounts\nGold Checking Monthly Fee $10.00\nWire Transfers\nIncoming Wire $15.00", fees: [["Gold Checking Monthly Fee", 10], ["Incoming Wire", 15]] },
  { text: "GRANDFATHERED ACCOUNTS AND FEES\nCourtesy Pay Fee | $25 for Elevated Checking\nElevated Checking | $7 per month", fees: [["Courtesy Pay Fee", 25], ["Elevated Checking", 7]] },
  { text: "Legacy Accounts\nOvernight Courier Service\n$50.00\n\nOvernight Courier Service\n$40.00", fees: [["Overnight Courier Service", 50], ["Overnight Courier Service", 40]] },
];

describe("discontinuedLines (#2070, before extract)", () => {
  it("flags a legacy section's rows and a row marked on its own price, and nothing else", () => {
    const lines = discontinuedLines(SCHEDULE);
    expect(lines.map((line) => [line.text, line.why])).toEqual([
      ["Monthly Fee | $15.00", "legacy_section"],
      ["Paper Statement | $3.00", "legacy_section"],
      ["Basic Savings Monthly Service Charge (80 Suffix) | $5.00 (this account no longer offered)", "row_marker"],
    ]);
    expect(lines[0].heading).toBe("Legacy Accounts");
  });

  it("drops a row only when the shared check refuses every fee it prices", () => {
    for (const { text, fees } of NAMED_PRICES) {
      const kept = withoutDiscontinuedLines(text);
      for (const [name, amount] of fees) {
        const stillPrinted = kept.split("\n").some((line) => line.includes(`$${amount}`) || line.includes(`$${amount}.00`));
        // A fee the shared check keeps current is still printed in the text Knox reads.
        if (discontinuedRow(text, name, amount) == null) expect([name, amount, stillPrinted]).toEqual([name, amount, true]);
      }
    }
  });

  it("never takes a two-column line's other item (GBC Bank, fee 14202)", () => {
    expect(withoutDiscontinuedLines(GBC)).toContain("ATM cash withdrawals: $1.00");
    expect(withoutDiscontinuedLines(GBC)).toContain("ATM Service Fees:");
  });

  it("takes a bare price printed under its name with its name line", () => {
    const text = "Legacy Accounts\nOvernight Courier Service\n$50.00\n\nOvernight Courier Service\n$40.00";
    expect(withoutDiscontinuedLines(text)).toBe("Legacy Accounts\n\nOvernight Courier Service\n$40.00");
  });

  it("leaves a text with no marker word alone", () => {
    const text = "Fee Schedule\nStop Payment | $30.00";
    expect(discontinuedLines(text)).toEqual([]);
    expect(withoutDiscontinuedLines(text)).toBe(text);
  });
});

describe("Knox's discontinued table switch (#2070)", () => {
  it("is off unless set to 1 or true", () => {
    expect(discontinuedTablesLive({})).toBe(false);
    expect(discontinuedTablesLive({ [KNOX_DISCONTINUED_TABLES_SWITCH]: "" })).toBe(false);
    expect(discontinuedTablesLive({ [KNOX_DISCONTINUED_TABLES_SWITCH]: "no" })).toBe(false);
    expect(discontinuedTablesLive({ [KNOX_DISCONTINUED_TABLES_SWITCH]: " \"TRUE\" " })).toBe(true);
    expect(discontinuedTablesLive({ [KNOX_DISCONTINUED_TABLES_SWITCH]: "1" })).toBe(true);
    expect(discontinuedTablesLive()).toBe(false);
  });

  it("off, flags and counts but reads the text unchanged", () => {
    const { text, flag } = flagDiscontinuedTables(SCHEDULE, false);
    expect(text).toBe(SCHEDULE);
    expect(flag).toEqual({ flagged: 3, removed: 0, headings: ["Legacy Accounts"], rowMarkers: 1 });
  });

  it("on, the flagged rows are neither read nor held; off, they are read and the self-check holds them", () => {
    const legacy = (amount: number) => (row: { amount: number | null }) => row.amount === amount;
    const off = runFreeSpecialists(SCHEDULE, { withoutDiscontinuedTables: false });
    const on = runFreeSpecialists(SCHEDULE, { withoutDiscontinuedTables: true });
    expect(off.discontinuedRows.flagged).toBe(3);
    expect(on.discontinuedRows.removed).toBe(3);
    // Off: the legacy $15 and $3 rows reach the self-check, which refuses them (held untraced).
    expect(off.candidates.some(legacy(15)) || off.candidates.some(legacy(3))).toBe(false);
    expect(off.held.some((row) => row.shape === "untraced" && (row.amount === 15 || row.amount === 3))).toBe(true);
    // On: nothing of theirs is read or held.
    expect([...on.candidates, ...on.held].some((row) => row.amount === 15 || row.amount === 3 || row.amount === 5)).toBe(false);
    // The current rows read the same either way.
    const current = (result: typeof on) => result.candidates.filter((row) => [6, 32, 25].includes(row.amount)).map((row) => `${row.canonicalHint}:${row.amount}`).sort();
    expect(current(on)).toEqual(current(off));
    expect(current(on).length).toBeGreaterThan(0);
  });
});
