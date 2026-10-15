import { describe, expect, it } from "vitest";
import { buildDeliverable, testedRows } from "./deliverables";
import { overdraftResearch } from "./test-fixtures";
import type { DecisionEvent, DecisionRecord } from "./types";

const research = overdraftResearch();
const ev = (kind: DecisionEvent["kind"], detail: Record<string, unknown>, at = "2026-10-06T09:00:00Z"): DecisionEvent => ({
  id: `${kind}-${at}-${JSON.stringify(detail).length}`,
  decisionId: "d1",
  kind,
  detail,
  actor: "user:7",
  at,
});

const open: DecisionRecord = {
  id: "d1",
  institutionId: 1,
  feeCategory: "overdraft",
  title: "Overdraft fee",
  status: "modeling",
  createdAt: "2026-10-06T08:00:00Z",
  updatedAt: "2026-10-06T08:00:00Z",
};
const tested = [
  ev("scenario_tested", { tested: 25, positionAfter: 19, evidenceLevel: "market", revenueEffect: null }),
  ev("scenario_tested", { tested: 35, positionAfter: 94, evidenceLevel: "market", revenueEffect: null }),
];
describe("deliverables", () => {
  it("lists each tested price once, the latest result winning", () => {
    const retested = [...tested, ev("scenario_tested", { tested: 25, positionAfter: 19, evidenceLevel: "institution", revenueEffect: { low: -75_600, high: -75_600 } }, "2026-10-06T10:00:00Z")];
    expect(testedRows(retested).map((r) => [r.tested, r.evidenceLevel])).toEqual([
      [25, "institution"],
      [35, "market"],
    ]);
  });

  it("a board memo sets out the options considered and takes no side", () => {
    const memo = buildDeliverable("board_memo", [{ decision: open, events: tested, research }], "2026-10-06T11:00:00Z");
    expect(memo.title).toBe("Board memo: Overdraft fee");
    expect(memo.sections.map((s) => s.heading)).toEqual([
      "Overdraft fee: what the market shows",
      "Why it sits there",
      "Options considered",
    ]);
    expect(memo.sections[2].table?.rows).toEqual([
      ["$32 (today)", "", "", ""],
      ["$25", "19th percentile", "No dollar figure", "Market data only"],
      ["$35", "94th percentile", "No dollar figure", "Market data only"],
    ]);
    expect(JSON.stringify(memo)).not.toMatch(/recommend|should|chose|chosen/i);
    expect(memo.appendix[0].provenance.engineVersion).toBe("1.12.1");
  });

  it("no deliverable mentions a choice, a plan or a watch, which could never be recorded (#1083)", () => {
    for (const kind of ["ceo_onepager", "board_memo", "pricing_packet", "competitive_appendix", "regulatory_summary"] as const) {
      const text = JSON.stringify(buildDeliverable(kind, [{ decision: open, events: tested, research }]));
      expect(text).not.toMatch(/Management's choice|has not chosen|effective date|reopen this decision/);
    }
  });

  it("a competitive appendix tables every market layer and the named competitors", () => {
    const appendix = buildDeliverable("competitive_appendix", [{ decision: open, events: tested, research }]);
    expect(appendix.sections[0].table?.rows[0]).toEqual(["National", "1,840", "$25", "$29", "$32"]);
    expect(appendix.sections[1].table?.rows.map((r) => r[1])).toEqual(["$25", "$30", "$35"]);
  });
});
