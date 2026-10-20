import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { PlanIncludes } from "./plans-exhibit";

describe("what every plan includes", () => {
  it("lists the index first, then the workspace, seats from the workspace limit", () => {
    const html = renderToStaticMarkup(<PlanIncludes />);
    expect(html).toContain("Full Bank Fee Index access");
    for (const label of ["Your institution", "Ask Hamilton", "Try a price", "Reports", "Regulatory Wire"]) {
      expect(html).toContain(label);
    }
    expect(html).toMatch(/Up to \d+ people/);
  });
});
