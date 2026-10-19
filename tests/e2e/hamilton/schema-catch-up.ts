/**
 * #2170: brings the fixture database up to today's schema. The snapshot
 * (tests/e2e/production-schema.sql) is a copy of prod from one day, so every table, column and
 * function a later migration adds is missing from it, and a journey that reaches one cannot run.
 *
 * Before seeding, this applies every migration in supabase/migrations that the database has not
 * recorded, in file order, and records each one, as Supabase does on prod. The first run on a
 * fresh snapshot replays them all; their SQL is written to re-run safely, except the few below
 * whose later versions the snapshot already carries. Any other failure stops the suite.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { FixtureDb } from "./fixtures";

export const MIGRATIONS_DIR = path.resolve(__dirname, "../../../supabase/migrations");

/**
 * Migrations the 2026-10-04 snapshot already carries in a later form: replaying them fails
 * (an older catalog view drops columns, or a constraint or column already exists). They are
 * recorded as applied without running.
 */
export const CARRIED_BY_SNAPSHOT = [
  "20270110000000_catalog_hides_thin_institutions.sql",
  "20270110000006_percentage_fees.sql",
  "20270110000020_account_lineup_fields.sql",
  "20270110000032_catalog_pending_steps_aside.sql",
  "20270110000040_fee_audience_integrity.sql",
];

/** The version a migration file is recorded under: its leading number. */
export function migrationVersion(file: string): string {
  const version = file.match(/^(\d+)_/)?.[1];
  if (!version) throw new Error(`Migration file ${file} has no version number.`);
  return version;
}

/** Applies each migration not yet recorded in this database; returns the files it ran. */
export async function applyPendingMigrations(db: FixtureDb, dir = MIGRATIONS_DIR): Promise<string[]> {
  await db`CREATE SCHEMA IF NOT EXISTS supabase_migrations`;
  await db`CREATE TABLE IF NOT EXISTS supabase_migrations.schema_migrations (version text PRIMARY KEY, name text)`;
  const recorded = new Set(
    (await db<{ version: string }[]>`SELECT version FROM supabase_migrations.schema_migrations`).map((r) => r.version),
  );
  const applied: string[] = [];
  for (const file of readdirSync(dir).filter((name) => name.endsWith(".sql")).sort()) {
    const version = migrationVersion(file);
    if (recorded.has(version)) continue;
    if (!CARRIED_BY_SNAPSHOT.includes(file)) {
      try {
        await db.unsafe(readFileSync(path.join(dir, file), "utf8")).simple();
      } catch (error) {
        throw new Error(`Migration ${file} failed on the fixture database: ${(error as Error).message}`);
      }
      applied.push(file);
    }
    await db`INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES (${version}, ${file.replace(/\.sql$/, "")})`;
  }
  return applied;
}
