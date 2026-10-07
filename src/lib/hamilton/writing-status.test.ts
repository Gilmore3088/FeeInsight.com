import { describe, expect, it } from "vitest";
import { evaluateHamiltonWritingPolicies } from "./writing-status";

describe("evaluateHamiltonWritingPolicies", () => {
  it("is available only when every policy exists, is on, and has a cap", () => {
    expect(
      evaluateHamiltonWritingPolicies([
        { policy_key: "global:provider:default", enabled: true, has_cap: true },
        { policy_key: "agent:hamilton", enabled: true, has_cap: true },
        { policy_key: "route:api.reports.generate", enabled: true, has_cap: true },
      ]),
    ).toEqual({ available: true, blockingPolicies: [] });
  });

  it("names disabled, capless and missing policies", () => {
    expect(
      evaluateHamiltonWritingPolicies([
        { policy_key: "global:provider:default", enabled: true, has_cap: true },
        { policy_key: "agent:hamilton", enabled: false, has_cap: false },
      ]),
    ).toEqual({ available: false, blockingPolicies: ["agent:hamilton", "route:api.reports.generate"] });
  });
});
