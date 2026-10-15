import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A missing institution, district, state, city, article or report must answer 404, not 200
 * (#1165, #1267). Next fixes the status at 200 as soon as a loading skeleton streams, so for
 * these routes:
 * - no loading file may sit in any folder from `app/` down to the route's own folder
 *   (its own loading file is fine: it wraps only the page, inside the route's layout);
 * - the route's layout must run the existence check and call notFound().
 */
const APP = path.join(__dirname);

const ROUTES_WITH_404 = [
  "(public)/institution/[id]",
  "(public)/research/district/[id]",
  "(public)/fees/city/[state]",
  "(public)/fees/city/[state]/[city]",
  "(public)/research/articles/[slug]",
  "(public)/reports/[slug]",
];

/** Every extension Next accepts for a special file. */
const EXTENSIONS = ["tsx", "ts", "jsx", "js"];

function specialFile(dir: string, name: string): string | null {
  for (const ext of EXTENSIONS) {
    const file = path.join(dir, `${name}.${ext}`);
    if (existsSync(file)) return file;
  }
  return null;
}

/** Source with comments and string contents removed, so only real code can match. */
function codeOnly(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`\\])\/\/.*$/gm, "$1")
    .replace(/(["'`])(?:\\.|(?!\1)[^\\])*\1/g, '""');
}

/** True when the code calls notFound(): a call, not a mention in a comment or a string. */
function callsNotFound(source: string): boolean {
  return /(^|[^\w.])notFound\s*\(\s*\)/.test(codeOnly(source));
}

function ancestorsOf(route: string): string[] {
  const parts = route.split("/");
  const dirs = [APP];
  for (let i = 0; i < parts.length - 1; i++) dirs.push(path.join(APP, ...parts.slice(0, i + 1)));
  return dirs;
}

describe("routes that answer 404 for a missing record", () => {
  it.each(ROUTES_WITH_404)("%s has no loading boundary above its layout", (route) => {
    const above = ancestorsOf(route).filter((dir) => specialFile(dir, "loading") !== null);
    expect(above.map((dir) => path.relative(APP, dir) || "app")).toEqual([]);
  });

  it.each(ROUTES_WITH_404)("%s checks the record in its layout", (route) => {
    const layout = specialFile(path.join(APP, route), "layout");
    expect(layout).not.toBeNull();
    expect(callsNotFound(readFileSync(layout!, "utf8"))).toBe(true);
  });

  it("the [state] directory skeleton stays off the city pages", () => {
    expect(specialFile(path.join(APP, "(public)/fees/city/[state]"), "loading")).toBeNull();
    expect(specialFile(path.join(APP, "(public)/fees/city/[state]/(directory)"), "loading")).not.toBeNull();
  });
});

describe("the notFound() call check (#1267)", () => {
  it("does not count a mention in a comment or a string", () => {
    expect(callsNotFound("// calls notFound() when missing\nexport default 1;")).toBe(false);
    expect(callsNotFound("/** answers 404 through notFound() */\nexport default 1;")).toBe(false);
    expect(callsNotFound('const help = "use notFound() here";')).toBe(false);
    expect(callsNotFound("router.notFound();")).toBe(false);
  });

  it("counts a real call", () => {
    expect(callsNotFound("if (!row) notFound();")).toBe(true);
    expect(callsNotFound("if (!row) {\n  notFound( );\n}")).toBe(true);
    expect(callsNotFound('const url = "https://x"; if (!row) notFound();')).toBe(true);
  });
});
