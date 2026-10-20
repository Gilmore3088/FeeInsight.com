import { readFileSync } from "node:fs";
import { join } from "node:path";
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
  staleAfterDays,
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

  it("says how the host answers when it serves a page instead of refusing (#2473)", () => {
    const missing = { host: "cdr.ffiec.gov", observed: "form page", fallback: null, issue: 2473,
      answer: "serves the single-period UBPR file only as XBRL" };
    const health = sourceHealth(
      contract("ubpr-peer-groups", "quarterly", { missingSource: missing }),
      feed("ubpr-peer-groups", { blocked: 1, blockedHost: "cdr.ffiec.gov", lastBlockedAt: "2026-10-18T00:00:00.000Z" }),
      null,
      NOW,
    );
    expect(health.reason).toBe("cdr.ffiec.gov serves the single-period UBPR file only as XBRL (#2473)");
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
      "- failing: failed, 1 partition failed: timeout; no nonempty load recorded",
      "- never: empty, nothing loaded yet; no nonempty load recorded",
      "- old: stale, last success 290 days ago; a monthly source is stale after 45",
      "- held: skipped, held until James confirms the data terms; last nonempty load 2026-10-17; last successful check 2026-10-17",
    ]);
    expect(sourceHealthLines(null)).toEqual([]);
  });

  it("always names failed and empty sources, and caps the rest", () => {
    const lines = sourceHealthLines(report, 2);
    expect(lines.slice(1)).toEqual([
      "- failing: failed, 1 partition failed: timeout; no nonempty load recorded",
      "- never: empty, nothing loaded yet; no nonempty load recorded",
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
      source: "failing", status: "failed", reason: "1 partition failed: timeout", cadence: "quarterly", last_success_at: null, last_attempt_at: null, last_loaded_at: null, latest_period: null,
    });
  });
});

describe("a partition that reached no landing page (#2306)", () => {
  // Run 8051: industry-events/ncua-mergers, both NCUA addresses 404, recorded empty, while the
  // source's other families kept succeeding afterwards.
  const run8051 = feed("industry-events", {
    lastSuccessAt: "2026-10-18T06:00:00.000Z", succeeded: 9, latestPeriod: "occ-bulletin",
    unreachable: 1, unreachablePartition: "ncua-mergers",
    unreachablePages: "https://ncua.gov/analysis/cuso-economic-data/merger-activity-reports 404; https://ncua.gov/files/mergers.xlsx 404",
  });

  it("fails the source, naming the partition and its pages, even after other partitions succeeded", () => {
    const health = sourceHealth(contract("industry-events", "irregular"), run8051, null, NOW);
    expect(health.status).toBe("failed");
    expect(health.reason).toContain("1 partition reached no landing page (ncua-mergers)");
    expect(health.reason).toContain("merger-activity-reports 404");
  });

  it("is failed, not nothing-loaded, when it is the source's only partition", () => {
    const only = feed("x", { unreachable: 1, unreachablePartition: "ncua-mergers" });
    expect(sourceHealth(contract("x"), only, null, NOW).status).toBe("failed");
  });
});

describe("daily-polled feeds (#2228)", () => {
  it("are stale after days without a successful check, not the irregular 90", () => {
    const daily = contract("reg-news", "irregular", { checkEveryHours: 24 });
    expect(staleAfterDays(daily)).toBe(3);
    expect(staleAfterDays(contract("x", "irregular"))).toBe(90);
    const health = sourceHealth(daily, ok("reg-news", "2026-10-10T00:00:00.000Z"), null, NOW);
    expect(health).toMatchObject({ status: "stale", reason: "last success 8 days ago; checked every 24 hours, it is stale after 3" });
  });

  it("names a loader constant equal to each contract's checkEveryHours", () => {
    const polled = HOOVIE_SOURCES.filter((c) => c.checkEveryHours);
    expect(polled.length).toBeGreaterThan(0);
    for (const c of polled) {
      const code = readFileSync(join(process.cwd(), "src/lib/agents/magellan/registry", `${c.loader}.ts`), "utf8");
      expect(code, c.source).toMatch(new RegExp(`REFRESH_HOURS\\s*=\\s*${c.checkEveryHours};`));
    }
  });
});

describe("expected-period completeness beside fetch health (#2228)", () => {
  const period = (source: string, partitionKey: string, status: string, rowCount = status === "succeeded" ? 5 : 0) =>
    ({ source, partitionKey, status, partial: false, rowCount, blocked: false, fetchedAt: "2026-10-18T00:00:00.000Z" });
  const report = buildSourceHealthReport({
    contracts: [contract("backfilled"), contract("current"), contract("waiting"), contract("events", "irregular")],
    // All four fetched fine: fetch health is fresh for each.
    feeds: [ok("backfilled"), ok("current"), ok("waiting"), ok("events")],
    skips: new Map(),
    now: NOW,
    planned: new Map([
      ["backfilled", ["2026Q2", "2026Q1", "2025Q4"]],
      ["current", ["2026Q2", "2026Q1"]],
      ["waiting", ["2026Q2", "2026Q1"]],
      ["events", ["ncua-mergers", "fdic-failures"]],
    ]),
    periods: [
      period("backfilled", "2025Q4", "succeeded"), period("backfilled", "2026Q1", "empty"), period("backfilled", "2026Q2", "empty"),
      period("current", "2026Q2", "succeeded"), period("current", "2026Q1", "succeeded"),
      period("waiting", "2026Q2", "empty"), period("waiting", "2026Q1", "succeeded"),
    ],
  });
  const by = (source: string) => report.sources.find((entry) => entry.source === source)!;

  it("keeps status as fetch health and reports completeness separately", () => {
    expect(report.sources.every((entry) => entry.status === "fresh")).toBe(true);
    expect(by("backfilled").completeness).toMatchObject({ state: "late", completedPeriod: "2025Q4" });
    expect(by("current").completeness).toMatchObject({ state: "complete", expectedPeriod: "2026Q2" });
    expect(by("waiting").completeness).toMatchObject({ state: "awaiting_release", completedPeriod: "2026Q1" });
    expect(by("events").completeness?.state).toBe("not_periodic");
  });

  it("names completeness gaps in the brief and ledger even when every fetch is fresh", () => {
    expect(sourceHealthLines(report)).toEqual([
      "Newest-period completeness: 1 source missing, partial or late, whatever their fetch status.",
      "- backfilled: late, 2026Q2 not released and 2026Q1 not loaded in full; newest complete 2025Q4 (2 periods behind)",
    ]);
    expect(summarizeSourceHealth(report)).toBe("Deming checked 4 public-data sources: 4 fresh; newest period missing, partial or late for 1.");
    const detail = sourceHealthDetail(report) as { sources: Array<Record<string, unknown>> };
    expect(detail.sources.find((s) => s.source === "backfilled")?.completeness).toMatchObject({
      state: "late", expected_period: "2026Q2", completed_period: "2025Q4", periods_behind: 2, coverage: { loaded: 1, planned: 3 }, awaiting_partitions: 2,
    });
  });
});

describe("readSourceHealth", () => {
  it("grades every Hoovie contract from one partition read, read-only", async () => {
    const calls: string[] = [];
    const db = vi.fn((strings: TemplateStringsArray) => {
      const text = strings.join("?");
      calls.push(text);
      if (text.includes("partition_key ~")) {
        return Promise.resolve([
          { source: "fdic-financials", partition_key: "2026Q2", status: "succeeded", row_count: 4500, partial: false, blocked: false, fetched_at: new Date("2026-10-17T00:00:00Z") },
        ]);
      }
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
    // Completeness comes from the scheduler's own plan and the period partitions (#2228).
    expect(report.sources.find((entry) => entry.source === "fdic-financials")?.completeness).toMatchObject({ expectedPeriod: "2026Q2", state: "complete" });
    expect(report.sources.find((entry) => entry.source === "industry-events")?.completeness?.state).toBe("not_periodic");
    expect(report.sources.find((entry) => entry.source === "state-bills")?.completeness?.state).toBe("not_planned");
    expect(calls.every((text) => /^\s*(SELECT|WITH)\b/.test(text) && !/\b(INSERT|UPDATE|DELETE)\b/.test(text))).toBe(true);
    // The scheduler's module graph is large; loading it the first time is slow.
  }, 60_000);
});

it("keeps recorded empty-source causes distinct without overriding holds or failures",()=>{
  const missing=feed("missing",{lastSuccessAt:NOW.toISOString(),emptyReason:"No confirmed download URL",emptyPartition:"current"});
  const weight=feed("weight",{lastSuccessAt:NOW.toISOString(),emptyReason:"No single survey weight",emptyPartition:"current"});
  expect(sourceHealth(contract("missing"),missing,null,NOW).reason).toContain("latest empty check current: No confirmed download URL");
  expect(sourceHealth(contract("weight"),weight,null,NOW).reason).toContain("No single survey weight");
  expect(sourceHealth(contract("weight"),weight,"licence held",NOW).reason).toBe("licence held");
  const failed={...weight,failed:1,lastFailedAt:NOW.toISOString(),lastSuccessAt:null,lastError:"HTTP 400"};
  expect(sourceHealth(contract("weight"),failed,null,NOW).status).toBe("failed");
  expect(sourceHealth(contract("weight"),failed,null,NOW).reason).not.toContain("survey weight");
});

it("redacts and bounds empty-check evidence without inventing a legacy reason",()=>{
  const current=feed("x",{lastSuccessAt:NOW.toISOString(),emptyReason:`UserID=secret\n${"x".repeat(400)}`,emptyPartition:"current"});
  const reason=sourceHealth(contract("x"),current,null,NOW).reason;
  expect(reason).toContain("UserID=***");
  expect(reason).not.toContain("secret");
  expect(reason).not.toContain("\n");
  expect(reason.length).toBeLessThan(260);
  expect(sourceHealth(contract("legacy"),feed("legacy",{lastSuccessAt:NOW.toISOString()}),null,NOW).reason)
    .toBe("every load so far came back empty");
});

it("does not grade a load fresh while upstream geographies remain explicitly unavailable",()=>{
  const record=feed("bea",{succeeded:1,lastSuccessAt:NOW.toISOString(),lastLoadedAt:NOW.toISOString(),partial:1,
    partialReason:"MSA code 101; supported state/county rows loaded"});
  const health=sourceHealth(contract("bea"),record,null,NOW);
  expect(health.status).toBe("failed");
  expect(health.reason).toContain("partially loaded");
  expect(health.reason).toContain("MSA code 101");
  expect(health.lastLoadedAt).toBe(NOW.toISOString());
});
