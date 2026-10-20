import { describe, expect, it, vi } from "vitest";
import {
  ATTEMPT_REPEAT_STAGES,
  ATTEMPT_WINDOW,
  readLatestTableSizes,
  RETENTION_LIVE,
  runStorageRetention,
  STORAGE_ALERT_GROWTH_MB,
  STORAGE_ALERT_MB,
  storageAlerts,
  storageRetentionDetail,
  summarizePartitions,
  summarizeStorageRetention,
} from "./storage-retention";

type Row = Record<string, unknown>;

const OFF = { legacy_event_log: false, run_events: false, attempt_repeats: false };

/** A tagged-template db mock that answers by the SQL it sees and records every statement. */
function mockDb(answers: { previous?: Row[]; attemptRead?: Row; legacy?: number; runEvents?: number; deleted?: number; budgetMb?: Record<string, number> }) {
  const calls: string[] = [];
  const db = vi.fn((strings: TemplateStringsArray) => {
    const text = strings.join(" ");
    calls.push(text);
    const gone = Array.from({ length: answers.deleted ?? 0 }, (_, i) => ({ id: i + 1, event_id: `e${i}` }));
    if (text.includes("DELETE FROM")) return Promise.resolve(gone);
    if (text.includes("pg_database_size")) return Promise.resolve([{ bytes: String(6_340 * 1_048_576) }]);
    if (text.includes("FROM unnest")) {
      const sizes = answers.budgetMb ?? { area_statistics: 1_000, institution_call_report_items: 3_600 };
      return Promise.resolve(Object.entries(sizes).map(([name, size]) => ({ name, bytes: String(size * 1_048_576) })));
    }
    if (text.includes("pg_stat_user_tables")) return Promise.resolve([{ relname: "pipeline_attempts", bytes: String(1_349 * 1_048_576), n_live_tup: "2334263" }]);
    if (text.includes("JOIN agent_run_steps s ON s.id = e.step_id") && text.includes("database_mb")) return Promise.resolve(answers.previous ?? []);
    if (text.includes("FROM agent_events")) return Promise.resolve([{ n: String(answers.legacy ?? 0) }]);
    if (text.includes("FROM agent_run_events e")) return Promise.resolve([{ n: String(answers.runEvents ?? 0) }]);
    if (text.includes("FROM pipeline_attempts")) return Promise.resolve([answers.attemptRead ?? { read: "0", through_id: null, repeats: "0" }]);
    return Promise.resolve([]);
  });
  return { db: db as unknown as NonNullable<Parameters<typeof runStorageRetention>[0]>["db"], calls };
}

describe("RETENTION_LIVE", () => {
  it("has all three trims on, after James chose all three on Oct 17, 2026", () => {
    expect(RETENTION_LIVE).toEqual({ legacy_event_log: true, run_events: true, attempt_repeats: true });
  });
  it("never trims the stages whose readers count misses and retries", () => {
    expect([...ATTEMPT_REPEAT_STAGES]).toEqual(["extract", "verify", "publish"]);
  });
});

describe("runStorageRetention", () => {
  it("measures and counts, and deletes nothing while the trims are off", async () => {
    const { db, calls } = mockDb({
      previous: [{ database_mb: "6000", next_after_id: null, created_at: "2026-10-16T12:00:00Z" }],
      legacy: 250_000,
      runEvents: 0,
      attemptRead: { read: "120", through_id: "999", repeats: "40" },
    });
    const result = await runStorageRetention({ db, live: OFF });
    expect(result.databaseMb).toBe(6340);
    expect(result.growthMb).toBe(340);
    expect(result.alerts).toEqual(["grew 340 MB since the last run, above 300 MB"]);
    expect(result.trims.map((t) => [t.policy, t.live, t.eligible, t.deleted])).toEqual([
      ["legacy_event_log", false, 250_000, 0],
      ["run_events", false, 0, 0],
      ["attempt_repeats", false, 40, 0],
    ]);
    expect(calls.some((c) => c.includes("DELETE FROM"))).toBe(false);
    // A short window has reached the newest old row, so the next run starts over.
    expect(result.attemptWindow).toEqual({ afterId: 0, throughId: 999, nextAfterId: 0 });
  });

  it("deletes in batches only for a trim switched on, and continues from the last cursor", async () => {
    const { db, calls } = mockDb({
      previous: [{ database_mb: null, next_after_id: "5000", created_at: "2026-10-16T12:00:00Z" }],
      attemptRead: { read: String(ATTEMPT_WINDOW), through_id: "205000", repeats: "3" },
      deleted: 3,
    });
    const result = await runStorageRetention({ db, live: { ...OFF, attempt_repeats: true } });
    const deletes = calls.filter((c) => c.includes("DELETE FROM"));
    expect(deletes).toHaveLength(1);
    expect(deletes[0]).toContain("DELETE FROM pipeline_attempts");
    // Both an older and a newer identical twin are required.
    expect(deletes[0]).toContain("twin.created_at < win.created_at");
    expect(deletes[0]).toContain("twin.created_at > win.created_at");
    expect(deletes[0]).toContain("twin.detail = win.detail");
    expect(result.trims.find((t) => t.policy === "attempt_repeats")?.deleted).toBe(3);
    expect(result.attemptWindow).toEqual({ afterId: 5000, throughId: 205000, nextAfterId: 205000 });
    expect(result.growthMb).toBeNull();
  });

  it("a dry run never deletes, even with a trim switched on", async () => {
    const { db, calls } = mockDb({ legacy: 10, deleted: 10 });
    await runStorageRetention({ db, dryRun: true, live: { legacy_event_log: true } });
    expect(calls.some((c) => c.includes("DELETE FROM"))).toBe(false);
  });

  it("reports a failed count and still runs the other trims", async () => {
    const { db } = mockDb({ legacy: 5 });
    const failing = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join(" ").includes("FROM agent_run_events e") && !strings.join(" ").includes("database_mb")) return Promise.reject(new Error("timeout"));
      return (db as unknown as (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>)(strings, ...values);
    }) as unknown as typeof db;
    const result = await runStorageRetention({ db: failing });
    expect(result.trims.find((t) => t.policy === "run_events")).toMatchObject({ eligible: null, error: "timeout" });
    expect(result.trims.find((t) => t.policy === "legacy_event_log")?.eligible).toBe(5);
  });
});

describe("a failed attempt-log count", () => {
  it("keeps the cursor where it was so the next run retries the same window", async () => {
    const { db } = mockDb({ previous: [{ database_mb: "6000", next_after_id: "7000", created_at: "2026-10-16T12:00:00Z" }] });
    const failing = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join(" ").includes("WITH win AS")) return Promise.reject(new Error("canceling statement due to statement timeout"));
      return (db as unknown as (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>)(strings, ...values);
    }) as unknown as typeof db;
    const result = await runStorageRetention({ db: failing });
    expect(result.trims.find((t) => t.policy === "attempt_repeats")?.eligible).toBeNull();
    expect(result.attemptWindow).toEqual({ afterId: 7000, throughId: null, nextAfterId: 7000 });
  });
});

describe("storageAlerts and summary", () => {
  it("warns above 13,000 MB, raised from 9,000 once the back-fill left the database at about 10 GB (Oct 18)", () => {
    expect(STORAGE_ALERT_MB).toBe(13_000);
    expect(STORAGE_ALERT_GROWTH_MB).toBe(300);
    expect(storageAlerts(10_200, 10)).toEqual([]);
    expect(storageAlerts(13_500, 10)).toEqual(["database is 13,500 MB, above 13,000 MB"]);
    expect(storageAlerts(null, null)).toEqual([]);
  });
  it("names each public-data table over its budget", () => {
    expect(storageAlerts(10_000, 20, [{ table: "area_statistics", totalMb: 2_100, budgetMb: 2_000 }])).toEqual([
      "area_statistics is 2,100 MB, above its 2,000 MB budget; the sources that write it are held",
    ]);
    expect(storageAlerts(10_000, 20, [{ table: "demographics", totalMb: 1_100, budgetMb: 1_000 }])).toEqual([
      "demographics is 1,100 MB, above the 1,000 MB default; nothing is held until a PR gives it a budget",
    ]);
  });
  it("warns on the private witness budget without purging evidence or holding a source", async () => {
    const { db, calls } = mockDb({ budgetMb: { agent_source_text_witnesses: 257 } });
    const result = await runStorageRetention({ db, live: OFF });
    expect(result.alerts).toContain("Normalized witnesses are 257 MB, above the 256 MB review budget; evidence is retained, review storage headroom");
    expect(result.heldSources).toEqual([]);
    expect(calls.some((query) => query.includes("DELETE FROM"))).toBe(false);
    expect(result.budgetTables).toEqual([{ table: "agent_source_text_witnesses", totalMb: 257, budgetMb: 256 }]);
  });
  it("says what each trim would remove while it is off", async () => {
    const { db } = mockDb({ legacy: 1200, runEvents: 0, attemptRead: { read: "10", through_id: "10", repeats: "4" } });
    const result = await runStorageRetention({ db, live: OFF });
    expect(summarizeStorageRetention(result)).toBe(
      "Database 6,340 MB. All 2 tracked tables are within budget. Trims: old rows of the retired event log: 1,200 (off); run events over 90 days old: 0 (off); exact repeats in the attempt log: 4 (off).",
    );
    expect(storageRetentionDetail(result)).toMatchObject({ database_mb: 6340, attempt_window: { next_after_id: 0 } });
  });
});

describe("public-data table budgets", () => {
  it("measures every budgeted table and records none over budget on the Oct 17 sizes", async () => {
    const { db, calls } = mockDb({});
    const result = await runStorageRetention({ db, live: OFF });
    const measured = calls.find((c) => c.includes("FROM unnest"));
    expect(measured).toContain("pg_total_relation_size");
    expect(result.overBudget).toEqual([]);
    expect(result.heldSources).toEqual([]);
    expect(storageRetentionDetail(result)).toMatchObject({
      budget_tables: { institution_call_report_items: 3600, area_statistics: 1000 },
      over_budget: [],
      held_sources: [],
    });
  });

  it("flags a table over budget, warns, and names the sources the scheduler will hold", async () => {
    const { db } = mockDb({ budgetMb: { institution_call_report_items: 7_200, area_statistics: 1_000 } });
    const result = await runStorageRetention({ db, live: OFF });
    expect(result.overBudget).toEqual([{ table: "institution_call_report_items", totalMb: 7200, budgetMb: 7000 }]);
    expect(result.heldSources.map((h) => h.source).sort()).toEqual(["ffiec-call-detail", "ncua-extras"]);
    expect(result.alerts).toContain("institution_call_report_items is 7,200 MB, above its 7,000 MB budget; the sources that write it are held");
    expect(summarizeStorageRetention(result)).toContain("Registry sources held for size:");
  });

  it("records no sizes when the measurement fails, so nothing is held", async () => {
    const { db } = mockDb({});
    const failing = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
      if (strings.join(" ").includes("FROM unnest")) return Promise.reject(new Error("timeout"));
      return (db as unknown as (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>)(strings, ...values);
    }) as unknown as typeof db;
    const result = await runStorageRetention({ db: failing, live: OFF });
    expect(result.budgetTables).toBeNull();
    expect(result.heldSources).toEqual([]);
    expect(storageRetentionDetail(result)).toMatchObject({ budget_tables: null });
  });
});

describe("legacy event-log partitions in the trim", () => {
  const plan = (dropped: boolean) => ({
    cutoff: "2026-08-20T08:00:00.000Z",
    boundary: ["agent_events_2026_08"],
    partitions: [
      { name: "agent_events_2026_06", rows: 300_000, totalMb: 174, dropped },
      { name: "agent_events_2026_07", rows: 320_000, totalMb: 189, dropped },
    ],
  });
  it("names the whole months past the cutoff while off or in a dry run", () => {
    expect(summarizePartitions(plan(false), false)).toBe(" (whole months past the cutoff: agent_events_2026_06, agent_events_2026_07, 363 MB)");
  });
  it("names what it dropped and what it could not", () => {
    expect(summarizePartitions(plan(true), true)).toBe(" (dropped agent_events_2026_06, agent_events_2026_07, 363 MB)");
    const partly = plan(true);
    partly.partitions[1] = { ...partly.partitions[1], dropped: false };
    expect(summarizePartitions(partly, true)).toBe(" (dropped agent_events_2026_06, 174 MB; could not drop agent_events_2026_07)");
    expect(summarizePartitions({ ...plan(false), partitions: [] }, true)).toBe("");
  });
  it("lists the partitions before touching the log, and a dry run drops none", async () => {
    const { db, calls } = mockDb({ legacy: 10 });
    const result = await runStorageRetention({ db, dryRun: true, commitDb: db, now: new Date("2026-10-19T08:00:00Z") });
    const listed = calls.findIndex((c) => c.includes("FROM pg_inherits"));
    const log = calls.findIndex((c) => c.includes("FROM agent_events"));
    expect(listed).toBeGreaterThanOrEqual(0);
    expect(listed).toBeLessThan(log);
    expect(calls.some((c) => /DETACH|DROP TABLE/.test(c))).toBe(false);
    expect(result.trims[0]).toMatchObject({ policy: "legacy_event_log", live: false, eligible: 10, deleted: 0 });
    expect(storageRetentionDetail(result).trims).toEqual(expect.arrayContaining([
      expect.objectContaining({ policy: "legacy_event_log", partitions: { cutoff: "2026-08-20T08:00:00.000Z", boundary: [], expired: [] } }),
    ]));
  });
});

describe("readLatestTableSizes", () => {
  const dbReturning = (rows: Row[]) =>
    vi.fn(() => Promise.resolve(rows)) as unknown as NonNullable<Parameters<typeof readLatestTableSizes>[0]>;
  it("reads the sizes the newest measuring run recorded", async () => {
    await expect(readLatestTableSizes(dbReturning([{ budget_tables: { area_statistics: 1000.5, bad: "x" } }]))).resolves.toEqual({ area_statistics: 1000.5 });
  });
  it("is null when no run has measured them", async () => {
    await expect(readLatestTableSizes(dbReturning([]))).resolves.toBeNull();
  });
});
