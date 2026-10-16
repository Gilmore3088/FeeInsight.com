import { beforeEach, describe, expect, it, vi } from "vitest";

import { resetCorrectionsReadyCache } from "@/lib/fee-correction-guard";
import { getFeeChangesSince, listFeeAuditEntries } from "./fee-correction-audit";

// H03-T08 to T10 (#978): the audit history reads both sources, reads each action's refresh
// status from evidence, counts saved outputs made before it, and writes nothing.

type Call = { query: string; values: unknown[] };

function createDb(rowsFor: (query: string, values: unknown[]) => unknown[] | Error) {
  const calls: Call[] = [];
  const tag = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const query = strings.join("?");
    calls.push({ query, values });
    const rows = rowsFor(query, values);
    return rows instanceof Error ? Promise.reject(rows) : Promise.resolve(rows);
  });
  return { db: tag as never, calls };
}

const now = new Date("2026-10-16T14:00:00.000Z");
const correction = {
  id: 12, created_at: "2026-10-16T12:00:00.000Z", action: "correct", status: "current", version: 1,
  institution_id: 7, institution_name: "First Example Bank", previous_fee_published_id: 500, fee_published_id: 501,
  before_canonical_fee_key: "stop_payment", before_fee_name: "Stop Payment Fee", before_amount: "25.00",
  before_frequency: "per_item", before_conditions: null, canonical_fee_key: "stop_payment", fee_name: "Stop Payment Fee",
  amount: "35.00", frequency: "per_item", conditions: null, source_document_id: 900,
  source_excerpt: "Stop Payment Fee | $35.00", source_location: "Page 1, row 2", reason: "Amount read from the wrong row",
  actor_name: "James", agent_run_id: 41,
};
const hold = {
  id: 88, created_at: "2026-10-16T13:00:00.000Z", kind: "admin_hold", institution_id: 7, institution_name: "First Example Bank",
  fee_published_id: 600, canonical_fee_key: "overdraft", amount: "0.00", fee_name: "Overdraft Fee",
  actor_name: "Ana", reason: "Shown as free; schedule says $30", agent_run_id: 42,
};

function rows(query: string): unknown[] | Error {
  if (query.includes("to_regclass")) return [{ ready: true }];
  if (query.includes("FROM published_fee_corrections c")) return [correction];
  if (query.includes("FROM pipeline_feedback pf")) return [hold];
  if (query.includes("FROM published_fee_records fp")) {
    return [
      { fee_published_id: 500, live: false, listed: false },
      { fee_published_id: 501, live: true, listed: true },
      { fee_published_id: 600, live: false, listed: false },
    ];
  }
  if (query.includes("FROM agent_run_events e")) {
    return [
      { run_id: 41, event_type: "index.refresh", status: "completed", created_at: "2026-10-16T12:00:01.000Z" },
      { run_id: 41, event_type: "cache.invalidate", status: "completed", created_at: "2026-10-16T12:00:02.000Z" },
      { run_id: 42, event_type: "index.refresh", status: "failed", created_at: "2026-10-16T13:00:01.000Z" },
    ];
  }
  if (query.includes("fee_index_cache")) return [{ computed_at: "2026-10-16T12:00:01.000Z" }];
  if (query.includes("hamilton_saved_analyses")) return [{ key: "correction:12", n: 2 }, { key: "hold:88", n: 3 }];
  if (query.includes("hamilton_reports")) return new Error('relation "hamilton_reports" does not exist');
  if (query.includes("hamilton_briefing_snapshots")) return [{ key: "correction:12", n: 0 }, { key: "hold:88", n: 1 }];
  return [];
}

describe("fee audit history", () => {
  beforeEach(() => resetCorrectionsReadyCache());

  it("should_list_holds_and_corrections_newest_first_with_who_why_and_evidence", async () => {
    const { db } = createDb(rows);
    const entries = await listFeeAuditEntries(db, { now });
    expect(entries.map((e) => e.key)).toEqual(["hold:88", "correction:12"]);
    const [held, corrected] = entries;
    expect(held).toMatchObject({ action: "hold", actorName: "Ana", reason: "Shown as free; schedule says $30", publication: "Held", runId: 42 });
    expect(corrected).toMatchObject({
      action: "correct",
      version: 1,
      actorName: "James",
      sourceDocumentId: 900,
      sourceExcerpt: "Stop Payment Fee | $35.00",
      sourceLocation: "Page 1, row 2",
      publication: "Current version, live",
    });
    expect(corrected.before?.amount).toBe(25);
    expect(corrected.after?.amount).toBe(35);
  });

  it("should_read_refresh_status_from_the_run_events_and_offer_a_retry_only_for_a_failure", async () => {
    const { db } = createDb(rows);
    const [held, corrected] = await listFeeAuditEntries(db, { now });
    expect(corrected.refresh?.needsRetry).toBe(false);
    expect(corrected.refresh?.surfaces.every((s) => s.state === "reached")).toBe(true);
    // The hold's rebuild failed and its caches were never recorded as cleared.
    expect(held.refresh?.needsRetry).toBe(true);
    expect(held.refresh?.surfaces.find((s) => s.surface === "national_index")?.state).toBe("failed");
  });

  it("should_count_saved_outputs_made_before_each_action_and_leave_an_unreadable_table_unknown", async () => {
    const { db } = createDb(rows);
    const [held, corrected] = await listFeeAuditEntries(db, { now });
    expect(corrected.savedOutputs).toEqual({ analyses: 2, reports: null, briefings: 0 });
    expect(held.savedOutputs).toEqual({ analyses: 3, reports: null, briefings: 1 });
  });

  it("should_only_read", async () => {
    const { db, calls } = createDb(rows);
    await listFeeAuditEntries(db, { institutionId: 7, now });
    expect(calls.some((c) => /\b(INSERT|UPDATE|DELETE)\b/.test(c.query))).toBe(false);
    // The institution filter reaches both sources.
    expect(calls.filter((c) => c.values.includes(7)).length).toBeGreaterThanOrEqual(2);
  });

  it("should_skip_corrections_before_their_migration_and_still_list_holds", async () => {
    const { db } = createDb((query) => (query.includes("to_regclass") ? [{ ready: false }] : rows(query)));
    const entries = await listFeeAuditEntries(db, { now });
    expect(entries.map((e) => e.key)).toEqual(["hold:88"]);
  });

  it("should_return_fee_changes_since_a_saved_output_and_none_when_the_read_fails", async () => {
    const { db } = createDb((query) => {
      if (query.includes("to_regclass")) return [{ ready: true }];
      if (query.includes("FROM published_fee_corrections")) return [{ action: "reverse", created_at: "2026-10-16T12:00:00.000Z" }];
      if (query.includes("FROM pipeline_feedback")) return [{ kind: "admin_release", created_at: "2026-10-16T13:00:00.000Z" }];
      return [];
    });
    expect(await getFeeChangesSince(db, 7, "2026-10-10T00:00:00.000Z")).toEqual([
      { kind: "reverse", at: "2026-10-16T12:00:00.000Z" },
      { kind: "release", at: "2026-10-16T13:00:00.000Z" },
    ]);
    resetCorrectionsReadyCache();
    const failing = createDb(() => new Error("connection refused"));
    vi.spyOn(console, "error").mockImplementation(() => {});
    expect(await getFeeChangesSince(failing.db, 7, "2026-10-10T00:00:00.000Z")).toEqual([]);
  });
});
