// @vitest-environment node
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { JSON_TEXT_PASSTHROUGH } from "@/lib/data-store/connection";
import { runRegistryFdicUniverse } from "./fdic-universe";
import type { RegistryDb } from "./partitions";

const release = vi.hoisted(() => ({ FDIC_OWN_LEI_WRITES_ENABLED: true, FDIC_IDENTITY_HOLD_WRITES_ENABLED: true }));
vi.mock("@/lib/agents/hoovie/hmda-repair-release", () => release);

const connection = process.env.FDIC_UNIVERSE_TEST_DATABASE_URL ?? process.env.E2E_DATABASE_URL;
const schema = `fdic_lei_${randomBytes(8).toString("hex")}`;
const lei = "549300OSSFHX7ABQ2Y81";
const knownLei = "5493003GQDUH26DNNH17";
const thirdLei = "549300T94GSH3C4U5M59";

describe.skipIf(!connection)("FDIC own-LEI collection in isolated PostgreSQL", () => {
  let db: postgres.Sql<{ json: unknown }>;
  let registryDb: RegistryDb;
  const receipts: Array<Record<string, unknown>> = [];
  const holdMigration = readFileSync(new URL("../../../../../supabase/migrations/20270110000074_fdic_identity_conflict_holds.sql", import.meta.url), "utf8");

  beforeAll(async () => {
    if (!connection || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("FDIC identity SQL tests require a loopback fixture");
    }
    db = postgres(connection, { ssl: false, max: 1, prepare: false, onnotice: () => undefined,
      connection: { search_path: schema }, types: { json: JSON_TEXT_PASSTHROUGH } });
    await db`CREATE SCHEMA ${db(schema)}`;
    await db`
      CREATE TABLE institution_sources (
        id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, institution_name text, website_url text,
        charter_type text, state text, state_code text, city text, asset_size bigint, asset_size_tier text,
        cert_number text, source text, status text, fed_district integer, cbsa_code text, cbsa_name text,
        established_date text, rssd_id text, lei text, holding_company_rssd text, holding_company_name text,
        primary_regulator text, charter_agency text, regulatory_status text, closed_date date,
        registry_synced_at timestamptz, UNIQUE (source, cert_number)
      )
    `;
    await db`CREATE TABLE agent_runs (id bigint PRIMARY KEY, status text, run_kind text, cancel_requested_at timestamptz,
      params_json jsonb, agent_name text)`;
    await db`CREATE TABLE agent_run_steps (agent_run_id bigint, step_key text, status text, agent_name text)`;
    await db`INSERT INTO agent_runs VALUES (77,'running','workflow',NULL,
      '{"source":"magellan.registry","registry_source":"fdic-universe","partition_key":"current"}', 'magellan')`;
    await db`INSERT INTO agent_run_steps VALUES (77,'registry-fdic-universe','running','magellan')`;
    await db`DO $$ BEGIN
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF;
      IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF;
    END $$`;
    // Exercise the production identity reads/writes; unrelated district and receipt steps are stubbed.
    const fixtureDb = (client: postgres.Sql<{ json: unknown }>): RegistryDb => Object.assign((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      if (text.includes("registry_ingest_partitions")) {
        receipts.push(JSON.parse(String(values.find((value) => typeof value === "string" && value.startsWith("{")))));
        return Promise.resolve([]);
      }
      if (text.includes("WITH banks AS")) return Promise.resolve([]);
      return client(strings, ...values as postgres.ParameterOrFragment<never>[]);
    }, { begin: async (callback: (tx: RegistryDb) => Promise<unknown>) => client.begin(async (tx) => callback(fixtureDb(tx as unknown as typeof db))) }) as unknown as RegistryDb;
    registryDb = fixtureDb(db);
  });

  beforeEach(async () => {
    release.FDIC_OWN_LEI_WRITES_ENABLED = true;
    release.FDIC_IDENTITY_HOLD_WRITES_ENABLED = true;
    await db`DROP TABLE IF EXISTS institution_identity_holds CASCADE`;
    await db`DROP FUNCTION IF EXISTS reject_identity_hold_mutation()`;
    await db.unsafe(holdMigration.replaceAll("public.", `"${schema}".`));
    await db`TRUNCATE institution_sources RESTART IDENTITY`;
    await db`UPDATE agent_runs SET status='running', cancel_requested_at=NULL`;
    receipts.length = 0;
  });
  afterAll(async () => {
    if (db) {
      await db`DROP SCHEMA IF EXISTS ${db(schema)} CASCADE`;
      await db.end();
    }
  });

  const run = async (records: Array<Record<string, unknown>>, dryRun = false) => {
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ meta: { total: records.length },
      data: records.map((data) => ({ data })) }), { status: 200 }));
    return runRegistryFdicUniverse({ runId: 77, db: registryDb, dryRun, fetchOptions: { fetchImpl, backoffMs: 0 } });
  };
  const active = (cert: number, LEI: unknown) => ({ CERT: cert, NAME: "Shared Name", ACTIVE: 1, LEI });

  it("refreshes only the exact FDIC certificate and inserts the new bank's own normalized LEI", async () => {
    await db`INSERT INTO institution_sources (cert_number, source, lei) VALUES ('1', 'fdic', NULL), ('1', 'ncua', ${knownLei})`;
    const result = await run([active(1, lei.toLowerCase()), active(2, thirdLei)]);
    expect(result).toMatchObject({ updatedInstitutions: 1, insertedInstitutions: 1 });
    const rows = await db`SELECT cert_number, source, lei FROM institution_sources ORDER BY source, cert_number`;
    expect([...rows]).toEqual([
      { cert_number: "1", source: "fdic", lei },
      { cert_number: "2", source: "fdic", lei: thirdLei },
      { cert_number: "1", source: "ncua", lei: knownLei },
    ]);
  });

  it("holds an LEI shared by tracked and new certificates, preserving raw source values in the receipt", async () => {
    await db`INSERT INTO institution_sources (cert_number, source, lei) VALUES ('1', 'fdic', NULL), ('2', 'fdic', ${knownLei})`;
    const result = await run([active(1, lei.toLowerCase()), active(2, lei), active(3, thirdLei)]);
    const rows = await db`SELECT cert_number, lei FROM institution_sources ORDER BY cert_number`;
    expect([...rows]).toEqual([
      { cert_number: "1", lei: null },
      { cert_number: "2", lei: knownLei },
      { cert_number: "3", lei: thirdLei },
    ]);
    const expected = { reported_institutions: 3, unique_source_institutions: 1, shared_source_institutions: 2,
      duplicate_leis: [{ lei, certificates: ["1", "2"], reported_values: [
        { certificate: "1", value: lei.toLowerCase() }, { certificate: "2", value: lei },
      ] }], conflicts: [{ certificate: "2", stored_lei: knownLei, reported_lei: lei }] };
    expect(result.leiIdentity).toMatchObject(expected);
    expect(receipts[0].lei_identity).toMatchObject(expected);
    expect([...await db`SELECT certificate,reason,implicated_leis FROM institution_identity_holds ORDER BY certificate,reason`]).toEqual([
      { certificate: "1", reason: "shared_lei", implicated_leis: [lei] },
      { certificate: "2", reason: "shared_lei", implicated_leis: [knownLei, lei].sort() },
      { certificate: "2", reason: "stored_lei_conflict", implicated_leis: [knownLei, lei].sort() },
    ]);
  });

  it("counts distinct certificate owners rather than repeated source rows", async () => {
    await db`INSERT INTO institution_sources (cert_number, source, lei) VALUES ('1', 'fdic', NULL)`;
    const result = await run([active(1, lei), active(1, lei.toLowerCase())]);
    expect(result.leiIdentity.duplicate_leis).toEqual([]);
    expect((await db`SELECT lei FROM institution_sources`)[0].lei).toBe(lei);
  });

  it("preserves a conflicting known key and reports both identifiers", async () => {
    await db`INSERT INTO institution_sources (cert_number, source, lei) VALUES ('1', 'fdic', ${knownLei})`;
    const result = await run([active(1, lei)]);
    expect((await db`SELECT lei FROM institution_sources`)[0].lei).toBe(knownLei);
    expect(result.leiIdentity.conflicts).toEqual([{ certificate: "1", stored_lei: knownLei, reported_lei: lei }]);
    expect(receipts[0].lei_identity).toMatchObject({ conflicts: result.leiIdentity.conflicts });
  });

  it.each([undefined, "", "invalid"])("preserves a known LEI when FDIC sends %s", async (LEI) => {
    await db`INSERT INTO institution_sources (cert_number, source, lei) VALUES ('1', 'fdic', ${knownLei})`;
    await run([active(1, LEI), active(2, LEI)]);
    const rows = await db`SELECT cert_number, lei FROM institution_sources ORDER BY cert_number`;
    expect([...rows]).toEqual([{ cert_number: "1", lei: knownLei }, { cert_number: "2", lei: null }]);
  });

  it("performs no writes during a dry run", async () => {
    await db`INSERT INTO institution_sources (cert_number, source, lei) VALUES ('1', 'fdic', ${knownLei})`;
    const result = await run([active(1, lei), active(2, thirdLei)], true);
    const rows = await db`SELECT cert_number, lei FROM institution_sources`;
    expect([...rows]).toEqual([{ cert_number: "1", lei: knownLei }]);
    expect(result.leiIdentity.conflicts).toEqual([{ certificate: "1", stored_lei: knownLei, reported_lei: lei }]);
    expect(receipts).toEqual([]);
  });

  it("keeps broad own-LEI writes disabled while still reporting source proposals and conflicts", async () => {
    release.FDIC_OWN_LEI_WRITES_ENABLED = false;
    release.FDIC_IDENTITY_HOLD_WRITES_ENABLED = false;
    await db`INSERT INTO institution_sources (cert_number, source, lei)
      VALUES ('1', 'fdic', NULL), ('2', 'fdic', ${` ${knownLei.toLowerCase()} `})`;
    const result = await run([active(1, lei), active(2, thirdLei), active(3, knownLei)]);
    expect([...await db`SELECT cert_number, lei FROM institution_sources ORDER BY cert_number`]).toEqual([
      { cert_number: "1", lei: null }, { cert_number: "2", lei: ` ${knownLei.toLowerCase()} ` }, { cert_number: "3", lei: null },
    ]);
    expect(result.leiIdentity.unique_source_institutions).toBe(1);
    expect(result.leiIdentity.conflicts).toEqual([{ certificate: "2", stored_lei: ` ${knownLei.toLowerCase()} `, reported_lei: thirdLei }]);
    expect(receipts[0].own_lei_writes_enabled).toBe(false);
    expect(await db`SELECT id FROM institution_identity_holds`).toHaveLength(0);
  });

  it("retains sticky holds through clean and missing later responses, blocking old and incoming keys", async () => {
    await db`INSERT INTO institution_sources (cert_number, source, lei) VALUES ('1','fdic',${knownLei}),('2','fdic',NULL)`;
    await run([active(1, lei), active(2, thirdLei)]);
    const first = [...await db`SELECT * FROM institution_identity_holds`];
    expect(first).toHaveLength(1);
    await run([active(1, knownLei), active(2, lei), active(3, knownLei)]);
    expect([...await db`SELECT cert_number,lei FROM institution_sources ORDER BY cert_number`]).toEqual([
      { cert_number: "1", lei: knownLei }, { cert_number: "2", lei: thirdLei }, { cert_number: "3", lei: null },
    ]);
    await run([active(1, null), active(2, null), active(3, null)]);
    expect([...await db`SELECT * FROM institution_identity_holds WHERE id=${first[0].id}`]).toEqual(first);
  });

  it("replays the same conflict without replacing first-observation lineage", async () => {
    await run([active(1, lei), active(2, lei)]);
    const first = [...await db`SELECT * FROM institution_identity_holds ORDER BY id`];
    // Newly inserted canonical IDs are useful lineage on the second observation, creating a new fingerprint once.
    await run([active(1, lei), active(2, lei)]);
    const second = [...await db`SELECT * FROM institution_identity_holds ORDER BY id`];
    await run([active(1, lei), active(2, lei)]);
    expect([...await db`SELECT * FROM institution_identity_holds ORDER BY id`]).toEqual(second);
    expect(second.slice(0, first.length)).toEqual(first);
  });

  it("fails closed before writes if broad LEI propagation is enabled without hold collection", async () => {
    release.FDIC_IDENTITY_HOLD_WRITES_ENABLED = false;
    await expect(run([active(1, lei)])).rejects.toThrow("requires durable conflict holds");
    expect(await db`SELECT id FROM institution_sources`).toHaveLength(0);
  });

  it("rejects a cancelled ledger owner and rolls back both profile and hold writes", async () => {
    await db`INSERT INTO institution_sources (cert_number, source, lei) VALUES ('1','fdic',${knownLei})`;
    await db`UPDATE agent_runs SET cancel_requested_at=NOW()`;
    await expect(run([active(1, lei), active(2, thirdLei)])).rejects.toThrow("running registry ledger owner");
    expect([...await db`SELECT cert_number,lei FROM institution_sources`]).toEqual([{ cert_number: "1", lei: knownLei }]);
    expect(await db`SELECT id FROM institution_identity_holds`).toHaveLength(0);
  });

  it("keeps prior holds after an incomplete fetch fails before any writes", async () => {
    await run([active(1, lei), active(2, lei)]);
    const first = [...await db`SELECT * FROM institution_identity_holds ORDER BY id`];
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ meta: { total: 2 }, data: [{ data: active(1, lei) }] }), { status: 200 }));
    await expect(runRegistryFdicUniverse({ runId: 77, db: registryDb, fetchOptions: { fetchImpl, backoffMs: 0 } })).rejects.toThrow("incomplete identity snapshot");
    expect([...await db`SELECT * FROM institution_identity_holds ORDER BY id`]).toEqual(first);
  });

  it("fails closed on missing hold schema before changing an identity", async () => {
    await db`DROP TABLE institution_identity_holds CASCADE`;
    await expect(run([active(1, lei)])).rejects.toThrow("institution_identity_holds");
    expect(await db`SELECT id FROM institution_sources`).toHaveLength(0);
  });

  it("keeps both gates off without requiring or writing the new table", async () => {
    await db`DROP TABLE institution_identity_holds CASCADE`;
    release.FDIC_IDENTITY_HOLD_WRITES_ENABLED = false;
    release.FDIC_OWN_LEI_WRITES_ENABLED = false;
    await run([active(1, lei)]);
    expect([...await db`SELECT cert_number,lei FROM institution_sources`]).toEqual([{ cert_number: "1", lei: null }]);
  });

  it("rolls back appended holds if a later canonical profile update fails", async () => {
    await db`INSERT INTO institution_sources (cert_number, source, lei) VALUES ('1','fdic',${knownLei})`;
    await db`CREATE FUNCTION fail_profile_update() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'fixture profile update failure'; END; $$`;
    await db`CREATE TRIGGER fail_profile_update BEFORE UPDATE ON institution_sources FOR EACH STATEMENT EXECUTE FUNCTION fail_profile_update()`;
    try {
      await expect(run([active(1, lei), active(2, thirdLei)])).rejects.toThrow("fixture profile update failure");
      expect(await db`SELECT id FROM institution_identity_holds`).toHaveLength(0);
      expect([...await db`SELECT cert_number,lei FROM institution_sources`]).toEqual([{ cert_number: "1", lei: knownLei }]);
    } finally {
      await db`DROP TRIGGER fail_profile_update ON institution_sources`;
      await db`DROP FUNCTION fail_profile_update()`;
    }
  });

  it("reloads canonical identifiers under lock instead of trusting the pre-fetch snapshot", async () => {
    await db`INSERT INTO institution_sources (cert_number, source, lei) VALUES ('1','fdic',NULL)`;
    const raceDb = Object.assign((strings: TemplateStringsArray, ...values: unknown[]) =>
      registryDb(strings, ...values as never[]), {
      begin: async (callback: (tx: RegistryDb) => Promise<unknown>) => {
        await db`UPDATE institution_sources SET lei=${knownLei} WHERE cert_number='1'`;
        return registryDb.begin(async (tx) => callback(tx as unknown as RegistryDb));
      },
    }) as unknown as RegistryDb;
    const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ meta: { total: 1 },
      data: [{ data: active(1, lei) }] }), { status: 200 }));
    await runRegistryFdicUniverse({ runId: 77, db: raceDb, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect([...await db`SELECT lei FROM institution_sources`]).toEqual([{ lei: knownLei }]);
    expect([...await db`SELECT reason, implicated_leis FROM institution_identity_holds`]).toEqual([
      { reason: "stored_lei_conflict", implicated_leis: [knownLei, lei].sort() },
    ]);
  });

  it("records positive conflict evidence even when every profile is missing its name", async () => {
    await db`INSERT INTO institution_sources (cert_number,source,lei) VALUES ('1','fdic',${knownLei})`;
    const result = await run([{ ...active(1, lei), NAME: null }, { ...active(2, lei), NAME: null }]);
    expect(result).toMatchObject({ activeInstitutions: 0, updatedInstitutions: 0, insertedInstitutions: 0, missingFromFdic: 0 });
    expect([...await db`SELECT certificate,reason FROM institution_identity_holds ORDER BY certificate,reason`]).toEqual([
      { certificate: "1", reason: "shared_lei" }, { certificate: "1", reason: "stored_lei_conflict" },
      { certificate: "2", reason: "shared_lei" },
    ]);
    expect([...await db`SELECT cert_number,lei FROM institution_sources`]).toEqual([{ cert_number: "1", lei: knownLei }]);
  });

  it("holds a new source key already owned by an inactive canonical certificate missing from the active file", async () => {
    await db`INSERT INTO institution_sources (cert_number,source,lei,regulatory_status)
      VALUES ('1','fdic',${` ${lei.toLowerCase()} `},'inactive')`;
    const result = await run([active(2, lei)]);
    expect(result.leiIdentity.duplicate_leis).toMatchObject([{ lei, certificates: ["1", "2"],
      preserved_values: [{ certificate: "1", institution_id: 1, regulatory_status: "inactive" }] }]);
    expect([...await db`SELECT cert_number,lei FROM institution_sources ORDER BY cert_number`]).toEqual([
      { cert_number: "1", lei: ` ${lei.toLowerCase()} ` }, { cert_number: "2", lei: null },
    ]);
    expect([...await db`SELECT certificate,institution_id,reason,implicated_leis,owner_certificates
      FROM institution_identity_holds ORDER BY certificate`]).toEqual([
      { certificate: "1", institution_id: "1", reason: "shared_lei", implicated_leis: [lei], owner_certificates: ["1", "2"] },
      { certificate: "2", institution_id: null, reason: "shared_lei", implicated_leis: [lei], owner_certificates: ["1", "2"] },
    ]);
  });

  it.each(["   ", "\t", "\r\n", "\u00a0", "\ufeff\u3000\u200a"])("treats whitespace-only canonical LEI %j as missing and fills the unique source key without a false hold", async (blank) => {
    await db`INSERT INTO institution_sources (cert_number,source,lei) VALUES ('1','fdic',${blank})`;
    const result = await run([active(1, lei)]);
    expect(result.leiIdentity).toMatchObject({ conflicts: [], hold_proposals: 0, durable_holds_inserted: 0 });
    expect([...await db`SELECT lei FROM institution_sources`]).toEqual([{ lei }]);
    expect(await db`SELECT id FROM institution_identity_holds`).toHaveLength(0);
  });

  it("preserves a nonblank malformed stored LEI and holds the differing publisher key", async () => {
    const stored = "\tinvalid\n";
    await db`INSERT INTO institution_sources (cert_number,source,lei) VALUES ('1','fdic',${stored})`;
    const result = await run([active(1, lei)]);
    expect(result.leiIdentity).toMatchObject({ conflicts: [{ certificate: "1", stored_lei: stored, reported_lei: lei }],
      hold_proposals: 1, durable_holds_inserted: 1 });
    expect([...await db`SELECT lei FROM institution_sources`]).toEqual([{ lei: stored }]);
  });
});
