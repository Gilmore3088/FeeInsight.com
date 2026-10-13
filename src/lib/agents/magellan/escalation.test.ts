import { describe, expect, it, vi } from "vitest";

import { PAID_FIND_STRATEGY } from "./paid-find";
import {
  NOT_ONLINE_AFTER_MISSES,
  NOT_ONLINE_RETRY_DAYS,
  notOnlineHeld,
  notOnlineStatus,
  notPublishedOnlineCounts,
  PAID_WEB_SEARCH,
  paidRung,
} from "./escalation";

const DAY = 24 * 60 * 60 * 1000;
const now = new Date("2026-10-13T12:00:00Z");
const daysAgo = (n: number) => new Date(now.getTime() - n * DAY);

describe("Magellan escalation ladder (#1032)", () => {
  it("names the same strategy as the paid web search", () => {
    expect(PAID_WEB_SEARCH).toBe(PAID_FIND_STRATEGY.strategy);
  });

  it("takes rung 2 (schedule) first, rung 3 (disclosure) after one miss, and alternates on retries", () => {
    expect(paidRung(0)).toBe("schedule");
    expect(paidRung(1)).toBe("disclosure");
    expect(paidRung(2)).toBe("schedule");
    expect(paidRung(3)).toBe("disclosure");
  });

  it("records 'not published online' only after two paid misses", () => {
    expect(NOT_ONLINE_AFTER_MISSES).toBe(2);
    expect(notOnlineHeld(0, null, now)).toBe(false);
    expect(notOnlineHeld(1, daysAgo(1), now)).toBe(false);
    expect(notOnlineHeld(2, daysAgo(1), now)).toBe(true);
  });

  it("retries 'not published online' after 120 days (inside the 90-180 asked)", () => {
    expect(NOT_ONLINE_RETRY_DAYS).toBeGreaterThanOrEqual(90);
    expect(NOT_ONLINE_RETRY_DAYS).toBeLessThanOrEqual(180);
    expect(notOnlineHeld(2, daysAgo(NOT_ONLINE_RETRY_DAYS - 1), now)).toBe(true);
    expect(notOnlineHeld(2, daysAgo(NOT_ONLINE_RETRY_DAYS + 1), now)).toBe(false);
  });

  it("counts not-online institutions per size tier, restarting on a new website or a find", async () => {
    const unsafe = vi.fn(async () => [{ tier: "community_small", institutions: "4" }]);
    const rows = await notPublishedOnlineCounts({ unsafe } as never, "VT");
    expect(rows).toEqual([{ tier: "community_small", institutions: 4 }]);
    const [text, params] = unsafe.mock.calls[0] as unknown as [string, unknown[]];
    expect(text).toContain("COALESCE(pa.detail->>'website_url', inst.website_url) = inst.website_url");
    expect(text).toContain("found.outcome = 'ok'");
    expect(text).toContain("NULLIF(btrim(inst.fee_schedule_url), '') IS NULL");
    expect(params).toEqual([PAID_WEB_SEARCH, expect.any(Array), "VT", NOT_ONLINE_AFTER_MISSES, NOT_ONLINE_RETRY_DAYS]);
  });

  it("gives an institution's place on the ladder, dated, with the methods tried", async () => {
    const lastMiss = daysAgo(10);
    const unsafe = vi.fn(async () => [{ misses: 2, last_miss_at: lastMiss }]);
    const db = Object.assign(
      vi.fn(async () => [
        { strategy: "discover.paid_web_search", attempts: 2, last_at: lastMiss, last_outcome: "no_candidates" },
        { strategy: "discover.homepage", attempts: 3, last_at: daysAgo(40), last_outcome: "no_candidates" },
      ]),
      { unsafe },
    );
    const status = await notOnlineStatus(db as never, 7, now);
    expect(status).toMatchObject({ since: lastMiss.toISOString(), misses: 2, nextRung: "schedule" });
    expect(status!.nextPaidTryAfter).toBe(new Date(lastMiss.getTime() + NOT_ONLINE_RETRY_DAYS * DAY).toISOString());
    expect(status!.methods.map((method) => method.strategy)).toEqual(["discover.paid_web_search", "discover.homepage"]);
  });

  it("is not 'not online' after one miss: the next paid try waits out the miss cooldown", async () => {
    const lastMiss = daysAgo(5);
    const db = Object.assign(vi.fn(async () => []), { unsafe: vi.fn(async () => [{ misses: 1, last_miss_at: lastMiss }]) });
    const status = await notOnlineStatus(db as never, 7, now);
    expect(status).toMatchObject({ since: null, misses: 1, nextRung: "disclosure" });
    expect(status!.nextPaidTryAfter).toBe(new Date(lastMiss.getTime() + 30 * DAY).toISOString());
  });
});
