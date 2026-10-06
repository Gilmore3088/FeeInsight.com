import { describe, expect, it } from "vitest";
import { buildImplementationPlan, priceDirection } from "./implementation";

describe("buildImplementationPlan", () => {
  it("requires 30 days' notice for an increase and counts the date from the decision", () => {
    const plan = buildImplementationPlan({ feeCategory: "wire_domestic_outgoing", current: 25, chosen: 30, decidedOn: "2026-10-06", charterType: "bank" });
    expect(plan.direction).toBe("increase");
    expect(plan.noticeRequiredDays).toBe(30);
    expect(plan.earliestEffectiveDate).toBe("2026-11-05");
    expect(plan.notice[0].rule?.label).toBe("Reg DD, 12 CFR 1030.5(a)");
  });

  it("needs no advance notice for a decrease and cites the credit union rule", () => {
    const plan = buildImplementationPlan({ feeCategory: "overdraft", current: 30, chosen: 25, decidedOn: "2026-10-06", charterType: "credit_union" });
    expect(plan.noticeRequiredDays).toBe(0);
    expect(plan.earliestEffectiveDate).toBe("2026-10-06");
    expect(plan.notice[0].rule?.label).toContain("707.5(a)");
    expect(plan.notice.some((s) => s.rule?.label === "Reg E, 12 CFR 1005.17")).toBe(true);
  });

  it("adds the Reg E notice for an ATM fee increase", () => {
    const plan = buildImplementationPlan({ feeCategory: "atm_non_network", current: 2.5, chosen: 3, decidedOn: "2026-10-06", charterType: "bank" });
    expect(plan.notice.some((s) => s.rule?.label === "Reg E, 12 CFR 1005.8(a)")).toBe(true);
  });

  it("treats a $0 price as eliminating the fee", () => {
    expect(priceDirection(30, 0)).toBe("eliminate");
    const plan = buildImplementationPlan({ feeCategory: "nsf", current: 30, chosen: 0, decidedOn: "2026-10-06", charterType: "bank" });
    expect(plan.systems[0].text).toContain("retire");
  });

  it("never phrases the plan as advice to change the fee", () => {
    const plan = buildImplementationPlan({ feeCategory: "overdraft", current: 30, chosen: 35, decidedOn: "2026-10-06", charterType: "bank" });
    const text = JSON.stringify(plan).toLowerCase();
    expect(text).not.toMatch(/recommend|you should|we suggest/);
  });
});
