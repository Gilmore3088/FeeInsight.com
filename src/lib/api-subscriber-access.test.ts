import { describe, expect, it } from "vitest";
import {
  apiIncludedInTier,
  subscriberKeyAllowed,
  subscriberOrgSlug,
  subscriberUserIdFromSlug,
} from "./api-subscriber-access";
import { organizationSlug } from "./api-keys";

describe("subscriber key rules", () => {
  it("includes the API on the $300 and $500 plans only", () => {
    expect(apiIncludedInTier("small")).toBe(false);
    expect(apiIncludedInTier("mid")).toBe(true);
    expect(apiIncludedInTier("large")).toBe(true);
    expect(apiIncludedInTier(null)).toBe(false);
  });

  it("round-trips the subscriber organization and never matches a hand-made partner slug", () => {
    expect(subscriberUserIdFromSlug(subscriberOrgSlug(42))).toBe(42);
    expect(subscriberUserIdFromSlug(organizationSlug("pro-user-42"))).toBeNull();
    expect(subscriberUserIdFromSlug("pro-user-")).toBeNull();
    expect(subscriberUserIdFromSlug("pro-user-4x")).toBeNull();
    expect(subscriberUserIdFromSlug(null)).toBeNull();
  });

  it("keeps a key working while Pro is active or a failed card is in grace, and stops it after", () => {
    const now = new Date("2026-10-16T00:00:00Z");
    expect(subscriberKeyAllowed({ subscription_status: "active" }, now)).toBe(true);
    expect(subscriberKeyAllowed({ subscription_status: "past_due", past_due_since: "2026-10-14T00:00:00Z" }, now)).toBe(true);
    expect(subscriberKeyAllowed({ subscription_status: "past_due", past_due_since: "2026-10-01T00:00:00Z" }, now)).toBe(false);
    expect(subscriberKeyAllowed({ subscription_status: "canceled" }, now)).toBe(false);
    expect(subscriberKeyAllowed({ subscription_status: "none" }, now)).toBe(false);
    expect(subscriberKeyAllowed(null, now)).toBe(false);
  });
});
