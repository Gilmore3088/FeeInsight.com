import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => {
  const mockSql = vi.fn();
  return { getSql: () => mockSql, sql: mockSql };
});

import type { RegistryFeedFreshness } from "@/lib/data-store/feed-freshness";
import type { HoovieCadence, HoovieSourceContract } from "./contract";
import {
  BRIEF_SOURCE_LINES,
  STALE_AFTER_DAYS,
  buildSourceHealthReport,
  readSourceHealth,
  skipReason,
  sourceHealth,
  sourceHealthDetail,
  sourceHealthLines,
  summarizeSourceHealth,
} from "./source-health";
import { HOOVIE_SOURCES } from "./sources";

const NOW = new Date("2026-10-18T12:00:00Z");

function contract(source: string, cadence: HoovieCadence = "quarterly", extra: Partial<HoovieSourceContract> = {}): HoovieSourceContract {
  return {
    source, loader: source, publisher: "test", licence: { status: "public-domain" }, connection: "bulk-file",
    cadence, grain: ["institution"], linkKeys: [], tables: [], ...extra,
  };
}

function feed(source: string, partial: Partial<RegistryFeedFreshness> = {}): RegistryFeedFreshness {
  return {
    source, latestPeriod: null, lastSuccessAt: null, nextAttemptAt: null, failed: 0, scheduled: 0, lastError: null,
    blocked: 0, blockedHost: null, succeeded: 0, lastFailedAt: null, lastBlockedAt: null, ...partial,
  };
}

const ok = (source: string, lastSuccessAt = "2026-10-17T00:00:00.000Z") =>
  feed(source, { lastSuccessAt, succeeded: 4, latestPeriod: "2026Q2" });

describe("sourceHealth", () => {
  it("is fresh when the last success is within the cadence", () => {
    expect(sourceHealth(contract("a"), ok("a"), null, NOW)).toMatchObject({ status: "fresh", reason: "last success 2026-10-17", latestPeriod: "2026Q2" });
  });

  it("is stale when the last success is older than the cadence allows", () => {
    const health = sourceHealth(contract("a", "monthly"), ok("a", "2026-08-01T00:00:00.000Z"), null, NOW);
    expect(health).toMatchObject({ status: "stale", reason: "last success 78 days ago; a monthly source is stale after 45" });
    // The same date is fresh for an annual source, and a one-time source is never stale.
    expect(sourceHealth(contract("a", "annual"), ok("a", "2026-08-01T00:00:00.000Z"), null, NOW).status).toBe("fresh");
    expect(sourceHealth(contract("a", "one-time"), ok("a", "2020-01-01T00:00:00.000Z"), null, NOW).status).toBe("fresh");
    expect(STALE_AFTER_DAYS["one-time"]).toBeNull();
  });

  it("is failed when a partition failed after the last success, with its error", () => {
    const health = sourceHealth(
      contract("a"),
      feed("a", { lastSuccessAt: "2026-10-10T00:00:00.000Z", succeeded: 3, failed: 2, lastFailedAt: "2026-10-18T01:00:00.000Z", lastError: "HTTP 503\n  Service Unavailable" }),
      null,
      NOW,
    );
    expect(health).toMatchObject({ status: "failed", reason: "2 partitions failed: HTTP 503 Service Unavailable" });
  });

  it("stays fresh when the only failure is older than the last success", () => {
    const health = sourceHealth(
      contract("a"),
      feed("a", { lastSuccessAt: "2026-10-17T00:00:00.000Z", succeeded: 3, failed: 1, lastFailedAt: "2026-10-01T00:00:00.000Z", lastError: "old" }),
      null,
      NOW,
    );
    expect(health.status).toBe("fresh");
  });

  it("clips a long error", () => {
    const health = sourceHealth(contract("a"), feed("a", { failed: 1, lastFailedAt: "2026-10-18T00:00:00.000Z", lastError: "x".repeat(500) }), null, NOW);
    expect(health.status).toBe("failed");
    expect(health.reason.length).toBeLessThan(200);
    expect(health.reason.endsWith("…")).toBe(true);
  });

  it("is empty when the publisher's host refused production, naming the host and issue", () => {
    const missing = { host: "www.ffiec.gov", observed: "HTTP 403", fallback: null, issue: 1806 };
    const health = sourceHealth(
      contract("fr-y9c", "quarterly", { missingSource: missing }),
      feed("fr-y9c", { blocked: 3, blockedHost: "www.ffiec.gov", lastBlockedAt: "2026-10-18T00:00:00.000Z" }),
      null,
      NOW,
    );
    expect(health).toMatchObject({ status: "empty", reason: "www.ffiec.gov refused production's request (#1806)", lastSuccessAt: null });
  });

  it("is empty when nothing has loaded, or every load came back empty", () => {
    expect(sourceHealth(contract("a"), undefined, null, NOW)).toMatchObject({ status: "empty", reason: "nothing loaded yet" });
    expect(sourceHealth(contract("a"), feed("a", { scheduled: 2 }), null, NOW)).toMatchObject({ status: "empty", reason: "nothing loaded yet; 2 partitions waiting" });
    expect(sourceHealth(contract("a"), feed("a", { lastSuccessAt: "2026-10-17T00:00:00.000Z" }), null, NOW))
      .toMatchObject({ status: "empty", reason: "every load so far came back empty" });
  });

  it("is skipped, before anything else, when the scheduler plans nothing for it", () => {
    expect(sourceHealth(contract("a"), ok("a"), "no OPEN_STATES_API_KEY set", NOW)).toMatchObject({ status: "skipped", reason: "no OPEN_STATES_API_KEY set" });
  });
});

describe("skipReason", () => {
  const none = { held: new Set<string>(), sizeHeld: new Map<string, string[]>(), env: {} };

  it("names held licences, size holds and missing keys", () => {
    expect(skipReason(contract("a"), ["2026Q2"], { ...none, held: new Set(["a"]) })).toBe("held until James confirms the data terms");
    expect(skipReason(contract("a", "irregular", { licence: { status: "held" } }), ["x"], none)).toBe("held until James confirms the data terms");
    expect(skipReason(contract("a"), ["2026Q2"], { ...none, sizeHeld: new Map([["a", ["area_statistics"]]]) }))
      .toBe("held: area_statistics over its size budget");
    expect(skipReason(contract("bills", "daily", { envKey: "OPEN_STATES_API_KEY" }), [], none)).toBe("no OPEN_STATES_API_KEY set");
    expect(skipReason(contract("a"), [], none)).toBe("the scheduler plans no partition for it");
  });

  it("is null when the scheduler plans partitions", () => {
    expect(skipReason(contract("a"), ["2026Q2"], none)).toBeNull();
    expect(skipReason(contract("bills", "daily", { envKey: "OPEN_STATES_API_KEY" }), ["current"], { ...none, env: { OPEN_STATES_API_KEY: "k" } })).toBeNull();
  });
});

describe("buildSourceHealthReport", () => {
  const report = buildSourceHealthReport({
    contracts: [contract("fresh-one"), contract("failing"), contract("never"), contract("old", "monthly"), contract("held")],
    feeds: [
      ok("fresh-one"),
      feed("failing", { failed: 1, lastFailedAt: "2026-10-18T00:00:00.000Z", lastError: "timeout" }),
      ok("old", "2026-01-01T00:00:00.000Z"),
      ok("held"),
      ok("renamed-source"),
    ],
    skips: new Map([["held", "held until James confirms the data terms"]]),
    now: NOW,
  });

  it("lists sources that need someone first and counts each status", () => {
    expect(report.sources.map((entry) => [entry.source, entry.status])).toEqual([
      ["failing", "failed"],
      ["never", "empty"],
      ["old", "stale"],
      ["held", "skipped"],
      ["fresh-one", "fresh"],
    ]);
    expect(report.counts).toEqual({ failed: 1, empty: 1, stale: 1, skipped: 1, fresh: 1 });
    expect(report.unlisted).toEqual(["renamed-source"]);
    expect(report.readAt).toBe(NOW.toISOString());
  });

  it("gives the brief only the sources that are not fresh", () => {
    expect(sourceHealthLines(report)).toEqual([
      "Public data: 4 of 5 sources not fresh (1 failed, 1 empty, 1 stale, 1 skipped).",
      "- failing: failed, 1 partition failed: timeout; never succeeded",
      "- never: empty, nothing loaded yet; never succeeded",
      "- old: stale, last success 290 days ago; a monthly source is stale after 45",
      "- held: skipped, held until James confirms the data terms; last success 2026-10-17",
    ]);
    expect(sourceHealthLines(null)).toEqual([]);
  });

  it("always names failed and empty sources, and caps the rest", () => {
    const lines = sourceHealthLines(report, 2);
    expect(lines.slice(1)).toEqual([
      "- failing: failed, 1 partition failed: timeout; never succeeded",
      "- never: empty, nothing loaded yet; never succeeded",
      "- and 2 more on /admin/data",
    ]);
    expect(BRIEF_SOURCE_LINES).toBeGreaterThan(0);
  });

  it("summarizes for the ledger and records every source in the detail", () => {
    expect(summarizeSourceHealth(report)).toBe(
      "Deming checked 5 public-data sources: 1 fresh, 1 failed, 1 empty, 1 stale, 1 skipped; ALARM: failing, never.",
    );
    const detail = sourceHealthDetail(report) as { sources: Array<Record<string, unknown>>; counts: unknown };
    expect(detail.counts).toEqual(report.counts);
    expect(detail.sources[0]).toEqual({
      source: "failing", status: "failed", reason: "1 partition failed: timeout", cadence: "quarterly", last_success_at: null, latest_period: null,
    });
  });
});

describe("readSourceHealth", () => {
  it("grades every Hoovie contract from one partition read, read-only", async () => {
    const calls: string[] = [];
    const db = vi.fn((strings: TemplateStringsArray) => {
      const text = strings.join("?");
      calls.push(text);
      if (text.includes("FROM registry_ingest_partitions")) {
        return Promise.resolve([
          {
            source: "fdic-financials", latest_period: "2026Q2", last_success_at: new Date("2026-10-17T00:00:00Z"), next_attempt_at: null,
            failed: 0, scheduled: 0, last_error: null, blocked: 0, blocked_host: null, succeeded: 60, last_failed_at: null, last_blocked_at: null,
          },
        ]);
      }
      return Promise.resolve([]);
    });
    const report = await readSourceHealth({ db: db as never, now: NOW, env: {} });
    expect(report.sources).toHaveLength(HOOVIE_SOURCES.length);
    expect(report.sources.find((entry) => entry.source === "fdic-financials")?.status).toBe("fresh");
    // Without its key the state-bills source is skipped, not reported empty.
    expect(report.sources.find((entry) => entry.source === "state-bills")).toMatchObject({ status: "skipped", reason: "no OPEN_STATES_API_KEY set" });
    expect(report.sources.find((entry) => entry.source === "state-bill-news")?.status).toBe("skipped");
    expect(calls.every((text) => /^\s*SELECT/.test(text))).toBe(true);
    // The scheduler's module graph is large; loading it the first time is slow.
  }, 60_000);
});
