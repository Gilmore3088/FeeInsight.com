import { describe, expect, it, vi } from "vitest";

import type { RegistryDb } from "./partitions";
import { runRegistrySecMarketValue, secMarketValuePartitions } from "./sec-market-value";

const FACTS = {
  entityName: "EXAMPLE BANCORP",
  facts: {
    dei: {
      EntityPublicFloat: { label: "Entity Public Float", units: { USD: [{ end: "2025-06-30", val: 70_100_000_000, form: "10-K", filed: "2026-02-20" }] } },
      EntityCommonStockSharesOutstanding: { label: "Entity Common Stock, Shares Outstanding", units: { shares: [{ end: "2026-07-31", val: 1_541_000_000, form: "10-Q", filed: "2026-08-04" }] } },
    },
  },
};

function createDb(links: Array<{ external_key: string; institution_id: number }>) {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn((strings: unknown, ...values: unknown[]) => {
    const text = (strings as string[]).join(" ");
    statements.push({ text, values });
    if (text.includes("FROM institution_identity_links")) return Promise.resolve(links);
    if (text.includes("INSERT INTO sec_market_value_facts")) {
      const payload = JSON.parse(values.find((v) => typeof v === "string" && v.startsWith("[")) as string);
      return Promise.resolve(payload.map(() => ({})));
    }
    return Promise.resolve([]);
  });
  return { db: db as unknown as RegistryDb, statements };
}

describe("sec-market-value registry step", () => {
  it("uses the eight SEC CIK batches", () => {
    expect(secMarketValuePartitions(new Date())).toEqual(["batch-0", "batch-1", "batch-2", "batch-3", "batch-4", "batch-5", "batch-6", "batch-7"]);
  });

  it("reads only this batch's linked CIKs and writes their facts", async () => {
    // 16 % 8 = 0 (batch-0); 17 % 8 = 1 (another batch).
    const { db, statements } = createDb([
      { external_key: "16", institution_id: 7 },
      { external_key: "17", institution_id: 8 },
    ]);
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify(FACTS), { status: 200 })) as unknown as typeof fetch;
    const r = await runRegistrySecMarketValue({ partitionKey: "batch-0", db, pauseMs: 0, fetchOptions: { fetchImpl, backoffMs: 0, retries: 0 } });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(String((fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0])).toBe("https://data.sec.gov/api/xbrl/companyfacts/CIK0000000016.json");
    expect(r).toMatchObject({ ciks: 1, rows: 2, writtenRows: 2, empty: false });
    const insert = statements.find((s) => s.text.includes("INSERT INTO sec_market_value_facts"))!;
    const rows = JSON.parse(insert.values.find((v) => typeof v === "string" && v.startsWith("[")) as string);
    expect(rows[0]).toMatchObject({ cik: "16", institution_id: 7, concept: "dei:EntityPublicFloat", unit: "USD", period_end: "2025-06-30", value: 70_100_000_000 });
  });

  it("records an empty batch with its reason", async () => {
    const { db, statements } = createDb([]);
    const r = await runRegistrySecMarketValue({ partitionKey: "batch-3", db, pauseMs: 0 });
    expect(r).toMatchObject({ empty: true, emptyReason: "no accepted SEC CIK links in this batch (run sec-links first)" });
    expect(statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"))!.values[2]).toBe("empty");
  });

  it("counts a failed request without failing the step", async () => {
    const { db } = createDb([{ external_key: "16", institution_id: 7 }]);
    const fetchImpl = vi.fn(async () => new Response("down", { status: 500 })) as unknown as typeof fetch;
    const r = await runRegistrySecMarketValue({ partitionKey: "batch-0", db, pauseMs: 0, fetchOptions: { fetchImpl, backoffMs: 0, retries: 0 } });
    expect(r).toMatchObject({ fetchErrors: 1, empty: true, emptyReason: "every company-facts request failed" });
  });

  it("refuses a bad partition", async () => {
    await expect(runRegistrySecMarketValue({ partitionKey: "batch-9", db: createDb([]).db })).rejects.toThrow(/Invalid sec-market-value partition/);
  });
});
