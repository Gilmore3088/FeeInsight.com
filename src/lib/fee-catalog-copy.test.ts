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

// Matches "49 fee categories", "all 65 categories", "49 Fee Categories".
// A ranking ("top 10 fee categories") is a different claim and is allowed.
const COUNTED_CATEGORY_CLAIM =
  /(?<!\b(?:top|first|last|bottom|best|worst)\s)\b\d{2,}\s+(?:canonical\s+|bank\s+|fee\s+)?categor(?:y|ies)\b/i;

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
        if (COUNTED_CATEGORY_CLAIM.test(line)) {
          offenders.push(`${file.replace(process.cwd() + "/", "")}:${i + 1}  ${line.trim()}`);
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
