/** Real PostgreSQL syntax/selection checks in a loopback-only, temporary-table connection. */
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getPeerListRows, getPeerListSubject } from "./hamilton-peer-list";
import { parsePeerListQuestion, planPeerList, type PeerListCriteria, type PeerListSubject } from "@/lib/hamilton/peer-list";

const connection = process.env.E2E_DATABASE_URL;
describe.skipIf(!connection)("peer list SQL in isolated PostgreSQL", () => {
  let db: ReturnType<typeof postgres>;
  const subject: PeerListSubject = { institutionId: 101, name: "Home CU", charterType: "credit_union", city: "Orlando", stateCode: "FL", totalAssetsUsd: 10_000_000_000, reportDate: "2026-06-30", source: "ncua", sourceUrl: null, recordId: 1 };
  function criteria(question: string): PeerListCriteria {
    const intent = parsePeerListQuestion(question);
    if (!intent) throw new Error("Invalid test request");
    const result = planPeerList(intent, subject, null);
    if (!result.criteria) throw new Error(result.problem ?? "No criteria");
    return result.criteria;
  }
  const query = (c: PeerListCriteria) => getPeerListRows(101, c, "2026-10-10", db as unknown as NonNullable<Parameters<typeof getPeerListRows>[3]>);
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) throw new Error("Peer SQL tests require a loopback E2E database; production connections are forbidden");
    db = postgres(connection, { max: 1, ssl: "require" });
    await db`CREATE TEMP TABLE institution_sources (id bigint PRIMARY KEY, institution_name text NOT NULL, charter_type text, city text, state_code text, asset_size_tier text, fed_district int)`;
    await db`CREATE TEMP TABLE institution_financial_records (id bigint PRIMARY KEY, institution_id bigint, total_assets numeric, report_date text, source text, source_url text, fetched_at timestamptz)`;
    await db`CREATE TEMP TABLE published_fee_catalog (id bigint, institution_id bigint)`;
    await db`CREATE TEMP TABLE published_fee_rate_catalog (id bigint, institution_id bigint)`;
  });
  afterAll(async () => { if (db) await db.end(); });
  beforeEach(async () => {
    await db`TRUNCATE institution_sources, institution_financial_records, published_fee_catalog, published_fee_rate_catalog`;
    await db`INSERT INTO institution_sources (id, institution_name, charter_type, city, state_code, asset_size_tier, fed_district) VALUES
      (101, 'Home CU', 'credit_union', 'Orlando', 'FL', 'regional', 6),
      (202, 'Eight CU', 'credit_union', 'Tampa', 'FL', 'community_large', 6),
      (203, 'Twelve CU', 'credit_union', 'Miami', 'FL', 'regional', 6),
      (204, 'Missing CU', 'credit_union', 'Miami', 'FL', 'community_large', 6),
      (205, 'Bank Twenty', 'bank', 'Miami', 'FL', 'regional', 6),
      (206, 'Two CU', 'credit_union', 'Atlanta', 'GA', 'community_large', 6),
      (207, 'Five CU', 'credit_union', 'Tampa', 'FL', 'community_large', 6),
      (208, 'Twenty CU', 'credit_union', 'Miami', 'FL', 'regional', 6),
      (209, 'Twenty Five CU', 'credit_union', 'Miami', 'FL', 'regional', 6),
      (210, 'Hundred CU', 'credit_union', 'Atlanta', 'GA', 'large_regional', 6)`;
    // Same storage units as the current canonical importers: USD thousands.
    await db`INSERT INTO institution_financial_records (id, institution_id, total_assets, report_date, source, source_url, fetched_at) VALUES
      (1,101,10000000,'2026-06-30','ncua','https://ncua.gov/data','2026-08-01'),
      (2,202,8000000,'2026-06-30','ncua','https://ncua.gov/data','2026-08-01'),
      (3,203,12000000,'2026-03-31','ncua','https://ncua.gov/data','2026-05-01'),
      (4,204,NULL,'2026-06-30','ncua','https://ncua.gov/data','2026-08-01'),
      (5,205,20000000,'2026-06-30','fdic','https://api.fdic.gov/data','2026-08-01'),
      (6,206,2000000,'2026-06-30','ncua',NULL,'2026-08-01'),
      (7,207,5000000,'2026-06-30','ncua',NULL,'2026-08-01'),
      (8,208,20000000,'2026-06-30','ncua',NULL,'2026-08-01'),
      (9,209,25000000,'2026-06-30','ncua',NULL,'2026-08-01'),
      (10,210,100000000,'2026-06-30','ncua',NULL,'2026-08-01')`;
  });
  it("executes the actual query and ranks proportionally closest assets, excluding the subject", async () => {
    const found = await query(criteria("List ten peers"));
    expect(found.totalMatches).toBe(4); expect(found.rows.map(r => r.institutionId).slice(0,2)).toEqual([203,202]);
    expect(found.rows.some(r => r.institutionId === 101)).toBe(false);
  });
  it("keeps missing fee coverage and includes rate-only coverage without multiplying rows", async () => {
    await db`INSERT INTO published_fee_catalog VALUES (1,202),(2,202)`;
    await db`INSERT INTO published_fee_rate_catalog VALUES (3,203)`;
    const found = await query(criteria("List ten peers"));
    expect(found.totalMatches).toBe(4);
    expect(found.rows.find(r => r.institutionId === 202)?.feeCoverage).toBe("available");
    expect(found.rows.find(r => r.institutionId === 203)?.feeCoverage).toBe("available");
    expect(found.rows.find(r => r.institutionId === 207)?.feeCoverage).toBe("not_found");
  });
  it("selects the latest eligible filing for the correct regulator, not an old or future value", async () => {
    await db`INSERT INTO institution_financial_records (id,institution_id,total_assets,report_date,source,fetched_at) VALUES
      (21,202,100000000,'2025-12-31','ncua','2026-01-01'),
      (22,202,90000000,'2027-03-31','ncua','2027-04-01'),
      (23,202,999000000,'2026-09-30','fdic','2026-10-01')`;
    const found = await query(criteria("List ten peers"));
    expect(found.rows.find(r => r.institutionId === 202)?.totalAssetsUsd).toBe(8_000_000_000);
    expect(found.rows.find(r => r.institutionId === 202)?.reportDate).toBe("2026-06-30");
  });
  it("does not fill a missing latest asset value from an older record", async () => {
    await db`INSERT INTO institution_financial_records (id,institution_id,total_assets,report_date,source,fetched_at) VALUES (24,204,8000000,'2025-12-31','ncua','2026-01-01')`;
    const c = { ...criteria("List ten peers"), basis: "saved_peer_set" as const, institutionIds: [202,204], minAssets: null, maxAssets: null, requiresAssets: false, sort: "name" as const, referenceAssetsUsd: null };
    const found = await query(c);
    expect(found.totalMatches).toBe(2); expect(found.rows.find(r => r.institutionId === 204)?.totalAssetsUsd).toBeNull();
    expect((await query(criteria("List ten peers"))).rows.some(r => r.institutionId === 204)).toBe(false);
  });
  it("honors strict lower and upper boundaries", async () => {
    const found = await query(criteria("List credit unions above $5B and under $20B"));
    expect(found.rows.map(r => r.institutionId)).toEqual([202,203]);
  });
  it("applies state/type filters and returns the full eligible count with a limited page", async () => {
    const found = await query(criteria("List 2 largest credit unions"));
    expect(found.totalMatches).toBe(7); expect(found.rows.map(r => r.institutionId)).toEqual([210,209]);
    const florida = await query(criteria("List banks in Florida"));
    expect(florida.rows.map(r => r.institutionId)).toEqual([205]);
    expect(florida.rows[0].source).toBe("fdic");
    expect(florida.rows[0].totalAssetsUsd).toBe(20_000_000_000);
  });
  it("converts stored thousands once for subject and list dollar contracts", async () => {
    const found = await getPeerListSubject(101, "2026-10-10", db as unknown as NonNullable<Parameters<typeof getPeerListSubject>[2]>);
    expect(found?.totalAssetsUsd).toBe(10_000_000_000); expect(found?.reportDate).toBe("2026-06-30");
    const raw = await db`SELECT total_assets FROM institution_financial_records WHERE institution_id = 101`;
    expect(Number(raw[0].total_assets)).toBe(10_000_000);
  });
  it("keeps empty results honest rather than dropping constraints", async () => {
    const found = await query(criteria("List banks in California"));
    expect(found).toEqual({ rows: [], totalMatches: 0 });
  });
});
