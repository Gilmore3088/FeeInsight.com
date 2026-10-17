import { describe, expect, it, vi } from "vitest";
import {
  ATTEMPT_REPEAT_STAGES,
  ATTEMPT_WINDOW,
  RETENTION_LIVE,
  runStorageRetention,
  storageAlerts,
  storageRetentionDetail,
  summarizeStorageRetention,
} from "./storage-retention";

type Row = Record<string, unknown>;

/** A tagged-template db mock that answers by the SQL it sees and records every statement. */
function mockDb(answers: { previous?: Row[]; attemptRead?: Row; legacy?: number; runEvents?: number; deleted?: number }) {
  const calls: string[] = [];
  const db = vi.fn((strings: TemplateStringsArray) => {
    const text = strings.join(" ");
    calls.push(text);
    const gone = Array.from({ length: answers.deleted ?? 0 }, (_, i) => ({ id: i + 1, event_id: `e${i}` }));
    if (text.includes("DELETE FROM")) return Promise.resolve(gone);
    if (text.includes("pg_database_size")) return Promise.resolve([{ bytes: String(6_340 * 1_048_576) }]);
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
  it("ships with every trim switched off until James says yes", () => {
    expect(Object.values(RETENTION_LIVE).every((on) => on === false)).toBe(true);
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
    const result = await runStorageRetention({ db });
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
    const result = await runStorageRetention({ db, live: { attempt_repeats: true } });
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

describe("storageAlerts and summary", () => {
  it("flags a size over 9,000 MB", () => {
    expect(storageAlerts(9_500, 10)).toEqual(["database is 9,500 MB, above 9,000 MB"]);
    expect(storageAlerts(null, null)).toEqual([]);
  });
  it("says what each trim would remove while it is off", async () => {
    const { db } = mockDb({ legacy: 1200, runEvents: 0, attemptRead: { read: "10", through_id: "10", repeats: "4" } });
    const result = await runStorageRetention({ db });
    expect(summarizeStorageRetention(result)).toBe(
      "Database 6,340 MB. Trims: old rows of the retired event log: 1,200 (off); run events over 90 days old: 0 (off); exact repeats in the attempt log: 4 (off).",
    );
    expect(storageRetentionDetail(result)).toMatchObject({ database_mb: 6340, attempt_window: { next_after_id: 0 } });
  });
});
