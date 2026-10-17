import { describe, expect, it } from "vitest";
import { gatedPageLabel, subscribeEntry, subscribeReason, subscribeReasonLine } from "./subscribe-reason";

describe("subscribeReason", () => {
  it("is activating only for a Stripe customer whose subscription hasn't ended", () => {
    expect(subscribeReason({ stripe_customer_id: "cus_1", subscription_status: "none" })).toBe("activating");
    expect(subscribeReason({ stripe_customer_id: "cus_1", subscription_status: "canceled" })).toBe("pro_required");
    expect(subscribeReason({ stripe_customer_id: null, subscription_status: "none" })).toBe("pro_required");
  });

  it("gives one plain line per reason and none for anything else", () => {
    expect(subscribeReasonLine("pro_required", "Fee Insight")).toBe("Choose a plan below to open Hamilton, the Fee Insight workspace.");
    expect(subscribeReasonLine("activating", "Fee Insight")).toContain("Refresh this page before paying again");
    expect(subscribeReasonLine("<script>", "Fee Insight")).toBeNull();
    expect(subscribeReasonLine(undefined, "Fee Insight")).toBeNull();
  });

  it("names the Pro page the reader was trying to open", () => {
    expect(subscribeReasonLine("pro_required", "Fee Insight", "/pro/news")).toBe(
      "You're one step away from Regulatory Wire. It's part of Hamilton, the Fee Insight workspace, and checkout brings you straight back to it.",
    );
    expect(gatedPageLabel("/pro/news/digest?week=1")).toBe("Regulatory Wire");
    expect(gatedPageLabel("/pro/simulate?instId=2945")).toBe("Try a price");
    expect(gatedPageLabel("/pro/newsroom")).toBeNull();
    expect(gatedPageLabel("/fees")).toBeNull();
    expect(subscribeReasonLine("pro_required", "Fee Insight", "/somewhere")).toBe("Choose a plan below to open Hamilton, the Fee Insight workspace.");
  });

  it("places the gated page inside Pro from a fixed list, never from URL text", () => {
    expect(subscribeEntry("/pro/news", "Fee Insight")).toEqual({
      page: "Regulatory Wire",
      context: "Regulatory Wire is included with Hamilton, the Fee Insight workspace",
    });
    expect(subscribeEntry("/pro/simulate?fee=nsf", "Fee Insight").context).toBe("Explore pricing scenarios with Hamilton, the Fee Insight workspace");
    expect(subscribeEntry("/pro/research", "Fee Insight")).toEqual({
      page: "My fees",
      context: "My fees is included with Hamilton, the Fee Insight workspace",
    });
    expect(subscribeEntry("/pro/hamilton", "Fee Insight").context).toBe("Hamilton, the Fee Insight workspace");
    const direct = "Discover everything included with Hamilton, the Fee Insight workspace";
    expect(subscribeEntry("/pro/<script>", "Fee Insight").context).toBe(direct);
    expect(subscribeEntry(null, "Fee Insight")).toEqual({ page: null, context: direct });
  });
});
