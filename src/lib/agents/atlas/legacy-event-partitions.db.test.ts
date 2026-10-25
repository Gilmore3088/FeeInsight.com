/** Real PostgreSQL check of the legacy event-log partition drop: only whole expired months go. */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { dropExpiredLegacyPartitions, PARTITION_DROPPED_EVENT, retentionCutoff } from "./legacy-event-partitions";

const connection = process.env.E2E_DATABASE_URL;
type Db = Parameters<typeof dropExpiredLegacyPartitions>[0]["db"];

/** The E2E schema's own agent_events tables wait here and come back after the suite. */
const HOLD = "atlas_partition_test_hold";
const NOW = new Date("2026-10-19T08:00:00Z");
const MONTHS = ["2026_04", "2026_05", "2026_06", "2026_07", "2026_08", "2026_09", "2026_10", "2026_11"];
const context = { runId: 1, stepId: 10, stepKey: "atlas-storage-retention" };

async function children(db: postgres.Sql): Promise<string[]> {
  const rows = await db<{ relname: string }[]>`
    SELECT c.relname FROM pg_inherits i JOIN pg_class c ON c.oid = i.inhrelid
     WHERE i.inhparent = to_regclass('public.agent_events') ORDER BY c.relname`;
  return rows.map((row) => row.relname);
}

const call = (db: postgres.Sql, partition: string, cutoff: string) =>
  db`SELECT public.drop_expired_legacy_event_partition(${partition}::regclass, ${cutoff}::timestamptz)`;

describe.skipIf(!connection)("legacy event-log partition drop in isolated PostgreSQL", () => {
  let db: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Partition drop tests require a loopback E2E database; production connections are forbidden");
    }
    db = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    await db.unsafe(`CREATE SCHEMA IF NOT EXISTS ${HOLD}`);
    const existing = await db<{ relname: string }[]>`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relname LIKE 'agent\\_events%'
         AND NOT c.relispartition`;
    for (const { relname } of existing) await db.unsafe(`ALTER TABLE public."${relname}" SET SCHEMA ${HOLD}`);

    await db.unsafe(`CREATE TABLE public.agent_events (event_id uuid NOT NULL DEFAULT gen_random_uuid(),
      created_at timestamptz NOT NULL, PRIMARY KEY (event_id, created_at)) PARTITION BY RANGE (created_at)`);
    await db.unsafe(`CREATE TABLE public.agent_events_default PARTITION OF public.agent_events DEFAULT`);
    for (const month of MONTHS) {
      const [y, m] = month.split("_").map(Number);
      const from = new Date(Date.UTC(y, m - 1, 1)).toISOString();
      const to = new Date(Date.UTC(y, m, 1)).toISOString();
      await db.unsafe(`CREATE TABLE public.agent_events_${month} PARTITION OF public.agent_events FOR VALUES FROM ('${from}') TO ('${to}')`);
      await db.unsafe(`INSERT INTO public.agent_events (created_at) SELECT '${from}'::timestamptz + make_interval(days => d) FROM generate_series(0, 2) d`);
    }
    // An old row in the default partition, and a table the maintainer detached at 18 months.
    await db.unsafe(`INSERT INTO public.agent_events (created_at) VALUES ('2025-01-05')`);
    await db.unsafe(`CREATE TABLE public.agent_events_2025_01_archived (created_at timestamptz)`);
    // The run ledger, on this session only (it shadows public.agent_run_events).
    await db`CREATE TEMP TABLE agent_run_events (id bigserial PRIMARY KEY, agent_run_id integer NOT NULL, step_id integer,
      event_type text NOT NULL, status text NOT NULL, message text, detail jsonb NOT NULL DEFAULT '{}', created_at timestamptz NOT NULL DEFAULT now())`;
  });
  afterAll(async () => {
    if (!db) return;
    await db.unsafe(`DROP TABLE IF EXISTS public.agent_events CASCADE`);
    await db.unsafe(`DROP TABLE IF EXISTS public.agent_events_2025_01_archived`);
    const held = await db<{ relname: string }[]>`
      SELECT c.relname FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = ${HOLD} AND c.relkind IN ('r', 'p') AND NOT c.relispartition`;
    for (const { relname } of held) await db.unsafe(`ALTER TABLE ${HOLD}."${relname}" SET SCHEMA public`);
    await db.unsafe(`DROP SCHEMA IF EXISTS ${HOLD}`);
    await db.end();
  });

  it("measures and changes nothing while not live", async () => {
    const plan = await db.begin((tx) => dropExpiredLegacyPartitions({ db: tx as unknown as Db, commitDb: db as unknown as Db, live: false, cutoff: retentionCutoff(NOW, 60), context }));
    expect(plan.partitions.map((p) => [p.name, p.rows, p.dropped])).toEqual([
      ["agent_events_2026_04", 3, false], ["agent_events_2026_05", 3, false], ["agent_events_2026_06", 3, false], ["agent_events_2026_07", 3, false],
    ]);
    expect(plan.boundary).toEqual(["agent_events_2026_08"]);
    expect(await children(db)).toHaveLength(MONTHS.length + 1);
  });

  it("the function refuses the default, archived, boundary, current and non-child tables", async () => {
    const cutoff = retentionCutoff(NOW, 60).toISOString();
    for (const [table, why] of [
      ["public.agent_events_default", "not a monthly partition"],
      ["public.agent_events_2025_01_archived", "not a partition of public.agent_events"],
      ["public.agent_events_2026_08", "not before the cutoff"],
      ["public.agent_events_2026_10", "not before the cutoff"],
      ["public.agent_run_events", "not a partition of public.agent_events"],
    ]) {
      await expect(call(db, table, cutoff), table).rejects.toThrow(why);
    }
    expect(await children(db)).toHaveLength(MONTHS.length + 1);
  });

  it("drops April-July whole, records each drop, and leaves August, later months, default and archived", async () => {
    const plan = await dropExpiredLegacyPartitions({ db: db as unknown as Db, commitDb: db as unknown as Db, live: true, cutoff: retentionCutoff(NOW, 60), context });
    expect(plan.partitions.map((p) => [p.name, p.rows, p.dropped, p.error])).toEqual([
      ["agent_events_2026_04", 3, true, undefined], ["agent_events_2026_05", 3, true, undefined],
      ["agent_events_2026_06", 3, true, undefined], ["agent_events_2026_07", 3, true, undefined],
    ]);
    expect(await children(db)).toEqual([
      "agent_events_2026_08", "agent_events_2026_09", "agent_events_2026_10", "agent_events_2026_11", "agent_events_default",
    ]);
    const [gone] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relname IN ('agent_events_2026_04', 'agent_events_2026_07')`;
    expect(gone.n).toBe(0);
    expect(await db`SELECT 1 FROM public.agent_events_2025_01_archived LIMIT 0`).toBeDefined();
    const [left] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM public.agent_events`;
    expect(left.n).toBe(4 * 3 + 1);
    const events = await db<{ event_type: string; step_id: number; detail: string }[]>`SELECT event_type, step_id, detail::text AS detail FROM agent_run_events ORDER BY id`;
    expect(events.map((e) => [e.event_type, e.step_id])).toEqual(Array(4).fill([PARTITION_DROPPED_EVENT, 10]));
    expect(JSON.parse(events[0].detail)).toMatchObject({ partition: "public.agent_events_2026_04", rows: 3 });
  });

  it("keeps a partition whose name says expired but whose range runs past the cutoff, attached and whole", async () => {
    // Named for March but bounded March-July (the range April-July freed): its name passes the
    // selection; the TS row check (a July row) and the function's bound check both refuse it.
    await db.unsafe(`CREATE TABLE public.agent_events_2026_03 PARTITION OF public.agent_events
      FOR VALUES FROM ('2026-03-01T00:00:00Z') TO ('2026-08-01T00:00:00Z')`);
    await db.unsafe(`INSERT INTO public.agent_events (created_at) VALUES ('2026-03-10'), ('2026-07-15')`);
    const plan = await dropExpiredLegacyPartitions({ db: db as unknown as Db, commitDb: db as unknown as Db, live: true, cutoff: new Date("2026-07-01T00:00:00Z"), context });
    expect(plan.partitions).toHaveLength(1);
    expect(plan.partitions[0]).toMatchObject({ name: "agent_events_2026_03", dropped: false });
    expect(plan.partitions[0].error).toContain("after the cutoff");
    await expect(call(db, "public.agent_events_2026_03", "2026-07-01T00:00:00Z")).rejects.toThrow("not before the cutoff");
    expect(await children(db)).toContain("agent_events_2026_03");
    const [kept] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM public.agent_events_2026_03`;
    expect(kept.n).toBe(2);
    const [events] = await db<{ n: number }[]>`SELECT count(*)::int AS n FROM agent_run_events`;
    expect(events.n).toBe(4);
  });
});
