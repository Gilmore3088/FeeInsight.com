import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1811: the profile is cached for every visitor, so Pro data is read only by these per-request
 * actions, and only for a Pro session.
 */
const reads = vi.hoisted(() => ({
  user: vi.fn(),
  history: vi.fn(),
  peers: vi.fn(),
  percentiles: vi.fn(),
  watch: vi.fn(),
  subscription: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: reads.user }));
vi.mock("@/lib/access", () => ({ canAccessPremium: (user: { pro?: boolean } | null) => Boolean(user?.pro) }));
vi.mock("@/lib/data-store/alerts", () => ({ getAlertSubscriptionForInstitution: reads.subscription }));
vi.mock("@/lib/data-store/financial", () => ({
  getFinancialHistory: reads.history,
  getPeerFinancialMedians: reads.peers,
  getPeerPercentiles: reads.percentiles,
}));
vi.mock("@/lib/data-store/regulatory-watch", () => ({ getRegulatoryWatch: reads.watch }));

import { loadAlertSubscription, loadProFinancialProfile } from "./viewer-actions";

const input = { institutionId: 82, institutionName: "WaFd Bank", charterLabel: "Bank" };

beforeEach(() => {
  reads.user.mockReset();
  reads.history.mockReset().mockResolvedValue([]);
  reads.peers.mockReset().mockResolvedValue(null);
  reads.percentiles.mockReset().mockResolvedValue(null);
  reads.watch.mockReset().mockResolvedValue(null);
  reads.subscription.mockReset().mockResolvedValue({ fee_categories: ["nsf"] });
});

describe("loadProFinancialProfile", () => {
  it("reads nothing and returns nothing for a signed-out or free visitor", async () => {
    for (const user of [null, { id: 1, pro: false }]) {
      reads.user.mockResolvedValue(user);
      await expect(loadProFinancialProfile(input)).resolves.toBeNull();
    }
    for (const read of [reads.history, reads.peers, reads.percentiles, reads.watch]) {
      expect(read).not.toHaveBeenCalled();
    }
  });

  it("returns chart-ready JSON data for a Pro session, without a React tree in the action response", async () => {
    reads.user.mockResolvedValue({ id: 1, pro: true });
    reads.history.mockResolvedValue([
      { report_date: "2026-03-31", source: "fdic", total_assets: 1_000_000, net_income: 2_000, service_charge_income: 1_000, roa: 1 },
      { report_date: "2026-06-30", source: "fdic", total_assets: 1_100_000, net_income: 2_200, service_charge_income: 1_100, roa: 1.1 },
    ]);
    const data = await loadProFinancialProfile(input);
    expect(data).toMatchObject({
      institutionId: 82,
      points: [
        { quarter: "Q1 2026", assets: 1_000_000_000, serviceCharges: 1_000_000 },
        { quarter: "Q2 2026", assets: 1_100_000_000, serviceCharges: 1_100_000 },
      ],
      insights: { growth: expect.arrayContaining([expect.objectContaining({ key: "assets" })]) },
    });
    expect(data?.insights.growth.find((row) => row.key === "assets")?.qoq).toBeCloseTo(10);
    // React elements lose their symbol/function fields in JSON. The action contract must
    // survive this round trip unchanged so it never serializes a missing client reference.
    expect(JSON.parse(JSON.stringify(data))).toEqual(data);
    for (const read of [reads.history, reads.peers, reads.percentiles, reads.watch]) {
      expect(read).toHaveBeenCalledWith(82);
    }
  });

  it("returns nothing when the institution has no financial or watch evidence", async () => {
    reads.user.mockResolvedValue({ id: 1, pro: true });
    await expect(loadProFinancialProfile(input)).resolves.toBeNull();
  });

  it("does not start Pro reads when the session lookup fails", async () => {
    reads.user.mockRejectedValue(new Error("session unavailable"));
    await expect(loadProFinancialProfile(input)).resolves.toBeNull();
    for (const read of [reads.history, reads.peers, reads.percentiles, reads.watch]) {
      expect(read).not.toHaveBeenCalled();
    }
  });

  it("rejects an id that is not a positive integer", async () => {
    reads.user.mockResolvedValue({ id: 1, pro: true });
    for (const institutionId of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1, 1.5]) {
      await expect(loadProFinancialProfile({ ...input, institutionId })).resolves.toBeNull();
    }
    expect(reads.user).not.toHaveBeenCalled();
    for (const read of [reads.history, reads.peers, reads.percentiles, reads.watch]) {
      expect(read).not.toHaveBeenCalled();
    }
  });
});

describe("loadAlertSubscription", () => {
  it("is signed out without a session", async () => {
    reads.user.mockResolvedValue(null);
    await expect(loadAlertSubscription(82)).resolves.toEqual({ signedIn: false, saved: false, feeCategories: null });
    expect(reads.subscription).not.toHaveBeenCalled();
  });

  it("returns the reader's own alert", async () => {
    reads.user.mockResolvedValue({ id: 7 });
    await expect(loadAlertSubscription(82)).resolves.toEqual({ signedIn: true, saved: true, feeCategories: ["nsf"] });
    expect(reads.subscription).toHaveBeenCalledWith(7, 82);
  });
});
