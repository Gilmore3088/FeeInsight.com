import { describe, it, expect } from "vitest";
import { GUIDES, getGuide } from "./guides";
import { FEE_FAMILIES, DISPLAY_NAMES } from "./fee-taxonomy";

const TAXONOMY_CATEGORIES = new Set(Object.values(FEE_FAMILIES).flat());

describe("guides catalog", () => {
  it("has unique slugs", () => {
    const slugs = GUIDES.map((g) => g.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it("uses url-safe slugs", () => {
    for (const guide of GUIDES) {
      expect(guide.slug).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });

  it("resolves every slug through getGuide", () => {
    for (const guide of GUIDES) {
      expect(getGuide(guide.slug)?.slug).toBe(guide.slug);
    }
    expect(getGuide("not-a-guide")).toBeUndefined();
  });

  // Regression guard: guide fee categories are joined against the published fee
  // catalog to render live benchmarks. A category that is not in the taxonomy
  // never matches a summary row, so the guide silently loses a benchmark card,
  // a sidebar entry and an "Explore the Data" tile with no build or runtime error.
  it("references only fee categories that exist in the taxonomy", () => {
    const invalid: string[] = [];
    for (const guide of GUIDES) {
      for (const category of guide.feeCategories) {
        if (!TAXONOMY_CATEGORIES.has(category)) {
          invalid.push(`${guide.slug} -> ${category}`);
        }
      }
    }
    expect(invalid).toEqual([]);
  });

  it("references only fee categories that have a display name", () => {
    for (const guide of GUIDES) {
      for (const category of guide.feeCategories) {
        expect(DISPLAY_NAMES[category], `missing display name for ${category}`).toBeTruthy();
      }
    }
  });

  it("declares at least one fee category per guide, without duplicates", () => {
    for (const guide of GUIDES) {
      expect(guide.feeCategories.length).toBeGreaterThan(0);
      expect(new Set(guide.feeCategories).size).toBe(guide.feeCategories.length);
    }
  });

  it("has a title, description and at least one section per guide", () => {
    for (const guide of GUIDES) {
      expect(guide.title.trim().length).toBeGreaterThan(0);
      expect(guide.description.trim().length).toBeGreaterThan(0);
      expect(guide.sections.length).toBeGreaterThan(0);
      for (const section of guide.sections) {
        expect(section.heading.trim().length).toBeGreaterThan(0);
        expect(section.content.trim().length).toBeGreaterThan(0);
      }
    }
  });
});
