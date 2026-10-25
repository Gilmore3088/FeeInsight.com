// @vitest-environment node
import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ schema: "" }));
vi.mock("@/lib/data-store/call-item-storage", () => ({
  callItemFactsRelation: async () => `${state.schema}.call_report_item_facts`,
  compactCallStorageReady: async () => true,
}));
import { exportCallPeriod } from "./storage-tiers";
import { pruneCallPeriod, restoreCallPeriod } from "./call-period-prune";
import { decodeColdFile, type ColdStore } from "./cold-files";
import { runStorageCompaction } from "./storage-compaction";
import { JSON_TEXT_PASSTHROUGH } from "@/lib/data-store/connection";
import { HMDA_COST_FIELDS } from "@/lib/regulatory/hmda";
import { unpackHmdaCosts } from "@/lib/regulatory/hmda-cost-storage";

const url = process.env.E2E_DATABASE_URL;
describe.skipIf(!url)("public-data compaction and atomic archive", () => {
  let db: ReturnType<typeof postgres>;
  let store: ColdStore;
  let objects: Map<string, Uint8Array>;
  const schema = `storage_test_${randomBytes(6).toString("hex")}`;
  const old = "2020-03-31";
  beforeAll(async () => {
    if (!url || !["localhost","127.0.0.1","[::1]"].includes(new URL(url).hostname)) throw new Error("Loopback PostgreSQL only");
    state.schema = schema;
    db = postgres(url, { max: 1, onnotice: () => {}, connection: { search_path: schema }, types: { json: JSON_TEXT_PASSTHROUGH } });
    // Local PostgreSQL does not install Supabase's standard roles. No login or grants are added.
    await db.unsafe(`DO $roles$ BEGIN
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='anon') THEN CREATE ROLE anon NOLOGIN; END IF;
      IF NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='authenticated') THEN CREATE ROLE authenticated NOLOGIN; END IF;
    END $roles$`);
    await db.unsafe(`CREATE SCHEMA ${schema}`);
    await db.unsafe(`CREATE TABLE ${schema}.institution_sources(id bigint PRIMARY KEY,source text,rssd_id text,cert_number text,ncua_charter_id text);
      INSERT INTO ${schema}.institution_sources VALUES(1,'fdic','101','1',NULL),(2,'ncua',NULL,'202','202');
      CREATE TABLE ${schema}.institution_call_report_items (
        id bigserial PRIMARY KEY,institution_id bigint NOT NULL,source text NOT NULL,report_date date NOT NULL,
        item_code text NOT NULL,item_key text NOT NULL,item_description text,schedule text,value numeric NOT NULL,
        unit text NOT NULL,period_basis text NOT NULL,source_url text,agent_run_id bigint,fetched_at timestamptz NOT NULL DEFAULT now(),
        UNIQUE(institution_id,source,report_date,item_key));
      CREATE TABLE ${schema}.institution_financial_records(id bigint);
      CREATE TABLE ${schema}.public_data_cold_files (
        id bigserial PRIMARY KEY,table_name text,source text,period text,bucket text,object_key text,format text,columns text[],
        row_count bigint,byte_size bigint,sha256 text,hot_bytes_estimate bigint,agent_run_id bigint,
        written_at timestamptz DEFAULT now(),verified_at timestamptz,pruned_at timestamptz,UNIQUE(table_name,source,period));
      CREATE TABLE ${schema}.hmda_lender_loan_costs(id bigserial PRIMARY KEY,activity_year int,cost_detail jsonb);
      CREATE TABLE ${schema}.agent_run_steps(id bigint,step_key text);
      CREATE TABLE ${schema}.agent_run_events(id bigint,step_id bigint,event_type text,status text,detail jsonb);`);
    const migration = readFileSync("supabase/migrations/20270110000078_public_data_storage_compaction.sql","utf8")
      .replaceAll("public.",`${schema}.`).replaceAll("search_path=pg_catalog,public",`search_path=pg_catalog,${schema}`);
    await db.begin((tx) => tx.unsafe(migration));
  });
  afterAll(async () => { if (db) { await db.unsafe(`DROP SCHEMA ${schema} CASCADE`); await db.end(); } });
  beforeEach(async () => {
    await db.unsafe(`TRUNCATE ${schema}.institution_call_report_items,${schema}.public_data_cold_files,${schema}.hmda_lender_loan_costs RESTART IDENTITY`);
    objects = new Map();
    store = { configured: true, bucket: "test", async put(k,v) { objects.set(k,v); }, async get(k) {
      const v=objects.get(k); if(!v) throw new Error("missing object"); return v;
    } };
  });
  const input = (description = "Deposit service charges", value = "100") => [{
    rssd: "101",item_key: "service_charges_deposits_ytd",item_code: "RIAD4080",item_description: description,
    schedule: "RI",value,unit: "thousands",period_basis: "ytd",
  }];
  async function upsert(rows = input(), date=old) {
    const [result] = await db.unsafe(`SELECT ${schema}.upsert_call_report_item_batch('ffiec',$1::date,'https://official.example/filing',7,$2::text::jsonb) AS n`,[date,JSON.stringify(rows)]);
    return Number(result.n);
  }
  async function seedHistory() {
    await upsert();
    for(let year=2021;year<=2023;year++) for(const day of ["03-31","06-30","09-30","12-31"]) await upsert(input(),`${year}-${day}`);
  }
  it("stores definitions once, preserves source values and suppresses unchanged writes", async () => {
    expect(await upsert()).toBe(1);
    const [before] = await db.unsafe(`SELECT id,fetched_at FROM ${schema}.institution_call_report_items`);
    expect(await upsert()).toBe(0);
    const [after] = await db.unsafe(`SELECT id,fetched_at,item_description,schedule FROM ${schema}.institution_call_report_items`);
    expect(after).toMatchObject({ ...before,item_description:null,schedule:null });
    expect(await upsert(input("Revised description","120.25"))).toBe(1);
    const [fact] = await db.unsafe(`SELECT id,item_description,schedule,value FROM ${schema}.call_report_item_facts`);
    expect(fact).toMatchObject({ id:before.id,item_description:"Revised description",schedule:"RI",value:"120.25" });
  });
  it("compacts historical metadata without changing amounts, ids or observation times", async () => {
    await db.unsafe(`INSERT INTO ${schema}.institution_call_report_items(institution_id,source,report_date,item_code,item_key,item_description,schedule,value,unit,period_basis)
      VALUES(1,'ffiec','2020-03-31','X','x','Original',NULL,0,'count','point_in_time')`);
    const [before] = await db.unsafe(`SELECT row_to_json(c) AS row FROM ${schema}.call_report_item_facts c`);
    await db.unsafe(`SELECT * FROM ${schema}.compact_call_report_item_metadata(0,100)`);
    const [after] = await db.unsafe(`SELECT row_to_json(c) AS row FROM ${schema}.call_report_item_facts c`);
    expect(after).toEqual(before);
    await db.unsafe(`SELECT * FROM ${schema}.expand_call_report_item_metadata(0,100)`);
    const [expanded] = await db.unsafe(`SELECT row_to_json(c) AS row FROM ${schema}.call_report_item_facts c`);
    expect(expanded).toEqual(before);
  });
  it("exports, verifies and atomically prunes; retries are idempotent and re-ingestion stays blocked", async () => {
    await seedHistory();
    const exported = await db.begin((tx) => exportCallPeriod(tx as unknown as Parameters<typeof exportCallPeriod>[0],store,{source:"ffiec",period:old,avgRowBytes:400}));
    expect(exported.status).toBe("exported");
    const result=await db.begin((tx) => pruneCallPeriod(tx as unknown as Parameters<typeof pruneCallPeriod>[0],store,{source:"ffiec",period:old}));
    expect(result).toEqual({deleted:1,status:"pruned"});
    expect(decodeColdFile(objects.get(exported.objectKey!)!).rows[0]).toMatchObject({item_description:"Deposit service charges",value:"100"});
    expect(await upsert()).toBe(0);
    expect(await db.begin((tx) => pruneCallPeriod(tx as unknown as Parameters<typeof pruneCallPeriod>[0],store,{source:"ffiec",period:old}))).toEqual({deleted:0,status:"already_pruned"});
  });
  it("holds a changed period without deleting or changing its index", async () => {
    await seedHistory();
    await db.begin((tx) => exportCallPeriod(tx as unknown as Parameters<typeof exportCallPeriod>[0],store,{source:"ffiec",period:old,avgRowBytes:400}));
    await upsert(input("Deposit service charges","200"));
    await expect(db.begin((tx) => pruneCallPeriod(tx as unknown as Parameters<typeof pruneCallPeriod>[0],store,{source:"ffiec",period:old}))).rejects.toThrow("differs");
    const [row]=await db.unsafe(`SELECT pruned_at FROM ${schema}.public_data_cold_files`);
    expect(row.pruned_at).toBeNull();
    expect(await db.unsafe(`SELECT id FROM ${schema}.institution_call_report_items WHERE report_date=$1::date`,[old])).toHaveLength(1);
  });
  it("keeps POR filing identity hot while archiving the financial detail", async () => {
    await seedHistory();
    const metadata = [{...input()[0],item_key:"filing_fdic_cert",item_code:"POR_FDIC_CERT",value:"101",unit:"count",period_basis:"point_in_time"}];
    expect(await upsert(metadata)).toBe(1);
    await db.begin((tx) => exportCallPeriod(tx as unknown as Parameters<typeof exportCallPeriod>[0],store,{source:"ffiec",period:old,avgRowBytes:400}));
    expect(await db.begin((tx) => pruneCallPeriod(tx as unknown as Parameters<typeof pruneCallPeriod>[0],store,{source:"ffiec",period:old}))).toEqual({deleted:1,status:"pruned"});
    const kept=await db.unsafe(`SELECT item_key FROM ${schema}.institution_call_report_items WHERE report_date=$1::date`,[old]);
    expect(kept).toEqual([{item_key:"filing_fdic_cert"}]);
    expect(await upsert([{...metadata[0],value:"102"}])).toBe(1);
    expect(await upsert()).toBe(0);
  });
  it("restores the original financial ids, exact values and microsecond timestamps atomically", async () => {
    await seedHistory();
    await db.unsafe(`UPDATE ${schema}.institution_call_report_items SET fetched_at='2020-04-01T12:34:56.123456Z' WHERE report_date=$1::date`,[old]);
    const [before]=await db.unsafe(`SELECT row_to_json(c) AS row FROM ${schema}.call_report_item_facts c WHERE report_date=$1::date`,[old]);
    await db.begin((tx) => exportCallPeriod(tx as unknown as Parameters<typeof exportCallPeriod>[0],store,{source:"ffiec",period:old,avgRowBytes:400}));
    await db.begin((tx) => pruneCallPeriod(tx as unknown as Parameters<typeof pruneCallPeriod>[0],store,{source:"ffiec",period:old}));
    expect(await db.begin((tx) => restoreCallPeriod(tx as unknown as Parameters<typeof restoreCallPeriod>[0],store,{source:"ffiec",period:old}))).toBe(1);
    const [after]=await db.unsafe(`SELECT row_to_json(c) AS row FROM ${schema}.call_report_item_facts c WHERE report_date=$1::date`,[old]);
    expect(after).toEqual(before);
    expect(await db.begin((tx) => restoreCallPeriod(tx as unknown as Parameters<typeof restoreCallPeriod>[0],store,{source:"ffiec",period:old}))).toBe(0);
  });
  it("bounds historical HMDA conversion, retains malformed data and excludes the pinned repair year", async () => {
    const costs=Object.fromEntries(HMDA_COST_FIELDS.map((key)=>[key,{n:2,median:12.5,p25:0,p75:25,exempt:0,na:1,blank:0,unreadable:0,negative:0}]));
    await db`INSERT INTO hmda_lender_loan_costs(activity_year,cost_detail) VALUES(2019,${JSON.stringify(costs)}::jsonb),(2025,${JSON.stringify(costs)}::jsonb),(2018,'{}'::jsonb)`;
    expect((await runStorageCompaction(db as unknown as Parameters<typeof runStorageCompaction>[0])).live).toBe(false);
    const result=await db.begin(async(tx)=>{
      // The production-qualified function is installed in this test's isolated schema.
      const wrap=(scope:unknown):Parameters<typeof runStorageCompaction>[0]=>{
        const tag=(strings:TemplateStringsArray,...values:unknown[])=>{
          const parts=strings.map((part)=>part.replaceAll("public.compact_call_report_item_metadata",`${schema}.compact_call_report_item_metadata`));
          const template=Object.assign(parts,{raw:parts});
          return Reflect.apply(scope as (...args:unknown[])=>unknown,null,[template,...values]);
        };
        return Object.assign(tag,{savepoint:(callback:(s:unknown)=>unknown)=>(scope as {savepoint:(fn:(s:unknown)=>unknown)=>unknown}).savepoint((s)=>callback(wrap(s)))}) as unknown as Parameters<typeof runStorageCompaction>[0];
      };
      return runStorageCompaction(wrap(tx),{live:true});
    });
    expect(result.error).toBeUndefined();
    expect(result.hmda).toMatchObject({changed:1,invalid:1});
    const rows=await db`SELECT activity_year,cost_detail FROM hmda_lender_loan_costs ORDER BY id`;
    expect(unpackHmdaCosts(rows[0].cost_detail)).toEqual(costs);
    expect(rows[1].cost_detail).toEqual(costs);
    expect(rows[2].cost_detail).toEqual({});
  });
});
