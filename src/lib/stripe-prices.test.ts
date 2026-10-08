import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type Stripe from "stripe";

vi.mock("@/lib/stripe", () => ({ getStripe: () => { throw new Error("pass a stripe double"); } }));

import { isProTierPrice, resolveProPriceId } from "./stripe-prices";

function fakeStripe(options: {
  byLookupKey?: Record<string, { id: string; product: string }>;
  productPrices?: Array<Record<string, unknown>>;
  products?: Array<{ id: string; name: string }>;
}) {
  const created: Array<Record<string, unknown>> = [];
  const stripe = {
    prices: {
      list: vi.fn(async (params: { lookup_keys?: string[]; product?: string }) => {
        if (params.lookup_keys) {
          const hit = params.lookup_keys.map((key) => options.byLookupKey?.[key]).find(Boolean);
          return { data: hit ? [hit] : [] };
        }
        return { data: options.productPrices ?? [] };
      }),
      create: vi.fn(async (params: Record<string, unknown>) => {
        created.push(params);
        return { id: "price_new" };
      }),
    },
    products: {
      list: vi.fn(async () => ({ data: options.products ?? [] })),
      create: vi.fn(async () => ({ id: "prod_new" })),
    },
  };
  return { stripe: stripe as unknown as Stripe, raw: stripe, created };
}

describe("resolveProPriceId", () => {
  beforeEach(() => vi.unstubAllEnvs());
  afterEach(() => vi.unstubAllEnvs());

  it("uses the Vercel variable when it is set, without calling Stripe", async () => {
    vi.stubEnv("STRIPE_PRO_SMALL_ANNUAL_PRICE_ID", "price_env");
    const { stripe, raw } = fakeStripe({});
    expect(await resolveProPriceId("small", "annual", stripe)).toBe("price_env");
    expect(raw.prices.list).not.toHaveBeenCalled();
  });

  it("finds the price by its lookup key, so a second call never creates another", async () => {
    const { stripe, raw } = fakeStripe({ byLookupKey: { pro_mid_monthly: { id: "price_mid_m", product: "prod_pro" } } });
    expect(await resolveProPriceId("mid", "monthly", stripe)).toBe("price_mid_m");
    expect(raw.prices.create).not.toHaveBeenCalled();
  });

  it("reuses a same-amount recurring price already on the Pro product", async () => {
    const { stripe, raw } = fakeStripe({
      products: [{ id: "prod_pro", name: "Fee Insight Pro" }],
      productPrices: [
        { id: "price_old", unit_amount: 499_999, currency: "usd", recurring: { interval: "year" }, lookup_key: null },
        { id: "price_dash", unit_amount: 150_000, currency: "usd", recurring: { interval: "year" }, lookup_key: null },
      ],
    });
    expect(await resolveProPriceId("small", "annual", stripe)).toBe("price_dash");
    expect(raw.prices.create).not.toHaveBeenCalled();
  });

  it("creates the price with its lookup key on the Fee Insight Pro product when none exists", async () => {
    const { stripe, raw, created } = fakeStripe({ products: [{ id: "prod_other", name: "Something else" }] });
    expect(await resolveProPriceId("large", "monthly", stripe)).toBe("price_new");
    expect(raw.products.create).toHaveBeenCalledWith({ name: "Fee Insight Pro" });
    expect(created[0]).toMatchObject({
      product: "prod_new",
      currency: "usd",
      unit_amount: 50_000,
      recurring: { interval: "month" },
      lookup_key: "pro_large_monthly",
    });
  });

  it("puts a new tier price on the product the other tier prices already use", async () => {
    const { stripe, created } = fakeStripe({ byLookupKey: { pro_small_monthly: { id: "price_s", product: "prod_pro" } } });
    await resolveProPriceId("mid", "annual", stripe);
    expect(created[0]).toMatchObject({ product: "prod_pro", unit_amount: 300_000, lookup_key: "pro_mid_annual" });
  });
});

describe("isProTierPrice", () => {
  const price = (over: Partial<Stripe.Price>) =>
    ({ id: "price_x", lookup_key: null, unit_amount: 1, currency: "usd", recurring: { interval: "year", interval_count: 1 }, ...over }) as Stripe.Price;

  it("recognises a tier price by lookup key or by amount", () => {
    expect(isProTierPrice(price({ lookup_key: "pro_large_annual" }), "large")).toBe(true);
    expect(isProTierPrice(price({ unit_amount: 500_000 }), "large")).toBe(true);
    expect(isProTierPrice(price({ unit_amount: 300_000 }), "large")).toBe(false);
  });
});
