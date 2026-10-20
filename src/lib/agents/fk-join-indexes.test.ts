import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");
const MIGRATION = "20270110000071_fk_join_indexes.sql";

const EXPECTED_INDEXES: ReadonlyArray<[string, RegExp]> = [
  ["pipeline_attempts.source_document_id", /ON public\.pipeline_attempts \(source_document_id\)\s+WHERE source_document_id IS NOT NULL/],
  ["agent_run_events.step_id", /ON public\.agent_run_events \(step_id, created_at DESC, id DESC\)/],
  ["source_documents.superseded_by_id", /ON public\.source_documents \(superseded_by_id\)\s+WHERE superseded_by_id IS NOT NULL/],
  ["source_documents.duplicate_of_id", /ON public\.source_documents \(duplicate_of_id\)\s+WHERE duplicate_of_id IS NOT NULL/],
];

// Oct 19, 2026: joined foreign keys with no index made deletes and step-event reads seq-scan.
describe("foreign-key join indexes migration", () => {
  const sql = readFileSync(join(MIGRATIONS, MIGRATION), "utf8");

  it.each(EXPECTED_INDEXES)("indexes %s", (_column, pattern) => {
    expect(sql).toMatch(pattern);
  });

  it("is index-only, bounded by lock_timeout, and re-runnable", () => {
    const statements = sql.replace(/--.*$/gm, "");
    expect(statements).toMatch(/SET lock_timeout/);
    expect(statements).not.toMatch(/\b(INSERT|UPDATE|DELETE|DROP|ALTER TABLE|TRUNCATE)\b/i);
    expect(statements.match(/CREATE INDEX /g)).toHaveLength(EXPECTED_INDEXES.length);
    expect(statements.match(/CREATE INDEX IF NOT EXISTS/g)).toHaveLength(EXPECTED_INDEXES.length);
  });

  it("does not duplicate an index an earlier migration already created", () => {
    const earlier = readdirSync(MIGRATIONS)
      .filter((file) => file.endsWith(".sql") && file < MIGRATION)
      .map((file) => readFileSync(join(MIGRATIONS, file), "utf8"))
      .join("\n");
    for (const name of indexNames(sql)) expect(earlier).not.toContain(name);
  });
});

function indexNames(sql: string): string[] {
  return [...sql.matchAll(/CREATE INDEX IF NOT EXISTS (\w+)/g)].map((match) => match[1]);
}
