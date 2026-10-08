import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const sqlMock = vi.hoisted(() => vi.fn());
const listMock = vi.hoisted(() => vi.fn());
vi.mock("@/lib/data-store/connection", () => ({ sql: sqlMock }));
vi.mock("@/lib/stripe", () => ({ getStripe: () => ({ subscriptions: { list: listMock } }) }));

import { checkConsultantReportCap, isCappedConsultant, reportCapMessage } from "./report-cap";

const user = { id: 7, stripe_customer_id: "cus_1" };

function subscription(metadata: Record<string, string>, priceId: string) {
  return { data: [{ metadata, items: { data: [{ price: { id: priceId } }] } }] };
}

describe("consultant report cap", () => {
  beforeEach(() => {
    sqlMock.mockReset();
    listMock.mockReset();
    vi.stubEnv("STRIPE_PRO_LARGE_MONTHLY_PRICE_ID", "price_large_m");
    vi.stubEnv("STRIPE_PRO_LARGE_ANNUAL_PRICE_ID", "price_large_a");
  });
  afterEach(() => vi.unstubAllEnvs());

  it("allows the 10th report and blocks the 11th for a consultant on the $3,000 plan", async () => {
    listMock.mockResolvedValue(subscription({ organization: "other", pro_tier: "mid" }, "price_mid_a"));
    sqlMock.mockResolvedValueOnce([{ used: 9 }]);
    expect(await checkConsultantReportCap(user)).toMatchObject({ allowed: true, used: 9, limit: 10 });
    sqlMock.mockResolvedValueOnce([{ used: 10 }]);
    const blocked = await checkConsultantReportCap(user);
    expect(blocked).toMatchObject({ allowed: false, limit: 10 });
    expect(reportCapMessage(blocked)).toContain("10 Hamilton reports a month");
    expect(reportCapMessage(blocked)).toContain("$5,000 a year");
  });

  it("counts only this month's reports for this user", async () => {
    listMock.mockResolvedValue(subscription({ organization: "other" }, "price_mid_m"));
    sqlMock.mockResolvedValueOnce([{ used: 0 }]);
    await checkConsultantReportCap(user);
    const [strings, ...values] = sqlMock.mock.calls[0];
    expect((strings as string[]).join("?")).toContain("date_trunc('month'");
    expect((strings as string[]).join("?")).toContain("'hamilton-report'");
    expect(values).toEqual([7]);
  });

  it("does not cap bank plans, consultants moved to the upgrade price, or accounts without Stripe", async () => {
    listMock.mockResolvedValueOnce(subscription({ institution_id: "12", pro_tier: "small" }, "price_small_a"));
    expect(await isCappedConsultant(user)).toBe(false);
    listMock.mockResolvedValueOnce(subscription({ organization: "other" }, "price_large_a"));
    expect(await isCappedConsultant(user)).toBe(false);
    expect(await isCappedConsultant({ stripe_customer_id: null })).toBe(false);
    expect(listMock).toHaveBeenCalledTimes(2);
  });

  it("lets the report go ahead when Stripe can't be read", async () => {
    listMock.mockRejectedValueOnce(new Error("stripe down"));
    expect(await checkConsultantReportCap(user)).toMatchObject({ allowed: true, limit: null });
    expect(sqlMock).not.toHaveBeenCalled();
  });
});
