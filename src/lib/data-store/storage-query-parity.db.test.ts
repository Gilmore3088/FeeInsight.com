// @vitest-environment node
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { MIN_LINKING_TEXT_CHARS, scheduleGroupSql, scheduleKeysSql } from "./fee-stats";

const connection=process.env.E2E_DATABASE_URL;
describe.skipIf(!connection)("storage query optimizations preserve eligibility and schedule identity",()=>{
  let db:ReturnType<typeof postgres>;
  beforeAll(async()=>{
    if(!connection||!["localhost","127.0.0.1","[::1]"].includes(new URL(connection).hostname))throw new Error("Loopback only");
    db=postgres(connection,{max:1,onnotice:()=>{}});
    await db`CREATE TEMP TABLE institution_sources(id bigint PRIMARY KEY,asset_size bigint,charter_type text,regulatory_status text,holding_company_rssd text)`;
    await db`CREATE TEMP TABLE agent_source_texts(source_document_id bigint UNIQUE,text_hash text,char_count int)`;
    await db`CREATE TEMP TABLE published_fee_catalog(id bigint,institution_id bigint,source_document_id bigint,document_url text,review_status text)`;
    await db`INSERT INTO institution_sources VALUES(1,100,'bank',NULL,' 123 '),(2,200,'bank','inactive','0'),(3,300,'bank',NULL,NULL),(4,400,'credit_union',NULL,'')`;
    await db`INSERT INTO agent_source_texts VALUES(1,'long',500),(2,'short',10)`;
    await db`INSERT INTO published_fee_catalog VALUES(1,1,1,'https://www.bank.example/fees/#section','approved'),(2,1,2,NULL,'approved'),
      (3,2,1,'https://vendor.example/ezs3download/fee','approved'),(4,3,NULL,'https://b.example/fees','pending')`;
  });
  afterAll(async()=>{if(db)await db.end();});
  it("joined source text and holding-company values equal the correlated expressions",async()=>{
    const old=`SELECT ef.id,${scheduleKeysSql("ef",true)} AS keys,${scheduleGroupSql("ef",true)} AS grp FROM published_fee_catalog ef`;
    const next=`SELECT ef.id,${scheduleKeysSql("ef",true,"stats_text")} AS keys,NULLIF(NULLIF(btrim(ct.holding_company_rssd),''),'0') AS grp
      FROM published_fee_catalog ef JOIN institution_sources ct ON ct.id=ef.institution_id
      LEFT JOIN agent_source_texts stats_text ON stats_text.source_document_id=ef.source_document_id AND stats_text.char_count>=${MIN_LINKING_TEXT_CHARS}`;
    const [row]=await db.unsafe(`WITH a AS (${old}),b AS (${next}) SELECT count(*) AS n FROM ((SELECT * FROM a EXCEPT ALL SELECT * FROM b) UNION ALL (SELECT * FROM b EXCEPT ALL SELECT * FROM a)) difference`);
    expect(Number(row.n)).toBe(0);
  });
  it("materialized membership preserves inactive, unpublished and duplicate-fee handling",async()=>{
    const base="SELECT s.id FROM institution_sources s WHERE s.regulatory_status IS DISTINCT FROM 'inactive' AND ";
    const old=base+"EXISTS(SELECT 1 FROM published_fee_catalog p WHERE p.institution_id=s.id AND p.review_status='approved') ORDER BY s.id";
    const next=base+"s.id IN(WITH eligible AS MATERIALIZED(SELECT DISTINCT institution_id FROM published_fee_catalog WHERE review_status='approved') SELECT institution_id FROM eligible) ORDER BY s.id";
    expect(await db.unsafe(next)).toEqual(await db.unsafe(old));
    expect(await db.unsafe(next)).toEqual([{id:"1"}]);
  });
});
