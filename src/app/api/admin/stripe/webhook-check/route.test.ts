import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), endpoints: vi.fn() }));

vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/stripe", () => ({ getStripe: () => ({ webhookEndpoints: { list: mocks.endpoints } }) }));

import { GET } from "./route";

const endpoint = (enabled_events: string[], status = "enabled", url = "https://feeinsight.com/api/webhooks/stripe") => ({
  id: "we_1",
  url,
  status,
  livemode: true,
  enabled_events,
});

describe("GET /api/admin/stripe/webhook-check", () => {
  beforeEach(() => {
    mocks.user.mockReset().mockResolvedValue({ id: 1, role: "admin" });
    mocks.endpoints.mockReset();
  });

  it("refuses anyone but an admin", async () => {
    mocks.user.mockResolvedValue({ id: 2, role: "viewer" });
    const res = await GET();
    expect(res.status).toBe(401);
  });

  it("names the handled events the endpoint does not send", async () => {
    mocks.endpoints.mockResolvedValue({ data: [endpoint(["price.created", "checkout.session.completed"])] });
    const body = await (await GET()).json();
    expect(body.ok).toBe(false);
    expect(body.endpoints[0].missing).toContain("invoice.paid");
    expect(body.endpoints[0].missing).not.toContain("checkout.session.completed");
  });

  it("is ok for an endpoint that sends every event", async () => {
    mocks.endpoints.mockResolvedValue({ data: [endpoint(["*"])] });
    const body = await (await GET()).json();
    expect(body.ok).toBe(true);
    expect(body.endpoints[0].missing).toEqual([]);
  });

  it("ignores a disabled endpoint's gaps but still lists them", async () => {
    mocks.endpoints.mockResolvedValue({
      data: [
        endpoint(["*"]),
        endpoint(["checkout.session.completed"], "disabled", "https://bank-fee-index.fly.dev/api/webhooks/stripe"),
      ],
    });
    const body = await (await GET()).json();
    expect(body.ok).toBe(true);
    expect(body.endpoints[1].missing).toContain("invoice.paid");
  });

  it("is not ok when every matching endpoint is disabled", async () => {
    mocks.endpoints.mockResolvedValue({ data: [endpoint(["*"], "disabled")] });
    const body = await (await GET()).json();
    expect(body.ok).toBe(false);
  });
});
