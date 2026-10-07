import { strToU8, zipSync } from "fflate";
import { describe, expect, it, vi } from "vitest";

import { runRegistryCfpb } from "./cfpb";
import { runRegistryFdicSod, latestSodYear } from "./fdic-sod";
import { beigeEmptyRetryHours, runRegistryBeigeBook, runRegistryFred } from "./fed";
import { REQUIRED_FRED_SERIES } from "@/lib/regulatory/fed";
import { matchCompany, type IdentityIndex } from "./identity";
import { REGISTRY_SOURCES, runRegistryStep } from "./index";
import { runRegistryNcuaFinancials } from "./ncua-financials";
import type { RegistryDb } from "./partitions";
import { cikBatch, runRegistrySecLinks } from "./sec";
import { runRegistryRegNews } from "./reg-news";
import { runRegistryStateRegulators } from "./state-regulators";

function templateText(strings: unknown): string {
  return Array.isArray(strings) ? strings.join(" ") : String(strings);
}

function createDb(handlers: Array<[string, (values: unknown[]) => unknown[]]>) {
  const statements: Array<{ text: string; values: unknown[] }> = [];
  const db = vi.fn((strings: unknown, ...values: unknown[]) => {
    if (!Array.isArray(strings) || !("raw" in (strings as object))) return strings;
    const text = templateText(strings);
    statements.push({ text, values });
    for (const [needle, handler] of handlers) if (text.includes(needle)) return Promise.resolve(handler(values));
    return Promise.resolve([]);
  });
  return { db: db as unknown as RegistryDb, statements };
}

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), { status: 200 });
}

function payloadOf(values: unknown[]): Array<Record<string, unknown>> {
  return JSON.parse(String(values.find((v) => typeof v === "string" && v.startsWith("["))));
}

function index(entries: Array<[string, Array<{ id: number; hc: string | null; assets: number }>]>): IdentityIndex {
  return {
    byName: new Map(
      entries.map(([key, list]) => [
        key,
        list.map((c) => ({ id: c.id, name: key, holdingCompanyRssd: c.hc, assetSize: c.assets, via: "institution_name" as const })),
      ]),
    ),
  };
}

describe("identity matching", () => {
  it("accepts a unique name and a single parent's largest bank, and holds shared names for review", () => {
    const idx = index([
      ["JPMORGAN CHASE", [{ id: 1, hc: "1039502", assets: 4_000_000_000 }]],
      ["CAPITAL ONE", [{ id: 2, hc: "2277860", assets: 400_000_000 }, { id: 3, hc: "2277860", assets: 30_000_000 }]],
      ["FIRST STATE", [{ id: 4, hc: null, assets: 100_000 }, { id: 5, hc: "999", assets: 200_000 }]],
    ]);
    expect(matchCompany("JPMORGAN CHASE & CO.", idx)).toMatchObject({ institutionId: 1, status: "accepted", method: "exact_name" });
    expect(matchCompany("CAPITAL ONE FINANCIAL CORPORATION", idx)).toMatchObject({
      institutionId: 2,
      status: "accepted",
      method: "holding_company_largest_bank",
    });
    expect(matchCompany("First State Bank", idx)).toMatchObject({ institutionId: 5, status: "needs_review", method: "ambiguous_name" });
    expect(matchCompany("Unknown Lender LLC", idx)).toBeNull();
  });
});

describe("registry CFPB worker", () => {
  it("links companies, sums breakdowns per institution, and replaces the year", async () => {
    const { db, statements } = createDb([
      [
        "FROM institution_sources\n     WHERE regulatory_status",
        () => [{ id: 7, institution_name: "JPMorgan Chase Bank, National Association", holding_company_name: "JPMORGAN CHASE&CO", holding_company_rssd: "1039502", asset_size: 4_000_000_000 }],
      ],
      ["FROM institution_identity_links", () => [{ external_key: "JPMORGAN CHASE & CO.", institution_id: 7 }]],
      ["INSERT INTO institution_complaint_records", (values) => payloadOf(values).map(() => ({}))],
    ]);
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(json({ aggregations: { company: { company: { buckets: [{ key: "JPMORGAN CHASE & CO.", doc_count: 24458 }, { key: "EQUIFAX, INC.", doc_count: 1 }] } } } }))
      .mockResolvedValueOnce(
        json({
          hits: { total: { value: 24458 } },
          aggregations: {
            product: { product: { buckets: [{ key: "Checking or savings account", doc_count: 8937 }, { key: "Credit card", doc_count: 5951 }] } },
            issue: { issue: { buckets: [{ key: "Managing an account", doc_count: 4957 }] } },
          },
        }),
      );

    const result = await runRegistryCfpb({ runId: 3, partitionKey: "2025", db, fetchOptions: { fetchImpl, backoffMs: 0 }, now: new Date("2026-10-03T00:00:00Z") });

    expect(result).toMatchObject({ companies: 2, acceptedCompanies: 1, institutions: 1, complaints: 24458, rowsWritten: 3 });
    const link = statements.find((s) => s.text.includes("INSERT INTO institution_identity_links"));
    expect(payloadOf(link!.values)[0]).toMatchObject({ institution_id: 7, external_key: "JPMORGAN CHASE & CO.", status: "accepted" });
    expect(statements.some((s) => s.text.includes("DELETE FROM institution_complaint_records"))).toBe(true);
    const insert = statements.find((s) => s.text.includes("INSERT INTO institution_complaint_records"));
    expect(payloadOf(insert!.values)).toEqual([
      { institution_id: 7, product: "Checking or savings account", issue: "_total", complaint_count: 8937 },
      { institution_id: 7, product: "Credit card", issue: "_total", complaint_count: 5951 },
      { institution_id: 7, product: "_all", issue: "Managing an account", complaint_count: 4957 },
    ]);
  });

  it("rejects a year outside the CFPB database", async () => {
    const { db } = createDb([]);
    await expect(runRegistryCfpb({ partitionKey: "2009", db })).rejects.toThrow("Invalid CFPB year");
  });
});

function ncuaZip(creditUnions: number) {
  const foicu = ["CU_NUMBER,CU_NAME,CITY,STATE,CU_TYPE"];
  const fs = ["CU_NUMBER,ACCT_010,ACCT_018,ACCT_025B,ACCT_661A"];
  for (let i = 1; i <= creditUnions; i += 1) {
    foicu.push(`${i},CU ${i},Town,TX,${i % 2 ? 1 : 2}`);
    fs.push(`${i},1000000,800000,600000,5000`);
  }
  return zipSync({ "FOICU.txt": strToU8(foicu.join("\n")), "FS220.txt": strToU8(fs.join("\n")) });
}

describe("registry NCUA worker", () => {
  it("upserts a historical quarter without touching the universe", async () => {
    const { db, statements } = createDb([["jsonb_to_recordset", () => [{ matched: 2, unmatched: 1 }]]]);
    const fetchImpl = vi.fn().mockResolvedValue(new Response(ncuaZip(3)));

    const result = await runRegistryNcuaFinancials({ runId: 9, partitionKey: "2018Q4", db, fetchOptions: { fetchImpl, backoffMs: 0 }, now: new Date("2026-10-03T00:00:00Z") });

    expect(String(fetchImpl.mock.calls[0][0])).toBe("https://ncua.gov/files/publications/analysis/call-report-data-2018-12.zip");
    expect(result).toMatchObject({ parsedRows: 3, matchedRows: 2, unmatchedRows: 1, universeSynced: false });
    expect(statements.some((s) => s.text.includes("INSERT INTO institution_sources"))).toBe(false);
    const upsert = statements.find((s) => s.text.includes("INSERT INTO institution_financial_records"));
    expect(payloadOf(upsert!.values)[0]).toMatchObject({ cert: "1", total_assets: 1000, net_income: 5, agent_run_id: 9 });
  });

  it("never deactivates credit unions from a suspiciously small FOICU list", async () => {
    const { db, statements } = createDb([["jsonb_to_recordset", () => [{ matched: 3, unmatched: 0 }]]]);
    const fetchImpl = vi.fn().mockResolvedValue(new Response(ncuaZip(3)));

    const result = await runRegistryNcuaFinancials({ partitionKey: "2026Q2", db, fetchOptions: { fetchImpl, backoffMs: 0 }, now: new Date("2026-10-03T00:00:00Z") });

    expect(result.universeSynced).toBe(false);
    expect(statements.some((s) => s.text.includes("regulatory_status = 'inactive'"))).toBe(false);
  });

  it("records an unpublished quarter as empty", async () => {
    const { db, statements } = createDb([]);
    const fetchImpl = vi.fn().mockResolvedValue(new Response("missing", { status: 404 }));

    const result = await runRegistryNcuaFinancials({ partitionKey: "2026Q3", db, fetchOptions: { fetchImpl, backoffMs: 0 } });

    expect(result.empty).toBe(true);
    const partition = statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"));
    expect(partition?.values).toEqual(expect.arrayContaining(["ncua-financials", "2026Q3", "empty"]));
  });
});

describe("registry SOD worker", () => {
  it("upserts one year of branches", async () => {
    const { db, statements } = createDb([["INSERT INTO institution_branch_deposits", (values) => payloadOf(values).map(() => ({ matched: true }))]]);
    const fetchImpl = vi.fn().mockResolvedValue(
      json({ meta: { total: 2 }, data: [{ data: { CERT: 628, YEAR: 2025, BRNUM: 0, BKMO: 1, DEPSUMBR: 0 } }, { data: { CERT: 628, YEAR: 2025, BRNUM: 1003, DEPSUMBR: 267588 } }] }),
    );

    const result = await runRegistryFdicSod({ runId: 4, partitionKey: "2025", db, fetchOptions: { fetchImpl, backoffMs: 0 } });

    const sodUrl = new URL(String(fetchImpl.mock.calls[0][0]));
    expect(sodUrl.searchParams.get("filters")).toBe("YEAR:2025");
    // The SOD index cannot sort on ID (HTTP 400); UNINUMBR is unique per branch, so paging is stable.
    expect(sodUrl.searchParams.get("sort_by")).toBe("UNINUMBR");
    expect(result).toMatchObject({ branches: 2, institutions: 1, upsertedBranches: 2, matchedBranches: 2, totalDeposits: 267588 });
    expect(statements.find((s) => s.text.includes("ON CONFLICT (cert, year, branch_number)"))).toBeDefined();
  });

  it("knows when the latest Summary of Deposits is published", () => {
    expect(latestSodYear(new Date("2026-08-15T00:00:00Z"))).toBe(2025);
    expect(latestSodYear(new Date("2026-10-03T00:00:00Z"))).toBe(2026);
  });
});

describe("registry SEC links worker", () => {
  it("links only filers whose SIC code is a bank", async () => {
    const { db, statements } = createDb([
      [
        "FROM institution_sources\n     WHERE regulatory_status",
        () => [{ id: 7, institution_name: "JPMorgan Chase Bank, National Association", holding_company_name: "JPMORGAN CHASE&CO", holding_company_rssd: "1039502", asset_size: 4_000_000_000 }],
      ],
      ["FROM institution_identity_links", () => [{ external_key: "19617", institution_id: 7 }]],
      ["UPDATE institution_sources s SET sec_cik", () => [{ id: 7 }, { id: 8 }]],
    ]);
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("company_tickers_exchange")) {
        return json({ fields: ["cik", "name", "ticker", "exchange"], data: [[19617, "JPMORGAN CHASE & CO", "JPM", "NYSE"], [1, "Chase Industries", "CHI", "OTC"]] });
      }
      return json({ cik: "19617", name: "JPMORGAN CHASE & CO", sic: "6021", filings: { recent: {} } });
    });

    const result = await runRegistrySecLinks({ db, fetchOptions: { fetchImpl: fetchImpl as unknown as typeof fetch, backoffMs: 0 }, pauseMs: 0 });

    expect(result).toMatchObject({ listedFilers: 2, nameMatches: 1, bankFilers: 1, acceptedLinks: 1, institutionsTagged: 2 });
    const link = statements.find((s) => s.text.includes("INSERT INTO institution_identity_links"));
    expect(payloadOf(link!.values)[0]).toMatchObject({ external_key: "19617", institution_id: 7, detail: { ticker: "JPM", exchange: "NYSE", sic: "6021" } });
    expect(cikBatch("19617")).toBe(19617 % 8);
  });
});

describe("registry Federal Reserve workers", () => {
  it("records a month with no Beige Book after a single request", async () => {
    const { db, statements } = createDb([]);
    const fetchImpl = vi.fn().mockResolvedValue(new Response("nope", { status: 404 }));

    const result = await runRegistryBeigeBook({ partitionKey: "202606", db, fetchOptions: { fetchImpl, backoffMs: 0 }, now: new Date("2026-10-03T00:00:00Z") });

    expect(result.empty).toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const partition = statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"));
    expect(partition?.values).toEqual(expect.arrayContaining(["beige-book", "202606", "empty"]));
    expect(beigeEmptyRetryHours("202606", new Date("2026-10-03T00:00:00Z"))).toBe(24 * 365);
    expect(beigeEmptyRetryHours("202610", new Date("2026-10-03T00:00:00Z"))).toBe(24 * 3);
  });

  it("refreshes FRED-native series and skips other loaders' series", async () => {
    const { db, statements } = createDb([
      [
        "FROM fed_economic_indicators",
        () => [
          { series_id: "UNRATE", series_title: "Unemployment", fed_district: null, units: "%", frequency: "Monthly" },
          { series_id: "NYFED_SOFR", series_title: "SOFR", fed_district: null, units: "%", frequency: "Daily" },
        ],
      ],
    ]);
    const fetchImpl = vi.fn().mockImplementation(async () => new Response("observation_date,X\n2026-08-01,4.2\n"));

    const result = await runRegistryFred({ db, fetchOptions: { fetchImpl, backoffMs: 0 } });

    // UNRATE plus the required series; the NY Fed series belongs to another loader.
    const expected = 1 + REQUIRED_FRED_SERIES.length;
    expect(fetchImpl).toHaveBeenCalledTimes(expected);
    expect(result).toMatchObject({ series: expected, refreshedSeries: expected, observations: expected });
    expect(statements.some((s) => s.text.includes("INSERT INTO fed_economic_indicators"))).toBe(true);
  });
});

describe("registry FRED worker: BLS and required series", () => {
  it("pulls BLS CPI series from the BLS API and seeds the GDP price index", async () => {
    const { db, statements } = createDb([
      [
        "FROM fed_economic_indicators",
        () => [{ series_id: "CUUR0000SEMC01", series_title: "CPI: Checking Account and Other Bank Services", fed_district: null, units: null, frequency: "Monthly" }],
      ],
    ]);
    const bls = {
      status: "REQUEST_SUCCEEDED",
      Results: { series: [{ seriesID: "CUUR0000SEMC01", data: [
        { year: "2026", period: "M08", value: "301.5" },
        { year: "2025", period: "M13", value: "290.0" },
      ] }] },
    };
    const fetchImpl = vi.fn().mockImplementation(async (url: string) =>
      url.includes("api.bls.gov")
        ? new Response(JSON.stringify(bls))
        : new Response("observation_date,GDPCTPI\n2026-04-01,128.4\n"),
    );

    const result = await runRegistryFred({ db, fetchOptions: { fetchImpl, backoffMs: 0 } });

    const urls = fetchImpl.mock.calls.map((call) => String(call[0]));
    expect(urls).toEqual(expect.arrayContaining([
      "https://api.bls.gov/publicAPI/v1/timeseries/data/",
      expect.stringContaining("fredgraph.csv?id=GDPCTPI"),
    ]));
    // A plain GET returns about 3 years; the POST asks for 7 so 5-year charts are complete.
    const blsCall = fetchImpl.mock.calls.find((call) => String(call[0]).includes("api.bls.gov"))!;
    const year = new Date().getUTCFullYear();
    expect(blsCall[1]).toMatchObject({ method: "POST" });
    expect(JSON.parse(String(blsCall[1].body))).toEqual({
      seriesid: ["CUUR0000SEMC01"],
      startyear: String(year - 6),
      endyear: String(year),
    });
    expect(result).toMatchObject({ series: 1 + REQUIRED_FRED_SERIES.length, missingSeries: [] });
    const inserts = statements.filter((s) => s.text.includes("INSERT INTO fed_economic_indicators"));
    expect(inserts.map((s) => s.values[0])).toEqual(expect.arrayContaining(["CUUR0000SEMC01", "GDPCTPI"]));
    const blsRows = payloadOf(inserts.find((s) => s.values[0] === "CUUR0000SEMC01")!.values);
    expect(blsRows).toEqual([{ observation_date: "2026-08-01", value: 301.5 }]);
  });
});

describe("required FRED series", () => {
  it("covers unemployment and payroll jobs for the 50 states and DC, tagged with their Fed district", () => {
    const ids = REQUIRED_FRED_SERIES.map((s) => s.series_id);
    expect(ids).toContain("GDPCTPI");
    expect(ids.filter((id) => /^[A-Z]{2}UR$/.test(id))).toHaveLength(51);
    expect(ids.filter((id) => /^[A-Z]{2}NA$/.test(id))).toHaveLength(51);
    expect(REQUIRED_FRED_SERIES.find((s) => s.series_id === "WYUR")).toMatchObject({ fed_district: 10, units: "Percent" });
    expect(REQUIRED_FRED_SERIES.find((s) => s.series_id === "DCNA")?.series_title).toBe("All Employees: Total Nonfarm in the District of Columbia");
  });
});

describe("registry regulator news worker", () => {
  const rss = `<rss><channel>
    <item><title>Agencies issue final rule on overdraft fee disclosures</title><link>https://example.gov/a</link><guid>a-1</guid><pubDate>Mon, 05 Oct 2026 14:00:00 GMT</pubDate></item>
    <item><title><![CDATA[Board announces meeting]]></title><link>https://example.gov/b</link></item>
  </channel></rss>`;

  it("stores new press releases with a topic and records the partition", async () => {
    const { db, statements } = createDb([["INSERT INTO reg_articles", () => [{ guid: "a-1" }]]]);
    const fetchImpl = vi.fn().mockResolvedValue(new Response(rss));

    const result = await runRegistryRegNews({ db, feeds: { FED: "https://example.gov/feed" }, fetchOptions: { fetchImpl, backoffMs: 0 } });

    expect(result).toMatchObject({ fetched: 2, inserted: 1, failedFeeds: [] });
    const rows = payloadOf(statements.find((s) => s.text.includes("INSERT INTO reg_articles"))!.values);
    expect(rows[0]).toMatchObject({ guid: "a-1", source: "FED", topic: "overdraft", published_at: "2026-10-05T14:00:00.000Z" });
    expect(rows[1]).toMatchObject({ guid: "https://example.gov/b", title: "Board announces meeting", published_at: null });
    const partition = statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"));
    expect(partition?.values).toEqual(expect.arrayContaining(["reg-news", "current", "succeeded"]));
  });

  it("fails the step when every feed fails", async () => {
    const { db } = createDb([]);
    const fetchImpl = vi.fn().mockResolvedValue(new Response("gone", { status: 404 }));
    await expect(
      runRegistryRegNews({ db, feeds: { OCC: "https://example.gov/occ" }, fetchOptions: { fetchImpl, backoffMs: 0 } }),
    ).rejects.toThrow("Every regulator feed failed");
  });
});

describe("registry state regulators worker", () => {
  it("upserts all 51 agencies and tags credit unions", async () => {
    const { db, statements } = createDb([["UPDATE institution_sources", () => [{ id: 1 }]]]);
    const result = await runRegistryStateRegulators({ db });
    expect(result).toMatchObject({ agencies: 51, creditUnionsTagged: 1 });
    expect(payloadOf(statements.find((s) => s.text.includes("INSERT INTO state_regulators"))!.values)).toHaveLength(51);
  });
});

describe("registry dispatch", () => {
  it("defines one unique registry-* step per source", () => {
    const keys = REGISTRY_SOURCES.map((s) => s.stepKey);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.every((key) => key.startsWith("registry-"))).toBe(true);
    expect(REGISTRY_SOURCES.map((s) => s.source)).toEqual([
      "fdic-universe",
      "fdic-financials",
      "ncua-financials",
      "fdic-sod",
      "ncua-branches",
      "ncua-branch-geocode",
      "cfpb",
      "sec-links",
      "sec-filings",
      "beige-book",
      "fred",
      "reg-news",
      "state-regulators",
      "enforcement",
    ]);
  });

  it("uses a fixed partition when the step has none and skips unknown steps", async () => {
    const { db } = createDb([["UPDATE institution_sources", () => []]]);
    const outcome = await runRegistryStep({ stepKey: "registry-state-regulators", runId: 1, dryRun: false, db });
    expect(outcome).toMatchObject({ status: "completed", detail: { registry_source: "state-regulators", partition_key: "current" } });
    await expect(runRegistryStep({ stepKey: "registry-nope", runId: 1, dryRun: false, db })).resolves.toMatchObject({ status: "skipped" });
    await expect(runRegistryStep({ stepKey: "registry-cfpb", runId: 1, dryRun: false, db })).resolves.toMatchObject({
      status: "skipped",
      detail: { missing_partition: true },
    });
  });
});
