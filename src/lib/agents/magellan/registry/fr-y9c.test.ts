import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import { frY9cPartitions, runRegistryFrY9c } from "./fr-y9c";
import { NIC_STRUCTURE_PARTITION, runRegistryNicStructure } from "./nic-structure";
import type { RegistryDb } from "./partitions";

function createDb() {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn((strings: unknown, ...values: unknown[]) => {
    if (!Array.isArray(strings) || !("raw" in (strings as object))) return strings;
    const text = (strings as string[]).join(" ");
    statements.push({ text, values });
    if (text.includes("COUNT(DISTINCT holding_company_rssd)")) return Promise.resolve([{ matched: 1 }]);
    if (text.includes("AS banks")) return Promise.resolve([{ banks: 4321 }]);
    if (text.includes("COUNT(DISTINCT rssd_id)")) return Promise.resolve([{ linked: 1 }]);
    if (text.includes("AS disagreements")) return Promise.resolve([{ disagreements: 0 }]);
    if (text.includes("INSERT INTO holding_company_y9c_items")) return Promise.resolve([{}, {}, {}]);
    if (text.includes("INSERT INTO holding_company_y9c_filers")) return Promise.resolve([{}, {}]);
    if (text.includes("INSERT INTO nic_relationships")) return Promise.resolve([{}]);
    if (text.includes("INSERT INTO nic_entities")) return Promise.resolve([{}]);
    return Promise.resolve([]);
  });
  return { db: db as unknown as RegistryDb, statements };
}

const partitionDetail = (statements: Array<{ text: string; values: unknown[] }>) => {
  const insert = statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"))!;
  return JSON.parse(insert.values.find((v) => typeof v === "string" && v.startsWith("{")) as string);
};

const zipResponse = (zip: Uint8Array) => new Response(zip as unknown as BodyInit, { status: 200 });

describe("registry fr-y9c", () => {
  const bhcf = zipSync({
    "BHCF20260630.txt": strToU8(
      [
        "RSSD9001^RSSD9999^RSSD9017^RSSD9200^BHCK2170^BHCK4483^BHCK4079",
        "^REPORT DATE^LEGAL NAME^STATE^TOTAL ASSETS^SERVICE CHARGES ON DEPOSIT ACCOUNTS^SOMETHING ELSE",
        "1000^20260630^ALPHA BANCORP^TX^5000000^2500^9000",
        "2000^20260630^BETA FINANCIAL^OK^800000^^100",
      ].join("\n"),
    ),
  });

  it("lists quarters newest first from 2015", () => {
    const parts = frY9cPartitions(new Date("2026-10-17T00:00:00Z"));
    expect(parts[0]).toBe("2026Q2");
    expect(parts.at(-1)).toBe("2015Q1");
  });

  it("dry run checks the lines and writes nothing", async () => {
    const { db, statements } = createDb();
    const fetchImpl = vi.fn(async () => zipResponse(bhcf)) as unknown as typeof fetch;
    const r = await runRegistryFrY9c({ partitionKey: "2026Q2", dryRun: true, db, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r).toMatchObject({ filers: 2, values: 3, matchedHoldingCompanies: 1, empty: false, usedMdrm: false });
    expect(r.loadedLines).toEqual(["total_assets", "service_charges_deposit_accounts_ytd"]);
    expect(statements.some((s) => s.text.includes("INSERT"))).toBe(false);
  });

  it("writes filers and values and lists the lines it could not confirm", async () => {
    const { db, statements } = createDb();
    const fetchImpl = vi.fn(async () => zipResponse(bhcf)) as unknown as typeof fetch;
    const r = await runRegistryFrY9c({ partitionKey: "2026Q2", db, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r).toMatchObject({ writtenRows: 3, writtenFilers: 2 });
    const detail = partitionDetail(statements);
    expect(detail.missing_lines).toContainEqual(expect.objectContaining({ code: "BHCK4079", status: "description_mismatch" }));
    expect(detail.missing_lines).toContainEqual(expect.objectContaining({ code: "BHCK4340", status: "not_in_file" }));
    expect(detail.quality.missingByKey.service_charges_deposit_accounts_ytd).toBe(1);
  });

  it("records an empty partition when NIC has no file for the quarter", async () => {
    const { db, statements } = createDb();
    const fetchImpl = vi.fn(async () => new Response("not found", { status: 404 })) as unknown as typeof fetch;
    const r = await runRegistryFrY9c({ partitionKey: "2026Q2", db, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r.empty).toBe(true);
    expect(partitionDetail(statements).reason).toMatch(/does not list a BHCF file/);
  });

  it("records a named missing source when NIC refuses the request (#1806)", async () => {
    const { db, statements } = createDb();
    const fetchImpl = vi.fn(async () => new Response("Forbidden", { status: 403 })) as unknown as typeof fetch;
    const r = await runRegistryFrY9c({ partitionKey: "2026Q2", db, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r).toMatchObject({ empty: true, writtenRows: 0, missingSource: { host: "www.ffiec.gov", status: 403, second_host: null } });
    expect(r.emptyReason).toBe("FR Y-9C source missing: www.ffiec.gov answered HTTP 403 and FR Y-9C has no official second host");
    const detail = partitionDetail(statements);
    expect(detail.missing_source).toMatchObject({ host: "www.ffiec.gov", status: 403, second_host: null });
    expect(statements.some((s) => s.text.includes("INSERT INTO holding_company_y9c"))).toBe(false);
  });

  it("still fails on an error that is not a refusal", async () => {
    const { db } = createDb();
    const fetchImpl = vi.fn(async () => new Response("bad", { status: 400 })) as unknown as typeof fetch;
    await expect(runRegistryFrY9c({ partitionKey: "2026Q2", db, fetchOptions: { fetchImpl, backoffMs: 0 } })).rejects.toThrow(/HTTP 400/);
  });
});

describe("registry nic-structure", () => {
  it("writes relationships and the parents' attributes", async () => {
    const { db, statements } = createDb();
    const rel = zipSync({ "CSV_RELATIONSHIPS.CSV": strToU8("#ID_RSSD_PARENT,ID_RSSD_OFFSPRING,DT_START,DT_END\n10,20,20200101,99991231\n") });
    const attrs = zipSync({ "CSV_ATTRIBUTES_ACTIVE.CSV": strToU8("#ID_RSSD,NM_LGL,STATE_ABBR_NM\n10,ALPHA CORP,TX\n20,ALPHA BANK,TX\n") });
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes("Relationships") ? zipResponse(rel) : url.includes("Active") ? zipResponse(attrs) : new Response("", { status: 404 }),
    ) as unknown as typeof fetch;
    const r = await runRegistryNicStructure({ partitionKey: NIC_STRUCTURE_PARTITION, db, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r).toMatchObject({ relationships: 1, parents: 1, entities: 1, writtenRelationships: 1, writtenEntities: 1, linkedBanks: 1, parentDisagreements: 0 });
    expect(r.missingFiles).toHaveLength(1);
    expect(partitionDetail(statements).quality.parentsWithoutAttributes).toBe(0);
  });

  it("loads nothing when the relationships file lacks a required column", async () => {
    const { db, statements } = createDb();
    const rel = zipSync({ "CSV_RELATIONSHIPS.CSV": strToU8("ID_RSSD_PARENT,ID_RSSD_OFFSPRING\n10,20\n") });
    const fetchImpl = vi.fn(async () => zipResponse(rel)) as unknown as typeof fetch;
    const r = await runRegistryNicStructure({ db, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r.empty).toBe(true);
    expect(r.emptyReason).toMatch(/DT_START, DT_END/);
    expect(statements.some((s) => s.text.includes("INSERT INTO nic_relationships"))).toBe(false);
  });

  it("names the missing source and the FDIC fallback's reach when NIC refuses the request (#1806)", async () => {
    const { db, statements } = createDb();
    const fetchImpl = vi.fn(async () => new Response("Forbidden", { status: 403 })) as unknown as typeof fetch;
    const r = await runRegistryNicStructure({ db, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r).toMatchObject({ empty: true, relationships: 0, missingSource: { host: "www.ffiec.gov", status: 403, second_host: null, fallback_banks: 4321 } });
    expect(r.emptyReason).toMatch(/^NIC source missing: www\.ffiec\.gov answered HTTP 403\. Fallback: 4,321 tracked banks carry their current direct holding company from FDIC BankFind \(RSSDHCR\)/);
    const detail = partitionDetail(statements);
    expect(detail.missing_source.not_covered).toHaveLength(3);
    expect(detail.missing_source.fallback).toMatch(/RSSDHCR/);
    expect(statements.some((s) => s.text.includes("INSERT INTO nic_"))).toBe(false);
  });

  it("dry run of a refused NIC request writes nothing", async () => {
    const { db, statements } = createDb();
    const fetchImpl = vi.fn(async () => new Response("Forbidden", { status: 403 })) as unknown as typeof fetch;
    const r = await runRegistryNicStructure({ db, dryRun: true, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r.missingSource?.fallback_banks).toBe(4321);
    expect(statements.some((s) => s.text.includes("INSERT"))).toBe(false);
  });
});
