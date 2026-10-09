// @vitest-environment node
import type Stripe from "stripe";
import { describe, expect, it, vi } from "vitest";
import { readSubscriptionState } from "./subscription-state";

const reader = (list: ReturnType<typeof vi.fn>) => ({ subscriptions: { list } }) as unknown as Pick<Stripe, "subscriptions">;
describe("current subscription inventory", () => {
  it("reads the next page instead of losing a live subscription after the first hundred", async () => {
    const list = vi.fn().mockResolvedValueOnce({ data: [{ id: "sub_last_old", status: "canceled" }], has_more: true })
      .mockResolvedValueOnce({ data: [{ id: "sub_live", status: "active" }], has_more: false });
    await expect(readSubscriptionState("cus_1", reader(list))).resolves.toBe("active");
    expect(list.mock.calls[1][0]).toEqual({ customer: "cus_1", status: "all", limit: 100, starting_after: "sub_last_old" });
    expect(list.mock.calls[0][1]).toEqual(expect.objectContaining({ maxNetworkRetries: 0, timeout: expect.any(Number) }));
  });
  it.each([
    [["canceled", "past_due", "active"], "active"],
    [["unpaid", "trialing"], "active"],
    [["canceled", "paused"], "past_due"],
    [["incomplete"], "none"],
    [[], "canceled"],
  ])("maps current statuses %j to %s", async (statuses, expected) => {
    const list = vi.fn().mockResolvedValue({ data: statuses.map((status, i) => ({ id: `sub_${i}`, status })), has_more: false });
    await expect(readSubscriptionState("cus_1", reader(list))).resolves.toBe(expected);
  });
  it("rejects a truncated empty page rather than treating it as no subscriptions", async () => {
    const list = vi.fn().mockResolvedValue({ data: [], has_more: true });
    await expect(readSubscriptionState("cus_1", reader(list))).rejects.toThrow("incomplete subscription page");
  });
  it("rejects repeated cursors and does not spin forever", async () => {
    const list = vi.fn().mockResolvedValue({ data: [{ id: "sub_same", status: "active" }], has_more: true });
    await expect(readSubscriptionState("cus_1", reader(list))).rejects.toThrow("incomplete subscription page");
    expect(list).toHaveBeenCalledTimes(2);
  });
  it("propagates a later-page error even when an earlier page was active", async () => {
    const list = vi.fn().mockResolvedValueOnce({ data: [{ id: "sub_active", status: "active" }], has_more: true })
      .mockRejectedValueOnce(new Error("temporary API error"));
    await expect(readSubscriptionState("cus_1", reader(list))).rejects.toThrow("temporary API error");
  });
});
