import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A missing institution, district, state or city must answer 404, not 200 (#1165).
 * Next fixes the status at 200 as soon as a loading skeleton streams, so for these routes:
 * - no loading.tsx may sit in any folder from `app/` down to the route's own folder
 *   (its own loading.tsx is fine: it wraps only the page, inside the route's layout);
 * - the route's layout.tsx must run the existence check and call notFound().
 */
const APP = path.join(__dirname);

const ROUTES_WITH_404 = [
  "(public)/institution/[id]",
  "(public)/research/district/[id]",
  "(public)/fees/city/[state]",
  "(public)/fees/city/[state]/[city]",
];

function ancestorsOf(route: string): string[] {
  const parts = route.split("/");
  const dirs = [APP];
  for (let i = 0; i < parts.length - 1; i++) dirs.push(path.join(APP, ...parts.slice(0, i + 1)));
  return dirs;
}

describe("routes that answer 404 for a missing record", () => {
  it.each(ROUTES_WITH_404)("%s has no loading boundary above its layout", (route) => {
    const above = ancestorsOf(route).filter((dir) => existsSync(path.join(dir, "loading.tsx")));
    expect(above.map((dir) => path.relative(APP, dir) || "app")).toEqual([]);
  });

  it.each(ROUTES_WITH_404)("%s checks the record in its layout", (route) => {
    const layout = path.join(APP, route, "layout.tsx");
    expect(existsSync(layout)).toBe(true);
    expect(readFileSync(layout, "utf8")).toMatch(/notFound\(\)/);
  });

  it("the [state] directory skeleton stays off the city pages", () => {
    expect(existsSync(path.join(APP, "(public)/fees/city/[state]/loading.tsx"))).toBe(false);
    expect(existsSync(path.join(APP, "(public)/fees/city/[state]/(directory)/loading.tsx"))).toBe(true);
  });
});
