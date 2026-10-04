import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { TAXONOMY_COUNT, getSpotlightCategories } from "./fee-taxonomy";
import { getVisibleCategoryCount } from "./access";

/**
 * The fee catalog is a curated subset and no hard number is advertised.
 *
 * A count in copy is a promise that has to be maintained forever, and it goes stale the
 * moment a category is added or retired — which is exactly how the site came to claim
 * "49 fee categories" against a taxonomy of 65. Describe the coverage, never count it.
 *
 * See docs/plans/guides-remediation-plan-2026-08-15.md, item E-5.
 */

const SRC = join(process.cwd(), "src");

// Catches every form a count has appeared in: "49 fee categories", "all 65 categories",
// "49-category taxonomy", "6 of 49", `categories: 49`, `"total": 49`, and a bare stat tile
// whose number sits within a few lines of a "categories" label (checked separately below).
// A ranking ("top 10 fee categories") is a different claim and is allowed.
const COUNTED_CATEGORY_CLAIM = new RegExp(
  [
    // "49 fee categories", "49-category taxonomy", "all 65 categories"
    String.raw`(?<!\b(?:top|first|last|bottom|best|worst)\s)\b\d{2,}[-\s]+(?:canonical\s+|bank\s+|fee\s+|standardized\s+|base\s+|taxonomy\s+)?categor(?:y|ies)\b`,
    // "categories only (6 of 49)"
    String.raw`\bcategor(?:y|ies)\b[^\n]{0,16}?\(\s*\d+\s+of\s+\d{2,}\s*\)`,
    // `categories: 49` in a stats object
    String.raw`\bcategories\s*:\s*\d{2,}\b`,
  ].join("|"),
  "i",
);

// Bare stat tiles: a line that is only a two-digit number (optionally wrapped in one tag and
// a trailing `{" "}`), with a "categor…" label up to two lines before or three after. Catches
// `<p>49</p><p>Fee categories</p>` and the reverse order.
const BARE_STAT = /^\s*(?:<[^>]+>)?\s*(\d{2,})\s*(?:<\/[^>]+>)?\s*(?:\{" "\})?\s*$/;

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry === ".next") continue;
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...walk(full));
    } else if (/\.(ts|tsx)$/.test(entry) && !/\.test\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

describe("fee catalog is described, never counted", () => {
  it("has no hardcoded category count anywhere in src/", () => {
    const offenders: string[] = [];
    for (const file of walk(SRC)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, i) => {
        const rel = file.replace(process.cwd() + "/", "");
        if (COUNTED_CATEGORY_CLAIM.test(line)) {
          offenders.push(`${rel}:${i + 1}  ${line.trim()}`);
          return;
        }
        if (BARE_STAT.test(line)) {
          const window = [...lines.slice(Math.max(0, i - 2), i), ...lines.slice(i + 1, i + 4)].join(" ");
          if (/categor/i.test(window)) offenders.push(`${rel}:${i + 1}  ${line.trim()}  (bare stat above a category label)`);
        }
      });
    }
    expect(offenders).toEqual([]);
  });

  it("derives the visible category count from the taxonomy", () => {
    const spotlight = getSpotlightCategories().length;
    expect(getVisibleCategoryCount(null)).toBe(spotlight);
    expect(
      getVisibleCategoryCount({
        role: "admin",
        subscription_status: "active",
      } as Parameters<typeof getVisibleCategoryCount>[0]),
    ).toBe(TAXONOMY_COUNT);
  });

  it("keeps the spotlight set a strict subset of the taxonomy", () => {
    expect(getSpotlightCategories().length).toBeLessThan(TAXONOMY_COUNT);
  });
});
