/**
 * H03 (#978) in real PostgreSQL: the production schema plus migration 20270110000053, loopback
 * only. A correction is a new version with its audit row, run and index rebuild in one
 * transaction; stale and repeated submissions write nothing; a re-read of the old source never
 * comes back; a newer source opens a conflict; a reversal is a new version.
 */
import postgres from "postgres";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL } from "@/lib/data-store/connection";
import { insertPublishedFee, type VerifiedFeeRow } from "@/lib/agents/hamilton/publish";
import {
  correctPublishedFee,
  dismissCorrectionConflict,
  getInstitutionCorrections,
  resetCorrectionsReadyCache,
  reverseFeeCorrection,
} from "./fee-corrections";
import { holdPublishedFee } from "./fee-hold";

const connection = process.env.E2E_DATABASE_URL;
type Db = Parameters<typeof correctPublishedFee>[0];

const INST = 978001;
const DOC_OLD = 978101;
const DOC_NEW = 978102;
const DOC_NEWEST = 978103;
const EVENT = "00000000-0000-4000-8000-000000978000";
const admin = { id: 1, name: "James", role: "admin" };
const analyst = { id: 2, name: "Ana", role: "analyst" };

describe.skipIf(!connection)("admin fee corrections in isolated PostgreSQL", () => {
  let raw: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  let db: Db;
  let rawPool: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  let pool: Db;
  let wrongFeeId = 0;
  let overdraftFeeId = 0;
  let nextRaw = 978200;

  async function seedFee(name: string, key: string, amount: number, documentId: number): Promise<{ verifiedId: number; publishedId: number }> {
    const rawId = nextRaw++;
    await raw`INSERT INTO raw_fee_observations (fee_raw_id, institution_id, source_document_id, agent_event_id, fee_name, amount, frequency, source)
              VALUES (${rawId}, ${INST}, ${documentId}, ${EVENT}, ${name}, ${amount}, 'per_item', 'knox')`;
    const [verified] = await raw`INSERT INTO verified_fee_observations (fee_raw_id, institution_id, canonical_fee_key, verified_by_agent_event_id, fee_name, amount, frequency, review_status)
              VALUES (${rawId}, ${INST}, ${key}, ${EVENT}, ${name}, ${amount}, 'per_item', 'verified') RETURNING fee_verified_id`;
    const [published] = await raw`INSERT INTO published_fee_records (lineage_ref, institution_id, canonical_fee_key, published_by_adversarial_event_id, fee_name, amount, frequency, batch_id, source_url)
              VALUES (${verified.fee_verified_id}, ${INST}, ${key}, ${EVENT}, ${name}, ${amount}, 'per_item', 'agentic-run-978', 'https://bank.test/fees') RETURNING fee_published_id`;
    return { verifiedId: Number(verified.fee_verified_id), publishedId: Number(published.fee_published_id) };
  }

  /** A re-read Knox and Darwin would hand Hamilton: new raw and verified rows, not yet published. */
  async function reread(amount: number, documentId: number): Promise<VerifiedFeeRow> {
    const rawId = nextRaw++;
    await raw`INSERT INTO raw_fee_observations (fee_raw_id, institution_id, source_document_id, agent_event_id, fee_name, amount, frequency, source)
              VALUES (${rawId}, ${INST}, ${documentId}, ${EVENT}, 'Stop Payment Fee.', ${amount}, 'per_item', 'knox')`;
    const [verified] = await raw`INSERT INTO verified_fee_observations (fee_raw_id, institution_id, canonical_fee_key, verified_by_agent_event_id, fee_name, amount, frequency, review_status)
              VALUES (${rawId}, ${INST}, 'stop_payment', ${EVENT}, 'Stop Payment Fee.', ${amount}, 'per_item', 'verified') RETURNING fee_verified_id`;
    return {
      fee_verified_id: Number(verified.fee_verified_id),
      fee_raw_id: rawId,
      institution_id: INST,
      source_url: "https://bank.test/fees",
      document_r2_key: null,
      extraction_confidence: 0.95,
      canonical_fee_key: "stop_payment",
      variant_type: null,
      outlier_flags: [],
      verified_by_agent_event_id: EVENT,
      fee_name: "Stop Payment Fee.",
      amount,
      frequency: "per_item",
      raw_agent_event_id: EVENT,
      fee_audience: "unknown",
      source_document_id: documentId,
    } as VerifiedFeeRow;
  }

  const correction = (patch: Record<string, unknown> = {}) => ({
    feePublishedId: wrongFeeId,
    expectedVersion: 0,
    idempotencyKey: "db-test-correct-000001",
    canonicalFeeKey: "stop_payment",
    feeName: "Stop Payment Fee",
    amount: "35.00",
    frequency: "per_item",
    conditions: "",
    sourceDocumentId: DOC_OLD,
    sourceExcerpt: "Stop Payment Fee | $35.00",
    sourceLocation: "Page 1, Other Services, row 2",
    reason: "Knox read the amount from the row above",
    ...patch,
  });

  const liveStopPayment = async () => raw`
    SELECT id, amount FROM published_fee_catalog WHERE institution_id = ${INST} AND fee_category = 'stop_payment' ORDER BY id`;

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Correction DB tests require a loopback E2E database; production connections are forbidden");
    }
    const types = { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL };
    raw = postgres(connection, { max: 1, ssl: "require", types });
    rawPool = postgres(connection, { max: 2, ssl: "require", types });
    db = raw as unknown as Db;
    pool = rawPool as unknown as Db;
    resetCorrectionsReadyCache();
    // Re-runnable on a local database: remove this test's own rows (and only those) first.
    await raw`DELETE FROM published_fee_correction_conflicts WHERE institution_id = ${INST}`;
    await raw`DELETE FROM published_fee_corrections WHERE institution_id = ${INST}`;
    await raw`DELETE FROM pipeline_feedback WHERE institution_id = ${INST}`;
    await raw`DELETE FROM published_fee_records WHERE institution_id = ${INST}`;
    await raw`DELETE FROM verified_fee_observations WHERE institution_id = ${INST}`;
    await raw`DELETE FROM raw_fee_observations WHERE institution_id = ${INST}`;
    await raw`DELETE FROM agent_source_texts WHERE institution_id = ${INST}`;
    await raw`DELETE FROM source_documents WHERE institution_id = ${INST}`;
    await raw`DELETE FROM institution_sources WHERE id = ${INST}`;
    await raw`INSERT INTO institution_sources (id, institution_name, charter_type, source, state_code) VALUES (${INST}, 'H03 Test Bank', 'bank', 'fdic', 'TX')`;
    await raw`INSERT INTO source_documents (id, institution_id, status, document_url, content_hash, crawled_at)
              VALUES (${DOC_OLD}, ${INST}, 'success', 'https://bank.test/fees', 'hash-old', '2026-09-01T00:00:00Z'),
                     (${DOC_NEW}, ${INST}, 'success', 'https://bank.test/fees-2027', 'hash-new', NOW() + interval '1 day'),
                     (${DOC_NEWEST}, ${INST}, 'success', 'https://bank.test/fees-2028', 'hash-newest', NOW() + interval '2 days')`;
    await raw`INSERT INTO agent_source_texts (source_document_id, institution_id, status, normalized_text)
              VALUES (${DOC_OLD}, ${INST}, 'completed', ${"OTHER SERVICES\nWire Transfer | $25.00\nStop Payment Fee | $35.00\nOverdraft Fee | $30.00 per item"}),
                     (${DOC_NEW}, ${INST}, 'completed', ${"OTHER SERVICES\nStop Payment Fee | $32.00\nOverdraft Fee | $30.00 per item"})`;
    // Three live fee types, so the institution is deep enough for the catalog.
    wrongFeeId = (await seedFee("Stop Payment Fee", "stop_payment", 25, DOC_OLD)).publishedId;
    overdraftFeeId = (await seedFee("Overdraft Fee", "overdraft", 30, DOC_OLD)).publishedId;
    await seedFee("Wire Transfer", "wire_domestic_outgoing", 25, DOC_OLD);
  });

  afterAll(async () => {
    if (raw) await raw.end();
    if (rawPool) await rawPool.end();
  });

  it("should_refuse_an_analyst_and_leave_the_fee_as_it_is", async () => {
    expect(await correctPublishedFee(db, correction(), analyst)).toMatchObject({ ok: false, code: "forbidden" });
    expect((await liveStopPayment()).map((row) => Number(row.amount))).toEqual([25]);
  });

  it("should_publish_a_new_version_keep_the_old_value_and_write_audit_run_and_index_together", async () => {
    const result = await correctPublishedFee(db, correction(), admin);
    expect(result).toMatchObject({ ok: true, version: 1, previousFeePublishedId: wrongFeeId, replay: false, indexRefreshed: true });
    if (!result.ok) return;

    const live = await liveStopPayment();
    expect(live.map((row) => [Number(row.id), Number(row.amount)])).toEqual([[result.feePublishedId, 35]]);
    const [old] = await raw`SELECT amount, quarantined_at, quarantine_reason, rolled_back_at FROM published_fee_records WHERE fee_published_id = ${wrongFeeId}`;
    expect(Number(old.amount)).toBe(25);
    expect(old.quarantined_at).not.toBeNull();
    expect(old.rolled_back_at).not.toBeNull();
    expect(String(old.quarantine_reason)).toMatch(/^admin_correction: superseded by correction version 1/);
    const [fresh] = await raw`SELECT a.lineage_ref = b.lineage_ref AS same_lineage, a.batch_id
                                FROM published_fee_records a, published_fee_records b
                               WHERE a.fee_published_id = ${result.feePublishedId} AND b.fee_published_id = ${wrongFeeId}`;
    expect(fresh.same_lineage).toBe(true);
    expect(String(fresh.batch_id)).toMatch(/^admin-correction-/);

    const [version] = await raw`SELECT * FROM published_fee_corrections WHERE id = ${result.correctionId}`;
    expect(version).toMatchObject({ status: "current", action: "correct", actor_name: "James" });
    expect(Number(version.fee_chain_id)).toBe(wrongFeeId);
    expect(Number(version.source_document_id)).toBe(DOC_OLD);
    expect(Number(version.before_amount)).toBe(25);
    expect(Number(version.amount)).toBe(35);
    expect((version.source_check as { ok: boolean }).ok).toBe(true);

    const feedback = await raw`SELECT kind, signal, agent_run_id FROM pipeline_feedback WHERE check_name = 'admin.fee_correction' AND fee_published_id = ${wrongFeeId}`;
    expect(feedback).toHaveLength(1);
    expect(feedback[0]).toMatchObject({ kind: "admin_correction", signal: "wrong" });
    expect(Number(feedback[0].agent_run_id)).toBe(result.runId);
    const [run] = await raw`SELECT run_kind, status, trigger_source FROM agent_runs WHERE id = ${result.runId}`;
    expect(run).toMatchObject({ run_kind: "manual_repair", status: "completed", trigger_source: "admin" });
    const events = await raw`SELECT event_type, status FROM agent_run_events WHERE agent_run_id = ${result.runId} ORDER BY id`;
    expect(events.map((event) => event.event_type)).toEqual(["fee.correct", "index.refresh"]);
    expect(events[1].status).toBe("completed");
    const [cache] = await raw`SELECT COUNT(*)::int AS n FROM fee_index_cache WHERE agent_run_id = ${result.runId}`;
    expect(cache.n).toBeGreaterThan(0);
  });

  it("should_return_the_first_result_for_a_double_submission_and_refuse_a_stale_version", async () => {
    const replay = await correctPublishedFee(db, correction(), admin);
    expect(replay).toMatchObject({ ok: true, replay: true, version: 1 });
    // The old row is no longer live; a second editor working from it is stale.
    expect(await correctPublishedFee(db, correction({ idempotencyKey: "db-test-correct-000002", amount: "36.00" }), admin)).toMatchObject({ ok: false, code: "stale" });
    // The new row is at version 1; an editor who saw version 0 is stale too.
    const [{ fee_published_id: currentId }] = await raw`SELECT fee_published_id FROM published_fee_corrections WHERE fee_chain_id = ${wrongFeeId} AND status = 'current'`;
    expect(await correctPublishedFee(db, correction({ feePublishedId: Number(currentId), idempotencyKey: "db-test-correct-000003" }), admin)).toMatchObject({ ok: false, code: "stale" });
    const [count] = await raw`SELECT COUNT(*)::int AS n FROM published_fee_corrections WHERE fee_chain_id = ${wrongFeeId}`;
    expect(count.n).toBe(1);
  });

  it("should_not_republish_the_corrected_away_value_when_the_old_source_is_read_again", async () => {
    for (const amount of [25, 28]) {
      const blocked: unknown[] = [];
      const published = await insertPublishedFee(db as never, { runId: 1, batchId: "agentic-run-978-reread", row: await reread(amount, DOC_OLD), onCorrected: (block) => blocked.push(block) });
      expect(published).toBeNull();
      expect(blocked[0]).toMatchObject({ kind: "protected", feeChainId: wrongFeeId });
    }
    expect((await liveStopPayment()).map((row) => Number(row.amount))).toEqual([35]);
    const [conflicts] = await raw`SELECT COUNT(*)::int AS n FROM published_fee_correction_conflicts WHERE institution_id = ${INST}`;
    expect(conflicts.n).toBe(0);
  });

  it("should_queue_a_newer_source_that_disagrees_once_without_publishing_it", async () => {
    const row = await reread(32, DOC_NEW);
    const blocked: Array<{ kind: string }> = [];
    expect(await insertPublishedFee(db as never, { runId: 1, batchId: "agentic-run-978-new", row, onCorrected: (block) => blocked.push(block) })).toBeNull();
    expect(blocked[0].kind).toBe("conflict");
    expect(await insertPublishedFee(db as never, { runId: 1, batchId: "agentic-run-978-new", row })).toBeNull();
    const conflicts = await raw`SELECT status, amount, source_document_id FROM published_fee_correction_conflicts WHERE institution_id = ${INST}`;
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].status).toBe("open");
    expect(Number(conflicts[0].source_document_id)).toBe(DOC_NEW);
    expect((await liveStopPayment()).map((row) => Number(row.amount))).toEqual([35]);
    const listed = await getInstitutionCorrections(db, INST);
    expect(listed.conflicts).toHaveLength(1);
    expect(listed.conflicts[0].current.amount).toBe(35);
  });

  it("should_accept_the_newer_source_by_correcting_from_it_then_reverse_as_a_new_version", async () => {
    const listed = await getInstitutionCorrections(db, INST);
    const [currentId, version] = Object.entries(listed.versions)[0];
    const accepted = await correctPublishedFee(db, correction({
      feePublishedId: Number(currentId),
      expectedVersion: version,
      idempotencyKey: "db-test-correct-000004",
      amount: "32.00",
      sourceDocumentId: DOC_NEW,
      sourceExcerpt: "Stop Payment Fee | $32.00",
      sourceLocation: "2027 schedule, Other Services, row 1",
      reason: "The bank's newer schedule raises it to $32",
    }), admin);
    expect(accepted).toMatchObject({ ok: true, version: 2 });
    if (!accepted.ok) return;
    const [conflict] = await raw`SELECT status, resolved_by_correction_id FROM published_fee_correction_conflicts WHERE institution_id = ${INST}`;
    expect(conflict.status).toBe("accepted");
    expect(Number(conflict.resolved_by_correction_id)).toBe(accepted.correctionId);

    const reversed = await reverseFeeCorrection(db, {
      feePublishedId: accepted.feePublishedId,
      expectedVersion: 2,
      idempotencyKey: "db-test-reverse-000001",
      reason: "The 2027 schedule is not in effect yet",
    }, admin);
    expect(reversed).toMatchObject({ ok: true, version: 3 });
    expect((await liveStopPayment()).map((row) => Number(row.amount))).toEqual([35]);
    const versions = await raw`SELECT version, action, status, amount FROM published_fee_corrections WHERE fee_chain_id = ${wrongFeeId} ORDER BY version`;
    expect(versions.map((v) => [v.version, v.action, v.status, Number(v.amount)])).toEqual([
      [1, "correct", "superseded", 35],
      [2, "correct", "superseded", 32],
      [3, "reverse", "current", 35],
    ]);
    // Every published row of the chain is still there; only the newest is live.
    const rows = await raw`SELECT COUNT(*)::int AS n, COUNT(*) FILTER (WHERE quarantined_at IS NULL)::int AS live
                             FROM published_fee_records WHERE institution_id = ${INST} AND canonical_fee_key = 'stop_payment'`;
    expect(rows[0]).toMatchObject({ n: 4, live: 1 });
  });

  it("should_let_only_one_of_two_concurrent_editors_win", async () => {
    const listed = await getInstitutionCorrections(db, INST);
    const [currentId, version] = Object.entries(listed.versions)[0];
    const attempt = (key: string, amount: string) => correctPublishedFee(pool, correction({
      feePublishedId: Number(currentId),
      expectedVersion: version,
      idempotencyKey: key,
      amount,
      sourceDocumentId: DOC_NEW,
      sourceExcerpt: "Stop Payment Fee | $32.00",
      sourceLocation: "2027 schedule, row 1",
      reason: "Concurrent edit test",
    }), admin);
    const results = await Promise.all([attempt("db-test-race-000001", "32.00"), attempt("db-test-race-000002", "32")]);
    expect(results.filter((r) => r.ok)).toHaveLength(1);
    expect(results.filter((r) => !r.ok && r.code === "stale")).toHaveLength(1);
    const [current] = await raw`SELECT COUNT(*)::int AS n FROM published_fee_corrections WHERE fee_chain_id = ${wrongFeeId} AND status = 'current'`;
    expect(current.n).toBe(1);
  });

  it("should_refuse_a_value_the_source_does_not_state", async () => {
    const listed = await getInstitutionCorrections(db, INST);
    const [currentId, version] = Object.entries(listed.versions)[0];
    const result = await correctPublishedFee(db, correction({
      feePublishedId: Number(currentId),
      expectedVersion: version,
      idempotencyKey: "db-test-correct-000009",
      amount: "40.00",
      sourceExcerpt: "Stop Payment Fee",
    }), admin);
    expect(result).toMatchObject({ ok: false, code: "evidence" });
  });

  it("should_dismiss_a_conflict_with_a_reason_admin_only", async () => {
    // The current version was read from the 2027 document; a later one that disagrees is a conflict.
    const row = await reread(31, DOC_NEWEST);
    await insertPublishedFee(db as never, { runId: 1, batchId: "agentic-run-978-new2", row });
    const [open] = await raw`SELECT id FROM published_fee_correction_conflicts WHERE institution_id = ${INST} AND status = 'open'`;
    expect(open).toBeDefined();
    expect((await dismissCorrectionConflict(db, Number(open.id), "Misread", analyst)).ok).toBe(false);
    expect((await dismissCorrectionConflict(db, Number(open.id), "Knox misread the new table", admin)).ok).toBe(true);
    expect((await dismissCorrectionConflict(db, Number(open.id), "Again", admin)).ok).toBe(false);
  });

  it("should_rebuild_the_national_index_when_a_fee_is_held", async () => {
    const result = await holdPublishedFee(db as never, overdraftFeeId, "Wrong audience on the line", { id: 2, name: "Ana" });
    expect(result).toMatchObject({ ok: true, indexRefreshed: true });
    const [event] = await raw`SELECT e.status FROM agent_run_events e JOIN agent_runs r ON r.id = e.agent_run_id
                               WHERE r.current_stage = 'admin.fee_hold' AND e.event_type = 'index.refresh' ORDER BY e.id DESC LIMIT 1`;
    expect(event.status).toBe("completed");
  });
});
