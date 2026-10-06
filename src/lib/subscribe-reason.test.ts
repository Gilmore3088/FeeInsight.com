import { describe, expect, it } from "vitest";
import { subscribeReason, subscribeReasonLine } from "./subscribe-reason";

describe("subscribeReason", () => {
  it("is activating only for a Stripe customer whose subscription hasn't ended", () => {
    expect(subscribeReason({ stripe_customer_id: "cus_1", subscription_status: "none" })).toBe("activating");
    expect(subscribeReason({ stripe_customer_id: "cus_1", subscription_status: "canceled" })).toBe("pro_required");
    expect(subscribeReason({ stripe_customer_id: null, subscription_status: "none" })).toBe("pro_required");
  });

  it("gives one plain line per reason and none for anything else", () => {
    expect(subscribeReasonLine("pro_required", "Fee Insight")).toBe("Hamilton is part of Fee Insight Pro. Choose a plan below to open it.");
    expect(subscribeReasonLine("activating", "Fee Insight")).toContain("Refresh this page before paying again");
    expect(subscribeReasonLine("<script>", "Fee Insight")).toBeNull();
    expect(subscribeReasonLine(undefined, "Fee Insight")).toBeNull();
  });
});
