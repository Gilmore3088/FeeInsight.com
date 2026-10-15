import { beforeEach, describe, expect, it, vi } from "vitest";

const startAgentRun = vi.fn();
vi.mock("@/lib/agents/run-store", () => ({ startAgentRun: (...args: unknown[]) => startAgentRun(...args) }));

import { AUDIENCE_RELABEL_MODE, decideAudience, dryRunFullTotals, runAudienceRelabel, type AudienceRelabelRow } from "./audience-relabel";
import { scheduleAudienceRelabelRun } from "./audience-relabel-schedule";

const row = (overrides: Partial<AudienceRelabelRow> = {}): AudienceRelabelRow => ({
  fee_verified_id: 501, fee_raw_id: 401, institution_id: 7, source_document_id: 21, source_url: "https://example.coop/fees",
  fee_name: "Stop Payment", amount: "30.00", amount_kind: "flat", canonical_fee_key: "stop_payment", audience_evidence: null,
  fee_published_ids: [601], ...overrides,
});
const consumerSchedule = "Fee Schedule\nStop Payment | $30.00\nNSF Fee | $32.00";

function createDb(options: { rows?: AudienceRelabelRow[]; docs?: number[]; remaining?: number; feedback?: unknown[]; migrated?: boolean; lastBatch?: unknown } = {}) {
  const rows = options.rows ?? [];
  const docs = options.docs ?? [...new Set(rows.map((r) => Number(r.source_document_id)))];
  const db = vi.fn((strings: TemplateStringsArray) => {
    const text = strings.join(" ");
    if (text.includes("pg_get_functiondef")) return Promise.resolve([{ ready: options.migrated ?? true }]);
    if (text.includes("to_regclass")) return Promise.resolve([{ ready: true }]);
    if (text.includes("FROM agent_runs")) return Promise.resolve(options.lastBatch ? [options.lastBatch] : []);
    if (text.includes("docs AS")) return Promise.resolve(docs.map((id) => ({ source_document_id: id, remaining: docs.length + (options.remaining ?? 0) })));
    if (text.includes("array_agg")) return Promise.resolve(rows);
    if (text.includes("FROM agent_source_texts")) return Promise.resolve([{ source_document_id: 21, normalized_text: consumerSchedule }]);
    if (text.includes("FROM pipeline_feedback")) return Promise.resolve(options.feedback ?? []);
    if (text.includes("UPDATE verified_fee_observations")) return Promise.resolve([{ fee_verified_id: 501 }]);
    if (text.includes("UPDATE published_fee_records")) return Promise.resolve([{ fee_published_id: 601 }]);
    if (text.includes("INSERT INTO pipeline_feedback")) return Promise.resolve([{ id: 1 }]);
    return Promise.resolve([]);
  }) as ReturnType<typeof vi.fn> & { unsafe: (text: string) => string };
  db.unsafe = (text: string) => text;
  return db;
}
const writes = (db: ReturnType<typeof createDb>) => db.mock.calls.map(([strings]) => (strings as string[]).join(" ")).filter((text) => /UPDATE|INSERT/.test(text));

beforeEach(() => {
  startAgentRun.mockReset();
  startAgentRun.mockResolvedValue({ reused: false, run: { id: 77 } });
});

describe("Darwin audience relabel (#1059)", () => {
  it.each([
    [row({ source_url: "https://umassfive.coop/business-fees" }), consumerSchedule, "business", "document_url"],
    [row(), consumerSchedule, "consumer", "default_general_schedule"],
    [row(), null, "unknown", "no_text"],
  ])("decides from the document like a new verification (%#)", (candidate, text, audience, source) => {
    expect(decideAudience(candidate, text)).toMatchObject({ feeAudience: audience, source });
  });

  it("off: a sampled dry run counts by audience and source and writes nothing", async () => {
    const db = createDb({ rows: [row(), row({ fee_verified_id: 502, source_document_id: 99 })], remaining: 5000 });
    const result = await runAudienceRelabel(db as never, { mode: "off", sampleKey: "2026-10-15" });
    expect(result).toMatchObject({ dryRun: true, fees: 2, byAudience: { consumer: 1, unknown: 1 }, bySource: { default_general_schedule: 1, no_text: 1 }, relabeled: 0, remaining: 5000, nextAfterId: null });
    expect(writes(db)).toEqual([]);
  });

  it("ships as the full dry run: the cursor chain as live, counts only, no migration needed", async () => {
    expect(AUDIENCE_RELABEL_MODE).toBe("dry_run_full");
    const db = createDb({ rows: [row()], remaining: 40, migrated: false });
    const result = await runAudienceRelabel(db as never, { afterId: 20 });
    expect(result).toMatchObject({ mode: "dry_run_full", dryRun: true, fees: 1, byAudience: { consumer: 1 }, relabeled: 0, nextAfterId: 21, remaining: 40, done: false });
    expect(writes(db)).toEqual([]);
  });

  it("totals the full dry run: earlier batches (latest per cursor) plus this one", async () => {
    const db = createDb();
    db.mockImplementationOnce(() => Promise.resolve([
      { documents: 300, fees: 2900, by_audience: { consumer: 2000, both: 700, business: 60, unknown: 140 }, by_source: { default_general_schedule: 1500 } },
    ]));
    const totals = await dryRunFullTotals(db as never, { documents: 10, fees: 100, byAudience: { consumer: 80, unknown: 20 }, bySource: { none: 20 } } as never, 300);
    expect(totals).toMatchObject({ batches: 2, documents: 310, fees: 3000, byAudience: { consumer: 2080, both: 700, business: 60, unknown: 160 } });
    expect(totals.shares).toEqual({ consumer: 69.3, both: 23.3, business: 2, unknown: 5.3 });
  });

  it("live: one bounded batch records the old value before writing, and says where the next resumes", async () => {
    const db = createDb({ rows: [row()], remaining: 40 });
    const result = await runAudienceRelabel(db as never, { mode: "live", runId: 9, afterId: 20 });
    expect(result).toMatchObject({ dryRun: false, relabeled: 1, publishedTouched: 1, nextAfterId: 21, remaining: 40, done: false });
    const order = writes(db).map((text) => (text.includes("pipeline_feedback") ? "record" : text.includes("verified") ? "verified" : "published"));
    expect(order).toEqual(["record", "verified", "published"]);
  });

  it("live refuses to run before migration 47, writing nothing", async () => {
    const db = createDb({ rows: [row()], migrated: false });
    await expect(runAudienceRelabel(db as never, { mode: "live" })).rejects.toThrow(/20270110000047/);
    expect(writes(db)).toEqual([]);
  });

  it("rollback: sets the audience back to unknown with the old evidence, so the trigger copies the raw audience", async () => {
    const db = createDb({ feedback: [{ fee_verified_id: 501, from_evidence: null, to_evidence: "darwin:default_general_schedule: x", fee_published_ids: [601], remaining: 1 }] });
    const result = await runAudienceRelabel(db as never, { mode: "rollback" });
    expect(result).toMatchObject({ restored: 1, publishedTouched: 1, done: true });
    expect(writes(db).find((text) => text.includes("verified_fee_observations"))).toMatch(/fee_audience = 'unknown'/);
  });
});

describe("audience relabel schedule", () => {
  it.each([
    ["no migration", { migrated: false }, { scheduled: false, reason: "migration_47_missing" }, null],
    ["first batch", {}, { scheduled: true }, 0],
    ["next batch from the cursor", { lastBatch: { id: 5, status: "completed", after_id: "0", next_after_id: "1200", done: false } }, { scheduled: true }, 1200],
    ["a failed batch again", { lastBatch: { id: 5, status: "failed", after_id: "1200", next_after_id: null, done: null } }, { scheduled: true }, 1200],
    ["a batch under way", { lastBatch: { id: 5, status: "running", after_id: "1200", next_after_id: null, done: null } }, { scheduled: false, reason: "waiting" }, null],
    ["done", { lastBatch: { id: 5, status: "completed", after_id: "1200", next_after_id: "1500", done: true } }, { scheduled: false, reason: "done" }, null],
  ])("live: %s", async (_name, db, expected, afterId) => {
    const result = await scheduleAudienceRelabelRun(createDb(db) as never, new Date("2026-10-15T00:00:00Z"), "live");
    expect(result).toMatchObject(expected);
    if (afterId == null) expect(startAgentRun).not.toHaveBeenCalled();
    else expect(startAgentRun.mock.calls[0][0]).toMatchObject({ params: { mode: "live", after_id: afterId }, idempotencyKey: `darwin:audience-relabel:live:v1:after:${afterId}` });
  });

  it("full dry run: its own key chain, from the cursor, with no migration check", async () => {
    const lastBatch = { id: 5, status: "completed", after_id: "0", next_after_id: "900", done: false };
    await scheduleAudienceRelabelRun(createDb({ migrated: false, lastBatch }) as never, new Date("2026-10-15T00:00:00Z"), "dry_run_full");
    expect(startAgentRun.mock.calls[0][0]).toMatchObject({ kind: "dry_run", params: { mode: "dry_run_full", after_id: 900 }, idempotencyKey: "darwin:audience-relabel:dry:v1:after:900" });
  });

  it("off: one sampled dry run a day", async () => {
    await scheduleAudienceRelabelRun(createDb() as never, new Date("2026-10-15T08:00:00Z"), "off");
    expect(startAgentRun.mock.calls[0][0]).toMatchObject({ kind: "dry_run", params: { mode: "off", day: "2026-10-15" } });
  });
});
