import { describe, expect, it } from "vitest";
import type { FeeCategorySummary } from "@/lib/data-store/fees";
import {
  REPORT_REQUEST_HREF,
  SAMPLE_REPORT_HREF,
  computeRules,
  money,
  nextAction,
  pickExampleBenchmark,
  pipelineStages,
} from "./methodology-view";

function category(overrides: Partial<FeeCategorySummary>): FeeCategorySummary {
  return {
    fee_category: "overdraft",
    institution_count: 40,
    total_observations: 60,
    min_amount: 0,
    max_amount: 40,
    avg_amount: 28,
    median_amount: 30,
    p25_amount: 25,
    p75_amount: 35,
    bank_count: 20,
    cu_count: 20,
    zero_count: 2,
    bank_median_amount: null,
    cu_median_amount: null,
    ...overrides,
  };
}

describe("pipelineStages", () => {
  const all = { monitored: 1000, scheduleLinks: 600, institutions: 250, observations: 4321 };

  it("runs the six steps in pipeline order", () => {
    expect(pipelineStages(all).map((s) => s.key)).toEqual(["log", "find", "read", "extract", "verify", "publish"]);
  });

  it("never names a pipeline agent in visitor text", () => {
    const text = JSON.stringify(pipelineStages(all));
    expect(text).not.toMatch(/Atlas|Magellan|Rosetta|Knox|Darwin|Deming|Hamilton/);
  });

  it("puts each live count on its stage, with institution shares of the monitored total", () => {
    const stages = Object.fromEntries(pipelineStages(all).map((s) => [s.key, s.figures]));
    expect(stages.log).toEqual([]);
    expect(stages.find).toEqual([
      { value: "1,000", label: "institutions monitored", share: null },
      { value: "600", label: "with a schedule link on file", share: 60 },
    ]);
    expect(stages.publish).toEqual([
      { value: "4,321", label: "published fee entries", share: null },
      { value: "250", label: "institutions with published fees", share: 25 },
    ]);
  });

  it("never shows a number on a stage with no public read", () => {
    const stages = pipelineStages(all);
    for (const key of ["log", "read", "extract", "verify"]) {
      expect(stages.find((s) => s.key === key)!.figures).toEqual([]);
    }
  });

  it("drops a failed or zero read instead of printing 0", () => {
    const stages = pipelineStages({ monitored: null, scheduleLinks: 0, institutions: null, observations: null });
    expect(stages.every((s) => s.figures.length === 0)).toBe(true);
  });

  it("shows a count without its bar when the monitored total is unknown", () => {
    const find = pipelineStages({ ...all, monitored: null }).find((s) => s.key === "find")!;
    expect(find.figures).toEqual([{ value: "600", label: "with a schedule link on file", share: null }]);
  });
});

describe("money", () => {
  it("drops cents on whole dollars", () => {
    expect(money(35)).toBe("$35");
    expect(money(2.5)).toBe("$2.50");
  });
});

describe("pickExampleBenchmark", () => {
  it("prefers overdraft and places the median inside the middle half", () => {
    const example = pickExampleBenchmark([category({ fee_category: "wire_domestic_outgoing", institution_count: 900 }), category({})])!;
    expect(example.category).toBe("overdraft");
    expect(example.label).toBe("Overdraft");
    expect(example).toMatchObject({ median: "$30", low: "$25", high: "$35", institutions: "40", axisMax: "$50" });
    expect(example.lowPct).toBe(50);
    expect(example.highPct).toBe(70);
    expect(example.medianPct).toBe(60);
  });

  it("falls back to the strong category with the most institutions", () => {
    const example = pickExampleBenchmark([
      category({ fee_category: "overdraft", median_amount: null }),
      category({ fee_category: "atm_non_network", institution_count: 120, median_amount: 3, p25_amount: 2.5, p75_amount: 3.5 }),
      category({ fee_category: "stop_payment", institution_count: 80 }),
    ])!;
    expect(example.category).toBe("atm_non_network");
    expect(example.median).toBe("$3");
  });

  it("skips provisional benchmarks and returns null when nothing qualifies", () => {
    expect(pickExampleBenchmark([category({ institution_count: 19 })])).toBeNull();
    expect(pickExampleBenchmark([])).toBeNull();
  });

  it("carries the unstated-audience asterisk test", () => {
    expect(pickExampleBenchmark([category({ unstated_audience_institution_count: 3 })])!.unstatedAudience).toBe(true);
    expect(pickExampleBenchmark([category({})])!.unstatedAudience).toBe(false);
  });
});

describe("computeRules", () => {
  it("keeps the #audience anchor other pages link to", () => {
    expect(computeRules(false).map((r) => r.id)).toContain("audience");
  });

  it("does not claim the sibling rule while its switch is off", () => {
    const off = computeRules(false).find((r) => r.id === "siblings")!;
    expect(off.status).toBe("Not live yet");
    expect(off.line).toMatch(/are meant to count as one institution/);
    const on = computeRules(true).find((r) => r.id === "siblings")!;
    expect(on.status).toBeNull();
    expect(on.line).not.toMatch(/meant to/);
  });

  it("opens only the audience detail by default, the #audience landing", () => {
    expect(computeRules(false).filter((r) => r.open).map((r) => r.id)).toEqual(["audience"]);
  });

  it("uses no em dashes in visible copy", () => {
    const text = computeRules(false).flatMap((r) => [r.title, r.line, ...r.detail, r.status ?? ""]);
    const stageText = pipelineStages({ monitored: 1, scheduleLinks: 1, institutions: 1, observations: 1 }).flatMap((s) => [
      s.title,
      s.body,
      s.output,
    ]);
    expect([...text, ...stageText].join(" ")).not.toMatch(/—/);
  });
});

describe("nextAction", () => {
  it("links the sample report when it is live", () => {
    expect(nextAction(true)).toEqual({ href: SAMPLE_REPORT_HREF, label: "See the sample report", event: "see_sample_report" });
  });

  it("falls back to the report request tagged for this page", () => {
    expect(nextAction(false).href).toBe(REPORT_REQUEST_HREF);
    expect(REPORT_REQUEST_HREF).toBe("/reports?report=institution&src=methodology#request");
  });
});
