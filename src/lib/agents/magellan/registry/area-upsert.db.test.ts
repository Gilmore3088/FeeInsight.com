// @vitest-environment node
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { upsertAreaStats } from "./economy";
import type { RegistryDb } from "./partitions";
import type { AreaStat } from "@/lib/regulatory/economy";
import { JSON_TEXT_PASSTHROUGH } from "@/lib/data-store/connection";

// Nov 4, 2026: a refresh of identical values rewrote every row (573,910 updates, ~84 MB a week).
const url = process.env.E2E_DATABASE_URL;
describe.skipIf(!url)("area statistics upsert writes only changed rows", () => {
  let db: postgres.Sql<{ json: unknown }>;
  const schema = `area_upsert_${randomBytes(6).toString("hex")}`;
  const row = (value: number, raw: Record<string, unknown> = { v: 1 }): AreaStat => ({
    geo_type: "county", geo_code: "12073", geo_name: "Leon County", state_code: "FL",
    period: "2025", series_key: "median_income", value, unit: "usd", note: null, raw,
  });
  const state = () => db<{ value: number; agent_run_id: string; xmin: string }[]>`
    SELECT value, agent_run_id::text, xmin::text FROM area_statistics`;

  beforeAll(async () => {
    if (!url || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(url).hostname)) throw new Error("Loopback PostgreSQL only");
    db = postgres(url, { max: 1, onnotice: () => {}, connection: { search_path: schema }, types: { json: JSON_TEXT_PASSTHROUGH } });
    await db.unsafe(`CREATE SCHEMA ${schema}`);
    await db.unsafe(`CREATE TABLE ${schema}.area_statistics (
      id bigserial PRIMARY KEY, source text NOT NULL, geo_type text NOT NULL, geo_code text NOT NULL, geo_name text,
      state_code text, period text NOT NULL, series_key text NOT NULL, value double precision, unit text NOT NULL,
      note text, raw_json jsonb NOT NULL DEFAULT '{}', source_url text, agent_run_id bigint,
      fetched_at timestamptz NOT NULL DEFAULT now(), UNIQUE (source, geo_type, geo_code, period, series_key))`);
  });
  afterAll(async () => {
    if (db) { await db.unsafe(`DROP SCHEMA IF EXISTS ${schema} CASCADE`); await db.end(); }
  });

  it("leaves an identical row untouched and rewrites a changed one", async () => {
    const run = db as unknown as RegistryDb;
    expect(await upsertAreaStats(run, "census_acs", [row(50000)], "https://example.gov/acs", 1)).toBe(1);
    const [first] = await state();

    // Same values on the next refresh: nothing written, the row version is unchanged.
    expect(await upsertAreaStats(run, "census_acs", [row(50000)], "https://example.gov/acs", 2)).toBe(0);
    const [same] = await state();
    expect(same).toEqual(first);

    // A revised value, a changed raw record or a moved source URL are each rewritten.
    expect(await upsertAreaStats(run, "census_acs", [row(51000)], "https://example.gov/acs", 3)).toBe(1);
    expect((await state())[0]).toMatchObject({ value: 51000, agent_run_id: "3" });
    expect(await upsertAreaStats(run, "census_acs", [row(51000, { v: 2 })], "https://example.gov/acs", 4)).toBe(1);
    expect(await upsertAreaStats(run, "census_acs", [row(51000, { v: 2 })], "https://example.gov/acs/2025", 5)).toBe(1);
    expect((await state())[0]?.agent_run_id).toBe("5");
  });
});
