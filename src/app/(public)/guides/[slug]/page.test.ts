import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { generateStaticParams } from "./page";

const source = readFileSync(join(__dirname, "page.tsx"), "utf8");

/** The module each runtime (non-type) import in `code` comes from. */
function runtimeImports(code: string): string[] {
  return [...code.matchAll(/^import\s+(?!type\s)[\s\S]*?\sfrom\s+["']([^"']+)["'];?$/gm)].map((match) => match[1]);
}

describe("/guides/[slug] reads", () => {
  // 2026-10-09-builds-prerendered-guides-against-prod: every deploy, previews included,
  // prerendered all ten guides against the production database with a cold cache.
  it("prerenders no guide at build time", async () => {
    expect(await generateStaticParams()).toEqual([]);
  });

  // 2026-10-09-guide-pages-skipped-public-cache: the page called the uncached data-store reads,
  // so each rebuild ran its own catalog aggregates instead of sharing the fee pages' entries.
  it("reads catalog data only through the public cache", () => {
    const dataStore = runtimeImports(source).filter((module) => module.startsWith("@/lib/data-store/"));
    expect(dataStore).toEqual(["@/lib/data-store/public-cached-reads"]);
  });

  // #1811: "Fee data updated" printed the newest document crawl, which publishes nothing.
  it("dates the fee data by the public snapshot's publish date, never a crawl date", () => {
    expect(source).not.toContain("last_crawl_at");
    expect(source).toContain("summary.refreshedOn");
  });

  it("finds runtime imports and skips type-only ones", () => {
    const code = [
      'import { getDataFreshness } from "@/lib/data-store/core";',
      "import {",
      "  getFeeCategoryGuideDetailCached,",
      '} from "@/lib/data-store/public-cached-reads";',
      'import type { FeeCategorySummary } from "@/lib/data-store/fees";',
    ].join("\n");
    expect(runtimeImports(code)).toEqual(["@/lib/data-store/core", "@/lib/data-store/public-cached-reads"]);
  });
});
