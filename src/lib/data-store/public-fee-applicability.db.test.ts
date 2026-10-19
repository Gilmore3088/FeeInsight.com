// @vitest-environment node
/** Current production column types + actual catalog view over connection-local test rows. */
import { createHash } from "node:crypto";
import postgres from "postgres";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ db: null as postgres.Sql | null }));
vi.mock("./connection", () => ({
  getSql: () => state.db!,
  sql: new Proxy(() => {}, {
    apply: (_target, _this, args) => Reflect.apply(state.db!, state.db, args),
    get: (_target, key) => { const v = Reflect.get(state.db!, key); return typeof v === "function" ? v.bind(state.db) : v; },
  }),
}));
import { getFeeRowDetails, getIndexRows } from "./fees";
import { getFeeEvidence } from "./fee-evidence";
import { listedPriceLines } from "@/app/(public)/fees/(index)/listed-prices";
import { InstitutionRow } from "@/app/(public)/fees/(index)/institution-row";
import { companion, countedAs, findings, histogram, institutionsFor, statsFor } from "@/app/(public)/fees/(index)/index-view";

const connection = process.env.E2E_DATABASE_URL;
const tables = ["institution_sources", "source_documents", "agent_source_texts", "published_fee_records", "verified_fee_observations", "raw_fee_observations", "published_fee_corrections", "pipeline_feedback"];
const hash = (text: string) => createHash("sha256").update(text).digest("hex");

describe.skipIf(!connection)("canonical public fee applicability in PostgreSQL (#2207)", () => {
  let db: postgres.Sql;
  beforeAll(async () => {
    if (!connection || !["127.0.0.1", "localhost", "[::1]"].includes(new URL(connection).hostname)) throw new Error("Public applicability SQL tests require an owned loopback fixture");
    db = postgres(connection, { max: 1, ssl: "require", onnotice: () => undefined });
    state.db = db;
    for (const table of tables) await db.unsafe(`CREATE TEMP TABLE ${table} AS SELECT * FROM public.${table} WITH NO DATA`);
    const [row] = await db`SELECT pg_get_viewdef('public.published_fee_catalog'::regclass, true) AS definition`;
    let definition = String(row.definition);
    if (!definition.includes("published_fee_corrections")) throw new Error("Load the current production-schema correction overlay fixture first");
    for (const table of tables) definition = definition.replaceAll(`public.${table}`, `pg_temp.${table}`);
    await db.unsafe(`CREATE TEMP VIEW published_fee_catalog AS ${definition}`);
  });
  afterAll(async () => { if (db) await db.end(); state.db = null; });
  beforeEach(async () => {
    for (const table of tables) await db.unsafe(`TRUNCATE ${table}`);
    await db`INSERT INTO institution_sources (id,institution_name,charter_type,state_code,regulatory_status) VALUES
      (1,'Example Bank','bank','TX','active'),(2,'Closed Bank','bank','TX','inactive'),(3,'Unknown-status Bank','bank','TX',NULL)`;
    const fixtures = [
      { id: 11, inst: 1, category: "money_order", product: "Alpha", amount: 5 },
      { id: 12, inst: 1, category: "money_order", product: "Beta", amount: 5 },
      { id: 13, inst: 1, category: "money_order", product: null, amount: 5 },
      { id: 14, inst: 1, category: "money_order", product: " alpha ", amount: 5 },
      { id: 21, inst: 1, category: "overdraft", product: null, amount: 30 },
      { id: 22, inst: 1, category: "stop_payment", product: null, amount: 20 },
      ...[2, 3].flatMap(inst => ["money_order", "overdraft", "stop_payment"].map((category, i) => ({ id: inst * 20 + i + 1, inst, category, product: null, amount: 9 }))),
    ];
    for (const f of fixtures) {
      const url = `https://example.test/${f.id}.pdf`, doc = f.id + 300;
      const text = `${f.product ?? "Accounts"}\nMoney order | $${f.amount}`;
      await db`INSERT INTO source_documents (id,institution_id,document_url) VALUES (${doc},${f.inst},${url})`;
      await db`INSERT INTO agent_source_texts (id,institution_id,source_document_id,status,normalized_text,text_hash,char_count,created_at) VALUES
        (${f.id + 400},${f.inst},${doc},'completed',${text},${hash(text)},${text.length},'2026-09-01')`;
      await db`INSERT INTO raw_fee_observations (fee_raw_id,institution_id,source_document_id,source_url,product_name,conditions,extraction_note) VALUES
        (${f.id + 200},${f.inst},${doc},${url},${f.product},'Available only to existing account holders.',NULL)`;
      await db`INSERT INTO verified_fee_observations (fee_verified_id,fee_raw_id,institution_id) VALUES (${f.id + 100},${f.id + 200},${f.inst})`;
      await db`INSERT INTO published_fee_records (fee_published_id,lineage_ref,institution_id,canonical_fee_key,fee_name,amount,frequency,amount_kind,fee_audience,fee_treatment,published_at) VALUES
        (${f.id},${f.id + 100},${f.inst},${f.category},'Money order',${f.amount},'per_item','flat','consumer','standard','2026-10-01')`;
    }
  });

  it("projects represented applicability and same-SELECT source/lineage context", async () => {
    const details = await getFeeRowDetails([11, 12, 13, 14]);
    expect(details.get(11)).toMatchObject({ account: "Alpha", fee_audience: "consumer", fee_treatment: "standard", amount_kind: "flat",
      context: { version: 1, stamp: expect.stringMatching(/^[a-f0-9]{64}$/), publishedId: 11, institutionId: 1, category: "money_order", amount: 5, verifiedId: 111, rawId: 211, sourceDocumentId: 311 } });
    expect(details.get(12)?.account).toBe("Beta");
    expect(details.get(13)?.account).toBeNull();
  });

  it("binds matched price context to its selected catalog row and actual text artifact", async () => {
    const evidence = await getFeeEvidence([11]);
    expect(evidence.get(11)).toMatchObject({ context: { version: 1, publishedId: 11, sourceDocumentId: 311 }, text_artifact: { id: 411, institutionId: 1, sourceDocumentId: 311, status: "completed", textHash: hash("Alpha\nMoney order | $5") } });
  });

  it("keeps the exact active/statistical population, values and schedules", async () => {
    const rows = (await getIndexRows("money_order")).sort((a, b) => a.id - b.id);
    expect(rows.map(r => [r.id, r.institution_id, r.amount])).toEqual([[11,1,5],[12,1,5],[13,1,5],[14,1,5],[61,3,9]]);
    expect(rows[0].schedule_keys).toEqual(["u:example.test/11.pdf"]);
    await getFeeRowDetails(rows.map(r => r.id));
    await getFeeEvidence(rows.map(r => r.id));
    expect((await getIndexRows("money_order")).sort((a,b) => a.id-b.id)).toEqual(rows);
  });

  it("uses the canonical correction's condition and document while retaining represented ownership", async () => {
    await db`INSERT INTO source_documents (id,institution_id,document_url) VALUES (901,1,'https://example.test/corrected.pdf')`;
    await db`INSERT INTO published_fee_corrections (id,fee_published_id,institution_id,status,conditions,source_document_id) VALUES
      (801,11,1,'current','Only the corrected condition.',901)`;
    expect((await getFeeRowDetails([11])).get(11)).toMatchObject({ account: "Alpha", conditions: "Only the corrected condition.", document_url: "https://example.test/corrected.pdf" });
  });

  async function publicView() {
    const rows = await getIndexRows("money_order"), inst = institutionsFor(rows, "money_order", null, "all").find(i => i.id === 1)!;
    const ids = rows.filter(r => r.institution_id === 1).map(r => r.id);
    const details = await getFeeRowDetails(ids), evidence = await getFeeEvidence(ids);
    const prices = rows.filter(r => r.institution_id === 1).map(r => ({ id: r.id, amount: r.amount, detail: details.get(r.id) ?? null, evidence: evidence.get(r.id) ?? null }));
    return { rows, prices, inst, html: renderToStaticMarkup(createElement(InstitutionRow, { inst, prices, category: "money_order", counted: countedAs("money_order") })) };
  }

  it("carries the actual canonical reader through grouping and rendering without dropping a product or source", async () => {
    const { prices, html } = await publicView();
    expect(listedPriceLines(prices, { institutionId: 1, category: "money_order" }).map(l => l.observations.map(p => p.id))).toEqual([[11,14],[12],[13]]);
    expect(html).toContain("Alpha"); expect(html).toContain("Beta"); expect(html).toContain("Account/product not recorded");
    for (const id of [11,12,13,14]) expect(html).toContain(`https://example.test/${id}.pdf`);
    expect(html).toContain("3 applicability lines"); expect(html).toContain("4 of 4 stored price contexts linked");
    expect(html).toContain("Recorded publication Oct 1, 2026");
    expect(html).toContain("Available only to existing account holders.");
  });

  it("keeps a correction between the evidence reader's two queries bound to the ORIGINAL selected tuple", async () => {
    const original = (await getFeeRowDetails([11])).get(11)!;
    let changed = false;
    state.db = new Proxy(db, { get(target, key) {
      if (key === "unsafe") return async (query: string, params: never[]) => {
        const selected = await target.unsafe(query, params);
        if (!changed && query.includes("FROM published_fee_catalog ef")) {
          changed = true;
          await db`INSERT INTO source_documents (id,institution_id,document_url) VALUES (901,1,'https://example.test/corrected.pdf')`;
          await db`INSERT INTO published_fee_corrections (id,fee_published_id,institution_id,status,conditions,source_document_id) VALUES
            (801,11,1,'current','Only the corrected condition.',901)`;
        }
        return selected;
      };
      const value = Reflect.get(target, key); return typeof value === "function" ? value.bind(target) : value;
    } });
    let old;
    try { old = (await getFeeEvidence([11])).get(11)!; }
    finally { state.db = db; }
    const current = (await getFeeRowDetails([11])).get(11)!;
    expect(changed).toBe(true);
    expect(old.context?.stamp).toBe(original.context?.stamp);
    expect(current.context?.stamp).not.toBe(original.context?.stamp);
    const [line] = listedPriceLines([{ id: 11, amount: 5, detail: current, evidence: old }], { institutionId: 1, category: "money_order" });
    expect(line.observations[0].evidence).toBeNull();
    expect(line.detail?.conditions).toBe("Only the corrected condition.");
    expect(line.detail?.document_url).toBe("https://example.test/corrected.pdf");
  });

  it.each([
    ["raw_fee_observations", "fee_raw_id", 211, "product_name", "Beta"],
    ["raw_fee_observations", "fee_raw_id", 211, "conditions", "Changed own condition"],
    ["raw_fee_observations", "fee_raw_id", 211, "extraction_note", 'excerpt="Changed Money order | $5"'],
    ["raw_fee_observations", "fee_raw_id", 211, "source_document_id", 312],
    ["published_fee_records", "fee_published_id", 11, "source_url", "https://example.test/another.pdf"],
    ["published_fee_records", "fee_published_id", 11, "fee_name", "Postal money order"],
    ["published_fee_records", "fee_published_id", 11, "frequency", "monthly"],
    ["published_fee_records", "fee_published_id", 11, "fee_audience", "business"],
    ["published_fee_records", "fee_published_id", 11, "fee_treatment", "conditional"],
    ["published_fee_records", "fee_published_id", 11, "variant_type", "tiered"],
    ["published_fee_records", "fee_published_id", 11, "rate_percent", 1],
    ["published_fee_records", "fee_published_id", 11, "rate_min_amount", 1],
    ["published_fee_records", "fee_published_id", 11, "rate_max_amount", 10],
    ["published_fee_records", "fee_published_id", 11, "rate_basis", "transaction_amount"],
    ["published_fee_records", "fee_published_id", 11, "lineage_ref", 112],
    ["published_fee_records", "fee_published_id", 11, "amount", 7],
    ["published_fee_records", "fee_published_id", 11, "canonical_fee_key", "stop_payment"],
    ["published_fee_records", "fee_published_id", 11, "institution_id", 3],
    ["published_fee_records", "fee_published_id", 11, "published_at", "2026-10-02"],
  ])("invalidates the prior price-context receipt when %s.%s=%s changes %s", async (table, idKey, id, field, value) => {
    const old = (await getFeeEvidence([11])).get(11)!;
    await db.unsafe(`UPDATE ${table} SET ${field}=$1 WHERE ${idKey}=$2`, [value,id] as never[]);
    const current = (await getFeeRowDetails([11])).get(11)!;
    expect(current.context?.stamp).toMatch(/^[a-f0-9]{64}$/);
    expect(current.context?.stamp).not.toBe(old.context?.stamp);
    const projected: Record<string, unknown> = { product_name:current.account, conditions:current.conditions, source_url:current.source_url,
      fee_name:current.fee_name, frequency:current.frequency, fee_audience:current.fee_audience, fee_treatment:current.fee_treatment,
      variant_type:current.variant_type, rate_percent:current.rate_percent, rate_min_amount:current.rate_min_amount,
      rate_max_amount:current.rate_max_amount, rate_basis:current.rate_basis, amount:current.amount,
      lineage_ref:current.context?.verifiedId, source_document_id:current.context?.sourceDocumentId,
      canonical_fee_key:current.context?.category, institution_id:current.context?.institutionId, published_at:current.read_on };
    // The existing date projection is session-local; a timestamp change need not change its date.
    if (field !== "extraction_note" && field !== "published_at") expect(projected[field]).toEqual(value);
    expect(listedPriceLines([{ id:11, amount:5, detail:current, evidence:old }], { institutionId:1, category:"money_order" })[0].observations[0].evidence).toBeNull();
  });

  it.each(["artifact institution", "artifact document", "source owner", "hash"])("leaves a wrong %s unknown", async (kind) => {
    if (kind === "artifact institution") await db`UPDATE agent_source_texts SET institution_id=2 WHERE id=411`;
    if (kind === "artifact document") await db`UPDATE agent_source_texts SET source_document_id=312 WHERE id=411`;
    if (kind === "source owner") await db`UPDATE source_documents SET institution_id=2 WHERE id=311`;
    if (kind === "hash") await db`UPDATE agent_source_texts SET text_hash=${"f".repeat(64)} WHERE id=411`;
    expect((await getFeeEvidence([11])).get(11)).toBeNull();
  });

  it("keeps an extraction-note fallback separate from the later text artifact", async () => {
    const text = "No schedule prices in this stored text.";
    await db`UPDATE agent_source_texts SET normalized_text=${text},text_hash=${hash(text)} WHERE id=411`;
    await db`UPDATE raw_fee_observations SET extraction_note='Knox deterministic extraction from Rosetta artifact #99. excerpt="Money order | $5"' WHERE fee_raw_id=211`;
    const e = (await getFeeEvidence([11])).get(11)!;
    expect(e).toMatchObject({ basis:"stored_line", text_artifact:null, context:{ publishedId:11 } });
    const { html } = await publicView();
    expect(html).toContain("Stored extraction excerpt; original text version unavailable.");
    expect(html).not.toContain("text version #411");
  });

  it("does not turn a same-document Beta heading into proof of Alpha applicability", async () => {
    const text = "Beta Checking\n\nMoney order | $5";
    await db`UPDATE agent_source_texts SET normalized_text=${text},text_hash=${hash(text)} WHERE id=411`;
    const { html } = await publicView();
    expect(html).toContain("Alpha"); expect(html).toContain("Matched text heading: Beta Checking");
    expect(html).toContain("Relationship to the recorded account and conditions is not established");
    expect(html).not.toContain("verified");
  });

  it("keeps held/rate rows out of the canonical read and treats their stale index context as unavailable", async () => {
    const old = (await getFeeEvidence([11,12])).get(11)!;
    await db`UPDATE published_fee_records SET quarantined_at=now() WHERE fee_published_id=11`;
    await db`UPDATE published_fee_records SET amount_kind='percentage' WHERE fee_published_id=12`;
    const current = await getFeeRowDetails([11,12]);
    expect(current.size).toBe(0);
    expect((await getIndexRows("money_order")).map(r => r.id)).not.toContain(11);
    expect((await getIndexRows("money_order")).map(r => r.id)).not.toContain(12);
    const lines = listedPriceLines([{ id:11, amount:5, detail:current.get(11) ?? null, evidence:old }], { institutionId:1, category:"money_order" });
    expect(lines[0].detail).toBeNull(); expect(lines[0].observations[0].evidence).toBeNull();
  });

  it("keeps complete customer conditions while stripping pipeline-only notes at the actual reader", async () => {
    await db`UPDATE raw_fee_observations SET conditions='Customer condition. Knox deterministic extraction from Rosetta artifact #99. canonical_hint=money_order; text_hash=ab; excerpt="Money order | $5"' WHERE fee_raw_id=211`;
    const { html } = await publicView();
    expect(html).toContain("Condition: Customer condition");
    expect(html).not.toContain("canonical_hint="); expect(html).not.toContain("Rosetta artifact");
  });

  it("leaves index reductions/population/shared schedule counting exactly unchanged", async () => {
    await db`UPDATE institution_sources SET holding_company_rssd='999' WHERE id IN (1,3)`;
    await db`UPDATE raw_fee_observations SET source_url='https://example.test/11.pdf' WHERE fee_raw_id=261`;
    const before = (await getIndexRows("money_order")).sort((a,b) => a.id-b.id);
    const sel = { fee:"money_order", state:null, charter:"all" as const };
    const snapshot = () => { const institutions = institutionsFor(before,sel.fee,sel.state,sel.charter); return { stats:statsFor(before,sel.fee,sel.state,sel.charter), institutions, bins:histogram(institutions), companion:companion(before,sel), findings:findings(before,sel,institutions) }; };
    const expected = snapshot();
    expect(expected.institutions.map(i => [i.id,i.shared,i.value])).toEqual([[1,1,5]]);
    await publicView();
    expect((await getIndexRows("money_order")).sort((a,b) => a.id-b.id)).toEqual(before);
    expect(snapshot()).toEqual(expected);
  });
});
