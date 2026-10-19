import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import type { RegistryDb } from "./partitions";
import { runRegistryUbprPeerGroups, ubprPeerGroupsPartitions } from "./ubpr-peer-groups";

function createDb() {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn((strings: unknown, ...values: unknown[]) => {
    if (!Array.isArray(strings) || !("raw" in (strings as object))) return strings;
    const text = (strings as string[]).join(" ");
    statements.push({ text, values });
    if (text.includes("COUNT(DISTINCT rssd_id)")) return Promise.resolve([{ matched: 1 }]);
    if (text.includes("INSERT INTO ubpr_bank_peer_groups")) return Promise.resolve([{}, {}]);
    if (text.includes("INSERT INTO ubpr_peer_group_averages")) return Promise.resolve([{}]);
    return Promise.resolve([]);
  });
  return { db: db as unknown as RegistryDb, statements };
}

const partitionDetail = (statements: Array<{ text: string; values: unknown[] }>) => {
  const insert = statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"))!;
  return JSON.parse(insert.values.find((v) => typeof v === "string" && v.startsWith("{")) as string);
};

const tsv = (rows: string[][]) => strToU8(rows.map((r) => r.map((c) => `"${c}"`).join("\t")).join("\n"));

const page = (products: string[]) => `<input name="__VIEWSTATE" value="v" /><input name="__VIEWSTATEGENERATOR" value="g" />
  <select name="ctl00$MainContentHolder$ListBox1">${products.map((p, i) => `<option value="P${i}">${p}</option>`).join("")}</select>
  <select name="ctl00$MainContentHolder$DatesDropDownList"><option value="1">06/30/2026</option></select>`;

/** Fakes the bulk page: HTML until the Download post, then the zip for the chosen product (P0, P1...). */
function bulkFetch(products: string[], zips: Uint8Array[]) {
  return vi.fn(async (_url: string, init?: RequestInit) => {
    const body = new URLSearchParams(String(init?.body ?? ""));
    if (!body.has("ctl00$MainContentHolder$TabStrip1$Download_0")) {
      return new Response(page(products), { status: 200, headers: { "content-type": "text/html" } });
    }
    const zip = zips[Number((body.get("ctl00$MainContentHolder$ListBox1") ?? "P0").slice(1))];
    return new Response(zip as unknown as BodyInit, { status: 200, headers: { "content-type": "application/octet-stream" } });
  }) as unknown as typeof fetch;
}

const ratioZip = zipSync({
  "FFIEC CDR UBPR Summary 06302026.txt": tsv([
    ["IDRSSD", "UBPRP001", "UBPRE013"],
    ["", "PEER GROUP NUMBER", "NET INCOME TO AVERAGE ASSETS"],
    ["852218", "1", "1.2"],
    ["480228", "3", "0.9"],
  ]),
});
const statsZip = zipSync({
  "FFIEC CDR UBPR Stats 06302026.txt": tsv([
    ["PEER GROUP", "UBPRE013"],
    ["", "NET INCOME TO AVERAGE ASSETS"],
    ["1", "1.05"],
  ]),
});

describe("registry ubpr-peer-groups", () => {
  it("lists newest quarters first back to 2015", () => {
    const parts = ubprPeerGroupsPartitions(new Date("2026-10-17T00:00:00Z"));
    expect(parts.at(-1)).toBe("2015Q1");
    expect(parts[0] > parts[1]).toBe(true);
  });

  it("dry run reads both products and writes nothing", async () => {
    const { db, statements } = createDb();
    const fetchImpl = bulkFetch(["UBPR Ratio -- Single Period", "UBPR Stats -- Single Period"], [ratioZip, statsZip]);
    const r = await runRegistryUbprPeerGroups({ partitionKey: "2026Q2", dryRun: true, db, fetchOptions: { fetchImpl } });
    expect(r).toMatchObject({ banks: 2, banksWithPeerGroup: 2, matchedBanks: 1, unmatchedBanks: 1, peerGroups: 2, peerAverages: 1, empty: false });
    expect(r.loadedRatios).toEqual(["roa"]);
    expect(statements.some((s) => s.text.includes("INSERT"))).toBe(false);
  });

  it("writes banks and averages and records the cleaning report", async () => {
    const { db, statements } = createDb();
    const fetchImpl = bulkFetch(["UBPR Ratio -- Single Period", "UBPR Stats -- Single Period"], [ratioZip, statsZip]);
    const r = await runRegistryUbprPeerGroups({ partitionKey: "2026Q2", db, fetchOptions: { fetchImpl } });
    expect(r).toMatchObject({ writtenBankRows: 2, writtenAverageRows: 1 });
    const detail = partitionDetail(statements);
    expect(detail.cleaning.unmatchedRssds).toBe(1);
    expect(detail.missing_ratios.map((c: { key: string }) => c.key)).toContain("efficiency_ratio");
    expect(detail.averages_empty_reason).toBeNull();
  });

  it("keeps the banks when there is no peer statistics product", async () => {
    const { db, statements } = createDb();
    const fetchImpl = bulkFetch(["UBPR Ratio -- Single Period"], [ratioZip]);
    const r = await runRegistryUbprPeerGroups({ partitionKey: "2026Q2", db, fetchOptions: { fetchImpl } });
    expect(r.writtenBankRows).toBe(2);
    expect(r.averagesEmptyReason).toMatch(/No UBPR peer statistics product/);
    expect(statements.some((s) => s.text.includes("INSERT INTO ubpr_peer_group_averages"))).toBe(false);
  });

  it("names the page's title, message and fields when the download answers with HTML (#1806)", async () => {
    const { db, statements } = createDb();
    const formPage = `<title>CDR Bulk Data</title>${page(["UBPR Ratio -- Single Period"])}
      <span id="lblMessage">Select a format.</span>
      <input type="radio" name="ctl00$MainContentHolder$FormatType" value="XBRLRadioButton" />
      <input type="submit" name="ctl00$MainContentHolder$TabStrip1$Download_1" value="Download" />`;
    const posted: URLSearchParams[] = [];
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      posted.push(new URLSearchParams(String(init?.body ?? "")));
      return new Response(formPage, { status: 200, headers: { "content-type": "text/html; charset=utf-8" } });
    }) as unknown as typeof fetch;
    const run = runRegistryUbprPeerGroups({ partitionKey: "2026Q2", db, fetchOptions: { fetchImpl } });
    await expect(run).rejects.toThrow(/text\/html; charset=utf-8 instead of the UBPR bulk zip for "UBPR Ratio -- Single Period" 2026-06-30/);
    await expect(runRegistryUbprPeerGroups({ partitionKey: "2026Q2", db, fetchOptions: { fetchImpl } })).rejects.toThrow(
      /tab-delimited format not offered on the format page\)\. Page: title "CDR Bulk Data"; messages: "Select a format\."; fields: .*FormatType\[radio=XBRLRadioButton\]/,
    );
    // The Download control the page names is the one posted.
    expect(posted.at(-1)?.get("ctl00$MainContentHolder$TabStrip1$Download_1")).toBe("Download");
    expect(statements.some((s) => s.text.includes("INSERT"))).toBe(false);
  });

  it("records an empty partition when the ratio product is not listed", async () => {
    const { db, statements } = createDb();
    const fetchImpl = bulkFetch(["Call Reports -- Single Period"], []);
    const r = await runRegistryUbprPeerGroups({ partitionKey: "2026Q2", db, fetchOptions: { fetchImpl } });
    expect(r.empty).toBe(true);
    expect(partitionDetail(statements).reason).toMatch(/Call Reports -- Single Period/);
  });
});
