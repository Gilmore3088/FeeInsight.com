import { describe, expect, it } from "vitest";
import { gatedPageLabel, subscribeEntry, subscribeReason, subscribeReasonLine } from "./subscribe-reason";

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

  it("names the Pro page the reader was trying to open", () => {
    expect(subscribeReasonLine("pro_required", "Fee Insight", "/pro/news")).toBe(
      "You're one step away from Regulatory Wire. It's part of Fee Insight Pro, and checkout brings you straight back to it.",
    );
    expect(gatedPageLabel("/pro/news/digest?week=1")).toBe("Regulatory Wire");
    expect(gatedPageLabel("/pro/simulate?instId=2945")).toBe("Try a price");
    expect(gatedPageLabel("/pro/newsroom")).toBeNull();
    expect(gatedPageLabel("/fees")).toBeNull();
    expect(subscribeReasonLine("pro_required", "Fee Insight", "/somewhere")).toContain("Hamilton is part of");
  });

  it("places the gated page inside Pro from a fixed list, never from URL text", () => {
    expect(subscribeEntry("/pro/news", "Fee Insight")).toEqual({
      page: "Regulatory Wire",
      context: "Regulatory Wire is included with Fee Insight Pro",
    });
    expect(subscribeEntry("/pro/simulate?fee=nsf", "Fee Insight").context).toBe("Explore pricing scenarios with Fee Insight Pro");
    expect(subscribeEntry("/pro/research", "Fee Insight")).toEqual({
      page: "My fees",
      context: "My fees is included with Fee Insight Pro",
    });
    const direct = "Discover everything included with Fee Insight Pro";
    expect(subscribeEntry("/pro/<script>", "Fee Insight").context).toBe(direct);
    expect(subscribeEntry(null, "Fee Insight")).toEqual({ page: null, context: direct });
  });
});
