import { describe, it, expect } from "vitest";
import { researchAttribution } from "./attribution";

describe("research conversion attribution", () => {
  it("carries a report view through signup, paid conversion and first analysis", () => {
    const data = new Map<string, string>();
    const storage = { getItem: (key: string) => data.get(key) ?? null, setItem: (key: string, value: string) => { data.set(key, value); } };
    researchAttribution("research_report_view", { report: "report-1" }, storage, 1000);
    for (const event of ["create_account", "checkout_complete", "research_analysis_complete"]) expect(researchAttribution(event, {}, storage, 2000)).toEqual({ research_origin: "report-1" });
    expect(researchAttribution("create_account", {}, storage, 1000 + 91 * 86400000)).toEqual({});
  });
  it("does not break conversion when storage is blocked", () => {
    const storage = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
    expect(researchAttribution("create_account", { variant: "default" }, storage)).toEqual({ variant: "default" });
  });
});
