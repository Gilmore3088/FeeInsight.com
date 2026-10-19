// @vitest-environment node
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { strToU8, zipSync } from "fflate";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { JSON_TEXT_PASSTHROUGH } from "@/lib/data-store/connection";
import { runRegistryHmda } from "./hmda";
import type { RegistryDb } from "./partitions";
import { lockHmdaYear } from "./hmda-lock";

const release = vi.hoisted(() => ({ HMDA_ORDINARY_IDENTITY_WRITES_ENABLED: true }));
vi.mock("@/lib/agents/hoovie/hmda-repair-release", () => release);

const connection = process.env.HMDA_IDENTITY_TEST_DATABASE_URL ?? process.env.E2E_DATABASE_URL;
const schema = `hmda_identity_${randomBytes(8).toString("hex")}`;
const A = "549300OSSFHX7ABQ2Y81";
const B = "5493001KJTIIGC8Y1R12";
const C = "254900B5PW4JPZAQI721";
const D = "549300T94GSH3C4U5M59";
const E = "5493003GQDUH26DNNH17";

/** The fixture uses the real constraints, types and conflict targets, in its own schema. */
function migrationFragment(file: string, from: string, until?: string): string {
  const migration = readFileSync(resolve("supabase/migrations", file), "utf8");
  const start = migration.indexOf(from);
  const end = until ? migration.indexOf(until, start) : migration.length;
  if (start < 0 || end < start) throw new Error(`Missing identity fixture schema in ${file}`);
  return migration.slice(start, end).replaceAll("public.", "");
}

interface Loan {
  lei: string;
  county?: string;
  msa?: string;
  amount?: number;
}

describe.skipIf(!connection)("HMDA canonical identity in isolated PostgreSQL", () => {
  let db: postgres.Sql;

  beforeAll(async () => {
    if (!connection || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("HMDA identity SQL tests require a loopback fixture");
    }
    db = postgres(connection, { ssl: false, max: 1, prepare: false, onnotice: () => undefined,
      connection: { search_path: schema }, types: { json: JSON_TEXT_PASSTHROUGH } });
    await db`CREATE SCHEMA ${db(schema)}`;
    await db`CREATE TABLE institution_sources (id bigint PRIMARY KEY, lei text, rssd_id text,
      source text, cert_number text, registry_synced_at timestamptz)`;
    await db.unsafe(migrationFragment("20270110000063_institution_lei_links.sql", "CREATE TABLE IF NOT EXISTS public.institution_lei_links"));
    await db.unsafe(migrationFragment("20270110000058_public_data_loaders.sql", "CREATE TABLE IF NOT EXISTS public.hmda_lenders", "-- hmda_apor_rates:"));
    await db.unsafe(migrationFragment("20261003142709_regulatory_registry.sql", "CREATE TABLE IF NOT EXISTS public.registry_ingest_partitions", "CREATE INDEX IF NOT EXISTS registry_ingest_partitions_due_idx"));
  });

  beforeEach(async () => {
    release.HMDA_ORDINARY_IDENTITY_WRITES_ENABLED = true;
    await db`TRUNCATE institution_sources, institution_lei_links, hmda_lenders,
      hmda_lender_originations, hmda_lender_loan_costs, registry_ingest_partitions RESTART IDENTITY CASCADE`;
  });

  afterAll(async () => {
    if (db) {
      await db`DROP SCHEMA IF EXISTS ${db(schema)} CASCADE`;
      await db.end();
    }
  });

  function fixtureFetch(year: number, state: string, loans: Loan[], panel: Array<{ lei: string; rssd: string; parent?: string; holder?: string }> = []) {
    const csv = [
      "activity_year,lei,derived_msa-md,state_code,county_code,action_taken,loan_purpose,loan_amount,total_loan_costs,origination_charges,discount_points,lender_credits",
      ...loans.map((loan) => `${year},${loan.lei},${loan.msa ?? "31080"},${state},${loan.county ?? "06037"},1,1,${loan.amount ?? 205000},5000,1200,0,0`),
    ].join("\n");
    return vi.fn(async (input: unknown) => {
      const url = String(input);
      if (url.includes("/csv?")) return new Response(csv, { status: 200 });
      if (url.includes("/aggregations?")) return new Response(JSON.stringify({ aggregations: [{
        count: loans.length, sum: loans.reduce((sum, loan) => sum + (loan.amount ?? 205000), 0),
      }] }), { status: 200 });
      if (url.includes("public_panel")) {
        const panelCsv = ["lei,id_rssd,respondent_name,parent_rssd,top_holder_rssd", ...panel.map((row) =>
          `${row.lei},${row.rssd},Filer,${row.parent ?? ""},${row.holder ?? ""}`)].join("\n");
        const zip = zipSync({ "panel.csv": strToU8(panelCsv) });
        return new Response(zip as unknown as BodyInit, { status: 200 });
      }
      throw new Error(`Unexpected fixture request: ${url}`);
    });
  }

  async function run(input: { year?: number; state?: string; loans: Loan[]; panel?: Array<{ lei: string; rssd: string; parent?: string; holder?: string }>; dryRun?: boolean; database?: RegistryDb }) {
    const year = input.year ?? 2025;
    const state = input.state ?? "CA";
    const fetchImpl = fixtureFetch(year, state, input.loans, input.panel);
    const result = await runRegistryHmda({ partitionKey: `${year}-${state}`, runId: 123, dryRun: input.dryRun,
      db: input.database ?? db as unknown as RegistryDb, fetchOptions: { fetchImpl, backoffMs: 0 } });
    return { result, fetchImpl };
  }

  async function identities() {
    const lenders = await db`SELECT lei, institution_id::int AS institution_id, match_method,
      raw_json->'feeinsight_identity'->>'reason' AS reason FROM hmda_lenders ORDER BY lei`;
    const originations = await db`SELECT lei, institution_id::int AS institution_id FROM hmda_lender_originations ORDER BY lei, id`;
    const costs = await db`SELECT lei, institution_id::int AS institution_id FROM hmda_lender_loan_costs ORDER BY lei, id`;
    return { lenders: [...lenders], originations: [...originations], costs: [...costs] };
  }

  async function snapshot() {
    return JSON.stringify({
      institutions: [...await db`SELECT * FROM institution_sources ORDER BY id`],
      links: [...await db`SELECT * FROM institution_lei_links ORDER BY institution_id`],
      lenders: [...await db`SELECT * FROM hmda_lenders ORDER BY activity_year, lei`],
      originations: [...await db`SELECT * FROM hmda_lender_originations ORDER BY id`],
      costs: [...await db`SELECT * FROM hmda_lender_loan_costs ORDER BY id`],
      partitions: [...await db`SELECT * FROM registry_ingest_partitions ORDER BY source, partition_key`],
    });
  }

  it("propagates a normalized own LEI to every written county and metro cell without touching another partition", async () => {
    await db`INSERT INTO institution_sources (id, lei, source, cert_number, registry_synced_at)
      VALUES (11, ${` ${A.toLowerCase()} `}, 'fdic', '11', '2026-10-19T00:00:00Z'), (12, ${B}, 'fdic', '12', NULL)`;
    await run({ year: 2024, state: "MD", loans: [{ lei: A }] });
    await run({ state: "MD", loans: [{ lei: A }] });
    const outsideBefore = JSON.stringify({
      originations: [...await db`SELECT * FROM hmda_lender_originations WHERE state_code = 'MD' ORDER BY id`],
      costs: [...await db`SELECT * FROM hmda_lender_loan_costs WHERE state_code = 'MD' ORDER BY id`],
    });
    const { result, fetchImpl } = await run({ loans: [
      { lei: A }, { lei: A, county: "06059" }, { lei: A, county: "06075", msa: "41860" }, { lei: B },
    ] });
    expect(result).toMatchObject({ matchedLenders: 2, unmatchedLenders: 0,
      writtenOriginationRows: 4, writtenCostRows: 3, matching: { matched: 2, ambiguous: 0, unmatched: 0 } });
    expect(fetchImpl.mock.calls.every(([url]) => !String(url).includes("public_panel"))).toBe(true);
    const rows = await db`SELECT lei, institution_id::int AS institution_id FROM hmda_lender_originations WHERE activity_year = 2025 AND state_code = 'CA' ORDER BY lei, id`;
    expect([...rows]).toEqual([{ lei: B, institution_id: 12 }, ...Array.from({ length: 3 }, () => ({ lei: A, institution_id: 11 }))]);
    const costs = await db`SELECT lei, institution_id::int AS institution_id FROM hmda_lender_loan_costs WHERE activity_year = 2025 AND state_code = 'CA' ORDER BY lei, id`;
    expect([...costs]).toEqual([{ lei: B, institution_id: 12 }, { lei: A, institution_id: 11 }, { lei: A, institution_id: 11 }]);
    expect(JSON.stringify({
      originations: [...await db`SELECT * FROM hmda_lender_originations WHERE state_code = 'MD' ORDER BY id`],
      costs: [...await db`SELECT * FROM hmda_lender_loan_costs WHERE state_code = 'MD' ORDER BY id`],
    })).toBe(outsideBefore);
    const [receipt] = await db`SELECT matched_count, detail FROM registry_ingest_partitions WHERE partition_key = '2025-CA'`;
    expect(receipt.matched_count).toBe(2);
    expect(receipt.detail.matching).toMatchObject({ matched: 2, ambiguous: 0, unmatched: 0 });
    const [lender] = await db`SELECT raw_json FROM hmda_lenders WHERE activity_year = 2025 AND lei = ${A}`;
    expect(lender.raw_json.feeinsight_identity.evidence).toContainEqual(expect.objectContaining({
      institutionId: 11, kind: "institution_lei", source: "fdic", certNumber: "11", registrySyncedAt: "2026-10-19T00:00:00.000Z",
    }));
  });

  it("accepts key-backed canonical links and leaves a name/state-only link unmatched", async () => {
    const leis = [A, B, C, D, E];
    const bases = ["own_lei", "rssd", "fdic_cert", "ncua_charter", "name_state"];
    for (let index = 0; index < leis.length; index += 1) {
      await db`INSERT INTO institution_sources (id) VALUES (${index + 1})`;
      await db`INSERT INTO institution_lei_links (institution_id, status, lei, match_basis, source_url, checked_at, match_key)
        VALUES (${index + 1}, 'linked', ${leis[index]}, ${bases[index]}, 'https://api.gleif.org/api/v1/lei-records',
          '2026-10-19T00:00:00Z', ${String(index + 100)})`;
    }
    const { result } = await run({ loans: leis.map((lei) => ({ lei })) });
    expect(result.matching).toMatchObject({ matched: 4, unmatched: 1, ambiguous: 0 });
    const rows = await identities();
    for (const table of [rows.lenders, rows.originations, rows.costs]) {
      for (const [index, lei] of leis.entries()) {
        expect(table.find((row) => row.lei === lei)?.institution_id).toBe(index < 4 ? index + 1 : null);
      }
    }
    expect(rows.lenders.find((row) => row.lei === E)).toMatchObject({ match_method: null, reason: "no_authoritative_identity" });
    const [lender] = await db`SELECT raw_json FROM hmda_lenders WHERE lei = ${C}`;
    expect(lender.raw_json.feeinsight_identity.evidence).toContainEqual(expect.objectContaining({
      institutionId: 3, kind: "canonical_lei_link", linkBasis: "fdic_cert", linkKey: "102",
      sourceUrl: "https://api.gleif.org/api/v1/lei-records", checkedAt: "2026-10-19T00:00:00.000Z",
    }));
  });

  it("updates and clears an annual identity across states while preserving all source facts and unrelated identities", async () => {
    await db`INSERT INTO institution_sources (id, lei) VALUES (1, ${A}), (2, ${B})`;
    await run({ year: 2024, state: "MD", loans: [{ lei: A }] });
    await run({ state: "MD", loans: [{ lei: A }, { lei: B }] });
    const untouchedBefore = JSON.stringify({
      originations: [...await db`SELECT * FROM hmda_lender_originations WHERE activity_year = 2024 OR lei = ${B} ORDER BY id`],
      costs: [...await db`SELECT * FROM hmda_lender_loan_costs WHERE activity_year = 2024 OR lei = ${B} ORDER BY id`],
      lenders: [...await db`SELECT * FROM hmda_lenders WHERE activity_year = 2024 OR lei = ${B} ORDER BY activity_year, lei`],
    });
    const mdFacts = async () => JSON.stringify({
      originations: [...await db`SELECT to_jsonb(c) - 'institution_id' AS facts FROM hmda_lender_originations c
        WHERE activity_year = 2025 AND state_code = 'MD' AND lei = ${A} ORDER BY id`],
      costs: [...await db`SELECT to_jsonb(c) - 'institution_id' AS facts FROM hmda_lender_loan_costs c
        WHERE activity_year = 2025 AND state_code = 'MD' AND lei = ${A} ORDER BY id`],
    });
    const factsBefore = await mdFacts();
    await db`UPDATE institution_sources SET lei = NULL WHERE id = 1`;
    await db`INSERT INTO institution_sources (id, lei) VALUES (3, ${A})`;
    const changed = await run({ loans: [{ lei: A }] });
    expect(changed.result).toMatchObject({ matchedLenders: 1, propagatedOriginationRows: 1, propagatedCostRows: 1 });
    expect((await db`SELECT institution_id::int AS institution_id FROM hmda_lender_originations
      WHERE activity_year = 2025 AND state_code = 'MD' AND lei = ${A}`)[0].institution_id).toBe(3);
    expect(await mdFacts()).toBe(factsBefore);

    await db`UPDATE institution_sources SET lei = NULL WHERE id = 3`;
    const cleared = await run({ state: "NY", loans: [{ lei: A }] });
    expect(cleared.result).toMatchObject({ matchedLenders: 0, propagatedOriginationRows: 2, propagatedCostRows: 2 });
    for (const table of ["hmda_lender_originations", "hmda_lender_loan_costs"]) {
      const rows = await db`SELECT institution_id FROM ${db(table)} WHERE activity_year = 2025 AND lei = ${A}`;
      expect(rows).toHaveLength(3);
      expect(rows.every((row) => row.institution_id === null)).toBe(true);
    }
    expect(await mdFacts()).toBe(factsBefore);
    expect(JSON.stringify({
      originations: [...await db`SELECT * FROM hmda_lender_originations WHERE activity_year = 2024 OR lei = ${B} ORDER BY id`],
      costs: [...await db`SELECT * FROM hmda_lender_loan_costs WHERE activity_year = 2024 OR lei = ${B} ORDER BY id`],
      lenders: [...await db`SELECT * FROM hmda_lenders WHERE activity_year = 2024 OR lei = ${B} ORDER BY activity_year, lei`],
    })).toBe(untouchedBefore);
    const [receipt] = await db`SELECT detail FROM registry_ingest_partitions WHERE partition_key = '2025-NY'`;
    expect(receipt.detail).toMatchObject({ propagated_origination_rows: 2, propagated_cost_rows: 2 });
  });

  it("rolls back annual lender and all-state origination changes when cost identity propagation fails", async () => {
    await db`INSERT INTO institution_sources (id, lei) VALUES (1, ${A})`;
    await run({ state: "MD", loans: [{ lei: A }] });
    await db`UPDATE institution_sources SET lei = NULL WHERE id = 1`;
    await db`INSERT INTO institution_sources (id, lei) VALUES (2, ${A})`;
    const before = await snapshot();
    await db.unsafe(`CREATE FUNCTION reject_cost_identity_update() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'fixture cost propagation failure'; END $$`);
    await db.unsafe(`CREATE TRIGGER reject_cost_identity_update BEFORE UPDATE ON hmda_lender_loan_costs
      FOR EACH ROW EXECUTE FUNCTION reject_cost_identity_update()`);
    try {
      await expect(run({ loans: [{ lei: A }] })).rejects.toThrow("fixture cost propagation failure");
    } finally {
      await db.unsafe("DROP TRIGGER reject_cost_identity_update ON hmda_lender_loan_costs");
      await db.unsafe("DROP FUNCTION reject_cost_identity_update()");
    }
    expect(await snapshot()).toBe(before);
  });

  it("preserves reviewed annual identities while ordinary rollout is disabled and leaves new annual rows unlinked", async () => {
    await db`INSERT INTO institution_sources (id, lei) VALUES (1, ${A}), (2, ${B}), (3, NULL)`;
    await run({ loans: [{ lei: A }] });
    const [before] = await db`SELECT institution_id, match_method, raw_json->'feeinsight_identity' AS identity
      FROM hmda_lenders WHERE activity_year = 2025 AND lei = ${A}`;
    await db`UPDATE institution_sources SET lei = NULL WHERE id = 1`;
    await db`UPDATE institution_sources SET lei = ${A} WHERE id = 3`;
    release.HMDA_ORDINARY_IDENTITY_WRITES_ENABLED = false;
    const { result } = await run({ state: "MD", loans: [{ lei: A }, { lei: B }] });
    expect(result).toMatchObject({ matchedLenders: 1, unmatchedLenders: 1,
      propagatedOriginationRows: 0, propagatedCostRows: 0, matching: { matched: 2 } });
    const [after] = await db`SELECT institution_id, match_method, raw_json->'feeinsight_identity' AS identity
      FROM hmda_lenders WHERE activity_year = 2025 AND lei = ${A}`;
    expect(after).toEqual(before);
    const [newLender] = await db`SELECT institution_id, match_method, raw_json FROM hmda_lenders WHERE lei = ${B}`;
    expect(newLender).toEqual({ institution_id: null, match_method: null, raw_json: {} });
    const rows = await identities();
    for (const table of [rows.originations, rows.costs]) {
      expect(table.filter((row) => row.lei === A).every((row) => Number(row.institution_id) === 1)).toBe(true);
      expect(table.find((row) => row.lei === B)?.institution_id).toBeNull();
    }
    const [receipt] = await db`SELECT detail FROM registry_ingest_partitions WHERE partition_key = '2025-MD'`;
    expect(receipt.detail.identity_writes_enabled).toBe(false);
  });

  it("waits for the shared year lock before canonical reads and keeps it through every state write", async () => {
    await db`INSERT INTO institution_sources (id, lei) VALUES (1, ${A}), (2, NULL)`;
    await run({ loans: [{ lei: A }] });
    await db.unsafe(`CREATE FUNCTION require_year_lock() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_locks WHERE locktype = 'advisory' AND pid = pg_backend_pid()
          AND classid = 2253 AND objid = 2025 AND granted) THEN
          RAISE EXCEPTION 'year lock missing during HMDA write';
        END IF;
        RETURN NULL;
      END $$`);
    for (const table of ["hmda_lenders", "hmda_lender_originations", "hmda_lender_loan_costs"]) {
      await db.unsafe(`CREATE TRIGGER require_year_lock BEFORE INSERT OR UPDATE OR DELETE ON ${table}
        FOR EACH STATEMENT EXECUTE FUNCTION require_year_lock()`);
    }
    const blocker = postgres(connection!, { ssl: false, max: 1, prepare: false,
      connection: { search_path: schema }, types: { json: JSON_TEXT_PASSTHROUGH } });
    let normal!: ReturnType<typeof run>;
    try {
      await blocker.begin(async (raw) => {
        const tx = raw as unknown as RegistryDb;
        await lockHmdaYear(tx, 2025);
        normal = run({ state: "MD", loans: [{ lei: A }] });
        let waiting = false;
        const deadline = Date.now() + 1_000;
        while (Date.now() < deadline) {
          const [locks] = await tx`SELECT count(*)::int AS n FROM pg_locks WHERE locktype = 'advisory'
            AND classid = 2253 AND objid = 2025 AND NOT granted`;
          if (locks.n > 0) { waiting = true; break; }
          await new Promise((resolve) => setTimeout(resolve, 10));
        }
        expect(waiting).toBe(true);
        await tx`UPDATE institution_sources SET lei = NULL WHERE id = 1`;
        await tx`UPDATE institution_sources SET lei = ${A} WHERE id = 2`;
      });
      await normal;
      const rows = await identities();
      expect(rows.lenders).toHaveLength(1);
      expect(rows.originations).toHaveLength(2);
      expect(rows.costs).toHaveLength(2);
      for (const table of [rows.lenders, rows.originations, rows.costs]) {
        expect(table.every((row) => Number(row.institution_id) === 2)).toBe(true);
      }
    } finally {
      await blocker.end();
      for (const table of ["hmda_lenders", "hmda_lender_originations", "hmda_lender_loan_costs"]) {
        await db.unsafe(`DROP TRIGGER require_year_lock ON ${table}`);
      }
      await db.unsafe("DROP FUNCTION require_year_lock()");
    }
  });

  it("rolls back the complete state stage if a later cost metric write fails", async () => {
    await db`INSERT INTO institution_sources (id, lei) VALUES (1, ${A}), (2, NULL)`;
    await run({ state: "MD", loans: [{ lei: A }] });
    await db`UPDATE institution_sources SET lei = NULL WHERE id = 1`;
    await db`UPDATE institution_sources SET lei = ${A} WHERE id = 2`;
    const before = await snapshot();
    await db.unsafe(`CREATE FUNCTION reject_cost_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'fixture later cost write failure'; END $$`);
    await db.unsafe(`CREATE TRIGGER reject_cost_insert BEFORE INSERT ON hmda_lender_loan_costs
      FOR EACH ROW EXECUTE FUNCTION reject_cost_insert()`);
    try {
      await expect(run({ loans: [{ lei: A, amount: 990000 }] })).rejects.toThrow("fixture later cost write failure");
    } finally {
      await db.unsafe("DROP TRIGGER reject_cost_insert ON hmda_lender_loan_costs");
      await db.unsafe("DROP FUNCTION reject_cost_insert()");
    }
    expect(await snapshot()).toBe(before);
  });

  it("uses only the historical respondent RSSD, excluding parent and top-holder identity", async () => {
    await db`INSERT INTO institution_sources (id, rssd_id) VALUES (1, '480228'), (2, '999'), (3, '888')`;
    const { result } = await run({ year: 2023, loans: [{ lei: A }, { lei: B }], panel: [
      { lei: A, rssd: "000480228", parent: "999", holder: "888" },
      { lei: B, rssd: "0", parent: "999", holder: "888" },
    ] });
    expect(result.matching).toMatchObject({ matched: 1, unmatched: 1, ambiguous: 0 });
    const rows = await identities();
    expect(rows.lenders.find((row) => row.lei === A)).toMatchObject({ institution_id: 1, match_method: "rssd" });
    expect(rows.lenders.find((row) => row.lei === B)).toMatchObject({ institution_id: null, match_method: null });
    for (const table of [rows.originations, rows.costs]) {
      expect(table.find((row) => row.lei === A)?.institution_id).toBe(1);
      expect(table.find((row) => row.lei === B)?.institution_id).toBeNull();
    }
  });

  it.each(["own", "key", "ambiguous"])("holds unique respondent RSSD with conflicting %s LEI facts", async (kind) => {
    await db`INSERT INTO institution_sources (id, lei, rssd_id) VALUES (1, ${kind === "own" ? B : null}, '480228')`;
    if (kind !== "own") await db`INSERT INTO institution_lei_links (institution_id, status, lei, match_basis, candidate_leis)
      VALUES (1, ${kind === "key" ? "linked" : "ambiguous"}, ${kind === "key" ? B : null}, 'rssd', ${kind === "key" ? [] : [B, C]})`;
    const { result } = await run({ year: 2023, loans: [{ lei: A }], panel: [{ lei: A, rssd: "480228" }] });
    expect(result.matching).toMatchObject({ matched: 0, ambiguous: 1 });
    const rows = await identities();
    expect(rows.lenders[0]).toMatchObject({ institution_id: null, match_method: null,
      reason: kind === "ambiguous" ? "canonical_lei_conflict" : "identifier_disagreement" });
    expect(rows.originations[0].institution_id).toBeNull();
    expect(rows.costs[0].institution_id).toBeNull();
  });

  it.each(["direct LEI", "canonical LEI", "respondent RSSD", "LEI/RSSD disagreement"])("holds a conflicting %s in all three HMDA tables", async (kind) => {
    if (kind === "direct LEI") {
      await db`INSERT INTO institution_sources (id, lei) VALUES (9, ${A}), (1, ${A.toLowerCase()})`;
    } else if (kind === "canonical LEI") {
      await db`INSERT INTO institution_sources (id) VALUES (9), (1)`;
      await db`INSERT INTO institution_lei_links (institution_id, status, lei, match_basis)
        VALUES (9, 'linked', ${A}, 'fdic_cert'), (1, 'linked', ${A}, 'rssd')`;
    } else if (kind === "respondent RSSD") {
      await db`INSERT INTO institution_sources (id, rssd_id) VALUES (9, '480228'), (1, '000480228')`;
    } else {
      await db`INSERT INTO institution_sources (id, lei, rssd_id) VALUES (9, ${A}, NULL), (1, ${B}, '480228')`;
    }
    const { result } = await run({ year: 2023, loans: [{ lei: A }], panel: [{ lei: A, rssd: "480228" }] });
    expect(result.matching).toMatchObject({ matched: 0, ambiguous: 1, unmatched: 0 });
    const expectedReason = kind === "respondent RSSD" ? "shared_rssd" : kind === "LEI/RSSD disagreement" ? "identifier_disagreement" : "shared_lei";
    const rows = await identities();
    expect(rows.lenders).toEqual([{ lei: A, institution_id: null, match_method: null, reason: expectedReason }]);
    expect(rows.originations).toEqual([{ lei: A, institution_id: null }]);
    expect(rows.costs).toEqual([{ lei: A, institution_id: null }]);
    const [diagnostic] = await db`SELECT raw_json->'feeinsight_identity' AS identity FROM hmda_lenders`;
    expect(diagnostic.identity).toMatchObject({ status: "ambiguous", candidateIds: [1, 9], reason: expectedReason });
  });

  it("does not choose one conflicting historical panel row even when the lender has an own LEI", async () => {
    await db`INSERT INTO institution_sources (id, lei, rssd_id) VALUES (1, ${A}, '480228')`;
    const { result } = await run({ year: 2023, loans: [{ lei: A }], panel: [
      { lei: A, rssd: "480228" }, { lei: A, rssd: "999999" },
    ] });
    expect(result.matching).toMatchObject({ matched: 0, ambiguous: 1, reasons: { panel_identity_conflict: 1 } });
    const rows = await identities();
    expect(rows.lenders).toEqual([{ lei: A, institution_id: null, match_method: null, reason: "panel_identity_conflict" }]);
    expect(rows.originations).toEqual([{ lei: A, institution_id: null }]);
    expect(rows.costs).toEqual([{ lei: A, institution_id: null }]);
  });

  it("preserves an ambiguous canonical review and an own/canonical LEI disagreement", async () => {
    await db`INSERT INTO institution_sources (id, lei) VALUES (1, ${A}), (2, ${C})`;
    await db`INSERT INTO institution_lei_links (institution_id, status, lei, match_basis, candidate_leis)
      VALUES (1, 'ambiguous', NULL, 'rssd', ${[A, B]}), (2, 'linked', ${D}, 'fdic_cert', '{}')`;
    const { result } = await run({ loans: [A, B, C, D].map((lei) => ({ lei })) });
    expect(result.matching).toMatchObject({ matched: 0, ambiguous: 4, unmatched: 0 });
    const rows = await identities();
    expect(rows.lenders.every((row) => row.institution_id === null && row.reason === "canonical_lei_conflict")).toBe(true);
    expect(rows.originations.every((row) => row.institution_id === null)).toBe(true);
    expect(rows.costs.every((row) => row.institution_id === null)).toBe(true);
  });

  it("predicts actual matches on a read-only connection and leaves every fixture table unchanged", async () => {
    await db`INSERT INTO institution_sources (id, lei) VALUES (1, ${A}), (2, ${B})`;
    await run({ loans: [{ lei: A }] });
    const before = await snapshot();
    const readOnly = postgres(connection!, { ssl: false, max: 1, prepare: false,
      connection: { search_path: schema, default_transaction_read_only: true }, types: { json: JSON_TEXT_PASSTHROUGH } });
    try {
      const { result } = await run({ loans: [{ lei: A }, { lei: B }, { lei: C }], dryRun: true, database: readOnly as unknown as RegistryDb });
      expect(result).toMatchObject({ dryRun: true, matchedLenders: 2, unmatchedLenders: 1,
        writtenLenders: 0, writtenOriginationRows: 0, writtenCostRows: 0, removedStaleRows: 0 });
      expect(result.matching).toMatchObject({ matched: 2, unmatched: 1, ambiguous: 0 });
    } finally {
      await readOnly.end();
    }
    expect(await snapshot()).toBe(before);
  });

  it.each(["institution_sources", "institution_lei_links"])("fails before writes if %s is unavailable, rather than reporting zero coverage", async (table) => {
    await db`INSERT INTO institution_sources (id, lei) VALUES (1, ${A})`;
    const before = await snapshot();
    await db`ALTER TABLE ${db(table)} RENAME TO identity_table_unavailable`;
    try {
      await expect(run({ loans: [{ lei: A }] })).rejects.toMatchObject({ code: "42P01" });
    } finally {
      await db`ALTER TABLE identity_table_unavailable RENAME TO ${db(table)}`;
    }
    expect(await snapshot()).toBe(before);
  });
});
