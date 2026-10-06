import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ ip: "203.0.113.9" as string | null }));
vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn() }));
vi.mock("next/headers", () => ({
  headers: async () => new Headers(mocks.ip ? { "x-forwarded-for": mocks.ip } : {}),
}));

import { sql } from "@/lib/data-store/connection";
import { REGISTER_ACTION_POLICY, isServerActionRateLimited } from "./action-rate-limit";

const sqlMock = sql as unknown as ReturnType<typeof vi.fn>;
const text = (i: number) => (sqlMock.mock.calls[i][0] as TemplateStringsArray).join("?").replace(/\s+/g, " ");

describe("signup rate limit", () => {
  beforeEach(() => {
    sqlMock.mockReset();
    sqlMock.mockResolvedValue([]);
    mocks.ip = "203.0.113.9";
  });

  it("allows 8 signups in 10 minutes and refuses the 9th", async () => {
    sqlMock.mockResolvedValueOnce([{ attempts: 7 }]);
    expect(await isServerActionRateLimited(REGISTER_ACTION_POLICY)).toBe(false);
    sqlMock.mockResolvedValueOnce([{ attempts: 8 }]);
    expect(await isServerActionRateLimited(REGISTER_ACTION_POLICY)).toBe(true);
    expect(text(0)).toContain("FROM api_route_audit_events");
    expect(sqlMock.mock.calls[0].slice(1)).toEqual(["action.register", 10, expect.stringMatching(/^[0-9a-f]{64}$/)]);
    expect(text(1)).toContain("INSERT INTO public.api_route_audit_events");
    expect(sqlMock.mock.calls[3]).toContain("rate_limited");
  });

  it("never blocks when the visitor is unknown or the count fails", async () => {
    mocks.ip = null;
    expect(await isServerActionRateLimited(REGISTER_ACTION_POLICY)).toBe(false);
    expect(sqlMock).not.toHaveBeenCalled();
    mocks.ip = "203.0.113.9";
    sqlMock.mockRejectedValueOnce(new Error("db down"));
    expect(await isServerActionRateLimited(REGISTER_ACTION_POLICY)).toBe(false);
  });
});
