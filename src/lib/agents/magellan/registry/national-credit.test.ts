import { describe, expect, it, vi } from "vitest";

import {
  monthPartition,
  NATIONAL_CREDIT_DEFINITIONS,
  NATIONAL_CREDIT_PARSER_VERSION,
  NATIONAL_CREDIT_SOURCES,
  nationalCreditPartitions,
  runRegistryNationalCredit,
  SIGNED_SERIES,
} from "./national-credit";
import type { RegistryDb } from "./partitions";

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
  const insert = statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"));
  if (!insert) return null;
  return { status: insert.values[2], detail: JSON.parse(insert.values.find((v) => typeof v === "string" && v.startsWith("{")) as string) };
};

const NOW = new Date("2026-10-17T00:00:00Z");

describe("national credit partitions", () => {
  it("gives national-series the current month and the file sources one standing partition", () => {
    expect(monthPartition(NOW)).toBe("2026-10");
    expect(nationalCreditPartitions(NATIONAL_CREDIT_SOURCES.nationalSeries, NOW)).toEqual(["2026-10"]);
    expect(nationalCreditPartitions(NATIONAL_CREDIT_SOURCES.householdDebt, NOW)).toEqual(["current"]);
    expect(nationalCreditPartitions("nope", NOW)).toEqual([]);
    expect(NATIONAL_CREDIT_DEFINITIONS.map((d) => d.source)).toEqual(["national-series", "nyfed-household-debt", "nyfed-sce-credit", "cfpb-credit-trends"]);
    expect(SIGNED_SERIES.has("natl_sloos_ci_large_mid_tightening")).toBe(true);
  });
});

describe("runRegistryNationalCredit", () => {
  it("loads the FRED series it gets, names the ones it does not, and records the partition", async () => {
    const { db, statements } = createDb();
    const fetchImpl = vi.fn(async (url: string) => {
      const id = new URL(String(url)).searchParams.get("id");
      if (id === "MORTGAGE30US") return new Response("observation_date,MORTGAGE30US\n2026-10-01,6.1\n2026-10-08,6.05\n");
      if (id === "DRTSCILM") return new Response("observation_date,DRTSCILM\n2026-07-01,-3.1\n");
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;
    const r = await runRegistryNationalCredit({ source: "national-series", partitionKey: "2026-10", db, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r).toMatchObject({ empty: false, rows: 3, writtenRows: 3 });
    expect(r.missingFields).toContain("DPSACBW027SBOG (HTTP 404)");
    expect(r.checks?.flagged).toEqual([]);
    const p = partition(statements)!;
    expect(p.status).toBe("succeeded");
    expect(p.detail.per_series.MORTGAGE30US).toEqual({ rows: 2, latest: "2026-10-08", problem: null });
    expect(p.detail.parser_version).toBe(NATIONAL_CREDIT_PARSER_VERSION);
  });

  it("records the partition empty, never failing, when nothing comes back", async () => {
    const { db, statements } = createDb();
    const fetchImpl = vi.fn(async () => new Response("", { status: 404 })) as unknown as typeof fetch;
    const r = await runRegistryNationalCredit({ source: "nyfed-household-debt", partitionKey: "current", db, env: {}, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r.empty).toBe(true);
    expect(r.emptyReason).toMatch(/NYFED_HHDC_STATE_XLSX_URL/);
    expect(partition(statements)!.status).toBe("empty");
    expect(statements.some((s) => s.text.includes("INSERT INTO area_statistics"))).toBe(false);
  });

  it("writes nothing on a dry run", async () => {
    const { db, statements } = createDb();
    const fetchImpl = vi.fn(async (url: string) =>
      String(url).includes("credit_cards/num_data_CRC") ? new Response("month,date,num\n0,2026-08,100\n") : new Response("", { status: 404 }),
    ) as unknown as typeof fetch;
    const r = await runRegistryNationalCredit({ source: "cfpb-credit-trends", partitionKey: "current", db, dryRun: true, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r).toMatchObject({ dryRun: true, rows: 1, writtenRows: 0 });
    expect(statements).toEqual([]);
  });

  it("rejects an unknown source", async () => {
    const { db } = createDb();
    await expect(runRegistryNationalCredit({ source: "nope", partitionKey: "current", db })).rejects.toThrow(/Unknown/);
  });
});
