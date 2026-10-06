import { describe, expect, it } from "vitest";
import { buildImplementationPlan } from "./implementation";
import { buildDeliverable, testedRows } from "./deliverables";
import { defaultWatches } from "./decisions";
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

const plan = buildImplementationPlan({ feeCategory: "overdraft", current: 32, chosen: 25, decidedOn: "2026-10-06", charterType: "credit_union", generatedAt: "2026-10-06T09:00:00Z" });

const open: DecisionRecord = {
  id: "d1",
  institutionId: 1,
  feeCategory: "overdraft",
  title: "Overdraft fee",
  status: "modeling",
  chosenAmount: null,
  chosenBy: null,
  watchConditions: [],
  createdAt: "2026-10-06T08:00:00Z",
  updatedAt: "2026-10-06T08:00:00Z",
};
const tested = [
  ev("scenario_tested", { tested: 25, positionAfter: 19, evidenceLevel: "market", revenueEffect: null }),
  ev("scenario_tested", { tested: 35, positionAfter: 94, evidenceLevel: "market", revenueEffect: null }),
];
const decided: DecisionRecord = { ...open, status: "decided", chosenAmount: 25, chosenBy: "Pat (CFO)", watchConditions: defaultWatches(research) };
const decidedEvents = [
  ...tested,
  ev("option_chosen", { amount: 25, positionAfter: 19, evidenceLevel: "institution", revenueEffect: { low: -75_600, high: -75_600 } }, "2026-10-06T10:00:00Z"),
  ev("plan_created", { plan }, "2026-10-06T10:00:00Z"),
];

describe("deliverables", () => {
  it("lists each tested price once, the latest result winning", () => {
    expect(testedRows(decidedEvents).map((r) => [r.tested, r.evidenceLevel])).toEqual([
      [25, "institution"],
      [35, "market"],
    ]);
  });

  it("a board memo before a choice sets out the options and says none was chosen", () => {
    const memo = buildDeliverable("board_memo", [{ decision: open, events: tested, research }], "2026-10-06T11:00:00Z");
    expect(memo.title).toBe("Board memo: Overdraft fee");
    expect(memo.sections.map((s) => s.heading)).toEqual([
      "Overdraft fee: what the market shows",
      "Why it sits there",
      "Options considered",
      "Management's choice",
    ]);
    expect(memo.sections[2].table?.rows).toEqual([
      ["$32 (today)", "", "", ""],
      ["$25", "19th percentile", "No dollar figure", "Market data only"],
      ["$35", "94th percentile", "No dollar figure", "Market data only"],
    ]);
    expect(memo.sections[3].paragraphs).toEqual(["Management has not chosen an option for the overdraft fee."]);
    expect(JSON.stringify(memo)).not.toMatch(/recommend|should/i);
  });

  it("after a choice, names who chose what and carries the plan and watches", () => {
    const memo = buildDeliverable("board_memo", [{ decision: decided, events: decidedEvents, research }], "2026-10-06T11:00:00Z");
    const byHeading = Object.fromEntries(memo.sections.map((s) => [s.heading, s]));
    expect(byHeading["Management's choice"].paragraphs).toEqual(["Management chose $25 for the overdraft fee on October 6, 2026 (Pat (CFO))."]);
    expect(byHeading["Implementation and compliance"].paragraphs[0]).toBe(`No advance notice is required; the earliest effective date is October 6, 2026.`);
    expect(byHeading["What would reopen this decision"].paragraphs).toHaveLength(3);
    expect(memo.sections[2].table?.rows[1]).toEqual(["$25", "19th percentile", "-$75.6 thousand a year", "Your figures"]);
    expect(memo.appendix[0].provenance.engineVersion).toBe("1.5.0");
  });

  it("an implementation checklist needs a choice", () => {
    expect(buildDeliverable("implementation_checklist", [{ decision: open, events: tested, research }]).sections[0].paragraphs[0]).toMatch(/has not chosen/);
    const list = buildDeliverable("implementation_checklist", [{ decision: decided, events: decidedEvents, research }]);
    expect(list.sections[0].heading).toBe("Overdraft fee: $32 to $25");
    expect(list.sections[0].checklist?.length).toBeGreaterThan(0);
  });

  it("a competitive appendix tables every market layer and the named competitors", () => {
    const appendix = buildDeliverable("competitive_appendix", [{ decision: open, events: tested, research }]);
    expect(appendix.sections[0].table?.rows[0]).toEqual(["National", "1,840", "$25", "$29", "$32"]);
    expect(appendix.sections[1].table?.rows.map((r) => r[1])).toEqual(["$25", "$30", "$35"]);
  });
});
