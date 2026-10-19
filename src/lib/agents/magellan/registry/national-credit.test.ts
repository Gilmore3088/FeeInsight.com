import { describe, expect, it, vi } from "vitest";

import { STRUCK_NATIONAL_SERIES_IDS } from "@/lib/data-store/struck-sources";
import { CHGDEL_DELINQUENCY_SA_HTML, SLOOS_CHART_DATA_HTML } from "@/lib/regulatory/fed-board-fixtures";
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
  it("loads the Board series it gets, names the ones it does not, and records each row's file", async () => {
    const { db, statements } = createDb();
    const fetchImpl = vi.fn(async (url: string) => {
      if (String(url).endsWith("delallsa.htm")) return new Response(CHGDEL_DELINQUENCY_SA_HTML);
      if (String(url).includes("-chart-data.htm")) return new Response(SLOOS_CHART_DATA_HTML);
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;
    const r = await runRegistryNationalCredit({ source: "national-series", partitionKey: "2026-10", db, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r.empty).toBe(false);
    expect(r.missingFields).toContain("DPSACBW027SBOG (HTTP 404)");
    expect(r.checks?.flagged).toEqual([]);
    const p = partition(statements)!;
    expect(p.status).toBe("succeeded");
    expect(p.detail.per_series.DRCCLACBS).toEqual({ rows: 3, latest: "2026Q2", problem: null });
    expect(p.detail.parser_version).toBe(NATIONAL_CREDIT_PARSER_VERSION);
    const urls = statements.filter((s) => s.text.includes("INSERT INTO area_statistics")).map((s) => s.values.find((v) => typeof v === "string" && v.startsWith("https://")));
    expect(urls).toEqual(expect.arrayContaining(["https://www.federalreserve.gov/releases/chargeoff/delallsa.htm", expect.stringMatching(/sloos-\d{6}-chart-data\.htm$/)]));
  });

  it("never asks FRED, nor for a struck series (Freddie Mac PMMS, Philadelphia Fed cards; 2026-10-18)", async () => {
    const { db } = createDb();
    const asked: string[] = [];
    const fetchImpl = vi.fn(async (url: string) => {
      asked.push(String(url));
      return new Response("", { status: 404 });
    }) as unknown as typeof fetch;
    await runRegistryNationalCredit({ source: "national-series", partitionKey: "2026-10", db, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.filter((u) => /stlouisfed|fredgraph/.test(u))).toEqual([]);
    expect(asked.filter((u) => STRUCK_NATIONAL_SERIES_IDS.some((id) => u.includes(id)))).toEqual([]);
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
