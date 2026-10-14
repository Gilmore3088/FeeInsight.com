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
  isParserStale,
  pickDueCandidate,
  registryCandidates,
  registryPartitionsBySource,
  scheduleDueRegistryRuns,
} from "./registry-scheduler";

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

describe("registry scheduler", () => {
  const now = new Date("2026-10-03T00:00:00Z");

  it("round-robins sources, identity syncs first, newest partition of each source first", () => {
    const candidates = registryCandidates(now, { year: 2025, quarter: 4 }).map((c) => `${c.source}:${c.partitionKey}`);
    expect(candidates.slice(0, 24)).toEqual([
      "fdic-universe:current",
      "fdic-financials:2026Q2",
      "ncua-financials:2026Q2",
      "ffiec-overdraft:2026Q1",
      "fdic-sod:2026",
      "ncua-branches:2026Q2",
      "ncua-branch-geocode:pending",
      "cfpb:2026",
      "census-acs:2025",
      "irs-zip-income:2024",
      "sec-links:current",
      "sec-filings:batch-0",
      "beige-book:202610",
      "fred:current",
      "fomc-minutes:current",
      "fed-publications:current",
      "reg-news:current",
      "federal-register:current",
      "state-reg-news:current",
      "state-bill-news:current",
      "state-regulators:current",
      "enforcement:current",
      "state-enforcement:current",
      "wire-research:current",
    ]);
    // Round two continues each source's history.
    // Credit union branches pull only the newest quarter, so they drop out after round one.
    expect(candidates.slice(24, 32)).toEqual([
      "fdic-financials:2026Q1",
      "ncua-financials:2026Q1",
      "ffiec-overdraft:2026Q2",
      "fdic-sod:2025",
      "cfpb:2025",
      "census-acs:2024",
      "irs-zip-income:2023",
      "sec-filings:batch-1",
    ]);
    expect(candidates.filter((c) => c.startsWith("fdic-financials:"))).toHaveLength(3);
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

    it("claims the next partition and starts a one-step Magellan run", async () => {
      routeSql([
        ["FROM agent_runs", [{ active: false }]],
        ["FROM registry_ingest_partitions", [{ source: "fdic-universe", partition_key: "current", due: false }]],
        ["INSERT INTO registry_ingest_partitions", [{ id: 1 }]],
      ]);
      startAgentRunMock.mockResolvedValue({ run: { id: 501, status: "queued" }, steps: [], reused: false });

      const result = await scheduleDueRegistryRuns({ now, triggeredBy: "test" });

      expect(result).toMatchObject({ scheduled: true, source: "fdic-financials", partitionKey: "2026Q2", runId: 501 });
      expect(startAgentRunMock).toHaveBeenCalledWith(
        expect.objectContaining({
          agent: "magellan",
          kind: "workflow",
          idempotencyKey: "magellan:registry:fdic-financials:2026Q2",
          params: expect.objectContaining({ source: "magellan.registry", partition_key: "2026Q2" }),
          steps: [expect.objectContaining({ key: "registry-fdic-financials", input: { partition_key: "2026Q2" } })],
        }),
      );
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
