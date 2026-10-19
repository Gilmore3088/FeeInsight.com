import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", () => ({ sql: vi.fn(() => Promise.reject(new Error('relation "public_data_cold_files" does not exist'))) }));

import { ColdFileWriter, type ColdStore } from "@/lib/agents/hoovie/cold-files";
import { CALL_ITEM_COLUMNS } from "@/lib/agents/hoovie/storage-tiers";
import {
  clearColdIndexCache,
  coldCallRollup,
  coldFilesInRange,
  coldInstitutionSeries,
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
    expect(coldFilesInRange(files, { rowSources: ["ffiec"], from: "2018-04", to: null, hotPeriods: new Set(["2020-12-31"]) })).toEqual([f("ffiec", "2019-06-30")]);
    expect(coldFilesInRange(files, { rowSources: ["ffiec", "ncua"], from: null, to: "2019-06", hotPeriods: new Set() }).map((x) => x.objectKey)).toEqual([
      "ffiec/2019-06-30",
      "ncua/2019-06-30",
      "ffiec/2018-03-31",
    ]);
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
      { period: "2019-06-30", unit: "USD", median: 1_000, p25: 501, p75: 2_000, institution_count: 3, period_basis: "ytd", sources: ["ffiec", "ncua"], fetched_at: "2026-02-01", source_url: "new" },
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
});
