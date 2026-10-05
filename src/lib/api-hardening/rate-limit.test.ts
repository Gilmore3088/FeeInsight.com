import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));

import { sql } from "@/lib/data-store/connection";
import { getApiRoutePolicy } from "./policies";
import { isRateLimited } from "./rate-limit";
import { withApiRoutePolicy } from "./route-wrapper";

const sqlMock = sql as unknown as ReturnType<typeof vi.fn>;
const LEADS = getApiRoutePolicy("api.leads");

function issued(callIndex: number): { text: string; values: unknown[] } {
  const [strings, ...values] = sqlMock.mock.calls[callIndex] as [TemplateStringsArray, ...unknown[]];
  return { text: strings.join("?").replace(/\s+/g, " "), values };
}

describe("lead-write rate limit", () => {
  beforeEach(() => {
    sqlMock.mockReset();
    sqlMock.mockResolvedValue([]);
  });

  it("blocks a visitor at 8 lead posts in 10 minutes", async () => {
    sqlMock.mockResolvedValueOnce([{ attempts: 7 }]);
    expect(await isRateLimited(LEADS, "ip-hash")).toBe(false);
    sqlMock.mockResolvedValueOnce([{ attempts: 8 }]);
    expect(await isRateLimited(LEADS, "ip-hash")).toBe(true);
    const count = issued(0);
    expect(count.text).toContain("FROM api_route_audit_events");
    expect(count.values[0]).toEqual(expect.arrayContaining(["api.leads", "api.reports.email_gate"]));
    expect(count.values.slice(1)).toEqual([10, "ip-hash"]);
  });

  it("never limits unsubscribe links, unlisted buckets, or unknown visitors", async () => {
    expect(await isRateLimited(getApiRoutePolicy("api.leads.subscription"), "ip-hash")).toBe(false);
    expect(await isRateLimited(LEADS, null)).toBe(false);
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("lets the request through when the count fails", async () => {
    sqlMock.mockRejectedValueOnce(new Error("db down"));
    expect(await isRateLimited(LEADS, "ip-hash")).toBe(false);
  });

  it("answers 429 without running the handler once the limit is hit", async () => {
    sqlMock.mockResolvedValueOnce([{ attempts: 8 }]);
    const handler = vi.fn(async (_request: Request) => Response.json({ success: true }));
    const POST = withApiRoutePolicy("api.leads", "POST", handler);
    const response = await POST(new Request("http://localhost/api/leads", { method: "POST", headers: { "x-forwarded-for": "203.0.113.9" } }));
    expect(response.status).toBe(429);
    expect(handler).not.toHaveBeenCalled();
    expect(issued(1).values).toContain("rate_limited");
  });
});
