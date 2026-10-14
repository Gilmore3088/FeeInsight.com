import type Stripe from "stripe";
import { beforeEach, describe, expect, it, vi } from "vitest";

const { listSubscriptions, retrievePaymentIntent } = vi.hoisted(() => ({
  listSubscriptions: vi.fn(), retrievePaymentIntent: vi.fn(),
}));
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({ subscriptions: { list: listSubscriptions }, paymentIntents: { retrieve: retrievePaymentIntent } }),
}));

import { applyStripeEvent, mapStripeStatus, recordStripeEvent } from "./stripe-webhook";

const tx = vi.fn();
const issued = () => tx.mock.calls.map((call) => (call[0] as TemplateStringsArray).join("?").replace(/\s+/g, " ").trim());
const updates = () => issued().filter((query) => query.includes("SET subscription_status"));
function event(type: string, object: Record<string, unknown>): Stripe.Event {
  return { id: "evt_1", type, data: { object } } as unknown as Stripe.Event;
}
const subscriptionInvoice = { customer: "cus_1", parent: { type: "subscription_details", subscription_details: { subscription: "sub_1" } } };
const live = (status: string) => ({ data: [{ id: "sub_current", status }], has_more: false });
let linked: { id: number; email: string; display_name: string | null; subscription_status: string } | null = null;

describe("mapStripeStatus", () => {
  it.each([
    ["active", "active"], ["trialing", "active"], ["past_due", "past_due"],
    ["unpaid", "past_due"], ["paused", "past_due"], ["canceled", "canceled"],
    ["incomplete_expired", "canceled"], ["incomplete", "none"],
  ])("%s -> %s", (input, expected) => expect(mapStripeStatus(input)).toBe(expected));
});

describe("subscription events reconcile authoritative customer state", () => {
  beforeEach(() => {
    linked = null;
    tx.mockReset();
    tx.mockImplementation(async (strings: TemplateStringsArray) =>
      strings.join("?").includes("RETURNING id, email, display_name, subscription_status") && linked ? [linked] : [],
    );
    listSubscriptions.mockReset();
    listSubscriptions.mockResolvedValue(live("active"));
  });

  it("does not let an older failed invoice undo payment recovery", async () => {
    await applyStripeEvent(tx as never, event("customer.subscription.updated", { customer: "cus_1", status: "active" }));
    await applyStripeEvent(tx as never, event("invoice.payment_failed", subscriptionInvoice));
    expect(updates()).toHaveLength(2);
    for (const query of updates()) expect(query).toContain("subscription_status = 'active'");
  });

  it("does not let an older active snapshot resurrect a canceled account", async () => {
    listSubscriptions.mockResolvedValue({ data: [], has_more: false });
    await applyStripeEvent(tx as never, event("customer.subscription.deleted", { id: "sub_1", customer: "cus_1" }));
    await applyStripeEvent(tx as never, event("customer.subscription.updated", { id: "sub_1", customer: "cus_1", status: "active" }));
    expect(updates()).toHaveLength(2);
    for (const query of updates()) expect(query).toContain("subscription_status = 'canceled'");
  });

  it("keeps access when any other current subscription is active", async () => {
    listSubscriptions.mockResolvedValue({ data: [{ id: "sub_old", status: "canceled" }, { id: "sub_new", status: "active" }], has_more: false });
    await applyStripeEvent(tx as never, event("customer.subscription.deleted", { id: "sub_old", customer: "cus_1" }));
    expect(updates()[0]).toContain("subscription_status = 'active'");
  });

  it("locks the customer before fetching the state, then writes within the caller's transaction", async () => {
    const order: string[] = [];
    tx.mockImplementation(async (strings: TemplateStringsArray) => { order.push(strings.join("?").includes("pg_advisory_xact_lock") ? "lock" : "write"); return []; });
    listSubscriptions.mockImplementation(async () => { order.push("fetch"); return live("active"); });
    await applyStripeEvent(tx as never, event("customer.subscription.updated", { customer: "cus_1", status: "canceled" }));
    expect(order).toEqual(["lock", "fetch", "write"]);
    expect(tx.mock.calls[0]).toContain("feeinsight:billing:cus_1");
  });

  it("fails without a state write when Stripe is unavailable so the transaction can roll back", async () => {
    listSubscriptions.mockRejectedValue(new Error("stripe down"));
    await expect(applyStripeEvent(tx as never, event("customer.subscription.deleted", { customer: "cus_1" }))).rejects.toThrow("stripe down");
    expect(updates()).toEqual([]);
  });

  it.each(["active", "past_due", "canceled", "incomplete"])("never changes staff rows while reconciling %s", async (status) => {
    listSubscriptions.mockResolvedValue(live(status));
    await applyStripeEvent(tx as never, event("customer.subscription.updated", { customer: "cus_1", status }));
    expect(updates()[0]).toContain("AND role IN ('viewer', 'premium')");
  });

  it("starts the grace period only on the first current payment failure", async () => {
    listSubscriptions.mockResolvedValue(live("past_due"));
    await applyStripeEvent(tx as never, event("invoice.payment_failed", subscriptionInvoice));
    expect(updates()[0]).toContain("past_due_since = COALESCE(past_due_since, NOW())");
  });

  it("reconciles invoice.paid to clear payment failure without requiring another event", async () => {
    await applyStripeEvent(tx as never, event("invoice.paid", subscriptionInvoice));
    expect(updates()[0]).toContain("past_due_since = NULL");
    expect(updates()[0]).toContain("subscription_status = 'active'");
  });

  it("ignores unrelated one-time invoices, both paid and failed", async () => {
    await applyStripeEvent(tx as never, event("invoice.payment_failed", { customer: "cus_1" }));
    await applyStripeEvent(tx as never, event("invoice.paid", { customer: "cus_1" }));
    expect(tx).not.toHaveBeenCalled();
    expect(listSubscriptions).not.toHaveBeenCalled();
  });

  it("accepts the subscription reference in older invoice payloads", async () => {
    await applyStripeEvent(tx as never, event("invoice.paid", { customer: "cus_1", subscription: "sub_old_api" }));
    expect(updates()).toHaveLength(1);
  });

  it("welcomes a newly activated checkout and anchors its institution", async () => {
    linked = { id: 7, email: "a@b.com", display_name: "Pat", subscription_status: "none" };
    const effects = await applyStripeEvent(tx as never, event("checkout.session.completed", {
      id: "cs_1", mode: "subscription", payment_status: "paid", customer: "cus_1", metadata: { user_id: "7", institution_id: "8109" },
    }));
    expect(effects.welcome).toEqual([{ email: "a@b.com", name: "Pat" }]);
    expect(issued().join("\n")).toContain("INSERT INTO institution_claims");
    expect(issued().join("\n")).toContain("INSERT INTO institution_workspace_memberships");
    expect(issued()[1]).toContain("stripe_customer_id IS NULL OR stripe_customer_id = ?");
  });

  it("does not re-send a welcome for an already active customer", async () => {
    linked = { id: 7, email: "a@b.com", display_name: null, subscription_status: "active" };
    const effects = await applyStripeEvent(tx as never, event("checkout.session.completed", { mode: "subscription", customer: "cus_1", metadata: { user_id: "7" } }));
    expect(effects.welcome).toEqual([]);
  });

  it("does not reactivate or welcome a delayed checkout after cancellation", async () => {
    linked = { id: 7, email: "a@b.com", display_name: null, subscription_status: "canceled" };
    listSubscriptions.mockResolvedValue({ data: [], has_more: false });
    const effects = await applyStripeEvent(tx as never, event("checkout.session.completed", { mode: "subscription", payment_status: "paid", customer: "cus_1", metadata: { user_id: "7" } }));
    expect(effects.welcome).toEqual([]);
    expect(updates()[0]).toContain("subscription_status = 'canceled'");
  });

  it("supports a paid zero-dollar subscription without a payment method", async () => {
    linked = { id: 7, email: "a@b.com", display_name: null, subscription_status: "none" };
    const effects = await applyStripeEvent(tx as never, event("checkout.session.completed", { mode: "subscription", payment_status: "no_payment_required", customer: "cus_1", metadata: { user_id: "7" } }));
    expect(effects.welcome).toHaveLength(1);
  });

  it("uses legacy email linking without allowing replacement of a different customer", async () => {
    await applyStripeEvent(tx as never, event("checkout.session.completed", { mode: "subscription", customer: "cus_1", customer_email: "a@b.com" }));
    expect(issued()[1]).toContain("WHERE (email = ? OR username = ?)");
    expect(issued()[1]).toContain("stripe_customer_id IS NULL OR stripe_customer_id = ?");
  });

  it("grants nothing for an unpaid subscription checkout or a one-time purchase", async () => {
    await applyStripeEvent(tx as never, event("checkout.session.completed", { mode: "subscription", payment_status: "unpaid", customer: "cus_1" }));
    await applyStripeEvent(tx as never, event("checkout.session.completed", { mode: "payment", payment_status: "paid", customer: "cus_1" }));
    expect(tx).not.toHaveBeenCalled();
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

  it("marks the request paid from a paid report invoice", async () => {
    tx.mockResolvedValueOnce([{ id: "18", name: "Pat Lee", email: "pat@example.com", quote_institution_id: "201" }]);
    const effects = await applyStripeEvent(
      tx as never,
      event("invoice.paid", { id: "in_1", status: "paid", amount_paid: 30000, metadata: { kind: "institution_report", lead_id: "18" } }),
    );
    expect(issued()[0]).toContain("SET paid_at = NOW(), status = 'paid'");
    expect(effects.reportPaid).toEqual([
      { leadId: 18, name: "Pat Lee", email: "pat@example.com", institutionId: 201, cents: 30000, checkoutSessionId: "in_1" },
    ]);
  });

  it("ignores subscription invoices and never marks Pro past due for a failed report invoice", async () => {
    await applyStripeEvent(tx as never, event("invoice.paid", { id: "in_2", status: "paid", amount_paid: 15000, metadata: {} }));
    await applyStripeEvent(
      tx as never,
      event("invoice.payment_failed", { id: "in_3", customer: "cus_1", metadata: { kind: "institution_report", lead_id: "18" } }),
    );
    expect(tx).not.toHaveBeenCalled();
  });

  it("flags a second paid session for an already-paid request so James refunds it", async () => {
    tx.mockResolvedValueOnce([]).mockResolvedValueOnce([{ stripe_checkout_session_id: "cs_first" }]);
    const effects = await applyStripeEvent(tx as never, paidSession());
    expect(effects.reportDuplicate).toEqual([{ leadId: 18, cents: 30000, checkoutSessionId: "cs_test_1" }]);
  });
});

describe("institution report refunds", () => {
  beforeEach(() => {
    tx.mockReset();
    tx.mockResolvedValue([]);
    retrievePaymentIntent.mockReset();
    retrievePaymentIntent.mockResolvedValue({ metadata: { kind: "institution_report", lead_id: "23" } });
  });

  const refund = (overrides: Record<string, unknown> = {}) =>
    event("charge.refunded", { id: "ch_1", refunded: true, amount_refunded: 100, payment_intent: "pi_1", metadata: {}, ...overrides });

  it("marks a fully refunded report request refunded once and queues James's alert", async () => {
    tx.mockResolvedValueOnce([{ id: "23", name: "Pat Lee", email: "pat@example.com" }]);
    const effects = await applyStripeEvent(tx as never, refund());
    expect(retrievePaymentIntent).toHaveBeenCalledWith("pi_1");
    const [sql] = issued();
    expect(sql).toContain("SET refunded_at = NOW(), status = 'refunded'");
    expect(sql).toContain("paid_at IS NOT NULL AND refunded_at IS NULL");
    expect(tx.mock.calls[0].slice(1)).toEqual([23]);
    expect(effects.reportRefunded).toEqual([{ leadId: 23, name: "Pat Lee", email: "pat@example.com", cents: 100, chargeId: "ch_1" }]);
  });

  it("reads the request from the charge itself when it carries the report metadata", async () => {
    await applyStripeEvent(tx as never, refund({ metadata: { kind: "institution_report", lead_id: "23" } }));
    expect(retrievePaymentIntent).not.toHaveBeenCalled();
    expect(tx.mock.calls[0].slice(1)).toEqual([23]);
  });

  it("leaves a partly refunded report paid", async () => {
    const effects = await applyStripeEvent(tx as never, refund({ refunded: false, amount_refunded: 50 }));
    expect(tx).not.toHaveBeenCalled();
    expect(effects.reportRefunded).toEqual([]);
  });

  it("ignores refunds of anything that isn't a report, such as a Pro charge", async () => {
    retrievePaymentIntent.mockResolvedValue({ metadata: {} });
    const effects = await applyStripeEvent(tx as never, refund());
    expect(tx).not.toHaveBeenCalled();
    expect(effects.reportRefunded).toEqual([]);
  });

  it("alerts nothing for a redelivered refund of a request already marked refunded", async () => {
    const effects = await applyStripeEvent(tx as never, refund());
    expect(effects.reportRefunded).toEqual([]);
  });
});

describe("recordStripeEvent", () => {
  beforeEach(() => tx.mockReset());

  it("writes the event id to prod's stripe_event_id column", async () => {
    tx.mockResolvedValue([{ id: 1 }]);
    expect(await recordStripeEvent(tx as never, event("checkout.session.completed", {}))).toBe(true);
    const [sql] = issued();
    expect(sql).toContain("INSERT INTO stripe_events (stripe_event_id, event_type)");
    expect(sql).toContain("ON CONFLICT (stripe_event_id) DO NOTHING");
    expect(tx.mock.calls[0].slice(1)).toEqual(["evt_1", "checkout.session.completed"]);
  });

  it("reports a redelivered event as already processed", async () => {
    tx.mockResolvedValue([]);
    expect(await recordStripeEvent(tx as never, event("checkout.session.completed", {}))).toBe(false);
  });
});
