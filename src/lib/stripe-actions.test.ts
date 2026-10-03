import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  stripeCheckoutCreateMock: vi.fn(),
  headersMock: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({
  getCurrentUser: mocks.getCurrentUserMock,
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: vi.fn(() => ({
    checkout: {
      sessions: {
        create: mocks.stripeCheckoutCreateMock,
      },
    },
    billingPortal: {
      sessions: {
        create: vi.fn(),
      },
    },
  })),
}));

vi.mock("@/lib/stripe-customer", () => ({
  ensureStripeCustomer: vi.fn(async () => "cus_lazy"),
}));

vi.mock("next/headers", () => ({
  headers: mocks.headersMock,
}));

vi.mock("next/navigation", () => ({
  redirect: vi.fn((url: string) => {
    throw new Error(`redirect:${url}`);
  }),
}));

function user(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    username: "owner@example.com",
    email: "owner@example.com",
    stripe_customer_id: null,
    ...overrides,
  };
}

describe("createCheckoutSession", () => {
  beforeEach(() => {
    mocks.getCurrentUserMock.mockReset();
    mocks.stripeCheckoutCreateMock.mockReset();
    mocks.headersMock.mockReset();
    mocks.getCurrentUserMock.mockResolvedValue(user());
    mocks.headersMock.mockResolvedValue(new Map([["origin", "https://feeinsight.com"]]));
    mocks.stripeCheckoutCreateMock.mockResolvedValue({ url: "https://checkout.stripe.test/session" });
  });

  it("preserves an internal Pro destination through Stripe success and cancel URLs", async () => {
    const { createCheckoutSession } = await import("./stripe-actions");

    const result = await createCheckoutSession(
      "price_pro",
      "subscription",
      "/pro/reports?instId=2945&intent=competitive-brief",
    );

    expect(result).toEqual({ url: "https://checkout.stripe.test/session" });
    expect(mocks.stripeCheckoutCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        success_url:
          "https://feeinsight.com/account/welcome?success=true&from=%2Fpro%2Freports%3FinstId%3D2945%26intent%3Dcompetitive-brief",
        cancel_url:
          "https://feeinsight.com/subscribe?from=%2Fpro%2Freports%3FinstId%3D2945%26intent%3Dcompetitive-brief",
        metadata: expect.objectContaining({
          user_id: "7",
          email: "owner@example.com",
          return_to: "/pro/reports?instId=2945&intent=competitive-brief",
        }),
      }),
    );
  });

  it("checks out against the user's lazily created Stripe customer", async () => {
    const { createCheckoutSession } = await import("./stripe-actions");
    await createCheckoutSession("price_pro");
    expect(mocks.stripeCheckoutCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ customer: "cus_lazy" }),
    );
    expect(mocks.stripeCheckoutCreateMock.mock.calls[0][0]).not.toHaveProperty("customer_email");
  });

  it("drops unsafe external destinations instead of putting them into checkout URLs", async () => {
    const { createCheckoutSession } = await import("./stripe-actions");

    await createCheckoutSession("price_pro", "subscription", "https://evil.example/pro");

    expect(mocks.stripeCheckoutCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        success_url: "https://feeinsight.com/account/welcome?success=true",
        cancel_url: "https://feeinsight.com/subscribe",
        metadata: expect.not.objectContaining({
          return_to: expect.any(String),
        }),
      }),
    );
  });

  it("requires an authenticated user before creating checkout", async () => {
    const { createCheckoutSession } = await import("./stripe-actions");
    mocks.getCurrentUserMock.mockResolvedValue(null);

    await expect(createCheckoutSession("price_pro")).rejects.toThrow("Not authenticated");
    expect(mocks.stripeCheckoutCreateMock).not.toHaveBeenCalled();
  });
});
