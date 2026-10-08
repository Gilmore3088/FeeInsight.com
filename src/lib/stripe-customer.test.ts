import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  create: vi.fn(),
  del: vi.fn(),
  retrieve: vi.fn(),
  results: [] as unknown[][],
  queries: [] as string[],
}));

vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({ customers: { create: mocks.create, del: mocks.del, retrieve: mocks.retrieve } }),
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
    mocks.retrieve.mockReset().mockResolvedValue({ id: "cus_old" });
    mocks.results.length = 0;
    mocks.queries.length = 0;
  });

  it("returns an existing customer that Stripe still knows", async () => {
    const { ensureStripeCustomer } = await import("./stripe-customer");
    expect(await ensureStripeCustomer({ ...user, stripe_customer_id: "cus_old" })).toBe("cus_old");
    expect(mocks.retrieve).toHaveBeenCalledWith("cus_old");
    expect(mocks.create).not.toHaveBeenCalled();
  });

  it("replaces a customer from the other mode (Stripe: resource_missing)", async () => {
    mocks.retrieve.mockRejectedValue(Object.assign(new Error("No such customer"), { code: "resource_missing" }));
    mocks.results.push([], [{ stripe_customer_id: "cus_new" }]);
    const { ensureStripeCustomer } = await import("./stripe-customer");
    expect(await ensureStripeCustomer({ ...user, stripe_customer_id: "cus_test" })).toBe("cus_new");
    expect(mocks.queries[0]).toContain("SET stripe_customer_id = NULL");
    expect(mocks.queries[1]).toContain("stripe_customer_id IS NULL");
  });

  it("replaces a customer deleted in the dashboard", async () => {
    mocks.retrieve.mockResolvedValue({ id: "cus_gone", deleted: true });
    mocks.results.push([], [{ stripe_customer_id: "cus_new" }]);
    const { ensureStripeCustomer } = await import("./stripe-customer");
    expect(await ensureStripeCustomer({ ...user, stripe_customer_id: "cus_gone" })).toBe("cus_new");
  });

  it("does not replace a customer when Stripe itself errors", async () => {
    mocks.retrieve.mockRejectedValue(Object.assign(new Error("rate limited"), { code: "rate_limit" }));
    const { ensureStripeCustomer } = await import("./stripe-customer");
    await expect(ensureStripeCustomer({ ...user, stripe_customer_id: "cus_old" })).rejects.toThrow("rate limited");
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
