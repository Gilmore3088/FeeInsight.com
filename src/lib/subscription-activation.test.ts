import { beforeEach, describe, expect, it, vi } from "vitest";

const { sqlMock, list, anchor, track } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
  list: vi.fn(),
  anchor: vi.fn(),
  track: vi.fn(),
}));

vi.mock("@/lib/data-store/connection", () => ({ sql: sqlMock }));
vi.mock("@/lib/stripe", () => ({ getStripe: () => ({ subscriptions: { list } }) }));
vi.mock("@/lib/pro-checkout-institution", async (orig) => ({ ...(await orig<object>()), anchorPaidInstitution: anchor }));
vi.mock("@/lib/analytics-server", () => ({ trackServerEvent: track }));

import { activateIfPaid } from "./subscription-activation";

// Test figures only.
const user = { id: 7, username: "pat", email: "pat@test.bank", role: "viewer", subscription_status: "past_due", stripe_customer_id: "cus_1" } as never;

describe("activateIfPaid", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    sqlMock.mockResolvedValue([]);
  });

  it("restores a subscriber Stripe shows as paid, trial included, and anchors the paid bank", async () => {
    list.mockResolvedValue({ data: [{ id: "sub_old", status: "canceled", metadata: {} }, { id: "sub_1", status: "trialing", metadata: { institution_id: "8109" } }] });
    expect(await activateIfPaid(user)).toBe(true);
    expect(list).toHaveBeenCalledWith({ customer: "cus_1", status: "all", limit: 10 });
    expect((sqlMock.mock.calls[0][0] as TemplateStringsArray).join("?")).toContain("subscription_status = 'active'");
    expect(anchor).toHaveBeenCalledWith(sqlMock, { userId: 7, institutionId: 8109, note: "Filed at Pro checkout (sub_1)." });
  });

  it("changes nothing when no subscription is paid", async () => {
    list.mockResolvedValue({ data: [{ id: "sub_1", status: "past_due", metadata: {} }] });
    expect(await activateIfPaid(user)).toBe(false);
    expect(sqlMock).not.toHaveBeenCalled();
    expect(anchor).not.toHaveBeenCalled();
  });
});
