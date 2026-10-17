import { describe, expect, it, vi } from "vitest";

import { FHLB_ADVANCE_RATES_SOURCE, fhlbAdvanceRatesPartitions, runRegistryFhlbAdvanceRates } from "./fhlb-advance-rates";
import type { RegistryDb } from "./partitions";

function createDb() {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn((strings: unknown, ...values: unknown[]) => {
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

const respond = (body: string) => vi.fn(async () => new Response(body, { status: 200, headers: { "content-type": "text/html" } })) as unknown as typeof fetch;

describe("fhlb-advance-rates registry step", () => {
  it("has one partition per FHLBank", () => {
    const keys = fhlbAdvanceRatesPartitions(new Date("2026-10-17T00:00:00Z"));
    expect(keys).toHaveLength(11);
    expect(keys[0]).toBe("boston");
  });

  it("writes posted rates and records the partition with its checks", async () => {
    const { db, statements } = createDb();
    const html = `<p>Rates as of October 15, 2026</p><table><tr><th>Term</th><th>Fixed</th></tr><tr><td>1 Month</td><td>4.4</td></tr><tr><td>1 Year</td><td>N/A</td></tr></table>`;
    const r = await runRegistryFhlbAdvanceRates({ partitionKey: "boston", db, fetchOptions: { fetchImpl: respond(html), backoffMs: 0, retries: 0 }, env: {} });
    expect(r).toMatchObject({ source: FHLB_ADVANCE_RATES_SOURCE, rows: 2, writtenRows: 2, empty: false, postedDate: "2026-10-15" });
    const p = partition(statements);
    expect(p.status).toBe("succeeded");
    expect(p.detail).toMatchObject({ verdict: "rates", posted_date: "2026-10-15", blank_cells: 1, blank_by_series: { fhlb_boston_fixed_1y: 1 } });
  });

  it("records a members-only bank as skipped, never failed", async () => {
    const { db, statements } = createDb();
    const html = `<form><input type="password"></form><p>Member login</p>`;
    const r = await runRegistryFhlbAdvanceRates({ partitionKey: "chicago", db, fetchOptions: { fetchImpl: respond(html), backoffMs: 0, retries: 0 }, env: {} });
    expect(r).toMatchObject({ empty: true, skipped: true });
    const p = partition(statements);
    expect(p.status).toBe("empty");
    expect(p.detail.reason).toMatch(/member login/);
    expect(statements.some((s) => s.text.includes("INSERT INTO area_statistics"))).toBe(false);
  });

  it("writes nothing on a dry run", async () => {
    const { db, statements } = createDb();
    const html = `<p>Effective 10/16/2026</p><table><tr><th>Term</th><th>Fixed</th></tr><tr><td>3 Months</td><td>4.2</td></tr></table>`;
    const r = await runRegistryFhlbAdvanceRates({ partitionKey: "topeka", db, dryRun: true, fetchOptions: { fetchImpl: respond(html), backoffMs: 0, retries: 0 }, env: {} });
    expect(r).toMatchObject({ rows: 1, writtenRows: 0, dryRun: true });
    expect(statements).toHaveLength(0);
  });

  it("refuses an unknown bank", async () => {
    await expect(runRegistryFhlbAdvanceRates({ partitionKey: "gotham", db: createDb().db })).rejects.toThrow(/Unknown FHLBank/);
  });
});
