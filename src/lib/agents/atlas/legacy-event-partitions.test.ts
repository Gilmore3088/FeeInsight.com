import { describe, expect, it, vi } from "vitest";
import {
  dropExpiredLegacyPartitions,
  partitionMonth,
  PARTITION_DROPPED_EVENT,
  PARTITION_LOCK_TIMEOUT,
  retentionCutoff,
  selectExpiredPartitions,
} from "./legacy-event-partitions";

type Db = Parameters<typeof dropExpiredLegacyPartitions>[0]["db"];

/** The partitions attached to `public.agent_events` in the Oct 19, 2026 read-only review. */
const OCT_19_PARTITIONS = [
  "agent_events_2026_04",
  "agent_events_2026_05",
  "agent_events_2026_06",
  "agent_events_2026_07",
  "agent_events_2026_08",
  "agent_events_2026_09",
  "agent_events_2026_10",
  "agent_events_2026_11",
  "agent_events_default",
];
const OCT_19 = new Date("2026-10-19T08:00:00Z");

describe("retentionCutoff", () => {
  it("is 60 days before the run", () => {
    expect(retentionCutoff(OCT_19, 60).toISOString()).toBe("2026-08-20T08:00:00.000Z");
  });
});

describe("partitionMonth", () => {
  it("reads the month range from a partition name, in UTC", () => {
    expect(partitionMonth("agent_events_2026_12")).toEqual({
      name: "agent_events_2026_12",
      from: new Date("2026-12-01T00:00:00Z"),
      to: new Date("2027-01-01T00:00:00Z"),
    });
  });
  it("does not read the default, archived, other tables' or malformed names", () => {
    for (const name of ["agent_events_default", "agent_events_2024_01_archived", "agent_auth_log_2026_06", "agent_events_2026_13", "agent_events_2026_6"]) {
      expect(partitionMonth(name)).toBeNull();
    }
  });
});

describe("selectExpiredPartitions", () => {
  it("on Oct 19, 2026 drops April-July and leaves August, the month the cutoff falls in", () => {
    const { drop, kept } = selectExpiredPartitions(OCT_19_PARTITIONS, retentionCutoff(OCT_19, 60));
    expect(drop.map((p) => p.name)).toEqual(["agent_events_2026_04", "agent_events_2026_05", "agent_events_2026_06", "agent_events_2026_07"]);
    expect(kept).toEqual([
      { name: "agent_events_2026_08", reason: "boundary" },
      { name: "agent_events_2026_09", reason: "not_expired" },
      { name: "agent_events_2026_10", reason: "not_expired" },
      { name: "agent_events_2026_11", reason: "not_expired" },
      { name: "agent_events_default", reason: "default" },
    ]);
  });

  it("drops a month whose range ends before the cutoff, not one that ends at or after it", () => {
    const names = ["agent_events_2026_07", "agent_events_2026_08"];
    expect(selectExpiredPartitions(names, new Date("2026-08-01T00:00:01Z")).drop.map((p) => p.name)).toEqual(["agent_events_2026_07"]);
    expect(selectExpiredPartitions(names, new Date("2026-08-01T00:00:00Z")).drop).toEqual([]);
  });

  it("never selects the default, archived or unrecognised tables, however old", () => {
    const { drop, kept } = selectExpiredPartitions(
      ["agent_events_default", "agent_events_2020_01_archived", "agent_events_old", "agent_auth_log_2020_01"],
      new Date("2030-01-01T00:00:00Z"),
    );
    expect(drop).toEqual([]);
    expect(kept.map((k) => k.reason).sort()).toEqual(["archived", "default", "unrecognised", "unrecognised"]);
  });

  it("never selects the current or a future month", () => {
    const cutoff = retentionCutoff(OCT_19, 60);
    const { drop } = selectExpiredPartitions(["agent_events_2026_10", "agent_events_2026_11", "agent_events_2027_01"], cutoff);
    expect(drop).toEqual([]);
  });
});

/** A tagged-template + unsafe + begin mock that records every statement in order. */
function mockDb(options: { partitions?: string[]; newest?: string; failOn?: string } = {}) {
  const calls: string[] = [];
  let failed = false;
  const answer = (text: string): Promise<unknown[]> => {
    calls.push(text);
    if (options.failOn && text.includes(options.failOn) && !failed) {
      failed = true;
      return Promise.reject(new Error("canceling statement due to lock timeout"));
    }
    if (text.includes("FROM pg_inherits") && text.includes("c.relname =")) return Promise.resolve([{ one: 1 }]);
    if (text.includes("FROM pg_inherits")) return Promise.resolve((options.partitions ?? OCT_19_PARTITIONS).map((relname) => ({ relname })));
    if (text.includes("count(*)")) return Promise.resolve([{ n: "1000", newest: options.newest ?? "2026-07-31T23:00:00Z", bytes: String(10 * 1_048_576) }]);
    return Promise.resolve([]);
  };
  const db = vi.fn((strings: TemplateStringsArray) => answer(strings.join(" "))) as unknown as Record<string, unknown>;
  db.unsafe = vi.fn((text: string) => answer(text));
  db.begin = vi.fn(async (work: (tx: unknown) => Promise<unknown>) => {
    calls.push("BEGIN");
    try {
      const out = await work(db);
      calls.push("COMMIT");
      return out;
    } catch (error) {
      calls.push("ROLLBACK");
      throw error;
    }
  });
  return { db: db as unknown as Db, calls };
}

const context = { runId: 7, stepId: 70, stepKey: "atlas-storage-retention" };
const cutoff = retentionCutoff(OCT_19, 60);

describe("dropExpiredLegacyPartitions", () => {
  it("only measures while not live, and never detaches or drops", async () => {
    const { db, calls } = mockDb();
    const plan = await dropExpiredLegacyPartitions({ db, commitDb: db, live: false, cutoff, context });
    expect(plan.partitions.map((p) => [p.name, p.rows, p.totalMb, p.dropped])).toEqual([
      ["agent_events_2026_04", 1000, 10, false],
      ["agent_events_2026_05", 1000, 10, false],
      ["agent_events_2026_06", 1000, 10, false],
      ["agent_events_2026_07", 1000, 10, false],
    ]);
    expect(plan.boundary).toEqual(["agent_events_2026_08"]);
    expect(calls.some((c) => /DETACH|DROP TABLE|INSERT INTO agent_run_events/.test(c))).toBe(false);
  });


  it("drops each expired month in its own committed transaction: lock, check, record, then the scoped function", async () => {
    const { db, calls } = mockDb({ partitions: ["agent_events_2026_06", "agent_events_2026_08", "agent_events_default"] });
    const plan = await dropExpiredLegacyPartitions({ db, commitDb: db, live: true, cutoff, context });
    expect(plan.partitions).toEqual([{ name: "agent_events_2026_06", rows: 1000, totalMb: 10, dropped: true }]);
    const tx = calls.slice(calls.indexOf("BEGIN"));
    expect(tx[1]).toContain("lock_timeout");
    expect(tx[2]).toBe('LOCK TABLE "public"."agent_events" IN ACCESS EXCLUSIVE MODE');
    expect(tx[3]).toContain("c.relname =");
    expect(tx[4]).toContain("max(created_at)");
    expect(tx[5]).toContain("INSERT INTO agent_run_events");
    expect(tx[6]).toContain("public.drop_expired_legacy_event_partition(");
    expect(tx[7]).toBe("COMMIT");
    expect(calls.filter((c) => c.includes("drop_expired_legacy_event_partition"))).toHaveLength(1);
    expect(calls.some((c) => /DETACH|DROP TABLE/.test(c))).toBe(false);
    expect(PARTITION_LOCK_TIMEOUT).toBe("3s");
    expect(PARTITION_DROPPED_EVENT).toBe("atlas.storage.partition_dropped");
  });

  it("rolls back and drops nothing when the partition holds a row newer than the cutoff", async () => {
    const { db, calls } = mockDb({ partitions: ["agent_events_2026_07"], newest: "2026-09-01T00:00:00Z" });
    const plan = await dropExpiredLegacyPartitions({ db, commitDb: db, live: true, cutoff, context });
    expect(plan.partitions[0]).toMatchObject({ name: "agent_events_2026_07", dropped: false });
    expect(plan.partitions[0].error).toContain("after the cutoff");
    expect(calls).toContain("ROLLBACK");
    expect(calls.some((c) => c.includes("drop_expired_legacy_event_partition") || c.includes("INSERT INTO agent_run_events"))).toBe(false);
  });

  it("reports a lock timeout and moves on to the next month", async () => {
    const { db } = mockDb({ partitions: ["agent_events_2026_04", "agent_events_2026_05"], failOn: "LOCK TABLE" });
    const plan = await dropExpiredLegacyPartitions({ db, commitDb: db, live: true, cutoff, context });
    expect(plan.partitions.map((p) => [p.name, p.dropped])).toEqual([["agent_events_2026_04", false], ["agent_events_2026_05", true]]);
    expect(plan.partitions[0].error).toContain("lock timeout");
  });

  it("drops nothing without a connection outside the step's transaction or a step to record on", async () => {
    for (const [commitDb, ctx, note] of [
      [null, context, "no connection outside the step's transaction; nothing dropped"],
      ["db", undefined, "no run step to record the drop on; nothing dropped"],
    ] as const) {
      const { db, calls } = mockDb({ partitions: ["agent_events_2026_04"] });
      const plan = await dropExpiredLegacyPartitions({ db, commitDb: commitDb ? db : null, live: true, cutoff, context: ctx });
      expect(plan.note).toBe(note);
      expect(calls.some((c) => c.includes("drop_expired_legacy_event_partition") || c.includes("LOCK TABLE"))).toBe(false);
    }
  });
});
