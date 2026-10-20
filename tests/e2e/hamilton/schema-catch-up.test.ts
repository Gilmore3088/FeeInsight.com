import { existsSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { connectFixtureDb } from "./fixtures";
import { CARRIED_BY_SNAPSHOT, MIGRATIONS_DIR, applyPendingMigrations, migrationVersion } from "./schema-catch-up";

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
  it("brings in the decision tables and the alert function, and a second run applies nothing", async () => {
    const db = connectFixtureDb();
    try {
      await applyPendingMigrations(db);
      const [row] = await db<{ ready: boolean }[]>`
        SELECT to_regclass('public.hamilton_decisions') IS NOT NULL
           AND to_regclass('public.hamilton_decision_events') IS NOT NULL
           AND to_regclass('public.hamilton_institution_memory') IS NOT NULL
           AND to_regprocedure('public.upsert_institution_fee_alert_subscription(bigint,bigint,text[])') IS NOT NULL AS ready
      `;
      expect(row.ready).toBe(true);
      expect(await applyPendingMigrations(db)).toEqual([]);
    } finally {
      await db.end();
    }
  });
});
