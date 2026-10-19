// @vitest-environment node
/** Executes the production reader against connection-local copies of the current schema. */
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ db: null as postgres.Sql | null }));
vi.mock("./connection", () => ({
  sql: new Proxy(() => {}, {
    apply: (_target, _this, args) => Reflect.apply(state.db!, state.db, args),
    get: (_target, key) => {
      const value = Reflect.get(state.db!, key);
      return typeof value === "function" ? value.bind(state.db) : value;
    },
  }),
}));
import { getSegmentFeeValues } from "./fee-index";
import { getMarketStudyData } from "./market-study";

const connection = process.env.E2E_DATABASE_URL;
const filter = { minAssets: null, maxAssets: null, charterType: null, stateCode: null, largest: null };

describe.skipIf(!connection)("segment stated prices in PostgreSQL (#1993)", () => {
  let db: postgres.Sql;
  beforeAll(async () => {
    if (!connection || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(connection).hostname)) throw new Error("Segment SQL tests require an owned loopback database");
    db = postgres(connection, { max: 1, ssl: "require" });
    state.db = db;
    for (const table of ["institution_sources", "published_fee_catalog", "agent_source_texts", "institution_branch_deposits", "demographics"]) {
      // Retain actual column types without any public sequence/default/trigger writes.
      await db.unsafe(`CREATE TEMP TABLE ${table} AS SELECT * FROM public.${table} WITH NO DATA`);
    }
  });
  afterAll(async () => { if (db) await db.end(); state.db = null; });
  beforeEach(async () => {
    await db`TRUNCATE institution_sources, published_fee_catalog, agent_source_texts, institution_branch_deposits, demographics`;
    await db`INSERT INTO institution_sources (id, institution_name, charter_type, regulatory_status, asset_size, state_code) VALUES
      (1,'Example Bank','bank','active',1000000,'TX'), (2,'Free Bank','bank','active',2000000,'TX'),
      (3,'Single Bank','bank','active',3000000,'TX'), (4,'Closed Bank','bank','inactive',4000000,'TX'),
      (5,'Business Bank','bank','active',5000000,'TX')`;
    await db`INSERT INTO published_fee_catalog (id,fee_published_id,institution_id,fee_category,fee_name,amount,frequency,fee_audience,review_status,source_document_id,document_url,source_url,created_at) VALUES
      (11,11,1,'money_order','Personal money order',1.65,'per_item','consumer','approved',101,'https://example.test/personal.pdf','https://example.test/personal.pdf','2026-10-01'),
      (12,12,1,'money_order','Postal money order',5,'per_item','consumer','approved',102,'https://example.test/postal.pdf','https://example.test/postal.pdf','2026-10-02'),
      (21,21,2,'money_order','Money order',0,'per_item','consumer','approved',201,'https://free.test/fees.pdf','https://free.test/fees.pdf','2026-10-01'),
      (31,31,3,'money_order','Money order',3,'per_item','consumer','approved',301,'https://single.test/fees.pdf','https://single.test/fees.pdf','2026-10-01'),
      (41,41,4,'money_order','Money order',90,'per_item','consumer','approved',401,'https://closed.test/fees.pdf','https://closed.test/fees.pdf','2026-10-01'),
      (51,51,5,'money_order','Money order',70,'per_item','business','approved',501,'https://business.test/business-fees.pdf','https://business.test/business-fees.pdf','2026-10-01')`;
  });

  it("keeps the institution median while carrying every named source price and document", async () => {
    const result = await getSegmentFeeValues(filter, "money_order", null);
    const bank = result.values.find(v => v.institution_id === 1)!;
    expect(bank.amount).toBeCloseTo(3.325);
    expect(bank.several).toEqual({ low: 1.65, high: 5, fees: [{ name: "Personal money order", amount: 1.65 }, { name: "Postal money order", amount: 5 }] });
    expect(bank.fee_records).toEqual([
      { id: 11, amount: 1.65, fee_name: "Personal money order", frequency: "per_item", fee_audience: "consumer", source_document_id: 101, document_url: "https://example.test/personal.pdf" },
      { id: 12, amount: 5, fee_name: "Postal money order", frequency: "per_item", fee_audience: "consumer", source_document_id: 102, document_url: "https://example.test/postal.pdf" },
    ]);
  });

  it("preserves eligible population, actual zero and ordinary one-price rows", async () => {
    const result = await getSegmentFeeValues(filter, "money_order", null);
    expect(result.institutionsInSegment).toBe(4);
    expect(result.values.map(v => [v.institution_id, v.amount]).sort((a,b) => a[0]-b[0])).toEqual([[1,3.325],[2,0],[3,3]]);
    expect(result.values.find(v => v.institution_id === 2)?.several).toBeUndefined();
    expect(result.values.find(v => v.institution_id === 3)?.several).toBeUndefined();
    expect((await getSegmentFeeValues(filter, "cashiers_check", null)).values).toEqual([]);
  });

  it("deduplicates repeated named lines only for display, without changing the numerical reduction", async () => {
    await db`INSERT INTO published_fee_catalog SELECT * FROM published_fee_catalog WHERE id=11`;
    const bank = (await getSegmentFeeValues(filter, "money_order", null)).values.find(v => v.institution_id===1)!;
    expect(bank.amount).toBe(1.65);
    expect(bank.several?.fees).toHaveLength(2);
    expect(bank.fee_published_ids).toEqual([11,12]);
  });

  it("retains a zero median from unequal source-row weighting alongside its paid source price", async () => {
    await db`UPDATE published_fee_catalog SET amount=0 WHERE id=11`;
    await db`INSERT INTO published_fee_catalog SELECT * FROM published_fee_catalog WHERE id=11`;
    const bank = (await getSegmentFeeValues(filter, "money_order", null)).values.find(v => v.institution_id === 1)!;
    expect(bank.amount).toBe(0);
    expect(bank.several).toEqual({ low:0, high:5, fees:[{name:"Personal money order",amount:0},{name:"Postal money order",amount:5}] });
  });

  it("retains overdraft's highest-tier policy instead of inventing a new range policy", async () => {
    await db`UPDATE published_fee_catalog SET fee_category='overdraft' WHERE institution_id=1`;
    const bank = (await getSegmentFeeValues(filter,"overdraft",null)).values[0];
    expect(bank.amount).toBe(5);
    expect(bank.several).toBeUndefined();
    expect(bank.fee_records).toHaveLength(2);
  });

  it("preserves source/audience eligibility and subject exclusion", async () => {
    await db`UPDATE published_fee_catalog SET source_document_id=NULL WHERE institution_id=3`;
    const result=await getSegmentFeeValues(filter,"money_order",null,1);
    expect(result.ownInSegment).toBe(true);
    expect(result.institutionsInSegment).toBe(3);
    expect(result.values.map(v=>v.institution_id)).toEqual([2]);
  });

  it("keeps shared-schedule counting and does not turn a real median price into a single-price claim", async () => {
    await db`UPDATE institution_sources SET holding_company_rssd='123' WHERE id IN (1,2)`;
    await db`UPDATE published_fee_catalog SET document_url='https://example.test/personal.pdf' WHERE institution_id=2`;
    await db`INSERT INTO published_fee_catalog SELECT * FROM published_fee_catalog WHERE id=12`;
    const result = await getSegmentFeeValues(filter,"money_order",null);
    expect(result.values.find(v=>v.institution_id===1)).toMatchObject({ amount:5, several:{low:1.65,high:5} });
    expect(result.values.find(v=>v.institution_id===2)).toMatchObject({ amount:0, counted_as:1 });
  });

  it("preserves the market-study SQL median while projecting named prices and all their sources", async () => {
    await db`UPDATE published_fee_catalog SET fee_category='atm_non_network'`;
    await db`UPDATE published_fee_catalog SET amount=2.5, fee_name='ATM A' WHERE id=11`;
    await db`UPDATE published_fee_catalog SET amount=3, fee_name='ATM B' WHERE id=12`;
    await db`INSERT INTO institution_branch_deposits (institution_id,cert,branch_name,city,county_fips,year,deposits) VALUES
      (1,1,'Main','Test',42001,2026,100), (2,2,'Main','Test',42001,2026,200), (3,3,'Main','Test',42001,2026,300)`;
    const market = await getMarketStudyData(2,"42001");
    const fee = market!.fees.find(f=>f.category==='atm_non_network')!;
    expect(fee.subject).toBe(0);
    expect(fee.competitors.find(c=>c.institution_id===1)).toEqual({ institution_id:1, amount:2.75,
      several: { low:2.5, high:3, fees:[{name:'ATM A',amount:2.5},{name:'ATM B',amount:3}] },
      documentUrls: ['https://example.test/personal.pdf','https://example.test/postal.pdf'] });
  });
});
