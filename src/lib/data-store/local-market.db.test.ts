// @vitest-environment node
/**
 * Executes getLocalMarketCompetitors against connection-local copies of the current schema: sister
 * charters that share one fee schedule carry their rule 7 representative (`counted_as`) and count
 * once, while every charter keeps its own row (#1441). The Laredo shape, with invented names,
 * addresses and amounts: no figure here is live data.
 */
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ db: null as postgres.Sql | null }));
vi.mock("./connection", () => ({
  sql: new Proxy(() => {}, {
    apply: (_target, _this, args) => Reflect.apply(state.db!, state.db, args),
    get: (_target, key) => {
      const value = Reflect.get(state.db!, key);
      return typeof value === "function" ? value.bind(state.db) : value;
    },
  }),
}));
import { getLocalMarketCompetitors } from "./local-market";
import { countedLocalCompetitors } from "@/lib/hamilton/report-exhibits";
import { countedAmounts } from "./counted-amounts";

const connection = process.env.E2E_DATABASE_URL;

describe.skipIf(!connection)("local market sister charters in PostgreSQL (#1441)", () => {
  let db: postgres.Sql;
  beforeAll(async () => {
    if (!connection || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(connection).hostname)) throw new Error("Local market SQL tests require an owned loopback database");
    db = postgres(connection, { max: 1, ssl: "require" });
    state.db = db;
    for (const table of ["institution_sources", "published_fee_catalog", "agent_source_texts", "institution_branch_deposits"]) {
      // Temporary copies shadow the real tables and view for this connection only; nothing persists.
      await db.unsafe(`CREATE TEMP TABLE ${table} AS SELECT * FROM public.${table} WITH NO DATA`);
    }
  });
  afterAll(async () => { if (db) await db.end(); state.db = null; });
  beforeEach(async () => {
    await db`TRUNCATE institution_sources, published_fee_catalog, agent_source_texts, institution_branch_deposits`;
    // 47 is the subject. 160, 1319 and 1769 are three charters of holding company 1001 that publish
    // one schedule at one address; 50, 51 and 52 each publish their own; 53 shares the address but
    // belongs to no holding company, so it counts as itself.
    await db`INSERT INTO institution_sources (id, institution_name, charter_type, holding_company_rssd) VALUES
      (47, 'Subject Bank', 'bank', NULL), (160, 'Sister Laredo', 'bank', '1001'), (1319, 'Sister Commerce', 'bank', '1001'),
      (1769, 'Sister Zapata', 'bank', '1001'), (50, 'Rival A', 'bank', '2002'), (51, 'Rival B', 'bank', NULL),
      (52, 'Rival C', 'bank', '3003'), (53, 'Rival D', 'bank', NULL)`;
    await db`INSERT INTO institution_branch_deposits (cert, institution_id, year, branch_number, county_fips, city, state, deposits) VALUES
      (9047, 47, 2026, 1, 48479, 'Laredo', 'TX', 500),
      (9160, 160, 2026, 1, 48479, 'Laredo', 'TX', 900), (9319, 1319, 2026, 1, 48479, 'Laredo', 'TX', 800),
      (9769, 1769, 2026, 1, 48479, 'Laredo', 'TX', 700), (9050, 50, 2026, 1, 48479, 'Laredo', 'TX', 600),
      (9051, 51, 2026, 1, 48479, 'Laredo', 'TX', 400), (9052, 52, 2026, 1, 48479, 'Laredo', 'TX', 300),
      (9053, 53, 2026, 1, 48479, 'Laredo', 'TX', 200)`;
    await db`INSERT INTO published_fee_catalog (id, fee_published_id, institution_id, fee_category, fee_name, amount, frequency, fee_audience, review_status, source_document_id, document_url, source_url, created_at) VALUES
      (1, 1, 160, 'nsf', 'NSF fee', 30, 'per_item', 'consumer', 'approved', 101, 'https://shared.example/fees.pdf', 'https://shared.example/fees.pdf', '2026-10-01'),
      (2, 2, 1319, 'nsf', 'NSF fee', 30, 'per_item', 'consumer', 'approved', 102, 'https://www.shared.example/fees.pdf', 'https://shared.example/fees.pdf', '2026-10-01'),
      (3, 3, 1769, 'nsf', 'NSF fee', 30, 'per_item', 'consumer', 'approved', 103, 'https://shared.example/fees.pdf/', 'https://shared.example/fees.pdf', '2026-10-01'),
      (4, 4, 50, 'nsf', 'NSF fee', 25, 'per_item', 'consumer', 'approved', 104, 'https://a.example/fees.pdf', 'https://a.example/fees.pdf', '2026-10-01'),
      (5, 5, 51, 'nsf', 'NSF fee', 35, 'per_item', 'consumer', 'approved', 105, 'https://b.example/fees.pdf', 'https://b.example/fees.pdf', '2026-10-01'),
      (6, 6, 52, 'nsf', 'NSF fee', 20, 'per_item', 'consumer', 'approved', 106, 'https://c.example/fees.pdf', 'https://c.example/fees.pdf', '2026-10-01'),
      (7, 7, 53, 'nsf', 'NSF fee', 40, 'per_item', 'consumer', 'approved', 107, 'https://shared.example/fees.pdf', 'https://shared.example/fees.pdf', '2026-10-01')`;
  });

  const read = () => getLocalMarketCompetitors({ institutionId: 47, certNumber: "9047", city: null, stateCode: null, categories: ["nsf"] });

  it("marks the sister charters under the lowest charter id and keeps every charter's row", async () => {
    const market = await read();
    expect(market?.competitors.map((c) => c.institution_id)).toEqual([160, 1319, 1769, 50, 51, 52, 53]);
    const countedAs = Object.fromEntries(market!.competitors.map((c) => [c.institution_id, c.counted_as?.nsf ?? null]));
    expect(countedAs).toEqual({ 160: null, 1319: 160, 1769: 160, 50: null, 51: null, 52: null, 53: null });
  });

  it("counts seven charters as five institutions, with one amount for the shared schedule", async () => {
    const market = (await read())!;
    expect(countedLocalCompetitors(market)).toBe(5);
    const amounts = countedAmounts(market.competitors.map((c) => ({ institutionId: c.institution_id, amount: c.fees.nsf, countedAs: c.counted_as?.nsf })));
    expect(amounts).toEqual([20, 25, 30, 35, 40]);
  });
});
