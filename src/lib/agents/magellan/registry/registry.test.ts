import { describe, expect, it, vi } from "vitest";

import {
  assignFdicRows,
  fdicRefreshHours,
  markFdicQuarterForPorCerts,
  porCertConflicts,
  porCertSplits,
  runRegistryFdicFinancials,
} from "./fdic-financials";
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
      ["FROM institution_sources", () => [{ institution_id: 1, cert_number: "628" }]],
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
    const { db, statements } = createDb([["FROM institution_sources", () => [{ institution_id: 1, cert_number: "628" }]]]);
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse({ meta: { total: 1 }, data: [{ data: record }] }));

    const result = await runRegistryFdicFinancials({
      partitionKey: "2026Q1",
      dryRun: true,
      db,
      fetchOptions: { fetchImpl, backoffMs: 0 },
    });

    expect(result).toMatchObject({ dryRun: true, matchedRows: 1 });
    expect(statements.every((s) => /^\s*SELECT/.test(s.text))).toBe(true);
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

describe("registry FDIC financials: a quarter goes to the certificate that filed it (#2625)", () => {
  // Emigrant Bank (institution 254): today's certificate 57083 was Plus International Bank's until
  // the 2023-10-01 merger; the bank's own history was filed under the old Emigrant certificate
  // 12054, which no institution holds today. BankFind 2023-09-30 assets ($K): 57083 47,834;
  // 12054 6,412,660. Kendall Bank (institution 2923): today's 8110, predecessor 16471 until
  // 2025-01-31; 2024-12-31 assets 49,970 under 8110 and 159,171 under 16471.
  const page = (rows: Array<Record<string, unknown>>) =>
    vi.fn().mockResolvedValue(jsonResponse({ meta: { total: rows.length }, data: rows.map((data) => ({ data })) }));
  const emigrant = [{ CERT: 57083, ASSET: 47834 }, { CERT: 12054, ASSET: 6412660 }];
  const sources = (rows: Array<[number, string]>) => () => rows.map(([institution_id, cert_number]) => ({ institution_id, cert_number }));
  const rowFor = (rows: Array<Record<string, unknown>>, cert: string) => rows.find((r) => r.cert === cert)!;

  it("attaches the predecessor certificate's quarter to the bank and keeps the small charter's own quarter unmatched", async () => {
    const { db, statements } = createDb([
      ["FROM institution_call_report_items", () => [{ institution_id: 254, filing_cert: "12054", current_cert: "57083" }]],
      ["FROM institution_sources", sources([[254, "57083"]])],
      ["jsonb_to_recordset", () => [{ matched: 1, unmatched: 1 }]],
    ]);
    const result = await runRegistryFdicFinancials({ partitionKey: "2023Q3", db, fetchOptions: { fetchImpl: page(emigrant), backoffMs: 0 } });

    expect(result).toMatchObject({ reportDate: "2023-09-30", matchedRows: 1, unmatchedRows: 1, porAttachedRows: 1, porDetachedRows: 1, porCertSplits: 1 });
    const porRead = statements.find((s) => s.text.includes("FROM institution_call_report_items"))!;
    expect(porRead.values).toEqual(["filing_fdic_cert", "2023-09-30"]);
    const upsert = statements.find((s) => s.text.includes("jsonb_to_recordset"))!;
    const rows = payloadOf(upsert.values);
    expect(rowFor(rows, "12054")).toMatchObject({
      institution_id: 254,
      attached_via: "ffiec_por_cert",
      total_assets: 6412660,
      remove_stale_for: null,
      raw_json: { CERT: 12054, attached_via: "ffiec_por_cert", filing_cert: "12054", current_cert: "57083" },
    });
    // The small charter's own filing: not the bank's, and nothing to delete since the bank's row is
    // replaced by the predecessor's in the same load.
    expect(rowFor(rows, "57083")).toMatchObject({
      institution_id: null,
      attached_via: null,
      total_assets: 47834,
      remove_stale_for: null,
      raw_json: { detached_via: "ffiec_por_cert", cert_matches_institution: 254, institution_filing_cert: "12054" },
    });
    expect(upsert.text).toContain("ON CONFLICT (institution_id, report_date, source) DO UPDATE");
    expect(upsert.text).toMatch(/claimed AS \(\s*-- The unmatched copy/);
    const partition = statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"))!;
    const detail = JSON.parse(partition.values.find((v) => typeof v === "string" && v.startsWith("{")) as string);
    expect(detail).toMatchObject({ parser_version: 2, por: { banks: 1, cert_splits: 1, attached: 1, detached: 1, conflicts: 0 } });
  });

  it("removes the bank's stale row under today's certificate when the predecessor's quarter is not in the load", async () => {
    const { db, statements } = createDb([
      ["FROM institution_call_report_items", () => [{ institution_id: 2923, filing_cert: "16471", current_cert: "8110" }]],
      ["FROM institution_sources", sources([[2923, "8110"]])],
    ]);
    await runRegistryFdicFinancials({ partitionKey: "2024Q4", db, fetchOptions: { fetchImpl: page([{ CERT: 8110, ASSET: 49970 }]), backoffMs: 0 } });
    const rows = payloadOf(statements.find((s) => s.text.includes("jsonb_to_recordset"))!.values);
    expect(rows).toEqual([expect.objectContaining({ cert: "8110", institution_id: null, remove_stale_for: 2923, total_assets: 49970 })]);
  });

  it("gives Kendall's 2024-12-31 quarter to the bank from the certificate that filed it", async () => {
    const { db, statements } = createDb([
      ["FROM institution_call_report_items", () => [{ institution_id: 2923, filing_cert: "16471", current_cert: "8110" }]],
      ["FROM institution_sources", sources([[2923, "8110"]])],
    ]);
    const result = await runRegistryFdicFinancials({
      partitionKey: "2024Q4",
      db,
      fetchOptions: { fetchImpl: page([{ CERT: 8110, ASSET: 49970 }, { CERT: 16471, ASSET: 159171 }]), backoffMs: 0 },
    });
    expect(result).toMatchObject({ porAttachedRows: 1, porDetachedRows: 1 });
    const rows = payloadOf(statements.find((s) => s.text.includes("jsonb_to_recordset"))!.values);
    expect(rowFor(rows, "16471")).toMatchObject({ institution_id: 2923, total_assets: 159171 });
    expect(rowFor(rows, "8110")).toMatchObject({ institution_id: null, remove_stale_for: null });
  });

  it("attaches by today's certificate, unmarked, when no POR certificate is stored for the quarter", async () => {
    const { db, statements } = createDb([["FROM institution_sources", sources([[254, "57083"]])]]);
    const result = await runRegistryFdicFinancials({ partitionKey: "2023Q3", db, fetchOptions: { fetchImpl: page(emigrant), backoffMs: 0 } });
    expect(result).toMatchObject({ matchedRows: 1, unmatchedRows: 1, porAttachedRows: 0, porDetachedRows: 0, porCertSplits: 0 });
    const rows = payloadOf(statements.find((s) => s.text.includes("jsonb_to_recordset"))!.values);
    expect(rowFor(rows, "57083")).toMatchObject({ institution_id: 254, attached_via: "cert", remove_stale_for: null, raw_json: { CERT: 57083, ASSET: 47834 } });
    expect(rowFor(rows, "12054")).toMatchObject({ institution_id: null, attached_via: null, raw_json: { CERT: 12054, ASSET: 6412660 } });
  });

  it("ignores a POR certificate another institution holds today, or two institutions share", () => {
    const byCert = new Map([["57083", 254], ["12054", 900]]);
    // POR names 12054 for 254, but institution 900 holds 12054 today: our link disagrees with POR.
    const held = assignFdicRows(["57083", "12054"], byCert, [{ institution_id: 254, filing_cert: "12054", current_cert: "57083" }]);
    expect(held.get("57083")).toMatchObject({ institutionId: 254, via: "cert", detachedFrom: null });
    expect(held.get("12054")).toMatchObject({ institutionId: 900, via: "cert" });
    expect(porCertConflicts(byCert, [{ institution_id: 254, filing_cert: "12054", current_cert: "57083" }])).toEqual(new Set([254]));
    const shared = assignFdicRows(["16471"], new Map([["8110", 2923], ["9000", 31]]), [
      { institution_id: 2923, filing_cert: "16471", current_cert: "8110" },
      { institution_id: 31, filing_cert: "16471", current_cert: "9000" },
    ]);
    expect(shared.get("16471")).toMatchObject({ institutionId: null, via: null });
    // A POR row matching today's certificate changes nothing; leading zeros are read as filed.
    const same = assignFdicRows(["057083"], new Map([["57083", 254]]), [{ institution_id: 254, filing_cert: "57083", current_cert: "57083" }]);
    expect(same.get("057083")).toMatchObject({ institutionId: 254, via: "cert" });
  });

  it("makes the FDIC quarter due when the FFIEC POR shows a bank filing under a certificate that is not today's", async () => {
    const split = createDb([
      ["FROM institution_call_report_items", () => [
        { institution_id: 254, filing_cert: "12054", current_cert: "57083" },
        { institution_id: 5, filing_cert: "6548", current_cert: "6548" },
      ]],
      ["UPDATE registry_ingest_partitions", () => [{}]],
    ]);
    expect(await markFdicQuarterForPorCerts(split.db, "2023Q3", "2023-09-30")).toEqual({ splits: 1, marked: true });
    const update = split.statements.find((s) => s.text.includes("UPDATE registry_ingest_partitions"))!;
    expect(update.values).toEqual(["fdic-financials", "2023Q3", 1]);
    expect(update.text).toContain("detail->'por'->>'cert_splits'");

    const none = createDb([["FROM institution_call_report_items", () => [{ institution_id: 5, filing_cert: "6548", current_cert: "6548" }]]]);
    expect(await markFdicQuarterForPorCerts(none.db, "2023Q3", "2023-09-30")).toEqual({ splits: 0, marked: false });
    expect(none.statements.some((s) => s.text.includes("UPDATE"))).toBe(false);
    expect(porCertSplits([{ institution_id: 254, filing_cert: "12054", current_cert: "57083" }])).toBe(1);
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
