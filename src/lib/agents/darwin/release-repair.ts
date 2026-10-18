import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import {
  CLEARED_KIND,
  FLAG_CLEARED_KIND,
  secondLook,
  secondLookDedupeKey,
  secondLookEventKey,
} from "@/lib/agents/hamilton/second-look";
import { recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { inSavepoint } from "@/lib/agents/savepoint";
import { CATEGORY_GUARD_RULES } from "@/lib/fee-category-guard";

import { categoryOpinion, type CategoryModel } from "./category-model";
import { DARWIN_RELEASED_HOLD_FLAG, releaseCategoryPattern, releaseCheckHold, TEMPORARY_RELEASE_HOLDS } from "./release-held";
import { DARWIN_RECORDED_RELEASE_STRATEGY, loadReleaseCheckInputs } from "./release-review";

type SqlTag = typeof sql;

/**
 * The repair half of #1367: Darwin's live re-check of every fee its release published before the
 * release checked the category (decision 2026-10-15, "Darwin re-checks every live fee against
 * today's rules"). Until PR #1468 the release passed "." as `checkFeeAgainstSource`'s category
 * pattern, so a held fee went live when its name and amount were on the schedule, whatever its
 * category. Every fee the release published carries `darwin_released_hold` on its verified row
 * (2,566 rows on Oct 15, 1,680 of them live; 387 from the recorded-pass release that morning,
 * 239 live). A seeded sample of 20 found 2 in the wrong category, both `od_protection_transfer`
 * holding an overdraft or courtesy-pay item fee.
 *
 * Each step reads the next `RELEASE_REPAIR_BATCH` released fees after a cursor kept on the run
 * ledger (the `darwin.release_repair` event's `next_after_id`, 0 once a pass reaches the end) and
 * runs today's release check on each, `releaseCheckHold`, against the fee's own stored schedule
 * and Darwin's category model (`loadReleaseCheckInputs`). At release time either category failure
 * only keeps a fee for a person, and each alone is wrong too often to take a live fee down: the text
 * check fails real names with no heading nearby ("Service Fee" under "Basic Checking", "Bounced
 * Check", "Transfer from Savings"), and the model disputes about 6% of right fees. So:
 * - `take_down` only when both fail: no category wording on the fee's line or the rows above
 *   (`category_not_in_text`) AND the model disputes the category, naming another one with at least
 *   `RELEASE_REPAIR_SUGGEST_MIN` of its probability (`categoryOpinion`).
 * - `text_only` (the text fails, the model agrees or has no confident other pick) and `model_only`
 *   (`category_disputed`: the line names the category, the model disputes it): report only, counted
 *   and sampled apart, never acted on.
 * - `no_source_text` or `no_category_model` (`TEMPORARY_RELEASE_HOLDS`): this tick could not read
 *   what the check needs, so the fee is skipped and read again on the next pass. With no category
 *   model the whole step is skipped and the cursor stays where it was.
 * - any other hold (the name or amount not on the schedule, a tier, ...): `other`, report only.
 *   That is the source check's question (Hamilton's `source-check.ts`), not this repair's.
 *
 * The check is asked about the live fee: the live category (`published_fee_records.canonical_fee_key`)
 * and the live amount, with the name as Knox read it from the schedule (the raw row's name, as the
 * release read it). The amount-range gate inside the release verdict is skipped (`held_reason`
 * `peer_outlier`): a live fee already passed Hamilton's publish range, and the range must not
 * hide a category failure.
 *
 * While `DARWIN_RELEASE_REPAIR_LIVE` is false, or in a dry run, nothing is written but the step's
 * report. Switched on, a takedown candidate goes through the shared 12-hour second look
 * (`secondLook`, check `darwin.release_repair`): the first failure is logged `takedown_pending`
 * and the fee stays live; a later run at least 12 hours on that fails it again archives it
 * (`rolled_back_reason` `release_repair:<reason>`, batch `darwin-release-repair-<run>`, never
 * deleted) and rejects its verified row with `darwin_release_repair:<reason>` so publish does not
 * bring it back. Rejected, not re-held: the held pile is raw rows with no verified row (the release
 * selects `NOT EXISTS` a verified row), and nothing reads a verified row in another status
 * (`challenged` is allowed by the table and read by no code), so a re-hold would strand the fee;
 * the flagged reject is what Darwin's other live takedowns write and what the restore below undoes.
 * A live fee that is not a takedown candidate (a pass or any report-only bucket) clears its
 * pending flag.
 *
 * Restore: a fee this pass archived is read again on every pass, and one that no longer meets the
 * takedown bar (a newer text, a fixed rule, a retrained model) comes back in one statement: live
 * again and its verified row verified with this pass's flag removed. Only when this pass's flag is
 * the verified row's last flag (nothing flagged it after this pass rejected it; it was verified or
 * approved when this pass rejected it) and no equal fee is live at that bank; otherwise it stays
 * down (`restoreBlocked`). The second look's state row is set `takedown_cleared`, with its
 * `flag_cleared` audit row, in the same savepoint.
 *
 * No provider call: the category model is Darwin's own naive Bayes over live fee names
 * (`category-model.ts`), trained in-process from Postgres. Nothing here is a `PROVIDER_STEP_KEYS`
 * step, so the provider stop never holds it.
 */
export const RELEASE_REPAIR_CHECK = "darwin.release_repair";
/**
 * Takedown switch, on (James's OK, 2026-10-17). The full loops of Oct 16-17 found 0 takedown
 * candidates among 1,639 live released fees, so today it guards future releases. Set it to false
 * to report only.
 */
export const DARWIN_RELEASE_REPAIR_LIVE = true;
/** Released fees read per step. Each needs its schedule's stored text, so a modest share. */
export const RELEASE_REPAIR_BATCH = 250;
export const RELEASE_REPAIR_SAMPLES = 20;
export const RELEASE_REPAIR_REASON_PREFIX = "release_repair:";
/** The verified row's flag when its live fee comes down. */
export const RELEASE_REPAIR_FLAG_PREFIX = "darwin_release_repair";
/** The model's probability for its own pick that makes a dispute confident enough for a takedown. */
export const RELEASE_REPAIR_SUGGEST_MIN = 0.5;
/** The takedown reason: the text names no category wording and the model picks another category. */
export const RELEASE_REPAIR_TAKEDOWN_REASON = "category_not_in_text_and_disputed";

export interface ReleaseRepairRow {
  fee_published_id: number | string;
  fee_verified_id: number | string;
  institution_id: number | string;
  canonical_fee_key: string;
  amount: number | string | null;
  /** The live catalog name. */
  fee_name: string | null;
  /** The name as Knox read it from the schedule; what the release checked. */
  raw_fee_name: string | null;
  source_document_id: number | string | null;
  /** Null while live; set when this pass archived it. */
  rolled_back_reason: string | null;
}

export type ReleaseRepairOutcome = "pass" | "take_down" | "deferred" | "report_only";
/** Which report-only bucket a fee falls in. */
export type ReleaseRepairBucket = "text_only" | "model_only" | "other";

export interface ReleaseRepairVerdict {
  outcome: ReleaseRepairOutcome;
  /** The release-check hold, or `release_check:category_not_in_text_and_disputed` for a takedown. */
  reason: string | null;
  bucket: ReleaseRepairBucket | null;
  /** The model's own pick when it disputes the category. */
  modelSuggests: string | null;
  modelSuggestsProbability: number | null;
}

export interface ReleaseRepairSample {
  feePublishedId: number;
  feeVerifiedId: number;
  institutionId: number;
  feeName: string;
  canonicalFeeKey: string;
  amount: number | null;
  reason: string;
  /** The category model's own pick for the name, when it disputes the category. */
  modelSuggests: string | null;
  modelSuggestsProbability: number | null;
}

export interface ReleaseRepairFindings {
  checked: number;
  /** Live fees that pass today's release check. */
  passed: number;
  /** Live fees that fail the text check and the model: what would come down. */
  wouldTakeDown: number;
  /** Skipped this pass for a missing text or model; read again on the next pass. */
  deferred: number;
  /** Live fees failing the text check only: report only. */
  textOnly: number;
  /** Live fees the model alone disputes: report only. */
  modelOnly: number;
  /** Live fees with another release-check hold: report only. */
  otherHold: number;
  /** Fees this pass archived earlier that no longer meet the takedown bar: what would be restored. */
  wouldRestore: number;
  /** Fees this pass archived earlier that still meet it. */
  stillDown: number;
  byReason: Record<string, number>;
  /** Would-take-down fees by live category. */
  byCategory: Record<string, number>;
  /** Report-only fees by bucket and live category. */
  textOnlyByCategory: Record<string, number>;
  modelOnlyByCategory: Record<string, number>;
  samples: ReleaseRepairSample[];
  textOnlySamples: ReleaseRepairSample[];
  modelOnlySamples: ReleaseRepairSample[];
  otherSamples: ReleaseRepairSample[];
}

export interface ReleaseRepairResult extends ReleaseRepairFindings {
  live: boolean;
  dryRun: boolean;
  /** No category model this step: nothing judged, the cursor stays. */
  modelMissing: boolean;
  afterId: number | null;
  nextAfterId: number | null;
  /** Switched on: first failures logged for the second look. */
  flagged: number;
  /** Switched on: flagged earlier and still inside the 12 hours. */
  waiting: number;
  /** Switched on: pending flags cleared because the fee is no longer a takedown candidate. */
  cleared: number;
  takenDown: number[];
  restored: number[];
  /** Switched on: archived fees that pass now but stay down (another flag, or a live twin). */
  restoreBlocked: number;
}

interface Judged extends ReleaseRepairVerdict {
  row: ReleaseRepairRow;
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function emptyFindings(): ReleaseRepairFindings {
  return {
    checked: 0, passed: 0, wouldTakeDown: 0, deferred: 0, textOnly: 0, modelOnly: 0, otherHold: 0, wouldRestore: 0, stillDown: 0,
    byReason: {}, byCategory: {}, textOnlyByCategory: {}, modelOnlyByCategory: {},
    samples: [], textOnlySamples: [], modelOnlySamples: [], otherSamples: [],
  };
}

/**
 * Pure: today's release check on one released fee. `take_down` only when the text check and the
 * model both fail it; one failure alone is `report_only`; `deferred` when the text or the model
 * was not there to read.
 */
export function releaseRepairVerdict(
  row: Pick<ReleaseRepairRow, "fee_name" | "raw_fee_name" | "amount" | "canonical_fee_key">,
  text: string | null | undefined,
  categoryModel: CategoryModel | null,
): ReleaseRepairVerdict {
  const name = row.raw_fee_name ?? row.fee_name ?? "";
  const none = { bucket: null, modelSuggests: null, modelSuggestsProbability: null };
  const reason = releaseCheckHold(
    {
      fee_name: name,
      amount: row.amount,
      // The range is Hamilton's publish gate's question; it must not hide a category failure.
      held_reason: "peer_outlier",
      held_canonical_fee_key: row.canonical_fee_key,
    },
    text,
    categoryModel,
  );
  if (!reason) return { outcome: "pass", reason: null, ...none };
  if (TEMPORARY_RELEASE_HOLDS.has(reason)) return { outcome: "deferred", reason, ...none };
  // The text check runs before the model in the release verdict, so it can fail with no model loaded.
  if (!categoryModel) return { outcome: "deferred", reason: "release_check:no_category_model", ...none };
  const opinion = categoryOpinion(categoryModel, name, row.canonical_fee_key);
  const disputed = opinion?.disputed === true && opinion.suggested !== row.canonical_fee_key;
  const model = disputed ? { modelSuggests: opinion!.suggested, modelSuggestsProbability: opinion!.suggestedProbability } : { modelSuggests: null, modelSuggestsProbability: null };
  if (reason === "release_check:category_not_in_text") {
    if (disputed && opinion!.suggestedProbability >= RELEASE_REPAIR_SUGGEST_MIN) {
      return { outcome: "take_down", reason: `release_check:${RELEASE_REPAIR_TAKEDOWN_REASON}`, bucket: null, ...model };
    }
    return { outcome: "report_only", reason, bucket: "text_only", ...model };
  }
  if (reason === "release_check:category_disputed") return { outcome: "report_only", reason, bucket: "model_only", ...model };
  return { outcome: "report_only", reason, bucket: "other", ...model };
}

/** The reason a live fee comes down with, in `rolled_back_reason` (`release_check:` dropped). */
export function releaseRepairReason(hold: string): string {
  return `${RELEASE_REPAIR_REASON_PREFIX}${hold.replace(/^release_check:/, "")}`;
}

export function releaseRepairFlag(hold: string): string {
  return `${RELEASE_REPAIR_FLAG_PREFIX}:${hold.replace(/^release_check:/, "")}`;
}

function sampleOf(entry: Judged): ReleaseRepairSample {
  const { row } = entry;
  return {
    feePublishedId: Number(row.fee_published_id),
    feeVerifiedId: Number(row.fee_verified_id),
    institutionId: Number(row.institution_id),
    feeName: row.raw_fee_name ?? row.fee_name ?? "",
    canonicalFeeKey: row.canonical_fee_key,
    amount: num(row.amount),
    reason: entry.reason ?? "",
    modelSuggests: entry.modelSuggests,
    modelSuggestsProbability: entry.modelSuggestsProbability == null ? null : Math.round(entry.modelSuggestsProbability * 1000) / 1000,
  };
}

function bump(counts: Record<string, number>, key: string): void {
  counts[key] = (counts[key] ?? 0) + 1;
}

function pushSample(samples: ReleaseRepairSample[], entry: Judged): void {
  if (samples.length < RELEASE_REPAIR_SAMPLES) samples.push(sampleOf(entry));
}

/** Pure: judge a batch of released fees against their stored texts and the category model. */
export function judgeReleasedFees(
  rows: ReleaseRepairRow[],
  texts: Map<number, string>,
  categoryModel: CategoryModel | null,
): ReleaseRepairFindings & { judged: Judged[] } {
  const findings: ReleaseRepairFindings & { judged: Judged[] } = { ...emptyFindings(), judged: [] };
  for (const row of rows) {
    const text = row.source_document_id == null ? null : texts.get(Number(row.source_document_id)) ?? null;
    const entry: Judged = { row, ...releaseRepairVerdict(row, text, categoryModel) };
    findings.checked += 1;
    findings.judged.push(entry);
    if (entry.reason) bump(findings.byReason, entry.reason);
    const key = row.canonical_fee_key;
    if (entry.outcome === "deferred") findings.deferred += 1;
    else if (row.rolled_back_reason != null) {
      if (entry.outcome === "take_down") findings.stillDown += 1;
      else findings.wouldRestore += 1;
    } else if (entry.outcome === "pass") findings.passed += 1;
    else if (entry.outcome === "take_down") {
      findings.wouldTakeDown += 1;
      bump(findings.byCategory, key);
      pushSample(findings.samples, entry);
    } else if (entry.bucket === "text_only") {
      findings.textOnly += 1;
      bump(findings.textOnlyByCategory, key);
      pushSample(findings.textOnlySamples, entry);
    } else if (entry.bucket === "model_only") {
      findings.modelOnly += 1;
      bump(findings.modelOnlyByCategory, key);
      pushSample(findings.modelOnlySamples, entry);
    } else {
      findings.otherHold += 1;
      pushSample(findings.otherSamples, entry);
    }
  }
  return findings;
}

/**
 * The released fees after `afterId`: live ones, and ones this pass archived (for the restore
 * path). An institution-scoped read takes that bank's only.
 */
function selectReleased(db: SqlTag, afterId: number, limit: number, institutionId: number | null): Promise<ReleaseRepairRow[]> {
  return inSavepoint(db, (scope) => scope<ReleaseRepairRow[]>`
    SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fp.canonical_fee_key,
           fp.amount, fp.fee_name, r.fee_name AS raw_fee_name, r.source_document_id, fp.rolled_back_reason
      FROM published_fee_records fp
      JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
      JOIN raw_fee_observations r ON r.fee_raw_id = fv.fee_raw_id
     WHERE COALESCE(fv.outlier_flags, '[]'::jsonb) ? ${DARWIN_RELEASED_HOLD_FLAG}
       AND fp.quarantined_at IS NULL
       AND (fp.rolled_back_at IS NULL OR fp.rolled_back_reason LIKE ${`${RELEASE_REPAIR_REASON_PREFIX}%`})
       AND fp.fee_published_id > ${afterId}
       AND (${institutionId == null} OR fp.institution_id = ${institutionId ?? 0})
     ORDER BY fp.fee_published_id
     LIMIT ${limit}::int
  `);
}

async function readCursor(db: SqlTag): Promise<number> {
  const [row] = await inSavepoint(db, (scope) => scope<{ next_after_id: string | null }[]>`
    SELECT detail->>'next_after_id' AS next_after_id
      FROM agent_run_events
     WHERE event_type = ${RELEASE_REPAIR_CHECK}
       AND detail->>'next_after_id' IS NOT NULL
     ORDER BY created_at DESC, id DESC
     LIMIT 1
  `);
  return num(row?.next_after_id ?? null) ?? 0;
}

function documentIds(rows: ReleaseRepairRow[]): number[] {
  return Array.from(new Set(rows.flatMap((row) => (row.source_document_id == null ? [] : [Number(row.source_document_id)]))));
}

/**
 * One step's share of the repair (see the module note). Never throws: a failed read reports
 * nothing checked, and a failed write leaves the fees as they were.
 */
export async function recheckReleasedFees(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number; now?: Date },
): Promise<ReleaseRepairResult> {
  const live = options.live ?? DARWIN_RELEASE_REPAIR_LIVE;
  const limit = Math.max(1, Math.min(options.limit ?? RELEASE_REPAIR_BATCH, 2_000));
  const scoped = options.institutionId != null;
  const result: ReleaseRepairResult = {
    ...emptyFindings(), live, dryRun: options.dryRun, modelMissing: false,
    afterId: null, nextAfterId: null, flagged: 0, waiting: 0, cleared: 0, takenDown: [], restored: [], restoreBlocked: 0,
  };
  let rows: ReleaseRepairRow[];
  let afterId = 0;
  try {
    afterId = scoped ? 0 : await readCursor(db);
    rows = await selectReleased(db, afterId, limit, options.institutionId ?? null);
  } catch (error) {
    console.warn("[darwin] release repair read failed", error instanceof Error ? error.message : error);
    return result;
  }
  const { texts, categoryModel } = rows.length > 0 ? await loadReleaseCheckInputs(db, documentIds(rows)) : { texts: new Map<number, string>(), categoryModel: null };
  if (rows.length > 0 && !categoryModel) {
    // No model, no judgement: the batch is read again next step from the same cursor.
    result.modelMissing = true;
    result.deferred = rows.length;
    if (!scoped) result.afterId = afterId;
  } else {
    if (!scoped) {
      result.afterId = afterId;
      result.nextAfterId = rows.length < limit ? 0 : Number(rows[rows.length - 1].fee_published_id);
    }
    const { judged, ...findings } = judgeReleasedFees(rows, texts, categoryModel);
    Object.assign(result, findings);
    if (live && !options.dryRun) {
      try {
        await act(db, options, judged, result);
      } catch (error) {
        console.error("[darwin] release repair action failed", error instanceof Error ? error.message : error);
      }
    }
  }

  // The step's report, which also carries the cursor. A dry run writes nothing.
  if (!options.dryRun) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${RELEASE_REPAIR_CHECK}, 'completed',
          ${result.modelMissing
            ? `No category model: ${result.deferred} released fee(s) left for the next step`
            : `Re-checked ${result.checked} released fee(s): ${result.wouldTakeDown} fail the text check and the model, ${result.textOnly} the text only, ${result.modelOnly} the model only; ${live ? `${result.flagged} flagged, ${result.takenDown.length} archived, ${result.restored.length} restored` : "switch off, none archived"}`},
          ${JSON.stringify(releaseRepairDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] release repair event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/** The second look's state row and audit row for a confirmed takedown that comes back. */
function restoreClearedFeedback(fee: { feePublishedId: number; institutionId: number; canonicalFeeKey: string; amount: number | null; sourceDocumentId: number | null }, runId: number, now: Date): FeedbackRow[] {
  const row = {
    aboutStage: "publish" as const,
    aboutStrategy: RELEASE_REPAIR_CHECK,
    reportedBy: "gutenberg" as const,
    checkName: RELEASE_REPAIR_CHECK,
    institutionId: fee.institutionId,
    sourceDocumentId: fee.sourceDocumentId,
    feePublishedId: fee.feePublishedId,
    canonicalFeeKey: fee.canonicalFeeKey,
    amount: fee.amount,
    runId,
    evidence: { original_kind: "takedown_confirmed", restored: true, cleared_run_id: runId, cleared_at: now.toISOString() },
  };
  return [
    { ...row, dedupeKey: secondLookDedupeKey(RELEASE_REPAIR_CHECK, fee.feePublishedId), signal: "right", kind: CLEARED_KIND, weight: 1 },
    { ...row, dedupeKey: secondLookEventKey(RELEASE_REPAIR_CHECK, fee.feePublishedId, "cleared", runId), signal: "right", kind: FLAG_CLEARED_KIND, weight: 0 },
  ];
}

/** Switched on: second look for takedown candidates, archive the confirmed, restore archived fees that pass. */
async function act(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; now?: Date },
  judged: Judged[],
  result: ReleaseRepairResult,
): Promise<void> {
  const now = options.now ?? new Date();
  const candidate = ({ row, reason }: Judged) => ({
    feePublishedId: Number(row.fee_published_id),
    feeVerifiedId: Number(row.fee_verified_id),
    institutionId: Number(row.institution_id),
    canonicalFeeKey: row.canonical_fee_key,
    amount: num(row.amount),
    sourceDocumentId: num(row.source_document_id),
    reason: releaseRepairReason(reason ?? ""),
    flag: releaseRepairFlag(reason ?? ""),
  });
  const liveRows = judged.filter((entry) => entry.row.rolled_back_reason == null);
  const failing = liveRows.filter((entry) => entry.outcome === "take_down").map(candidate);
  // A pass and every report-only bucket are not takedown candidates: their pending flags clear.
  const notCandidates = liveRows
    .filter((entry) => entry.outcome === "pass" || entry.outcome === "report_only")
    .map((entry) => Number(entry.row.fee_published_id));
  const look = await secondLook(db, { check: RELEASE_REPAIR_CHECK, runId: options.runId, failing, passing: notCandidates, dryRun: false, now });
  result.flagged = look.flagged;
  result.waiting = look.waiting;
  result.cleared = look.cleared;
  const confirmed = look.confirmed;
  if (confirmed.length > 0) {
    try {
      // One savepoint: the fee comes down and its verified row is rejected together, or neither.
      result.takenDown = await inSavepoint(db, async (scope) => {
        const updated = await scope<{ fee_published_id: number | string }[]>`
          UPDATE published_fee_records fp
             SET rolled_back_at = NOW(),
                 rolled_back_by_batch_id = ${`darwin-release-repair-${options.runId}`},
                 rolled_back_reason = v.reason
            FROM unnest(${confirmed.map((fee) => fee.feePublishedId)}::bigint[], ${confirmed.map((fee) => fee.reason)}::text[])
                 AS v(fee_published_id, reason)
           WHERE fp.fee_published_id = v.fee_published_id
             AND fp.rolled_back_at IS NULL
          RETURNING fp.fee_published_id
        `;
        const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
        const done = confirmed.filter((fee) => ids.has(fee.feePublishedId));
        if (done.length > 0) {
          await scope`
            UPDATE verified_fee_observations fv
               SET review_status = 'rejected',
                   outlier_flags = COALESCE(fv.outlier_flags, '[]'::jsonb) - v.flag || jsonb_build_array(v.flag)
              FROM unnest(${done.map((fee) => fee.feeVerifiedId)}::bigint[], ${done.map((fee) => fee.flag)}::text[])
                   AS v(fee_verified_id, flag)
             WHERE fv.fee_verified_id = v.fee_verified_id
               AND fv.review_status IN ('verified', 'approved')
          `;
        }
        return done.map((fee) => fee.feePublishedId);
      });
    } catch (error) {
      console.error("[darwin] release repair takedown failed", error instanceof Error ? error.message : error);
      result.takenDown = [];
    }
  }

  // An archived fee no longer at the takedown bar comes back, in one statement with its verified row.
  const restoring = judged.filter((entry) => entry.row.rolled_back_reason != null && (entry.outcome === "pass" || entry.outcome === "report_only"));
  if (restoring.length > 0) {
    try {
      result.restored = await inSavepoint(db, async (scope) => {
        const back = await scope<{ fee_published_id: number | string }[]>`
          WITH eligible AS (
            SELECT fp.fee_published_id, fp.lineage_ref
              FROM published_fee_records fp
              JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
             WHERE fp.fee_published_id = ANY(${restoring.map((entry) => Number(entry.row.fee_published_id))}::bigint[])
               AND fp.rolled_back_at IS NOT NULL
               AND fp.rolled_back_reason LIKE ${`${RELEASE_REPAIR_REASON_PREFIX}%`}
               AND fv.review_status = 'rejected'
               -- This pass's flag is the row's last: nothing flagged it after this pass rejected it,
               -- and it was verified or approved when this pass did.
               AND fv.outlier_flags->>-1 LIKE ${`${RELEASE_REPAIR_FLAG_PREFIX}:%`}
               AND NOT EXISTS (
                 SELECT 1 FROM published_fee_records twin
                  WHERE twin.rolled_back_at IS NULL
                    AND twin.fee_published_id <> fp.fee_published_id
                    AND twin.institution_id = fp.institution_id
                    AND twin.canonical_fee_key = fp.canonical_fee_key
                    AND twin.amount IS NOT DISTINCT FROM fp.amount
                    AND twin.fee_name = fp.fee_name
               )
          ), verified AS (
            UPDATE verified_fee_observations fv
               SET review_status = 'verified',
                   outlier_flags = COALESCE((
                     SELECT jsonb_agg(flag) FROM jsonb_array_elements(fv.outlier_flags) flag
                      WHERE flag #>> '{}' NOT LIKE ${`${RELEASE_REPAIR_FLAG_PREFIX}:%`}
                   ), '[]'::jsonb)
              FROM eligible e
             WHERE fv.fee_verified_id = e.lineage_ref
            RETURNING fv.fee_verified_id
          )
          UPDATE published_fee_records fp
             SET rolled_back_at = NULL,
                 rolled_back_by_batch_id = NULL,
                 rolled_back_reason = NULL
            FROM eligible e
           WHERE fp.fee_published_id = e.fee_published_id
             AND e.lineage_ref IN (SELECT fee_verified_id FROM verified)
          RETURNING fp.fee_published_id
        `;
        const ids = new Set(back.map((row) => Number(row.fee_published_id)));
        const cleared = restoring.filter((entry) => ids.has(Number(entry.row.fee_published_id))).map(candidate);
        // The second look's state goes from confirmed to cleared with the restore, or neither happens.
        if (cleared.length > 0) await recordFeedback(scope, cleared.flatMap((fee) => restoreClearedFeedback(fee, options.runId, now)));
        return cleared.map((fee) => fee.feePublishedId);
      });
    } catch (error) {
      console.error("[darwin] release repair restore failed", error instanceof Error ? error.message : error);
      result.restored = [];
    }
    result.restoreBlocked = restoring.length - result.restored.length;
  }

  if (result.takenDown.length === 0 && result.restored.length === 0) return;
  invalidatePublicReadCache();
  const down = new Set(result.takenDown);
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, ${options.stepId ?? null}, 'darwin.release_repair_acted', 'completed',
        ${`Archived ${result.takenDown.length} released fee(s) that fail the text check and the model; restored ${result.restored.length} that no longer do`},
        ${JSON.stringify({
          batch_id: `darwin-release-repair-${options.runId}`,
          taken_down: result.takenDown.length,
          restored: result.restored,
          restore_blocked: result.restoreBlocked,
          taken_down_samples: failing.filter((fee) => down.has(fee.feePublishedId)).slice(0, RELEASE_REPAIR_SAMPLES),
        })}::jsonb
      )
    `);
  } catch (error) {
    console.error("[darwin] release repair action event failed", error instanceof Error ? error.message : error);
  }
}

function samplesDetail(samples: ReleaseRepairSample[]) {
  return samples.map((fee) => ({
    fee_published_id: fee.feePublishedId,
    fee_verified_id: fee.feeVerifiedId,
    institution_id: fee.institutionId,
    fee_name: fee.feeName,
    canonical_fee_key: fee.canonicalFeeKey,
    amount: fee.amount,
    reason: fee.reason,
    model_suggests: fee.modelSuggests,
    model_suggests_probability: fee.modelSuggestsProbability,
  }));
}

/** The step detail (and ledger event detail) for one step's share. */
export function releaseRepairDetail(result: ReleaseRepairResult) {
  return {
    check: RELEASE_REPAIR_CHECK,
    takedown_live: result.live,
    dry_run: result.dryRun,
    model_missing: result.modelMissing,
    batch: RELEASE_REPAIR_BATCH,
    after_id: result.afterId,
    next_after_id: result.nextAfterId,
    ...findingsDetail(result),
    flagged: result.flagged,
    waiting: result.waiting,
    cleared: result.cleared,
    taken_down: result.takenDown.length,
    restored: result.restored.length,
    restore_blocked: result.restoreBlocked,
  };
}

export function findingsDetail(findings: ReleaseRepairFindings) {
  return {
    checked: findings.checked,
    passed: findings.passed,
    would_take_down: findings.wouldTakeDown,
    deferred: findings.deferred,
    report_only: {
      text_only: findings.textOnly,
      model_only: findings.modelOnly,
      other: findings.otherHold,
    },
    would_restore: findings.wouldRestore,
    still_down: findings.stillDown,
    by_reason: findings.byReason,
    by_category: findings.byCategory,
    text_only_by_category: findings.textOnlyByCategory,
    model_only_by_category: findings.modelOnlyByCategory,
    samples: samplesDetail(findings.samples),
    text_only_samples: samplesDetail(findings.textOnlySamples),
    model_only_samples: samplesDetail(findings.modelOnlySamples),
    other_samples: samplesDetail(findings.otherSamples),
  };
}

/**
 * The dry-run count over every released fee, read in cursor pages, nothing written. For the count
 * James sees before the switch goes on. Run it with the Darwin verify step's
 * `release_repair_full_count: true` param. Null when a read fails or the category model is missing.
 */
export async function countReleaseRepair(db: SqlTag, options: { pageSize?: number } = {}): Promise<ReleaseRepairFindings | null> {
  const pageSize = Math.max(1, options.pageSize ?? 500);
  const totals = emptyFindings();
  let afterId = 0;
  try {
    for (;;) {
      const rows = await selectReleased(db, afterId, pageSize, null);
      if (rows.length === 0) break;
      const { texts, categoryModel } = await loadReleaseCheckInputs(db, documentIds(rows));
      if (!categoryModel) return null;
      const page = judgeReleasedFees(rows, texts, categoryModel);
      for (const key of ["checked", "passed", "wouldTakeDown", "deferred", "textOnly", "modelOnly", "otherHold", "wouldRestore", "stillDown"] as const) totals[key] += page[key];
      for (const key of ["byReason", "byCategory", "textOnlyByCategory", "modelOnlyByCategory"] as const) {
        for (const [name, count] of Object.entries(page[key])) totals[key][name] = (totals[key][name] ?? 0) + count;
      }
      for (const key of ["samples", "textOnlySamples", "modelOnlySamples", "otherSamples"] as const) {
        totals[key].push(...page[key].slice(0, RELEASE_REPAIR_SAMPLES - totals[key].length));
      }
      if (rows.length < pageSize) break;
      afterId = Number(rows[rows.length - 1].fee_published_id);
    }
  } catch (error) {
    console.warn("[darwin] release repair full count failed", error instanceof Error ? error.message : error);
    return null;
  }
  return totals;
}

/** A JS regex source as a Postgres ARE literal: `\b` is `\y` there, and `[\s\S]` is `.`. */
function postgresPattern(source: string): string {
  return source.replace(/\[\\s\\S\]/g, ".").replace(/\\b/g, "\\y").replace(/'/g, "''");
}

/**
 * Read-only SQL for someone with prod access: the live released fees by live category, as far as
 * SQL can go. The release check finds the fee's own schedule line and reads the category's wording
 * on it and the 3 rows above (`checkFeeAgainstSource`), and asks Darwin's category model; neither
 * runs in SQL. So per category this gives:
 * - `live_released`: live fees whose verified row carries `darwin_released_hold` (the pass's input).
 * - `live_from_recorded_pass`: of those, the ones the recorded-pass release (`verify.release_recorded`)
 *   published.
 * - `name_lacks_category_wording`: of those with a guard pattern (`releaseCategoryPattern`), the ones
 *   whose own name lacks the category's wording. A rough guide to the text half of the check only,
 *   neither an upper nor a lower bound: the shared check reads the matched schedule line and the
 *   rows above it, not the stored name, so a name without the wording passes under a heading that
 *   carries it, and a name with it can still fail when its line is printed differently. A takedown
 *   also needs the model to dispute the category, which SQL cannot run.
 * - `no_pattern`: categories with no guard pattern, where only the model can fail a fee.
 * The exact count is `release_repair_full_count: true` on a Darwin verify run.
 */
export function releaseRepairCandidateSql(): string {
  const patterns = Object.keys(CATEGORY_GUARD_RULES)
    .flatMap((key) => {
      const pattern = releaseCategoryPattern(key);
      return pattern ? [`('${key.replace(/'/g, "''")}', '${postgresPattern(pattern)}')`] : [];
    })
    .join(",\n    ");
  return `-- Read-only. Live fees Darwin's release published, by live category (#1367 repair).
WITH patterns(canonical_fee_key, pattern) AS (
  VALUES
    ${patterns}
), released AS (
  SELECT fp.fee_published_id, fp.canonical_fee_key, COALESCE(r.fee_name, fp.fee_name) AS name,
         EXISTS (
           SELECT 1 FROM pipeline_attempts pa
            WHERE pa.input_fingerprint = 'raw:' || fv.fee_raw_id::text
              AND pa.strategy = '${DARWIN_RECORDED_RELEASE_STRATEGY.strategy}'
              AND pa.detail->>'fee_verified_id' = fv.fee_verified_id::text
         ) AS recorded_pass
    FROM published_fee_records fp
    JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
    JOIN raw_fee_observations r ON r.fee_raw_id = fv.fee_raw_id
   WHERE fp.rolled_back_at IS NULL
     AND fp.quarantined_at IS NULL
     AND COALESCE(fv.outlier_flags, '[]'::jsonb) ? '${DARWIN_RELEASED_HOLD_FLAG}'
)
SELECT COALESCE(rel.canonical_fee_key, 'all categories') AS canonical_fee_key,
       count(*) AS live_released,
       count(*) FILTER (WHERE rel.recorded_pass) AS live_from_recorded_pass,
       count(*) FILTER (WHERE p.pattern IS NOT NULL AND rel.name !~* p.pattern) AS name_lacks_category_wording,
       count(*) FILTER (WHERE p.pattern IS NULL) AS no_pattern
  FROM released rel
  LEFT JOIN patterns p ON p.canonical_fee_key = rel.canonical_fee_key
 GROUP BY ROLLUP (rel.canonical_fee_key)
 ORDER BY live_released DESC, canonical_fee_key;`;
}

/**
 * The verify step's entry point: this step's share and, on request, the full count. Any throw
 * (synchronous or not) is caught and reported as null, so the repair can never fail the verify
 * step. `step` and `count` are injectable for tests.
 */
export async function runReleaseRepairStep(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; fullCount: boolean },
  step: typeof recheckReleasedFees = recheckReleasedFees,
  count: typeof countReleaseRepair = countReleaseRepair,
): Promise<{ result: ReleaseRepairResult | null; full: ReleaseRepairFindings | null; error: string | null }> {
  let result: ReleaseRepairResult | null = null;
  let full: ReleaseRepairFindings | null = null;
  let error: string | null = null;
  try {
    result = await step(db, { runId: options.runId, stepId: options.stepId, dryRun: options.dryRun, institutionId: options.institutionId });
  } catch (caught) {
    error = caught instanceof Error ? caught.message : String(caught);
    console.error("[darwin] release repair step failed", error);
  }
  if (options.fullCount) {
    try {
      full = await count(db);
    } catch (caught) {
      error = error ?? (caught instanceof Error ? caught.message : String(caught));
      console.error("[darwin] release repair full count failed", caught instanceof Error ? caught.message : caught);
    }
  }
  return { result, full, error };
}
