import { describe, expect, it } from "vitest";
import { COVERAGE_LABELS } from "@/lib/public-stats";
import { aboutCoverageStats } from "./coverage-stats";

describe("About coverage figures (#1179)", () => {
  it("shows the shared snapshot's counts under the shared coverage names", () => {
    const stats = aboutCoverageStats({ institutionsLabel: "A", observationsLabel: "B", categoriesLabel: "C", statesLabel: "D" });
    expect(stats).toEqual([
      { value: "A", label: COVERAGE_LABELS.institutions },
      { value: "B", label: COVERAGE_LABELS.observations },
      { value: "C", label: COVERAGE_LABELS.categories },
      { value: "D", label: "States" },
    ]);
    expect(stats.map((s) => s.label).join(" ")).not.toMatch(/verified/i);
  });
});
