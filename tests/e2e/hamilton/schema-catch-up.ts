/**
 * #2170: brings the fixture database up to today's schema. The snapshot
 * (tests/e2e/production-schema.sql) is a copy of prod from one day, so every table, column and
 * function a later migration adds is missing from it, and a journey that reaches one cannot run.
 *
 * The schema-only snapshot has no public.schema_migrations data and flattens old partition
 * relationships. Restore only the known empty fixture partition trees before replaying unchanged
 * SQL. The separate fixture replay ledger is not evidence of production migration history.
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import type { FixtureDb } from "./fixtures";

export const MIGRATIONS_DIR = path.resolve(__dirname, "../../../supabase/migrations");

/**
 * Migrations whose replay fails on the snapshot because it already carries their columns and a
 * later form of their catalog views (an older view would drop columns, or a constraint or column
 * already exists). They are recorded as applied without running. One piece is lost with them:
 * the pipeline_feedback_takedown_pending_idx index from 20270110000032, which no journey needs.
 * Re-check this list whenever the snapshot is refreshed.
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

const PARTITION_COLUMNS = {
  agent_events: 'event_id,created_at,agent_name,action,tool_name,entity,entity_id,status,cost_cents,confidence,parent_event_id,correlation_id,reasoning_hash,input_payload,output_payload,source_refs,error,is_shadow,reasoning_prompt_text,reasoning_output_text,reasoning_r2_key',
  agent_auth_log: 'auth_id,created_at,agent_event_id,agent_name,actor_type,actor_id,tool_name,entity,entity_id,before_value,after_value,reasoning_hash,parent_event_id',
};
const identifier = (value: string) => '"' + value.replaceAll('"', '""') + '"';

/** Restore lost snapshot DDL only; refuse rows, unknown shapes and dependencies instead of skipping SQL. */
export async function restoreSnapshotPartitions(db: FixtureDb, namespace = 'public'): Promise<void> {
  if (!/^[a-z_][a-z0-9_]*$/.test(namespace)) throw new Error('Unsafe fixture schema name');
  await db.begin(async tx => {
    for (const [parent, expectedColumns] of Object.entries(PARTITION_COLUMNS)) {
      const tables = await tx.unsafe<{ relname: string; relkind: string; has_behavior: boolean; signature: string; columns: string }[]>(`
        SELECT c.relname, c.relkind,
          (c.relrowsecurity OR c.relforcerowsecurity OR c.relacl IS NOT NULL
            OR EXISTS (SELECT 1 FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal)
            OR EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid=c.oid)) AS has_behavior,
          string_agg(a.attname || ':' || a.atttypid::text || ':' || a.attnotnull::text, ',' ORDER BY a.attnum) AS signature,
          string_agg(a.attname, ',' ORDER BY a.attnum) AS columns
        FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        JOIN pg_attribute a ON a.attrelid=c.oid AND a.attnum>0 AND NOT a.attisdropped
        WHERE n.nspname=$1 AND (c.relname=$2 OR c.relname=$3 OR c.relname ~ $4)
        GROUP BY c.oid ORDER BY c.relname`, [namespace, parent, parent + '_default', '^' + parent + '_[0-9]{4}_[0-9]{2}$']);
      const root = tables.find(table => table.relname === parent);
      if (!root || root.relkind === 'p') continue;
      if (root.relkind !== 'r' || root.columns !== expectedColumns || !tables.some(table => table.relname === parent + '_default')
        || tables.some(table => table.relkind !== 'r' || table.has_behavior || table.signature !== root.signature)) throw new Error(`Unknown flattened fixture shape: ${namespace}.${parent}`);
      const qualified = (name: string) => identifier(namespace) + '.' + identifier(name);
      await tx.unsafe('LOCK TABLE ' + tables.map(table => qualified(table.relname)).join(', ') + ' IN ACCESS EXCLUSIVE MODE');
      for (const table of tables) {
        const [row] = await tx.unsafe<{ occupied: boolean }[]>('SELECT EXISTS (SELECT 1 FROM ' + qualified(table.relname) + ' LIMIT 1) AS occupied');
        if (row.occupied) throw new Error(`Refusing to rebuild nonempty fixture table: ${namespace}.${table.relname}`);
      }
      const temporary = parent + '_fixture_partitioned', original = parent + '_fixture_flat';
      const statements = [
        `CREATE TABLE ${qualified(temporary)} (LIKE ${qualified(parent)} INCLUDING ALL) PARTITION BY RANGE (created_at)`,
        `ALTER TABLE ${qualified(parent)} RENAME TO ${identifier(original)}`,
        `ALTER TABLE ${qualified(temporary)} RENAME TO ${identifier(parent)}`,
      ];
      for (const table of tables.filter(table => table.relname !== parent && table.relname !== parent + '_default')) {
        const match = table.relname.match(/_(\d{4})_(\d{2})$/)!;
        const year = Number(match[1]), month = Number(match[2]);
        if (year < 2000 || year > 2100 || month < 1 || month > 12) throw new Error('Unknown fixture partition month: ' + table.relname);
        const lower = `${year}-${String(month).padStart(2, '0')}-01`, upper = `${month === 12 ? year + 1 : year}-${String(month === 12 ? 1 : month + 1).padStart(2, '0')}-01`;
        statements.push(`ALTER TABLE ${qualified(parent)} ATTACH PARTITION ${qualified(table.relname)} FOR VALUES FROM ('${lower}') TO ('${upper}')`);
      }
      statements.push(`ALTER TABLE ${qualified(parent)} ATTACH PARTITION ${qualified(parent + '_default')} DEFAULT`);
      // RESTRICT is deliberate: a view/FK/other external dependency rolls the complete repair back.
      statements.push(`DROP TABLE ${qualified(original)} RESTRICT`);
      await tx.unsafe(statements.join(';\n')).simple();
    }
  });
}

/** Applies each migration not yet recorded in this database; returns the files it ran. */
export async function applyPendingMigrations(db: FixtureDb, dir = MIGRATIONS_DIR): Promise<string[]> {
  await restoreSnapshotPartitions(db);
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
    await db`INSERT INTO supabase_migrations.schema_migrations (version, name) VALUES (${version}, ${file.replace(/^\d+_/, "").replace(/\.sql$/, "")})`;
  }
  return applied;
}
