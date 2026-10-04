import { describe, expect, it } from "vitest";
import { canAccessApiKey, canAccessPremium, canExportData, isInPaymentGrace, isPaymentLapsed } from "./access";
import type { User } from "./auth";

const premiumUser: User = {
  id: 1,
  username: "pro-user",
  display_name: "Pro User",
  role: "premium",
  email: "pro@example.com",
  stripe_customer_id: "cus_123",
  subscription_status: "active",
  institution_name: null,
  institution_type: null,
  asset_tier: null,
  state_code: null,
  fed_district: null,
  job_role: null,
  interests: null,
};

describe("access policy", () => {
  it("keeps app/export access separate from self-serve API key controls", () => {
    expect(canAccessPremium(premiumUser)).toBe(true);
    expect(canExportData(premiumUser)).toBe(true);
    expect(canAccessApiKey(premiumUser)).toBe(false);
  });
});

describe("past_due grace window", () => {
  const now = new Date("2026-10-10T12:00:00Z");
  const pastDue = (daysAgo: number | null): User => ({
    ...premiumUser,
    subscription_status: "past_due",
    past_due_since: daysAgo === null ? null : new Date(now.getTime() - daysAgo * 86_400_000).toISOString(),
  });

  it("keeps access through day 6 and lapses after 7 days", () => {
    expect(isInPaymentGrace(pastDue(6), now)).toBe(true);
    expect(isPaymentLapsed(pastDue(6), now)).toBe(false);
    expect(isInPaymentGrace(pastDue(8), now)).toBe(false);
    expect(isPaymentLapsed(pastDue(8), now)).toBe(true);
  });

  it("grants grace when the start is unknown (before the migration)", () => {
    expect(isInPaymentGrace(pastDue(null), now)).toBe(true);
  });

  it("does not apply to active or canceled subscriptions", () => {
    expect(isInPaymentGrace(premiumUser, now)).toBe(false);
    expect(isPaymentLapsed({ ...premiumUser, subscription_status: "canceled" }, now)).toBe(false);
    expect(canAccessPremium({ ...premiumUser, subscription_status: "canceled" })).toBe(false);
  });
});
