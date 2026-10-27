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
  CLEARED_KIND, CLEARED_NOT_FLAGGED, CONFIRMED_KIND, FLAG_CLEARED_KIND, PENDING_KIND, secondLook, secondLookDedupeKey,
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

  async function flag(label: string, check = CHECK): Promise<void> {
    const evidence = { flag_run_id: FLAG_RUN, flagged_at: flaggedAt.toISOString(), reason: `test: ${label}` };
    await raw`INSERT INTO pipeline_feedback (about_stage, about_strategy, signal, kind, reported_by, check_name, institution_id, fee_published_id, weight, evidence, agent_run_id, dedupe_key)
              VALUES ('publish', ${check}, 'wrong', ${PENDING_KIND}, 'gutenberg', ${check}, ${institutionOf[label]}, ${ids[label]}, 0, ${JSON.stringify(evidence)}::jsonb, ${FLAG_RUN}, ${secondLookDedupeKey(check, ids[label])})`;
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
      check: CHECK, runId: RUN, failing: [candidate("failing")], passing: [], dryRun: false, now, readScope: { institutionId: INST },
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
      read_scope: { institution_id: INST, document_id_after: null, document_id_through: null },
    });
    // Nothing is left to clear on the next run.
    const again = await secondLook(db, { check: CHECK, runId: RUN + 1, failing: [], passing: [], dryRun: false, now, readScope: { institutionId: INST } });
    expect(again.cleared).toBe(0);
  });

  it("a document range clears only fees whose document it read", async () => {
    const look = await secondLook(db, {
      check: CHECK, runId: RUN, failing: [], passing: [], dryRun: false, now, readScope: { documentIdAfter: DOC_A - 1, documentIdThrough: DOC_A },
    });
    expect(look.cleared).toBe(2);
    expect(await stateOf("stale")).toBe(CLEARED_KIND);
    expect(await stateOf("failing")).toBe(CLEARED_KIND);
    expect(await stateOf("laterDoc")).toBe(PENDING_KIND);
    expect(await stateOf("otherInst")).toBe(PENDING_KIND);
  });

  it("a whole-table read clears every live stale flag of the check; a dry run counts and writes nothing", async () => {
    const dry = await secondLook(db, { check: CHECK, runId: RUN, failing: [candidate("failing")], passing: [], dryRun: true, now, readScope: {} });
    expect(dry.cleared).toBe(3);
    expect(await stateOf("stale")).toBe(PENDING_KIND);
    const look = await secondLook(db, { check: CHECK, runId: RUN, failing: [candidate("failing")], passing: [ids.stale], dryRun: false, now, readScope: {} });
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
      check: CHECK, runId: RUN, failing: [candidate("failing")], passing: [], dryRun: false, now, strictPersistence: true, readScope: { institutionId: INST },
    }));
    expect(look.confirmed.map((fee) => fee.feePublishedId)).toEqual([ids.failing]);
    expect(look.cleared).toBe(2);
    // Two rows (state and audit) for the confirmation and for each clear.
    expect(look.feedbackIds).toHaveLength(6);
    expect(await stateOf("stale")).toBe(CLEARED_KIND);
  });
});
