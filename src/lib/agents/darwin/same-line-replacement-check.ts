import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { frequencyClass } from "@/lib/agents/hamilton/exact-duplicate";
import {
  SAME_LINE_DUPLICATE_CHECK,
  SAME_LINE_DUPLICATE_FLAG,
  SAME_LINE_DUPLICATE_REASON,
  sameLineReplacementSql,
} from "@/lib/agents/hamilton/same-line-duplicates";
import { repeatsScheduleLine } from "@/lib/agents/darwin/product-page-repeat-check";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of same-line copies the v1 restore brought back beside their older line's
 * replacement (#1673; decision 2026-10-15, "Darwin re-checks every live fee against today's
 * rules"). Hamilton's same-line check (`hamilton/same-line-duplicates.ts`) took a copy down as
 * `same_line_duplicate: live fee #<older>` and brought it back once `<older>` was no longer live.
 * But `<older>` had often come down because a newer line of the same fee replaced it (`refreshed by
 * #N`, `duplicate of #N`, another same-line takedown), so the restore put a second copy beside
 * that replacement: Stop Payment $19.95 at institution 2580 showed as 15109 "for each check
 * requested for stop payment." beside 141864 "Stop Payment Fee - Check". The restore now follows
 * the replacement (v2); this re-check reads the copies v1 already brought back.
 *
 * A live fee comes down only when all of these hold:
 * - Hamilton's same-line check confirmed its takedown (its `hamilton.same_line_duplicate` second-look
 *   row is `takedown_confirmed`), and it is live again;
 * - the older line that takedown named has a replacement, followed down the chain
 *   (`sameLineReplacementSql`, the restore's own rule), that is live and unquarantined at the same
 *   institution, category and dollar amount, and is not the fee itself;
 * - the two names name one item (`repeatsScheduleLine`), their variants are the same, and their
 *   frequencies do not differ (an unknown frequency never differs).
 * A replacement the account type hold took down counts for the restore but not here: this check
 * takes a fee down only while the bank's price stays shown once.
 *
 * Shadow first: with `SAME_LINE_REPLACEMENT_TAKEDOWN_LIVE` false (it is on since James's yes,
 * 2026-10-26), or in a dry run, the step only reports. Switched on, a match goes through the shared 12-hour
 * second look (check `darwin.same_line_replacement`) and is archived on its second failure while its
 * replacement is still live: rolled back as `same_line_duplicate: live fee #<replacement>` (so
 * Hamilton's restore brings it back if that line goes), the verified row rejected with the
 * `same_line_duplicate` flag, never deleted, and a `darwin.same_line_replacement_takedown` event
 * lists them.
 *
 * Dry run, prod read-only, 2026-10-25 22:14 UTC (`SAME_LINE_REPLACEMENT_ROWS_SQL` through
 * `findSameLineReplacements`): 17 live fees after a confirmed same-line takedown; 8 at 5
 * institutions sit beside a live replacement at their category and price, name the same item and
 * would come down (15109, 66618, 104751, 104866, and 105031 to 105034 at institution 8058); 9 stay.
 * 104751's replacement is two steps on (98076 refreshed by 121389, a duplicate of live 150871).
 * 104891's replacement 146656 is held by the account type hold, so it stays here; the hold judges it.
 */
export const SAME_LINE_REPLACEMENT_CHECK = "darwin.same_line_replacement";
export const SAME_LINE_REPLACEMENT_CHECK_VERSION = 1;
/** The switch: on takes matches down after the second look; off only reports. */
export const SAME_LINE_REPLACEMENT_TAKEDOWN_LIVE = true;
/** Live fees read per step (a few dozen; the cap is a guard). */
export const SAME_LINE_REPLACEMENT_LIMIT = 5_000;
export const SAME_LINE_REPLACEMENT_SAMPLES = 20;

export interface SameLineReplacementRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  fee_name: string | null;
  amount: number | string | null;
  canonical_fee_key: string | null;
  frequency: string | null;
  variant_type: string | null;
  older_fee_published_id: number | string | null;
  replacement_fee_published_id: number | string | null;
  replacement_fee_name: string | null;
  replacement_frequency: string | null;
  replacement_variant_type: string | null;
}

export interface SameLineReplacementMatch {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  feeName: string;
  amount: number | null;
  canonicalFeeKey: string | null;
  olderFeePublishedId: number | null;
  replacementFeePublishedId: number;
  replacementFeeName: string | null;
  reason: string;
}

export interface SameLineReplacementFindings {
  /** Live fees read after a confirmed same-line takedown. */
  checked: number;
  /** Of those, the ones whose older line has a live replacement at their category and price. */
  withReplacement: number;
  matched: number;
  institutions: number;
  samples: SameLineReplacementMatch[];
}

export interface SameLineReplacementResult extends SameLineReplacementFindings {
  live: boolean;
  dryRun: boolean;
  flagged: number;
  waiting: number;
  cleared: number;
  takenDown: number[];
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function frequenciesDiffer(one: string | null, two: string | null): boolean {
  const [a, b] = [frequencyClass(one), frequencyClass(two)];
  return a != null && b != null && a !== b;
}

/** Pure: each live copy with a verdict. `passing` is every fee read that stays. */
export function findSameLineReplacements(rows: SameLineReplacementRow[]): SameLineReplacementFindings & { matches: SameLineReplacementMatch[]; passing: number[] } {
  const matches: SameLineReplacementMatch[] = [];
  const passing: number[] = [];
  let withReplacement = 0;
  const sorted = [...rows].sort((a, b) => Number(a.fee_published_id) - Number(b.fee_published_id));
  for (const row of sorted) {
    const feePublishedId = Number(row.fee_published_id);
    const replacement = num(row.replacement_fee_published_id);
    if (replacement == null || replacement === feePublishedId) {
      passing.push(feePublishedId);
      continue;
    }
    withReplacement += 1;
    const same = repeatsScheduleLine(row.fee_name, row.replacement_fee_name)
      && (row.variant_type ?? "") === (row.replacement_variant_type ?? "")
      && !frequenciesDiffer(row.frequency, row.replacement_frequency);
    if (!same) {
      passing.push(feePublishedId);
      continue;
    }
    matches.push({
      feePublishedId,
      feeVerifiedId: num(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      feeName: row.fee_name ?? "",
      amount: num(row.amount),
      canonicalFeeKey: row.canonical_fee_key ?? null,
      olderFeePublishedId: num(row.older_fee_published_id),
      replacementFeePublishedId: replacement,
      replacementFeeName: row.replacement_fee_name ?? null,
      reason: `${SAME_LINE_DUPLICATE_REASON}: live fee #${replacement}`,
    });
  }
  return {
    checked: rows.length,
    withReplacement,
    matched: matches.length,
    institutions: new Set(matches.map((fee) => fee.institutionId)).size,
    samples: matches.slice(0, SAME_LINE_REPLACEMENT_SAMPLES),
    matches,
    passing,
  };
}

/**
 * Read-only: every live dollar fee after a confirmed same-line takedown, with the older line that
 * takedown named and that line's live replacement at the fee's category and price (or NULL). The
 * same read the step makes; run it in a read-only transaction for the dry-run count. Parameters:
 * `$1` an institution id or null for all, `$2` the row cap.
 */
export const SAME_LINE_REPLACEMENT_ROWS_SQL = `
    WITH copies AS (
      SELECT DISTINCT ON (fp.fee_published_id)
             fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fp.fee_name, fp.amount,
             fp.canonical_fee_key, fp.frequency, fp.variant_type,
             NULLIF(substring(pf.evidence->>'reason' FROM 'live fee #([0-9]+)'), '')::bigint AS older_fee_published_id
        FROM pipeline_feedback pf
        JOIN published_fee_records fp ON fp.fee_published_id = pf.fee_published_id
       WHERE pf.check_name = '${SAME_LINE_DUPLICATE_CHECK}'
         AND pf.kind = 'takedown_confirmed'
         AND fp.rolled_back_at IS NULL
         AND fp.quarantined_at IS NULL
         AND fp.amount IS NOT NULL
         AND ($1::bigint IS NULL OR fp.institution_id = $1::bigint)
       ORDER BY fp.fee_published_id, pf.id DESC
    ),
    paired AS (
      SELECT c.*, ${sameLineReplacementSql("c", "c.older_fee_published_id", { countHeld: false })} AS replacement_fee_published_id
        FROM copies c
    )
    SELECT p.fee_published_id, p.fee_verified_id, p.institution_id, p.fee_name, p.amount, p.canonical_fee_key,
           p.frequency, p.variant_type, p.older_fee_published_id, p.replacement_fee_published_id,
           r.fee_name AS replacement_fee_name, r.frequency AS replacement_frequency, r.variant_type AS replacement_variant_type
      FROM paired p
      LEFT JOIN published_fee_records r ON r.fee_published_id = p.replacement_fee_published_id
     ORDER BY p.fee_published_id
     LIMIT $2::int`;

/** Read the rows (`SAME_LINE_REPLACEMENT_ROWS_SQL`). */
export function sameLineReplacementRows(db: SqlTag, options: { institutionId?: number; limit?: number } = {}): Promise<SameLineReplacementRow[]> {
  const limit = Math.max(1, Math.min(options.limit ?? SAME_LINE_REPLACEMENT_LIMIT, 50_000));
  return db.unsafe<SameLineReplacementRow[]>(SAME_LINE_REPLACEMENT_ROWS_SQL, [options.institutionId ?? null, limit]);
}

function findingsOnly(found: ReturnType<typeof findSameLineReplacements>): SameLineReplacementFindings {
  const { checked, withReplacement, matched, institutions, samples } = found;
  return { checked, withReplacement, matched, institutions, samples };
}

/**
 * One step's re-check (see the module note). Never throws: a failed read reports nothing checked,
 * and a failed write leaves the fees as they were.
 */
export async function recheckSameLineReplacements(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number; now?: Date },
): Promise<SameLineReplacementResult> {
  const live = options.live ?? SAME_LINE_REPLACEMENT_TAKEDOWN_LIVE;
  const result: SameLineReplacementResult = {
    live, dryRun: options.dryRun, ...findingsOnly(findSameLineReplacements([])), flagged: 0, waiting: 0, cleared: 0, takenDown: [],
  };
  let rows: SameLineReplacementRow[];
  try {
    rows = await inSavepoint(db, (scope) => sameLineReplacementRows(scope, { institutionId: options.institutionId, limit: options.limit }));
  } catch (error) {
    console.warn("[darwin] same-line replacement check read failed", error instanceof Error ? error.message : error);
    return result;
  }

  const found = findSameLineReplacements(rows);
  Object.assign(result, findingsOnly(found));

  if (live && !options.dryRun && (found.matches.length > 0 || found.passing.length > 0)) {
    const look = await secondLook(db, {
      check: SAME_LINE_REPLACEMENT_CHECK, runId: options.runId, failing: found.matches, passing: found.passing, dryRun: false, now: options.now,
    });
    result.flagged = look.flagged;
    result.waiting = look.waiting;
    result.cleared = look.cleared;
    if (look.confirmed.length > 0) {
      result.takenDown = await archive(db, options.runId, look.confirmed);
      if (result.takenDown.length > 0) await recordTakedownEvent(db, options, look.confirmed, result.takenDown);
    }
  }

  // The step's report, only when there is something to say. A dry run writes nothing.
  if (!options.dryRun && result.checked > 0) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${SAME_LINE_REPLACEMENT_CHECK}, 'completed',
          ${`Read ${result.checked} live fee(s) after a confirmed same-line takedown: ${result.matched} sit beside their older line's live replacement and would come down; ${live ? `${result.flagged} flagged, ${result.takenDown.length} archived` : "switch off, nothing written"}`},
          ${JSON.stringify(sameLineReplacementDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] same-line replacement check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/** Archive confirmed fees while their replacement is still live: rolled back with the reason, the verified row rejected. Never deleted. */
async function archive(db: SqlTag, runId: number, fees: SameLineReplacementMatch[]): Promise<number[]> {
  try {
    const closed = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${`darwin-same-line-replacement-${runId}`},
               rolled_back_reason = v.reason
          FROM unnest(${fees.map((fee) => fee.feePublishedId)}::bigint[], ${fees.map((fee) => fee.replacementFeePublishedId)}::bigint[], ${fees.map((fee) => fee.reason)}::text[])
               AS v(fee_published_id, replacement_id, reason)
         WHERE fp.fee_published_id = v.fee_published_id
           AND fp.rolled_back_at IS NULL
           AND EXISTS (
             SELECT 1 FROM published_fee_records r
              WHERE r.fee_published_id = v.replacement_id AND r.rolled_back_at IS NULL AND r.quarantined_at IS NULL
           )
        RETURNING fp.fee_published_id
      `;
      const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
      const verified = fees.filter((fee) => ids.has(fee.feePublishedId) && fee.feeVerifiedId != null);
      if (verified.length > 0) {
        await scope`
          UPDATE verified_fee_observations fv
             SET review_status = 'rejected',
                 outlier_flags = CASE
                   WHEN fv.outlier_flags ? ${SAME_LINE_DUPLICATE_FLAG} THEN fv.outlier_flags
                   ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${SAME_LINE_DUPLICATE_FLAG}::text)
                 END
           WHERE fv.fee_verified_id = ANY(${verified.map((fee) => fee.feeVerifiedId as number)}::bigint[])
             AND fv.review_status IN ('verified', 'approved')
        `;
      }
      return fees.filter((fee) => ids.has(fee.feePublishedId)).map((fee) => fee.feePublishedId);
    });
    if (closed.length > 0) invalidatePublicReadCache();
    return closed;
  } catch (error) {
    console.error("[darwin] same-line replacement takedown failed", error instanceof Error ? error.message : error);
    return [];
  }
}

async function recordTakedownEvent(
  db: SqlTag,
  options: { runId: number; stepId?: number | null },
  confirmed: SameLineReplacementMatch[],
  takenDown: number[],
): Promise<void> {
  const done = new Set(takenDown);
  const archived = confirmed.filter((fee) => done.has(fee.feePublishedId));
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, ${options.stepId ?? null}, 'darwin.same_line_replacement_takedown', 'completed',
        ${`Archived ${archived.length} live fee(s) that repeat their older line's live replacement, on their second look`},
        ${JSON.stringify({ version: SAME_LINE_REPLACEMENT_CHECK_VERSION, taken_down: archived.length, samples: archived.slice(0, 50).map(sampleDetail) })}::jsonb
      )
    `);
  } catch (error) {
    console.error("[darwin] same-line replacement takedown event failed", error instanceof Error ? error.message : error);
  }
}

function sampleDetail(fee: SameLineReplacementMatch) {
  return {
    fee_published_id: fee.feePublishedId,
    institution_id: fee.institutionId,
    fee_name: fee.feeName,
    amount: fee.amount,
    canonical_fee_key: fee.canonicalFeeKey,
    older_fee_published_id: fee.olderFeePublishedId,
    replacement_fee_published_id: fee.replacementFeePublishedId,
    replacement_fee_name: fee.replacementFeeName,
    reason: fee.reason,
  };
}

/** The step's detail for the run ledger. */
export function sameLineReplacementDetail(result: SameLineReplacementResult) {
  return {
    check: SAME_LINE_REPLACEMENT_CHECK,
    version: SAME_LINE_REPLACEMENT_CHECK_VERSION,
    switch_live: result.live,
    dry_run: result.dryRun,
    checked: result.checked,
    with_replacement: result.withReplacement,
    matched: result.matched,
    institutions: result.institutions,
    flagged: result.flagged,
    waiting: result.waiting,
    cleared: result.cleared,
    taken_down: result.takenDown,
    samples: result.samples.map(sampleDetail),
  };
}
