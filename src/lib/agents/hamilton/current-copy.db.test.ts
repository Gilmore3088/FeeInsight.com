/** Retired-document pairing (`retiredCopiesSql`) against real PostgreSQL, using loopback-only temporary tables (#1200). */
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { countCurrentCopyPairs, retiredCopiesSql } from "./current-copy";

const connection = process.env.E2E_DATABASE_URL;
type Db = Parameters<typeof retiredCopiesSql>[0];

describe.skipIf(!connection)("Retired-document pairing in isolated PostgreSQL (#1200)", () => {
  let db: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Current-copy tests require a loopback E2E database; production connections are forbidden");
    }
    db = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    await db`CREATE TEMP TABLE institution_sources (id bigint PRIMARY KEY, state_code text, fee_schedule_url text)`;
    await db`CREATE TEMP TABLE institution_source_profiles (institution_id bigint PRIMARY KEY, canonical_source_url text)`;
    await db`CREATE TEMP TABLE institution_additional_sources (institution_id bigint, url text, status text)`;
    await db`CREATE TEMP TABLE source_documents (id bigint PRIMARY KEY, institution_id bigint, document_url text,
      superseded_by_id bigint, companion_source_id bigint, duplicate_of_id bigint, status text DEFAULT 'success')`;
    await db`CREATE TEMP TABLE agent_source_texts (source_document_id bigint, status text, normalized_text text)`;
    await db`CREATE TEMP TABLE raw_fee_observations (fee_raw_id bigint PRIMARY KEY, source_document_id bigint, product_name text)`;
    await db`CREATE TEMP TABLE verified_fee_observations (fee_verified_id bigint PRIMARY KEY, fee_raw_id bigint,
      canonical_fee_key text, amount numeric, rate_percent numeric, review_status text)`;
    await db`CREATE TEMP TABLE published_fee_records (fee_published_id bigint PRIMARY KEY, lineage_ref bigint,
      institution_id bigint, canonical_fee_key text, amount numeric, rate_percent numeric, rolled_back_at timestamptz)`;
    await db`CREATE TEMP TABLE pipeline_attempts (source_document_id bigint, stage text, strategy text, input_fingerprint text)`;
  });
  afterAll(async () => { if (db) await db.end(); });
  beforeEach(async () => {
    await db`TRUNCATE institution_sources, institution_source_profiles, institution_additional_sources, source_documents,
      agent_source_texts, raw_fee_observations, verified_fee_observations, published_fee_records, pipeline_attempts`;
  });

  /**
   * Bank 42 has one live fee on document 500 (an old page). Its saved fee link is /fees.pdf; its
   * plain fetch asks for the remembered /schedule-2026.pdf. Document 700 is a read copy of the
   * remembered page, 800 a read copy of the saved link.
   */
  async function seed(options: { remembered?: string | null; savedCopy?: boolean; rememberedCopy?: boolean } = {}) {
    const remembered = options.remembered === undefined ? "https://www.testbank.example/schedule-2026.pdf/" : options.remembered;
    await db`INSERT INTO institution_sources VALUES (42, 'TX', 'https://testbank.example/fees.pdf')`;
    if (remembered !== null) await db`INSERT INTO institution_source_profiles VALUES (42, ${remembered})`;
    await db`INSERT INTO source_documents (id, institution_id, document_url) VALUES (500, 42, 'https://testbank.example/old-fees.pdf')`;
    if (options.rememberedCopy !== false) {
      await db`INSERT INTO source_documents (id, institution_id, document_url) VALUES (700, 42, 'http://testbank.example/SCHEDULE-2026.pdf')`;
    }
    if (options.savedCopy !== false) {
      await db`INSERT INTO source_documents (id, institution_id, document_url) VALUES (800, 42, 'https://testbank.example/fees.pdf')`;
    }
    await db`INSERT INTO agent_source_texts SELECT id, 'completed', 'Fee Schedule' FROM source_documents`;
    await db`INSERT INTO raw_fee_observations VALUES (501, 500, NULL)`;
    await db`INSERT INTO verified_fee_observations VALUES (601, 501, 'overdraft', 35, NULL, 'verified')`;
    await db`INSERT INTO published_fee_records VALUES (701, 601, 42, 'overdraft', 35, NULL, NULL)`;
  }

  async function pairs(): Promise<Array<{ older: string; current: string }>> {
    const rows = await db`
      WITH live AS MATERIALIZED (
        SELECT fp.institution_id, fr.source_document_id AS older_document_id,
               sd.superseded_by_id, sd.companion_source_id, sd.document_url, inst.fee_schedule_url
          FROM published_fee_records fp
          JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
          JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
          JOIN source_documents sd ON sd.id = fr.source_document_id
          JOIN institution_sources inst ON inst.id = fp.institution_id
         WHERE fp.rolled_back_at IS NULL
      )
      ${retiredCopiesSql(db as unknown as Db)}
    `;
    return rows.map((row) => ({ older: String(row.older_document_id), current: String(row.current_document_id) }));
  }

  it("pairs a retired document with the copy at the address the plain fetch asks for, not the saved link's", async () => {
    // The saved link's copy is newer (higher id), but the bank is fetched at the remembered address.
    await seed();
    expect(await pairs()).toEqual([{ older: "500", current: "700" }]);
  });

  it("pairs with the fetch target's copy when the saved link has none (keyed on fee_schedule_url, this paired nothing)", async () => {
    await seed({ savedCopy: false });
    expect(await pairs()).toEqual([{ older: "500", current: "700" }]);
  });

  it("falls back to the saved link's copy when the fetch target has no read copy", async () => {
    await seed();
    await db`DELETE FROM agent_source_texts WHERE source_document_id = 700`;
    expect(await pairs()).toEqual([{ older: "500", current: "800" }]);
    await db`DELETE FROM agent_source_texts WHERE source_document_id = 800`;
    expect(await pairs()).toEqual([]);
  });

  it("reads the saved link as the fetch target when nothing is remembered (or the remembered address is blank)", async () => {
    await seed({ remembered: null, rememberedCopy: false });
    expect(await pairs()).toEqual([{ older: "500", current: "800" }]);
    await db`INSERT INTO institution_source_profiles VALUES (42, '  ')`;
    expect(await pairs()).toEqual([{ older: "500", current: "800" }]);
  });

  it("never retires the fetch target, the saved link, an additional source, a companion page or a superseded copy", async () => {
    await seed();
    await db`UPDATE source_documents SET document_url = 'https://testbank.example/schedule-2026.pdf' WHERE id = 500`;
    expect(await pairs()).toEqual([]);
    await db`UPDATE source_documents SET document_url = 'https://testbank.example/fees.pdf/' WHERE id = 500`;
    expect(await pairs()).toEqual([]);
    await db`UPDATE source_documents SET document_url = 'https://testbank.example/old-fees.pdf' WHERE id = 500`;
    expect(await pairs()).toEqual([{ older: "500", current: "700" }]);
    await db`INSERT INTO institution_additional_sources VALUES (42, 'https://testbank.example/old-fees.pdf', 'approved')`;
    expect(await pairs()).toEqual([]);
    await db`UPDATE institution_additional_sources SET status = 'rejected'`;
    expect(await pairs()).toEqual([{ older: "500", current: "700" }]);
    await db`UPDATE source_documents SET companion_source_id = 9 WHERE id = 500`;
    expect(await pairs()).toEqual([]);
    await db`UPDATE source_documents SET companion_source_id = NULL, superseded_by_id = 700 WHERE id = 500`;
    expect(await pairs()).toEqual([]);
  });

  it("skips a failed, duplicate or superseded copy at the fetch target", async () => {
    await seed({ savedCopy: false });
    await db`UPDATE source_documents SET status = 'failed' WHERE id = 700`;
    expect(await pairs()).toEqual([]);
    await db`UPDATE source_documents SET status = 'success', duplicate_of_id = 500 WHERE id = 700`;
    expect(await pairs()).toEqual([]);
    await db`UPDATE source_documents SET duplicate_of_id = NULL, superseded_by_id = 900 WHERE id = 700`;
    expect(await pairs()).toEqual([]);
  });

  it("counts the retired pair in Bayes's manifest", async () => {
    await seed();
    expect(await countCurrentCopyPairs(db as unknown as Db)).toEqual({ pairs: 1, done: 0, queued: 1, noText: 0 });
    // The fetch target's copy restates the fee: nothing is left to judge.
    await db`INSERT INTO raw_fee_observations VALUES (9701, 700, NULL)`;
    await db`INSERT INTO verified_fee_observations VALUES (9801, 9701, 'overdraft', 35, NULL, 'verified')`;
    expect(await countCurrentCopyPairs(db as unknown as Db)).toEqual({ pairs: 0, done: 0, queued: 0, noText: 0 });
  });
});
