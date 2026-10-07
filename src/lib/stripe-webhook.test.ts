import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";


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
    expect(sql).toContain("subscription_status = 'canceled', past_due_since = NULL, role = 'viewer'");
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

  it("asks for one welcome email per newly activated subscriber", async () => {
    tx.mockResolvedValueOnce([{ id: 7, email: "a@b.com", display_name: "Pat" }]);
    const effects = await applyStripeEvent(
      tx as never,
      event("checkout.session.completed", { mode: "subscription", customer: "cus_9", metadata: { user_id: "7" } }),
    );
    expect(effects.welcome).toEqual([{ email: "a@b.com", name: "Pat" }]);
  });

  it("sends no welcome for renewals or a checkout that activated nobody", async () => {
    expect((await applyStripeEvent(tx as never, event("customer.subscription.updated", { customer: "cus_1", status: "active" }))).welcome).toEqual([]);
    expect((await applyStripeEvent(tx as never, event("checkout.session.completed", { mode: "subscription", customer: "cus_9", metadata: { user_id: "7" } }))).welcome).toEqual([]);
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

  describe("payment grace window (past_due_since)", () => {
    it("starts the window on the first failed payment and never resets it", async () => {
      await applyStripeEvent(tx as never, event("invoice.payment_failed", { customer: "cus_1" }));
      expect(issued()[0]).toContain("subscription_status = 'past_due', past_due_since = COALESCE(past_due_since, NOW())");
    });

    it("starts it when a subscription update reports past due, and clears it otherwise", async () => {
      await applyStripeEvent(tx as never, event("customer.subscription.updated", { customer: "cus_1", status: "past_due" }));
      expect(issued()[0]).toContain("WHEN ? = 'past_due' THEN COALESCE(past_due_since, NOW()) ELSE NULL");
    });

    it("clears it when Pro becomes active, by checkout or by update", async () => {
      await applyStripeEvent(tx as never, event("customer.subscription.updated", { customer: "cus_1", status: "active" }));
      await applyStripeEvent(
        tx as never,
        event("checkout.session.completed", { mode: "subscription", customer: "cus_9", metadata: { user_id: "7" } }),
      );
      for (const sql of issued().filter((text) => text.includes("UPDATE users"))) {
        expect(sql).toContain("past_due_since = NULL");
      }
    });

    it("clears it when the subscription ends", async () => {
      await applyStripeEvent(tx as never, event("customer.subscription.deleted", { customer: "cus_1" }));
      expect(issued()[0]).toContain("past_due_since = NULL");
    });
  });
});

describe("institution report payments", () => {
  beforeEach(() => {
    tx.mockReset();
    tx.mockResolvedValue([]);
  });

  const paidSession = (overrides: Record<string, unknown> = {}) =>
    event("checkout.session.completed", {
      id: "cs_test_1",
      mode: "payment",
      payment_status: "paid",
      amount_total: 30000,
      customer: null,
      metadata: { kind: "institution_report", lead_id: "18" },
      ...overrides,
    });

  it("marks the request paid once and queues the emails", async () => {
    tx.mockResolvedValueOnce([{ id: "18", name: "Pat Lee", email: "pat@example.com", quote_institution_id: "201" }]);
    const effects = await applyStripeEvent(tx as never, paidSession());
    const [sql] = issued();
    expect(sql).toContain("SET paid_at = NOW(), status = 'paid'");
    expect(sql).toContain("paid_at IS NULL");
    expect(effects.reportPaid).toEqual([
      { leadId: 18, name: "Pat Lee", email: "pat@example.com", institutionId: 201, cents: 30000, checkoutSessionId: "cs_test_1" },
    ]);
    expect(effects.welcome).toEqual([]);
  });

  it("never grants Pro for a report payment", async () => {
    await applyStripeEvent(tx as never, paidSession({ customer: "cus_1", metadata: { kind: "institution_report", lead_id: "18", user_id: "5" } }));
    expect(issued().join(" ")).not.toContain("users");
  });

  it("ignores an unpaid session and a missing lead id", async () => {
    await applyStripeEvent(tx as never, paidSession({ payment_status: "unpaid" }));
    await applyStripeEvent(tx as never, paidSession({ metadata: { kind: "institution_report" } }));
    expect(tx).not.toHaveBeenCalled();
  });

  it("sends nothing again for a session already recorded as the payment", async () => {
    tx.mockResolvedValueOnce([]).mockResolvedValueOnce([{ stripe_checkout_session_id: "cs_test_1" }]);
    const effects = await applyStripeEvent(tx as never, paidSession());
    expect(effects.reportPaid).toEqual([]);
    expect(effects.reportDuplicate).toEqual([]);
  });

  it("flags a second paid session for an already-paid request so James refunds it", async () => {
    tx.mockResolvedValueOnce([]).mockResolvedValueOnce([{ stripe_checkout_session_id: "cs_first" }]);
    const effects = await applyStripeEvent(tx as never, paidSession());
    expect(effects.reportDuplicate).toEqual([{ leadId: 18, cents: 30000, checkoutSessionId: "cs_test_1" }]);
  });
});
