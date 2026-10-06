import { beforeEach, describe, expect, it, vi } from "vitest";

const list = vi.fn();
vi.mock("@/lib/stripe", () => ({ getStripe: () => ({ subscriptions: { list } }) }));
vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn(async () => []) }));
vi.mock("@/lib/hamilton/institution-membership", () => ({
  acceptPendingWorkspaceInvitationsForUser: vi.fn(async () => []),
}));

import { activateIfPaid } from "./activate-if-paid";
import { sql } from "@/lib/data-store/connection";

const user = {
  id: 7,
  username: "a@bank.example",
  email: "a@bank.example",
  role: "viewer",
  subscription_status: "none",
  stripe_customer_id: "cus_1",
} as Parameters<typeof activateIfPaid>[0];

describe("activateIfPaid", () => {
  beforeEach(() => {
    list.mockReset();
    (sql as unknown as ReturnType<typeof vi.fn>).mockClear();
  });

  it("activates a user Stripe already shows as paying", async () => {
    list.mockResolvedValueOnce({ data: [{ id: "sub_1" }] });
    expect(await activateIfPaid(user)).toBe(true);
    expect(sql).toHaveBeenCalledTimes(1);
  });

  it("leaves an unpaid user alone", async () => {
    list.mockResolvedValueOnce({ data: [] });
    expect(await activateIfPaid(user)).toBe(false);
    expect(sql).not.toHaveBeenCalled();
  });

  it("never calls Stripe without a customer", async () => {
    expect(await activateIfPaid({ ...user, stripe_customer_id: null })).toBe(false);
    expect(list).not.toHaveBeenCalled();
  });
});
