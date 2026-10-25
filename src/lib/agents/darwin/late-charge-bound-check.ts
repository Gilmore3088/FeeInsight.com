import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { LATE_CHARGE_BOUND_SQL, namesLateChargeBound } from "@/lib/late-charge-bound";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of late fees that are a late charge's cap or floor (#1905; decision
 * 2026-10-15, "Darwin re-checks every live fee against today's rules"). Knox v115 no longer reads
 * them (`namesLateChargeBound` in `@/lib/late-charge-bound`), but the ones read before stay live:
 * Navy Federal's "Late charges | Generally 5% of the principal and interest ...; maximum late charge
 * of $30 in WV ... minimum late charge of $10 in ID, MD, WY" went live as three flat late fees,
 * "Maximum late charge" $30, "Minimum late charge" $10 and the fragment "Generally 5% ...; maximum
 * late charge of" $30. The figures bound a percentage charge, for one state or a few; the bank's late
 * charge is the percentage, which the rate catalog holds.
 *
 * Each verify step reads every live late_payment fee whose catalog name is such a bound (a name-only
 * read). An institution-scoped run reads that institution's only. Switched on, a match goes through
 * the shared 12-hour second look (check `darwin.late_charge_bound`) and is archived on its second
 * failure: rolled back with `late_charge_bound: <name>`, its verified row rejected with the
 * `late_charge_bound` flag so publish does not bring it back, never deleted, and a
 * `darwin.late_charge_bound_takedown` event lists them. The name of a live row does not change, so
 * the step passes no fee as cleared. In a dry run, or with the switch off, the step only reports.
 *
 * Dry run, prod read-only, 2026-10-25 (`LATE_CHARGE_BOUND_SQL` over `published_fee_catalog`): 5 live
 * fees at 3 institutions, all late_payment: Navy Federal (4956) 15729 "Generally 5% of the principal
 * and interest for conventional loans; maximum late charge of" $30, 154636 "Maximum late charge" $30,
 * 154637 "Minimum late charge" $10; 79880 "Minimum Late Fee" $10 (5338, beside "Loan Late Fee ... 5% of
 * Payment Amount"); 124614 "Minimum Late Charge" $0.50 (6789, beside "Late Charge | 5% of payment
 * due"). Each source prints the percentage the figure bounds.
 *
 * Switched on 2026-10-25 under the sampled-clean rule (DECISIONS, 2026-10-20): the independent
 * review read all 5 of the 5 dry-run fees against each bank's stored text and found every one a
 * late charge's cap or floor, not the late fee (5 of 5 correct takedowns, 0 wrong).
 */
export const LATE_CHARGE_BOUND_CHECK = "darwin.late_charge_bound";
export const LATE_CHARGE_BOUND_CHECK_VERSION = 1;
/** The switch: on (sampled clean, 5 of 5 dry-run fees correct). Set to false to only report. */
export const LATE_CHARGE_BOUND_TAKEDOWN_LIVE = true;
export const LATE_CHARGE_BOUND_REASON = "late_charge_bound";
export const LATE_CHARGE_BOUND_FLAG = "late_charge_bound";
export const LATE_CHARGE_BOUND_LIMIT = 500;
export const LATE_CHARGE_BOUND_SAMPLES = 20;
const LATE_CATEGORY = "late_payment";

export interface LateChargeBoundRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  fee_name: string | null;
  amount: number | string | null;
  canonical_fee_key: string | null;
}

export interface LateChargeBoundMatch {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  feeName: string;
  amount: number | null;
  canonicalFeeKey: string;
  reason: string;
}

export interface LateChargeBoundFindings {
  matched: number;
  institutions: number;
  samples: LateChargeBoundMatch[];
}

export interface LateChargeBoundResult extends LateChargeBoundFindings {
  live: boolean;
  dryRun: boolean;
  scoped: boolean;
  flagged: number;
  waiting: number;
  takenDown: number[];
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Pure: the matches among the rows the read selected. The SQL selects by the same pattern; the JS
 * test runs again so a row the two regex dialects read differently is never taken down.
 */
export function findLateChargeBounds(rows: LateChargeBoundRow[]): LateChargeBoundFindings & { matches: LateChargeBoundMatch[] } {
  const matches: LateChargeBoundMatch[] = [];
  const seen = new Set<number>();
  for (const row of [...rows].sort((a, b) => Number(a.fee_published_id) - Number(b.fee_published_id))) {
    const feeId = Number(row.fee_published_id);
    const name = (row.fee_name ?? "").trim();
    if (seen.has(feeId) || row.canonical_fee_key !== LATE_CATEGORY || !namesLateChargeBound(name)) continue;
    seen.add(feeId);
    matches.push({
      feePublishedId: feeId,
      feeVerifiedId: num(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      feeName: name,
      amount: num(row.amount),
      canonicalFeeKey: LATE_CATEGORY,
      reason: `${LATE_CHARGE_BOUND_REASON}: ${name.slice(0, 120)}`,
    });
  }
  return {
    matched: matches.length,
    institutions: new Set(matches.map((fee) => fee.institutionId)).size,
    samples: matches.slice(0, LATE_CHARGE_BOUND_SAMPLES),
    matches,
  };
}

/** Read-only: every live late_payment fee whose name is a late charge's cap or floor. */
export function lateChargeBoundRowsSql(db: SqlTag, options: { institutionId?: number; limit?: number } = {}) {
  const scoped = options.institutionId != null;
  const limit = Math.max(1, Math.min(options.limit ?? LATE_CHARGE_BOUND_LIMIT, 5_000));
  return db<LateChargeBoundRow[]>`
    SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fp.fee_name, fp.amount,
           fp.canonical_fee_key
      FROM published_fee_records fp
     WHERE fp.rolled_back_at IS NULL
       AND fp.quarantined_at IS NULL
       AND fp.canonical_fee_key = ${LATE_CATEGORY}
       AND fp.fee_name ~* ${LATE_CHARGE_BOUND_SQL}
       AND (${!scoped} OR fp.institution_id = ${options.institutionId ?? 0})
     ORDER BY fp.fee_published_id
     LIMIT ${limit}::int
  `;
}

/**
 * One step's re-check (see the module note). Never throws: a failed read reports nothing, and a
 * failed write leaves the fees as they were.
 */
export async function recheckLateChargeBounds(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number; now?: Date },
): Promise<LateChargeBoundResult> {
  const live = options.live ?? LATE_CHARGE_BOUND_TAKEDOWN_LIVE;
  const result: LateChargeBoundResult = {
    live, dryRun: options.dryRun, scoped: options.institutionId != null,
    matched: 0, institutions: 0, samples: [], flagged: 0, waiting: 0, takenDown: [],
  };

  let rows: LateChargeBoundRow[];
  try {
    rows = await inSavepoint(db, (scope) => lateChargeBoundRowsSql(scope, { institutionId: options.institutionId, limit: options.limit }));
  } catch (error) {
    console.warn("[darwin] late charge bound check read failed", error instanceof Error ? error.message : error);
    return result;
  }
  const { matches, ...findings } = findLateChargeBounds(rows);
  Object.assign(result, findings);

  if (live && !options.dryRun && matches.length > 0) {
    const look = await secondLook(db, {
      check: LATE_CHARGE_BOUND_CHECK, runId: options.runId, failing: matches, passing: [], dryRun: false, now: options.now,
    });
    result.flagged = look.flagged;
    result.waiting = look.waiting;
    if (look.confirmed.length > 0) {
      result.takenDown = await archive(db, options.runId, look.confirmed);
      if (result.takenDown.length > 0) await recordTakedownEvent(db, options, look.confirmed, result.takenDown);
    }
  }

  if (!options.dryRun && result.matched > 0) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${LATE_CHARGE_BOUND_CHECK}, 'completed',
          ${`Read live late fees for a late charge's cap or floor: ${result.matched} live fee(s) at ${result.institutions} institution(s); ${live ? `${result.flagged} flagged, ${result.takenDown.length} archived` : "switch off, would take down, nothing written"}`},
          ${JSON.stringify(lateChargeBoundDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] late charge bound check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/** Archive confirmed fees: rolled back with the reason, the verified row rejected with the flag. Never deleted. */
async function archive(db: SqlTag, runId: number, fees: LateChargeBoundMatch[]): Promise<number[]> {
  try {
    const closed = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${`darwin-late-charge-bound-${runId}`},
               rolled_back_reason = v.reason
          FROM unnest(${fees.map((fee) => fee.feePublishedId)}::bigint[], ${fees.map((fee) => fee.reason)}::text[])
               AS v(fee_published_id, reason)
         WHERE fp.fee_published_id = v.fee_published_id
           AND fp.rolled_back_at IS NULL
        RETURNING fp.fee_published_id
      `;
      const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
      const verified = fees.filter((fee) => ids.has(fee.feePublishedId) && fee.feeVerifiedId != null);
      if (verified.length > 0) {
        await scope`
          UPDATE verified_fee_observations fv
             SET review_status = 'rejected',
                 outlier_flags = CASE
                   WHEN fv.outlier_flags ? ${LATE_CHARGE_BOUND_FLAG} THEN fv.outlier_flags
                   ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${LATE_CHARGE_BOUND_FLAG}::text)
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
    console.error("[darwin] late charge bound takedown failed", error instanceof Error ? error.message : error);
    return [];
  }
}

async function recordTakedownEvent(
  db: SqlTag,
  options: { runId: number; stepId?: number | null },
  confirmed: LateChargeBoundMatch[],
  takenDown: number[],
): Promise<void> {
  const done = new Set(takenDown);
  const archived = confirmed.filter((fee) => done.has(fee.feePublishedId));
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, ${options.stepId ?? null}, 'darwin.late_charge_bound_takedown', 'completed',
        ${`Archived ${archived.length} live late fee(s) that are a late charge's cap or floor, on their second look`},
        ${JSON.stringify({ version: LATE_CHARGE_BOUND_CHECK_VERSION, taken_down: archived.length, samples: archived.slice(0, 50).map(sampleDetail) })}::jsonb
      )
    `);
  } catch (error) {
    console.error("[darwin] late charge bound takedown event failed", error instanceof Error ? error.message : error);
  }
}

function sampleDetail(fee: LateChargeBoundMatch) {
  return {
    fee_published_id: fee.feePublishedId,
    institution_id: fee.institutionId,
    fee_name: fee.feeName,
    amount: fee.amount,
    canonical_fee_key: fee.canonicalFeeKey,
    reason: fee.reason,
  };
}

/** The step's detail for the run ledger. */
export function lateChargeBoundDetail(result: LateChargeBoundResult) {
  return {
    check: LATE_CHARGE_BOUND_CHECK,
    version: LATE_CHARGE_BOUND_CHECK_VERSION,
    switch_live: result.live,
    dry_run: result.dryRun,
    scoped: result.scoped,
    matched: result.matched,
    institutions: result.institutions,
    flagged: result.flagged,
    waiting: result.waiting,
    taken_down: result.takenDown,
    samples: result.samples.map(sampleDetail),
  };
}
