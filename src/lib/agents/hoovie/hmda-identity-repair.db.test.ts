// @vitest-environment node
import { createHash, randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import reviewedManifest from "../../../../docs/project/evidence/2026-10-19-hmda-rerun-manifest.json";
import { JSON_TEXT_PASSTHROUGH } from "@/lib/data-store/connection";
import type { RegistryDb } from "../magellan/registry/partitions";

const connection = process.env.HMDA_REPAIR_TEST_DATABASE_URL ?? process.env.E2E_DATABASE_URL;
const schema = `hmda_repair_${randomBytes(8).toString("hex")}`;
type JsonRow = Record<string, unknown>;
type Snapshot = { institutions: JsonRow[]; lenders: JsonRow[]; originations: JsonRow[]; costs: JsonRow[] };
const SOURCE_SHA = reviewedManifest.sourceSha256;
const OUTSIDE_LEI = "549300OSSFHX7ABQ2Y81";
const RUN_ID = 901;
const STEP_ID = 902;

// Deliberately independent of the production hash helper: PostgreSQL emits JSON scalars,
// including microsecond timestamps, and only object-key order is canonicalized.
function stableJson(value: unknown): string {
  const sort = (item: unknown): unknown => Array.isArray(item) ? item.map(sort)
    : item !== null && typeof item === "object" ? Object.fromEntries(Object.entries(item)
      .sort(([left], [right]) => left.localeCompare(right)).map(([key, child]) => [key, sort(child)])) : item;
  return JSON.stringify(sort(value));
}
const hash = (value: unknown) => createHash("sha256").update(stableJson(value)).digest("hex");
const without = (row: JsonRow, fields: string[]) => Object.fromEntries(Object.entries(row).filter(([key]) => !fields.includes(key)));
function migrationFragment(file: string, from: string, until?: string): string {
  const text = readFileSync(resolve("supabase/migrations", file), "utf8");
  const start = text.indexOf(from);
  const end = until ? text.indexOf(until, start) : text.length;
  if (start < 0 || end < start) throw new Error(`Missing repair fixture schema in ${file}`);
  return text.slice(start, end).replaceAll("public.", "");
}

describe.skipIf(!connection)("bounded HMDA identity repair in isolated PostgreSQL", () => {
  let db: postgres.Sql<{ json: unknown }>;
  let manifest: typeof reviewedManifest;
  let digest: string;
  let source: { url: string; sha256: string; identities: Array<{ certificate: string; lei: string; rssdId: string | null }>; index: unknown };
  let writesEnabled = true;
  let activeRunId = RUN_ID;
  let activeStepId = STEP_ID;
  let sourceAvailable = true;
  let sourceReads = 0;

  beforeAll(async () => {
    if (!connection || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("HMDA repair SQL tests require a loopback fixture");
    }
    db = postgres(connection, { ssl: false, max: 1, prepare: false, onnotice: () => undefined,
      connection: { search_path: schema }, types: { json: JSON_TEXT_PASSTHROUGH } });
    await db`CREATE SCHEMA ${db(schema)}`;
    await db`CREATE TABLE institution_sources (id bigint PRIMARY KEY, institution_name text,
      lei text, rssd_id text, source text, cert_number text, registry_synced_at timestamptz,
      regulatory_status text, ncua_charter_id text)`;
    await db.unsafe(migrationFragment("20270110000063_institution_lei_links.sql", "CREATE TABLE IF NOT EXISTS public.institution_lei_links"));
    await db.unsafe(migrationFragment("20270110000058_public_data_loaders.sql", "CREATE TABLE IF NOT EXISTS public.hmda_lenders", "-- hmda_apor_rates:"));
    for (const name of ["agent_runs", "agent_run_steps", "agent_run_events"]) {
      await db.unsafe(`CREATE SEQUENCE ${name}_id_seq`);
    }
    await db.unsafe(migrationFragment("20260406_report_jobs.sql", "CREATE TABLE public.agent_registry", "CREATE TABLE public.agent_source_texts"));
    const ledger = readFileSync(resolve("supabase/migrations/20260406_report_jobs.sql"), "utf8");
    const constraintLines = ledger.split("\n").filter((line) => /^ALTER TABLE public.agent_(registry|runs|run_steps|run_events) ADD CONSTRAINT /.test(line)
      && !line.includes("api_budget_policies") && !line.includes("parent_agent"));
    for (const line of constraintLines) await db.unsafe(line.replaceAll("public.", ""));
    await db`INSERT INTO agent_registry (agent_name, display_name, role) VALUES ('hoovie', 'Hoovie', 'data')`;
  });

  afterAll(async () => {
    vi.doUnmock("./hmda-repair-manifest");
    vi.doUnmock("./hmda-repair-source");
    vi.doUnmock("./hmda-repair-release");
    if (db) { await db`DROP SCHEMA IF EXISTS ${db(schema)} CASCADE`; await db.end(); }
  });

  async function snapshot(): Promise<Snapshot> {
    const ids = reviewedManifest.cohort.map((row) => row.institutionId);
    const leis = reviewedManifest.cohort.map((row) => row.lei);
    const rows = async (table: string, selected: "institutions" | "lenders" | "cells") => {
      const found = selected === "institutions"
        ? await db`SELECT to_jsonb(t) AS row FROM ${db(table)} t WHERE id = ANY(${ids}) ORDER BY id`
        : selected === "lenders"
          ? await db`SELECT to_jsonb(t) AS row FROM ${db(table)} t WHERE activity_year = 2025 AND lei = ANY(${leis}) ORDER BY lei`
          : await db`SELECT to_jsonb(t) AS row FROM ${db(table)} t WHERE activity_year = 2025 AND lei = ANY(${leis}) ORDER BY id`;
      return found.map((item) => item.row as JsonRow);
    };
    return { institutions: await rows("institution_sources", "institutions"), lenders: await rows("hmda_lenders", "lenders"),
      originations: await rows("hmda_lender_originations", "cells"), costs: await rows("hmda_lender_loan_costs", "cells") };
  }

  async function wholeEstate() {
    const all: Record<string, unknown> = {};
    for (const table of ["institution_sources", "institution_lei_links", "hmda_lenders", "hmda_lender_originations", "hmda_lender_loan_costs", "agent_run_events"]) {
      all[table] = (await db`SELECT to_jsonb(t) AS row FROM ${db(table)} t ORDER BY to_jsonb(t)::text`).map((item) => item.row);
    }
    return stableJson(all);
  }

  async function unrelatedRows() {
    const ids = manifest.cohort.map((bank) => bank.institutionId);
    const leis = manifest.cohort.map((bank) => bank.lei);
    const all: Record<string, unknown> = {};
    all.institutions = (await db`SELECT to_jsonb(t) AS row FROM institution_sources t WHERE NOT (id = ANY(${ids})) ORDER BY id`).map((row) => row.row);
    all.links = (await db`SELECT to_jsonb(t) AS row FROM institution_lei_links t ORDER BY institution_id`).map((row) => row.row);
    for (const table of ["hmda_lenders", "hmda_lender_originations", "hmda_lender_loan_costs"]) {
      all[table] = (await db`SELECT to_jsonb(t) AS row FROM ${db(table)} t
        WHERE NOT (activity_year = 2025 AND lei = ANY(${leis})) ORDER BY to_jsonb(t)::text`).map((row) => row.row);
    }
    return stableJson(all);
  }

  function params(mode: "preview" | "apply" | "rollback" = "apply", extra: Record<string, unknown> = {}) {
    return { source: "hoovie.hmda-identity-repair", mode, manifest_digest: digest,
      ...(mode === "preview" ? {} : { authorization_reference: "local-fixture-authorization-only" }), ...extra };
  }

  async function ledger(parameters: Record<string, unknown>) {
    await db`INSERT INTO agent_runs (id, agent_name, run_kind, status, trigger_source, triggered_by, params_json)
      VALUES (${activeRunId}, 'hoovie', 'manual_repair', 'running', 'admin', 'admin:7', ${JSON.stringify(parameters)}::jsonb)
      ON CONFLICT (id) DO UPDATE SET status = 'running', cancel_requested_at = NULL, params_json = EXCLUDED.params_json`;
    await db`INSERT INTO agent_run_steps (id, agent_run_id, step_key, agent_name, title, status, input_payload)
      VALUES (${activeStepId}, ${activeRunId}, 'hmda-identity-repair', 'hoovie', 'HMDA identity repair', 'running', ${JSON.stringify(parameters)}::jsonb)
      ON CONFLICT (id) DO UPDATE SET status = 'running', input_payload = EXCLUDED.input_payload`;
  }

  async function execute(parameters = params(), database = db) {
    vi.resetModules();
    vi.doMock("./hmda-repair-manifest", () => ({ HMDA_REPAIR_MANIFEST: manifest,
      HMDA_REPAIR_MANIFEST_DIGEST: digest, stableHmdaJson: stableJson, hashHmdaJson: hash }));
    vi.doMock("./hmda-repair-source", () => ({ readHmdaRepairSource: vi.fn(async () => {
      sourceReads += 1;
      if (!sourceAvailable) throw new Error("fixture publisher unavailable");
      return source;
    }) }));
    vi.doMock("./hmda-repair-release", () => ({ HMDA_REPAIR_WRITES_ENABLED: writesEnabled }));
    const { executeHmdaIdentityRepair } = await import("./hmda-identity-repair");
    return executeHmdaIdentityRepair({ db: database as unknown as RegistryDb, runId: activeRunId, stepId: activeStepId, params: parameters });
  }

  beforeEach(async () => {
    await db`TRUNCATE agent_run_events, agent_run_steps, agent_runs, institution_lei_links,
      hmda_lenders, hmda_lender_originations, hmda_lender_loan_costs, institution_sources RESTART IDENTITY CASCADE`;
    writesEnabled = true;
    activeRunId = RUN_ID;
    activeStepId = STEP_ID;
    sourceAvailable = true;
    sourceReads = 0;
    manifest = structuredClone(reviewedManifest);
    source = { url: manifest.sourceUrl, sha256: SOURCE_SHA, index: manifest.sourceIndex,
      identities: manifest.cohort.map((row) => ({ certificate: row.certificate, lei: row.lei, rssdId: row.sourceRssd })) };
    let originationIndex = 0;
    let costIndex = 0;
    for (const bank of manifest.cohort) {
      await db`INSERT INTO institution_sources (id, institution_name, source, cert_number, rssd_id, regulatory_status, registry_synced_at)
        VALUES (${bank.institutionId}, ${bank.name}, 'fdic', ${bank.certificate}, ${bank.sourceRssd}, 'active', '2026-10-14T02:22:22.123456Z')`;
      await db`INSERT INTO hmda_lenders (activity_year, lei, raw_json, source_url, agent_run_id, fetched_at)
        VALUES (2025, ${bank.lei}, '{"preserved_source_fact":"panel-unavailable"}', 'https://source.example/original', 88, '2026-10-18T07:42:49.109166Z')`;
      for (let index = 0; index < bank.originationRows; index += 1) {
        await db`INSERT INTO hmda_lender_originations (id, activity_year, lei, state_code, county_fips, msa_md,
          originations, origination_amount, purchase_count, purchase_amount, refinance_count, refinance_amount, source_url, agent_run_id, fetched_at)
          VALUES (${manifest.guards.originations.ids[originationIndex++]}, 2025, ${bank.lei}, ${bank.states[index % bank.states.length]},
            ${String(index).padStart(5, '0')}, ${String(index).padStart(5, '0')}, 3, 120000.12, 1, 40000.04, 2, 80000.08,
            'https://source.example/original-lar', 88, '2026-10-18T07:42:49.109166Z')`;
      }
      for (let index = 0; index < bank.costRows; index += 1) {
        await db`INSERT INTO hmda_lender_loan_costs (id, activity_year, lei, state_code, msa_md, originations,
          total_loan_costs_n, total_loan_costs_median, origination_charges_n, origination_charges_median,
          discount_points_n, discount_points_median, lender_credits_n, lender_credits_median, cost_detail, source_url, agent_run_id, fetched_at)
          VALUES (${manifest.guards.costs.ids[costIndex++]}, 2025, ${bank.lei}, ${bank.states[index % bank.states.length]}, ${String(index).padStart(5, '0')},
            3, 3, 5000.25, 3, 1250.50, 3, 25.75, 3, 0, '{"sample":"preserve"}', 'https://source.example/original-lar', 88,
            '2026-10-18T07:42:49.109166Z')`;
      }
    }
    await db`INSERT INTO institution_sources (id, institution_name, source, cert_number, rssd_id, lei)
      VALUES (99999, 'Unrelated lender', 'fdic', '99999', '99999', ${OUTSIDE_LEI})`;
    await db`INSERT INTO hmda_lenders (activity_year, lei, institution_id, match_method, raw_json)
      VALUES (2024, ${manifest.cohort[0].lei}, 99999, 'lei', '{"unrelated":true}'), (2025, ${OUTSIDE_LEI}, 99999, 'lei', '{}')`;
    await db`INSERT INTO hmda_lender_originations (id, activity_year, lei, state_code, institution_id,
      originations, origination_amount, purchase_count, purchase_amount, refinance_count, refinance_amount)
      VALUES (999999, 2024, ${manifest.cohort[0].lei}, 'CA', 99999, 1, 100, 1, 100, 0, 0),
             (999998, 2025, ${OUTSIDE_LEI}, 'CA', 99999, 1, 100, 1, 100, 0, 0)`;
    await db`INSERT INTO hmda_lender_loan_costs (id, activity_year, lei, state_code, institution_id,
      originations, total_loan_costs_n, origination_charges_n, discount_points_n, lender_credits_n)
      VALUES (999999, 2024, ${manifest.cohort[0].lei}, 'CA', 99999, 1, 1, 1, 1, 1),
             (999998, 2025, ${OUTSIDE_LEI}, 'CA', 99999, 1, 1, 1, 1, 1)`;
    const before = await snapshot();
    for (const key of ["institutions", "lenders", "originations", "costs"] as const) manifest.guards[key].sha256 = hash(before[key]);
    manifest.guards.originations.sourceFactsSha256 = hash(before.originations.map((row) => without(row, ["institution_id"])));
    manifest.guards.costs.sourceFactsSha256 = hash(before.costs.map((row) => without(row, ["institution_id"])));
    manifest.preimageSha256 = hash(before);
    digest = hash(manifest);
    await ledger(params());
  });

  it("previews the exact 10/10/85/39 scope without writing data or a repair event", async () => {
    await ledger(params("preview"));
    const before = await wholeEstate();
    const readOnly = postgres(connection!, { ssl: false, max: 1, prepare: false,
      connection: { search_path: schema, default_transaction_read_only: true }, types: { json: JSON_TEXT_PASSTHROUGH } });
    try {
      const result = await execute(params("preview"), readOnly);
      expect(result.detail).toMatchObject({ mode: "preview", writes: 0, eligible: true, counts: manifest.fixedBounds });
    } finally { await readOnly.end(); }
    expect(await wholeEstate()).toBe(before);
  });

  it("fails closed while the actual release gate is off", async () => {
    const actual = await vi.importActual<typeof import("./hmda-repair-release")>("./hmda-repair-release");
    expect(actual.HMDA_REPAIR_WRITES_ENABLED).toBe(false);
    writesEnabled = false;
    const before = await wholeEstate();
    await expect(execute()).rejects.toThrow(/disabled|not enabled|gate|off/i);
    expect(await wholeEstate()).toBe(before);
  });

  it("applies only the exact identities and freezes an atomic before/after receipt", async () => {
    const before = await snapshot();
    const unrelatedBefore = await unrelatedRows();
    const result = await execute();
    expect(result.detail).toMatchObject({ mode: "apply", writes: 144, replayed: false, counts: manifest.fixedBounds });
    const after = await snapshot();
    expect(after.institutions).toHaveLength(10);
    expect(after.lenders).toHaveLength(10);
    expect(after.originations).toHaveLength(85);
    expect(after.costs).toHaveLength(39);
    for (const bank of manifest.cohort) {
      expect(after.institutions.find((row) => row.id === bank.institutionId)?.lei).toBe(bank.lei);
      expect(after.lenders.find((row) => row.lei === bank.lei)).toMatchObject({ institution_id: bank.institutionId, match_method: "lei" });
      for (const row of [...after.originations, ...after.costs].filter((row) => row.lei === bank.lei)) expect(row.institution_id).toBe(bank.institutionId);
    }
    expect(after.institutions.map((row) => without(row, ["lei"]))).toEqual(before.institutions.map((row) => without(row, ["lei"])));
    for (const key of ["originations", "costs"] as const) {
      expect(after[key].map((row) => without(row, ["institution_id"]))).toEqual(before[key].map((row) => without(row, ["institution_id"])));
    }
    for (const [index, row] of after.lenders.entries()) {
      expect(without(row, ["institution_id", "match_method", "raw_json"]))
        .toEqual(without(before.lenders[index], ["institution_id", "match_method", "raw_json"]));
      const bank = manifest.cohort.find((item) => item.lei === row.lei)!;
      expect(row.raw_json).toMatchObject({ preserved_source_fact: "panel-unavailable", feeinsight_identity: {
        reason: "exact_lei", institutionId: bank.institutionId, manifest_digest: digest, repair_run_id: RUN_ID,
        source_url: manifest.sourceUrl, source_sha256: SOURCE_SHA,
        evidence: expect.arrayContaining([expect.objectContaining({ kind: "institution_lei", institutionId: bank.institutionId,
          source: "fdic", certNumber: bank.certificate })]),
      } });
    }
    const events = await db`SELECT event_type, detail FROM agent_run_events`;
    expect(events).toHaveLength(1);
    expect(events[0].event_type).toBe("hmda.identity_repair.applied");
    expect(events[0].detail).toMatchObject({ manifest_digest: digest, before, after });
    expect(await unrelatedRows()).toBe(unrelatedBefore);
  });

  it.each(["added cell", "removed cell", "changed metric", "existing identity"])("aborts all writes on %s drift", async (kind) => {
    if (kind === "added cell") await db`INSERT INTO hmda_lender_originations (activity_year, lei, state_code, county_fips,
      originations, origination_amount, purchase_count, purchase_amount, refinance_count, refinance_amount)
      VALUES (2025, ${manifest.cohort[0].lei}, 'ZZ', '99999', 1, 100, 1, 100, 0, 0)`;
    if (kind === "removed cell") await db`DELETE FROM hmda_lender_loan_costs WHERE id = ${manifest.guards.costs.ids[0]}`;
    if (kind === "changed metric") await db`UPDATE hmda_lender_originations SET origination_amount = origination_amount + 1 WHERE id = ${manifest.guards.originations.ids[0]}`;
    if (kind === "existing identity") await db`UPDATE hmda_lenders SET institution_id = 99999, match_method = 'lei' WHERE activity_year = 2025 AND lei = ${manifest.cohort[0].lei}`;
    const before = await wholeEstate();
    await expect(execute()).rejects.toThrow(/drift|preimage|count|scope|hash|identity/i);
    expect(await wholeEstate()).toBe(before);
  });

  it.each(["source hash", "shared source LEI", "changed source RSSD", "competing canonical LEI"])("holds the repair on %s", async (kind) => {
    if (kind === "source hash") source.sha256 = "0".repeat(64);
    if (kind === "shared source LEI") source.identities.push({ ...source.identities[0], certificate: "999999" });
    if (kind === "changed source RSSD") source.identities[0].rssdId = "123456789";
    if (kind === "competing canonical LEI") await db`UPDATE institution_sources SET lei = ${manifest.cohort[0].lei} WHERE id = 99999`;
    const before = await wholeEstate();
    await expect(execute()).rejects.toThrow(/source|hash|ambig|identity|match|canonical/i);
    expect(await wholeEstate()).toBe(before);
  });

  it.each(["accepted key disagrees with own LEI", "ambiguous review candidate", "selected institution key conflict"])("holds canonical conflict: %s", async (kind) => {
    const selected = kind === "selected institution key conflict";
    const institutionId = selected ? manifest.cohort[0].institutionId : 99999;
    const lei = selected ? OUTSIDE_LEI : manifest.cohort[0].lei;
    if (kind === "ambiguous review candidate") {
      await db`INSERT INTO institution_lei_links (institution_id, status, match_basis, candidate_leis)
        VALUES (${institutionId}, 'ambiguous', 'rssd', ${[lei]})`;
    } else {
      await db`INSERT INTO institution_lei_links (institution_id, status, lei, match_basis, match_key)
        VALUES (${institutionId}, 'linked', ${lei}, 'rssd', '99999')`;
    }
    const before = await wholeEstate();
    await expect(execute()).rejects.toThrow(/match|conflict|canonical|identity/i);
    expect(await wholeEstate()).toBe(before);
  });

  it.each(["cancelled", "step not running", "params changed", "step params changed", "missing authorization", "scheduled run", "wrong run kind", "missing admin identity"])("rejects a stale ledger envelope: %s", async (kind) => {
    if (kind === "cancelled") await db`UPDATE agent_runs SET cancel_requested_at = NOW() WHERE id = ${RUN_ID}`;
    if (kind === "step not running") await db`UPDATE agent_run_steps SET status = 'queued' WHERE id = ${STEP_ID}`;
    if (kind === "params changed") await db`UPDATE agent_runs SET params_json = '{}' WHERE id = ${RUN_ID}`;
    if (kind === "step params changed") await db`UPDATE agent_run_steps SET input_payload = '{}' WHERE id = ${STEP_ID}`;
    if (kind === "scheduled run") await db`UPDATE agent_runs SET trigger_source = 'schedule' WHERE id = ${RUN_ID}`;
    if (kind === "wrong run kind") await db`UPDATE agent_runs SET run_kind = 'workflow' WHERE id = ${RUN_ID}`;
    if (kind === "missing admin identity") await db`UPDATE agent_runs SET triggered_by = 'admin:not-a-numeric-user' WHERE id = ${RUN_ID}`;
    const parameters = params();
    if (kind === "missing authorization") { delete parameters.authorization_reference; await ledger(parameters); }
    const before = await wholeEstate();
    await expect(execute(parameters)).rejects.toThrow(/ledger|running|cancel|params|authorization|envelope|manifest/i);
    expect(await wholeEstate()).toBe(before);
  });

  it("holds the bounded repair behind the same annual advisory lock used by ordinary HMDA ingestion", async () => {
    const holder = postgres(connection!, { ssl: false, max: 1, prepare: false,
      connection: { search_path: schema }, types: { json: JSON_TEXT_PASSTHROUGH } });
    let release!: () => void;
    let acquired!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const locked = new Promise<void>((resolve) => { acquired = resolve; });
    const transaction = holder.begin(async (raw) => {
      const tx = raw as unknown as RegistryDb;
      await tx`SELECT pg_advisory_xact_lock(2253::int, 2025::int)`;
      acquired();
      await held;
    });
    await locked;
    const before = await wholeEstate();
    try { await expect(execute()).rejects.toMatchObject({ code: "55P03" }); }
    finally { release(); await transaction; await holder.end(); }
    expect(await wholeEstate()).toBe(before);
  });

  it("prevents a non-cooperating writer from inserting an unreviewed child while the repair owns its table locks", async () => {
    const writer = postgres(connection!, { ssl: false, max: 1, prepare: false,
      connection: { search_path: schema }, types: { json: JSON_TEXT_PASSTHROUGH } });
    let release!: () => void;
    let acquired!: () => void;
    const held = new Promise<void>((resolve) => { release = resolve; });
    const locked = new Promise<void>((resolve) => { acquired = resolve; });
    // Pause after the real LOCK TABLE statement, leaving PostgreSQL's locks in force.
    const pausedDb = new Proxy(db, { get(target, property, receiver) {
      if (property !== "begin") return Reflect.get(target, property, receiver);
      return (callback: (tx: RegistryDb) => Promise<unknown>) => target.begin(async (raw) => callback(new Proxy(raw as unknown as RegistryDb, {
        apply(tag, thisArg, args) {
          const query = Reflect.apply(tag, thisArg, args);
          if (Array.isArray(args[0]) && args[0].join(" ").includes("LOCK TABLE")) return (async () => {
            await query;
            acquired();
            await held;
            return [];
          })();
          return query;
        },
      }) as unknown as RegistryDb));
    } });
    const execution = execute(params(), pausedDb);
    await Promise.race([locked, execution.then(() => { throw new Error("Repair completed before acquiring table locks"); })]);
    try {
      await expect(writer.begin(async (raw) => {
        const tx = raw as unknown as RegistryDb;
        await tx`SET LOCAL lock_timeout = '250ms'`;
        await tx`INSERT INTO hmda_lender_originations (activity_year, lei, state_code, county_fips,
          originations, origination_amount, purchase_count, purchase_amount, refinance_count, refinance_amount)
          VALUES (2025, ${manifest.cohort[0].lei}, 'ZZ', '99999', 1, 100, 1, 100, 0, 0)`;
      })).rejects.toMatchObject({ code: "55P03" });
    } finally { release(); await execution; await writer.end(); }
    expect((await snapshot()).originations).toHaveLength(85);
    expect(await db`SELECT id FROM hmda_lender_originations WHERE state_code = 'ZZ'`).toHaveLength(0);
  });

  it("rolls back every mutation when the receipt cannot be saved", async () => {
    const before = await wholeEstate();
    await db.unsafe(`CREATE FUNCTION reject_repair_receipt() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'fixture repair receipt failure'; END $$`);
    await db.unsafe(`CREATE TRIGGER reject_repair_receipt BEFORE INSERT ON agent_run_events
      FOR EACH ROW EXECUTE FUNCTION reject_repair_receipt()`);
    try { await expect(execute()).rejects.toThrow("fixture repair receipt failure"); }
    finally { await db.unsafe("DROP TRIGGER reject_repair_receipt ON agent_run_events"); await db.unsafe("DROP FUNCTION reject_repair_receipt()"); }
    expect(await wholeEstate()).toBe(before);
  });

  it("detects and rolls back source metric changes caused by a database trigger", async () => {
    const before = await wholeEstate();
    await db.unsafe(`CREATE FUNCTION alter_repair_metric() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN NEW.origination_amount := NEW.origination_amount + 1; RETURN NEW; END $$`);
    await db.unsafe(`CREATE TRIGGER alter_repair_metric BEFORE UPDATE ON hmda_lender_originations
      FOR EACH ROW EXECUTE FUNCTION alter_repair_metric()`);
    try { await expect(execute()).rejects.toThrow(/post-write|facts|transaction|differ/i); }
    finally { await db.unsafe("DROP TRIGGER alter_repair_metric ON hmda_lender_originations"); await db.unsafe("DROP FUNCTION alter_repair_metric()"); }
    expect(await wholeEstate()).toBe(before);
  });

  it("recovers a committed apply receipt on replay instead of writing the cohort twice", async () => {
    await execute();
    const beforeReplay = await wholeEstate();
    sourceAvailable = false;
    expect((await execute()).detail).toMatchObject({ mode: "apply", writes: 0, replayed: true });
    expect(sourceReads).toBe(1);
    expect(await wholeEstate()).toBe(beforeReplay);
  });

  it("restores exact before-images with an audited rollback and safely replays it", async () => {
    const before = await snapshot();
    await execute();
    const [applied] = await db`SELECT id FROM agent_run_events WHERE event_type = 'hmda.identity_repair.applied'`;
    const rollback = params("rollback", { apply_event_id: Number(applied.id) });
    activeRunId += 100;
    activeStepId += 100;
    await ledger(rollback);
    sourceAvailable = false;
    expect((await execute(rollback)).detail).toMatchObject({ mode: "rollback", writes: 144, replayed: false });
    expect(sourceReads).toBe(1);
    expect(await snapshot()).toEqual(before);
    const events = await db`SELECT event_type, detail FROM agent_run_events ORDER BY id`;
    expect(events.map((event) => event.event_type)).toEqual(["hmda.identity_repair.applied", "hmda.identity_repair.rolled_back"]);
    expect(events[1].detail).toMatchObject({ manifest_digest: digest, apply_event_id: Number(applied.id) });
    const replay = await wholeEstate();
    expect((await execute(rollback)).detail).toMatchObject({ mode: "rollback", writes: 0, replayed: true });
    expect(await wholeEstate()).toBe(replay);
  });

  it("refuses rollback after any selected row changed following the apply receipt", async () => {
    await execute();
    const [applied] = await db`SELECT id FROM agent_run_events WHERE event_type = 'hmda.identity_repair.applied'`;
    await db`UPDATE hmda_lender_loan_costs SET total_loan_costs_median = 9999 WHERE id = ${manifest.guards.costs.ids[0]}`;
    const rollback = params("rollback", { apply_event_id: Number(applied.id) });
    activeRunId += 100;
    activeStepId += 100;
    await ledger(rollback);
    const before = await wholeEstate();
    await expect(execute(rollback)).rejects.toThrow(/drift|after|hash|changed|snapshot/i);
    expect(await wholeEstate()).toBe(before);
  });

  it("rejects an apply receipt whose stored before-images were altered", async () => {
    await execute();
    const [applied] = await db`SELECT id FROM agent_run_events WHERE event_type = 'hmda.identity_repair.applied'`;
    await db`UPDATE agent_run_events SET detail = jsonb_set(detail, '{before,originations,0,originations}', '99999') WHERE id = ${applied.id}`;
    const rollback = params("rollback", { apply_event_id: Number(applied.id) });
    activeRunId += 100;
    activeStepId += 100;
    await ledger(rollback);
    const before = await wholeEstate();
    await expect(execute(rollback)).rejects.toThrow(/preimage|receipt|drift|rowset/i);
    expect(await wholeEstate()).toBe(before);
  });
});
