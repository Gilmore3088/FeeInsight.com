import { describe, expect, it } from "vitest";
import { encodeLandingResearch } from "./landing-research-handoff";
import { hamiltonNavigationSelection, hrefWithHamiltonNavigation } from "./navigation-context";

describe("Hamilton navigation context contracts", () => {
  const local = hamiltonNavigationSelection("/pro/research", new URLSearchParams("instId=8109"));

  it("carries a canonical subject only on Hamilton subject routes", () => {
    expect(hrefWithHamiltonNavigation("/pro/reports?intent=reports#builder", local)).toBe("/pro/reports?intent=reports&instId=8109#builder");
    for (const href of ["/pro/news", "/pro/data", "/account", "/admin", "/banks", "https://example.test/pro/reports"]) {
      expect(hrefWithHamiltonNavigation(href, local)).toBe(href);
    }
  });

  it("preserves destinations with explicit scope or frozen saved records", () => {
    for (const href of ["/pro/reports?report_id=saved-a", "/pro/analyze?analysis=saved-a", "/pro/simulate?scenario_id=saved-a", "/pro/reports?instId=1535", "/pro/analyze?research=existing"]) {
      expect(hrefWithHamiltonNavigation(href, local)).toBe(href);
    }
    expect(hamiltonNavigationSelection("/pro/reports", new URLSearchParams("report_id=saved-a&instId=1535")).institutionId).toBeNull();
  });

  it("keeps local research categories and charter when adapting the destination task", () => {
    const research = { version: 1, task: "compare", scope: { kind: "local", institutionId: 8109 }, categories: ["money_order"], charter: "credit_union" };
    const selection = hamiltonNavigationSelection("/pro/analyze", new URLSearchParams({ research: encodeLandingResearch(research) }));
    expect(JSON.parse(new URL(hrefWithHamiltonNavigation("/pro/reports", selection), "https://example.test").searchParams.get("research")!))
      .toEqual({ ...research, task: "board_report" });
    expect(hrefWithHamiltonNavigation("/pro/research", selection)).toBe("/pro/research?instId=8109");
  });

  it("never substitutes a local/default subject for invalid or nonlocal research", () => {
    const invalid = hamiltonNavigationSelection("/pro/analyze", new URLSearchParams("research=invalid&instId=8109"));
    expect(invalid.invalid).toBe(true);
    expect(hrefWithHamiltonNavigation("/pro/reports", invalid)).toBe("/pro/reports");
    const research = { version: 1, task: "compare", scope: { kind: "state", stateCode: "FL" }, categories: ["money_order"], charter: "credit_union" };
    const state = hamiltonNavigationSelection("/pro/analyze", new URLSearchParams({ research: encodeLandingResearch(research) }));
    expect(state.institutionId).toBeNull();
    expect(hrefWithHamiltonNavigation("/pro/research", state)).toBe("/pro/research");
    expect(JSON.parse(new URL(hrefWithHamiltonNavigation("/pro/reports", state), "https://example.test").searchParams.get("research")!))
      .toEqual({ ...research, task: "board_report" });
  });
});
