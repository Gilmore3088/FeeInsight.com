import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MIGRATIONS = join(process.cwd(), "supabase", "migrations");

// Oct 19, 2026: unindexed MAX(year) on institution_branch_deposits cost ~65,000 s of DB
// time in 14 days. Keep an index that leads with year so MAX(year) stays a single probe.
describe("institution_branch_deposits year index", () => {
  it("some migration indexes institution_branch_deposits on year first", () => {
    const sql = readdirSync(MIGRATIONS)
      .filter((file) => file.endsWith(".sql"))
      .map((file) => readFileSync(join(MIGRATIONS, file), "utf8"))
      .join("\n");
    expect(sql).toMatch(/ON public\.institution_branch_deposits \(year\)/);
  });
});
