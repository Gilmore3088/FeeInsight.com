import { describe, expect, it, vi } from "vitest";

import {
  LATE_CHARGE_BOUND_CHECK,
  LATE_CHARGE_BOUND_TAKEDOWN_LIVE,
  findLateChargeBounds,
  lateChargeBoundDetail,
  recheckLateChargeBounds,
} from "./late-charge-bound-check";

// The live late_payment rows the bound pattern selected on 2026-10-25 (prod, read-only), and one
// real late fee beside them that the pure test must leave alone.
const ROWS = [
  { fee_published_id: "154636", fee_verified_id: "202480", institution_id: "4956", fee_name: "Maximum late charge", amount: "30.00", canonical_fee_key: "late_payment" },
  { fee_published_id: "15729", fee_verified_id: "9068", institution_id: "4956", fee_name: "Generally 5% of the principal and interest for conventional loans; maximum late charge of", amount: "30.00", canonical_fee_key: "late_payment" },
  { fee_published_id: "154637", fee_verified_id: "202481", institution_id: "4956", fee_name: "Minimum late charge", amount: "10.00", canonical_fee_key: "late_payment" },
  { fee_published_id: "79880", fee_verified_id: "90172", institution_id: "5338", fee_name: "Minimum Late Fee", amount: "10.00", canonical_fee_key: "late_payment" },
  { fee_published_id: "124614", fee_verified_id: "140623", institution_id: "6789", fee_name: "Minimum Late Charge", amount: "0.50", canonical_fee_key: "late_payment" },
  { fee_published_id: "122340", fee_verified_id: "1", institution_id: "4956", fee_name: "Consumer loan late fee", amount: "29.00", canonical_fee_key: "late_payment" },
];

type DbMock = ReturnType<typeof vi.fn>;
function dbFor(rows: Array<Record<string, unknown>>, options: { flags?: Array<Record<string, unknown>>; failRead?: boolean } = {}): DbMock {
  return vi.fn((strings: TemplateStringsArray) => {
    const text = strings.join("?");
    if (text.includes("information_schema") || text.includes("to_regclass")) return Promise.resolve([{ ready: true, exists: true, present: true }]);
    if (text.includes("FROM pipeline_feedback")) return Promise.resolve(options.flags ?? []);
    if (text.includes("UPDATE published_fee_records")) return Promise.resolve([{ fee_published_id: "154636" }]);
    if (text.includes("FROM published_fee_records fp")) return options.failRead ? Promise.reject(new Error("read failed")) : Promise.resolve(rows);
    return Promise.resolve([]);
  });
}
const asDb = (db: DbMock) => db as unknown as Parameters<typeof recheckLateChargeBounds>[0];
const texts = (db: DbMock) => db.mock.calls.map(([strings]) => (strings as TemplateStringsArray).join("?"));

describe("findLateChargeBounds (#1905)", () => {
  it("lists each bound once, in id order, and leaves a real late fee alone", () => {
    const found = findLateChargeBounds([...ROWS, ROWS[0]]);
    expect(found.matches.map((fee) => fee.feePublishedId)).toEqual([15729, 79880, 124614, 154636, 154637]);
    expect(found).toMatchObject({ matched: 5, institutions: 3 });
    expect(found.matches[3].reason).toBe("late_charge_bound: Maximum late charge");
  });

  it("reads only late_payment rows", () => {
    const filedElsewhere = { ...ROWS[0], canonical_fee_key: "other_lending_fee" };
    expect(findLateChargeBounds([filedElsewhere]).matched).toBe(0);
  });
});

describe("recheckLateChargeBounds (#1905)", () => {
  it("is on (sampled clean, 5 of 5) and flags by default", async () => {
    expect(LATE_CHARGE_BOUND_TAKEDOWN_LIVE).toBe(true);
    const db = dbFor(ROWS);
    const result = await recheckLateChargeBounds(asDb(db), { runId: 6, dryRun: false });
    expect(result).toMatchObject({ live: true, matched: 5, flagged: 5 });
  });

  it("switched off, only reports", async () => {
    const db = dbFor(ROWS);
    const result = await recheckLateChargeBounds(asDb(db), { runId: 7, stepId: 70, dryRun: false, live: false });
    expect(result).toMatchObject({ live: false, matched: 5, institutions: 3, flagged: 0, takenDown: [] });
    expect(texts(db).some((text) => text.includes("UPDATE"))).toBe(false);
    expect(texts(db).some((text) => text.includes("pipeline_feedback") && text.includes("INSERT"))).toBe(false);
    // The report is on the run ledger.
    expect(texts(db).some((text) => text.includes("INSERT INTO agent_run_events"))).toBe(true);
    expect(lateChargeBoundDetail(result)).toMatchObject({ check: LATE_CHARGE_BOUND_CHECK, switch_live: false, matched: 5 });
  });

  it("switched on, flags a first failure and takes a fee down on its second look 12 hours on", async () => {
    const first = dbFor(ROWS);
    const flagged = await recheckLateChargeBounds(asDb(first), { runId: 8, dryRun: false, live: true });
    expect(flagged.flagged).toBe(5);
    expect(flagged.takenDown).toEqual([]);

    const flaggedAt = new Date("2026-10-25T00:00:00Z");
    const second = dbFor([ROWS[0]], {
      flags: [{ fee_published_id: "154636", kind: "takedown_pending", evidence: { flag_run_id: 8, flagged_at: flaggedAt.toISOString(), reason: "late_charge_bound: Maximum late charge" } }],
    });
    const result = await recheckLateChargeBounds(asDb(second), { runId: 9, dryRun: false, live: true, now: new Date("2026-10-25T13:00:00Z") });
    expect(result.takenDown).toEqual([154636]);
    expect(texts(second).find((text) => text.includes("UPDATE published_fee_records"))).toContain("rolled_back_reason = v.reason");
    expect(texts(second).some((text) => text.includes("UPDATE verified_fee_observations"))).toBe(true);
  });

  it("writes nothing in a dry run and survives a failed read", async () => {
    const dry = dbFor(ROWS);
    expect((await recheckLateChargeBounds(asDb(dry), { runId: 1, dryRun: true, live: true })).matched).toBe(5);
    expect(texts(dry).some((text) => /INSERT|UPDATE/.test(text))).toBe(false);

    const failed = dbFor(ROWS, { failRead: true });
    expect(await recheckLateChargeBounds(asDb(failed), { runId: 1, dryRun: false })).toMatchObject({ matched: 0, takenDown: [] });
  });
});
