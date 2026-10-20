import { readFileSync } from "fs";
import { join } from "path";
import { describe, expect, it } from "vitest";

// The sitemap is DB-bound, so this checks its source: pages we deliberately keep out of
// search must not creep back in.
const source = readFileSync(join(process.cwd(), "src/app/sitemap.ts"), "utf8");

describe("sitemap contents", () => {
  it("does not list individual report pages, which are noindex until they carry a summary", () => {
    expect(source).not.toMatch(/`\/reports\/\$\{/);
  });
});

describe("gated research", () => {
  it("keeps fully Pro-gated research pages out of the sitemap", () => {
    expect(source).not.toContain("/research/fee-revenue-analysis");
    expect(source).not.toContain("/research/market-concentration");
  });
});

describe("sitemap speed", () => {
  it("renders on request, never during next build, so a busy database cannot fail a deploy", () => {
    expect(source).toContain('export const dynamic = "force-dynamic";');
    expect(source).not.toMatch(/export const revalidate\b/);
    expect(source).not.toContain("force-static");
  });

  it("is served from a cached copy rather than rebuilt on every request", () => {
    expect(source).toMatch(/const SITEMAP_CACHE_SECONDS = \d+;/);
    expect(source).toContain("unstable_cache(");
  });

  it("loads city pages in one query instead of one per state", () => {
    expect(source).not.toContain("getCitiesInState");
    expect(source).toContain("getTopCitiesByState");
  });
});
