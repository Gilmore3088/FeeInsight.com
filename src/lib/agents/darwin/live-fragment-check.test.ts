import { describe, expect, it, vi } from "vitest";

import { isCutoffName, liveFragmentName } from "@/lib/agents/knox/name-retidy";

import {
  FRAGMENT_NAME_TAKEDOWN_LIVE,
  LIVE_FRAGMENT_BATCH,
  countLiveFragmentNames,
  findLiveFragments,
  liveFragmentCountSql,
  recheckLiveFragmentNames,
} from "./live-fragment-check";

// Institution 5314, row 58414 (#1443): the waived price of "ePLUS Checking Monthly service charge" $7.95.
const ROW_58414 = "or take advantage of both options to reduce your monthly fee to";

describe("liveFragmentName (live twin of isCutoffName)", () => {
  it.each([
    [ROW_58414, "sentence_end"],
    ["Overdraft fee charged per", "trailing_range"],
    ["Late Fee | Up to", "trailing_range"],
    ["NSF fee (ACH, ATM, or check) - per", "trailing_range"],
    ["Dormant accounts will be charged a monthly", "pronoun"],
    ["If you close your account within 90 days", "pronoun"],
    ["Inactive fee: This account may be subject to an Inactive fee of", "sentence_end"],
    ["Paper statement fee for the", "sentence_end"],
    ["+ $5.00 for each additional", "plus"],
  ])("takes %j down as %s", (name, pattern) => {
    expect(liveFragmentName(name)).toBe(pattern);
    // Every live match is also a publish-time cut-off name: the twin only narrows the hold.
    expect(isCutoffName(name)).toBe(true);
  });

  it.each([
    "N/A",
    "Check Printing N/A",
    "Loan Application, each",
    "my Value Checking",
    "Save Your Way",
    "Check Printing i.e. Deluxe",
    "Other services not listed above",
    "+Returned Item Fee – per item returned",
    "+ Stop Payment Fee",
    "ePLUS Checking Monthly service charge",
    "",
  ])("leaves %j live", (name) => {
    expect(liveFragmentName(name)).toBeNull();
  });

  it("reads a lower-case article as a fragment and the capital A of N/A as a name", () => {
    expect(liveFragmentName("Wire transfer fee for a")).toBe("sentence_end");
    expect(liveFragmentName("Wire Transfer Plan A")).toBeNull();
  });
});

type DbMock = ReturnType<typeof vi.fn>;

function dbFor(rows: Array<Record<string, unknown>>, cursor: string | null = null): DbMock {
  return vi.fn((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (text.includes("FROM agent_run_events")) return Promise.resolve(cursor == null ? [] : [{ next_after_id: cursor }]);
    if (text.includes("FROM published_fee_records")) return Promise.resolve(rows);
    if (text.includes("UPDATE published_fee_records")) return Promise.resolve(rows.filter((row) => liveFragmentName(row.fee_name as string)).map((row) => ({ fee_published_id: row.fee_published_id })));
    return Promise.resolve([]);
  });
}

const asDb = (db: DbMock) => db as unknown as Parameters<typeof recheckLiveFragmentNames>[0];

const ROWS = [
  { fee_published_id: "58414", fee_verified_id: "9001", institution_id: "5314", fee_name: ROW_58414, amount: "0.00" },
  { fee_published_id: "58415", fee_verified_id: "9002", institution_id: "5314", fee_name: "ePLUS Checking Monthly service charge", amount: "7.95" },
  { fee_published_id: "60001", fee_verified_id: null, institution_id: "77", fee_name: "Loan Application, each", amount: "25" },
  { fee_published_id: "60002", fee_verified_id: "9003", institution_id: "77", fee_name: "Late Fee | Up to", amount: "15" },
];

describe("Darwin live fragment re-check", () => {
  it("ships with the takedown off", () => {
    expect(FRAGMENT_NAME_TAKEDOWN_LIVE).toBe(false);
    expect(LIVE_FRAGMENT_BATCH).toBe(2_000);
  });

  it("counts by pattern with samples", () => {
    const found = findLiveFragments(ROWS);
    expect(found).toMatchObject({ checked: 4, matched: 2, byPattern: { sentence_end: 1, trailing_range: 1, pronoun: 0, plus: 0 } });
    expect(found.samples[0]).toEqual({ feePublishedId: 58414, feeVerifiedId: 9001, institutionId: 5314, feeName: ROW_58414, amount: 0, pattern: "sentence_end" });
  });

  it("in shadow reports what it would take down, records the cursor and writes no fee", async () => {
    const db = dbFor(ROWS, "58000");
    const result = await recheckLiveFragmentNames(asDb(db), { runId: 7, stepId: 70, dryRun: false });
    expect(result).toMatchObject({ live: false, checked: 4, matched: 2, afterId: 58000, nextAfterId: 0, takenDown: [] });
    const calls = JSON.stringify(db.mock.calls);
    expect(calls).not.toContain("UPDATE");
    expect(calls).toContain("darwin.live_fragment_check");
  });

  it("carries the cursor on when the batch is full", async () => {
    const db = dbFor(ROWS.slice(0, 2));
    const result = await recheckLiveFragmentNames(asDb(db), { runId: 7, dryRun: false, limit: 2 });
    expect(result.afterId).toBe(0);
    expect(result.nextAfterId).toBe(58415);
  });

  it("a dry run writes nothing at all", async () => {
    const db = dbFor(ROWS);
    await recheckLiveFragmentNames(asDb(db), { runId: 7, dryRun: true, live: true });
    const calls = JSON.stringify(db.mock.calls);
    expect(calls).not.toContain("UPDATE");
    expect(calls).not.toContain("INSERT");
  });

  it("switched on, archives the fragments with their pattern and logs the takedown", async () => {
    const db = dbFor(ROWS);
    const result = await recheckLiveFragmentNames(asDb(db), { runId: 7, stepId: 70, dryRun: false, live: true });
    expect(result.takenDown).toEqual([58414, 60002]);
    const calls = JSON.stringify(db.mock.calls);
    expect(calls).toContain("UPDATE published_fee_records");
    expect(calls).toContain("fragment name: sentence_end");
    expect(calls).toContain("fragment name: trailing_range");
    expect(calls).toContain("UPDATE verified_fee_observations");
    expect(calls).toContain("darwin.live_fragment_name_taken_down");
  });

  it("an institution-scoped run reads that bank and leaves the cursor alone", async () => {
    const db = dbFor(ROWS);
    const result = await recheckLiveFragmentNames(asDb(db), { runId: 7, dryRun: false, institutionId: 5314 });
    expect(result.afterId).toBeNull();
    expect(result.nextAfterId).toBeNull();
    expect(JSON.stringify(db.mock.calls)).not.toContain("FROM agent_run_events");
  });

  it("reads the cursor only from whole-table steps, so a scoped run's event can't reset it", async () => {
    const db = dbFor(ROWS, "60002");
    await recheckLiveFragmentNames(asDb(db), { runId: 8, dryRun: false });
    const cursorRead = db.mock.calls.map(([strings]) => (strings as TemplateStringsArray).join("?")).find((text) => text.includes("FROM agent_run_events"));
    expect(cursorRead).toContain("detail->>'next_after_id' IS NOT NULL");
  });

  it("counts the whole live table in one read", async () => {
    const db = dbFor(ROWS);
    const totals = await countLiveFragmentNames(asDb(db));
    expect(totals).toMatchObject({ checked: 4, matched: 2 });
    expect(db).toHaveBeenCalledTimes(1);
  });

  it("gives a read-only SQL with Postgres word boundaries", () => {
    const text = liveFragmentCountSql();
    expect(text).not.toMatch(/\\b/);
    expect(text).toContain("\\y(?:you|will)\\y");
    expect(text).toContain("name ~* '\\y(?:up\\s+to|per)\\s*$'");
    expect(text).toContain("'\\y(?:up\\s+to|per)\\s*$'");
    expect(text).not.toMatch(/\b(?:UPDATE|INSERT|DELETE)\b/);
  });
});
