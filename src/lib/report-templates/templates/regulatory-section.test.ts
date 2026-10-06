import { describe, expect, it } from "vitest";
import { renderRegulatorySection } from "./regulatory-section";
import type { RegulatoryContext } from "@/lib/report-assemblers/regulatory-context";

function context(overrides: Partial<RegulatoryContext> = {}): RegulatoryContext {
  return {
    windowDays: 180,
    feeReleases: [
      { source: "CFPB", title: "CFPB issues rule on <overdraft> fees", link: "https://example.gov/a", publishedAt: "2026-09-01" },
    ],
    enforcement: [
      { source: "OCC", title: "OCC announces consent order", link: "https://example.gov/b", publishedAt: "2026-08-15" },
    ],
    complaints: {
      latestYear: "2025",
      priorYear: "2024",
      total: 1200,
      priorTotal: 1000,
      feeRelated: 300,
      institutionCount: 40,
      topProducts: [{ product: "Checking or savings account", count: 700 }],
      topInstitutions: [{ name: "First Example Bank", complaints: 250 }],
    },
    rules: [{ text: "An increase needs 30 days' notice.", source: { label: "Reg DD, 12 CFR 1030.5(a)" } }],
    beigeBook: { text: "Activity grew modestly.", releaseDate: "2026-09-03" },
    ...overrides,
  };
}

describe("renderRegulatorySection", () => {
  it("should_list_releases_enforcement_complaints_and_rules", () => {
    const html = renderRegulatorySection(context(), { number: "03", place: "Tennessee" });
    expect(html).toContain("Regulation and Complaints");
    expect(html).toContain("CFPB issues rule on &lt;overdraft&gt; fees");
    expect(html).toContain("OCC announces consent order");
    expect(html).toContain("1,200");
    expect(html).toContain("+20% vs 2024");
    expect(html).toContain("25%");
    expect(html).toContain("First Example Bank");
    expect(html).toContain("Reg DD, 12 CFR 1030.5(a)");
    expect(html).toContain("Activity grew modestly.");
  });

  it("should_say_plainly_when_a_part_is_empty", () => {
    const html = renderRegulatorySection(
      context({ feeReleases: [], enforcement: [], complaints: null, beigeBook: null }),
      { number: "03", place: "Tennessee" },
    );
    expect(html).toContain("No Federal Reserve, FDIC, OCC or CFPB release");
    expect(html).toContain("No enforcement action");
    expect(html).toContain("No CFPB complaint records are on file for Tennessee.");
  });
});
