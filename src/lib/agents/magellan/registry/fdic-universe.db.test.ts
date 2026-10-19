// @vitest-environment node
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import { JSON_TEXT_PASSTHROUGH } from "@/lib/data-store/connection";
import { runRegistryFdicUniverse } from "./fdic-universe";
import type { RegistryDb } from "./partitions";

const release = vi.hoisted(() => ({ FDIC_OWN_LEI_WRITES_ENABLED: true }));
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
    // Exercise the production identity reads/writes; unrelated district and receipt steps are stubbed.
    registryDb = ((strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join(" ");
      if (text.includes("registry_ingest_partitions")) {
        receipts.push(JSON.parse(String(values.find((value) => typeof value === "string" && value.startsWith("{")))));
        return Promise.resolve([]);
      }
      if (text.includes("WITH banks AS")) return Promise.resolve([]);
      return db(strings, ...values as postgres.ParameterOrFragment<never>[]);
    }) as unknown as RegistryDb;
  });

  beforeEach(async () => {
    release.FDIC_OWN_LEI_WRITES_ENABLED = true;
    await db`TRUNCATE institution_sources RESTART IDENTITY`;
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
    return runRegistryFdicUniverse({ db: registryDb, dryRun, fetchOptions: { fetchImpl, backoffMs: 0 } });
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
      ] }], conflicts: [] };
    expect(result.leiIdentity).toEqual(expected);
    expect(receipts[0].lei_identity).toEqual(expected);
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
    await db`INSERT INTO institution_sources (cert_number, source, lei)
      VALUES ('1', 'fdic', NULL), ('2', 'fdic', ${` ${knownLei.toLowerCase()} `})`;
    const result = await run([active(1, lei), active(2, thirdLei), active(3, knownLei)]);
    expect([...await db`SELECT cert_number, lei FROM institution_sources ORDER BY cert_number`]).toEqual([
      { cert_number: "1", lei: null }, { cert_number: "2", lei: ` ${knownLei.toLowerCase()} ` }, { cert_number: "3", lei: null },
    ]);
    expect(result.leiIdentity.unique_source_institutions).toBe(3);
    expect(result.leiIdentity.conflicts).toEqual([{ certificate: "2", stored_lei: ` ${knownLei.toLowerCase()} `, reported_lei: thirdLei }]);
    expect(receipts[0].own_lei_writes_enabled).toBe(false);
  });
});
