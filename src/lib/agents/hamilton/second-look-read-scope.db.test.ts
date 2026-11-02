/**
 * The second look's full-read clear in real PostgreSQL (production schema, loopback only, #1876).
 * Darwin run 13936 (Oct 27) left 15 `darwin.same_line_read` flags pending on live fees its read no
 * longer returned: a flag cleared only when its fee came back in `passing`. With `readScope`, a run
 * that read every live fee in a scope clears this check's pending flags there on fees it does not
 * fail, and nothing else: a failing fee still confirms, a rolled-back fee, another institution,
 * a document outside the range and another check's flag stay as they were.
 */
import postgres from "postgres";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { JSON_TEXT_PASSTHROUGH, NUMERIC_AS_NUMBER, TEXT_WITHOUT_NUL, type sql } from "@/lib/data-store/connection";
import {
  CLEARED_FEE_DOWN, CLEARED_KIND, CLEARED_NOT_FLAGGED, CLEARED_NOT_REFAILED, CONFIRMED_KIND, FLAG_CLEARED_KIND, PENDING_KIND, STALE_FLAG_GRACE_MINUTES,
  clearPendingStates, resolveStalePendingFlags, secondLook, secondLookDedupeKey,
  type SecondLookCandidate,
} from "./second-look";

type SqlTag = typeof sql;

const connection = process.env.E2E_DATABASE_URL;
const INST = 1876501;
const OTHER_INST = 1876502;
const DOC_A = 1876511;
const DOC_B = 1876512;
const DOC_OTHER = 1876513;
const EVENT = "00000000-0000-4000-8000-000001876500";
const CHECK = "darwin.test_read_scope";
const OTHER_CHECK = "darwin.test_read_scope_other";
const FLAG_RUN = 1876590;
const RUN = 1876591;
const now = new Date("2026-10-27T03:00:00Z");
const flaggedAt = new Date(now.getTime() - 13 * 60 * 60_000);

describe.skipIf(!connection)("second look read-scope clear in isolated PostgreSQL", () => {
  let raw: postgres.Sql<{ numeric: number; json: unknown; text: string }>;
  let db: SqlTag;
  let nextRaw = 1876600;
  const ids: Record<string, number> = {};
  const institutionOf: Record<string, number> = {};

  async function seed(label: string, institutionId: number, documentId: number): Promise<void> {
    const rawId = nextRaw++;
    await raw`INSERT INTO raw_fee_observations (fee_raw_id, institution_id, source_document_id, agent_event_id, fee_name, amount, source)
              VALUES (${rawId}, ${institutionId}, ${documentId}, ${EVENT}, ${label}, 30, 'knox')`;
    const [verified] = await raw`INSERT INTO verified_fee_observations (fee_raw_id, institution_id, canonical_fee_key, verified_by_agent_event_id, fee_name, amount, review_status)
              VALUES (${rawId}, ${institutionId}, 'overdraft', ${EVENT}, ${label}, 30, 'verified') RETURNING fee_verified_id`;
    const [published] = await raw`INSERT INTO published_fee_records (lineage_ref, institution_id, canonical_fee_key, published_by_adversarial_event_id, fee_name, amount, batch_id, source_url)
              VALUES (${verified.fee_verified_id}, ${institutionId}, 'overdraft', ${EVENT}, ${label}, 30, 'agentic-run-1876', 'https://scope.test/') RETURNING fee_published_id`;
    ids[label] = Number(published.fee_published_id);
    institutionOf[label] = institutionId;
  }

  async function flag(label: string, check = CHECK, at = flaggedAt, kind = PENDING_KIND): Promise<void> {
    const evidence = { flag_run_id: FLAG_RUN, flagged_at: at.toISOString(), reason: `test: ${label}` };
    await raw`INSERT INTO pipeline_feedback (about_stage, about_strategy, signal, kind, reported_by, check_name, institution_id, fee_published_id, weight, evidence, agent_run_id, dedupe_key)
              VALUES ('publish', ${check}, 'wrong', ${kind}, 'gutenberg', ${check}, ${institutionOf[label]}, ${ids[label]}, 0, ${JSON.stringify(evidence)}::jsonb, ${FLAG_RUN}, ${secondLookDedupeKey(check, ids[label])})
              ON CONFLICT (dedupe_key) DO UPDATE SET kind = EXCLUDED.kind, evidence = EXCLUDED.evidence`;
  }

  async function stateOf(label: string, check = CHECK): Promise<string | null> {
    const [row] = await raw`SELECT kind FROM pipeline_feedback WHERE dedupe_key = ${secondLookDedupeKey(check, ids[label])}`;
    return row ? String(row.kind) : null;
  }

  const candidate = (label: string): SecondLookCandidate => ({ feePublishedId: ids[label], institutionId: institutionOf[label], reason: `test: ${label}` });

  async function cleanFeedback(): Promise<void> {
    await raw`DELETE FROM pipeline_feedback WHERE check_name IN (${CHECK}, ${OTHER_CHECK})`;
  }

  async function cleanup(): Promise<void> {
    await cleanFeedback();
    await raw`DELETE FROM published_fee_records WHERE institution_id IN (${INST}, ${OTHER_INST})`;
    await raw`DELETE FROM verified_fee_observations WHERE institution_id IN (${INST}, ${OTHER_INST})`;
    await raw`DELETE FROM raw_fee_observations WHERE institution_id IN (${INST}, ${OTHER_INST})`;
    await raw`DELETE FROM source_documents WHERE institution_id IN (${INST}, ${OTHER_INST})`;
    await raw`DELETE FROM institution_sources WHERE id IN (${INST}, ${OTHER_INST})`;
  }

  beforeAll(async () => {
    if (!connection || !["localhost", "127.0.0.1", "[::1]"].includes(new URL(connection).hostname)) {
      throw new Error("Second look DB tests require a loopback E2E database");
    }
    raw = postgres(connection, { max: 1, ssl: "require", types: { numeric: NUMERIC_AS_NUMBER, json: JSON_TEXT_PASSTHROUGH, text: TEXT_WITHOUT_NUL } });
    db = raw as unknown as SqlTag;
    await cleanup();
    await raw`INSERT INTO institution_sources (id, institution_name, charter_type, source, state_code)
              VALUES (${INST}, 'Read Scope Test FCU', 'credit_union', 'ncua', 'PA'), (${OTHER_INST}, 'Other Scope Test FCU', 'credit_union', 'ncua', 'PA')`;
    await raw`INSERT INTO source_documents (id, institution_id, status, document_url, content_hash, crawled_at)
              VALUES (${DOC_A}, ${INST}, 'success', 'https://scope.test/a.pdf', 'h-a', NOW()),
                     (${DOC_B}, ${INST}, 'success', 'https://scope.test/b.pdf', 'h-b', NOW()),
                     (${DOC_OTHER}, ${OTHER_INST}, 'success', 'https://scope.test/other.pdf', 'h-o', NOW())`;
    await seed("stale", INST, DOC_A);
    await seed("failing", INST, DOC_A);
    await seed("laterDoc", INST, DOC_B);
    await seed("rolledBack", INST, DOC_A);
    await seed("otherInst", OTHER_INST, DOC_OTHER);
    await raw`UPDATE published_fee_records SET rolled_back_at = NOW() WHERE fee_published_id = ${ids.rolledBack}`;
  });

  beforeEach(async () => {
    await cleanFeedback();
    for (const label of ["stale", "failing", "laterDoc", "rolledBack", "otherInst"]) await flag(label);
    await flag("stale", OTHER_CHECK);
  });

  afterAll(async () => {
    if (!raw) return;
    await cleanup();
    await raw.end();
  });

  it("without a read scope a flag clears only from passing, as before", async () => {
    const look = await secondLook(db, { check: CHECK, runId: RUN, failing: [], passing: [], dryRun: false, now });
    expect(look).toEqual({ confirmed: [], flagged: 0, waiting: 0, cleared: 0 });
    expect(await stateOf("stale")).toBe(PENDING_KIND);
  });

  it("an institution's full read clears its stale flags and still confirms the failing fee", async () => {
    const look = await secondLook(db, {
      check: CHECK, runId: RUN, failing: [candidate("failing")], passing: [], dryRun: false, now, readScope: { readStartedAt: now, institutionId: INST },
    });
    expect(look.confirmed.map((fee) => fee.feePublishedId)).toEqual([ids.failing]);
    expect(look.cleared).toBe(2);
    expect(await stateOf("failing")).toBe(CONFIRMED_KIND);
    expect(await stateOf("stale")).toBe(CLEARED_KIND);
    expect(await stateOf("laterDoc")).toBe(CLEARED_KIND);
    // A fee already down, another institution and another check's flag are not this read's.
    expect(await stateOf("rolledBack")).toBe(PENDING_KIND);
    expect(await stateOf("otherInst")).toBe(PENDING_KIND);
    expect(await stateOf("stale", OTHER_CHECK)).toBe(PENDING_KIND);
    // The audit trail names why it cleared and the first look it clears.
    const [audit] = await raw`SELECT kind, evidence, agent_run_id FROM pipeline_feedback
                               WHERE dedupe_key = ${`${secondLookDedupeKey(CHECK, ids.stale)}:cleared:${RUN}`}`;
    expect(audit.kind).toBe(FLAG_CLEARED_KIND);
    expect(Number(audit.agent_run_id)).toBe(RUN);
    const evidence = typeof audit.evidence === "string" ? JSON.parse(audit.evidence) : audit.evidence;
    expect(evidence).toMatchObject({
      flag_run_id: FLAG_RUN, cleared_run_id: RUN, cleared_why: CLEARED_NOT_FLAGGED,
      read_scope: { read_started_at: now.toISOString(), institution_id: INST, document_id_after: null, document_id_through: null },
      // These test documents have no stored text: the clear says so.
      text_missing: true,
    });
    // Nothing is left to clear on the next run.
    const again = await secondLook(db, { check: CHECK, runId: RUN + 1, failing: [], passing: [], dryRun: false, now, readScope: { readStartedAt: now, institutionId: INST } });
    expect(again.cleared).toBe(0);
  });

  it("a document range clears only fees whose document it read", async () => {
    const look = await secondLook(db, {
      check: CHECK, runId: RUN, failing: [], passing: [], dryRun: false, now, readScope: { readStartedAt: now, documentIdAfter: DOC_A - 1, documentIdThrough: DOC_A },
    });
    expect(look.cleared).toBe(2);
    expect(await stateOf("stale")).toBe(CLEARED_KIND);
    expect(await stateOf("failing")).toBe(CLEARED_KIND);
    expect(await stateOf("laterDoc")).toBe(PENDING_KIND);
    expect(await stateOf("otherInst")).toBe(PENDING_KIND);
  });

  it("a whole-table read clears every live stale flag of the check; a dry run counts and writes nothing", async () => {
    const dry = await secondLook(db, { check: CHECK, runId: RUN, failing: [candidate("failing")], passing: [], dryRun: true, now, readScope: { readStartedAt: now } });
    expect(dry.cleared).toBe(3);
    expect(await stateOf("stale")).toBe(PENDING_KIND);
    const look = await secondLook(db, { check: CHECK, runId: RUN, failing: [candidate("failing")], passing: [ids.stale], dryRun: false, now, readScope: { readStartedAt: now } });
    expect(look.cleared).toBe(3);
    expect(await stateOf("otherInst")).toBe(CLEARED_KIND);
    expect(await stateOf("rolledBack")).toBe(PENDING_KIND);
    expect(await stateOf("failing")).toBe(CONFIRMED_KIND);
    // A fee cleared from passing keeps the old evidence shape.
    const [audit] = await raw`SELECT evidence FROM pipeline_feedback WHERE dedupe_key = ${`${secondLookDedupeKey(CHECK, ids.stale)}:cleared:${RUN}`}`;
    const evidence = typeof audit.evidence === "string" ? JSON.parse(audit.evidence) : audit.evidence;
    expect(evidence.cleared_why).toBeUndefined();
  });

  it("strict persistence locks and witnesses the clears in the caller's transaction", async () => {
    const look = await raw.begin(async (tx) => secondLook(tx as unknown as SqlTag, {
      check: CHECK, runId: RUN, failing: [candidate("failing")], passing: [], dryRun: false, now, strictPersistence: true, readScope: { readStartedAt: now, institutionId: INST },
    }));
    expect(look.confirmed.map((fee) => fee.feePublishedId)).toEqual([ids.failing]);
    expect(look.cleared).toBe(2);
    // Two rows (state and audit) for the confirmation and for each clear.
    expect(look.feedbackIds).toHaveLength(6);
    expect(await stateOf("stale")).toBe(CLEARED_KIND);
  });

  it("a flag first looked at after the read began stays pending", async () => {
    // Another run flagged it while this run was reading: this read could not have seen it.
    await flag("stale", CHECK, new Date(now.getTime() + 60_000));
    const look = await secondLook(db, { check: CHECK, runId: RUN, failing: [], passing: [], dryRun: false, now, readScope: { readStartedAt: now, institutionId: INST } });
    expect(look.cleared).toBe(2);
    expect(await stateOf("stale")).toBe(PENDING_KIND);
    expect(await stateOf("failing")).toBe(CLEARED_KIND);
    expect(await stateOf("laterDoc")).toBe(CLEARED_KIND);
  });

  it("a clear never overwrites a confirmation, and writes no audit row for it", async () => {
    // The stale read saw it pending; another run confirmed it before this run's write.
    await flag("stale", CHECK, flaggedAt, CONFIRMED_KIND);
    const changed = await clearPendingStates(db, RUN, [
      { feePublishedId: ids.stale, key: secondLookDedupeKey(CHECK, ids.stale), evidence: { cleared_run_id: RUN } },
      { feePublishedId: ids.laterDoc, key: secondLookDedupeKey(CHECK, ids.laterDoc), evidence: { cleared_run_id: RUN } },
    ]);
    expect([...changed]).toEqual([ids.laterDoc]);
    expect(await stateOf("stale")).toBe(CONFIRMED_KIND);
    expect(await stateOf("laterDoc")).toBe(CLEARED_KIND);
    // Through secondLook: a confirmed row is neither read as stale nor cleared from passing.
    const look = await secondLook(db, { check: CHECK, runId: RUN, failing: [], passing: [ids.stale], dryRun: false, now, readScope: { readStartedAt: now, institutionId: INST } });
    expect(look.cleared).toBe(1);
    expect(await stateOf("stale")).toBe(CONFIRMED_KIND);
    const audits = await raw`SELECT 1 FROM pipeline_feedback WHERE dedupe_key = ${`${secondLookDedupeKey(CHECK, ids.stale)}:cleared:${RUN}`}`;
    expect(audits).toHaveLength(0);
  });

  // #1876 (Nov 1): flags no check will settle. 2,000+ sat on fees another path had taken down and
  // 94 on live fees their check never read again. The stale-flag sweep settles them for every check.
  async function evidenceOf(label: string, check = CHECK): Promise<Record<string, unknown>> {
    const [row] = await raw`SELECT evidence FROM pipeline_feedback WHERE dedupe_key = ${secondLookDedupeKey(check, ids[label])}`;
    return typeof row.evidence === "string" ? JSON.parse(row.evidence) : row.evidence;
  }
  async function liveState(): Promise<string> {
    const rows = await raw`SELECT fee_published_id, rolled_back_at, quarantined_at FROM published_fee_records
                            WHERE institution_id IN (${INST}, ${OTHER_INST}) ORDER BY fee_published_id`;
    return JSON.stringify(rows);
  }

  it("the stale-flag sweep resolves a flag on a fee already down, naming the rollback, and moves no fee", async () => {
    await raw`UPDATE published_fee_records SET rolled_back_by_batch_id = 'agentic-run-1876', rolled_back_reason = 'other_bank_document: test'
               WHERE fee_published_id = ${ids.rolledBack}`;
    const before = await liveState();
    const dry = await resolveStalePendingFlags(db, { runId: RUN, dryRun: true, now });
    expect(dry.byCheck[CHECK]).toEqual([1, 4, 0]);
    expect(await stateOf("rolledBack")).toBe(PENDING_KIND);
    expect((await evidenceOf("stale")).overdue_since).toBeUndefined();

    const look = await resolveStalePendingFlags(db, { runId: RUN, dryRun: false, now });
    expect(look.error).toBeNull();
    expect(look.byCheck[CHECK]).toEqual([1, 4, 0]);
    expect(await stateOf("rolledBack")).toBe(CLEARED_KIND);
    const [state] = await raw`SELECT weight, agent_run_id FROM pipeline_feedback WHERE dedupe_key = ${secondLookDedupeKey(CHECK, ids.rolledBack)}`;
    expect(Number(state.weight)).toBe(0);
    expect(Number(state.agent_run_id)).toBe(RUN);
    expect(await evidenceOf("rolledBack")).toMatchObject({
      cleared_why: CLEARED_FEE_DOWN, flag_run_id: FLAG_RUN, cleared_run_id: RUN,
      taken_down_by: { rolled_back_by_batch_id: "agentic-run-1876", rolled_back_reason: "other_bank_document: test", quarantined_at: null },
    });
    const [audit] = await raw`SELECT kind FROM pipeline_feedback WHERE dedupe_key = ${`${secondLookDedupeKey(CHECK, ids.rolledBack)}:cleared:${RUN}`}`;
    expect(audit.kind).toBe(FLAG_CLEARED_KIND);
    // Live fees past the window are stamped overdue, still pending: never cleared on the first look.
    expect(await stateOf("stale")).toBe(PENDING_KIND);
    expect(await evidenceOf("stale")).toMatchObject({ overdue_since: now.toISOString(), overdue_run_id: RUN, flag_run_id: FLAG_RUN });
    expect(await liveState()).toBe(before);
  });

  it("an overdue live flag clears only after the grace with no re-fail; a re-fail by its check keeps it", async () => {
    await resolveStalePendingFlags(db, { runId: RUN, dryRun: false, now });
    // A switch-off run of the check fails "failing" again: it waits, and the re-fail is recorded.
    const refailAt = new Date(now.getTime() + 60 * 60_000);
    const look = await secondLook(db, {
      check: CHECK, runId: RUN + 1, failing: [candidate("failing")], passing: [], dryRun: false, now: refailAt, minMinutes: Number.POSITIVE_INFINITY,
    });
    expect(look).toMatchObject({ confirmed: [], waiting: 1 });
    const refailed = await evidenceOf("failing");
    expect(refailed).toMatchObject({ last_failed_at: refailAt.toISOString(), last_failed_run_id: RUN + 1, flag_run_id: FLAG_RUN });
    expect(refailed.overdue_since).toBeUndefined();

    const before = await liveState();
    const later = new Date(now.getTime() + (STALE_FLAG_GRACE_MINUTES + 60) * 60_000);
    const sweep = await resolveStalePendingFlags(db, { runId: RUN + 2, dryRun: false, now: later });
    expect(sweep.error).toBeNull();
    expect(await stateOf("stale")).toBe(CLEARED_KIND);
    expect(await evidenceOf("stale")).toMatchObject({
      cleared_why: CLEARED_NOT_REFAILED, overdue_since: now.toISOString(), overdue_run_id: RUN, last_failed_at: null, grace_minutes: STALE_FLAG_GRACE_MINUTES,
    });
    // Re-failed after the stamp: overdue again from this sweep, still pending.
    expect(await stateOf("failing")).toBe(PENDING_KIND);
    expect(await evidenceOf("failing")).toMatchObject({ overdue_since: later.toISOString(), last_failed_at: refailAt.toISOString() });
    // Another check's flag on the same fee is its own row.
    expect(await stateOf("stale", OTHER_CHECK)).toBe(CLEARED_KIND);
    expect(await liveState()).toBe(before);
  });
});
