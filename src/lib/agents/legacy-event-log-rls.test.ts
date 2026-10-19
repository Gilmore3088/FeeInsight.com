import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");
const MAINTAINERS = ["maintain_agent_events_partitions", "maintain_agent_auth_log_partitions"];

/** The newest migration that (re)defines a function: the definition prod runs. */
function latestDefinition(name: string): string {
  const files = readdirSync(MIGRATIONS).filter((file) => file.endsWith(".sql")).sort();
  const pattern = new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\(\\)[\\s\\S]*?\\$function\\$;`, "i");
  let latest = "";
  for (const file of files) {
    const match = readFileSync(join(MIGRATIONS, file), "utf8").match(pattern);
    if (match) latest = match[0];
  }
  return latest;
}

// Oct 19, 2026: the monthly cron created agent_events/agent_auth_log partitions without RLS.
describe("legacy event log partition maintainers", () => {
  it.each(MAINTAINERS)("%s turns on RLS for the partition it creates and pins search_path", (name) => {
    const definition = latestDefinition(name);
    expect(definition).not.toBe("");
    expect(definition).toMatch(/ENABLE ROW LEVEL SECURITY/);
    expect(definition).toMatch(/SET search_path = public, pg_catalog/);
  });
});
