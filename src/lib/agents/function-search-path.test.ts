import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");
const PINNED = "SET search_path = public, pg_catalog";

// The nine legacy functions the Supabase advisor flagged for a mutable search_path
// (DB review LOW-1, 2026-10-20), with prod's exact argument lists.
const FUNCTIONS: Array<[name: string, args: string]> = [
  ["agent_messages_notify", ""],
  ["ext_intel_search_vector_update", ""],
  ["lineage_graph", "bigint"],
  ["log_classification_change", ""],
  ["maintain_agent_auth_log_partitions", ""],
  ["maintain_agent_events_partitions", ""],
  ["promote_to_tier2", "bigint, text, bytea, uuid, text, text, jsonb"],
  ["promote_to_tier3", "bigint, uuid, text"],
  ["refresh_agent_health_rollup", "timestamptz"],
];

function migrationTexts(): string[] {
  return readdirSync(MIGRATIONS)
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(join(MIGRATIONS, file), "utf8"));
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * True when the newest migration touching the function pins search_path: a definition with the
 * SET clause, or a signature listed in a DO block that runs ALTER FUNCTION ... SET search_path.
 */
function latestPinsSearchPath(name: string, args: string): boolean {
  const listed = new RegExp(`'public\\.${name}\\(${escape(args)}\\)'`);
  const alter = {
    test: (text: string) =>
      listed.test(text) &&
      text.includes("ALTER FUNCTION %s SET search_path = public, pg_catalog"),
  };
  const definition = new RegExp(
    `CREATE OR REPLACE FUNCTION (?:public\\.)?${name}\\s*\\([\\s\\S]*?(?:\\$function\\$|\\$\\$);`,
    "i",
  );
  let pinned: boolean | null = null;
  for (const text of migrationTexts()) {
    const defined = text.match(definition);
    if (defined) pinned = defined[0].includes(PINNED);
    if (alter.test(text)) pinned = true;
  }
  return pinned === true;
}

describe("legacy functions pin search_path", () => {
  it.each(FUNCTIONS)("%s(%s) runs with search_path = public, pg_catalog", (name, args) => {
    expect(latestPinsSearchPath(name, args)).toBe(true);
  });
});
