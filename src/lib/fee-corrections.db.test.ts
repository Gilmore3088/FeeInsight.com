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
import { fillBlankFrequencies } from "@/lib/agents/hamilton/frequency-fill";
import { readerFeeConditions } from "./fee-conditions";

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
  let rereadRunId: number;

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
    // Other rollback-only suites can consume serial1 without retaining that run (#2294).
    // Each simulated reread owns the real run referenced by its durable conflict receipt.
    const [rereadRun] = await raw`INSERT INTO agent_runs (agent_name, run_kind, title, status)
      VALUES ('hamilton', 'state_agent', 'H03 test reread', 'running') RETURNING id`;
    rereadRunId = Number(rereadRun.id);
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

    const feedback = await raw`SELECT kind, signal, agent_run_id, about_stage, source_url, evidence->>'cause' AS cause FROM pipeline_feedback WHERE check_name = 'admin.fee_correction' AND fee_published_id = ${wrongFeeId}`;
    expect(feedback).toHaveLength(1);
    // No cause sent, and only the amount changed on the same document: filed against extract (#2057).
    expect(feedback[0]).toMatchObject({ kind: "admin_correction", signal: "wrong", about_stage: "extract", cause: "wrong_amount", source_url: null });
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
      const published = await insertPublishedFee(db as never, { runId: rereadRunId, batchId: "agentic-run-978-reread", row: await reread(amount, DOC_OLD), onCorrected: (block) => blocked.push(block) });
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
    expect(await insertPublishedFee(db as never, { runId: rereadRunId, batchId: "agentic-run-978-new", row, onCorrected: (block) => blocked.push(block) })).toBeNull();
    expect(blocked[0].kind).toBe("conflict");
    expect(await insertPublishedFee(db as never, { runId: rereadRunId, batchId: "agentic-run-978-new", row })).toBeNull();
    const conflicts = await raw`SELECT status, amount, source_document_id, agent_run_id FROM published_fee_correction_conflicts WHERE institution_id = ${INST}`;
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].status).toBe("open");
    expect(Number(conflicts[0].agent_run_id)).toBe(rereadRunId);
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

  it("should_keep_a_corrected_fee_live_when_an_agent_check_takes_it_down_but_let_the_correction_workflow_replace_it", async () => {
    const [current] = await raw`SELECT fee_published_id FROM published_fee_corrections WHERE fee_chain_id = ${wrongFeeId} AND status = 'current'`;
    const correctedId = Number(current.fee_published_id);
    // The shape every agent takedown takes (rules re-check, taxonomy fold, duplicates): it reads the
    // corrected row through its original Knox lineage and closes it against the old document.
    const closed = await raw`UPDATE published_fee_records
         SET rolled_back_at = NOW(), rolled_back_by_batch_id = 'hamilton-rules-recheck-978', rolled_back_reason = 'knox_rules_recheck'
       WHERE fee_published_id = ${correctedId} AND rolled_back_at IS NULL
       RETURNING fee_published_id`;
    expect(closed).toHaveLength(0);
    const [still] = await raw`SELECT rolled_back_at FROM published_fee_records WHERE fee_published_id = ${correctedId}`;
    expect(still.rolled_back_at).toBeNull();
    // A fee nobody corrected still comes down as before.
    const overdraft = await raw`UPDATE published_fee_records SET rolled_back_at = NOW(), rolled_back_by_batch_id = 'hamilton-rules-recheck-978'
       WHERE fee_published_id = ${overdraftFeeId} RETURNING fee_published_id`;
    expect(overdraft).toHaveLength(1);
    await raw`UPDATE published_fee_records SET rolled_back_at = NULL, rolled_back_by_batch_id = NULL WHERE fee_published_id = ${overdraftFeeId}`;
  });

  it("should_leave_a_corrected_fee_out_of_the_frequency_fill_while_reading_an_uncorrected_one", async () => {
    const [current] = await raw`SELECT fee_published_id FROM published_fee_corrections WHERE fee_chain_id = ${wrongFeeId} AND status = 'current'`;
    const correctedId = Number(current.fee_published_id);
    // Both rows now read as frequency-fill candidates: a per-event fee stored as daily, on a line it
    // can re-read. Only the one no admin corrected may be rewritten.
    for (const id of [correctedId, overdraftFeeId]) {
      await raw`UPDATE published_fee_records SET frequency = 'daily' WHERE fee_published_id = ${id}`;
      await raw`UPDATE raw_fee_observations fr SET extraction_note = 'excerpt="Fee | $35.00 per item"'
                  FROM verified_fee_observations fv, published_fee_records fp
                 WHERE fp.fee_published_id = ${id} AND fv.fee_verified_id = fp.lineage_ref AND fr.fee_raw_id = fv.fee_raw_id`;
    }
    const result = await fillBlankFrequencies(db as never, { runId: rereadRunId, dryRun: true, institutionId: INST });
    const touched = [...result.filled, ...result.held, ...result.planWouldHold].map((fee) => fee.feePublishedId);
    expect(result.scanned).toBe(1);
    expect(touched).not.toContain(correctedId);
    for (const id of [correctedId, overdraftFeeId]) {
      await raw`UPDATE published_fee_records SET frequency = 'per_item' WHERE fee_published_id = ${id}`;
    }
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
    await insertPublishedFee(db as never, { runId: rereadRunId, batchId: "agentic-run-978-new2", row });
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

  it("should_publish_corrected_conditions_and_source_clear_them_and_reverse_without_changing_other_fees", async () => {
    const originalCondition = "Original row condition";
    const correctedCondition = "Per request when researching prior statements";
    const excerpt = "Account Research Fee | $10.00 per request when researching prior statements";
    await raw`UPDATE agent_source_texts SET normalized_text = normalized_text || E'\n' || ${excerpt}
               WHERE source_document_id IN (${DOC_OLD}, ${DOC_NEW})`;
    await raw`UPDATE source_documents SET document_r2_key = 'test/old-fees.pdf' WHERE id = ${DOC_OLD}`;
    await raw`UPDATE source_documents SET document_r2_key = NULL WHERE id = ${DOC_NEW}`;
    const fee = await seedFee("Account Research Fee", "account_research", 10, DOC_OLD);
    const [lineage] = await raw`SELECT fee_raw_id FROM verified_fee_observations WHERE fee_verified_id = ${fee.verifiedId}`;
    const originalNote = `Knox deterministic extraction from Rosetta artifact #978101. canonical_hint=account_research; text_hash=original; excerpt="Account Research Fee | $10.00"`;
    await raw`UPDATE raw_fee_observations SET conditions = ${originalCondition}, extraction_note = ${originalNote}
               WHERE fee_raw_id = ${lineage.fee_raw_id}`;
    await raw`UPDATE published_fee_records SET document_r2_key = 'test/old-fees.pdf' WHERE fee_published_id = ${fee.publishedId}`;

    // Percentage fees remain outside the correction form and dollar catalog.
    const rate = await seedFee("Foreign Transaction Fee", "card_foreign_txn", 1, DOC_OLD);
    await raw`UPDATE raw_fee_observations SET amount = NULL, amount_kind = 'percent', rate_percent = 1, rate_basis = 'transaction'
               WHERE fee_raw_id = (SELECT fee_raw_id FROM verified_fee_observations WHERE fee_verified_id = ${rate.verifiedId})`;
    await raw`UPDATE verified_fee_observations SET amount = NULL, amount_kind = 'percent', rate_percent = 1, rate_basis = 'transaction'
               WHERE fee_verified_id = ${rate.verifiedId}`;
    await raw`UPDATE published_fee_records SET amount = NULL, amount_kind = 'percent', rate_percent = 1, rate_basis = 'transaction'
               WHERE fee_published_id = ${rate.publishedId}`;
    const unchangedDollarRows = () => raw`SELECT to_jsonb(c) AS value FROM published_fee_catalog c
      WHERE institution_id = ${INST} AND fee_category != 'account_research' ORDER BY id`;
    const unchangedRateRows = () => raw`SELECT to_jsonb(c) AS value FROM published_fee_rate_catalog c WHERE institution_id = ${INST} ORDER BY id`;
    const dollarBefore = await unchangedDollarRows();
    const ratesBefore = await unchangedRateRows();
    const [initial] = await raw`SELECT conditions, extraction_note, source_document_id FROM published_fee_catalog WHERE id = ${fee.publishedId}`;
    expect(initial).toMatchObject({ conditions: originalCondition, extraction_note: originalNote, source_document_id: DOC_OLD });

    const publish = (id: number, version: number, condition: string, documentId: number, key: string) => correctPublishedFee(db, correction({
      feePublishedId: id, expectedVersion: version, idempotencyKey: key,
      canonicalFeeKey: "account_research", feeName: "Account Research Fee", amount: "10.00", conditions: condition,
      sourceDocumentId: documentId, sourceExcerpt: excerpt, sourceLocation: "Other Services, research fee row",
      reason: "Use the condition and source document reviewed by the admin",
    }), admin);
    const read = async (id: number) => {
      const [row] = await raw`SELECT conditions, extraction_note, source_document_id, source_url, document_url, document_r2_key,
                                    COALESCE(extraction_note, conditions) AS reader_conditions
                               FROM published_fee_catalog WHERE id = ${id}`;
      return row;
    };

    // No amount/name/category/frequency changes: this is a condition-only correction.
    const corrected = await publish(fee.publishedId, 0, correctedCondition, DOC_OLD, "db-test-condition-000001");
    expect(corrected.ok).toBe(true);
    if (!corrected.ok) return;
    const first = await read(corrected.feePublishedId);
    expect(first).toMatchObject({ conditions: correctedCondition, extraction_note: null, source_document_id: DOC_OLD, document_r2_key: "test/old-fees.pdf" });
    expect(readerFeeConditions(first.reader_conditions)).toBe(correctedCondition);

    // Explicit NULL means clear; original conditions and the old audit note must not leak back.
    const cleared = await publish(corrected.feePublishedId, 1, "", DOC_NEW, "db-test-condition-000002");
    expect(cleared.ok).toBe(true);
    if (!cleared.ok) return;
    const second = await read(cleared.feePublishedId);
    expect(second).toMatchObject({ conditions: null, extraction_note: null, source_document_id: DOC_NEW,
      source_url: "https://bank.test/fees-2027", document_url: "https://bank.test/fees-2027", document_r2_key: null });
    expect(readerFeeConditions(second.reader_conditions)).toBeNull();

    const reversed = await reverseFeeCorrection(db, { feePublishedId: cleared.feePublishedId, expectedVersion: 2,
      idempotencyKey: "db-test-condition-reverse-000001", reason: "Restore the prior reviewed condition and evidence" }, admin);
    expect(reversed.ok).toBe(true);
    if (!reversed.ok) return;
    expect(await read(reversed.feePublishedId)).toMatchObject({ conditions: correctedCondition, extraction_note: null,
      source_document_id: DOC_OLD, source_url: "https://bank.test/fees", document_url: "https://bank.test/fees", document_r2_key: "test/old-fees.pdf" });
    const [history] = await raw`SELECT COUNT(*)::int AS versions, COUNT(*) FILTER (WHERE status = 'current')::int AS current
                               FROM published_fee_corrections WHERE fee_chain_id = ${fee.publishedId}`;
    expect(history).toEqual({ versions: 3, current: 1 });
    const [originalRaw] = await raw`SELECT conditions, extraction_note, source_document_id FROM raw_fee_observations WHERE fee_raw_id = ${lineage.fee_raw_id}`;
    expect(originalRaw).toMatchObject({ conditions: originalCondition, extraction_note: originalNote, source_document_id: DOC_OLD });
    expect(await unchangedDollarRows()).toEqual(dollarBefore);
    expect(await unchangedRateRows()).toEqual(ratesBefore);
    expect(ratesBefore).toHaveLength(1);
    expect(await correctPublishedFee(db, correction({ feePublishedId: rate.publishedId, idempotencyKey: "db-test-condition-rate-000001" }), admin))
      .toMatchObject({ ok: false, code: "invalid" });

    // Production readers (postgres/service_role) already have table SELECT and BYPASSRLS.
    // Exercise that contract without superuser authority or any new production grants.
    const readerRole = `fee_catalog_reader_2127_${process.pid}`;
    await raw`CREATE ROLE ${raw(readerRole)} NOLOGIN NOSUPERUSER BYPASSRLS`;
    try {
      await raw`GRANT USAGE ON SCHEMA public TO ${raw(readerRole)}`;
      await raw`GRANT SELECT ON public.published_fee_catalog, public.published_fee_records,
        public.verified_fee_observations, public.raw_fee_observations, public.pipeline_feedback,
        public.published_fee_corrections, public.source_documents TO ${raw(readerRole)}`;
      const [role] = await raw`SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname = ${readerRole}`;
      expect(role).toEqual({ rolsuper: false, rolbypassrls: true });
      const visible = await raw.begin(async (scope) => {
        const readerDb = scope as unknown as typeof raw;
        await readerDb`SET LOCAL ROLE ${raw(readerRole)}`;
        return readerDb`SELECT conditions, source_document_id FROM public.published_fee_catalog WHERE id = ${reversed.feePublishedId}`;
      });
      expect(visible[0]).toMatchObject({ conditions: correctedCondition, source_document_id: DOC_OLD });
    } finally {
      await raw`REVOKE SELECT ON public.published_fee_catalog, public.published_fee_records,
        public.verified_fee_observations, public.raw_fee_observations, public.pipeline_feedback,
        public.published_fee_corrections, public.source_documents FROM ${raw(readerRole)}`;
      await raw`REVOKE USAGE ON SCHEMA public FROM ${raw(readerRole)}`;
      await raw`DROP ROLE ${raw(readerRole)}`;
    }

    // An inconsistent historic correction must not expose another bank's document URL,
    // or combine that document ID with the original source URL/R2 as a silent fallback.
    const otherInstitution = INST + 1;
    const otherDocument = DOC_NEWEST + 1;
    await raw`INSERT INTO institution_sources (id, institution_name, charter_type, source, state_code)
      VALUES (${otherInstitution}, 'Other H03 Test Bank', 'bank', 'fdic', 'TX')`;
    await raw`INSERT INTO source_documents (id, institution_id, status, document_url)
      VALUES (${otherDocument}, ${otherInstitution}, 'success', 'https://other-bank.test/private-source')`;
    try {
      await raw`UPDATE published_fee_corrections SET source_document_id = ${otherDocument} WHERE id = ${reversed.correctionId}`;
      expect(await read(reversed.feePublishedId)).toMatchObject({ conditions: correctedCondition,
        source_document_id: null, source_url: null, document_url: null, document_r2_key: null });
    } finally {
      await raw`UPDATE published_fee_corrections SET source_document_id = ${DOC_OLD} WHERE id = ${reversed.correctionId}`;
      await raw`DELETE FROM source_documents WHERE id = ${otherDocument}`;
      await raw`DELETE FROM institution_sources WHERE id = ${otherInstitution}`;
    }
  });
});
