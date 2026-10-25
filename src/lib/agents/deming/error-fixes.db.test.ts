/**
 * The error loop (#2058) in real PostgreSQL, loopback only: the named rows, the re-run guard, the
 * direct-path requests and the ledger rows, against the production schema.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { KNOX_RULES_STRATEGY } from "@/lib/agents/knox/specialists";
import { errorFixRequests, runErrorFixRecheck, type ErrorFixEntry } from "./error-fixes";

const connection = process.env.E2E_DATABASE_URL;
const INST = 20580001, WAITING = 20580002, DOC = 20580101;
const EVENT = "00000000-0000-4000-8000-000020580001";
const KIND = "test_2058_named_error";
const FIX: ErrorFixEntry = { pr: 92058, issue: 2058, stage: "extract", merged_on: "2026-10-20", kinds: [KIND] };
type Db = Parameters<typeof runErrorFixRecheck>[0] extends infer O ? O extends { db?: infer D } ? D : never : never;

describe.skipIf(!connection)("error loop in isolated PostgreSQL (#2058)", () => {
  let raw: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  let db: Db;
  let nextRaw = 20580200;
  const ids: Record<string, number> = {};

  async function seedFee(institutionId: number, name: string, key: string, amount: number): Promise<number> {
    const rawId = nextRaw++;
    await raw`INSERT INTO raw_fee_observations (fee_raw_id, institution_id, source_document_id, agent_event_id, fee_name, amount, frequency, source)
              VALUES (${rawId}, ${institutionId}, ${DOC}, ${EVENT}, ${name}, ${amount}, 'per_item', 'knox')`;
    const [verified] = await raw`INSERT INTO verified_fee_observations (fee_raw_id, institution_id, canonical_fee_key, verified_by_agent_event_id, fee_name, amount, frequency, review_status)
              VALUES (${rawId}, ${institutionId}, ${key}, ${EVENT}, ${name}, ${amount}, 'per_item', 'verified') RETURNING fee_verified_id`;
    const [published] = await raw`INSERT INTO published_fee_records (lineage_ref, institution_id, canonical_fee_key, published_by_adversarial_event_id, fee_name, amount, frequency, batch_id, source_url)
              VALUES (${verified.fee_verified_id}, ${institutionId}, ${key}, ${EVENT}, ${name}, ${amount}, 'per_item', 'agentic-run-2058', 'https://bank2058.test/fees') RETURNING fee_published_id`;
    return Number(published.fee_published_id);
  }

  async function named(key: string, institutionId: number, feePublishedId: number, canonical: string, createdAt = "2026-10-10T00:00:00Z") {
    await raw`INSERT INTO pipeline_feedback (about_stage, signal, kind, reported_by, institution_id, fee_published_id, canonical_fee_key, dedupe_key, created_at)
              VALUES ('extract', 'wrong', ${KIND}, 'deming', ${institutionId}, ${feePublishedId}, ${canonical}, ${`test2058:${key}`}, ${createdAt})`;
    const [row] = await raw`SELECT id FROM pipeline_feedback WHERE dedupe_key = ${`test2058:${key}`}`;
    ids[key] = Number(row.id);
  }

  async function clean() {
    await raw`DELETE FROM pipeline_feedback WHERE institution_id IN (${INST}, ${WAITING})`;
    await raw`DELETE FROM pipeline_attempts WHERE institution_id IN (${INST}, ${WAITING})`;
    await raw`DELETE FROM published_fee_records WHERE institution_id IN (${INST}, ${WAITING})`;
    await raw`DELETE FROM verified_fee_observations WHERE institution_id IN (${INST}, ${WAITING})`;
    await raw`DELETE FROM raw_fee_observations WHERE institution_id IN (${INST}, ${WAITING})`;
    await raw`DELETE FROM agent_source_texts WHERE institution_id IN (${INST}, ${WAITING})`;
    await raw`DELETE FROM source_documents WHERE institution_id IN (${INST}, ${WAITING})`;
    await raw`DELETE FROM institution_sources WHERE id IN (${INST}, ${WAITING})`;
  }

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Error-loop DB tests require a loopback E2E database; production connections are forbidden");
    }
    raw = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    db = raw as unknown as Db;
    await clean();
    await raw`INSERT INTO institution_sources (id, institution_name, charter_type, source, state_code)
              VALUES (${INST}, 'Loop Test Bank', 'bank', 'fdic', 'TX'), (${WAITING}, 'Loop Waiting Bank', 'bank', 'fdic', 'TX')`;
    await raw`INSERT INTO source_documents (id, institution_id, status, document_url, content_hash, crawled_at)
              VALUES (${DOC}, ${INST}, 'success', 'https://bank2058.test/fees', 'hash-2058', '2026-10-01T00:00:00Z')`;
    await raw`INSERT INTO agent_source_texts (source_document_id, institution_id, status, normalized_text)
              VALUES (${DOC}, ${INST}, 'completed', ${"OTHER SERVICES\nStop Payment Fee | $35.00\nOverdraft Fee | $30.00 per item\nWire Transfer | $25.00"})`;
    // Three live fee types, so the institution is deep enough for the catalog.
    const stop = await seedFee(INST, "Stop Payment Fee", "stop_payment", 35);
    await seedFee(INST, "Overdraft Fee", "overdraft", 30);
    const wire = await seedFee(INST, "Wire Transfer", "wire_domestic_outgoing", 40);
    const nsf = await seedFee(INST, "NSF Fee", "nsf", 99);
    await raw`UPDATE published_fee_records SET rolled_back_at = NOW() WHERE fee_published_id = ${nsf}`;
    const waitingFee = await seedFee(WAITING, "Courtesy Overdraft Fee", "overdraft", 30);
    await named("matches", INST, stop, "stop_payment");
    await named("down", INST, nsf, "nsf");
    await named("still", INST, wire, "wire_domestic_outgoing");
    await named("waiting", WAITING, waitingFee, "overdraft");
    // Recorded after the fix merged: not one of the errors it names.
    await named("after", INST, stop, "stop_payment", "2026-10-21T00:00:00Z");
  });

  afterAll(async () => {
    if (raw) {
      await clean();
      await raw.end();
    }
  });

  it("asks for the banks behind the named errors, dated the day the fix merged, until a run reads them again", async () => {
    const requests = await errorFixRequests(db, [FIX]);
    expect(requests.map((request) => [request.institutionId, request.requestedAt]).sort()).toEqual([[INST, "2026-10-20"], [WAITING, "2026-10-20"]]);
    const [run] = await raw`INSERT INTO agent_runs (agent_name, run_kind, title, status) VALUES ('atlas', 'manual_repair', 'Loop test re-run', 'completed') RETURNING id`;
    await raw`INSERT INTO pipeline_attempts (institution_id, source_document_id, stage, strategy, strategy_version, outcome, agent_run_id)
              VALUES (${INST}, ${DOC}, 'extract', ${KNOX_RULES_STRATEGY.strategy}, ${KNOX_RULES_STRATEGY.version}, 'ok', ${Number(run.id)})`;
    expect((await errorFixRequests(db, [FIX])).map((request) => request.institutionId)).toEqual([WAITING]);
  });

  it("closes the errors that are gone, records the one still wrong once, and leaves the bank not yet re-run waiting", async () => {
    const first = await runErrorFixRecheck({ db, entries: [FIX], runId: null });
    expect(first.skipped).toEqual([]);
    expect(first.results[0]).toMatchObject({ named: 4, waiting: 1, nowMatches: 1, notLive: 1, stillWrong: 1, unknown: 0 });
    expect(first.results[0].stillWrongRows).toEqual([expect.objectContaining({ feedbackId: ids.still, check: "hamilton.source_check" })]);
    const ledger = await raw`SELECT kind, signal, weight, dedupe_key, evidence->>'verdict' AS verdict FROM pipeline_feedback
                              WHERE check_name = 'deming.error_fix_recheck' AND institution_id = ${INST} ORDER BY dedupe_key`;
    expect(ledger.map((row) => [row.dedupe_key, row.kind, row.verdict, Number(row.weight)])).toEqual([
      [`deming.error_fix:92058:${ids.down}:closed`, "error_fix_closed", "not_live", 0],
      [`deming.error_fix:92058:${ids.matches}:closed`, "error_fix_closed", "now_matches", 0],
      [`deming.error_fix:92058:${ids.still}:still_wrong`, "error_fix_still_wrong", "still_wrong", 0],
    ].sort((a, b) => String(a[0]).localeCompare(String(b[0]))));

    // The next day: closed rows are not named again; the still-wrong one is judged, not re-written.
    const second = await runErrorFixRecheck({ db, entries: [FIX], runId: null });
    expect(second.results[0]).toMatchObject({ named: 2, waiting: 1, stillWrong: 1 });
    expect(second.written).toBe(0);
  });
});
