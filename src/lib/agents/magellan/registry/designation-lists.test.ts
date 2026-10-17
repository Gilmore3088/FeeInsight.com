import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import { designationListsPartitions, runRegistryDesignationLists } from "./designation-lists";
import type { RegistryDb } from "./partitions";

function createDb(stored = 0) {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn((strings: unknown, ...values: unknown[]) => {
    if (!Array.isArray(strings) || !("raw" in (strings as object))) return strings;
    const text = (strings as string[]).join(" ");
    statements.push({ text, values });
    if (text.includes("FROM institution_sources")) {
      return Promise.resolve([
        { id: 1, source: "fdic", cert_number: "628", ncua_charter_id: null, institution_name: "First Bank of Testing", state_code: "TX" },
        { id: 2, source: "ncua", cert_number: "123", ncua_charter_id: "123", institution_name: "Hope Federal Credit Union", state_code: "MS" },
      ]);
    }
    if (text.includes("COUNT(*)::int AS rows")) return Promise.resolve([{ rows: stored }]);
    if (text.includes("INSERT INTO institution_designations")) {
      const payload = JSON.parse(values.find((v) => typeof v === "string" && v.startsWith("[")) as string);
      return Promise.resolve(payload.map(() => ({})));
    }
    if (text.includes("DELETE FROM institution_designations")) return Promise.resolve([{}]);
    return Promise.resolve([]);
  });
  return { db: db as unknown as RegistryDb, statements };
}

const partitionDetail = (statements: Array<{ text: string; values: unknown[] }>) => {
  const insert = statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"))!;
  return JSON.parse(insert.values.find((v) => typeof v === "string" && v.startsWith("{")) as string);
};

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("registry designation-lists", () => {
  it("lists one partition per list", () => {
    expect(designationListsPartitions(new Date())).toEqual(["fdic-institution-flags", "ncua-foicu-flags", "ncua-mdi", "cdfi-fund", "bank-on"]);
  });

  it("reads Bank On's own table when the page links no file, one designation per institution", async () => {
    const { db, statements } = createDb();
    const html = `<table><tr><th>Financial Institution</th><th>Account Name</th><th>States</th></tr>
      <tr><td><a href="#">First Bank of Testing</a></td><td>Basic</td><td>TX</td></tr>
      <tr><td>First Bank of Testing</td><td>Second Chance</td><td>TX</td></tr>
      <tr><td>Hope Federal Credit Union</td><td>Hope Account</td><td>MS, AL</td></tr>
      <tr><td>Big National Bank</td><td>Starter</td><td>Nationwide</td></tr></table>`;
    const fetchImpl = vi.fn(async () => new Response(html, { status: 200 })) as unknown as typeof fetch;
    const r = await runRegistryDesignationLists({ partitionKey: "bank-on", db, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r).toMatchObject({ records: 3, matched: 2, unmatched: 1 });
    const cleaning = partitionDetail(statements).cleaning;
    expect(cleaning.duplicateKeys).toHaveLength(1);
    expect(cleaning.unmatchedRows).toEqual([expect.objectContaining({ name: "Big National Bank", reason: "no_state" })]);
  });

  it("rejects an unknown partition", async () => {
    await expect(runRegistryDesignationLists({ partitionKey: "nope", db: createDb().db })).rejects.toThrow(/Invalid designation list/);
  });

  it("retries BankFind without the fields list when it refuses one, and writes matched flags", async () => {
    const { db, statements } = createDb();
    const fetchImpl = vi.fn(async (url: string) =>
      url.includes("fields=") ? json({ error: "bad field" }, 400) : json({ meta: { total: 1 }, data: [{ data: { CERT: 628, NAME: "First Bank of Testing", STALP: "TX", MDI_STATUS_CODE: "H", MDI_STATUS_DESC: "Hispanic", MUTUAL: 1 } }] }),
    ) as unknown as typeof fetch;
    const r = await runRegistryDesignationLists({ partitionKey: "fdic-institution-flags", db, fetchOptions: { fetchImpl, backoffMs: 0 }, now: new Date("2026-10-17T00:00:00Z") });
    expect(r).toMatchObject({ records: 2, matched: 2, unmatched: 0, writtenRows: 2, removedRows: 1, asOf: "2026-10-17", empty: false });
    const detail = partitionDetail(statements);
    expect(detail.requested_fields).toBe(false);
    expect(detail.fields_missing).toEqual(expect.arrayContaining(["SPECGRP", "SPECGRPN", "SUBCHAPS"]));
  });

  it("reads FOICU from the newest published zip, stepping back past a 404", async () => {
    const { db } = createDb();
    const zip = zipSync({ "FOICU.txt": strToU8("CU_NUMBER,CU_NAME,STATE,LIMITED_INC,TOM_CODE,YEAR_OPENED\n123,Hope Federal Credit Union,MS,1,3,1994\n999,Gone CU,AL,1,3,1950\n") });
    let calls = 0;
    const fetchImpl = vi.fn(async () => {
      calls += 1;
      return calls === 1 ? new Response("missing", { status: 404 }) : new Response(zip as unknown as BodyInit, { status: 200 });
    }) as unknown as typeof fetch;
    const r = await runRegistryDesignationLists({ partitionKey: "ncua-foicu-flags", dryRun: true, db, fetchOptions: { fetchImpl, backoffMs: 0 }, now: new Date("2026-10-17T00:00:00Z") });
    expect(r).toMatchObject({ records: 6, matched: 3, unmatched: 3, asOf: "2026-03-31", dryRun: true });
  });

  it("records an empty partition and removes nothing when the page has no list link", async () => {
    const { db, statements } = createDb(500);
    const fetchImpl = vi.fn(async () => new Response("<html>no links</html>", { status: 200 })) as unknown as typeof fetch;
    const r = await runRegistryDesignationLists({ partitionKey: "cdfi-fund", db, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r.empty).toBe(true);
    expect(partitionDetail(statements).reason).toMatch(/No CDFI Fund certified list file link/);
    expect(statements.some((s) => s.text.includes("DELETE"))).toBe(false);
  });

  it("keeps stored rows when a new read is under half of them", async () => {
    const { db, statements } = createDb(100);
    const fetchImpl = vi.fn(async (url: string) =>
      url.endsWith(".csv")
        ? new Response("Charter Number,Credit Union Name,City,State,Minority Status\n123,Hope Federal Credit Union,Jackson,MS,Black American\n", { status: 200 })
        : new Response('<a href="/files/MDI-List-2026-06.csv">MDI list</a>', { status: 200 }),
    ) as unknown as typeof fetch;
    const r = await runRegistryDesignationLists({ partitionKey: "ncua-mdi", db, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r).toMatchObject({ records: 1, matched: 1, writtenRows: 1, removedRows: 0, asOf: "2026-06-01" });
    expect(statements.some((s) => s.text.includes("DELETE"))).toBe(false);
    expect(partitionDetail(statements).stale_rows_kept).toMatch(/old rows kept/);
  });
});
