import type { sql } from "@/lib/data-store/connection";
import { inSavepoint } from "@/lib/agents/savepoint";
import { feedbackSchemaReady, recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { exactAmount, readTakedownWitness, type TakedownWitness } from "@/lib/agents/knox/takedown-witness";

type SqlTag = typeof sql;

/**
 * A takedown is a last resort (James, Oct 7): a live fee that fails a Hamilton check is
 * not taken down the first time. The first failure is logged as `takedown_pending` in the
 * shared learning store (`pipeline_feedback`); the fee is taken down only when the same
 * check fails it again on a later run, at least SECOND_LOOK_MIN_MINUTES later, so a fresh
 * read of the page or a fixed rule can clear it first. A fee that passes after a first
 * failure is logged `takedown_cleared`. Every decision stays in the log; nothing is deleted.
 */
// 12 hours: of 1,345 source-check takedowns later restored (Oct 6-7), 453 came back within an
// hour and 1,311 within 12 hours, mostly as same-day reader fixes landed.
export const SECOND_LOOK_MIN_MINUTES = 12 * 60;
export const PENDING_KIND = "takedown_pending";
export const CONFIRMED_KIND = "takedown_confirmed";
export const CLEARED_KIND = "takedown_cleared";
/**
 * The log's audit trail (UAT, Oct 9 2026). The row at `secondLookDedupeKey` carries a fee's
 * current state (pending, confirmed, cleared), because every reader of "is this fee under a
 * pending takedown" (reports, outreach, alerts, the lane scheduler, Knox's lessons) tests
 * `kind = 'takedown_pending'` / `'takedown_confirmed'` on it. Each state change also appends
 * one row keyed by the run, which is never rewritten: a first look (`flag_recorded`), its clear
 * (`flag_cleared`) or its confirmation (`flag_confirmed`), each naming the first look's run,
 * time and reason. History is appended, never overwritten.
 */
export const FLAG_RECORDED_KIND = "flag_recorded";
export const FLAG_CLEARED_KIND = "flag_cleared";
export const FLAG_CONFIRMED_KIND = "flag_confirmed";

export interface SecondLookCandidate {
  feePublishedId: number;
  institutionId: number;
  canonicalFeeKey?: string | null;
  amount?: number | null;
  sourceDocumentId?: number | null;
  reason: string;
  /** Optional original input witness supplied by the judging producer, never hydrated here. */
  takedownWitness?: TakedownWitness;
}

export interface PendingFlag {
  feePublishedId: number;
  kind: string;
  flagRunId: number | null;
  flaggedAt: Date | null;
  reason: string | null;
}

export interface SecondLookPlan<T extends SecondLookCandidate> {
  /** Failed on an earlier run too: take down now. */
  confirmed: Array<{ candidate: T; first: PendingFlag }>;
  /** First failure (or the first look is too recent): log, keep live. */
  flagged: T[];
  /** Pending and still waiting for their second look. */
  waiting: T[];
}

export function secondLookDedupeKey(check: string, feePublishedId: number): string {
  return `hamilton.second_look:${check}:pub:${feePublishedId}`;
}

/** The key of one appended audit row: the state row's key, the event and the run that wrote it. */
export function secondLookEventKey(check: string, feePublishedId: number, event: "flag" | "cleared" | "confirmed", runId: number | null): string {
  return `${secondLookDedupeKey(check, feePublishedId)}:${event}:${runId ?? "unknown"}`;
}

/**
 * Pure: which failing fees are confirmed by a second look. A pending flag confirms only
 * when it came from another run, at least `minMinutes` before `now`.
 */
export function planSecondLook<T extends SecondLookCandidate>(
  failing: T[],
  pending: Map<number, PendingFlag>,
  runId: number,
  now: Date,
  minMinutes = SECOND_LOOK_MIN_MINUTES,
): SecondLookPlan<T> {
  const plan: SecondLookPlan<T> = { confirmed: [], flagged: [], waiting: [] };
  for (const candidate of failing) {
    const flag = pending.get(candidate.feePublishedId);
    if (!flag || flag.kind !== PENDING_KIND || !flag.flaggedAt) {
      plan.flagged.push(candidate);
      continue;
    }
    const ageMinutes = (now.getTime() - flag.flaggedAt.getTime()) / 60_000;
    if (flag.flagRunId !== runId && ageMinutes >= minMinutes) plan.confirmed.push({ candidate, first: flag });
    else plan.waiting.push(candidate);
  }
  return plan;
}

export interface SecondLookResult<T extends SecondLookCandidate> {
  confirmed: T[];
  flagged: number;
  waiting: number;
  cleared: number;
  /** Present only for strict caller-owned settlement. */
  feedbackIds?: number[];
}

interface FlagRow {
  fee_published_id: number | string;
  kind: string;
  evidence: { flag_run_id?: number | string | null; flagged_at?: string | null; reason?: string | null } | null;
}

/**
 * What a run read in full (#1876): every live fee in this scope was in the check's read, so a fee
 * the run did not flag passed it, whether or not the read returned it. All bounds are optional and
 * combine: `institutionId` (an institution-scoped run), and a source-document id range
 * `(documentIdAfter, documentIdThrough]` on the fee's current document (a cursor-paged run's batch;
 * `documentIdThrough` null or absent reads to the end); with neither, the whole live table.
 * `readStartedAt` is when the check's read began: only a flag first looked at before then clears,
 * so a flag another run writes while this one reads is never cleared by a read that could not see
 * its fee. A caller passes a scope only when its read was complete for it: never for a sampled
 * read, a read that hit its row cap, or a read that failed.
 */
export interface SecondLookReadScope {
  readStartedAt: Date;
  institutionId?: number | null;
  documentIdAfter?: number | null;
  documentIdThrough?: number | null;
}

/** One clear: the state row's key and the evidence both its rows carry. */
export interface ClearState {
  feePublishedId: number;
  key: string;
  evidence: Record<string, unknown>;
  /** The state row's weight; 1 (a learned pass) unless the fee could not be judged (0, #2072). */
  weight?: number;
}

/**
 * Sets the state rows of `clears` to `takedown_cleared`, each only while it is still
 * `takedown_pending` (a row another run confirmed in the meantime keeps its confirmation).
 * Returns the fees whose row changed. The same columns `recordFeedback`'s upsert sets.
 */
export async function clearPendingStates(db: SqlTag, runId: number, clears: ClearState[]): Promise<Set<number>> {
  if (clears.length === 0) return new Set();
  const rows = await db<{ fee_published_id: number | string }[]>`
    UPDATE pipeline_feedback f
       SET signal = 'right', kind = ${CLEARED_KIND}, weight = e.weight, evidence = e.evidence, agent_run_id = ${runId}, updated_at = NOW()
      FROM jsonb_to_recordset(${JSON.stringify(clears.map((clear) => ({ key: clear.key, evidence: clear.evidence, weight: clear.weight ?? 1 })))}::jsonb) AS e(key text, evidence jsonb, weight numeric)
     WHERE f.dedupe_key = e.key
       AND f.kind = ${PENDING_KIND}
    RETURNING f.fee_published_id
  `;
  return new Set(rows.map((row) => Number(row.fee_published_id)));
}

/** `cleared_why` on a clear of a fee its run's full read no longer flags (#1876). */
export const CLEARED_NOT_FLAGGED = "not_flagged_in_scope";
/** `cleared_why` on a clear of a fee its check read but could not judge either way (#2072). */
export const CLEARED_NOT_JUDGED = "could_not_judge";

interface StaleFlagRow extends FlagRow {
  institution_id: number | string | null;
  text_missing: boolean | null;
}

/**
 * Runs the second look for one check. `failing` are the fees the check would take down
 * this run; `passing` are fees it checked and passed (clears their pending flags). With
 * `readScope`, a pending flag of this check on a live fee in that scope that this run does not
 * fail also clears: the run read every such fee and no longer flags it (#1876). Any clear changes
 * the state row only while it is still pending, and writes its audit row only then. Returns
 * only the fees to take down now. A dry run reads the log and writes nothing. If the log
 * cannot be read, nothing is taken down.
 */
export async function secondLook<T extends SecondLookCandidate>(
  db: SqlTag,
  options: {
    check: string;
    runId: number;
    failing: T[];
    passing?: number[];
    /**
     * #2072: fees the check read but could not judge (no proof either way). A pending flag on one
     * clears, recorded as `cleared_why: CLEARED_NOT_JUDGED` at weight 0, so it never counts as a
     * learned pass.
     */
    unjudged?: number[];
    dryRun: boolean;
    now?: Date;
    /** Minutes a first look must age before it confirms; Infinity logs first looks and confirms none. */
    minMinutes?: number;
    /** Opt-in: propagate unavailable/short writes to the caller-owned atomic settlement. */
    strictPersistence?: boolean;
    /** Opt-in (#1876): the scope this run read in full; clears its stale pending flags (`SecondLookReadScope`). */
    readScope?: SecondLookReadScope;
  },
): Promise<SecondLookResult<T>> {
  const { check, runId, failing, dryRun, readScope } = options;
  // #2072: an unjudged fee clears like a pass, but its clear is not a learned pass (weight 0).
  const unjudgedIds = new Set((options.unjudged ?? []).filter((id) => !(options.passing ?? []).includes(id)));
  const passing = [...(options.passing ?? []), ...unjudgedIds];
  const empty: SecondLookResult<T> = { confirmed: [], flagged: 0, waiting: 0, cleared: 0 };
  if (failing.length === 0 && passing.length === 0 && !readScope) return empty;
  const keys = failing.map((fee) => secondLookDedupeKey(check, fee.feePublishedId));
  const failingIdList = failing.map((fee) => fee.feePublishedId);
  let rows: FlagRow[];
  let stale: StaleFlagRow[] = [];
  try {
    if (!(await feedbackSchemaReady(db))) {
      if (options.strictPersistence) throw new Error("Second-look feedback unavailable");
      return { ...empty, waiting: failing.length };
    }
    rows = options.strictPersistence ? await db<FlagRow[]>`
      SELECT fee_published_id, kind, evidence FROM pipeline_feedback
       WHERE dedupe_key = ANY(${keys}::text[])
          OR (check_name = ${check} AND kind = ${PENDING_KIND} AND fee_published_id = ANY(${passing}::bigint[]))
       ORDER BY id FOR UPDATE NOWAIT
    ` : await inSavepoint(db, (scope) => scope<FlagRow[]>`
      SELECT fee_published_id, kind, evidence
        FROM pipeline_feedback
       WHERE dedupe_key = ANY(${keys}::text[])
          OR (check_name = ${check} AND kind = ${PENDING_KIND} AND fee_published_id = ANY(${passing}::bigint[]))
    `);
  } catch (error) {
    if (options.strictPersistence) throw error;
    // No log, no takedown: a fee is never taken down without its first look on record.
    console.error(`secondLook(${check}) read failed:`, error);
    return { ...empty, waiting: failing.length };
  }
  if (readScope) {
    try {
      stale = await readStaleFlags(db, check, failingIdList, readScope, options.strictPersistence === true);
    } catch (error) {
      if (options.strictPersistence) throw error;
      // A failed stale read clears nothing; flagging and confirming go on as without a scope.
      console.error(`secondLook(${check}) stale-flag read failed:`, error);
      stale = [];
    }
  }
  const pending = new Map<number, PendingFlag>(
    rows.map((row) => [
      Number(row.fee_published_id),
      {
        feePublishedId: Number(row.fee_published_id),
        kind: row.kind,
        flagRunId: row.evidence?.flag_run_id == null ? null : Number(row.evidence.flag_run_id),
        flaggedAt: row.evidence?.flagged_at ? new Date(row.evidence.flagged_at) : null,
        reason: row.evidence?.reason ?? null,
      },
    ]),
  );
  const now = options.now ?? new Date();
  const plan = planSecondLook(failing, pending, runId, now, options.minMinutes ?? SECOND_LOOK_MIN_MINUTES);
  const failingIds = new Set(failingIdList);
  const passed = passing.filter((id) => !failingIds.has(id) && pending.get(id)?.kind === PENDING_KIND);
  // A stale flag: pending on a live fee in the run's full read that this run does not fail (#1876).
  const passedIds = new Set(passed);
  const staleIds = new Set<number>();
  const textMissing = new Set<number>();
  for (const row of stale) {
    const id = Number(row.fee_published_id);
    if (failingIds.has(id) || passedIds.has(id) || staleIds.has(id) || row.kind !== PENDING_KIND) continue;
    pending.set(id, {
      feePublishedId: id,
      kind: row.kind,
      flagRunId: row.evidence?.flag_run_id == null ? null : Number(row.evidence.flag_run_id),
      flaggedAt: row.evidence?.flagged_at ? new Date(row.evidence.flagged_at) : null,
      reason: row.evidence?.reason ?? null,
    });
    staleIds.add(id);
    if (row.text_missing === true) textMissing.add(id);
  }
  const cleared = [...passed, ...staleIds];
  const result: SecondLookResult<T> = {
    confirmed: plan.confirmed.map((entry) => entry.candidate),
    flagged: plan.flagged.length,
    waiting: plan.waiting.length,
    cleared: cleared.length,
  };
  if (dryRun) return result;

  const base = (fee: SecondLookCandidate): Omit<FeedbackRow, "signal" | "kind" | "weight" | "evidence"> => ({
    aboutStage: "publish",
    aboutStrategy: check,
    reportedBy: "gutenberg",
    checkName: check,
    institutionId: fee.institutionId,
    sourceDocumentId: fee.sourceDocumentId ?? null,
    feePublishedId: fee.feePublishedId,
    canonicalFeeKey: fee.canonicalFeeKey ?? null,
    amount: fee.amount ?? null,
    runId,
    dedupeKey: secondLookDedupeKey(check, fee.feePublishedId),
  });
  const writes: FeedbackRow[] = [
    // A first look is a suspicion, not proof: weight 0 keeps it out of learned counts.
    ...plan.flagged.flatMap((fee): FeedbackRow[] => {
      const evidence = { flag_run_id: runId, flagged_at: now.toISOString(), reason: fee.reason };
      return [
        { ...base(fee), signal: "wrong" as const, kind: PENDING_KIND, weight: 0, evidence },
        // The audit row: never rewritten when the state row changes.
        { ...base(fee), signal: "wrong" as const, kind: FLAG_RECORDED_KIND, weight: 0, evidence, dedupeKey: secondLookEventKey(check, fee.feePublishedId, "flag", runId) },
      ];
    }),
    ...plan.confirmed.flatMap(({ candidate, first }): FeedbackRow[] => {
      const selected = readTakedownWitness(candidate.takedownWitness);
      const witness = selected && selected.check === check && selected.judgeRunId === runId && selected.publishedId === candidate.feePublishedId
        && selected.identity.institutionId === candidate.institutionId
        && selected.identity.category === candidate.canonicalFeeKey && selected.identity.amount === exactAmount(candidate.amount)
        && selected.source.sourceDocumentId === candidate.sourceDocumentId ? selected : null;
      const evidence = {
        flag_run_id: first.flagRunId,
        flagged_at: first.flaggedAt?.toISOString() ?? null,
        reason: first.reason,
        confirm_run_id: runId,
        confirmed_at: now.toISOString(),
        confirm_reason: candidate.reason,
        flag_key: secondLookEventKey(check, candidate.feePublishedId, "flag", first.flagRunId),
        ...(witness ? { takedown_witness: witness } : {}),
      };
      return [
        { ...base(candidate), signal: "wrong" as const, kind: CONFIRMED_KIND, weight: 0, evidence },
        { ...base(candidate), signal: "wrong" as const, kind: FLAG_CONFIRMED_KIND, weight: 0, evidence, dedupeKey: secondLookEventKey(check, candidate.feePublishedId, "confirmed", runId) },
      ];
    }),
  ];
  const clears: ClearState[] = cleared.map((id) => {
    const first = pending.get(id)!;
    return {
      feePublishedId: id,
      key: secondLookDedupeKey(check, id),
      evidence: {
        flag_run_id: first.flagRunId,
        flagged_at: first.flaggedAt?.toISOString() ?? null,
        reason: first.reason,
        original_kind: PENDING_KIND,
        cleared_run_id: runId,
        cleared_at: now.toISOString(),
        flag_key: secondLookEventKey(check, id, "flag", first.flagRunId),
        // A fee left out of a full read of its scope says so; a fee read and passed keeps the old shape.
        ...(staleIds.has(id) && readScope ? { cleared_why: CLEARED_NOT_FLAGGED, read_scope: readScopeEvidence(readScope) } : {}),
        ...(unjudgedIds.has(id) && !staleIds.has(id) ? { cleared_why: CLEARED_NOT_JUDGED } : {}),
        ...(textMissing.has(id) ? { text_missing: true } : {}),
      },
      ...(unjudgedIds.has(id) && !staleIds.has(id) ? { weight: 0 } : {}),
    };
  });
  // The audit row of a clear, written only when its state row changed from pending.
  const clearAudit = (clear: ClearState): FeedbackRow => ({
    aboutStage: "publish",
    aboutStrategy: check,
    reportedBy: "gutenberg",
    checkName: check,
    feePublishedId: clear.feePublishedId,
    runId,
    evidence: clear.evidence,
    dedupeKey: secondLookEventKey(check, clear.feePublishedId, "cleared", runId),
    signal: "right",
    kind: FLAG_CLEARED_KIND,
    weight: 0,
  });
  try {
    const { written, changed, audits } = await inSavepoint(db, async (scope) => {
      // The state row: the fee is no longer under a pending takedown. Weight 1 counts the clear once
      // (0 for a fee the check could not judge, #2072).
      // Only a row still pending changes, so a clear never overwrites a confirmation (#1876).
      const changedIds = await clearPendingStates(scope as SqlTag, runId, clears);
      const changedClears = clears.filter((clear) => changedIds.has(clear.feePublishedId));
      const auditRows = changedClears.map(clearAudit);
      return { written: await recordFeedback(scope as SqlTag, [...writes, ...auditRows]), changed: changedClears, audits: auditRows };
    });
    result.cleared = changed.length;
    if (options.strictPersistence) {
      if (written !== writes.length + audits.length || changed.length !== clears.length) throw new Error("Second-look feedback short write");
      const expected = [
        ...writes.map((row) => ({ key: row.dedupeKey, kind: row.kind, signal: row.signal, weight: row.weight ?? 1, evidence: row.evidence ?? {} })),
        ...changed.map((clear) => ({ key: clear.key, kind: CLEARED_KIND, signal: "right", weight: clear.weight ?? 1, evidence: clear.evidence })),
        ...audits.map((row) => ({ key: row.dedupeKey, kind: row.kind, signal: row.signal, weight: row.weight ?? 1, evidence: row.evidence ?? {} })),
      ];
      const persisted = await db<{ id: number | string }[]>`
        SELECT f.id FROM pipeline_feedback f
        JOIN jsonb_to_recordset(${JSON.stringify(expected)}::jsonb) AS e(key text,kind text,signal text,weight numeric,evidence jsonb)
          ON f.dedupe_key=e.key
        WHERE f.kind=e.kind AND f.signal=e.signal AND f.weight=e.weight AND f.evidence=e.evidence AND f.agent_run_id=${runId}
        ORDER BY f.id
      `;
      if (persisted.length !== expected.length) throw new Error("Second-look feedback witness missing");
      result.feedbackIds = persisted.map((row) => Number(row.id));
      if (result.feedbackIds.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new Error("Invalid second-look feedback ID");
    }
  } catch (error) {
    if (options.strictPersistence) throw error;
    // The log is the precondition for a takedown; without it, take nothing down.
    console.error(`secondLook(${check}) write failed:`, error);
    return { ...result, confirmed: [], cleared: 0 };
  }
  return result;
}

function readScopeEvidence(scope: SecondLookReadScope): Record<string, number | string | null> {
  return {
    read_started_at: scope.readStartedAt.toISOString(),
    institution_id: scope.institutionId ?? null,
    document_id_after: scope.documentIdAfter ?? null,
    document_id_through: scope.documentIdThrough ?? null,
  };
}

/**
 * This check's pending state rows on live fees in `scope` whose fee is not in `failing` and whose
 * first look came before the read started (#1876). Live is not rolled back and not quarantined: a
 * fee no check reads is not cleared by its silence. The document range is on the fee's current
 * source document (its published row's lineage). `text_missing` marks a fee whose document has no
 * stored text, so a clear says the check had nothing of it to read.
 */
async function readStaleFlags(db: SqlTag, check: string, failing: number[], scope: SecondLookReadScope, lock: boolean): Promise<StaleFlagRow[]> {
  const institutionId = scope.institutionId ?? null;
  const after = scope.documentIdAfter ?? null;
  const through = scope.documentIdThrough ?? null;
  const byDocument = after != null || through != null;
  const prefix = `hamilton.second_look:${check}:pub:`;
  const query = (scoped: SqlTag) => scoped<StaleFlagRow[]>`
    SELECT f.fee_published_id, f.kind, f.evidence, fp.institution_id,
           (fr.source_document_id IS NULL OR NOT EXISTS (
              SELECT 1 FROM agent_source_texts ast WHERE ast.source_document_id = fr.source_document_id)) AS text_missing
      FROM pipeline_feedback f
      JOIN published_fee_records fp ON fp.fee_published_id = f.fee_published_id
      LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
      LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
     WHERE f.check_name = ${check}
       AND f.kind = ${PENDING_KIND}
       AND f.dedupe_key = ${prefix} || f.fee_published_id::text
       AND NOT (f.fee_published_id = ANY(${failing}::bigint[]))
       -- A first look with no readable time, or one written after the read began, stays.
       AND CASE WHEN f.evidence->>'flagged_at' ~ '^\\d{4}-\\d{2}-\\d{2}T' THEN (f.evidence->>'flagged_at')::timestamptz END < ${scope.readStartedAt}
       AND fp.rolled_back_at IS NULL
       AND fp.quarantined_at IS NULL
       AND (${institutionId}::bigint IS NULL OR fp.institution_id = ${institutionId}::bigint)
       AND (${!byDocument} OR (fr.source_document_id IS NOT NULL
             AND (${after}::bigint IS NULL OR fr.source_document_id > ${after}::bigint)
             AND (${through}::bigint IS NULL OR fr.source_document_id <= ${through}::bigint)))
     ORDER BY f.id
     ${lock ? scoped`FOR UPDATE OF f NOWAIT` : scoped``}
  `;
  return lock ? query(db) : inSavepoint(db, (scoped) => query(scoped as SqlTag));
}

interface LegacyClearedRow {
  dedupe_key: string;
  fee_published_id: number | string;
  institution_id: number | string | null;
  source_document_id: number | string | null;
  canonical_fee_key: string | null;
  amount: number | string | null;
  evidence: { flag_run_id?: number | string | null; flagged_at?: string | null; reason?: string | null; cleared_run_id?: number | string | null; cleared_at?: string | null } | null;
}

/**
 * Writes the audit row a clear made before this trail existed: a state row now `takedown_cleared`
 * whose first look (`flag_recorded`) is missing gets one, rebuilt from the evidence the clear kept
 * (the first look's run, time and reason), marked reconstructed and naming why it was cleared.
 * Idempotent: a fee with its first look on record is skipped. Returns the rows written. A dry run
 * counts and writes nothing. UAT, Oct 9 2026: the eval verdict v5 clear rewrote 378 first looks.
 */
export async function reconstructFirstLooks(
  db: SqlTag,
  options: { check: string; runId: number; clearedWhy: string; dryRun: boolean; now?: Date },
): Promise<number> {
  const { check } = options;
  let rows: LegacyClearedRow[];
  try {
    if (!(await feedbackSchemaReady(db))) return 0;
    rows = await inSavepoint(db, (scope) => scope<LegacyClearedRow[]>`
      SELECT s.dedupe_key, s.fee_published_id, s.institution_id, s.source_document_id, s.canonical_fee_key, s.amount, s.evidence
        FROM pipeline_feedback s
       WHERE s.check_name = ${check}
         AND s.kind = ${CLEARED_KIND}
         AND s.dedupe_key = ${`hamilton.second_look:${check}:pub:`} || s.fee_published_id::text
         AND NOT EXISTS (
               SELECT 1 FROM pipeline_feedback a
                WHERE a.check_name = ${check}
                  AND a.kind = ${FLAG_RECORDED_KIND}
                  AND a.fee_published_id = s.fee_published_id
                  AND COALESCE(a.evidence->>'flag_run_id', 'unknown') = COALESCE(s.evidence->>'flag_run_id', 'unknown'))
       ORDER BY s.fee_published_id
       LIMIT 2000
    `);
  } catch (error) {
    console.error(`reconstructFirstLooks(${check}) read failed:`, error);
    return 0;
  }
  if (rows.length === 0 || options.dryRun) return rows.length;
  const now = (options.now ?? new Date()).toISOString();
  const writes: FeedbackRow[] = rows.map((row) => {
    const feePublishedId = Number(row.fee_published_id);
    const flagRunId = row.evidence?.flag_run_id == null ? null : Number(row.evidence.flag_run_id);
    return {
      aboutStage: "publish",
      aboutStrategy: check,
      reportedBy: "gutenberg",
      checkName: check,
      institutionId: row.institution_id == null ? null : Number(row.institution_id),
      sourceDocumentId: row.source_document_id == null ? null : Number(row.source_document_id),
      feePublishedId,
      canonicalFeeKey: row.canonical_fee_key,
      amount: row.amount == null ? null : Number(row.amount),
      runId: options.runId,
      dedupeKey: secondLookEventKey(check, feePublishedId, "flag", flagRunId),
      signal: "wrong",
      kind: FLAG_RECORDED_KIND,
      weight: 0,
      evidence: {
        flag_run_id: flagRunId,
        flagged_at: row.evidence?.flagged_at ?? null,
        reason: row.evidence?.reason ?? null,
        original_kind: PENDING_KIND,
        reconstructed_at: now,
        reconstructed_from: row.dedupe_key,
        cleared_run_id: row.evidence?.cleared_run_id == null ? null : Number(row.evidence.cleared_run_id),
        cleared_at: row.evidence?.cleared_at ?? null,
        cleared_why: options.clearedWhy,
      },
    };
  });
  try {
    await inSavepoint(db, (scope) => recordFeedback(scope as SqlTag, writes));
  } catch (error) {
    console.error(`reconstructFirstLooks(${check}) write failed:`, error);
    return 0;
  }
  return writes.length;
}
