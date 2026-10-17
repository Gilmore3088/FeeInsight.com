import { describe, expect, it, vi } from "vitest";

import type { RegistryDb } from "./partitions";
import {
  FED_PAYMENTS_SOURCE,
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
    expect(smallbizPaymentsPartitions(FED_PAYMENTS_SOURCE, NOW)).toEqual(["fedach", "frps"]);
    expect(SMALLBIZ_PAYMENTS_DEFINITIONS.map((d) => d.source)).toEqual(["fed-payments"]);
    for (const d of SMALLBIZ_PAYMENTS_DEFINITIONS) expect(d.partitions(NOW).length).toBeGreaterThan(0);
  });
});

describe("runs", () => {
  it("loads the Board's FedACH commercial page into area_statistics and records checks in the partition", async () => {
    const html = `<h3>FedACH Services: Quarterly Commercial Volume</h3><table>
      <tr><th>Quarter</th><th>Volume (millions of items)</th><th>Value (billions of dollars)</th><th>Average daily volume</th></tr>
      <tr><td>2026:Q1</td><td>4,503.2</td><td>12,410.5</td><td>72.6</td></tr>
      <tr><td>2026:Q2</td><td>4,789.1</td><td>12,903.0</td><td></td></tr></table>`;
    const { db, statements } = createDb();
    const r = await runRegistrySmallbizPayments({
      source: FED_PAYMENTS_SOURCE,
      partitionKey: "fedach",
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
    const volume = payload.find((x: { series_key: string; period: string }) => x.series_key.startsWith("fedach_volume") && x.period === "2026Q2");
    expect(volume).toMatchObject({ geo_type: "nation", geo_code: "US", value: 4789.1 });
    expect(volume.unit).toMatch(/million/);
  });

  it("records a page with no table empty, never failing", async () => {
    const { db, statements } = createDb();
    const r = await runRegistrySmallbizPayments({
      source: FED_PAYMENTS_SOURCE,
      partitionKey: "frps",
      db,
      env: {},
      now: NOW,
      fetchOptions: fo((url) => (url.endsWith("/robots.txt") ? notFound() : new Response("<p>No tables yet.</p>"))),
    });
    expect(r).toMatchObject({ empty: true, rows: 0 });
    expect(partition(statements)).toMatchObject({ status: "empty", detail: { parser_version: SMALLBIZ_PAYMENTS_PARSER_VERSION } });
  });

  it("reads a configured FedACH CSV and writes nothing on a dry run", async () => {
    const csv = "Quarter,Volume (millions of items),Value (billions of dollars)\n2026:Q1,4503.2,12410.5\n2026:Q2,4789.1,\n";
    const { db, statements } = createDb();
    const r = await runRegistrySmallbizPayments({
      source: FED_PAYMENTS_SOURCE,
      partitionKey: "fedach",
      db,
      dryRun: true,
      env: { FEDACH_VOLUME_URL: "https://files.test/fedach.csv" },
      now: NOW,
      fetchOptions: fo((url) => (url === "https://files.test/fedach.csv" ? new Response(csv) : notFound())),
    });
    expect(r).toMatchObject({ dryRun: true, rows: 3, writtenRows: 0 });
    expect(statements).toHaveLength(0);
  });

  it("refuses partitions a source does not have", async () => {
    const { db } = createDb();
    await expect(runRegistrySmallbizPayments({ source: FED_PAYMENTS_SOURCE, partitionKey: "fednow", db, env: {} })).rejects.toThrow(/Invalid fed-payments partition/);
    await expect(runRegistrySmallbizPayments({ source: "nacha-volume", partitionKey: "ach-network", db, env: {} })).rejects.toThrow(/Unknown/);
    await expect(runRegistrySmallbizPayments({ source: "fed-sbcs", partitionKey: "2025", db, env: {} })).rejects.toThrow(/Unknown/);
  });
});
