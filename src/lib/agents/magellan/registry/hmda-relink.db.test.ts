// @vitest-environment node
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { fdicIdentityHoldFingerprint, type FdicIdentityHoldInput } from "@/lib/data-store/fdic-identity-holds";
import { JSON_TEXT_PASSTHROUGH } from "@/lib/data-store/connection";
import { runHmdaRelink } from "./hmda-relink";
import type { RegistryDb } from "./partitions";

// #2232: 2024 on has no Reporter Panel, so HMDA lenders are linked through GLEIF's registered LEIs.
const connection = process.env.E2E_DATABASE_URL;
const schema = `hmda_relink_${randomBytes(8).toString("hex")}`;
const A = "549300OSSFHX7ABQ2Y81";
const B = "5493001KJTIIGC8Y1R12";
const C = "254900B5PW4JPZAQI721";
const D = "549300T94GSH3C4U5M59";
const E = "5493003GQDUH26DNNH17";
const F = "5493006Y2YCT81BVTL57";
const G = "549300GXRG31CBWWTR70";
const H = "549300E0Q8JLIMURNH75";

function migrationFragment(file: string, from: string, until?: string): string {
  const migration = readFileSync(resolve("supabase/migrations", file), "utf8");
  const start = migration.indexOf(from);
  const end = until ? migration.indexOf(until, start) : migration.length;
  if (start < 0 || end < start) throw new Error(`Missing fixture schema in ${file}`);
  return migration.slice(start, end).replaceAll("public.", "");
}

describe.skipIf(!connection)("HMDA relink through canonical LEI links", () => {
  let db: postgres.Sql<{ json: unknown }>;
  const scope = () => db as unknown as RegistryDb;

  beforeAll(async () => {
    if (!connection || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Loopback PostgreSQL only");
    }
    db = postgres(connection, { ssl: false, max: 1, prepare: false, onnotice: () => undefined,
      connection: { search_path: schema }, types: { json: JSON_TEXT_PASSTHROUGH } });
    await db`CREATE SCHEMA ${db(schema)}`;
    await db`CREATE TABLE institution_sources (id bigint PRIMARY KEY, lei text, rssd_id text,
      source text, cert_number text, registry_synced_at timestamptz)`;
    await db.unsafe(migrationFragment("20270110000063_institution_lei_links.sql", "CREATE TABLE IF NOT EXISTS public.institution_lei_links"));
    await db.unsafe("DO $$ BEGIN\n  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;\n  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;\nEND $$;");
    await db.unsafe(migrationFragment("20270110000074_fdic_identity_conflict_holds.sql", "CREATE TABLE public.institution_identity_holds"));
    await db.unsafe(migrationFragment("20270110000058_public_data_loaders.sql", "CREATE TABLE IF NOT EXISTS public.hmda_lenders", "-- hmda_apor_rates:"));
    await db.unsafe(migrationFragment("20261003142709_regulatory_registry.sql", "CREATE TABLE IF NOT EXISTS public.registry_ingest_partitions", "CREATE INDEX IF NOT EXISTS registry_ingest_partitions_due_idx"));
  });

  beforeEach(async () => {
    await db`ALTER TABLE institution_identity_holds DISABLE TRIGGER USER`;
    try { await db`TRUNCATE institution_identity_holds RESTART IDENTITY`; }
    finally { await db`ALTER TABLE institution_identity_holds ENABLE TRIGGER USER`; }
    await db`TRUNCATE institution_sources, institution_lei_links, hmda_lenders,
      hmda_lender_originations, hmda_lender_loan_costs, registry_ingest_partitions RESTART IDENTITY CASCADE`;
    // 1: FDIC cert link. 2: NCUA charter link. 3: name+state only. 4: already linked lender.
    // 5: the lender (F) is shared by two institutions' links. 6: held by an FDIC identity conflict.
    await db`INSERT INTO institution_sources (id, source, cert_number) VALUES
      (1,'fdic','11'),(2,'ncua','22'),(3,'fdic','33'),(4,'fdic','44'),(5,'fdic','55'),(6,'ncua','66'),(7,'fdic','42'),(99,'fdic','990'),(8,'fdic','88')`;
    // 9: has an RSSD and no LEI link; lender H reports that RSSD.
    await db`INSERT INTO institution_sources (id, source, cert_number, rssd_id) VALUES (9,'fdic','99','777')`;
    await db`INSERT INTO institution_lei_links (institution_id, status, lei, match_basis, match_key) VALUES
      (1,'linked',${A},'fdic_cert','11'),(2,'linked',${B},'ncua_charter','22'),(3,'linked',${C},'name_state','NAME|TX'),
      (4,'linked',${D},'fdic_cert','44'),(5,'linked',${F},'fdic_cert','55'),(6,'linked',${F},'ncua_charter','66'),
      (7,'linked',${E},'fdic_cert','42'),(8,'linked',${G},'fdic_cert','88')`;
    await db`INSERT INTO hmda_lenders (activity_year, lei, institution_id, match_method, in_panel) VALUES
      (2025,${A},NULL,NULL,false),(2025,${B},NULL,NULL,false),(2025,${C},NULL,NULL,false),
      (2025,${D},99,'rssd',false),(2025,${F},NULL,NULL,false),(2025,${E},NULL,NULL,false),
      (2023,${A},NULL,NULL,true),(2024,${A},NULL,NULL,false)`;
    // G is a panel row (left to the panel loader); H matches only by RSSD.
    await db`INSERT INTO hmda_lenders (activity_year, lei, rssd_id, in_panel) VALUES (2025,${G},'88',true),(2025,${H},'777',false)`;
    for (const lei of [A, B, C, D]) {
      await db`INSERT INTO hmda_lender_originations (activity_year, lei, state_code, county_fips, msa_md, institution_id,
        originations, origination_amount, purchase_count, purchase_amount, refinance_count, refinance_amount)
        VALUES (2025, ${lei}, 'CA', '06037', '31080', ${lei === D ? 99 : null}, 1, 1, 1, 1, 0, 0),
               (2025, ${lei}, 'TX', '48201', '26420', ${lei === D ? 99 : null}, 1, 1, 1, 1, 0, 0)`;
      await db`INSERT INTO hmda_lender_loan_costs (activity_year, lei, state_code, msa_md, institution_id, originations,
        total_loan_costs_n, origination_charges_n, discount_points_n, lender_credits_n)
        VALUES (2025, ${lei}, 'CA', '31080', ${lei === D ? 99 : null}, 1, 1, 1, 1, 1)`;
    }
    await db`INSERT INTO hmda_lender_originations (activity_year, lei, state_code, county_fips, msa_md, originations,
      origination_amount, purchase_count, purchase_amount, refinance_count, refinance_amount)
      VALUES (2024, ${A}, 'CA', '06037', '31080', 1, 1, 1, 1, 0, 0)`;
    const hold: FdicIdentityHoldInput = { certificate: "42", institutionId: 7, reason: "stored_lei_conflict",
      storedLei: E, implicatedLeis: [E], reportedLeis: [E], ownerCertificates: ["42"], evidence: { reported_value: E } };
    await db`INSERT INTO institution_identity_holds (fingerprint,certificate,institution_id,reason,stored_lei,
      implicated_leis,reported_leis,owner_certificates,evidence,source_url,source_sha256,observed_at,agent_run_id)
      VALUES (${fdicIdentityHoldFingerprint(hold)},${hold.certificate},${hold.institutionId},${hold.reason},${hold.storedLei},
        ${hold.implicatedLeis},${hold.reportedLeis},${hold.ownerCertificates},${JSON.stringify(hold.evidence)}::jsonb,
        'https://api.fdic.gov/banks/institutions',${"b".repeat(64)},'2026-10-19T00:00:00Z',901)`;
  });

  afterAll(async () => {
    if (db) {
      await db`DROP SCHEMA IF EXISTS ${db(schema)} CASCADE`;
      await db.end();
    }
  });

  const links = async (year = 2025) => [...await db`SELECT lei, institution_id::int AS id, match_method FROM hmda_lenders
    WHERE activity_year = ${year} ORDER BY lei`];
  const cells = async () => [...await db`SELECT 'o' AS t, activity_year, lei, institution_id::int AS id FROM hmda_lender_originations
    UNION ALL SELECT 'c', activity_year, lei, institution_id::int FROM hmda_lender_loan_costs ORDER BY 1, 2, 3, 4`];

  it("off: counts what it would link, writes no HMDA row, and records the count", async () => {
    const before = JSON.stringify([await links(), await cells()]);
    const r = await runHmdaRelink({ partitionKey: "relink-2025", runId: 5, db: scope(), live: false });
    expect(r).toMatchObject({ live: false, wouldLink: 2, linked: 0, remaining: 2,
      byBasis: { fdic_cert: 1, ncua_charter: 1 } });
    // Six unlinked non-panel lenders: A and B link; C (name+state), F (shared), E (held) and H (RSSD only) don't.
    expect(r.unlinked).toBe(6);
    expect(r.kept).toEqual({ no_authoritative_identity: 1, shared_lei: 1, fdic_identity_hold: 1, not_by_lei_exact_respondent_rssd: 1 });
    expect(JSON.stringify([await links(), await cells()])).toBe(before);
    const [p] = await db`SELECT source, status, row_count, detail FROM registry_ingest_partitions WHERE partition_key = 'relink-2025'`;
    // Its own source: a relink success never counts as an HMDA download in freshness or source health.
    expect(p).toMatchObject({ source: "hmda-relink", status: "succeeded", row_count: 0 });
    expect(p.detail).toMatchObject({ relink: true, live: false, would_link: 2, parser_version: expect.any(Number) });
  });

  it("live with a small batch links part of the year and asks to run again in an hour", async () => {
    const r = await runHmdaRelink({ partitionKey: "relink-2025", runId: 5, db: scope(), live: true, batch: 1 });
    expect(r).toMatchObject({ linked: 1, remaining: 1 });
    const [p] = await db`SELECT next_attempt_after - updated_at < INTERVAL '2 hours' AS soon FROM registry_ingest_partitions
      WHERE partition_key = 'relink-2025'`;
    expect(p.soon).toBe(true);
    const rest = await runHmdaRelink({ partitionKey: "relink-2025", runId: 6, db: scope(), live: true, batch: 1 });
    expect(rest).toMatchObject({ linked: 1, remaining: 0 });
  });

  it("dry run writes nothing at all, not even the partition row", async () => {
    await runHmdaRelink({ partitionKey: "relink-2025", db: scope(), live: true, dryRun: true });
    expect(await db`SELECT 1 FROM registry_ingest_partitions`).toHaveLength(0);
    expect((await links()).filter((row) => row.id !== null)).toEqual([{ lei: D, id: 99, match_method: "rssd" }]);
  });

  it("live: fills by FDIC cert or NCUA charter only, copies to that year's cells, and leaves everything else", async () => {
    const r = await runHmdaRelink({ partitionKey: "relink-2025", runId: 5, db: scope(), live: true });
    expect(r).toMatchObject({ live: true, linked: 2, remaining: 0, propagatedOriginationRows: 4, propagatedCostRows: 2 });
    expect(await links()).toEqual([
      { lei: C, id: null, match_method: null }, // name+state is never identity
      { lei: E, id: null, match_method: null }, // held
      { lei: B, id: 2, match_method: "lei" },
      { lei: D, id: 99, match_method: "rssd" }, // an existing link is never changed
      { lei: F, id: null, match_method: null }, // two institutions claim it
      { lei: A, id: 1, match_method: "lei" },
      { lei: G, id: null, match_method: null }, // a panel row, though its LEI link is clean
      { lei: H, id: null, match_method: null }, // RSSD alone is not enough
    ].sort((x, y) => x.lei.localeCompare(y.lei)));
    const cellRows = await cells();
    expect(cellRows.filter((row) => row.activity_year === 2025 && row.lei === A).map((row) => row.id)).toEqual([1, 1, 1]);
    expect(cellRows.filter((row) => row.lei === D).map((row) => row.id)).toEqual([99, 99, 99]);
    expect(cellRows.filter((row) => row.lei === C).map((row) => row.id)).toEqual([null, null, null]);
    // Another year, and a panel year's row, are other partitions.
    expect(cellRows.find((row) => row.activity_year === 2024)?.id).toBeNull();
    expect(await links(2023)).toEqual([{ lei: A, id: null, match_method: null }]);
    const [p] = await db`SELECT row_count, detail FROM registry_ingest_partitions WHERE partition_key = 'relink-2025'`;
    expect(p).toMatchObject({ row_count: 2 });
    expect(p.detail).toMatchObject({ live: true, linked: 2, remaining: 0 });
    // A second run has nothing left to fill.
    const again = await runHmdaRelink({ partitionKey: "relink-2025", runId: 6, db: scope(), live: true });
    expect(again).toMatchObject({ unlinked: 4, wouldLink: 0, linked: 0 });
  });
});
