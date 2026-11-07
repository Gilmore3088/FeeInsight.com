import { existsSync } from "node:fs";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { connectFixtureDb, type FixtureDb } from "./fixtures";
import { CARRIED_BY_SNAPSHOT, MIGRATIONS_DIR, applyPendingMigrations, migrationVersion, restoreSnapshotPartitions } from "./schema-catch-up";

describe("fixture schema catch-up (#2170)", () => {
  it("names only migration files that exist", () => {
    for (const file of CARRIED_BY_SNAPSHOT) expect(existsSync(path.join(MIGRATIONS_DIR, file)), file).toBe(true);
  });

  it("records a migration under its leading number", () => {
    expect(migrationVersion("20270108000001_hamilton_decision_workspace.sql")).toBe("20270108000001");
    expect(() => migrationVersion("notes.sql")).toThrow(/no version number/);
  });
});

describe.skipIf(!process.env.E2E_DATABASE_URL)("applyPendingMigrations on the fixture database (#2170)", () => {
  async function flattenedFixture(db: FixtureDb, run: (namespace: string) => Promise<void>) {
    const namespace = 'fixture_partition_' + randomUUID().replaceAll('-', '');
    try {
      await db.unsafe(`CREATE SCHEMA ${namespace};
        CREATE TABLE ${namespace}.agent_events (LIKE public.agent_events INCLUDING ALL);
        CREATE TABLE ${namespace}.agent_events_default (LIKE public.agent_events INCLUDING ALL);
        CREATE TABLE ${namespace}.agent_events_2026_11 (LIKE public.agent_events INCLUDING ALL)`).simple();
      await run(namespace);
    } finally { await db.unsafe(`DROP SCHEMA IF EXISTS ${namespace} CASCADE`); }
  }

  it('restores the captured empty partition hierarchy and is idempotent', async () => {
    const db = connectFixtureDb();
    try { await flattenedFixture(db, async namespace => {
      await restoreSnapshotPartitions(db, namespace);
      const [row] = await db<{ relkind: string; children: number }[]>`
        SELECT c.relkind, (SELECT count(*)::int FROM pg_inherits WHERE inhparent=c.oid) AS children
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=${namespace} AND c.relname='agent_events'`;
      expect(row).toEqual({ relkind: 'p', children: 2 });
      await restoreSnapshotPartitions(db, namespace);
    }); } finally { await db.end(); }
  });

  it.each(['agent_events', 'agent_events_default'])('refuses a nonempty flattened %s without changing it', async table => {
    const db = connectFixtureDb();
    try { await flattenedFixture(db, async namespace => {
      await db.unsafe(`INSERT INTO ${namespace}.${table} (agent_name, action, status) VALUES ('fixture', 'test', 'success')`);
      await expect(restoreSnapshotPartitions(db, namespace)).rejects.toThrow('nonempty fixture table');
      const [row] = await db.unsafe<{ rows: number; relkind: string }[]>(`SELECT (SELECT count(*)::int FROM ${namespace}.${table}) AS rows, relkind FROM pg_class WHERE oid='${namespace}.agent_events'::regclass`);
      expect(row).toEqual({ rows: 1, relkind: 'r' });
    }); } finally { await db.end(); }
  });

  it('rolls back the complete repair when a view depends on the original parent', async () => {
    const db = connectFixtureDb();
    try { await flattenedFixture(db, async namespace => {
      await db.unsafe(`CREATE VIEW ${namespace}.dependent AS SELECT event_id FROM ${namespace}.agent_events`);
      await expect(restoreSnapshotPartitions(db, namespace)).rejects.toThrow('depend on it');
      const [row] = await db.unsafe<{ relkind: string; view_present: boolean; temporary_absent: boolean }[]>(`SELECT relkind,
        to_regclass('${namespace}.dependent') IS NOT NULL AS view_present,
        to_regclass('${namespace}.agent_events_fixture_flat') IS NULL AND to_regclass('${namespace}.agent_events_fixture_partitioned') IS NULL AS temporary_absent
        FROM pg_class WHERE oid='${namespace}.agent_events'::regclass`);
      expect(row).toEqual({ relkind: 'r', view_present: true, temporary_absent: true });
    }); } finally { await db.end(); }
  });

  it('refuses an unknown captured column shape', async () => {
    const db = connectFixtureDb();
    try { await flattenedFixture(db, async namespace => {
      await db.unsafe(`ALTER TABLE ${namespace}.agent_events ADD COLUMN unknown_fixture_column text`);
      await expect(restoreSnapshotPartitions(db, namespace)).rejects.toThrow('Unknown flattened fixture shape');
    }); } finally { await db.end(); }
  });

  it("brings in the decision tables and the alert function, and a second run applies nothing", async () => {
    const db = connectFixtureDb();
    try {
      await applyPendingMigrations(db);
      const [row] = await db<{ ready: boolean }[]>`
        SELECT to_regclass('public.hamilton_decisions') IS NOT NULL
           AND to_regclass('public.hamilton_decision_events') IS NOT NULL
           AND to_regclass('public.hamilton_institution_memory') IS NOT NULL
           AND to_regprocedure('public.upsert_institution_fee_alert_subscription(bigint,bigint,text[])') IS NOT NULL
           AND to_regprocedure('public.maintain_agent_events_partitions()') IS NOT NULL
           AND to_regprocedure('public.maintain_agent_auth_log_partitions()') IS NOT NULL AS ready
      `;
      expect(row.ready).toBe(true);
      expect(await applyPendingMigrations(db)).toEqual([]);
    } finally {
      await db.end();
    }
  });
});
