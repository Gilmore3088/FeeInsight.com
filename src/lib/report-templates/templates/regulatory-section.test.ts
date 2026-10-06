import { describe, expect, it } from "vitest";
import { regulatoryExtras } from "./regulatory-section";
import type { RegulatoryContext } from "@/lib/report-assemblers/regulatory-context";

function context(overrides: Partial<RegulatoryContext> = {}): RegulatoryContext {
  return {
    windowDays: 180,
    feeReleases: [],
    enforcement: [],
    complaints: {
      latestYear: "2025",
      priorYear: "2024",
      total: 1200,
      priorTotal: 1000,
      feeRelated: 300,
      institutionCount: 40,
      sameInstitutions: { institutions: 38, total: 1200, priorTotal: 1000 },
      topProducts: [{ product: "Checking or savings account", count: 700 }],
      topInstitutions: [{ name: "First Example Bank", complaints: 250 }],
    },
    rules: [{ text: "An increase needs 30 days' notice.", source: { label: "Reg DD, 12 CFR 1030.5(a)" } }],
    beigeBook: { text: "Activity grew modestly.", releaseDate: "2026-09-03" },
    ...overrides,
  };
}

describe("regulatoryExtras", () => {
  it("shows complaints, the fee rules and the Beige Book line", () => {
    const html = regulatoryExtras(context(), "Tennessee");
    expect(html).toContain("1,200");
    expect(html).toContain("+20% vs 2024 at the same 38");
    expect(html).toContain("25%");
    expect(html).toContain("First Example Bank");
    expect(html).toContain("Reg DD, 12 CFR 1030.5(a)");
    expect(html).toContain("Activity grew modestly.");
  });

  it("shows no change when no institution is named in both years", () => {
    const base = context().complaints!;
    const html = regulatoryExtras(context({ complaints: { ...base, sameInstitutions: null } }), "Tennessee");
    expect(html).not.toContain("vs 2024");
  });

  it("says plainly when there are no complaint records", () => {
    expect(regulatoryExtras(context({ complaints: null, beigeBook: null }), "Tennessee")).toContain(
      "No CFPB complaint records are on file for Tennessee.",
    );
  });
});
