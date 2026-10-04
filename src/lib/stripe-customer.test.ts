import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  del: vi.fn(),
  results: [] as unknown[][],
  queries: [] as string[],
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({ customers: { create: mocks.create, del: mocks.del } }),
}));

vi.mock("@/lib/data-store/connection", () => ({
  sql: (strings: TemplateStringsArray) => {
    mocks.queries.push(strings.join("?"));
    return Promise.resolve(mocks.results.shift() ?? []);
  },
}));

const user = { id: 5, email: "a@b.com", username: "a@b.com", display_name: "A", stripe_customer_id: null };

describe("ensureStripeCustomer", () => {
  beforeEach(() => {
    mocks.create.mockReset().mockResolvedValue({ id: "cus_new" });
    mocks.del.mockReset();
    mocks.results.length = 0;
    mocks.queries.length = 0;
  });

  it("returns an existing customer without calling Stripe", async () => {
    const { ensureStripeCustomer } = await import("./stripe-customer");
    expect(await ensureStripeCustomer({ ...user, stripe_customer_id: "cus_old" })).toBe("cus_old");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("creates and saves a customer the first time", async () => {
    mocks.results.push([{ stripe_customer_id: "cus_new" }]);
    const { ensureStripeCustomer } = await import("./stripe-customer");
    expect(await ensureStripeCustomer(user)).toBe("cus_new");
    expect(mocks.create).toHaveBeenCalledWith(expect.objectContaining({ metadata: { user_id: "5" } }));
    expect(mocks.queries[0]).toContain("stripe_customer_id IS NULL");
  });

  it("uses the winner's customer when a concurrent request saved first", async () => {
    mocks.results.push([], [{ stripe_customer_id: "cus_winner" }]);
    const { ensureStripeCustomer } = await import("./stripe-customer");
    expect(await ensureStripeCustomer(user)).toBe("cus_winner");
    expect(mocks.del).toHaveBeenCalledWith("cus_new");
  });
});
