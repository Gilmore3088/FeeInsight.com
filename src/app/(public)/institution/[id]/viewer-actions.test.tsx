import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * #1811: the profile is cached for every visitor, so Pro data is read only by these per-request
 * actions, and only for a Pro session.
 */
const reads = vi.hoisted(() => ({
  user: vi.fn(),
  history: vi.fn(),
  subscription: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: reads.user }));
vi.mock("@/lib/access", () => ({ canAccessPremium: (user: { pro?: boolean } | null) => Boolean(user?.pro) }));
vi.mock("@/lib/data-store/alerts", () => ({ getAlertSubscriptionForInstitution: reads.subscription }));
vi.mock("@/lib/data-store/financial", () => ({
  getFinancialHistory: reads.history,
  getPeerFinancialMedians: vi.fn(async () => null),
  getPeerPercentiles: vi.fn(async () => null),
}));
vi.mock("@/lib/data-store/regulatory-watch", () => ({ getRegulatoryWatch: vi.fn(async () => ({ state: "WA" })) }));
vi.mock("./financial-profile-section", () => ({ FinancialProfileSection: () => null }));

import { loadAlertSubscription, loadProFinancialProfile } from "./viewer-actions";

const input = { institutionId: 82, institutionName: "WaFd Bank", charterLabel: "Bank" };

beforeEach(() => {
  reads.user.mockReset();
  reads.history.mockReset().mockResolvedValue([]);
  reads.subscription.mockReset().mockResolvedValue({ fee_categories: ["nsf"] });
});

describe("loadProFinancialProfile", () => {
  it("reads nothing and returns nothing for a signed-out or free visitor", async () => {
    for (const user of [null, { id: 1, pro: false }]) {
      reads.user.mockResolvedValue(user);
      await expect(loadProFinancialProfile(input)).resolves.toBeNull();
    }
    expect(reads.history).not.toHaveBeenCalled();
  });

  it("renders the section for a Pro session", async () => {
    reads.user.mockResolvedValue({ id: 1, pro: true });
    await expect(loadProFinancialProfile(input)).resolves.not.toBeNull();
    expect(reads.history).toHaveBeenCalledWith(82);
  });

  it("rejects an id that is not a positive integer", async () => {
    reads.user.mockResolvedValue({ id: 1, pro: true });
    await expect(loadProFinancialProfile({ ...input, institutionId: Number.NaN })).resolves.toBeNull();
    expect(reads.history).not.toHaveBeenCalled();
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
