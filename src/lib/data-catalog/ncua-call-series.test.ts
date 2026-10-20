import { beforeEach, describe, expect, it, vi } from "vitest";

const { rows, calls, cached } = vi.hoisted(() => ({
  rows: [] as unknown[], calls: [] as Array<{ text: string; values: unknown[] }>, cached: vi.fn(),
}));
vi.mock("next/cache", () => ({ unstable_cache: (fn: () => Promise<unknown>) => {
  cached.mockImplementation(fn);
  return cached;
} }));
vi.mock("@/lib/data-store/connection", () => ({ withTransaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(
  (strings: TemplateStringsArray, ...values: unknown[]) => {
    const text = strings.join("?");
    calls.push({ text, values });
    return Promise.resolve(text.includes("SET LOCAL") ? [] : rows);
  },
) }));

import { NCUA_CALL_MEASURES } from "./ncua-call-measures";
import { getNcuaCallSeries, readNcuaCallSeries, resetNcuaCallSeriesRetry } from "./ncua-call-series";

beforeEach(() => {
  rows.length = 0; calls.length = 0; vi.clearAllMocks(); resetNcuaCallSeriesRetry();
});

describe("NCUA call-report discovery", () => {
  it("advertises only loaded curated keys and carries publisher units, basis and coverage", async () => {
    rows.push({ item_key: "acct_131", period_min: "2023-03-31", period_max: "2026-06-30", source_url: "https://ncua.gov/quarter.zip", fetched_at: new Date("2026-10-19T00:00:00Z") },
      { item_key: "acct_unknown", period_min: "2023-03-31", period_max: "2026-06-30", source_url: null, fetched_at: null });
    const found = await readNcuaCallSeries();
    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ key: "acct_131", code: "ACCT_131", unit: "USD", storedUnit: "dollars", periodBasis: "ytd", periodMin: "2023-03-31", periodMax: "2026-06-30", fetchedAt: "2026-10-19T00:00:00.000Z", caveat: expect.stringContaining("not a consumer fee price") });
    const query = calls.find((c) => !c.text.includes("SET LOCAL"))!;
    expect(query.text).toContain("JOIN LATERAL");
    expect(query.text).toContain("ORDER BY c.report_date ASC LIMIT 1");
    expect(query.text).toContain("ORDER BY c.report_date DESC LIMIT 1");
    expect(query.text).not.toContain("GROUP BY");
    expect(query.text).toContain("c.source = 'ncua'");
    expect(query.text).toContain("c.item_code = k.item_code");
    expect(query.text).toContain("c.unit = k.stored_unit");
    expect(query.text).toContain("c.period_basis = k.period_basis");
    const bound = JSON.parse(query.values[0] as string);
    expect(bound.map((m: { item_key: string }) => m.item_key)).toEqual(NCUA_CALL_MEASURES.map((m) => m.key));
    expect(bound).toHaveLength(6);
    expect(calls[0].text).toContain("statement_timeout = '5s'");
  });

  it("returns no invented definition when no comparable filing exists", async () => {
    expect(await readNcuaCallSeries()).toEqual([]);
  });

  it("deduplicates concurrent reads and cools down after failure without calling it empty data", async () => {
    let reject!: (error: Error) => void;
    cached.mockImplementationOnce(() => new Promise((_, no) => { reject = no; }));
    const first = getNcuaCallSeries();
    const second = getNcuaCallSeries();
    expect(first).toBe(second);
    reject(new Error("database unavailable"));
    await expect(first).rejects.toThrow("database unavailable");
    await expect(second).rejects.toThrow("database unavailable");
    await expect(getNcuaCallSeries()).rejects.toThrow("temporarily unavailable");
    expect(cached).toHaveBeenCalledTimes(1);
  });

  it("uses the same bounded reader without a Next request cache", async () => {
    cached.mockRejectedValueOnce(new Error("Invariant: incrementalCache missing in unstable_cache"));
    expect(await getNcuaCallSeries()).toEqual([]);
    expect(calls.filter((c) => !c.text.includes("SET LOCAL"))).toHaveLength(1);
  });
});
