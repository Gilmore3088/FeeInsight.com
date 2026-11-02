import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import { CRA_DISCLOSURE_LAYOUT, CRA_TRANSMITTAL_LAYOUT } from "@/lib/regulatory/cra";
import { CRAPES_ROWS, FRB_PAGE } from "@/lib/regulatory/cra-agencies-fixtures";
import { craPartitions, runRegistryCra } from "./cra";
import type { RegistryDb } from "./partitions";

function createDb() {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn((strings: unknown, ...values: unknown[]) => {
    if (!Array.isArray(strings) || !("raw" in (strings as object))) return strings;
    const text = (strings as string[]).join(" ");
    statements.push({ text, values });
    if (text.includes("INSERT INTO cra_ratings")) return Promise.resolve([{ linked: true }, { linked: false }]);
    if (text.includes("INSERT INTO cra_lending_respondents")) return Promise.resolve([{ linked: true }]);
    if (text.includes("INSERT INTO cra_small_business_lending")) return Promise.resolve([{ linked: true }, { linked: false }]);
    return Promise.resolve([]);
  });
  return { db: db as unknown as RegistryDb, statements };
}

const partitionDetail = (statements: Array<{ text: string; values: unknown[] }>) => {
  const insert = statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"))!;
  return JSON.parse(insert.values.find((v) => typeof v === "string" && v.startsWith("{")) as string);
};

function fixedLine(layout: ReadonlyArray<{ key: string; start: number; length: number }>, values: Record<string, string | number>): string {
  const end = Math.max(...layout.map((f) => f.start - 1 + f.length));
  const chars = Array<string>(end).fill(" ");
  for (const f of layout) {
    const v = values[f.key];
    if (v === undefined) continue;
    const s = typeof v === "number" ? String(v).padStart(f.length, " ") : String(v).padEnd(f.length, " ");
    for (let i = 0; i < f.length; i += 1) chars[f.start - 1 + i] = s[i];
  }
  return chars.join("");
}

const zipResponse = (files: Record<string, string>) =>
  new Response(zipSync(Object.fromEntries(Object.entries(files).map(([k, v]) => [k, strToU8(v)]))) as unknown as BodyInit, { status: 200 });

describe("registry cra partitions", () => {
  it("lists the agency ratings partitions, then lending years newest first; the unreachable FFIEC file is not scheduled", () => {
    const parts = craPartitions(new Date("2026-10-17T00:00:00Z"));
    expect(parts.slice(0, 3)).toEqual(["ratings-frb", "ratings-fdic-2026", "ratings-fdic-2025"]);
    expect(parts).not.toContain("ratings-current");
    expect(parts.filter((p) => p.startsWith("ratings-fdic-")).at(-1)).toBe("ratings-fdic-2016");
    const lending = parts.filter((p) => /^\d{4}$/.test(p));
    expect(lending[0]).toBe("2025");
    expect(lending.at(-1)).toBe("2016");
    expect(craPartitions(new Date("2026-03-01T00:00:00Z")).find((p) => /^\d{4}$/.test(p))).toBe("2024");
    expect(craPartitions(new Date("2026-10-17T00:00:00Z"), 2024).filter((p) => p.startsWith("ratings-fdic-"))).toEqual(["ratings-fdic-2026", "ratings-fdic-2025", "ratings-fdic-2024"]);
  });

  it("rejects an unknown partition", async () => {
    await expect(runRegistryCra({ partitionKey: "1999", db: createDb().db })).rejects.toThrow(/Invalid CRA partition/);
  });
});

describe("registry cra ratings", () => {
  const ratings = "ID_RSSD|Bank Name|Exam Date|Rating|Regulator|Exam Method\n852218|First Test Bank|03/15/2024|2|1|Large Bank\n777|Other|2023-05-01|1|3|Small Bank\n";
  const fetchImpl = vi.fn(async () => zipResponse({ "CRA_Ratings.txt": ratings })) as unknown as typeof fetch;

  it("dry run parses and writes nothing", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryCra({ partitionKey: "ratings-current", dryRun: true, db, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r).toMatchObject({ kind: "ratings", rows: 2, empty: false, dryRun: true });
    expect(r.missingFields).toContain("evaluationUrl");
    expect(statements.some((s) => s.text.includes("INSERT"))).toBe(false);
  });

  it("writes ratings and records matched and unmatched counts", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryCra({ partitionKey: "ratings-current", db, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r).toMatchObject({ writtenRows: 2, matchedRows: 1, unmatchedRows: 1 });
    const detail = partitionDetail(statements);
    expect(detail.field_columns.rssd).toBe("ID_RSSD");
    expect(detail.cleaning.ratingCounts).toMatchObject({ Outstanding: 1, Satisfactory: 1 });
  });

  it("records an empty partition when the header lacks a rating column", async () => {
    const { db, statements } = createDb();
    const bad = vi.fn(async () => new Response("NAME,CITY,STATE\nA,B,C\n", { status: 200 })) as unknown as typeof fetch;
    const r = await runRegistryCra({ partitionKey: "ratings-current", db, fetchOptions: { fetchImpl: bad, backoffMs: 0 } });
    expect(r.empty).toBe(true);
    expect(partitionDetail(statements).reason).toMatch(/Required ratings fields/);
    expect(statements.some((s) => s.text.includes("INSERT INTO cra_ratings"))).toBe(false);
  });
});

describe("registry cra lending", () => {
  const discl = [
    fixedLine(CRA_DISCLOSURE_LAYOUT, {
      tableId: "D1-1", respondentId: "0000012345", agencyCode: "3", activityYear: "2024", loanType: "4", actionTaken: "1",
      state: "48", county: "201", msaMd: "26420", assessmentArea: "0001", reportLevel: "040",
      countSize1: 50, amountSize1: 1500, countSize2: 10, amountSize2: 1700, countSize3: 4, amountSize3: 2600, countRevUnder1m: 30, amountRevUnder1m: 1200,
    }),
    fixedLine(CRA_DISCLOSURE_LAYOUT, {
      tableId: "D2-1", respondentId: "0000012345", agencyCode: "3", activityYear: "2024", loanType: "5", actionTaken: "1",
      state: "48", county: "201", reportLevel: "040", countSize1: 2, amountSize1: 90,
    }),
  ].join("\n");
  const trans = fixedLine(CRA_TRANSMITTAL_LAYOUT, { respondentId: "0000012345", agencyCode: "3", activityYear: "2024", name: "FIRST TEST BANK", rssd: "852218", assets: 900000 });

  it("writes respondents and lending rows", async () => {
    const { db, statements } = createDb();
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes("discl") ? zipResponse({ "cra2024_Discl_D11.dat": discl }) : zipResponse({ "cra2024_Trans.dat": trans }),
    ) as unknown as typeof fetch;
    const r = await runRegistryCra({ partitionKey: "2024", db, fetchOptions: { fetchImpl, backoffMs: 0 }, now: new Date("2026-10-17T00:00:00Z") });
    expect(r).toMatchObject({ kind: "lending", rows: 2, respondents: 1, writtenRows: 2, matchedRows: 1, empty: false });
    const detail = partitionDetail(statements);
    expect(detail.respondents_matched).toBe(1);
    expect(detail.cleaning.rowsByTable).toEqual({ "D1-1": 1, "D2-1": 1 });
  });

  it("records an empty partition when the year is not published", async () => {
    const { db, statements } = createDb();
    const fetchImpl = vi.fn(async () => new Response("nope", { status: 404 })) as unknown as typeof fetch;
    const r = await runRegistryCra({ partitionKey: "2025", db, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r.empty).toBe(true);
    expect(partitionDetail(statements).reason).toMatch(/has not published the 2025/);
  });

  it("writes nothing when lines fail the layout check", async () => {
    const { db, statements } = createDb();
    const wrongYear = discl.replaceAll("2024", "2023");
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes("discl") ? zipResponse({ "cra2024_Discl_D11.dat": wrongYear }) : zipResponse({ "t.dat": trans }),
    ) as unknown as typeof fetch;
    const r = await runRegistryCra({ partitionKey: "2024", db, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r.emptyReason).toMatch(/failed the layout check/);
    expect(statements.some((s) => s.text.includes("INSERT INTO cra_small_business_lending"))).toBe(false);
  });
});

describe("registry cra agency ratings (#1805)", () => {
  it("writes FDIC CRAPES ratings for one public year and records the months read", async () => {
    const { db, statements } = createDb();
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      const release = JSON.parse(String(init?.body)).release as string;
      return new Response(JSON.stringify({ status: "success", data: release.startsWith("2025-3-") ? [CRAPES_ROWS[0]] : [] }));
    }) as unknown as typeof fetch;
    const r = await runRegistryCra({ partitionKey: "ratings-fdic-2025", db, fetchOptions: { fetchImpl, backoffMs: 0 }, now: new Date("2026-11-02T00:00:00Z") });
    expect(r).toMatchObject({ kind: "ratings", rows: 1, writtenRows: 2, empty: false });
    const payload = JSON.parse(statements.find((s) => s.text.includes("INSERT INTO cra_ratings"))!.values[0] as string);
    expect(payload[0]).toMatchObject({ fdic_cert: "23091", regulator: "FDIC", exam_date: null, rating_code: 1 });
    expect(partitionDetail(statements)).toMatchObject({ agency: "FDIC", year: 2025, months_read: 12, capped_months: [], parser_version: 3 });
    expect(partitionDetail(statements).cleaning.missingByField).toEqual({});
  });

  it("writes the Federal Reserve list with RSSD ids", async () => {
    const { db, statements } = createDb();
    const fetchImpl = vi.fn(async () => new Response(FRB_PAGE)) as unknown as typeof fetch;
    const r = await runRegistryCra({ partitionKey: "ratings-frb", db, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r.rows).toBe(2);
    const payload = JSON.parse(statements.find((s) => s.text.includes("INSERT INTO cra_ratings"))!.values[0] as string);
    expect(payload.map((p: { rssd: string }) => p.rssd)).toEqual(["746223", "99"]);
    expect(partitionDetail(statements)).toMatchObject({ agency: "FRB", pages_read: 2, last_page: 2 });
  });

  it("rejects an FDIC year outside the list", async () => {
    await expect(runRegistryCra({ partitionKey: "ratings-fdic-2009", db: createDb().db })).rejects.toThrow(/Invalid CRA partition/);
    await expect(runRegistryCra({ partitionKey: "ratings-fdic-2099", db: createDb().db })).rejects.toThrow(/Invalid CRA partition/);
  });
});
