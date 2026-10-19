import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn(() => Promise.reject(new Error('relation "public_data_cold_files" does not exist'))) }));

import { ColdFileWriter, type ColdStore } from "@/lib/agents/hoovie/cold-files";
import { CALL_ITEM_COLUMNS } from "@/lib/agents/hoovie/storage-tiers";
import {
  callSourcePeriodKey,
  canonicalColdCallRows,
  clearColdIndexCache,
  coldCallRollup,
  coldFilesInRange,
  coldInstitutionSeries,
  missingColdValue,
  percentileCont,
  prunedCallFiles,
  readColdCallRows,
  type ColdCallRow,
} from "./cold-reads";

const row = (over: Partial<ColdCallRow>): ColdCallRow => ({
  institution_id: 1,
  source: "ffiec",
  report_date: "2019-06-30",
  item_code: "RIAD4080",
  item_key: "service_charges_deposits_ytd",
  item_description: null,
  schedule: "RI",
  value: 1,
  unit: "thousands",
  period_basis: "ytd",
  source_url: null,
  fetched_at: null,
  ...over,
});

describe("cold reads", () => {
  it("finds no files when the index table is not migrated", async () => {
    clearColdIndexCache();
    expect(await prunedCallFiles()).toEqual([]);
  });

  it("picks files by source and month bounds, newest first, skipping periods Postgres answered", () => {
    const f = (source: string, period: string) => ({ source, period, objectKey: `${source}/${period}`, rowCount: 1, sha256: "x" });
    const files = [f("ffiec", "2018-03-31"), f("ncua", "2019-06-30"), f("ffiec", "2019-06-30"), f("ffiec", "2020-12-31")];
    expect(coldFilesInRange(files, { rowSources: ["ffiec"], from: "2018-04", to: null, hotSourcePeriods: new Set([callSourcePeriodKey("ffiec", "2020-12-31")]) })).toEqual([f("ffiec", "2019-06-30")]);
    expect(coldFilesInRange(files, { rowSources: ["ffiec", "ncua"], from: null, to: "2019-06", hotSourcePeriods: new Set() }).map((x) => x.objectKey)).toEqual([
      "ffiec/2019-06-30",
      "ncua/2019-06-30",
      "ffiec/2018-03-31",
    ]);
  });

  it("keeps archived NCUA and FFIEC coverage independent within the same period", () => {
    const files = ["ffiec", "ncua"].map((source) => ({ source, period: "2026-06-30", objectKey: source, rowCount: 1, sha256: "x" }));
    expect(coldFilesInRange(files, { rowSources: ["ffiec", "ncua"], from: null, to: null,
      hotSourcePeriods: new Set([callSourcePeriodKey("ffiec", "2026-06-30")]) })).toEqual([files[1]]);
    expect(coldFilesInRange(files, { rowSources: ["ffiec", "ncua"], from: null, to: null,
      hotSourcePeriods: new Set([callSourcePeriodKey("ncua", "2026-06-30")]) })).toEqual([files[0]]);
  });

  it("requires canonical institution identity before archived rows enter a series or rollup", () => {
    const rows = [
      row({ institution_id: 1, source: "ffiec", value: 10 }),
      row({ institution_id: 2, source: "ncua", value: 20 }),
      row({ institution_id: 1, source: "ncua", value: 999 }),
      row({ institution_id: 2, source: "ffiec", value: 999 }),
      row({ institution_id: 3, source: "ncua", value: 999 }),
      row({ institution_id: 4, source: "ncua", value: 999 }),
    ];
    const filtered = canonicalColdCallRows(rows, [{ id: "1", charter_type: "bank" }, { id: 2, charter_type: "credit_union" }, { id: 3, charter_type: "unknown" }]);
    expect(filtered.map((r) => [r.institution_id, r.source])).toEqual([[1, "ffiec"], [2, "ncua"]]);
    expect(coldInstitutionSeries(filtered).map((r) => r.value)).toEqual([10000, 20000]);
    expect(coldCallRollup(filtered).map((r) => [r.sources, r.institution_count, r.median])).toEqual([
      [["ffiec"], 1, 10000], [["ncua"], 1, 20000],
    ]);
  });

  it("computes subject inclusion separately for each archived source and period", () => {
    const rows = coldCallRollup([
      row({ institution_id: 1, source: "ffiec", value: 1 }),
      row({ institution_id: 2, source: "ncua", value: 2 }),
      row({ institution_id: 1, source: "ffiec", report_date: "2019-03-31", value: 3 }),
    ], 1);
    expect(rows.map((r) => [r.period, r.sources, r.subject_included, r.institution_count])).toEqual([
      ["2019-06-30", ["ffiec"], true, 1],
      ["2019-06-30", ["ncua"], false, 1],
      ["2019-03-31", ["ffiec"], true, 1],
    ]);
    expect(coldCallRollup([row({})], null)[0].subject_included).toBeNull();
  });

  it("matches Postgres percentile_cont", () => {
    expect(percentileCont([1, 2, 3, 4], 0.5)).toBe(2.5);
    expect(percentileCont([1, 2, 3, 4], 0.25)).toBe(1.75);
    expect(percentileCont([7], 0.75)).toBe(7);
    expect(percentileCont([], 0.5)).toBeNull();
  });

  it("rolls cold rows up like the hot query: dollars, distinct institutions, newest source link", () => {
    const rows = [
      row({ institution_id: 1, value: 1, fetched_at: "2026-01-01", source_url: "old" }),
      row({ institution_id: 2, value: 3, fetched_at: "2026-02-01", source_url: "new" }),
      row({ institution_id: 3, value: 2, unit: "dollars", source: "ncua", item_code: "ACCT_131" }),
      row({ report_date: "2019-03-31", value: 5 }),
    ];
    expect(coldCallRollup(rows)).toEqual([
      { period: "2019-06-30", unit: "USD", median: 2_000, p25: 1500, p75: 2500, institution_count: 2, period_basis: "ytd", sources: ["ffiec"], fetched_at: "2026-02-01", source_url: "new" },
      { period: "2019-06-30", unit: "USD", median: 2, p25: 2, p75: 2, institution_count: 1, period_basis: "ytd", sources: ["ncua"], fetched_at: null, source_url: null },
      { period: "2019-03-31", unit: "USD", median: 5_000, p25: 5_000, p75: 5_000, institution_count: 1, period_basis: "ytd", sources: ["ffiec"], fetched_at: null, source_url: null },
    ]);
    expect(coldInstitutionSeries([row({ value: 2 })])[0]).toMatchObject({ period: "2019-06-30", value: 2_000, unit: "USD" });
  });

  it("reads only the asked line and members from a checked file, and reports a file that fails its checks", async () => {
    const writer = new ColdFileWriter(CALL_ITEM_COLUMNS);
    const base = { source: "ffiec", report_date: "2019-06-30", item_code: "RIAD4080", item_description: "x", schedule: "RI", unit: "thousands", period_basis: "ytd", source_url: null, agent_run_id: null, fetched_at: null };
    writer.push([
      { ...base, id: "1", institution_id: "12", item_key: "service_charges_deposits_ytd", value: "900" },
      { ...base, id: "2", institution_id: "13", item_key: "service_charges_deposits_ytd", value: "100" },
      { ...base, id: "3", institution_id: "12", item_key: "total_deposits", value: "5" },
    ]);
    const file = writer.finish();
    const store: ColdStore = { configured: true, bucket: "b", put: async () => undefined, get: async () => file.bytes };
    const ref = { source: "ffiec", period: "2019-06-30", objectKey: "k", rowCount: 3, sha256: file.sha256 };
    const read = await readColdCallRows([ref, { ...ref, period: "2019-03-31", sha256: "0".repeat(64) }], { itemKey: "service_charges_deposits_ytd", institutionIds: [12] }, store);
    expect(read.rows).toEqual([expect.objectContaining({ institution_id: 12, value: 900, report_date: "2019-06-30" })]);
    expect(read.failed).toEqual(["ffiec 2019-03-31"]);
  });

  it("never reads a missing generic value as zero, keeps a reported zero, and names the file (#2315)", async () => {
    const writer = new ColdFileWriter(CALL_ITEM_COLUMNS);
    const base = { source: "ffiec", report_date: "2019-06-30", item_code: "RIAD4080", item_key: "service_charges_deposits_ytd", item_description: "x", schedule: "RI", unit: "thousands", period_basis: "ytd", source_url: null, agent_run_id: null, fetched_at: null };
    writer.push([
      { ...base, id: "1", institution_id: "11", value: "0" },
      { ...base, id: "2", institution_id: "12", value: null },
      { ...base, id: "3", institution_id: "13", value: "" },
      { ...base, id: "4", institution_id: "14", value: "  " },
      { ...base, id: "5", institution_id: "15", value: "n/a" },
      { ...base, id: "6", institution_id: "16", value: "250" },
    ]);
    const file = writer.finish();
    const store: ColdStore = { configured: true, bucket: "b", put: async () => undefined, get: async () => file.bytes };
    const ref = { source: "ffiec", period: "2019-06-30", objectKey: "k", rowCount: 6, sha256: file.sha256 };
    const read = await readColdCallRows([ref], { itemKey: "service_charges_deposits_ytd", institutionIds: null }, store);
    expect(read.rows.map((r) => [r.institution_id, r.value])).toEqual([[11, 0], [16, 250]]);
    expect(read.failed).toEqual([]);
    expect(read.incomplete).toEqual(["ffiec 2019-06-30 (4 rows missing a value)"]);
    // Checksum, source and period validation still come first: a bad checksum fails the file outright.
    const bad = await readColdCallRows([{ ...ref, sha256: "0".repeat(64) }], { itemKey: "service_charges_deposits_ytd", institutionIds: null }, store);
    expect(bad).toEqual({ rows: [], failed: ["ffiec 2019-06-30"], incomplete: [] });
    // Rows outside the asked members are not counted against the file.
    expect((await readColdCallRows([ref], { itemKey: "service_charges_deposits_ytd", institutionIds: [11] }, store)).incomplete).toEqual([]);
  });

  it("tells a missing value from a reported one", () => {
    for (const value of [null, undefined, "", " ", "n/a", Number.NaN, Number.POSITIVE_INFINITY, {}]) expect(missingColdValue(value)).toBe(true);
    for (const value of [0, "0", "-3.5", 12]) expect(missingColdValue(value)).toBe(false);
  });

  it("keeps cold roll-ups separate by period basis and unit", () => {
    const rows = coldCallRollup([
      row({ value: 10, unit: "dollars", period_basis: "ytd" }),
      row({ institution_id: 2, value: 20, unit: "dollars", period_basis: "point_in_time" }),
      row({ institution_id: 3, value: 3, unit: "count", period_basis: "point_in_time" }),
    ]);
    expect(rows).toHaveLength(3);
    expect(rows).toEqual(expect.arrayContaining([
      expect.objectContaining({ unit: "USD", period_basis: "ytd", median: 10, institution_count: 1 }),
      expect.objectContaining({ unit: "USD", period_basis: "point_in_time", median: 20, institution_count: 1 }),
      expect.objectContaining({ unit: "count", period_basis: "point_in_time", median: 3, institution_count: 1 }),
    ]));
  });

  it("rejects contradictory curated units, bases and publisher rows even inside checksum-valid archives", async () => {
    const writer = new ColdFileWriter(CALL_ITEM_COLUMNS);
    const base = { ...row({ source: "ncua", item_key: "acct_131", item_code: "ACCT_131", unit: "dollars", value: 12 }), id: "1", institution_id: "12", agent_run_id: null };
    writer.push([
      base,
      { ...base, id: "2", source: "ffiec", value: 999999 },
      { ...base, id: "3", unit: "thousands", value: 999999 },
      { ...base, id: "4", period_basis: "point_in_time", value: 999999 },
      { ...base, id: "5", report_date: "2019-03-31", value: 999999 },
      { ...base, id: "6", item_code: "ACCT_380", value: 999999 },
      { ...base, id: "7", value: null },
    ]);
    const file = writer.finish();
    const store: ColdStore = { configured: true, bucket: "b", put: async () => undefined, get: async () => file.bytes };
    const ref = { source: "ncua", period: "2019-06-30", objectKey: "k", rowCount: 7, sha256: file.sha256 };
    expect(await readColdCallRows([ref], { itemKey: "acct_131", institutionIds: [12] }, store)).toEqual({
      rows: [expect.objectContaining({ value: 12, source: "ncua", period_basis: "ytd", unit: "dollars" })],
      failed: [],
      incomplete: ["ncua 2019-06-30 (1 row missing a value)"],
    });
    // A correctly indexed FFIEC file still cannot supply a curated NCUA measure.
    expect((await readColdCallRows([{ ...ref, source: "ffiec" }], { itemKey: "acct_131", institutionIds: [12] }, store)).rows).toEqual([]);
  });
});
