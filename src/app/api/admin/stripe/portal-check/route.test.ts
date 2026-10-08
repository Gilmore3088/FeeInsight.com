import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  user: vi.fn(),
  configs: vi.fn(),
  update: vi.fn(),
  customers: vi.fn(),
  session: vi.fn(),
}));

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/stripe", () => ({
  getStripe: () => ({
    billingPortal: { configurations: { list: mocks.configs, update: mocks.update }, sessions: { create: mocks.session } },
    customers: { list: mocks.customers },
  }),
}));

import { GET } from "./route";

const config = {
  id: "bpc_1",
  livemode: true,
  active: true,
  features: {
    subscription_cancel: { enabled: true, mode: "at_period_end" },
    payment_method_update: { enabled: true },
    invoice_history: { enabled: true },
    customer_update: { enabled: true },
    subscription_update: { enabled: false },
  },
  business_profile: { privacy_policy_url: "https://feeinsight.com/privacy", terms_of_service_url: "https://feeinsight.com/terms" },
};

describe("GET /api/admin/stripe/portal-check", () => {
  beforeEach(() => {
    for (const mock of Object.values(mocks)) mock.mockReset();
    mocks.configs.mockResolvedValue({ data: [config] });
    mocks.customers.mockResolvedValue({ data: [{ id: "cus_9" }] });
    mocks.session.mockResolvedValue({ url: "https://billing.stripe.com/p/session" });
  });

  it("refuses anyone but an admin", async () => {
    mocks.user.mockResolvedValue({ id: 1, role: "premium" });
    const response = await GET();
    expect(response.status).toBe(401);
    expect(mocks.configs).not.toHaveBeenCalled();
  });

  it("reports the portal setup and opens a session for an existing customer", async () => {
    mocks.user.mockResolvedValue({ id: 1, role: "admin", stripe_customer_id: null });
    const body = await (await GET()).json();
    expect(body.ok).toBe(true);
    expect(body.configuration).toMatchObject({ cancelMode: "at_period_end", privacyPolicyUrl: "https://feeinsight.com/privacy" });
    expect(body.portal).toEqual({ customer: "cus_9", opened: true });
    expect(mocks.session).toHaveBeenCalledWith({ customer: "cus_9", return_url: "https://feeinsight.com/account" });
  });

  it("is not ok when cancellation is off", async () => {
    mocks.user.mockResolvedValue({ id: 1, role: "admin", stripe_customer_id: "cus_admin" });
    mocks.configs.mockResolvedValue({
      data: [{ ...config, features: { ...config.features, subscription_cancel: { enabled: false, mode: "at_period_end" } } }],
    });
    const body = await (await GET()).json();
    expect(body.ok).toBe(false);
  });

  it("sets missing Privacy and Terms links and passes with no live customer yet", async () => {
    mocks.user.mockResolvedValue({ id: 1, role: "admin", stripe_customer_id: "cus_test_mode" });
    const bare = { ...config, business_profile: { privacy_policy_url: null, terms_of_service_url: null } };
    mocks.configs.mockResolvedValue({ data: [bare] });
    mocks.update.mockResolvedValue(config);
    mocks.customers.mockResolvedValue({ data: [] });
    const body = await (await GET()).json();
    expect(mocks.update).toHaveBeenCalledWith("bpc_1", {
      business_profile: { privacy_policy_url: "https://feeinsight.com/privacy", terms_of_service_url: "https://feeinsight.com/terms" },
    });
    expect(body.linksSet).toBe(true);
    expect(body.portal).toHaveProperty("skipped");
    expect(mocks.session).not.toHaveBeenCalled();
    expect(body.ok).toBe(true);
  });
});
