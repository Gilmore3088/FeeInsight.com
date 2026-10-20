// @vitest-environment node
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
const fixture = vi.hoisted(() => ({ query: null as null | ((...args: unknown[]) => unknown) }));
vi.mock("@/lib/data-store/connection", async (importOriginal) => ({
  ...await importOriginal<typeof import("@/lib/data-store/connection")>(),
  sql: (...args: unknown[]) => { if (!fixture.query) throw new Error("Local GLEIF fixture is not initialized"); return fixture.query(...args); },
}));
import { JSON_TEXT_PASSTHROUGH } from "@/lib/data-store/connection";
import { fdicIdentityHoldFingerprint, type FdicIdentityHoldInput } from "@/lib/data-store/fdic-identity-holds";
import { leiShard } from "@/lib/regulatory/gleif";
import { getCorporateFamily, getGleifLinkSummary, getInstitutionLeiLink, getLeiLinkCoverage } from "@/lib/data-store/locations-gleif-aggregates";
import { runRegistryGleif } from "./gleif";
import type { RegistryDb } from "./partitions";
const connection = process.env.GLEIF_IDENTITY_TEST_DATABASE_URL ?? process.env.E2E_DATABASE_URL;
const schema = `gleif_holds_${randomBytes(8).toString("hex")}`;
const A = "5493001KJTIIGC8Y1R12";
const B = "549300ABCDEFGHIJKL34";
const C = "549300ZZZZZZZZZZZZ56";
function fragment(file: string, start: string, until?: string) {
  const sql = readFileSync(`supabase/migrations/${file}`, "utf8");
  const from = sql.indexOf(start), to = until ? sql.indexOf(until, from) : sql.length;
  if (from < 0 || to < from) throw new Error(`Missing fixture fragment ${file}`);
  return sql.slice(from, to).replaceAll("public.", "");
}
const json = (value: unknown) => new Response(JSON.stringify(value), { status: 200 });
const entity = (lei: string, rssd = "123") => ({ id: lei, attributes: { lei,
  entity: { legalName: { name: "First Bank" }, legalAddress: { country: "US", region: "US-TX" }, registeredAt: { id: "NIC" }, registeredAs: rssd, status: "ACTIVE" },
  registration: { status: "ISSUED" } } });

describe.skipIf(!connection)("GLEIF durable holds in isolated PostgreSQL", () => {
  let db: postgres.Sql<{ json: unknown }>;
  beforeAll(async () => {
    if (!connection || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(connection).hostname)) throw new Error("GLEIF hold SQL tests require a loopback fixture");
    db = postgres(connection, { ssl: false, max: 1, prepare: false, onnotice: () => undefined, connection: { search_path: schema }, types: { json: JSON_TEXT_PASSTHROUGH } });
    fixture.query = (...args) => Reflect.apply(db, db, args);
    await db`CREATE SCHEMA ${db(schema)}`;
    await db`CREATE TABLE institution_sources (id bigint PRIMARY KEY, source text, cert_number text, lei text, rssd_id text,
      ncua_charter_id text, institution_name text, state_code text, regulatory_status text)`;
    await db.unsafe(fragment("20270110000063_institution_lei_links.sql", "CREATE TABLE IF NOT EXISTS public.institution_lei_links"));
    await db.unsafe(fragment("20270110000059_public_data_tables_round3.sql", "CREATE TABLE IF NOT EXISTS public.gleif_entities", "-- state-lists:"));
    await db.unsafe(fragment("20261003142709_regulatory_registry.sql", "CREATE TABLE IF NOT EXISTS public.registry_ingest_partitions", "CREATE INDEX IF NOT EXISTS registry_ingest_partitions_due_idx"));
    await db.unsafe("DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon; END IF; IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated; END IF; END $$;");
    await db.unsafe(fragment("20270110000074_fdic_identity_conflict_holds.sql", "CREATE TABLE public.institution_identity_holds"));
  });
  beforeEach(async () => {
    await db`ALTER TABLE institution_identity_holds DISABLE TRIGGER USER`;
    try { await db`TRUNCATE institution_identity_holds RESTART IDENTITY`; }
    finally { await db`ALTER TABLE institution_identity_holds ENABLE TRIGGER USER`; }
    await db`TRUNCATE institution_sources, institution_lei_links, gleif_entities, gleif_relationships, registry_ingest_partitions RESTART IDENTITY CASCADE`;
  });
  afterAll(async () => { fixture.query = null; if (db) { await db`DROP SCHEMA IF EXISTS ${db(schema)} CASCADE`; await db.end(); } });
  async function bank(id = 1, lei: string | null = A, cert = "99") {
    await db`INSERT INTO institution_sources (id,source,cert_number,lei,rssd_id,institution_name,state_code,regulatory_status)
      VALUES (${id},'fdic',${cert},${lei},${String(122 + id)},'First Bank','TX','active')`;
  }
  async function hold(over: Partial<FdicIdentityHoldInput> = {}) {
    const input: FdicIdentityHoldInput = { certificate: "99", institutionId: 1, reason: "shared_lei", storedLei: A,
      implicatedLeis: [A], reportedLeis: [A], ownerCertificates: ["99", "999"], evidence: {}, ...over };
    await db`INSERT INTO institution_identity_holds (fingerprint,certificate,institution_id,reason,stored_lei,implicated_leis,reported_leis,owner_certificates,evidence,source_url,source_sha256,observed_at,agent_run_id)
      VALUES (${fdicIdentityHoldFingerprint(input)},${input.certificate},${input.institutionId},${input.reason},${input.storedLei},${input.implicatedLeis},${input.reportedLeis},${input.ownerCertificates},'{}','https://api.fdic.gov/banks/institutions',${"a".repeat(64)},'2026-10-19T00:00:00Z',123)`;
  }
  async function cached(lei: string, id: number, parent: string | null = null) {
    await db`INSERT INTO gleif_entities (lei,legal_name,institution_id,link_method,ultimate_parent_lei,direct_parent_lei)
      VALUES (${lei},'Source legal name',${id},'lei',${parent ?? lei},${parent})`;
  }
  async function accepted(id: number, lei: string) {
    await db`INSERT INTO institution_lei_links (institution_id,status,lei,match_basis,match_key) VALUES (${id},'linked',${lei},'rssd','123')`;
  }

  it("suppresses cached family roots by institution and by a globally held canonical own key", async () => {
    await bank(); await cached(B, 1); await hold();
    expect(await getCorporateFamily(1)).toMatchObject({ institution_leis: [], tree: null });
    expect(await getInstitutionLeiLink(1)).toMatchObject({ status: "ambiguous", lei: null });
  });

  it.each(["own", "crosswalk", "candidate"])("suppresses an alternate cached family root when its %s key is globally held", async (kind) => {
    await bank(1, kind === "own" ? A : B); await cached(B, 1);
    if (kind === "crosswalk") await accepted(1, A);
    if (kind === "candidate") await db`INSERT INTO institution_lei_links (institution_id,status,match_basis,candidate_leis,reason) VALUES (1,'ambiguous','own_lei',${[` ${A.toLowerCase()} `, B]},'FDIC identity hold requires review')`;
    await hold({ institutionId: null, certificate: "999", ownerCertificates: ["999", "1000"] });
    expect(await getCorporateFamily(1)).toMatchObject({ institution_leis: [], tree: null });
    expect(await getInstitutionLeiLink(1)).toMatchObject({ status: "ambiguous", lei: null });
    expect(await getLeiLinkCoverage()).toMatchObject({ institutions: 1, linked: 0, ambiguous: 1 });
    expect(await getGleifLinkSummary()).toMatchObject({ entities: 1, linked_by_lei: 0, unlinked: 1 });
  });

  it("retains family facts while suppressing a cached member whose other canonical key is held", async () => {
    await bank(1, C); await bank(2, B, "100"); await accepted(2, A);
    await cached(C, 1); await cached(B, 2, C);
    await hold({ institutionId: null, certificate: "999", ownerCertificates: ["999", "1000"] });
    const family = await getCorporateFamily(1);
    expect(family).toMatchObject({ members: 2, linked_members: 1, unlinked_members: 1 });
    expect(family.tree?.children[0]).toMatchObject({ lei: B, institution_id: null, institution_name: null, link_method: null });
    expect(await getGleifLinkSummary()).toMatchObject({ entities: 2, linked_by_lei: 1, unlinked: 1 });
  });

  it("rechecks publisher holds inserted during HTTP before writing a level1 entity", async () => {
    await bank();
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("registration-authorities")) return json({ data: [] });
      await hold(); return json({ data: [entity(A)] });
    }) as unknown as typeof fetch;
    await runRegistryGleif({ partitionKey: `level1-${leiShard(A)}`, runId: 123, db: db as unknown as RegistryDb, fetchOptions: { fetchImpl, backoffMs: 0 } });
    expect([...await db`SELECT institution_id,link_method FROM gleif_entities`]).toEqual([{ institution_id: null, link_method: null }]);
  });

  it("vetoes canonical own and crosswalk keys at the final key-write, and remains held on rerun", async () => {
    await bank(1, B);
    let inserted = false;
    const fetchImpl = vi.fn(async (url: string) => {
      if (url.includes("registration-authorities")) return json({ meta: { pagination: { lastPage: 1 } }, data: [{ id: "NIC", attributes: { internationalName: "National Information Center" } }] });
      if (!inserted) { inserted = true; await accepted(1, A); await hold({ institutionId: null, certificate: "999", ownerCertificates: ["999", "1000"] }); }
      return json({ meta: { pagination: { lastPage: 1 } }, data: [entity(B)] });
    }) as unknown as typeof fetch;
    const run = () => runRegistryGleif({ partitionKey: "lei-match-rssd", runId: 123, db: db as unknown as RegistryDb, fetchOptions: { fetchImpl, backoffMs: 0 }, spacingMs: 0 });
    await run(); await run();
    const [link] = await db`SELECT status,lei,candidate_leis,reason FROM institution_lei_links`;
    expect(link).toMatchObject({ status: "ambiguous", lei: null, reason: "FDIC identity hold requires review" });
    expect(link.candidate_leis).toContain(A);
  });

  it("keeps canonical crosswalk locks through both link and entity persistence", async () => {
    await bank();
    // These fixture-only triggers run at the actual write point, after any query waits.
    // Without the final-write crosswalk locks each trigger aborts the transaction.
    await db.unsafe(`CREATE FUNCTION assert_gleif_crosswalk_lock() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NOT EXISTS (SELECT 1 FROM pg_locks WHERE pid=pg_backend_pid()
          AND relation='institution_lei_links'::regclass AND granted
          AND mode=CASE WHEN TG_TABLE_NAME='institution_lei_links' THEN 'ShareRowExclusiveLock' ELSE 'ShareLock' END)
        THEN RAISE EXCEPTION 'Missing stable canonical crosswalk lock at % persistence',TG_TABLE_NAME; END IF;
        RETURN NULL;
      END; $$;
      CREATE TRIGGER assert_link_crosswalk_lock BEFORE INSERT OR UPDATE ON institution_lei_links
        FOR EACH STATEMENT EXECUTE FUNCTION assert_gleif_crosswalk_lock();
      CREATE TRIGGER assert_entity_crosswalk_lock BEFORE INSERT OR UPDATE ON gleif_entities
        FOR EACH STATEMENT EXECUTE FUNCTION assert_gleif_crosswalk_lock();`);
    try {
      const fetchImpl = vi.fn(async (url: string) => url.includes("registration-authorities")
        ? json({ meta: { pagination: { lastPage: 1 } }, data: [{ id: "NIC", attributes: { internationalName: "National Information Center" } }] })
        : json({ meta: { pagination: { lastPage: 1 } }, data: [entity(A)] })) as unknown as typeof fetch;
      const options = { runId: 123, db: db as unknown as RegistryDb, fetchOptions: { fetchImpl, backoffMs: 0 }, spacingMs: 0 };
      await runRegistryGleif({ ...options, partitionKey: "lei-match-rssd" });
      await runRegistryGleif({ ...options, partitionKey: `level1-${leiShard(A)}` });
      expect([...await db`SELECT status,TRIM(lei) AS lei FROM institution_lei_links`]).toEqual([{ status: "linked", lei: A }]);
      expect([...await db`SELECT institution_id::int,link_method FROM gleif_entities`]).toEqual([{ institution_id: 1, link_method: "lei" }]);
    } finally {
      await db`DROP TRIGGER assert_link_crosswalk_lock ON institution_lei_links`;
      await db`DROP TRIGGER assert_entity_crosswalk_lock ON gleif_entities`;
      await db`DROP FUNCTION assert_gleif_crosswalk_lock()`;
    }
  });

  it("fails closed without hold schema before writing identity rows", async () => {
    await bank(); await db`ALTER TABLE institution_identity_holds RENAME TO identity_holds_unavailable`;
    try {
      await expect(runRegistryGleif({ partitionKey: "lei-match-rssd", db: db as unknown as RegistryDb, fetchOptions: { fetchImpl: vi.fn() } })).rejects.toThrow("institution_identity_holds");
      expect(await db`SELECT * FROM institution_lei_links`).toHaveLength(0);
      await expect(getCorporateFamily(1)).rejects.toThrow("institution_identity_holds");
    } finally { await db`ALTER TABLE identity_holds_unavailable RENAME TO institution_identity_holds`; }
  });
});
