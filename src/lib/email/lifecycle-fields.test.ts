import { describe, expect, it, vi } from "vitest";
import { lifecycleFields, scopeFromUseCase, type LifecycleDeps } from "./lifecycle-fields";

const finding = { key: "overdraft", figure: "$30", headline: "The St. Louis district median overdraft fee", detail: "Median across 120 institutions.", exhibit: "benchmarks" };

function deps(overrides: Partial<LifecycleDeps> = {}): LifecycleDeps {
  return {
    loadFinding: vi.fn().mockResolvedValue(finding),
    institutionName: vi.fn().mockResolvedValue("Capital City Bank"),
    ...overrides,
  };
}

describe("lifecycle fields", () => {
  it("names the exact district report asked for, with its first finding", async () => {
    const d = deps();
    const fields = await lifecycleFields([{ source: "report_district", use_case: "benchmark-report; scope=district-8; src=reports" }], d);
    expect(fields.report_name).toBe("the St. Louis district Fee Benchmark Report");
    expect(fields.report_url).toMatch(/\/reports\/benchmark\/district-8$/);
    expect(fields.report_finding).toBe("The St. Louis district median overdraft fee: $30. Median across 120 institutions.");
    expect(d.loadFinding).toHaveBeenCalledWith({ kind: "district", district: 8 });
  });

  it("uses the newest request, and the sample report for the homepage form", async () => {
    const fields = await lifecycleFields([
      { source: "report_national", use_case: "benchmark-report; scope=national", created_at: "2026-10-01" },
      { source: "capture_homepage", use_case: "placement=homepage", created_at: "2026-10-10" },
    ], deps());
    expect(fields.report_name).toBe("the sample Competitive Fee Position Report");
    expect(fields.report_url).toMatch(/\/reports\/sample-competitive-fee-position$/);
    expect(fields.report_finding).toBeNull();
  });

  it("leaves the finding out when it can't be read", async () => {
    const fields = await lifecycleFields(
      [{ source: "report_national", use_case: "benchmark-report; scope=national" }],
      deps({ loadFinding: vi.fn().mockRejectedValue(new Error("down")) }),
    );
    expect(fields.report_name).toBe("the National Fee Benchmark Report");
    expect(fields.report_finding).toBeNull();
  });

  it("names the institution or state a follower chose", async () => {
    expect(await lifecycleFields([{ source: "capture_institution", use_case: "placement=institution; institution_id=323; state=FL" }], deps()))
      .toMatchObject({ follow_name: "Capital City Bank", follow_url: expect.stringMatching(/\/institution\/323$/) });
    expect(await lifecycleFields([{ source: "capture_state", use_case: "placement=state; state=GA" }], deps()))
      .toMatchObject({ follow_name: "Georgia", follow_url: expect.stringMatching(/\/research\/state\/GA$/) });
  });

  it("fills nothing for sources with no report or follow", async () => {
    expect(Object.values(await lifecycleFields([{ source: "newsletter", use_case: "state=TX" }], deps())).every((v) => v === null)).toBe(true);
    expect(scopeFromUseCase("benchmark-report; scope=district-13")).toBeNull();
  });
});
