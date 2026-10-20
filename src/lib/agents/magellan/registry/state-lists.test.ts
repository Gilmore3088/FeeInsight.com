import { describe, expect, it, vi } from "vitest";

import { buildCountyNameIndex } from "@/lib/regulatory/state-lists";
import type { RegistryDb } from "./partitions";
import {
  countLenders,
  runRegistryStateDepositories,
  runRegistryStateLists,
  runRegistryStateNonbankLenders,
  runRegistryUrbanDebt,
  stateDepositoriesPartitions,
  stateListsPartitions,
  stateNonbankLendersPartitions,
  urbanDebtPartitions,
} from "./state-lists";

type Statement = { text: string; values: unknown[] };

function createDb(options: { stored?: number; counts?: unknown[] } = {}) {
  const statements: Statement[] = [];
  const db = vi.fn((strings: unknown, ...values: unknown[]) => {
    if (!Array.isArray(strings) || !("raw" in (strings as object))) return strings;
    const text = (strings as string[]).join(" ");
    statements.push({ text, values });
    if (text.includes("FROM institution_sources")) {
      return Promise.resolve([
        { id: 1, source: "fdic", cert_number: "628", ncua_charter_id: null, institution_name: "First Bank of Testing", state_code: "TX" },
        { id: 2, source: "fdic", cert_number: "700", ncua_charter_id: null, institution_name: "Sunshine Bank", state_code: "FL" },
      ]);
    }
    if (text.includes("COUNT(*)::int AS rows")) return Promise.resolve([{ rows: options.stored ?? 0 }]);
    if (text.includes("GROUP BY state, county_fips, license_category")) return Promise.resolve(options.counts ?? []);
    if (/INSERT INTO (state_public_depositories|state_nonbank_licensees|area_statistics)/.test(text)) {
      const payload = JSON.parse(values.find((v) => typeof v === "string" && v.startsWith("[")) as string);
      return Promise.resolve(payload.map(() => ({})));
    }
    return Promise.resolve([]);
  });
  return { db: db as unknown as RegistryDb, statements };
}

const partition = (statements: Statement[]) => {
  const insert = statements.find((s) => s.text.includes("INSERT INTO registry_ingest_partitions"));
  if (!insert) return null;
  return { status: insert.values[2], detail: JSON.parse(insert.values.find((v) => typeof v === "string" && v.startsWith("{")) as string) };
};

const fetchMap = (routes: Record<string, () => Response>) =>
  vi.fn(async (url: string) => {
    const hit = Object.keys(routes).find((k) => url.includes(k));
    return hit ? routes[hit]() : new Response("missing", { status: 404 });
  }) as unknown as typeof fetch;

describe("state-lists partitions", () => {
  it("lists no depository state, the configured datasets and one Urban partition", () => {
    const now = new Date("2026-10-17T00:00:00Z");
    expect(stateDepositoriesPartitions(now)).toEqual([]);
    expect(stateNonbankLendersPartitions(now, {})).toEqual([]);
    expect(stateNonbankLendersPartitions(now, { STATE_LENDER_DATASETS: '[{"state":"NY","domain":"data.ny.gov","dataset":"abcd-1234"}]' })).toEqual(["NY-abcd-1234"]);
    expect(urbanDebtPartitions(now)).toEqual(["current"]);
    expect(stateListsPartitions("nope", now)).toEqual([]);
  });
});

describe("state-public-depositories", () => {
  it("rejects a state with no wired list", async () => {
    await expect(runRegistryStateDepositories({ partitionKey: "TX", db: createDb().db })).rejects.toThrow(/Invalid state depository list/);
    // Florida's list was struck (DECISIONS.md "No non-commercial data").
    await expect(runRegistryStateDepositories({ partitionKey: "FL", db: createDb().db })).rejects.toThrow(/Invalid state depository list/);
  });
});

describe("state-nonbank-lenders", () => {
  const env = { STATE_LENDER_DATASETS: '[{"state":"NY","domain":"data.ny.gov","dataset":"abcd-1234"}]' };
  const counties = buildCountyNameIndex([{ fips: "36047", name: "Kings" }]);
  const meta = {
    name: "Check Cashers",
    rowsUpdatedAt: 1_790_000_000,
    columns: ["licensee_name", "license_type", "license_number", "address", "zip", "county", "license_status"].map((fieldName) => ({ fieldName })),
  };
  const rows = [
    { licensee_name: "Corner Check Cashing", license_type: "Check Casher", license_number: "1", address: "1 Main St", zip: "11201", county: "Kings", license_status: "Active" },
    { licensee_name: "Wire Co", license_type: "Money Transmitter", license_number: "2", county: "Atlantis", license_status: "Active" },
  ];

  it("records an unconfigured partition empty without fetching", async () => {
    const { db, statements } = createDb();
    const fetchImpl = vi.fn() as unknown as typeof fetch;
    const r = await runRegistryStateNonbankLenders({ partitionKey: "NY-zzzz-0000", db, env: {}, fetchOptions: { fetchImpl } });
    expect(r.empty).toBe(true);
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(partition(statements)!.status).toBe("empty");
  });

  it("refuses a dataset whose metadata has no licensee name", async () => {
    const { db } = createDb();
    const fetchImpl = fetchMap({ "/api/views/": () => Response.json({ columns: [{ fieldName: "foo" }] }) });
    const r = await runRegistryStateNonbankLenders({ partitionKey: "NY-abcd-1234", db, env, fetchOptions: { fetchImpl, backoffMs: 0 }, counties });
    expect(r).toMatchObject({ empty: true });
    expect(r.emptyReason).toMatch(/licensee name/);
  });

  it("writes licensees, prunes, then recounts the state into area_statistics", async () => {
    const { db, statements } = createDb({
      stored: 2,
      counts: [
        { state: "NY", county_fips: "36047", license_category: "check_casher", licensees: 1, with_status: 1 },
        { state: "NY", county_fips: null, license_category: "money_transmitter", licensees: 1, with_status: 1 },
      ],
    });
    const fetchImpl = fetchMap({ "/api/views/": () => Response.json(meta), "/resource/": () => Response.json(rows) });
    const r = await runRegistryStateNonbankLenders({ partitionKey: "NY-abcd-1234", db, env, fetchOptions: { fetchImpl, backoffMs: 0 }, counties });
    expect(r).toMatchObject({ records: 2, writtenRows: 2, areaRows: 3, empty: false });
    expect(statements.some((s) => s.text.includes("DELETE FROM state_nonbank_licensees"))).toBe(true);
    const p = partition(statements)!;
    expect(p.detail).toMatchObject({ period: "2026-09", period_basis: "rows_updated", by_category: { check_casher: 1, money_transmitter: 1 }, without_county: 1, county_unmatched: { Atlantis: 1 } });
    expect(p.detail.missing_fields).toEqual(["city", "licenseDate"]);
  });

  it("sends SOCRATA_APP_TOKEN as X-App-Token only when it is set", async () => {
    const tokens = async (extra: Record<string, string>) => {
      const seen: (string | undefined)[] = [];
      const routes = fetchMap({ "/api/views/": () => Response.json(meta), "/resource/": () => Response.json(rows) });
      const fetchImpl = vi.fn(async (url: string, init?: RequestInit) => {
        seen.push((init?.headers as Record<string, string> | undefined)?.["X-App-Token"]);
        return routes(url);
      }) as unknown as typeof fetch;
      await runRegistryStateNonbankLenders({ partitionKey: "NY-abcd-1234", db: createDb().db, env: { ...env, ...extra }, fetchOptions: { fetchImpl, backoffMs: 0 }, counties });
      return seen;
    };
    const withToken = await tokens({ SOCRATA_APP_TOKEN: " tok-123 " });
    expect(withToken.length).toBeGreaterThanOrEqual(2);
    expect(withToken.every((t) => t === "tok-123")).toBe(true);
    expect((await tokens({})).every((t) => t === undefined)).toBe(true);
  });

  it("counts active and status-less rows, never inactive ones", () => {
    const base = { state: "NY", dataset: "d", recordKey: "k", licenseeName: "x", dba: null, licenseType: "Check Casher", licenseCategory: "check_casher" as const, licenseNumber: null, address: null, city: null, zip: null, county: null, countyFips: "36047", countyBasis: null, status: null, licenseDate: null, raw: {} };
    expect(countLenders([{ ...base, active: true }, { ...base, active: null }, { ...base, active: false }])).toEqual([
      { state: "NY", county_fips: "36047", license_category: "check_casher", licensees: 2, with_status: 1 },
    ]);
  });
});

describe("urban-debt-in-america", () => {
  const page = `<p>License: Open Data Commons Attribution License</p><a href="/f/dia_county_2023.csv">c</a><a href="/f/dia_state_2023.csv">s</a>`;
  const county = 'County FIPS,County Name,"Share with any debt in collections, All"\n01001,Autauga,34%\n';
  const state = 'State,"Share with any debt in collections, All"\nAL,30%\n';
  const routes = {
    "debt-america-2023": () => new Response(page),
    "dia_county_2023.csv": () => new Response(county),
    "dia_state_2023.csv": () => new Response(state),
  };

  it("writes the rows with their attribution and records the licence text it found (ODC-By 1.0, released 2026-10-18)", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryStateLists({ source: "urban-debt-in-america", partitionKey: "current", db, env: {}, fetchOptions: { fetchImpl: fetchMap(routes), backoffMs: 0 } });
    expect(r).toMatchObject({ records: 2, writtenRows: 2 });
    const insert = statements.find((s) => s.text.includes("INSERT INTO area_statistics"));
    expect(insert).toBeTruthy();
    expect(JSON.stringify(insert!.values)).toContain("Braga et al., Debt in America, Urban Institute");
    const p = partition(statements)!;
    expect(p.status).toBe("succeeded");
    expect(p.detail.parser_version).toBe(2);
    expect(p.detail.license).toMatchObject({ name: "ODC-By 1.0", attribution: "Braga et al., Debt in America, Urban Institute" });
    expect(p.detail.license.text_found[0]).toMatch(/Open Data Commons Attribution License/);
  });

  it("writes nothing on a dry run", async () => {
    const { db, statements } = createDb();
    const r = await runRegistryUrbanDebt({ partitionKey: "current", db, env: {}, dryRun: true, fetchOptions: { fetchImpl: fetchMap(routes), backoffMs: 0 } });
    expect(r).toMatchObject({ records: 2, writtenRows: 0 });
    expect(statements.some((s) => s.text.includes("INSERT INTO area_statistics"))).toBe(false);
  });
});
