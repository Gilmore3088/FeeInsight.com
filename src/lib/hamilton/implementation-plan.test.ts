import { describe, expect, it } from "vitest";
import { buildImplementationPlan, changeDirection, earliestEffectiveDate } from "./implementation-plan";

const overdraft = { feeCategory: "overdraft", feeLabel: "Overdraft", charter: "bank" as const };

describe("changeDirection", () => {
  it("names the move", () => {
    expect(changeDirection(32, 35)).toBe("increase");
    expect(changeDirection(32, 25)).toBe("decrease");
    expect(changeDirection(32, 0)).toBe("eliminate");
    expect(changeDirection(32, 32)).toBe("none");
  });
});

describe("buildImplementationPlan", () => {
  it("requires 30 days of notice for an increase, citing Reg DD for a bank", () => {
    const plan = buildImplementationPlan({ ...overdraft, current: 32, proposed: 35 });
    expect(plan.advanceNoticeDays).toBe(30);
    expect(plan.noticeRule.label).toContain("1030.5");
  });

  it("requires no advance notice for a decrease or elimination", () => {
    expect(buildImplementationPlan({ ...overdraft, current: 32, proposed: 25 }).advanceNoticeDays).toBe(0);
    expect(buildImplementationPlan({ ...overdraft, current: 32, proposed: 0 }).advanceNoticeDays).toBe(0);
  });

  it("cites the NCUA rule for a credit union", () => {
    const plan = buildImplementationPlan({ ...overdraft, charter: "credit_union", current: 30, proposed: 35 });
    expect(plan.noticeRule.label).toContain("707.5");
  });

  it("adds the Reg E opt-in notice only for overdraft", () => {
    const od = buildImplementationPlan({ ...overdraft, current: 32, proposed: 25 });
    const nsf = buildImplementationPlan({ feeCategory: "nsf", feeLabel: "NSF", charter: "bank", current: 32, proposed: 25 });
    const has = (p: typeof od) => p.sections.some((s) => s.items.some((i) => i.rule?.label.includes("1005.17")));
    expect(has(od)).toBe(true);
    expect(has(nsf)).toBe(false);
  });

  it("points a business-only fee at the account agreement instead of the consumer rule", () => {
    const plan = buildImplementationPlan({ feeCategory: "night_deposit", feeLabel: "Night deposit", charter: "bank", current: 3, proposed: 5 });
    expect(plan.advanceNoticeDays).toBe(0);
    expect(plan.noticeSummary).toContain("business account agreement");
  });

  it("never recommends: no section or item tells the bank what to charge", () => {
    const plan = buildImplementationPlan({ ...overdraft, current: 32, proposed: 25 });
    const text = [plan.noticeSummary, ...plan.sections.flatMap((s) => s.items.map((i) => i.text))].join(" ");
    expect(text).not.toMatch(/recommend|should (raise|lower|charge)/i);
  });
});

describe("earliestEffectiveDate", () => {
  it("adds the notice days across a month end", () => {
    expect(earliestEffectiveDate("2026-10-15", 30)).toBe("2026-11-14");
  });
});
