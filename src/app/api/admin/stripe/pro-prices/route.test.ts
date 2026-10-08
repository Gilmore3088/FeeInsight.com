import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  resolve: vi.fn(),
  retrieve: vi.fn(),
  create: vi.fn(),
  expire: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/stripe-prices", () => ({ resolveProPriceId: mocks.resolve }));
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    prices: { retrieve: mocks.retrieve },
    checkout: { sessions: { create: mocks.create, expire: mocks.expire } },
  }),
}));

import { GET } from "./route";

describe("GET /api/admin/stripe/pro-prices", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.resolve.mockImplementation(async (tier: string, plan: string) => `price_${tier}_${plan}`);
    mocks.retrieve.mockImplementation(async (id: string) => ({
      id,
      lookup_key: id.replace("price_", "pro_"),
      unit_amount: 15_000,
      recurring: { interval: "month" },
      livemode: true,
    }));
    mocks.create.mockResolvedValue({ id: "cs_1", url: "https://checkout.stripe.com/c/cs_1" });
    mocks.expire.mockResolvedValue({});
  });

  it("refuses anyone but an admin", async () => {
    mocks.user.mockResolvedValue({ id: 1, role: "premium" });
    const response = await GET();
    expect(response.status).toBe(401);
    expect(mocks.resolve).not.toHaveBeenCalled();
  });

  it("sets up all six prices and opens then expires one checkout for each, charging nobody", async () => {
    mocks.user.mockResolvedValue({ id: 1, role: "admin" });
    const response = await GET();
    const body = await response.json();
    expect(body.ok).toBe(true);
    expect(body.results).toHaveLength(6);
    expect(mocks.create).toHaveBeenCalledTimes(6);
    expect(mocks.expire).toHaveBeenCalledTimes(6);
    expect(mocks.create.mock.calls[0][0]).not.toHaveProperty("customer");
  });
});
