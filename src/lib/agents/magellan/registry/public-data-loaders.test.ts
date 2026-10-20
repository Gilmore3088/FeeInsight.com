import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import { fdicHistoryPartitions, runRegistryFdicHistory } from "./fdic-history";
import { ffiecCallDetailPartitions, runRegistryFfiecCallDetail } from "./ffiec-call-detail";
import { ffiecOverdraftPartitions } from "./ffiec-overdraft";
import { ncuaExtrasPartitions, runRegistryNcuaExtras } from "./ncua-extras";
import type { RegistryDb } from "./partitions";

function createDb() {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn((strings: unknown, ...values: unknown[]) => {
    if (!Array.isArray(strings) || !("raw" in (strings as object))) return strings;
    const text = (strings as string[]).join(" ");
    statements.push({ text, values });
    if (text.includes("COUNT(DISTINCT rssd_id)")) return Promise.resolve([{ matched: 1 }]);
    if (text.includes("INSERT INTO institution_call_report_items")) return Promise.resolve([{}, {}]);
    if (text.includes("INSERT INTO institution_structure_events")) return Promise.resolve([{ linked: true }, { linked: false }]);
    return Promise.resolve([]);
  });
  return { db: db as unknown as RegistryDb, statements };
}

const partitionDetail = (statements: Array<{ text: string; values: unknown[] }>) => {
  const insert = statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"))!;
  return JSON.parse(insert.values.find((v) => typeof v === "string" && v.startsWith("{")) as string);
};

function ffiecFetch(zip: Uint8Array) {
  const page = `<input name="__VIEWSTATE" value="v" /><input name="__VIEWSTATEGENERATOR" value="g" />
    <select name="ctl00$MainContentHolder$DatesDropDownList"><option value="1">06/30/2026</option></select>`;
  let calls = 0;
  return vi.fn(async () => {
    calls += 1;
    if (calls < 5) return new Response(page, { status: 200, headers: { "content-type": "text/html" } });
    return new Response(zip as unknown as BodyInit, { status: 200, headers: { "content-type": "application/octet-stream" } });
  }) as unknown as typeof fetch;
}

describe("registry ffiec-call-detail", () => {
  const zip = zipSync({
    "FFIEC CDR Call Schedule RI 06302026.txt": strToU8('"IDRSSD"\t"RIADH033"\t"RIADH034"\n""\t"CONSUMER ACCOUNT PERIODIC MAINTENANCE CHARGES"\t"WRONG"\n"852218"\t"700"\t"40"\n'),
    "FFIEC CDR Call Schedule RCO 06302026.txt": strToU8('"IDRSSD"\t"RCONF050"\n""\t"NUMBER OF DEPOSIT ACCOUNTS OF $250,000 OR LESS"\n"852218"\t"81000"\n'),
  });

  it("dry run checks the lines and writes nothing", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryFfiecCallDetail({ partitionKey: "2026Q2", dryRun: true, db, fetchOptions: { fetchImpl: ffiecFetch(zip) } });
    expect(r).toMatchObject({ banks: 1, values: 2, empty: false });
    expect(r.loadedLines).toEqual(["consumer_maintenance_charges_ytd", "deposits_250k_or_less_count"]);
    expect(statements.some((s) => s.text.includes("INSERT"))).toBe(false);
  });

  it("writes the values and lists the lines it could not confirm", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryFfiecCallDetail({ partitionKey: "2026Q2", db, fetchOptions: { fetchImpl: ffiecFetch(zip) } });
    expect(r.writtenRows).toBe(2);
    const detail = partitionDetail(statements);
    expect(detail.missing_lines).toContainEqual(expect.objectContaining({ code: "RIADH034", status: "description_mismatch", description: "WRONG" }));
    expect(detail.missing_lines).toContainEqual(expect.objectContaining({ code: "RIAD4635", status: "not_in_file" }));
  });
});

describe("registry ncua-extras", () => {
  it("lists newest quarters first, only back to the 13 quarters already loaded", () => {
    const parts = ncuaExtrasPartitions(new Date("2026-10-17T00:00:00Z"));
    expect(parts[0]).toBe("2026Q2");
    expect(parts.at(-1)).toBe("2023Q2");
    expect(parts).toHaveLength(13);
  });

  it("stops FFIEC call detail at 2023, finishing that year, while the overdraft line keeps its 2015 floor", () => {
    const now = new Date("2026-10-17T00:00:00Z");
    const detail = ffiecCallDetailPartitions(now);
    expect(detail).toHaveLength(14);
    expect(detail.slice(-4)).toEqual(["2023Q1", "2023Q2", "2023Q3", "2023Q4"]);
    expect(ffiecOverdraftPartitions(now).at(-1)).toBe("2015Q4");
  });

  it("records an empty partition when the zip has no description file", async () => {
    const { db, statements } = createDb();
    const zip = zipSync({ "FS220.txt": strToU8("CU_NUMBER,ACCT_564A\n100,25\n") });
    const fetchImpl = vi.fn(async () => new Response(zip as unknown as BodyInit, { status: 200 })) as unknown as typeof fetch;
    const r = await runRegistryNcuaExtras({ partitionKey: "2026Q2", db, fetchOptions: { fetchImpl } });
    expect(r.empty).toBe(true);
    expect(partitionDetail(statements).reason).toMatch(/no account description file/);
    expect(statements.some((s) => s.text.includes("INSERT INTO institution_call_report_items"))).toBe(false);
  });

  it("writes described lines", async () => {
    const { db } = createDb();
    const zip = zipSync({
      "AcctDesc.txt": strToU8('Account,AcctName,AcctDesc,TableName\n"ACCT_564A","Employees","Number of full-time employees","FS220"\n'),
      "FS220.txt": strToU8("CU_NUMBER,ACCT_564A\n100,25\n"),
    });
    const fetchImpl = vi.fn(async () => new Response(zip as unknown as BodyInit, { status: 200 })) as unknown as typeof fetch;
    const r = await runRegistryNcuaExtras({ partitionKey: "2026Q2", db, fetchOptions: { fetchImpl } });
    expect(r).toMatchObject({ lines: 1, creditUnions: 1, writtenRows: 2, empty: false });
  });
});

describe("registry fdic-history", () => {
  it("lists years newest first", () => {
    expect(fdicHistoryPartitions(new Date("2026-10-17T00:00:00Z"), 2024)).toEqual(["2026", "2025", "2024"]);
  });

  it("writes one row per distinct event and counts the linked ones", async () => {
    const { db, statements } = createDb();
    const record = { CERT: 628, CHANGECODE: 223, EFFDATE: "2025-07-01" };
    const fetchImpl = vi.fn(async () =>
      new Response(JSON.stringify({ meta: { total: 3 }, data: [{ data: record }, { data: record }, { data: { ...record, CERT: 9 } }] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ) as unknown as typeof fetch;
    const r = await runRegistryFdicHistory({ partitionKey: "2025", db, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r).toMatchObject({ events: 2, writtenRows: 2, linkedEvents: 1 });
    expect(partitionDetail(statements).duplicate_records).toBe(1);
  });
});
