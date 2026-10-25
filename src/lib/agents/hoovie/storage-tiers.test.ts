import { describe, expect, it, vi } from "vitest";

import { decodeColdFile, type ColdStore } from "./cold-files";
import {
  COLD_EXPORT_LIVE,
  COLD_TIER_POLICY,
  PLAN_COUNTS_PER_RUN,
  coldTierDetail,
  runColdTier,
  splitHotCold,
  summarizeColdTier,
} from "./storage-tiers";

type Row = Record<string, unknown>;

const QUARTERS = (n: number, year = 2026) =>
  Array.from({ length: n }, (_, i) => {
    const q = 3 - (i % 4);
    const y = year - Math.floor(i / 4);
    return `${y}-${["03-31", "06-30", "09-30", "12-31"][q]}`;
  });

/** A tagged-template db mock answering by the SQL it sees; records every statement and its values. */
function mockDb(answers: { periods?: Record<string, string[]>; indexReady?: boolean; files?: Row[]; prior?: Record<string, number>; count?: number; exportRows?: Row[] }) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn((strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join(" ");
    calls.push({ text, values });
    const result = (rows: unknown[]) => Object.assign(Promise.resolve(rows), {
      cursor: () => ({
        async *[Symbol.asyncIterator]() {
          yield answers.exportRows ?? [];
        },
      }),
    });
    if (text.includes("current_setting('statement_timeout')")) return result([{ value: "0" }]);
    if (text.includes("INSERT INTO public_data_cold_files")) return result([{ id: "1" }]);
    if (text.includes("WITH RECURSIVE d")) return result((answers.periods?.[values[0] as string] ?? []).map((period) => ({ period })));
    if (text.includes("pg_total_relation_size")) return result([{ bytes: String(400 * 1_000_000), tuples: "1000000" }]);
    if (text.includes("to_regclass('public.public_data_cold_files')")) return result([{ ready: answers.indexReady ?? true }]);
    if (text.includes("FROM public_data_cold_files")) return result(answers.files ?? []);
    if (text.includes("cold_tier")) return result(answers.prior ? [{ counts: answers.prior }] : []);
    if (text.includes("count(*)::bigint AS n")) return result([{ n: String(answers.count ?? 0) }]);
    if (text.includes("FROM institution_call_report_items") && text.includes("item_description")) return result(answers.exportRows ?? []);
    return result([]);
  });
  Object.assign(db, { unsafe: (text: string) => text });
  return { db: db as unknown as Parameters<typeof runColdTier>[0]["db"], calls };
}

function memoryStore(): ColdStore & { objects: Map<string, Uint8Array> } {
  const objects = new Map<string, Uint8Array>();
  return {
    configured: true,
    bucket: "test-bucket",
    objects,
    async put(key, bytes) {
      objects.set(key, bytes);
    },
    async get(key) {
      const bytes = objects.get(key);
      if (!bytes) throw new Error("missing");
      return bytes;
    },
  };
}

const writes = (calls: Array<{ text: string }>) => calls.filter((c) => /\b(DELETE|UPDATE|INSERT|TRUNCATE)\b/.test(c.text) && !c.text.includes("set_config"));

describe("policy", () => {
  it("keeps the export off and tiers only the call-report table, with twelve quarters hot", () => {
    expect(COLD_EXPORT_LIVE).toBe(false);
    expect(COLD_TIER_POLICY.map((p) => [p.table, p.hotPeriods])).toEqual([["institution_call_report_items", 12]]);
  });

  it("splits newest-first periods into hot and cold", () => {
    expect(splitHotCold(["2026-06-30", "2025-12-31", "2026-03-31", "2025-09-30"], 2)).toEqual({
      hot: ["2026-06-30", "2026-03-31"],
      cold: ["2025-12-31", "2025-09-30"],
    });
    expect(splitHotCold(["2026-06-30"], 8)).toEqual({ hot: ["2026-06-30"], cold: [] });
  });
});

describe("runColdTier", () => {
  it("counts at most a few cold periods a run, oldest first, carries earlier counts, and writes nothing", async () => {
    const ffiec = QUARTERS(16);
    const oldest = ffiec.at(-1)!;
    const { db, calls } = mockDb({
      periods: { ffiec, ncua: QUARTERS(8) },
      prior: { [`institution_call_report_items|ffiec|${oldest}`]: 1_000 },
      count: 500,
    });
    const result = await runColdTier({ db, store: memoryStore() });
    const table = result.tables[0];
    expect(table.hot.ffiec).toEqual(ffiec.slice(0, 12));
    expect(table.hot.ncua).toHaveLength(8);
    expect(table.cold.map((p) => p.period)).toEqual([...ffiec.slice(12)].reverse());
    // One carried, PLAN_COUNTS_PER_RUN counted, the rest not yet.
    expect(table.cold.map((p) => p.rows)).toEqual([1_000, 500, 500, null]);
    expect(PLAN_COUNTS_PER_RUN).toBe(2);
    expect(table.countedRows).toBe(2_000);
    expect(table.avgRowBytes).toBe(400);
    expect(table.estimatedMbFreed).toBe(Math.round((2_000 * 400) / 1_048_576));
    expect(result.exportLive).toBe(false);
    expect(result.exported).toEqual([]);
    expect(writes(calls)).toEqual([]);
    expect(calls.some((c) => c.text.includes("set_config('statement_timeout'") && c.values.includes("10s"))).toBe(true);
    expect(summarizeColdTier(result)).toContain("4 periods older than the newest 12 per source; 2,000 rows in 3 counted");
    expect(summarizeColdTier(result)).toContain("Export off; pruning waits for James's yes.");
    expect(coldTierDetail(result)).toMatchObject({ export_live: false, index_ready: true, counts: { [`institution_call_report_items|ffiec|${oldest}`]: 1_000 } });
  });

  it("uses a file's row count and state for a period already exported", async () => {
    const ffiec = QUARTERS(13);
    const { db } = mockDb({ periods: { ffiec }, files: [{ table_name: "institution_call_report_items", source: "ffiec", period: ffiec[12], row_count: "77", verified_at: "2026-10-18", pruned_at: null }] });
    const result = await runColdTier({ db, store: memoryStore() });
    expect(result.tables[0].cold).toEqual([{ source: "ffiec", period: ffiec[12], rows: 77, file: "verified" }]);
  });

  it("exports nothing in a dry run even when switched on, and says when the index table is missing", async () => {
    const { db, calls } = mockDb({ periods: { ffiec: QUARTERS(10) }, indexReady: false, count: 5 });
    const result = await runColdTier({ db, dryRun: true, exportLive: true, store: memoryStore() });
    expect(result.exportLive).toBe(false);
    expect(result.indexReady).toBe(false);
    expect(writes(calls)).toEqual([]);
    expect(summarizeColdTier(result)).toContain("not migrated yet");
  });

  it("when switched on, writes the oldest cold period to a verified file and its index row, and deletes nothing", async () => {
    const ffiec = QUARTERS(13);
    const exportRows = [
      { id: "1", institution_id: "12", source: "ffiec", report_date: ffiec[12], item_code: "RIAD4080", item_key: "service_charges_deposits_ytd", item_description: "x", schedule: "RI", value: "900", unit: "thousands", period_basis: "ytd", source_url: null, agent_run_id: null, fetched_at: new Date("2026-10-17T00:00:00Z") },
    ];
    const store = memoryStore();
    const { db, calls } = mockDb({ periods: { ffiec }, count: 1, exportRows });
    const result = await runColdTier({ db, exportLive: true, store, runId: 5 });
    expect(result.exported).toEqual([expect.objectContaining({ status: "exported", rowCount: 1, period: ffiec[12] })]);
    const key = result.exported[0].objectKey!;
    expect(decodeColdFile(store.objects.get(key)!).rows[0]).toMatchObject({ item_key: "service_charges_deposits_ytd", value: "900" });
    const w = writes(calls);
    expect(w).toHaveLength(1);
    expect(w[0].text).toContain("INSERT INTO public_data_cold_files");
    expect(w[0].text).toContain("WHERE public_data_cold_files.pruned_at IS NULL");
    expect(calls.some((c) => c.text.includes("DELETE"))).toBe(false);
  });

  it("never throws: a failed listing is reported", async () => {
    const failing = vi.fn(() => Promise.reject(new Error("canceling statement due to statement timeout"))) as unknown as Parameters<typeof runColdTier>[0]["db"];
    const result = await runColdTier({ db: failing, store: memoryStore() });
    expect(result.error).toContain("statement timeout");
    expect(summarizeColdTier(result)).toContain("could not plan");
  });
});
