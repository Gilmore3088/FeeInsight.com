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

/**
 * Names of handles declared as a bare `postgres.Sql` (that is `Sql<{}>`) and then assigned, without a
 * cast, from `postgres(...)` opened with custom `types`, inline or through an options constant. The
 * same order-dependent check as above decides whether that compiles, and Vercel's build failed on
 * it while CI passed (#2657).
 */
function bareSqlWithCustomTypes(source: string): string[] {
  // Each declared name with where it is declared and whether its type is a bare postgres.Sql.
  const decls: { name: string; at: number; bare: boolean }[] = [];
  for (const decl of source.matchAll(/\b(?:let|var|const)\s+([^;]*?);/g)) {
    for (const part of decl[1].split(",")) {
      const m = /^\s*(\w+)\s*:\s*(.*?)\s*$/.exec(part);
      if (m) decls.push({ name: m[1], at: decl.index ?? 0, bare: m[2] === "postgres.Sql" });
    }
  }
  const typedOptions = new Set<string>();
  for (const m of source.matchAll(/\bconst\s+(\w+)\s*=\s*\{([\s\S]*?)\};/g)) {
    if (/\btypes\s*:/.test(m[2])) typedOptions.add(m[1]);
  }
  const offenders = new Set<string>();
  for (const m of source.matchAll(/\b(\w+)\s*=\s*postgres\(([\s\S]*?)\)\s*(as\b[^;]*)?;/g)) {
    if (m[3]) continue;
    // The nearest declaration before the assignment is the one in scope.
    const decl = decls.filter((d) => d.name === m[1] && d.at < (m.index ?? 0)).pop();
    if (!decl?.bare) continue;
    const lastArg = m[2].split(",").pop()?.trim() ?? "";
    if (/\btypes\s*:/.test(m[2]) || typedOptions.has(lastArg)) offenders.add(m[1]);
  }
  return [...offenders];
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

  it("never assign a custom-typed postgres() to a bare postgres.Sql handle", () => {
    const files = execFileSync("git", ["ls-files", "src", "tests"], { cwd: root, encoding: "utf8" })
      .split("\n")
      .filter((file) => /\.test\.tsx?$/.test(file) && file !== "src/lib/data-store/db-test-handles.test.ts");
    const offenders = files.filter((file) => bareSqlWithCustomTypes(readFileSync(join(root, file), "utf8")).length > 0);
    expect(offenders).toEqual([]);
  });

  it("flags a bare handle only when its own postgres() has custom types", () => {
    expect(bareSqlWithCustomTypes("let raw: postgres.Sql, db: Db;\nraw = postgres(url, { max: 1, types: { json } });")).toEqual(["raw"]);
    expect(bareSqlWithCustomTypes("let a: postgres.Sql;\nconst options = { max: 1, types: {\n json } };\na = postgres(url, options);")).toEqual(["a"]);
    expect(bareSqlWithCustomTypes("let a: postgres.Sql;\na = postgres(url, { max: 1 });")).toEqual([]);
    expect(bareSqlWithCustomTypes("let a: postgres.Sql;\na = postgres(url, { types: { json } }) as unknown as postgres.Sql;")).toEqual([]);
    expect(bareSqlWithCustomTypes("let a: TypedSql;\na = postgres(url, { types: { json } });")).toEqual([]);
    expect(bareSqlWithCustomTypes("let a: TypedSql;\na = postgres(url, { types: { json } });\nlet a: postgres.Sql;\na = postgres(url, { max: 1 });")).toEqual([]);
  });

  it("flags only the combination", () => {
    expect(returnTypeWithCustomTypes("let db: ReturnType<typeof postgres>;\ndb = postgres(url, { types: { json } });")).toBe(true);
    expect(returnTypeWithCustomTypes("let db: ReturnType<typeof postgres>;\ndb = postgres(url, { max: 1 });")).toBe(false);
    expect(returnTypeWithCustomTypes("let db: postgres.Sql<{ json: unknown }>;\ndb = postgres(url, { types: { json } });")).toBe(false);
  });
});
