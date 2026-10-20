// @vitest-environment node
import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import postgres from "postgres";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { JSON_TEXT_PASSTHROUGH } from "@/lib/data-store/connection";
import type { RegistryDb } from "@/lib/agents/magellan/registry/partitions";
import { fdicIdentityHoldFingerprint, lockFdicIdentityHolds, persistFdicIdentityHolds, readFdicIdentityHolds,
  type FdicIdentityHoldInput } from "./fdic-identity-holds";

const gate = vi.hoisted(() => ({ FDIC_IDENTITY_HOLD_WRITES_ENABLED: true }));
vi.mock("@/lib/agents/hoovie/hmda-repair-release", () => gate);
const connection = process.env.E2E_DATABASE_URL;
const lei = "549300OSSFHX7ABQ2Y81";
const otherLei = "5493003GQDUH26DNNH17";
const input: FdicIdentityHoldInput = { certificate: "1", institutionId: 7, reason: "stored_lei_conflict", storedLei: otherLei,
  implicatedLeis: [lei, otherLei], reportedLeis: [lei], ownerCertificates: ["1"], evidence: { raw: [{ CERT: 1, LEI: lei }] } };
const source = { sourceUrl: "https://api.fdic.gov/banks/institutions?filters=ACTIVE%3A1", sourceSha256: "a".repeat(64), observedAt: "2026-10-19T12:00:00Z", agentRunId: 1 };

describe.skipIf(!connection)("durable FDIC identity holds in isolated PostgreSQL", () => {
  let db: postgres.Sql<{ json: unknown }>;
  let schema: string;
  const app = () => db as unknown as RegistryDb;
  beforeAll(async () => {
    if (!connection || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(connection).hostname)) throw new Error("Hold SQL tests require loopback PostgreSQL");
    const setup = postgres(connection, { ssl: false, max: 1, prepare: false });
    await setup.unsafe("DO $$ BEGIN CREATE ROLE anon; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
    await setup.unsafe("DO $$ BEGIN CREATE ROLE authenticated; EXCEPTION WHEN duplicate_object THEN NULL; END $$");
    await setup.end();
  });
  beforeEach(async () => {
    gate.FDIC_IDENTITY_HOLD_WRITES_ENABLED = true;
    schema = `hold_${randomBytes(8).toString("hex")}`;
    db = postgres(connection!, { ssl: false, max: 2, prepare: false, onnotice: () => undefined,
      connection: { search_path: schema }, types: { json: JSON_TEXT_PASSTHROUGH } });
    await db`CREATE SCHEMA ${db(schema)}`;
    await db.unsafe(readFileSync("supabase/migrations/20270110000074_fdic_identity_conflict_holds.sql", "utf8").replaceAll("public.", `${schema}.`));
    await db`CREATE TABLE agent_runs (id integer PRIMARY KEY,status text,run_kind text,cancel_requested_at timestamptz,params_json jsonb,agent_name text)`;
    await db`CREATE TABLE agent_run_steps (agent_run_id integer,step_key text,status text,agent_name text)`;
    await db`INSERT INTO agent_runs VALUES (1,'running','workflow',NULL,'{"source":"magellan.registry","registry_source":"fdic-universe","partition_key":"current"}','magellan')`;
    await db`INSERT INTO agent_run_steps VALUES (1,'registry-fdic-universe','running','magellan')`;
  });
  afterEach(async () => { if (db) { await db`DROP SCHEMA ${db(schema)} CASCADE`; await db.end(); } });
  const persist = (holds = [input], observation = source) => app().begin((tx) => persistFdicIdentityHolds(tx as unknown as RegistryDb, holds, observation));

  it("retains first evidence across receipt replacement, clean or older runs, replay and expanded conflicts", async () => {
    expect(await persist()).toBe(1);
    const first = await readFdicIdentityHolds(app());
    expect(first[0]).toMatchObject({ ...input, implicatedLeis: [...input.implicatedLeis].sort(), agentRunId: 1, sourceSha256: source.sourceSha256 });
    expect(await persist([], { ...source, observedAt: "2026-10-20T00:00:00Z" })).toBe(0);
    expect(await persist([input], { ...source, observedAt: "2020-01-01T00:00:00Z", sourceSha256: "b".repeat(64) })).toBe(0);
    expect(await readFdicIdentityHolds(app())).toEqual(first);
    expect(await persist([{ ...input, ownerCertificates: ["1", "2"] }])).toBe(1);
    expect((await readFdicIdentityHolds(app())).length).toBe(2);
  });

  it.each(["UPDATE institution_identity_holds SET reason='shared_lei'", "DELETE FROM institution_identity_holds", "TRUNCATE institution_identity_holds"])("rejects destructive runtime SQL: %s", async (statement) => {
    await persist();
    await expect(db.unsafe(statement)).rejects.toThrow("append-only");
    expect((await readFdicIdentityHolds(app())).length).toBe(1);
  });

  it.each(["UPDATE agent_runs SET status='succeeded'", "UPDATE agent_runs SET cancel_requested_at=NOW()",
    "UPDATE agent_runs SET params_json='{}'", "UPDATE agent_run_steps SET status='queued'", "DELETE FROM agent_run_steps"])("refuses evidence without its running ledger owner: %s", async (statement) => {
    await db.unsafe(statement);
    await expect(persist()).rejects.toThrow("running registry ledger owner");
    await expect(persist([])).rejects.toThrow("running registry ledger owner");
    expect(await readFdicIdentityHolds(app())).toEqual([]);
  });

  it("keeps the write gate independent from unconditional hold reads", async () => {
    await persist();
    gate.FDIC_IDENTITY_HOLD_WRITES_ENABLED = false;
    await expect(persist()).rejects.toThrow("release-disabled");
    expect((await readFdicIdentityHolds(app())).length).toBe(1);
  });

  it("fails closed on missing schema or corrupt evidence", async () => {
    await db`INSERT INTO institution_identity_holds (fingerprint,certificate,institution_id,reason,stored_lei,implicated_leis,reported_leis,owner_certificates,evidence,source_url,source_sha256,observed_at,agent_run_id)
      VALUES (${"0".repeat(64)},'1',7,'stored_lei_conflict',${otherLei},${[lei,otherLei]},${[lei]},${["1"]},'{}',${source.sourceUrl},${source.sourceSha256},NOW(),1)`;
    await expect(readFdicIdentityHolds(app())).rejects.toThrow("Corrupt");
    await db`DROP TABLE institution_identity_holds`;
    await expect(readFdicIdentityHolds(app())).rejects.toThrow("does not exist");
  });

  it("denies anonymous/authenticated access and enables RLS without public policies", async () => {
    const rows = await db`SELECT relrowsecurity FROM pg_class WHERE oid='institution_identity_holds'::regclass`;
    expect(rows[0].relrowsecurity).toBe(true);
    for (const role of ["anon", "authenticated"]) {
      const grants = await db`SELECT has_table_privilege(${role},'institution_identity_holds','SELECT') AS can_read,
        has_table_privilege(${role},'institution_identity_holds','INSERT') AS can_write`;
      expect(grants[0]).toEqual({ can_read: false, can_write: false });
    }
  });

  it("refuses a hold set larger than the explicit review bound", async () => {
    await db`INSERT INTO institution_identity_holds (fingerprint,certificate,reason,implicated_leis,reported_leis,owner_certificates,evidence,source_url,source_sha256,observed_at,agent_run_id)
      SELECT LPAD(n::text,64,'0'),'1','shared_lei',${[lei]},${[lei]},${["1"]},'{}',${source.sourceUrl},${source.sourceSha256},NOW(),1
      FROM generate_series(1,5001) AS n`;
    await expect(readFdicIdentityHolds(app())).rejects.toThrow("bound exceeded");
  });

  it("holds the write veto stable until a matching transaction completes", async () => {
    let releaseMatch!: () => void;
    let matchLocked!: () => void;
    const ready = new Promise<void>((resolve) => { matchLocked = resolve; });
    const release = new Promise<void>((resolve) => { releaseMatch = resolve; });
    const matching = app().begin(async (tx) => { await lockFdicIdentityHolds(tx as unknown as RegistryDb); matchLocked(); await release; });
    await ready;
    try {
      await expect(app().begin(async (raw) => { const tx = raw as unknown as RegistryDb; await tx`SET LOCAL lock_timeout='100ms'`; return persistFdicIdentityHolds(tx,[input],source); })).rejects.toThrow("lock timeout");
    } finally { releaseMatch(); await matching; }
    expect(await persist()).toBe(1);
  });

  it("fingerprints normalized conflict identity independently of source order and raw spelling", () => {
    expect(fdicIdentityHoldFingerprint(input)).toBe(fdicIdentityHoldFingerprint({ ...input, storedLei: ` ${otherLei.toLowerCase()} `,
      implicatedLeis: [...input.implicatedLeis].reverse(), evidence: { raw: "different spelling" } }));
    expect(() => fdicIdentityHoldFingerprint({ ...input, implicatedLeis: [lei] })).toThrow("Invalid");
  });
});
