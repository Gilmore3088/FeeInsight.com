import { describe, expect, it, vi } from "vitest";

import type { RegistryDb } from "./partitions";
import {
  FED_PAYMENTS_SOURCE,
  FED_SBCS_SOURCE,
  fedSbcsPartitions,
  KCFED_SB_LENDING_SOURCE,
  NACHA_VOLUME_SOURCE,
  runRegistrySmallbizPayments,
  SMALLBIZ_PAYMENTS_DEFINITIONS,
  SMALLBIZ_PAYMENTS_PARSER_VERSION,
  smallbizPaymentsPartitions,
} from "./smallbiz-payments";

function createDb() {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn((strings: unknown, ...values: unknown[]) => {
    if (!Array.isArray(strings) || !("raw" in (strings as object))) return strings;
    const text = (strings as string[]).join(" ");
    statements.push({ text, values });
    if (text.includes("INSERT INTO area_statistics")) {
      const payload = JSON.parse(values.find((v) => typeof v === "string" && v.startsWith("[")) as string);
      return Promise.resolve(payload.map(() => ({})));
    }
    return Promise.resolve([]);
  });
  return { db: db as unknown as RegistryDb, statements };
}

const partition = (statements: Array<{ text: string; values: unknown[] }>) => {
  const insert = statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"))!;
  return { status: insert.values[2], detail: JSON.parse(insert.values.find((v) => typeof v === "string" && v.startsWith("{")) as string) };
};

const NOW = new Date("2026-10-17T00:00:00Z");
const fo = (route: (url: string) => Response) => ({ fetchImpl: vi.fn(async (url: string) => route(url)) as unknown as typeof fetch, backoffMs: 0 });
const notFound = () => new Response("", { status: 404 });

describe("small business and payments partitions", () => {
  it("gives every source a newest-first list", () => {
    expect(smallbizPaymentsPartitions(KCFED_SB_LENDING_SOURCE, NOW)).toEqual(["current"]);
    expect(fedSbcsPartitions(NOW).slice(0, 2)).toEqual(["2026", "2025"]);
    expect(fedSbcsPartitions(NOW).at(-1)).toBe("2017");
    expect(smallbizPaymentsPartitions(FED_PAYMENTS_SOURCE, NOW)).toEqual(["fedach", "fednow", "fed-check", "frps"]);
    expect(smallbizPaymentsPartitions(NACHA_VOLUME_SOURCE, NOW)).toEqual(["ach-network", "same-day-ach"]);
    for (const d of SMALLBIZ_PAYMENTS_DEFINITIONS) expect(d.partitions(NOW).length).toBeGreaterThan(0);
  });
});

describe("runs", () => {
  it("loads a FedNow page into area_statistics and records checks in the partition", async () => {
    const html = `<h3>FedNow Service</h3><table>
      <tr><th>Quarter</th><th>Volume</th><th>Value ($)</th><th>Participants</th></tr>
      <tr><td>Q1 2026</td><td>1,503,210</td><td>$98,410,000,000</td><td>1,402</td></tr>
      <tr><td>Q2 2026</td><td>1,789,055</td><td>$121,003,000,000</td><td></td></tr></table>`;
    const { db, statements } = createDb();
    const r = await runRegistrySmallbizPayments({
      source: FED_PAYMENTS_SOURCE,
      partitionKey: "fednow",
      db,
      runId: 7,
      env: {},
      now: NOW,
      fetchOptions: fo((url) => (url.endsWith("/robots.txt") ? notFound() : new Response(html))),
    });
    expect(r).toMatchObject({ empty: false, rows: 5, writtenRows: 5, missingFields: [] });
    const p = partition(statements);
    expect(p.status).toBe("succeeded");
    expect(p.detail).toMatchObject({ parser_version: SMALLBIZ_PAYMENTS_PARSER_VERSION, first_period: "2026Q1", last_period: "2026Q2", duplicate_keys: 0 });
    expect(p.detail.skipped_records).toMatchObject({ blank_cells: 1 });
    const upsert = statements.find((s) => s.text.includes("INSERT INTO area_statistics"))!;
    expect(upsert.values[0]).toBe(FED_PAYMENTS_SOURCE);
    const payload = JSON.parse(upsert.values.find((v) => typeof v === "string" && v.startsWith("[")) as string);
    expect(payload.find((x: { series_key: string; period: string }) => x.series_key === "fednow_volume" && x.period === "2026Q2")).toMatchObject({
      geo_type: "nation",
      geo_code: "US",
      value: 1789055,
      unit: "count",
    });
  });

  it("records an SBCS year with no data file empty, never failing", async () => {
    const { db, statements } = createDb();
    const r = await runRegistrySmallbizPayments({
      source: FED_SBCS_SOURCE,
      partitionKey: "2026",
      db,
      env: {},
      now: NOW,
      fetchOptions: fo(() => notFound()),
    });
    expect(r).toMatchObject({ empty: true, rows: 0 });
    expect(r.emptyReason).toMatch(/No 2026 report page found/);
    expect(partition(statements)).toMatchObject({ status: "empty", detail: { parser_version: 1 } });
  });

  it("reads a configured KC Fed CSV and writes nothing on a dry run", async () => {
    const csv = "Quarter,Loan volume index,Credit standards index\n2026Q1,94.2,101\n2026Q2,96.0,\n";
    const { db, statements } = createDb();
    const r = await runRegistrySmallbizPayments({
      source: KCFED_SB_LENDING_SOURCE,
      partitionKey: "current",
      db,
      dryRun: true,
      env: { KCFED_SBLS_DATA_URL: "https://files.test/sbls.csv" },
      now: NOW,
      fetchOptions: fo((url) => (url === "https://files.test/sbls.csv" ? new Response(csv) : notFound())),
    });
    expect(r).toMatchObject({ dryRun: true, rows: 3, writtenRows: 0 });
    expect(r.missingFields).toEqual(expect.arrayContaining(["loan_demand", "interest_rate"]));
    expect(statements).toHaveLength(0);
  });

  it("refuses partitions a source does not have", async () => {
    const { db } = createDb();
    await expect(runRegistrySmallbizPayments({ source: NACHA_VOLUME_SOURCE, partitionKey: "2025", db, env: {} })).rejects.toThrow(/Invalid nacha-volume partition/);
    await expect(runRegistrySmallbizPayments({ source: FED_SBCS_SOURCE, partitionKey: "2010", db, env: {} })).rejects.toThrow(/Invalid fed-sbcs partition/);
  });
});
