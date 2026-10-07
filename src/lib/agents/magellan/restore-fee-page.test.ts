import { describe, expect, it, vi } from "vitest";

import { namesFeeSchedulePage, restoreSwappedFeePages, RESTORE_FEE_PAGE_STRATEGY } from "./restore-fee-page";

type DbMock = ReturnType<typeof vi.fn>;

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

// Shaped like the prod rows: a "Fee Schedule" page set aside for reading no amounts,
// replaced by a checking page or a time-deposit disclosure.
const rows = [
  {
    institution_id: 1122,
    current_url: "http://www.bogotasavingsbank.com/checking",
    fee_url: "https://www.bogotasavingsbank.com/fee-schedule",
    reason: "No fee lines and only 0 dollar amounts: not a fee schedule",
    current_live_fees: 0,
  },
  {
    institution_id: 4254,
    current_url: "https://www.fiveriversbank.com/documents/truth-in-savings-12-month-time-deposit-disclosure",
    fee_url: "https://www.fiveriversbank.com/fee-schedule",
    reason: "Page is built by JavaScript and no free route reads it; handed to Magellan's paid finder",
    current_live_fees: 0,
  },
  {
    institution_id: 242,
    current_url: "https://shoreunitedbank.com/personal/banking/savings-accounts",
    fee_url: "https://www.shoreunitedbank.com/shore-articles/understanding-bank-fees",
    reason: "No fee lines and only 0 dollar amounts: not a fee schedule",
    current_live_fees: 0,
  },
  {
    institution_id: 566,
    current_url: "https://www.cf.bank/Personal/Personal-Banking/Checking",
    fee_url: "https://www.cf.bank/Personal/Personal-Banking/Overview/fees",
    reason: "No fee lines and only 0 dollar amounts: not a fee schedule",
    current_live_fees: 12,
  },
];

function createDb(): DbMock {
  return vi.fn((strings: TemplateStringsArray) => {
    const text = templateText(strings);
    if (text.includes("fee pages swapped out after a blank read")) return Promise.resolve(rows);
    if (text.includes("UPDATE institution_sources")) return Promise.resolve([{ id: 1 }]);
    if (text.includes("FROM pipeline_attempts") || text.includes("FROM institution_playbooks")) return Promise.resolve([]);
    return Promise.resolve([]);
  });
}

const asDb = (db: DbMock) => db as unknown as Parameters<typeof restoreSwappedFeePages>[0]["db"];

function callsMatching(db: DbMock, needle: string): unknown[][] {
  return db.mock.calls.filter((call) => templateText(call[0]).includes(needle));
}

describe("namesFeeSchedulePage", () => {
  it("accepts links that name the schedule and refuses articles and marketing pages", () => {
    expect(namesFeeSchedulePage("https://www.bogotasavingsbank.com/fee-schedule")).toBe(true);
    expect(namesFeeSchedulePage("https://www.pnb.com/schedule-of-charges")).toBe(true);
    expect(namesFeeSchedulePage("https://dart.bank/rates-and-fees/")).toBe(true);
    expect(namesFeeSchedulePage("https://www.cf.bank/Personal/Personal-Banking/Overview/fees")).toBe(true);
    expect(namesFeeSchedulePage("https://www.shoreunitedbank.com/shore-articles/understanding-bank-fees")).toBe(false);
    expect(namesFeeSchedulePage("https://www.capecodfive.com/no-overdraft-fees-no-worries")).toBe(false);
  });
});

describe("restoreSwappedFeePages", () => {
  it("puts the fee page back, keeps a product page beside it, and logs each bank once", async () => {
    const db = createDb();
    const result = await restoreSwappedFeePages({ db: asDb(db), runId: 7 });

    expect(result.checked).toBe(4);
    expect(result.restored).toBe(2);
    expect(result.samples.map((sample) => sample.institutionId)).toEqual([1122, 4254]);

    const swaps = callsMatching(db, "UPDATE institution_sources");
    expect(swaps.map((call) => call[1])).toEqual([rows[0].fee_url, rows[1].fee_url]);

    // The checking page stays as a companion; the time-deposit disclosure does not.
    const companions = callsMatching(db, "INSERT INTO institution_additional_sources");
    expect(companions).toHaveLength(1);
    expect(companions[0]).toContain(rows[0].current_url);

    // Every bank checked gets an attempt row, so none is picked again at this version.
    const attempts = callsMatching(db, "INSERT INTO pipeline_attempts");
    expect(attempts).toHaveLength(4);
    for (const call of attempts) expect(call).toContain(RESTORE_FEE_PAGE_STRATEGY);
    expect(attempts.map((call) => call.find((value) => value === "ok" || value === "unchanged"))).toEqual([
      "ok",
      "ok",
      "unchanged",
      "unchanged",
    ]);
  });

  it("writes nothing on a dry run", async () => {
    const db = createDb();
    const result = await restoreSwappedFeePages({ db: asDb(db), runId: 7, dryRun: true });
    expect(result.restored).toBe(2);
    expect(callsMatching(db, "UPDATE institution_sources")).toHaveLength(0);
    expect(callsMatching(db, "INSERT INTO pipeline_attempts")).toHaveLength(0);
  });
});
