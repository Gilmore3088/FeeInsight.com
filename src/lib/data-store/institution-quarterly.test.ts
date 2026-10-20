import { beforeEach, describe, expect, it, vi } from "vitest";

const calls: { text: string; values: unknown[] }[] = [];
vi.mock("./connection", () => ({
  getSql: vi.fn(),
  sql: vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    calls.push({ text: strings.join("$"), values });
    return Promise.resolve([
      { id: "7", name: "Bank A", city: null, state: "FL", total_assets: 1, service_charge_income: 1, total_revenue: 1, fee_income_ratio: 0.1 },
    ]);
  }),
}));

import { getFeeShareCohort, quarterKey } from "./institution-quarterly";

describe("quarterKey", () => {
  it("reads a quarter from text, compact text, a full ISO string or a Date", () => {
    expect(quarterKey("2026-06-30")).toBe("2026-06-30");
    expect(quarterKey("20260630")).toBe("2026-06-30");
    expect(quarterKey("2026-06-30T00:00:00.000Z")).toBe("2026-06-30");
    expect(quarterKey(new Date("2026-06-30T00:00:00Z"))).toBe("2026-06-30");
    expect(quarterKey("not a date")).toBeNull();
    expect(quarterKey(new Date("nope"))).toBeNull();
  });
});

describe("getFeeShareCohort report_date match", () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it("compares report_date as text so the (institution_id, report_date) index stays usable", async () => {
    const cohort = await getFeeShareCohort("commercial", "community_small", new Date("2026-06-30T00:00:00Z"), "fdic");
    expect(calls).toHaveLength(1);
    expect(calls[0].text).toMatch(/f\.report_date = \$::text/);
    expect(calls[0].text).not.toMatch(/report_date::date/);
    expect(calls[0].values).toContain("2026-06-30");
    expect(calls[0].values.some((value) => value instanceof Date)).toBe(false);
    expect(cohort?.report_date).toBe("2026-06-30");
    expect(cohort?.members[0].id).toBe(7);
  });

  it("binds the same YYYY-MM-DD text the column stores, whatever form the quarter arrives in", async () => {
    for (const input of ["2026-06-30", "20260630", "2026-06-30T00:00:00.000Z", new Date("2026-06-30T00:00:00Z")]) {
      await getFeeShareCohort("commercial", null, input, "ncua");
    }
    expect(calls).toHaveLength(4);
    for (const call of calls) expect(call.values).toContain("2026-06-30");
  });

  it("skips the read for an unknown source or an unreadable quarter", async () => {
    expect(await getFeeShareCohort("commercial", null, "2026-06-30", "ffiec")).toBeNull();
    expect(await getFeeShareCohort("commercial", null, "garbage", "fdic")).toBeNull();
    expect(calls).toHaveLength(0);
  });
});
