import { describe, expect, it } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { LandingResearchResults } from "./LandingResearchResults";
import type { LandingResearchHandoff } from "@/lib/hamilton/landing-research-handoff";

const selection: LandingResearchHandoff = {
  version: 1, task: "compare",
  scope: { kind: "state", stateCode: "DC" },
  charter: "credit_union",
  categories: ["cashiers_check", "paper_statement", "money_order", "stop_payment"],
};

describe("landing comparison review pane", () => {
  it("shows DC, charter, and all selected fee categories without executing research on render", () => {
    const markup = renderToStaticMarkup(createElement(LandingResearchResults, { selection }));
    expect(markup).toContain("DC fee comparison");
    expect(markup).toContain("Credit unions");
    expect(markup).toContain("Run comparison");
    expect(markup).toContain("automatically");
    expect(markup).not.toContain("<textarea");
    expect(markup).not.toContain("Download PDF");
  });

  it("keeps local subject and its category selection visible before manual confirmation", () => {
    const local: LandingResearchHandoff = {
      ...selection, scope: { kind: "local", institutionId: 101 },
      charter: "all", categories: ["paper_statement"],
    };
    const markup = renderToStaticMarkup(createElement(LandingResearchResults, { selection: local }));
    expect(markup).toContain("Local branch market");
    expect(markup).toContain("Paper");
    expect(markup).toContain("Run comparison");
  });
});
