import { describe, expect, it, vi } from "vitest";

import { paymentNetworksPartitions, runRegistryPaymentNetworks } from "./payment-networks";
import type { RegistryDb } from "./partitions";

function createDb(universe: Array<Record<string, unknown>> = [], previousRows: number | null = null) {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn((strings: unknown, ...values: unknown[]) => {
    if (!Array.isArray(strings) || !("raw" in (strings as object))) return strings;
    const text = (strings as string[]).join(" ");
    statements.push({ text, values });
    if (text.includes("FROM institution_sources")) return Promise.resolve(universe);
    if (text.includes("COUNT(*)::int AS rows")) return Promise.resolve([{ rows: previousRows }]);
    if (text.includes("INSERT INTO institution_network_memberships")) {
      const payload = JSON.parse(values.find((v) => typeof v === "string" && v.startsWith("[")) as string) as unknown[];
      return Promise.resolve(payload.map(() => ({})));
    }
    if (text.includes("INSERT INTO reg_ii_interchange_figures") || text.includes("INSERT INTO osm_financial_locations")) {
      const payload = JSON.parse(values.find((v) => typeof v === "string" && v.startsWith("[")) as string) as unknown[];
      return Promise.resolve(payload.map(() => ({})));
    }
    return Promise.resolve([]);
  });
  return { db: db as unknown as RegistryDb, statements };
}

const partitionDetail = (statements: Array<{ text: string; values: unknown[] }>) => {
  const insert = statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"))!;
  return JSON.parse(insert.values.find((v) => typeof v === "string" && v.startsWith("{")) as string);
};

function site(pages: Record<string, string>) {
  return vi.fn(async (input: string | URL) => {
    const url = String(input);
    const path = new URL(url).pathname;
    if (path === "/robots.txt") return new Response("User-agent: *\nDisallow:\n", { status: 200 });
    const body = pages[path];
    return body === undefined ? new Response("", { status: 404 }) : new Response(body, { status: 200, headers: { "content-type": "text/html" } });
  }) as unknown as typeof fetch;
}

const now = new Date("2026-10-17T12:00:00Z");
const fedRows = Array.from({ length: 120 }, (_, i) => `<tr><td>Test Bank ${i}</td><td>Austin</td><td>TX</td></tr>`).join("");
const fedPage = `<p>Updated October 1, 2026</p><table><tr><th>Institution</th><th>City</th><th>State</th></tr>
  <tr><td>Elm Bank</td><td>Austin</td><td>TX</td></tr>${fedRows}</table>`;
const universe = [{ id: 7, institution_name: "Elm Bank", state_code: "TX", rssd_id: null, cert_number: "1", ncua_charter_id: null, source: "fdic" }];

describe("registry payment-networks", () => {
  it("lists the published lists, the survey, then one OpenStreetMap partition per state", () => {
    const parts = paymentNetworksPartitions(now);
    expect(parts.slice(0, 6)).toEqual(["zelle", "fednow", "rtp", "reg-ii-not-exempt", "reg-ii-exempt", "reg-ii-survey"]);
    expect(parts).toContain("osm-TX");
    expect(parts).not.toContain("allpoint");
  });

  it("rejects an unknown partition", async () => {
    await expect(runRegistryPaymentNetworks({ partitionKey: "allpoint", db: createDb().db })).rejects.toThrow(/Invalid/);
  });

  it("dry run reads and matches the list and writes nothing", async () => {
    const { db, statements } = createDb(universe);
    const fetchImpl = site({ "/financial-services/fednow/organizations": fedPage });
    const r = await runRegistryPaymentNetworks({ partitionKey: "fednow", dryRun: true, db, now, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r).toMatchObject({ network: "fednow", listedRows: 121, matchedRows: 1, unmatchedRows: 120, statedDate: "October 1, 2026", empty: false });
    expect(statements.some((s) => s.text.includes("INSERT"))).toBe(false);
  });

  it("writes memberships with unmatched rows kept and records the checks", async () => {
    const { db, statements } = createDb(universe, 50);
    const fetchImpl = site({ "/financial-services/fednow/organizations": fedPage });
    const r = await runRegistryPaymentNetworks({ partitionKey: "fednow", db, now, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r.writtenRows).toBe(121);
    const insert = statements.find((s) => s.text.includes("INSERT INTO institution_network_memberships"))!;
    const payload = JSON.parse(insert.values.find((v) => typeof v === "string" && v.startsWith("[")) as string);
    expect(payload[0]).toMatchObject({ institution_id: 7, match_method: "name_state", listed_state: "TX" });
    expect(payload[1]).toMatchObject({ institution_id: null });
    const detail = partitionDetail(statements);
    expect(detail.checks).toMatchObject({ rows: 121, matched: 1, unmatched: 120, previous_rows: 50, count_change_flag: true });
    expect(detail.missing_columns).toEqual(["rssd", "cert", "ncua_charter"]);
  });

  it("records an empty partition when robots.txt disallows the page", async () => {
    const { db, statements } = createDb();
    const fetchImpl = vi.fn(async () => new Response("User-agent: FeeInsightBot\nDisallow: /\n", { status: 200 })) as unknown as typeof fetch;
    const r = await runRegistryPaymentNetworks({ partitionKey: "zelle", db, now, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r.empty).toBe(true);
    expect(partitionDetail(statements).reason).toMatch(/robots\.txt/);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("records an empty partition when the page builds its list with script", async () => {
    const { db, statements } = createDb();
    const fetchImpl = site({ "/participating-banks-and-credit-unions": '<div id="app"></div><script src="/app.js"></script>' });
    const r = await runRegistryPaymentNetworks({ partitionKey: "zelle", db, now, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r).toMatchObject({ empty: true, listedRows: 0 });
    expect(partitionDetail(statements).reason).toMatch(/JavaScript/);
    expect(statements.some((s) => s.text.includes("INSERT INTO institution_network_memberships"))).toBe(false);
  });

  it("follows the Fed page to the Not Exempt CSV, matches by RSSD and keeps the stated as-of date", async () => {
    const csv = ["Institution Name,RSSD ID,State", ...Array.from({ length: 30 }, (_, i) => `Big Bank ${i},${1000 + i},NC`)].join("\n");
    const { db, statements } = createDb([{ id: 9, institution_name: "Other Name", state_code: "NC", rssd_id: "1000", cert_number: "5", ncua_charter_id: null, source: "fdic" }]);
    const fetchImpl = site({
      "/paymentsystems/regii-about.htm":
        '<a href="/paymentsystems/files/notexempt.csv">Not Exempt institutions as of June 30, 2026</a><a href="/x/exempt.csv">Exempt institutions</a>',
      "/paymentsystems/files/notexempt.csv": csv,
    });
    const r = await runRegistryPaymentNetworks({ partitionKey: "reg-ii-not-exempt", db, now, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r).toMatchObject({ listedRows: 30, matchedRows: 1, asOf: "2026-06-30", readUrl: expect.stringContaining("notexempt.csv") });
    const detail = partitionDetail(statements);
    expect(detail.checks.match_methods).toEqual({ rssd: 1 });
    expect(detail.as_of_basis).toBe("stated_by_publisher");
  });

  it("names a PDF-only Exempt list instead of reading it", async () => {
    const { db, statements } = createDb();
    const fetchImpl = site({ "/paymentsystems/regii-about.htm": '<a href="/files/exempt.pdf">Exempt institutions</a>' });
    const r = await runRegistryPaymentNetworks({ partitionKey: "reg-ii-exempt", db, now, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r.emptyReason).toMatch(/only as pdf/);
    expect(partitionDetail(statements).linked_files).toHaveLength(1);
  });

  it("writes one state's OpenStreetMap ATMs and banks with attribution", async () => {
    const { db, statements } = createDb(universe);
    const overpass = {
      elements: [
        { type: "node", id: 1, lat: 30, lon: -97, tags: { amenity: "atm", operator: "Elm Bank", network: "MoneyPass" } },
        { type: "node", id: 2, lat: 30, lon: -97, tags: { amenity: "bank", name: "Main St Branch", operator: "Unknown Bank" } },
      ],
    };
    const fetchImpl = vi.fn(async (input: string | URL) =>
      new URL(String(input)).pathname === "/robots.txt" ? new Response("", { status: 404 }) : new Response(JSON.stringify(overpass), { status: 200 }),
    ) as unknown as typeof fetch;
    const r = await runRegistryPaymentNetworks({ partitionKey: "osm-TX", db, now, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r).toMatchObject({ network: "osm", listedRows: 2, matchedRows: 1, writtenRows: 2 });
    const insert = statements.find((s) => s.text.includes("INSERT INTO osm_financial_locations"))!;
    expect(insert.values).toContain("© OpenStreetMap contributors, ODbL 1.0 (https://www.openstreetmap.org/copyright)");
    expect(partitionDetail(statements).checks).toMatchObject({ linked: 1, network_tags: { MoneyPass: 1 }, top_unlinked_operators: [{ operator: "Unknown Bank", locations: 1 }] });
  });

  it("records an empty OpenStreetMap partition when Overpass times out", async () => {
    const { db, statements } = createDb();
    const fetchImpl = vi.fn(async (input: string | URL) =>
      new URL(String(input)).pathname === "/robots.txt" ? new Response("", { status: 404 }) : new Response('{"elements":[],"remark":"runtime error: Query timed out"}', { status: 200 }),
    ) as unknown as typeof fetch;
    const r = await runRegistryPaymentNetworks({ partitionKey: "osm-CA", db, now, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r.emptyReason).toMatch(/timed out/);
    expect(statements.some((s) => s.text.includes("INSERT INTO osm_financial_locations"))).toBe(false);
    expect(partitionDetail(statements).reason).toMatch(/timed out/);
  });

  it("writes the interchange tables cell by cell", async () => {
    const { db, statements } = createDb();
    const html = `<table><caption>Average interchange fee</caption><tr><th>Issuer</th><th>2021</th><th>2023</th></tr>
      <tr><td>Covered</td><td>$0.23</td><td>$0.22</td></tr><tr><td>Exempt</td><td>$0.51</td><td>n/a</td></tr></table>`;
    const fetchImpl = site({ "/paymentsystems/regii-average-interchange-fee.htm": html });
    const r = await runRegistryPaymentNetworks({ partitionKey: "reg-ii-survey", db, now, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect(r).toMatchObject({ figures: 4, writtenRows: 4, empty: false });
    expect(partitionDetail(statements).figure_checks).toMatchObject({ numeric: 3, non_numeric: 1 });
  });
});
