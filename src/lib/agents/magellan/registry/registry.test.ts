import { describe, expect, it, vi } from "vitest";

import { fdicRefreshHours, runRegistryFdicFinancials } from "./fdic-financials";
import { runRegistryFdicUniverse } from "./fdic-universe";
import type { RegistryDb } from "./partitions";

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

/** Tagged-template db mock: routes by SQL text, records every statement. */
function createDb(handlers: Array<[string, (values: unknown[]) => unknown[]]>) {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn((strings: unknown, ...values: unknown[]) => {
    // sql(array) helper calls pass a plain array, not a template.
    if (!Array.isArray(strings) || !("raw" in (strings as object))) return strings;
    const text = templateText(strings);
    statements.push({ text, values });
    for (const [needle, handler] of handlers) {
      if (text.includes(needle)) return Promise.resolve(handler(values));
    }
    return Promise.resolve([]);
  });
  return { db: db as unknown as RegistryDb, statements };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function payloadOf(values: unknown[]): Array<Record<string, unknown>> {
  const json = values.find((value) => typeof value === "string" && value.startsWith("["));
  return JSON.parse(String(json));
}

describe("registry FDIC financials worker", () => {
  const record = { CERT: 628, ASSET: 4016571000, ISERCHGQ: 1672000, NIMQ: 25316000, NONIIQ: 18541000 };

  it("upserts one quarter and records the partition with lineage", async () => {
    const { db, statements } = createDb([
      ["COUNT(DISTINCT cert_number)", () => [{ matched: 1 }]],
      ["jsonb_to_recordset", () => [{ matched: 1, unmatched: 1 }]],
    ]);
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse({ meta: { total: 2 }, data: [{ data: record }, { data: { CERT: 99999, ASSET: 10 } }] }),
    );

    const result = await runRegistryFdicFinancials({
      runId: 77,
      partitionKey: "2026Q1",
      db,
      fetchOptions: { fetchImpl, backoffMs: 0 },
      now: new Date("2026-10-03T00:00:00Z"),
    });

    expect(result).toMatchObject({
      partitionKey: "2026Q1",
      reportDate: "2026-03-31",
      parsedRows: 2,
      matchedRows: 1,
      unmatchedRows: 1,
      upsertedRows: 2,
      empty: false,
    });
    const upsert = statements.find((s) => s.text.includes("jsonb_to_recordset"));
    expect(upsert?.text).toContain("ON CONFLICT (institution_id, report_date, source)");
    expect(upsert?.text).toContain("WHERE institution_id IS NULL DO UPDATE");
    const rows = payloadOf(upsert!.values);
    expect(rows[0]).toMatchObject({ cert: "628", service_charge_income: 1672000, agent_run_id: 77 });
    expect(String(rows[0].source_url)).toContain("REPDTE%3A20260331");

    const partition = statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"));
    expect(partition?.values).toEqual(expect.arrayContaining(["fdic-financials", "2026Q1", "succeeded", 77]));
  });

  it("records an empty partition for a quarter FDIC has not published", async () => {
    const { db, statements } = createDb([]);
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ meta: { total: 0 }, data: [] }));

    const result = await runRegistryFdicFinancials({
      partitionKey: "2026Q3",
      db,
      fetchOptions: { fetchImpl, backoffMs: 0 },
    });

    expect(result.empty).toBe(true);
    expect(statements.some((s) => s.text.includes("jsonb_to_recordset"))).toBe(false);
    const partition = statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"));
    expect(partition?.values).toEqual(expect.arrayContaining(["empty"]));
  });

  it("writes nothing on a dry run", async () => {
    const { db, statements } = createDb([["COUNT(DISTINCT cert_number)", () => [{ matched: 1 }]]]);
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ meta: { total: 1 }, data: [{ data: record }] }));

    const result = await runRegistryFdicFinancials({
      partitionKey: "2026Q1",
      dryRun: true,
      db,
      fetchOptions: { fetchImpl, backoffMs: 0 },
    });

    expect(result.dryRun).toBe(true);
    expect(statements.every((s) => s.text.includes("SELECT COUNT"))).toBe(true);
  });

  it("refreshes recent quarters weekly and history rarely", () => {
    const now = new Date("2026-10-03T00:00:00Z");
    expect(fdicRefreshHours("2026Q2", now)).toBe(24 * 7);
    expect(fdicRefreshHours("2026Q1", now)).toBe(24 * 7);
    expect(fdicRefreshHours("2015Q4", now)).toBe(24 * 180);
  });

  it("rejects an invalid partition key", async () => {
    const { db } = createDb([]);
    await expect(runRegistryFdicFinancials({ partitionKey: "latest", db })).rejects.toThrow("Invalid FDIC quarter");
  });
});

describe("registry FDIC universe worker", () => {
  const active = (cert: number, name: string) => ({
    CERT: cert,
    NAME: name,
    ACTIVE: 1,
    STALP: "OH",
    ASSET: 500000,
    REGAGNT: "OCC",
    WEBADDR: "www.example.com",
  });

  it("refreshes known banks, adds new ones, and deactivates closed ones", async () => {
    const { db, statements } = createDb([
      [
        "SELECT cert_number, regulatory_status",
        () => [
          { cert_number: "1", regulatory_status: "active" },
          { cert_number: "2", regulatory_status: null },
          { cert_number: "3", regulatory_status: "inactive" },
        ],
      ],
      ["UPDATE institution_sources s SET\n      rssd_id", (values) => payloadOf(values).map((_, i) => ({ id: i }))],
      ["INSERT INTO institution_sources", (values) => payloadOf(values).map((_, i) => ({ id: i }))],
      ["regulatory_status = 'inactive'", (values) => payloadOf(values).map((_, i) => ({ id: i }))],
    ]);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ meta: { total: 2 }, data: [{ data: active(1, "Known Bank") }, { data: active(4, "New Bank") }] }))
      .mockResolvedValueOnce(
        jsonResponse({ meta: { total: 1 }, data: [{ data: { CERT: 2, NAME: "Merged Bank", ACTIVE: 0, ENDEFYMD: "06/01/2026" } }] }),
      );

    const result = await runRegistryFdicUniverse({ runId: 5, db, fetchOptions: { fetchImpl, backoffMs: 0 } });

    expect(result).toMatchObject({
      activeInstitutions: 2,
      existingMatched: 1,
      updatedInstitutions: 1,
      insertedInstitutions: 1,
      deactivatedInstitutions: 1,
      missingFromFdic: 1,
    });
    // Already-inactive cert 3 is not looked up again.
    const lookupUrl = new URL(String(fetchImpl.mock.calls[1][0]));
    expect(lookupUrl.searchParams.get("filters")).toBe("CERT:2");
    const deactivate = statements.find((s) => s.text.includes("regulatory_status = 'inactive'"));
    expect(payloadOf(deactivate!.values)).toEqual([{ cert: "2", closed_date: "2026-06-01" }]);
  });

  it("takes the Fed district from FDIC, then gives credit unions their nearby banks' district", async () => {
    const { db, statements } = createDb([
      ["SELECT cert_number, regulatory_status", () => [{ cert_number: "1", regulatory_status: "active" }]],
      [
        "UPDATE institution_sources s SET\n      rssd_id",
        () => [{ id: 1, district_changed: true }],
      ],
      ["WITH banks AS", () => [{ id: 7 }, { id: 8 }]],
    ]);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ meta: { total: 1 }, data: [{ data: { ...active(1, "Phoenix Bank"), STALP: "AZ", FED: 12 } }] }));

    const result = await runRegistryFdicUniverse({ db, fetchOptions: { fetchImpl, backoffMs: 0 } });

    expect(result).toMatchObject({ banksDistrictChanged: 1, othersDistrictChanged: 2 });
    const update = statements.find((s) => s.text.includes("rssd_id = COALESCE"));
    expect(update!.text).toContain("fed_district = COALESCE(r.fed_district, s.fed_district)");
    expect(payloadOf(update!.values)[0]).toMatchObject({ cert: "1", fed_district: 12 });
    const derive = statements.find((s) => s.text.includes("WITH banks AS"));
    expect(derive!.text).toContain("i.source <> 'fdic'");
    const partition = statements.find((s) => s.text.includes("registry_ingest_partitions"));
    expect(partition).toBeDefined();
  });

  it("refuses to sync when FDIC returns no active institutions", async () => {
    const { db, statements } = createDb([
      ["SELECT cert_number, regulatory_status", () => [{ cert_number: "1", regulatory_status: "active" }]],
    ]);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ meta: { total: 0 }, data: [] }))
      .mockResolvedValueOnce(jsonResponse({ meta: { total: 0 }, data: [] }));

    await expect(runRegistryFdicUniverse({ db, fetchOptions: { fetchImpl, backoffMs: 0 } })).rejects.toThrow(
      "refusing to sync",
    );
    expect(statements.some((s) => s.text.includes("UPDATE institution_sources"))).toBe(false);
  });
});
