// @vitest-environment node
/**
 * Knox's re-read floor (Nov 2, `KNOX_REREAD_BELOW_VERSION`) in real Postgres: the extract step's
 * selection (`textArtifactQuery`) and Bayes's queue count (`countKnoxRereadsDue`) after a rules bump
 * past the floor. The rules version is mocked one above today's, so a text read at the floor counts
 * as "read by an older version". Every fixture runs in a transaction that is rolled back. Needs only a
 * disposable loopback database with the production schema. No provider or network call.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/data-store/connection", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/data-store/connection")>()),
  sql: vi.fn(),
}));
// A rules bump past the floor: today's version + 1 (always above the floor, whatever today's version is).
vi.mock("@/lib/agents/knox/specialists", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agents/knox/specialists")>();
  return { ...actual, KNOX_RULES_STRATEGY: { ...actual.KNOX_RULES_STRATEGY, version: actual.KNOX_RULES_STRATEGY.version + 1 } };
});

const connection = process.env.E2E_DATABASE_URL;
type Db = typeof import("@/lib/data-store/connection").sql;

describe.skipIf(!connection)("Knox re-read floor in real Postgres (Nov 2)", () => {
  let db: postgres.Sql;
  let extract: typeof import("./extract");
  let specialists: typeof import("./specialists");
  let recheck: typeof import("@/lib/agents/hamilton/rules-recheck");
  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname))
      throw new Error("Re-read floor DB tests require a disposable loopback database");
    db = postgres(connection, { max: 1, ssl: process.env.E2E_DATABASE_SSL === "disable" ? false : "require", onnotice: () => {} });
    extract = await import("./extract");
    specialists = await import("./specialists");
    recheck = await import("@/lib/agents/hamilton/rules-recheck");
    // extract.ts loads the whole free team; under a parallel run its import alone can pass 10 s.
  }, 60_000);
  afterAll(async () => { if (db) await db.end(); });

  async function rollback(test: (tx: Db) => Promise<void>) {
    const stop = new Error("rollback re-read floor fixture");
    await db.begin(async (scope) => { await test(scope as unknown as Db); throw stop; }).catch((error) => { if (error !== stop) throw error; });
  }

  const LARGE = 990_001;
  const SMALL = 990_002;
  // One current copy and its text per case: [document id, institution, text hash].
  const texts = {
    heldAtFloor: [991_001, LARGE, "floor-held"],
    refreshDue: [991_002, LARGE, "floor-refresh"],
    belowFloor: [991_003, LARGE, "floor-below"],
    behindLiveStale: [991_004, SMALL, "floor-live-stale"],
    missingFees: [991_005, SMALL, "floor-missing"],
  } as const;

  async function seed(tx: Db) {
    const floor = extract.KNOX_REREAD_BELOW_VERSION;
    // Only "above the floor" matters: a later rules bump must not break this fixture.
    expect(specialists.KNOX_RULES_STRATEGY.version).toBeGreaterThan(floor);
    await tx`INSERT INTO institution_sources (id, institution_name, charter_type, source, state_code, asset_size)
             VALUES (${LARGE}, 'Floor Large Bank', 'bank', 'test', 'ZZ', 20000000),
                    (${SMALL}, 'Floor Small CU', 'credit_union', 'test', 'ZZ', 100000)`;
    for (const [doc, inst, hash] of Object.values(texts)) {
      await tx`INSERT INTO source_documents (id, institution_id, status) VALUES (${doc}, ${inst}, 'fetched')`;
      await tx`INSERT INTO agent_source_texts (id, source_document_id, institution_id, status, normalized_text, char_count, text_hash)
               VALUES (${doc}, ${doc}, ${inst}, 'completed', ${`Fee schedule ${hash}`}, 40, ${hash})`;
    }
    const read = async (key: keyof typeof texts, version: number, daysAgo: number) => {
      const [doc, inst, hash] = texts[key];
      await tx`INSERT INTO pipeline_attempts (institution_id, source_document_id, stage, strategy, strategy_version, input_fingerprint, outcome, created_at)
               VALUES (${inst}, ${doc}, 'extract', 'extract.rules', ${version}, ${hash}, 'ok', NOW() - make_interval(days => ${daysAgo}::int))`;
    };
    await read("heldAtFloor", floor, 2);
    await read("refreshDue", floor, extract.KNOX_REREAD_REFRESH_DAYS + 6);
    await read("belowFloor", floor - 1, 1);
    await read("behindLiveStale", 50, 30);
    await read("missingFees", floor, 1);
    // A live fee on the small CU's stale page.
    const [doc, inst, hash] = texts.behindLiveStale;
    const [raw] = await tx<Array<{ fee_raw_id: number }>>`
      INSERT INTO raw_fee_observations (institution_id, fee_name, agent_event_id, source, source_document_id, amount, extraction_note, outlier_flags)
      VALUES (${inst}, 'Overdraft fee', gen_random_uuid(), 'knox', ${doc}, 30, ${`text_hash=${hash};canonical_hint=overdraft;`}, '[]'::jsonb)
      RETURNING fee_raw_id`;
    const [verified] = await tx<Array<{ fee_verified_id: number }>>`
      INSERT INTO verified_fee_observations (fee_raw_id, institution_id, verified_by_agent_event_id, canonical_fee_key, fee_name, amount)
      VALUES (${raw.fee_raw_id}, ${inst}, gen_random_uuid(), 'overdraft', 'Overdraft fee', 30)
      RETURNING fee_verified_id`;
    await tx`INSERT INTO published_fee_records (fee_name, lineage_ref, institution_id, canonical_fee_key, published_by_adversarial_event_id, amount)
             VALUES ('Overdraft fee', ${verified.fee_verified_id}, ${inst}, 'overdraft', gen_random_uuid(), 30)`;
    // Hamilton's rules re-check found fees today's rules read that are not live on the missing-fees page.
    const [missingDoc, missingInst] = texts.missingFees;
    await tx`INSERT INTO pipeline_attempts (institution_id, source_document_id, stage, strategy, strategy_version, input_fingerprint, outcome, detail)
             VALUES (${missingInst}, ${missingDoc}, 'publish', ${recheck.RULES_RECHECK_STRATEGY.strategy}, ${recheck.RULES_RECHECK_STRATEGY.version},
                     ${recheck.knoxFreeSignature()}, 'ok', ${tx.json({ [recheck.MISSING_FEES_DETAIL]: 2 })})`;
  }

  const ids = (rows: Array<{ document_text_id: number | string }>) => rows.map((row) => Number(row.document_text_id));

  it("holds a page read at the floor inside the refresh window and reads the rest, behind-live oldest first", async () => {
    await rollback(async (tx) => {
      await seed(tx);
      const { query, params } = extract.textArtifactQuery(50, true, true, undefined, "ZZ", []);
      const rows = await tx.unsafe<Array<{ document_text_id: number }>>(query, params as never[]);
      const picked = ids(rows);
      expect(picked).not.toContain(texts.heldAtFloor[0]);
      expect(new Set(picked)).toEqual(new Set([texts.refreshDue[0], texts.belowFloor[0], texts.behindLiveStale[0], texts.missingFees[0]]));
      // Behind live fees and read longest ago goes first, ahead of the $10B+ bank's pages.
      expect(picked[0]).toBe(texts.behindLiveStale[0]);
    });
  });

  it("reads every page of a requested institution once per version, floor or not", async () => {
    await rollback(async (tx) => {
      await seed(tx);
      const { query, params } = extract.textArtifactQuery(50, true, true, LARGE, undefined, [LARGE]);
      const picked = ids(await tx.unsafe<Array<{ document_text_id: number }>>(query, params as never[]));
      expect(new Set(picked)).toEqual(new Set([texts.heldAtFloor[0], texts.refreshDue[0], texts.belowFloor[0]]));
    });
  });

  it("Bayes's queue is the selection's own count, and the floor's hold is counted beside it", async () => {
    await rollback(async (tx) => {
      // Counts are global, so the fixture is measured as what it adds to the database's own rows.
      const before = await extract.countKnoxRereadsDue(tx);
      await seed(tx);
      const after = await extract.countKnoxRereadsDue(tx);
      // The four pages the selection reads (refresh due, below the floor, behind live, missing fees).
      expect(after.due - before.due).toBe(4);
      // The page read at the floor two days ago.
      expect(after.heldByFloor - before.heldByFloor).toBe(1);
    });
  });
});
