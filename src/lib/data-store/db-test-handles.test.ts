import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const root = join(__dirname, "..", "..", "..");

/**
 * True when a file declares a handle as `ReturnType<typeof postgres>` and also opens postgres with
 * custom `types`. ReturnType picks one overload (`Sql<{}>`), and whether TypeScript then accepts
 * the typed handle depends on what else it checked first, so unrelated changes break typecheck.
 */
function returnTypeWithCustomTypes(source: string): boolean {
  return /ReturnType<\s*typeof\s+postgres\s*>/.test(source) && /\btypes\s*:/.test(source);
}

// 2026-10-18-postgres-returntype-in-db-tests: declare the handle with the types it really has,
// e.g. postgres.Sql<{ numeric: number; json: unknown; text: string }>.
describe("database test handles", () => {
  it("never declare ReturnType<typeof postgres> beside custom types", () => {
    const files = execFileSync("git", ["ls-files", "src", "tests"], { cwd: root, encoding: "utf8" })
      .split("\n")
      .filter((file) => /\.test\.tsx?$/.test(file));
    const offenders = files.filter((file) => file !== "src/lib/data-store/db-test-handles.test.ts")
      .filter((file) => returnTypeWithCustomTypes(readFileSync(join(root, file), "utf8")));
    expect(offenders).toEqual([]);
  });

  it("flags only the combination", () => {
    expect(returnTypeWithCustomTypes("let db: ReturnType<typeof postgres>;\ndb = postgres(url, { types: { json } });")).toBe(true);
    expect(returnTypeWithCustomTypes("let db: ReturnType<typeof postgres>;\ndb = postgres(url, { max: 1 });")).toBe(false);
    expect(returnTypeWithCustomTypes("let db: postgres.Sql<{ json: unknown }>;\ndb = postgres(url, { types: { json } });")).toBe(false);
  });
});
