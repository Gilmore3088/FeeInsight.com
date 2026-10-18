import { beforeEach, describe, expect, it, vi } from "vitest";

const { sqlMock, startAgentRunMock } = vi.hoisted(() => ({
  sqlMock: vi.fn(),
  startAgentRunMock: vi.fn(),
}));

vi.mock("@/lib/data-store/connection", () => ({ sql: sqlMock, withTransaction: vi.fn() }));
vi.mock("@/lib/agents/run-store", () => ({ startAgentRun: startAgentRunMock }));

import {
  backfillStart,
  isKeylessSkipNowKeyed,
  keylessSkipKeysSet,
  isParserStale,
  pickDueCandidate,
  PRIORITY_REGISTRY_SOURCES,
  registryCandidates,
  registryLedgerAgent,
  registryPartitionsBySource,
  resetRegistryLedgerAgentCache,
  scheduleDueRegistryRuns,
} from "./registry-scheduler";

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

describe("registry scheduler", () => {
  const now = new Date("2026-10-03T00:00:00Z");

  it("runs the roster sources first, then round-robins the rest, newest partition of each source first", () => {
    const candidates = registryCandidates(now, { year: 2025, quarter: 4 }).map((c) => `${c.source}:${c.partitionKey}`);
    const lists = registryPartitionsBySource(now, { year: 2025, quarter: 4 });
    const priority = new Set(PRIORITY_REGISTRY_SOURCES);
    // Every roster partition comes before any other source's partition.
    const rosterCount = lists.filter((l) => priority.has(l.source)).reduce((sum, l) => sum + l.partitions.length, 0);
    expect(candidates.slice(0, rosterCount).every((c) => priority.has(c.split(":")[0]))).toBe(true);
    expect(candidates.slice(rosterCount).some((c) => priority.has(c.split(":")[0]))).toBe(false);
    expect(candidates.slice(0, 3)).toEqual(["fdic-universe:current", "ncua-financials:2026Q2", "ffiec-overdraft:2026Q1"]);
    // The rest: round one takes each source's newest partition in REGISTRY_SOURCES order; round
    // two continues the history of every source that has one. Sources with one partition drop out.
    const rest = lists.filter((l) => !priority.has(l.source));
    const roundOne = rest.filter((l) => l.partitions.length > 0).map((l) => `${l.source}:${l.partitions[0]}`);
    const roundTwo = rest.filter((l) => l.partitions.length > 1).map((l) => `${l.source}:${l.partitions[1]}`);
    const after = candidates.slice(rosterCount);
    expect(after.slice(0, roundOne.length)).toEqual(roundOne);
    expect(after.slice(roundOne.length, roundOne.length + roundTwo.length)).toEqual(roundTwo);
    expect(roundOne.slice(0, 2)).toEqual(["fdic-financials:2026Q2", "ffiec-call-detail:2026Q1"]);
    expect(roundOne).toEqual(expect.arrayContaining(["fdic-history:2026", "ncua-extras:2026Q2", "ncua-branch-geocode:pending", "wire-research:current"]));
    expect(candidates.filter((c) => c.startsWith("fdic-financials:"))).toHaveLength(3);
  });

  it("schedules nothing for a held source, and no partition of a struck one", () => {
    const lists = registryPartitionsBySource(now, { year: 2025, quarter: 4 });
    const of = (source: string) => lists.find((entry) => entry.source === source);
    expect(of("state-bill-news")?.partitions).toEqual([]);
    for (const struck of ["nacha-volume", "kcfed-sb-lending", "atlanta-fed-payment-choice", "fed-sbcs", "fhlb-advance-rates"]) expect(of(struck)).toBeUndefined();
    expect(of("fed-payments")?.partitions).toEqual(["fedach", "frps"]);
    expect(registryCandidates(now, { year: 2025, quarter: 4 }).some((c) => c.source === "state-bill-news")).toBe(false);
  });

  it("schedules World Bank remittance prices again once released from held (CC BY 4.0, 2026-10-18)", () => {
    const lists = registryPartitionsBySource(now, { year: 2025, quarter: 4 });
    expect(lists.find((entry) => entry.source === "world-bank-remittance-prices")?.partitions).toEqual(["current"]);
  });

  it("schedules nothing for a source held because a table it writes is over its size budget", () => {
    const lists = registryPartitionsBySource(now, { year: 2025, quarter: 4 }, process.env, new Set(["ncua-extras"]));
    expect(lists.find((entry) => entry.source === "ncua-extras")?.partitions).toEqual([]);
    expect(lists.find((entry) => entry.source === "ffiec-call-detail")?.partitions.length).toBeGreaterThan(0);
    expect(registryCandidates(now, { year: 2025, quarter: 4 }, new Set(["ncua-extras"])).some((c) => c.source === "ncua-extras")).toBe(false);
  });

  it("schedules state bills only once the Open States key is set", () => {
    const bills = (env: Record<string, string>) =>
      registryPartitionsBySource(now, { year: 2025, quarter: 4 }, env as NodeJS.ProcessEnv).find((entry) => entry.source === "state-bills")?.partitions ?? [];
    expect(bills({})).toEqual([]);
    expect(bills({ OPEN_STATES_API_KEY: "key" })).toEqual(["current"]);
    const federal = (env: Record<string, string>) =>
      registryPartitionsBySource(now, { year: 2025, quarter: 4 }, env as NodeJS.ProcessEnv).find((entry) => entry.source === "federal-bills")?.partitions;
    expect(federal({})).toEqual([]);
    expect(federal({ CONGRESS_GOV_API_KEY: "key" })).toEqual(["current"]);
  });

  it("defaults the backfill to 2010Q1 and honours REGISTRY_BACKFILL_FROM", () => {
    expect(backfillStart(undefined)).toEqual({ year: 2010, quarter: 1 });
    expect(backfillStart("2005Q3")).toEqual({ year: 2005, quarter: 3 });
    expect(backfillStart("garbage")).toEqual({ year: 2010, quarter: 1 });
  });

  it("makes a vintage skipped for a missing Census key due once a key is set", () => {
    expect(isKeylessSkipNowKeyed(true, "abc123")).toBe(true);
    expect(isKeylessSkipNowKeyed(true, undefined)).toBe(false);
    expect(isKeylessSkipNowKeyed(true, "  ")).toBe(false);
    expect(isKeylessSkipNowKeyed(false, "abc123")).toBe(false);
  });

  it("re-pulls BEA years and USDA cash rents skipped without a key once that key is set", () => {
    expect(keylessSkipKeysSet({})).toEqual({ CENSUS_API_KEY: false, BEA_API_KEY: false, NASS_API_KEY: false });
    expect(keylessSkipKeysSet({ BEA_API_KEY: "k", NASS_API_KEY: " n ", CENSUS_API_KEY: "  " })).toEqual({
      CENSUS_API_KEY: false,
      BEA_API_KEY: true,
      NASS_API_KEY: true,
    });
  });

  it("re-pulls succeeded NCUA quarters recorded under an older parser", () => {
    expect(isParserStale("ncua-financials", "succeeded", null)).toBe(true);
    expect(isParserStale("ncua-financials", "succeeded", 1)).toBe(true);
    // The first enforcement load (no parser_version) re-runs as soon as the matcher changes.
    expect(isParserStale("enforcement", "succeeded", null)).toBe(true);
    expect(isParserStale("enforcement", "succeeded", 2)).toBe(true);
    expect(isParserStale("enforcement", "succeeded", 3)).toBe(false);
    expect(isParserStale("ncua-financials", "succeeded", 2)).toBe(true);
    expect(isParserStale("ncua-financials", "succeeded", 3)).toBe(false);
    // A partition claimed under the current parser follows its normal retry time instead of looping.
    expect(isParserStale("ncua-financials", "scheduled", 1, 3)).toBe(false);
    expect(isParserStale("ncua-financials", "failed", 1)).toBe(false);
    expect(isParserStale("fdic-financials", "succeeded", null)).toBe(false);
    // An "empty" recorded by an older parser is checked again (census v1 misread errors as unpublished).
    expect(isParserStale("census-acs", "empty", null)).toBe(true);
    expect(isParserStale("census-acs", "empty", 3)).toBe(false);
    // A partition claimed under an older parser (its run failed) retries as soon as the fix ships.
    expect(isParserStale("ffiec-overdraft", "scheduled", null, null)).toBe(true);
    expect(isParserStale("ffiec-overdraft", "scheduled", null, 1)).toBe(true);
    expect(isParserStale("ffiec-overdraft", "scheduled", null, 2)).toBe(false);
    // Sources without a parser version keep their normal retry time.
    expect(isParserStale("fdic-financials", "scheduled", null, null)).toBe(false);
  });

  it("picks the first never-attempted or due partition", () => {
    const candidates = [
      { source: "fdic-universe", partitionKey: "current" },
      { source: "fdic-financials", partitionKey: "2026Q2" },
      { source: "fdic-financials", partitionKey: "2026Q1" },
    ];
    expect(
      pickDueCandidate(candidates, [
        { source: "fdic-universe", partition_key: "current", due: false },
        { source: "fdic-financials", partition_key: "2026Q2", due: false },
      ]),
    ).toEqual({ source: "fdic-financials", partitionKey: "2026Q1" });
    expect(
      pickDueCandidate(candidates, [
        { source: "fdic-universe", partition_key: "current", due: false },
        { source: "fdic-financials", partition_key: "2026Q2", due: true },
        { source: "fdic-financials", partition_key: "2026Q1", due: false },
      ]),
    ).toEqual({ source: "fdic-financials", partitionKey: "2026Q2" });
    expect(
      pickDueCandidate(candidates, [
        { source: "fdic-universe", partition_key: "current", due: false },
        { source: "fdic-financials", partition_key: "2026Q2", due: false },
        { source: "fdic-financials", partition_key: "2026Q1", due: false },
      ]),
    ).toBeNull();
  });

  describe("scheduleDueRegistryRuns", () => {
    beforeEach(() => {
      sqlMock.mockReset();
      startAgentRunMock.mockReset();
      resetRegistryLedgerAgentCache();
    });

    function routeSql(handlers: Array<[string, unknown[]]>) {
      sqlMock.mockImplementation((strings: unknown) => {
        if (!Array.isArray(strings) || !("raw" in (strings as object))) return strings;
        const text = templateText(strings);
        for (const [needle, rows] of handlers) if (text.includes(needle)) return Promise.resolve(rows);
        return Promise.resolve([]);
      });
    }

    it("waits while a registry run is still in flight", async () => {
      routeSql([["FROM agent_runs", [{ active: true }]]]);
      await expect(scheduleDueRegistryRuns({ now })).resolves.toEqual({ scheduled: false, reason: "active_run" });
      expect(startAgentRunMock).not.toHaveBeenCalled();
    });

    it("claims the next partition and starts a one-step Hoovie run under the unchanged run marker (#1865)", async () => {
      routeSql([
        ["FROM agent_runs", [{ active: false }]],
        ["FROM registry_ingest_partitions", [{ source: "fdic-universe", partition_key: "current", due: false }]],
        ["INSERT INTO registry_ingest_partitions", [{ id: 1 }]],
        ["FROM agent_registry", [{ present: true }]],
      ]);
      startAgentRunMock.mockResolvedValue({ run: { id: 501, status: "queued" }, steps: [], reused: false });

      const result = await scheduleDueRegistryRuns({ now, triggeredBy: "test" });

      expect(result).toMatchObject({ scheduled: true, source: "ncua-financials", partitionKey: "2026Q2", runId: 501 });
      expect(startAgentRunMock.mock.calls[0][0].params).not.toHaveProperty("ledger_agent_fallback");
      expect(startAgentRunMock).toHaveBeenCalledWith(
        expect.objectContaining({
          agent: "hoovie",
          title: "Hoovie registry: Pull NCUA 5300 call-report financials 2026Q2",
          kind: "workflow",
          idempotencyKey: "magellan:registry:ncua-financials:2026Q2",
          params: expect.objectContaining({ source: "magellan.registry", partition_key: "2026Q2" }),
          steps: [expect.objectContaining({ key: "registry-ncua-financials", agent: "hoovie", input: { partition_key: "2026Q2" } })],
        }),
      );
    });

    it("keeps Magellan's name, and says why, while the hoovie agent_registry row is missing (#1865)", async () => {
      routeSql([
        ["FROM agent_runs", [{ active: false }]],
        ["FROM registry_ingest_partitions", [{ source: "fdic-universe", partition_key: "current", due: false }]],
        ["INSERT INTO registry_ingest_partitions", [{ id: 1 }]],
        ["FROM agent_registry", [{ present: false }]],
      ]);
      startAgentRunMock.mockResolvedValue({ run: { id: 502, status: "queued" }, steps: [], reused: false });

      await scheduleDueRegistryRuns({ now, triggeredBy: "test" });

      expect(startAgentRunMock).toHaveBeenCalledWith(
        expect.objectContaining({
          agent: "magellan",
          title: "Magellan registry: Pull NCUA 5300 call-report financials 2026Q2",
          idempotencyKey: "magellan:registry:ncua-financials:2026Q2",
          params: expect.objectContaining({ source: "magellan.registry", ledger_agent_fallback: "hoovie row missing" }),
          steps: [expect.objectContaining({ key: "registry-ncua-financials", agent: "magellan" })],
        }),
      );
    });

    it("reads the agent_registry row once per process, and asks again after a failed read", async () => {
      const registryReads = () => sqlMock.mock.calls.filter(([strings]) => templateText(strings).includes("FROM agent_registry")).length;
      routeSql([["FROM agent_registry", [{ present: true }]]]);
      await expect(registryLedgerAgent()).resolves.toEqual({ agent: "hoovie" });
      await expect(registryLedgerAgent()).resolves.toEqual({ agent: "hoovie" });
      expect(registryReads()).toBe(1);

      resetRegistryLedgerAgentCache();
      sqlMock.mockImplementation(() => Promise.reject(new Error("connection refused")));
      await expect(registryLedgerAgent()).resolves.toEqual({ agent: "magellan", fallback: "hoovie row check failed" });
      routeSql([["FROM agent_registry", [{ present: true }]]]);
      await expect(registryLedgerAgent()).resolves.toEqual({ agent: "hoovie" });
      expect(registryReads()).toBe(3);
    });

    function sourceLists(): string[][] {
      return sqlMock.mock.calls
        .map(([first]) => first)
        .filter((first): first is string[] => Array.isArray(first) && !("raw" in (first as object)));
    }

    it("holds the sources that write a table Atlas last measured over budget", async () => {
      routeSql([
        ["FROM agent_runs", [{ active: false }]],
        ["budget_tables", [{ budget_tables: { institution_call_report_items: 7_400, area_statistics: 900 } }]],
        ["INSERT INTO registry_ingest_partitions", [{ id: 1 }]],
      ]);
      startAgentRunMock.mockResolvedValue({ run: { id: 502, status: "queued" }, steps: [], reused: false });

      const result = await scheduleDueRegistryRuns({ now, triggeredBy: "test" });

      expect(result.scheduled).toBe(true);
      expect(result.source).not.toBe("ffiec-call-detail");
      expect(result.source).not.toBe("ncua-extras");
      expect(result.heldForSize).toEqual(expect.arrayContaining([
        { source: "ffiec-call-detail", tables: ["institution_call_report_items"] },
        { source: "ncua-extras", tables: ["institution_call_report_items"] },
      ]));
      const [sources] = sourceLists();
      expect(sources).not.toContain("ncua-extras");
      expect(sources).not.toContain("ffiec-call-detail");
      expect(sources).toContain("fdic-financials");
    });

    it("holds nothing when no storage run has measured the tables", async () => {
      routeSql([
        ["FROM agent_runs", [{ active: false }]],
        ["INSERT INTO registry_ingest_partitions", [{ id: 1 }]],
      ]);
      startAgentRunMock.mockResolvedValue({ run: { id: 503, status: "queued" }, steps: [], reused: false });

      const result = await scheduleDueRegistryRuns({ now, triggeredBy: "test" });

      expect(result.heldForSize).toBeUndefined();
      const [sources] = sourceLists();
      expect(sources).toContain("ncua-extras");
      expect(sources).toContain("ffiec-call-detail");
    });

    it("does not start a run when another tick already claimed the partition", async () => {
      routeSql([
        ["FROM agent_runs", [{ active: false }]],
        ["FROM registry_ingest_partitions", []],
        ["INSERT INTO registry_ingest_partitions", []],
      ]);
      await expect(scheduleDueRegistryRuns({ now })).resolves.toEqual({ scheduled: false, reason: "claim_lost" });
      expect(startAgentRunMock).not.toHaveBeenCalled();
    });

    it("stays quiet until the migration is applied", async () => {
      routeSql([["FROM agent_runs", [{ active: false }]]]);
      sqlMock.mockImplementation((strings: unknown) => {
        if (!Array.isArray(strings) || !("raw" in (strings as object))) return strings;
        const text = templateText(strings);
        if (text.includes("FROM agent_runs")) return Promise.resolve([{ active: false }]);
        return Promise.reject(new Error('relation "registry_ingest_partitions" does not exist'));
      });
      await expect(scheduleDueRegistryRuns({ now })).resolves.toEqual({ scheduled: false, reason: "schema_missing" });
    });
  });
});
