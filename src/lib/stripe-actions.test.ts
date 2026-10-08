import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getCurrentUserMock: vi.fn(),
  stripeCheckoutCreateMock: vi.fn(),
  headersMock: vi.fn(),
  institutionMock: vi.fn(),
  resolveProPriceIdMock: vi.fn(),
}));

vi.mock("@/lib/stripe-prices", () => ({
  resolveProPriceId: mocks.resolveProPriceIdMock,
}));

vi.mock("@/lib/data-store/pro-accounts", () => ({
  getProPricingInstitution: mocks.institutionMock,
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
    mocks.resolveProPriceIdMock.mockReset();
    mocks.resolveProPriceIdMock.mockImplementation(
      async (tier: string, plan: string) => process.env[`STRIPE_PRO_${tier.toUpperCase()}_${plan.toUpperCase()}_PRICE_ID`],
    );
    for (const tier of ["SMALL", "MID", "LARGE"]) {
      for (const plan of ["MONTHLY", "ANNUAL"]) {
        process.env[`STRIPE_PRO_${tier}_${plan}_PRICE_ID`] = `price_${tier.toLowerCase()}_${plan.toLowerCase()}`;
      }
    }
    mocks.getCurrentUserMock.mockReset();
    mocks.stripeCheckoutCreateMock.mockReset();
    mocks.headersMock.mockReset();
    mocks.institutionMock.mockReset();
    mocks.getCurrentUserMock.mockResolvedValue(user());
    mocks.headersMock.mockResolvedValue(new Map([["origin", "https://feeinsight.com"]]));
    mocks.stripeCheckoutCreateMock.mockResolvedValue({ url: "https://checkout.stripe.test/session" });
    mocks.institutionMock.mockResolvedValue({
      id: 2945, name: "First Bank", city: null, stateCode: "AL", assetsThousands: 420_000,
    });
  });

  it("prices a bank by its assets on file, whatever the browser sends", async () => {
    const { createCheckoutSession } = await import("./stripe-actions");
    await createCheckoutSession({ plan: "annual", institutionId: 2945 });
    expect(mocks.institutionMock).toHaveBeenCalledWith(2945);
    expect(mocks.stripeCheckoutCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: "subscription",
        line_items: [{ price: "price_small_annual", quantity: 1 }],
        metadata: expect.objectContaining({ institution_id: "2945", pro_tier: "small", pro_plan: "annual" }),
      }),
    );
  });

  it("puts a $3B bank on the large tier", async () => {
    mocks.institutionMock.mockResolvedValue({ id: 7, name: "Big Bank", city: null, stateCode: null, assetsThousands: 3_000_000 });
    const { createCheckoutSession } = await import("./stripe-actions");
    await createCheckoutSession({ plan: "monthly", institutionId: 7 });
    expect(mocks.stripeCheckoutCreateMock.mock.calls[0][0].line_items).toEqual([{ price: "price_large_monthly", quantity: 1 }]);
  });

  it("puts a consultant on the non-institution tier", async () => {
    const { createCheckoutSession } = await import("./stripe-actions");
    await createCheckoutSession({ plan: "annual", otherOrganization: true });
    expect(mocks.stripeCheckoutCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: "price_mid_annual", quantity: 1 }],
        cancel_url: "https://feeinsight.com/subscribe?org=other&canceled=1",
        metadata: expect.objectContaining({ organization: "other", pro_tier: "mid" }),
        subscription_data: { metadata: { pro_tier: "mid", organization: "other" } },
      }),
    );
  });

  it("refuses checkout until the buyer says who the plan covers", async () => {
    const { createCheckoutSession } = await import("./stripe-actions");
    await expect(createCheckoutSession({ plan: "annual" })).resolves.toEqual({ url: null, error: "Pick your bank or credit union first" });
    expect(mocks.stripeCheckoutCreateMock).not.toHaveBeenCalled();
  });

  it("refuses an institution with no assets on file and points to email", async () => {
    mocks.institutionMock.mockResolvedValue({ id: 9, name: "Tiny CU", city: null, stateCode: null, assetsThousands: null });
    const { createCheckoutSession } = await import("./stripe-actions");
    const result = await createCheckoutSession({ plan: "annual", institutionId: 9 });
    expect(result.url).toBeNull();
    expect(result.error).toContain("asset size");
    expect(mocks.stripeCheckoutCreateMock).not.toHaveBeenCalled();
  });

  it("sets up a missing tier price in Stripe instead of closing checkout", async () => {
    delete process.env.STRIPE_PRO_SMALL_ANNUAL_PRICE_ID;
    mocks.resolveProPriceIdMock.mockResolvedValueOnce("price_from_lookup");
    const { createCheckoutSession } = await import("./stripe-actions");
    await createCheckoutSession({ plan: "annual", institutionId: 2945 });
    expect(mocks.resolveProPriceIdMock).toHaveBeenCalledWith("small", "annual", expect.anything());
    expect(mocks.stripeCheckoutCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({ line_items: [{ price: "price_from_lookup", quantity: 1 }] }),
    );
  });

  it("rejects an unknown plan", async () => {
    const { createCheckoutSession } = await import("./stripe-actions");
    await expect(createCheckoutSession({ plan: "weekly" as never, institutionId: 2945 })).resolves.toEqual({ url: null, error: "Unknown plan" });
  });

  it("preserves an internal Pro destination through Stripe success and cancel URLs", async () => {
    const { createCheckoutSession } = await import("./stripe-actions");
    await createCheckoutSession({
      plan: "annual",
      institutionId: 2945,
      returnTo: "/pro/reports?instId=2945&intent=competitive-brief",
    });
    expect(mocks.stripeCheckoutCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        success_url:
          "https://feeinsight.com/account/welcome?success=true&from=%2Fpro%2Freports%3FinstId%3D2945%26intent%3Dcompetitive-brief",
        cancel_url:
          "https://feeinsight.com/subscribe?from=%2Fpro%2Freports%3FinstId%3D2945%26intent%3Dcompetitive-brief&inst=2945&canceled=1",
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
    await createCheckoutSession({ plan: "annual", institutionId: 2945 });
    expect(mocks.stripeCheckoutCreateMock).toHaveBeenCalledWith(expect.objectContaining({ customer: "cus_lazy" }));
    expect(mocks.stripeCheckoutCreateMock.mock.calls[0][0]).not.toHaveProperty("customer_email");
  });

  it("drops unsafe external destinations instead of putting them into checkout URLs", async () => {
    const { createCheckoutSession } = await import("./stripe-actions");
    await createCheckoutSession({ plan: "annual", institutionId: 2945, returnTo: "https://evil.example/pro" });
    expect(mocks.stripeCheckoutCreateMock).toHaveBeenCalledWith(
      expect.objectContaining({
        success_url: "https://feeinsight.com/account/welcome?success=true",
        cancel_url: "https://feeinsight.com/subscribe?inst=2945&canceled=1",
        metadata: expect.not.objectContaining({ return_to: expect.any(String) }),
      }),
    );
  });

  it("requires an authenticated user before creating checkout", async () => {
    const { createCheckoutSession } = await import("./stripe-actions");
    mocks.getCurrentUserMock.mockResolvedValue(null);
    await expect(createCheckoutSession({ plan: "annual", institutionId: 2945 })).resolves.toEqual({
      url: null,
      error: "Sign in to start checkout",
      needsSignIn: true,
    });
    expect(mocks.stripeCheckoutCreateMock).not.toHaveBeenCalled();
  });
});
