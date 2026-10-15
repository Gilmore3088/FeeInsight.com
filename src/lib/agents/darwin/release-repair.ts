import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { secondLook } from "@/lib/agents/hamilton/second-look";
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
 * and Darwin's category model (`loadReleaseCheckInputs`):
 * - `category_not_in_text` or `category_disputed`: the fee would come down.
 * - `no_source_text` or `no_category_model` (`TEMPORARY_RELEASE_HOLDS`): this tick could not read
 *   what the check needs, so the fee is skipped and read again on the next pass. With no category
 *   model the whole step is skipped and the cursor stays where it was.
 * - any other hold (the name or amount not on the schedule, a tier, ...): counted and sampled, never
 *   acted on here. That is the source check's question (Hamilton's `source-check.ts`), not this
 *   repair's.
 *
 * The check is asked about the live fee: the live category (`published_fee_records.canonical_fee_key`)
 * and the live amount, with the name as Knox read it from the schedule (the raw row's name, as the
 * release read it). The amount-range gate inside the release verdict is skipped (`held_reason`
 * `peer_outlier`): a live fee already passed Hamilton's publish range, and the range must not
 * hide a category failure.
 *
 * While `DARWIN_RELEASE_REPAIR_LIVE` is false, or in a dry run, nothing is written but the step's
 * report. Switched on, a failing live fee goes through the shared 12-hour second look
 * (`secondLook`, check `darwin.release_repair`): the first failure is logged `takedown_pending`
 * and the fee stays live; a later run at least 12 hours on that fails it again archives it
 * (`rolled_back_reason` `release_repair:<reason>`, batch `darwin-release-repair-<run>`, never
 * deleted) and rejects its verified row with `darwin_release_repair:<reason>` so publish does not
 * bring it back. A live fee that passes clears any pending flag. A fee this pass archived is read
 * again on every pass; one that passes today's check (a newer text, a fixed rule, a retrained
 * model) is restored: put back live, its verified row set back to verified with the flag removed,
 * unless an equal fee is live at that bank already.
 *
 * No provider call: the category model is Darwin's own naive Bayes over live fee names
 * (`category-model.ts`), trained in-process from Postgres. Nothing here is a `PROVIDER_STEP_KEYS`
 * step, so the provider stop never holds it.
 */
export const RELEASE_REPAIR_CHECK = "darwin.release_repair";
/**
 * Default-off takedown switch. It turns on by PR after James has seen the whole dry run by reason
 * and category (`release_repair_full_count: true` on a Darwin verify run) and a hand check of the
 * fees it would take down.
 */
export const DARWIN_RELEASE_REPAIR_LIVE = false;
/** Released fees read per step. Each needs its schedule's stored text, so a modest share. */
export const RELEASE_REPAIR_BATCH = 250;
export const RELEASE_REPAIR_SAMPLES = 20;
export const RELEASE_REPAIR_REASON_PREFIX = "release_repair:";
/** The verified row's flag when its live fee comes down. */
export const RELEASE_REPAIR_FLAG_PREFIX = "darwin_release_repair";
/** The release-check holds that take a live fee down. Every other hold is reported only. */
export const RELEASE_REPAIR_TAKEDOWN_HOLDS: ReadonlySet<string> = new Set([
  "release_check:category_not_in_text",
  "release_check:category_disputed",
]);

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

export interface ReleaseRepairSample {
  feePublishedId: number;
  feeVerifiedId: number;
  institutionId: number;
  feeName: string;
  canonicalFeeKey: string;
  amount: number | null;
  reason: string;
  /** The category model's own pick for the name, when it has an opinion. */
  modelSuggests: string | null;
}

export interface ReleaseRepairFindings {
  checked: number;
  /** Live fees that pass today's release check. */
  passed: number;
  /** Live fees that fail on the category: what would come down. */
  wouldTakeDown: number;
  /** Skipped this pass for a missing text or model; read again on the next pass. */
  deferred: number;
  /** Live fees with another release-check hold: counted, not acted on. */
  reportOnly: number;
  /** Fees this pass archived earlier that pass today: what would be restored. */
  wouldRestore: number;
  /** Fees this pass archived earlier that still fail. */
  stillDown: number;
  byReason: Record<string, number>;
  /** Would-take-down fees by live category. */
  byCategory: Record<string, number>;
  samples: ReleaseRepairSample[];
  reportOnlySamples: ReleaseRepairSample[];
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
  /** Switched on: pending flags cleared because the fee passes now. */
  cleared: number;
  takenDown: number[];
  restored: number[];
}

interface Judged {
  row: ReleaseRepairRow;
  outcome: ReleaseRepairOutcome;
  reason: string | null;
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Pure: today's release check on one released fee. `take_down` only for a category failure;
 * `deferred` when the text or the model was not there to read.
 */
export function releaseRepairVerdict(
  row: Pick<ReleaseRepairRow, "fee_name" | "raw_fee_name" | "amount" | "canonical_fee_key">,
  text: string | null | undefined,
  categoryModel: CategoryModel | null,
): { outcome: ReleaseRepairOutcome; reason: string | null } {
  const reason = releaseCheckHold(
    {
      fee_name: row.raw_fee_name ?? row.fee_name ?? "",
      amount: row.amount,
      // The range is Hamilton's publish gate's question; it must not hide a category failure.
      held_reason: "peer_outlier",
      held_canonical_fee_key: row.canonical_fee_key,
    },
    text,
    categoryModel,
  );
  if (!reason) return { outcome: "pass", reason: null };
  if (TEMPORARY_RELEASE_HOLDS.has(reason)) return { outcome: "deferred", reason };
  if (RELEASE_REPAIR_TAKEDOWN_HOLDS.has(reason)) return { outcome: "take_down", reason };
  return { outcome: "report_only", reason };
}

/** The reason a live fee comes down with, in `rolled_back_reason` (`release_check:` dropped). */
export function releaseRepairReason(hold: string): string {
  return `${RELEASE_REPAIR_REASON_PREFIX}${hold.replace(/^release_check:/, "")}`;
}

export function releaseRepairFlag(hold: string): string {
  return `${RELEASE_REPAIR_FLAG_PREFIX}:${hold.replace(/^release_check:/, "")}`;
}

function sampleOf(row: ReleaseRepairRow, reason: string, model: CategoryModel | null): ReleaseRepairSample {
  const name = row.raw_fee_name ?? row.fee_name ?? "";
  const opinion = model ? categoryOpinion(model, name, row.canonical_fee_key) : null;
  return {
    feePublishedId: Number(row.fee_published_id),
    feeVerifiedId: Number(row.fee_verified_id),
    institutionId: Number(row.institution_id),
    feeName: name,
    canonicalFeeKey: row.canonical_fee_key,
    amount: num(row.amount),
    reason,
    modelSuggests: opinion && opinion.suggested !== row.canonical_fee_key ? opinion.suggested : null,
  };
}

/** Pure: judge a batch of released fees against their stored texts and the category model. */
export function judgeReleasedFees(
  rows: ReleaseRepairRow[],
  texts: Map<number, string>,
  categoryModel: CategoryModel | null,
): ReleaseRepairFindings & { judged: Judged[] } {
  const findings: ReleaseRepairFindings & { judged: Judged[] } = {
    checked: 0, passed: 0, wouldTakeDown: 0, deferred: 0, reportOnly: 0, wouldRestore: 0, stillDown: 0,
    byReason: {}, byCategory: {}, samples: [], reportOnlySamples: [], judged: [],
  };
  for (const row of rows) {
    const text = row.source_document_id == null ? null : texts.get(Number(row.source_document_id)) ?? null;
    const { outcome, reason } = releaseRepairVerdict(row, text, categoryModel);
    findings.checked += 1;
    findings.judged.push({ row, outcome, reason });
    if (reason) findings.byReason[reason] = (findings.byReason[reason] ?? 0) + 1;
    const archived = row.rolled_back_reason != null;
    if (outcome === "deferred") findings.deferred += 1;
    else if (archived) {
      if (outcome === "pass") findings.wouldRestore += 1;
      else findings.stillDown += 1;
    } else if (outcome === "pass") findings.passed += 1;
    else if (outcome === "take_down") {
      findings.wouldTakeDown += 1;
      findings.byCategory[row.canonical_fee_key] = (findings.byCategory[row.canonical_fee_key] ?? 0) + 1;
      if (findings.samples.length < RELEASE_REPAIR_SAMPLES) findings.samples.push(sampleOf(row, reason!, categoryModel));
    } else {
      findings.reportOnly += 1;
      if (findings.reportOnlySamples.length < RELEASE_REPAIR_SAMPLES) findings.reportOnlySamples.push(sampleOf(row, reason!, categoryModel));
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
    live, dryRun: options.dryRun, modelMissing: false, checked: 0, passed: 0, wouldTakeDown: 0, deferred: 0, reportOnly: 0,
    wouldRestore: 0, stillDown: 0, byReason: {}, byCategory: {}, samples: [], reportOnlySamples: [],
    afterId: null, nextAfterId: null, flagged: 0, waiting: 0, cleared: 0, takenDown: [], restored: [],
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
    const found = judgeReleasedFees(rows, texts, categoryModel);
    const { judged, ...findings } = found;
    Object.assign(result, findings);
    if (live && !options.dryRun) await act(db, options, judged, result);
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
            : `Re-checked ${result.checked} released fee(s): ${result.wouldTakeDown} fail on the category, ${live ? `${result.flagged} flagged, ${result.takenDown.length} archived, ${result.restored.length} restored` : "switch off, none archived"}`},
          ${JSON.stringify(releaseRepairDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] release repair event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/** Switched on: second look for failures, archive the confirmed, restore archived fees that pass. */
async function act(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; now?: Date },
  judged: Judged[],
  result: ReleaseRepairResult,
): Promise<void> {
  const failing = judged
    .filter((entry) => entry.outcome === "take_down" && entry.row.rolled_back_reason == null)
    .map(({ row, reason }) => ({
      feePublishedId: Number(row.fee_published_id),
      feeVerifiedId: Number(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      canonicalFeeKey: row.canonical_fee_key,
      amount: num(row.amount),
      sourceDocumentId: num(row.source_document_id),
      reason: releaseRepairReason(reason!),
      flag: releaseRepairFlag(reason!),
    }));
  const passingLive = judged
    .filter((entry) => entry.outcome === "pass" && entry.row.rolled_back_reason == null)
    .map((entry) => Number(entry.row.fee_published_id));
  const look = await secondLook(db, { check: RELEASE_REPAIR_CHECK, runId: options.runId, failing, passing: passingLive, dryRun: false, now: options.now });
  result.flagged = look.flagged;
  result.waiting = look.waiting;
  result.cleared = look.cleared;
  const confirmed = look.confirmed;
  if (confirmed.length > 0) {
    try {
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
                   outlier_flags = CASE
                     WHEN fv.outlier_flags ? v.flag THEN fv.outlier_flags
                     ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(v.flag)
                   END
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

  // An archived fee that passes today's check comes back, unless an equal fee is live at that bank.
  const restoring = judged.filter((entry) => entry.outcome === "pass" && entry.row.rolled_back_reason != null);
  if (restoring.length > 0) {
    try {
      result.restored = await inSavepoint(db, async (scope) => {
        const back = await scope<{ fee_published_id: number | string; lineage_ref: number | string }[]>`
          UPDATE published_fee_records fp
             SET rolled_back_at = NULL,
                 rolled_back_by_batch_id = NULL,
                 rolled_back_reason = NULL
           WHERE fp.fee_published_id = ANY(${restoring.map((entry) => Number(entry.row.fee_published_id))}::bigint[])
             AND fp.rolled_back_reason LIKE ${`${RELEASE_REPAIR_REASON_PREFIX}%`}
             AND NOT EXISTS (
               SELECT 1 FROM published_fee_records twin
                WHERE twin.rolled_back_at IS NULL
                  AND twin.fee_published_id <> fp.fee_published_id
                  AND twin.institution_id = fp.institution_id
                  AND twin.canonical_fee_key = fp.canonical_fee_key
                  AND twin.amount IS NOT DISTINCT FROM fp.amount
                  AND twin.fee_name = fp.fee_name
             )
          RETURNING fp.fee_published_id, fp.lineage_ref
        `;
        if (back.length > 0) {
          await scope`
            UPDATE verified_fee_observations fv
               SET review_status = 'verified',
                   outlier_flags = COALESCE((
                     SELECT jsonb_agg(flag) FROM jsonb_array_elements(fv.outlier_flags) flag
                      WHERE flag #>> '{}' NOT LIKE ${`${RELEASE_REPAIR_FLAG_PREFIX}:%`}
                   ), '[]'::jsonb)
             WHERE fv.fee_verified_id = ANY(${back.map((row) => Number(row.lineage_ref))}::bigint[])
               AND fv.review_status = 'rejected'
               AND EXISTS (
                 SELECT 1 FROM jsonb_array_elements_text(COALESCE(fv.outlier_flags, '[]'::jsonb)) flag
                  WHERE flag LIKE ${`${RELEASE_REPAIR_FLAG_PREFIX}:%`}
               )
          `;
        }
        return back.map((row) => Number(row.fee_published_id));
      });
    } catch (error) {
      console.error("[darwin] release repair restore failed", error instanceof Error ? error.message : error);
      result.restored = [];
    }
  }

  if (result.takenDown.length === 0 && result.restored.length === 0) return;
  invalidatePublicReadCache();
  const down = new Set(result.takenDown);
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, ${options.stepId ?? null}, 'darwin.release_repair_acted', 'completed',
        ${`Archived ${result.takenDown.length} released fee(s) that fail on the category; restored ${result.restored.length} that pass now`},
        ${JSON.stringify({
          batch_id: `darwin-release-repair-${options.runId}`,
          taken_down: result.takenDown.length,
          restored: result.restored,
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
  };
}

export function findingsDetail(findings: ReleaseRepairFindings) {
  return {
    checked: findings.checked,
    passed: findings.passed,
    would_take_down: findings.wouldTakeDown,
    deferred: findings.deferred,
    report_only: findings.reportOnly,
    would_restore: findings.wouldRestore,
    still_down: findings.stillDown,
    by_reason: findings.byReason,
    by_category: findings.byCategory,
    samples: samplesDetail(findings.samples),
    report_only_samples: samplesDetail(findings.reportOnlySamples),
  };
}

/**
 * The dry-run count over every released fee, read in cursor pages, nothing written. For the count
 * James sees before the switch goes on. Run it with the Darwin verify step's
 * `release_repair_full_count: true` param. Null when a read fails or the category model is missing.
 */
export async function countReleaseRepair(db: SqlTag, options: { pageSize?: number } = {}): Promise<ReleaseRepairFindings | null> {
  const pageSize = Math.max(1, options.pageSize ?? 500);
  const totals: ReleaseRepairFindings = {
    checked: 0, passed: 0, wouldTakeDown: 0, deferred: 0, reportOnly: 0, wouldRestore: 0, stillDown: 0,
    byReason: {}, byCategory: {}, samples: [], reportOnlySamples: [],
  };
  let afterId = 0;
  try {
    for (;;) {
      const rows = await selectReleased(db, afterId, pageSize, null);
      if (rows.length === 0) break;
      const { texts, categoryModel } = await loadReleaseCheckInputs(db, documentIds(rows));
      if (!categoryModel) return null;
      const page = judgeReleasedFees(rows, texts, categoryModel);
      for (const key of ["checked", "passed", "wouldTakeDown", "deferred", "reportOnly", "wouldRestore", "stillDown"] as const) totals[key] += page[key];
      for (const [reason, count] of Object.entries(page.byReason)) totals.byReason[reason] = (totals.byReason[reason] ?? 0) + count;
      for (const [key, count] of Object.entries(page.byCategory)) totals.byCategory[key] = (totals.byCategory[key] ?? 0) + count;
      totals.samples.push(...page.samples.slice(0, RELEASE_REPAIR_SAMPLES - totals.samples.length));
      totals.reportOnlySamples.push(...page.reportOnlySamples.slice(0, RELEASE_REPAIR_SAMPLES - totals.reportOnlySamples.length));
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
 *   whose own name lacks the category's wording. An upper bound on `category_not_in_text` for these
 *   categories: a name that carries the wording always passes that part, while one that lacks it
 *   still passes when a heading above its line carries it.
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
