import { beforeEach, describe, expect, it, vi } from "vitest";

const { sqlMock } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
}));

vi.mock("@/lib/data-store/connection", () => ({ sql: sqlMock }));

import { API_V1_BURST_ROUTE, BURST_CALLS_PER_MINUTE, checkBurstLimitWithTier, checkRateLimitWithTier } from "./api-rate-limit";

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

describe("API rate limiting", () => {
  beforeEach(() => {
    sqlMock.mockReset();
  });

  it("reserves before allowing a public v1 read", async () => {
    sqlMock.mockResolvedValueOnce([{ request_count: 1 }]);

    const result = await checkRateLimitWithTier(null, "anon-1", "free", "api.v1.index");

    expect(result.allowed).toBe(true);
    expect(result.remaining).toBe(99);
    expect(templateText(sqlMock.mock.calls[0][0])).toContain("INSERT INTO public.api_rate_limit_events");
  });

  it("blocks when the monthly reservation is exhausted", async () => {
    sqlMock.mockResolvedValueOnce([]);

    const result = await checkRateLimitWithTier(null, "anon-1", "free", "api.v1.index");

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });

  it("fails closed when the reservation table cannot be checked", async () => {
    sqlMock.mockRejectedValueOnce(new Error("relation missing"));

    const result = await checkRateLimitWithTier(null, "anon-1", "free", "api.v1.index");

    expect(result.allowed).toBe(false);
    expect(result.remaining).toBe(0);
  });
});

/** A stand-in for the upsert: one counter per (route, subject, window start), capped at the limit. */
function fakeReservationTable() {
  const counts = new Map<string, number>();
  sqlMock.mockImplementation(async (_strings: unknown, ...values: unknown[]) => {
    const [routeId, subjectType, subjectKey, windowStart, , limit] = values as [string, string, string, string, string, number];
    const key = [routeId, subjectType, subjectKey, windowStart].join("|");
    const used = counts.get(key) ?? 0;
    if (used >= limit) return [];
    counts.set(key, used + 1);
    return [{ request_count: used + 1 }];
  });
}

describe("API burst limit", () => {
  beforeEach(() => {
    sqlMock.mockReset();
  });

  it("allows 60 calls in a minute and refuses the 61st until the next minute", async () => {
    fakeReservationTable();
    const now = new Date("2026-10-17T12:00:20.000Z");

    for (let call = 1; call <= BURST_CALLS_PER_MINUTE; call++) {
      const result = await checkBurstLimitWithTier(7, null, "pro", now);
      expect(result.allowed).toBe(true);
    }
    const refused = await checkBurstLimitWithTier(7, null, "pro", now);

    expect(BURST_CALLS_PER_MINUTE).toBe(60);
    expect(refused).toMatchObject({ allowed: false, limit: 60, remaining: 0 });
    expect(refused.reset.toISOString()).toBe("2026-10-17T12:01:00.000Z");
    expect(sqlMock.mock.calls.every((call) => call[1] === API_V1_BURST_ROUTE)).toBe(true);

    const nextMinute = await checkBurstLimitWithTier(7, null, "pro", new Date("2026-10-17T12:01:00.000Z"));
    expect(nextMinute.allowed).toBe(true);
  });

  it("counts each plan apart", async () => {
    fakeReservationTable();
    const now = new Date("2026-10-17T12:00:20.000Z");
    for (let call = 1; call <= BURST_CALLS_PER_MINUTE; call++) await checkBurstLimitWithTier(7, null, "pro", now);

    expect((await checkBurstLimitWithTier(7, null, "pro", now)).allowed).toBe(false);
    expect((await checkBurstLimitWithTier(8, null, "pro", now)).allowed).toBe(true);
    expect((await checkBurstLimitWithTier(null, "anon-1", "free", now)).allowed).toBe(true);
  });

  it("leaves enterprise keys unlimited without touching the table", async () => {
    const result = await checkBurstLimitWithTier(7, null, "enterprise");

    expect(result).toMatchObject({ allowed: true, limit: Infinity });
    expect(sqlMock).not.toHaveBeenCalled();
  });

  it("fails closed when the burst reservation cannot be made", async () => {
    sqlMock.mockRejectedValueOnce(new Error("connection refused"));

    const result = await checkBurstLimitWithTier(7, null, "pro");

    expect(result).toMatchObject({ allowed: false, unavailable: true });
  });
});
