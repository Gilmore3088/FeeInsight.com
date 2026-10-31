import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { LOAN_PAYMENT_NSF_NAME_SQL, LOAN_PAYMENT_NSF_TARGET, loanPaymentNsfName } from "@/lib/custom-report/loan-payment-nsf";
import { notAdminCorrectedSql } from "@/lib/fee-correction-guard";
import { checkFeeCategory, LOAN_PAYMENT_NSF_REFILE_LIVE } from "@/lib/fee-category-guard";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of NSF fees whose name prices a bounced loan, mortgage or lease payment
 * (Knox v144; decision 2026-10-15, "Darwin re-checks every live fee against today's rules"). Global
 * FCU (institution 5005) has "» NSF mortgage payment: Additional Cenlar charge" $25 live twice as its
 * NSF fee (67831, doc 1940; 67818, doc 19930): Cenlar is its mortgage subservicer, and the charge is
 * the loan's servicing fee. Knox v144 files new reads as other lending (`loanPaymentNsfName`), but the
 * live rows stay NSF until something re-files them.
 *
 * Each verify step reads every live NSF fee whose name matches `LOAN_PAYMENT_NSF_NAME_SQL` (never one
 * an admin corrected, `notAdminCorrectedSql`), and `loanPaymentNsfVerdict` judges it:
 * - `refile`: the JavaScript rule agrees, the category guard accepts the name as other lending, and
 *   the bank has no live other lending fee at the same price (that would be its twin). The live fee is
 *   re-filed in place, name and price unchanged.
 * - kept, reported only: `twin` (a live other lending fee at that price), `refused` (the guard refuses
 *   the name as other lending), `not_matched` (the SQL pre-filter matched, the JavaScript rule did not).
 *
 * Shadow first (CLAUDE.md standing rule): with `LOAN_PAYMENT_NSF_REFILE_LIVE` false (the default), or
 * in a dry run, the step only reports. Switched on, a `refile` goes through the shared 12-hour second
 * look and is acted on at its second failure: the live row and its verified row take other lending,
 * guarded on the old category, name and amount, still live, not quarantined, not admin-corrected and
 * no live twin, the old values logged to `pipeline_feedback` (kind `loan_payment_nsf_refiled`) and a
 * `darwin.loan_payment_nsf_refiled` event. Nothing is taken down. While this step owns the re-file,
 * Hamilton's category guard leaves these fees live rather than taking them down.
 *
 * Dry run, prod read-only, 2026-10-31: 2 live fees (67818, 67831), both Global FCU's; it has no live
 * other lending fee. See docs/project/findings/2026-10-30-nsf-on-loan-payment-filed-as-nsf.md.
 */
export const LOAN_PAYMENT_NSF_REFILE_CHECK = "darwin.loan_payment_nsf_refile";
export const LOAN_PAYMENT_NSF_REFILE_CHECK_VERSION = 1;
export const LOAN_PAYMENT_NSF_REFILED_KIND = "loan_payment_nsf_refiled";
export const LOAN_PAYMENT_NSF_LIMIT = 2_000;
export const LOAN_PAYMENT_NSF_SAMPLES = 20;

export type LoanPaymentNsfOutcome = "refile" | "twin" | "refused" | "not_matched";

export interface LoanPaymentNsfRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  fee_name: string | null;
  amount: number | string | null;
  canonical_fee_key: string;
  lending_twin: boolean | null;
}

export interface LoanPaymentNsfVerdict {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  feeName: string;
  amount: number | null;
  canonicalFeeKey: string;
  outcome: LoanPaymentNsfOutcome;
  reason: string;
}

export interface LoanPaymentNsfFindings {
  checked: number;
  outcomes: Partial<Record<LoanPaymentNsfOutcome, number>>;
  matched: number;
  institutions: number;
  samples: LoanPaymentNsfVerdict[];
  keptSamples: LoanPaymentNsfVerdict[];
}

export interface LoanPaymentNsfResult extends LoanPaymentNsfFindings {
  live: boolean;
  dryRun: boolean;
  scoped: boolean;
  flagged: number;
  waiting: number;
  refiled: number[];
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** Pure: whether a live NSF fee is a bounced loan payment's fee that moves to other lending. */
export function loanPaymentNsfVerdict(row: LoanPaymentNsfRow): LoanPaymentNsfVerdict | null {
  const name = (row.fee_name ?? "").trim();
  if (!name) return null;
  const base = {
    feePublishedId: Number(row.fee_published_id),
    feeVerifiedId: num(row.fee_verified_id),
    institutionId: Number(row.institution_id),
    feeName: name,
    amount: num(row.amount),
    canonicalFeeKey: row.canonical_fee_key,
  };
  if (row.canonical_fee_key !== "nsf" || !loanPaymentNsfName(name)) {
    return { ...base, outcome: "not_matched", reason: "the name does not price a bounced loan payment" };
  }
  if (!checkFeeCategory(LOAN_PAYMENT_NSF_TARGET, name).ok) {
    return { ...base, outcome: "refused", reason: `the category guard refuses the name as ${LOAN_PAYMENT_NSF_TARGET}` };
  }
  if (row.lending_twin) {
    return { ...base, outcome: "twin", reason: `the bank has a live ${LOAN_PAYMENT_NSF_TARGET} fee at this price` };
  }
  return { ...base, outcome: "refile", reason: `loan_payment_nsf_refile: "${name}" prices a bounced loan payment, the loan's servicing fee` };
}

/** Pure: the verdicts for the rows the read selected, counted by outcome. */
export function findLoanPaymentNsf(rows: LoanPaymentNsfRow[]): LoanPaymentNsfFindings & { matches: LoanPaymentNsfVerdict[] } {
  const verdicts: LoanPaymentNsfVerdict[] = [];
  const seen = new Set<number>();
  for (const row of [...rows].sort((a, b) => Number(a.fee_published_id) - Number(b.fee_published_id))) {
    const feeId = Number(row.fee_published_id);
    if (seen.has(feeId)) continue;
    seen.add(feeId);
    const verdict = loanPaymentNsfVerdict(row);
    if (verdict) verdicts.push(verdict);
  }
  const outcomes: Partial<Record<LoanPaymentNsfOutcome, number>> = {};
  for (const verdict of verdicts) outcomes[verdict.outcome] = (outcomes[verdict.outcome] ?? 0) + 1;
  const matches = verdicts.filter((verdict) => verdict.outcome === "refile");
  return {
    checked: seen.size,
    outcomes,
    matched: matches.length,
    institutions: new Set(matches.map((fee) => fee.institutionId)).size,
    samples: matches.slice(0, LOAN_PAYMENT_NSF_SAMPLES),
    keptSamples: verdicts.filter((verdict) => verdict.outcome !== "refile").slice(0, LOAN_PAYMENT_NSF_SAMPLES),
    matches,
  };
}

/** Read-only: every live NSF fee whose name passes the Postgres mirror, never an admin-corrected one. */
export function loanPaymentNsfRowsSql(db: SqlTag, options: { institutionId?: number; limit?: number } = {}) {
  const scoped = options.institutionId != null;
  const limit = Math.max(1, Math.min(options.limit ?? LOAN_PAYMENT_NSF_LIMIT, 10_000));
  return db<LoanPaymentNsfRow[]>`
    SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fp.fee_name, fp.amount,
           fp.canonical_fee_key,
           EXISTS (SELECT 1 FROM published_fee_records live
                    WHERE live.rolled_back_at IS NULL
                      AND live.institution_id = fp.institution_id
                      AND live.canonical_fee_key = ${LOAN_PAYMENT_NSF_TARGET}
                      AND live.amount IS NOT DISTINCT FROM fp.amount) AS lending_twin
      FROM published_fee_records fp
     WHERE fp.rolled_back_at IS NULL
       AND fp.quarantined_at IS NULL
       AND fp.canonical_fee_key = 'nsf'
       AND fp.fee_name ~* ${LOAN_PAYMENT_NSF_NAME_SQL}
       AND ${db.unsafe(notAdminCorrectedSql("fp"))}
       AND (${!scoped} OR fp.institution_id = ${options.institutionId ?? 0})
     ORDER BY fp.fee_published_id
     LIMIT ${limit}::int
  `;
}

/** Pure: the `pipeline_feedback` row a re-filed fee is logged with (its old category kept). */
export function loanPaymentNsfFeedbackRow(verdict: LoanPaymentNsfVerdict, runId: number | null): FeedbackRow {
  return {
    aboutStage: "extract",
    signal: "wrong",
    kind: LOAN_PAYMENT_NSF_REFILED_KIND,
    reportedBy: "darwin",
    checkName: LOAN_PAYMENT_NSF_REFILE_CHECK,
    aboutVersion: LOAN_PAYMENT_NSF_REFILE_CHECK_VERSION,
    institutionId: verdict.institutionId,
    sourceDocumentId: null,
    feeVerifiedId: verdict.feeVerifiedId,
    feePublishedId: verdict.feePublishedId,
    canonicalFeeKey: verdict.canonicalFeeKey,
    amount: verdict.amount,
    weight: 0,
    evidence: { from: verdict.canonicalFeeKey, to: LOAN_PAYMENT_NSF_TARGET, fee_name: verdict.feeName },
    runId,
    dedupeKey: `${LOAN_PAYMENT_NSF_REFILE_CHECK}:v${LOAN_PAYMENT_NSF_REFILE_CHECK_VERSION}:${verdict.feePublishedId}:${verdict.canonicalFeeKey}:${LOAN_PAYMENT_NSF_TARGET}`,
  };
}

/**
 * One step's re-check (see the module note). Never throws: a failed read reports nothing, and a
 * failed write leaves the fees as they were.
 */
export async function recheckLoanPaymentNsf(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number; now?: Date },
): Promise<LoanPaymentNsfResult> {
  const live = options.live ?? LOAN_PAYMENT_NSF_REFILE_LIVE;
  const result: LoanPaymentNsfResult = {
    live, dryRun: options.dryRun, scoped: options.institutionId != null,
    checked: 0, outcomes: {}, matched: 0, institutions: 0, samples: [], keptSamples: [], flagged: 0, waiting: 0, refiled: [],
  };

  let rows: LoanPaymentNsfRow[];
  try {
    rows = await inSavepoint(db, (scope) => loanPaymentNsfRowsSql(scope, { institutionId: options.institutionId, limit: options.limit }));
  } catch (error) {
    console.warn("[darwin] loan payment NSF check read failed", error instanceof Error ? error.message : error);
    return result;
  }
  const { matches, ...findings } = findLoanPaymentNsf(rows);
  Object.assign(result, findings);

  if (live && !options.dryRun && matches.length > 0) {
    const look = await secondLook(db, {
      check: LOAN_PAYMENT_NSF_REFILE_CHECK, runId: options.runId, failing: matches, passing: [], dryRun: false, now: options.now,
    });
    result.flagged = look.flagged;
    result.waiting = look.waiting;
    if (look.confirmed.length > 0) result.refiled = await refile(db, options, look.confirmed);
  }

  if (!options.dryRun && result.matched > 0) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${LOAN_PAYMENT_NSF_REFILE_CHECK}, 'completed',
          ${`Read ${result.checked} live NSF fee(s) whose name prices a loan, mortgage or lease payment: ${result.matched} at ${result.institutions} institution(s) are the loan's servicing fee; ${live ? `${result.flagged} flagged, ${result.refiled.length} re-filed` : "switch off, would re-file, nothing written"}`},
          ${JSON.stringify(loanPaymentNsfDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] loan payment NSF check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/**
 * Re-file confirmed fees in place: guarded on the old category, name and amount, still live, not
 * quarantined, not admin-corrected and no live twin. Never takes a fee down.
 */
async function refile(db: SqlTag, options: { runId: number; stepId?: number | null }, fees: LoanPaymentNsfVerdict[]): Promise<number[]> {
  try {
    const done = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET canonical_fee_key = ${LOAN_PAYMENT_NSF_TARGET}
          FROM unnest(${fees.map((fee) => fee.feePublishedId)}::bigint[], ${fees.map((fee) => fee.canonicalFeeKey)}::text[],
                      ${fees.map((fee) => fee.feeName)}::text[], ${fees.map((fee) => (fee.amount == null ? null : String(fee.amount)))}::numeric[])
               AS v(fee_published_id, from_key, old_name, amount)
         WHERE fp.fee_published_id = v.fee_published_id
           AND fp.canonical_fee_key = v.from_key
           AND btrim(fp.fee_name) = v.old_name
           AND fp.amount IS NOT DISTINCT FROM v.amount
           AND fp.rolled_back_at IS NULL
           AND fp.quarantined_at IS NULL
           -- Same check as notAdminCorrectedSql("fp"), written inline for the tagged template.
           AND NOT EXISTS (SELECT 1 FROM published_fee_corrections corrected
                            WHERE corrected.fee_published_id = fp.fee_published_id AND corrected.status = 'current')
           AND NOT EXISTS (SELECT 1 FROM published_fee_records live
                            WHERE live.rolled_back_at IS NULL
                              AND live.institution_id = fp.institution_id
                              AND live.canonical_fee_key = ${LOAN_PAYMENT_NSF_TARGET}
                              AND live.amount IS NOT DISTINCT FROM fp.amount)
        RETURNING fp.fee_published_id
      `;
      const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
      const applied = fees.filter((fee) => ids.has(fee.feePublishedId));
      const withVerified = applied.filter((fee) => fee.feeVerifiedId != null);
      if (withVerified.length > 0) {
        await scope`
          UPDATE verified_fee_observations fv
             SET canonical_fee_key = ${LOAN_PAYMENT_NSF_TARGET}
            FROM unnest(${withVerified.map((fee) => fee.feeVerifiedId as number)}::bigint[], ${withVerified.map((fee) => fee.canonicalFeeKey)}::text[])
                 AS v(fee_verified_id, from_key)
           WHERE fv.fee_verified_id = v.fee_verified_id
             AND fv.canonical_fee_key = v.from_key
        `;
      }
      if (applied.length > 0) {
        await recordFeedback(scope, applied.map((fee) => loanPaymentNsfFeedbackRow(fee, options.runId)));
        await scope`
          INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
          VALUES (
            ${options.runId}, ${options.stepId ?? null}, 'darwin.loan_payment_nsf_refiled', 'completed',
            ${`Re-filed ${applied.length} live NSF fee(s) that price a bounced loan payment as other lending, on their second look; name and price unchanged, old category kept in pipeline_feedback`},
            ${JSON.stringify({ version: LOAN_PAYMENT_NSF_REFILE_CHECK_VERSION, refiled: applied.length, samples: applied.slice(0, 50).map(sampleDetail) })}::jsonb
          )
        `;
      }
      return applied.map((fee) => fee.feePublishedId);
    });
    if (done.length > 0) invalidatePublicReadCache();
    return done;
  } catch (error) {
    console.error("[darwin] loan payment NSF re-file failed", error instanceof Error ? error.message : error);
    return [];
  }
}

function sampleDetail(fee: LoanPaymentNsfVerdict) {
  return {
    fee_published_id: fee.feePublishedId,
    institution_id: fee.institutionId,
    fee_name: fee.feeName,
    amount: fee.amount,
    canonical_fee_key: fee.canonicalFeeKey,
    outcome: fee.outcome,
    reason: fee.reason,
  };
}

/** The step's detail for the run ledger. */
export function loanPaymentNsfDetail(result: LoanPaymentNsfResult) {
  return {
    check: LOAN_PAYMENT_NSF_REFILE_CHECK,
    version: LOAN_PAYMENT_NSF_REFILE_CHECK_VERSION,
    switch_live: result.live,
    dry_run: result.dryRun,
    scoped: result.scoped,
    checked: result.checked,
    outcomes: result.outcomes,
    matched: result.matched,
    institutions: result.institutions,
    flagged: result.flagged,
    waiting: result.waiting,
    refiled: result.refiled,
    samples: result.samples.map(sampleDetail),
    samples_kept: result.keptSamples.map(sampleDetail),
  };
}
