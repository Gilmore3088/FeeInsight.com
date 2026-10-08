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
  it("is served from cache rather than rebuilt on every request", () => {
    expect(source).toMatch(/export const revalidate = \d+;/);
    expect(source).toContain('export const dynamic = "force-static";');
  });

  it("loads city pages in one query instead of one per state", () => {
    expect(source).not.toContain("getCitiesInState");
    expect(source).toContain("getTopCitiesByState");
  });
});
