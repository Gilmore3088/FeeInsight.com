import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/hamilton/institution-membership", () => ({
  acceptPendingWorkspaceInvitationsForUser: vi.fn(async () => []),
}));

import { applyStripeEvent, mapStripeStatus } from "./stripe-webhook";

const tx = vi.fn();
const issued = () => tx.mock.calls.map((call) => (call[0] as TemplateStringsArray).join("?").replace(/\s+/g, " "));

function event(type: string, object: Record<string, unknown>): Stripe.Event {
  return { id: "evt_1", type, data: { object } } as unknown as Stripe.Event;
}

describe("mapStripeStatus", () => {
  it.each([
    ["active", "active"],
    ["trialing", "active"],
    ["past_due", "past_due"],
    ["unpaid", "past_due"],
    ["paused", "past_due"],
    ["canceled", "canceled"],
    ["incomplete_expired", "canceled"],
    ["incomplete", "none"],
  ])("%s -> %s", (input, expected) => {
    expect(mapStripeStatus(input)).toBe(expected);
  });
});

describe("applyStripeEvent", () => {
  beforeEach(() => {
    tx.mockReset();
    tx.mockResolvedValue([]);
  });

  it("returns a cancelled subscriber to a free viewer", async () => {
    await applyStripeEvent(tx as never, event("customer.subscription.deleted", { customer: "cus_1" }));
    const [sql] = issued();
    expect(sql).toContain("subscription_status = 'canceled', role = 'viewer'");
    expect(sql).toContain("role IN ('viewer', 'premium')");
  });

  it("treats an update to canceled the same way", async () => {
    await applyStripeEvent(tx as never, event("customer.subscription.updated", { customer: "cus_1", status: "canceled" }));
    expect(issued()[0]).toContain("role = 'viewer'");
  });

  it("marks a paused subscription past due without touching the role", async () => {
    await applyStripeEvent(tx as never, event("customer.subscription.updated", { customer: "cus_1", status: "paused" }));
    const [sql] = issued();
    expect(sql).toContain("SET subscription_status = ?");
    expect(sql).not.toContain("role");
    expect(tx.mock.calls[0][1]).toBe("past_due");
  });

  it("restores Pro when a subscription becomes active again", async () => {
    await applyStripeEvent(tx as never, event("customer.subscription.updated", { customer: "cus_1", status: "active" }));
    expect(issued()[0]).toContain("CASE WHEN role = 'viewer' THEN 'premium' ELSE role END");
  });

  it("activates checkout by the user id it was started for", async () => {
    await applyStripeEvent(
      tx as never,
      event("checkout.session.completed", { mode: "subscription", customer: "cus_9", metadata: { user_id: "7", email: "a@b.com" } }),
    );
    const [sql] = issued();
    expect(sql).toContain("WHERE id = ?");
    expect(tx.mock.calls[0]).toContain(7);
  });

  it("falls back to the email for older sessions", async () => {
    await applyStripeEvent(tx as never, event("checkout.session.completed", { mode: "subscription", customer: "cus_9", customer_email: "a@b.com" }));
    expect(issued()[0]).toContain("WHERE (email = ? OR username = ?)");
  });

  it("never grants Pro for a one-time payment checkout", async () => {
    await applyStripeEvent(
      tx as never,
      event("checkout.session.completed", { mode: "payment", customer: "cus_9", metadata: { user_id: "7" } }),
    );
    expect(tx).not.toHaveBeenCalled();
  });
});
