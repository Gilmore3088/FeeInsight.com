import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn }));
vi.mock("@/lib/data-store/connection", () => ({ withTransaction: vi.fn() }));

import { withTransaction } from "@/lib/data-store/connection";
import { getAreaSeries, mergeGroupRows, readAreaSeries, resetAreaSeriesCooldown, seriesFromPartitionDetail } from "./series";

const partition = { source_url: "https://www.bls.gov/lau/", fetched_at: "2026-10-12T00:00:00Z" };

describe("area series discovery", () => {
  it("reads full descriptions from a partition's detail and ignores key-only detail", () => {
    expect(seriesFromPartitionDetail("bls-laus", ["laus_unemployment_rate"], partition)).toBeNull();
    expect(seriesFromPartitionDetail("bls-laus", 3, partition)).toBeNull();
    expect(seriesFromPartitionDetail("bls-laus", [{ key: "laus_unemployment_rate", unit: "percent", geo_types: ["nation", "state"], period_min: "2020-01", period_max: "2026-09" }], partition)).toEqual([
      {
        source: "bls-laus",
        series_key: "laus_unemployment_rate",
        measure: "area:bls-laus:laus_unemployment_rate",
        unit: "percent",
        geo_types: ["national", "state"],
        period_min: "2020-01",
        period_max: "2026-09",
        source_url: "https://www.bls.gov/lau/",
        fetched_at: "2026-10-12T00:00:00.000Z",
      },
    ]);
  });

  it("merges GROUP BY rows into one series per key, mapping nation to national", () => {
    const rows = [
      { source: "bls-laus", series_key: "u", geo_type: "nation", unit: "percent", period_min: "2021-01", period_max: "2026-09", source_url: null, fetched_at: "2026-10-01T00:00:00Z" },
      { source: "bls-laus", series_key: "u", geo_type: "county", unit: "percent", period_min: "2020-01", period_max: "2026-08", source_url: null, fetched_at: "2026-10-02T00:00:00Z" },
    ];
    const [series] = mergeGroupRows(rows, new Map([["bls-laus", { source: "bls-laus", series: null, ...partition }]]));
    expect(series).toMatchObject({ geo_types: ["national", "county"], unit: "percent", period_min: "2020-01", period_max: "2026-09", source_url: partition.source_url });
    const mixed = mergeGroupRows([...rows.slice(0, 1), { ...rows[1], unit: "count" }], new Map());
    expect(mixed[0].unit).toBe("mixed");
  });

  it("sets a statement timeout and skips the GROUP BY for sources described by their partition", async () => {
    const seen: string[] = [];
    const db = vi.fn((strings: TemplateStringsArray) => {
      const text = strings.join("?");
      seen.push(text);
      return Promise.resolve([]);
    });
    await readAreaSeries(db as never);
    expect(seen[0]).toContain("statement_timeout");
    expect(seen.some((t) => t.includes("registry_ingest_partitions"))).toBe(true);
    expect(seen.some((t) => t.includes("GROUP BY"))).toBe(true);
  });

  it("runs a root handle inside its own transaction, so the statement timeout holds", async () => {
    const tx = vi.fn(() => Promise.resolve([]));
    const begin = vi.fn((cb: (t: typeof tx) => Promise<unknown>) => cb(tx));
    const root = Object.assign(vi.fn(() => Promise.resolve([])), { begin });
    await readAreaSeries(root as never);
    expect(begin).toHaveBeenCalledTimes(1);
    expect(root).not.toHaveBeenCalled();
    expect(tx).toHaveBeenCalled();
  });

  it("does not read the table again for a while after a failed or empty read", async () => {
    const read = vi.mocked(withTransaction);
    read.mockReset();
    read.mockResolvedValueOnce([] as never);
    resetAreaSeriesCooldown();
    expect(await getAreaSeries()).toEqual([]);
    expect(await getAreaSeries()).toEqual([]);
    expect(read).toHaveBeenCalledTimes(1);

    read.mockRejectedValueOnce(new Error("canceling statement due to statement timeout"));
    resetAreaSeriesCooldown();
    await expect(getAreaSeries()).rejects.toThrow("statement timeout");
    expect(await getAreaSeries()).toEqual([]);
    expect(read).toHaveBeenCalledTimes(2);
    resetAreaSeriesCooldown();
  });

  it("is never read per question: queryData does not import it", () => {
    const text = readFileSync(join(process.cwd(), "src/lib/data-catalog/query-data.ts"), "utf8");
    expect(text).not.toMatch(/from "\.\/series"/);
  });
});
