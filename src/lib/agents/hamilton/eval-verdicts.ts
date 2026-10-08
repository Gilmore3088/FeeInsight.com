import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { inSavepoint } from "@/lib/agents/savepoint";

type SqlTag = typeof sql;

/**
 * Darwin's complete-record eval (James, Oct 8 2026): 211 live fees were scored against a
 * labelled answer key (name, amount, frequency, payer, category); 11 were critical (the amount
 * or the payer wrong, or not a fee at all). James read the list and said to resolve every one,
 * so each comes down on the first run that sees it, with the label as its audit record, as long
 * as the live record still reads the way it did when it was labelled. A row that has changed
 * since (renamed, re-priced, re-filed) is left for the next eval.
 *
 * The two shapes the criticals taught that a rule can read from the name alone are checked on
 * every live fee, with the usual 12-hour second look (`second-look.ts`):
 *   - a surcharge rebate or reimbursement published as an ATM fee ("ATM Fee Reimbursement $10":
 *     the bank gives it, it does not charge it): 20 live fees on Oct 8;
 *   - a product-feature sentence ("No fee for cashier's checks or money orders") published as a
 *     $0 fee: 4 live fees on Oct 8. A table row priced "No Charge" is a fee and stays.
 * A non-customer price beside the bank's own customer price (316 live fees) is not taken down
 * here: whether it is a payer error or a flag is James's open call (confirm list, row 16).
 *
 * Archived, never deleted: `rolled_back_reason = 'eval_critical:<verdict>'` or
 * `'not_a_fee:<rule>'`, the verified row rejected with the same flag so it is not republished,
 * and one lesson per fee in `pipeline_feedback` (stage extract, the verdict as its kind), so
 * Knox's learning reads what was wrong.
 */
export const EVAL_VERDICT_CHECK = "hamilton.eval_verdict";
export const EVAL_VERDICT_VERSION = 1;
const EVAL_REASON_PREFIX = "eval_critical";
const RULE_REASON_PREFIX = "not_a_fee";
const ROLLBACK_LIMIT = 500;

export type Verdict = "not_a_fee" | "wrong_amount" | "wrong_payer" | "wrong_category";

export interface EvalVerdict {
  feePublishedId: number;
  institution: string;
  /** The live record as it read when labelled; all three must still match. */
  feeName: string;
  amount: number;
  canonicalFeeKey: string;
  verdict: Verdict;
  why: string;
}

/**
 * The 11 critical rows of the Oct 8 eval (labels in the project's darwin/eval folder,
 * confirm list rows 1-11). Add a later eval's criticals below, never edit a past one.
 */
export const EVAL_CRITICAL_VERDICTS: readonly EvalVerdict[] = [
  {
    feePublishedId: 95816, institution: "Rockland Trust Company",
    feeName: "Non Rockland Trust ATM AccessNo fee from Rockland Trust", amount: 10, canonicalFeeKey: "atm_non_network",
    verdict: "not_a_fee", why: "The $10 is a surcharge rebate the bank gives per statement period, not a fee it charges",
  },
  {
    feePublishedId: 96294, institution: "State Police Credit Union",
    feeName: "Corporate Check", amount: 20, canonicalFeeKey: "cashiers_check",
    verdict: "wrong_category", why: "The line sits under the Stop Payments heading: a $20 stop payment, not a cashier's check",
  },
  {
    feePublishedId: 95762, institution: "Southern First Bank",
    feeName: "Official Bank Check (Non-Customers)", amount: 20, canonicalFeeKey: "cashiers_check",
    verdict: "wrong_payer", why: "Non-customers pay $20; the customer price is $7 and sits in the same category",
  },
  {
    feePublishedId: 95951, institution: "Metrum Community FCU",
    feeName: "Merchant presenting NSF check from member", amount: 5, canonicalFeeKey: "nsf",
    verdict: "wrong_payer", why: "The schedule says \"Merchant pays\": the member is not charged",
  },
  {
    feePublishedId: 96379, institution: "Skyline Financial FCU",
    feeName: "Incoming Wire Fee", amount: 35, canonicalFeeKey: "wire_domestic_incoming",
    verdict: "wrong_amount", why: "$35 is the international incoming line; domestic incoming is $20",
  },
  {
    feePublishedId: 93480, institution: "WNB Financial, N.A.",
    feeName: "Cash Management International Wire Origination", amount: 10, canonicalFeeKey: "wire_intl_outgoing",
    verdict: "wrong_amount", why: "Three names over three prices ($10/$20/$40); the international wire is the third, $40",
  },
  {
    feePublishedId: 95801, institution: "Northwest Plus FCU",
    feeName: "Wire International In/Out", amount: 10, canonicalFeeKey: "wire_intl_outgoing",
    verdict: "wrong_amount", why: "The line reads \"$10/$35\": $10 is incoming, the outgoing wire is $35",
  },
  {
    feePublishedId: 57064, institution: "Koin FCU",
    feeName: "Accounts closed within 90 days: International Wire", amount: 45, canonicalFeeKey: "early_closure",
    verdict: "wrong_amount", why: "Two rows joined: early closure is $30, $45 is the international wire",
  },
  {
    feePublishedId: 69839, institution: "Trax FCU",
    feeName: "Foreign ATM transactions at Trax Machines", amount: 3.5, canonicalFeeKey: "atm_non_network",
    verdict: "wrong_payer", why: "The surcharge non-members pay at Trax ATMs; the member's foreign-ATM fee is $1.50",
  },
  {
    feePublishedId: 47309, institution: "BankWest",
    feeName: "Money Orders (Non-Customer)", amount: 3, canonicalFeeKey: "money_order",
    verdict: "wrong_payer", why: "Non-customers pay $3; customers pay $2 and sit in the same category",
  },
  {
    feePublishedId: 96172, institution: "Madison County Bank",
    feeName: "No fee for cashier’s checks or money orders No minimum balance requirement No monthly service charge or membership fee A",
    amount: 0, canonicalFeeKey: "money_order",
    verdict: "not_a_fee", why: "A product-feature bullet list, not a fee line",
  },
];

/** A surcharge rebate, reimbursement or refund published as the ATM fee itself. */
const REBATE_WORDING = /\b(rebate|reimburse|refund)/i;
const NON_REFUNDABLE = /non[- ]?refundable/i;
const ATM_KEYS = new Set(["atm_non_network", "atm_international"]);
/** A sentence about what is free ("No fee for stop payments"), not a priced row. */
const NO_FEE_SENTENCE = /^\s*(no|without)\s+(fee|charge)s?\s+(for|to|on|when|if)\b/i;

/** Postgres pre-filter for the two name rules; `ruleFor` decides. */
export const RULE_NAME_PATTERN = String.raw`(rebate|reimburse|refund)|^\s*(no|without)\s+(fee|charge)s?\s+(for|to|on|when|if)\y`;

/** Which name rule, if any, takes a live fee down. Pure. */
export function ruleFor(canonicalFeeKey: string, feeName: string | null | undefined): "rebate" | "no_fee_sentence" | null {
  const name = feeName ?? "";
  if (ATM_KEYS.has(canonicalFeeKey) && REBATE_WORDING.test(name) && !NON_REFUNDABLE.test(name)) return "rebate";
  if (NO_FEE_SENTENCE.test(name)) return "no_fee_sentence";
  return null;
}

/** The eval verdict a live record still matches, or null when none or the record has changed. Pure. */
export function verdictFor(row: { feePublishedId: number; feeName: string; amount: number | null; canonicalFeeKey: string }): EvalVerdict | null {
  const verdict = EVAL_CRITICAL_VERDICTS.find((entry) => entry.feePublishedId === row.feePublishedId);
  if (!verdict) return null;
  const sameName = verdict.feeName.trim() === row.feeName.trim();
  const sameAmount = row.amount != null && Math.abs(row.amount - verdict.amount) < 0.005;
  return sameName && sameAmount && verdict.canonicalFeeKey === row.canonicalFeeKey ? verdict : null;
}

interface LiveRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  source_document_id: number | string | null;
  canonical_fee_key: string;
  fee_name: string | null;
  amount: number | string | null;
}

export interface EvalTakedown {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  sourceDocumentId: number | null;
  canonicalFeeKey: string;
  amount: number | null;
  feeName: string;
  /** The verdict kind the lesson carries. */
  kind: Verdict;
  reason: string;
  why: string;
  /** An eval row (down now) or a name rule (second look). */
  source: "eval" | "rule";
}

export interface EvalVerdictResult {
  /** Eval rows still live and unchanged. */
  evalMatched: number;
  /** Eval rows still live whose record has changed since labelling (left alone). */
  evalChanged: number;
  /** Live fees a name rule fails. */
  ruleFailing: number;
  flagged: number;
  waiting: number;
  rolledBack: EvalTakedown[];
  dryRun: boolean;
}

function num(value: number | string | null | undefined): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/** The live-fee read: the eval's rows and every live fee a name rule might match. */
export function evalVerdictFeesSql(byInstitution: boolean): string {
  return `
    SELECT fp.fee_published_id, fv.fee_verified_id, fp.institution_id, fr.source_document_id,
           fp.canonical_fee_key, fp.fee_name, fp.amount
      FROM published_fee_records fp
      LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
      LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
     WHERE fp.rolled_back_at IS NULL
       ${byInstitution ? "AND fp.institution_id = $2" : ""}
       AND (fp.fee_published_id = ANY($1::bigint[])
            OR (fp.canonical_fee_key IN ('atm_non_network', 'atm_international') AND fp.fee_name ~* '(rebate|reimburse|refund)')
            OR fp.fee_name ~* '^\\s*(no|without)\\s+(fee|charge)s?\\s+(for|to|on|when|if)\\y')
     ORDER BY fp.fee_published_id`;
}

/**
 * Runs the eval-verdict check for one publish step. Eval rows come down on the first run;
 * name-rule rows after their second look. A dry run reports and writes nothing. Never blocks
 * the step it runs in.
 */
export async function retireEvalVerdictFees(
  db: SqlTag,
  options: { runId: number; batchId: string; dryRun: boolean; institutionId?: number; limit?: number },
): Promise<EvalVerdictResult> {
  const limit = Math.max(1, Math.min(options.limit ?? ROLLBACK_LIMIT, 2_000));
  const result: EvalVerdictResult = { evalMatched: 0, evalChanged: 0, ruleFailing: 0, flagged: 0, waiting: 0, rolledBack: [], dryRun: options.dryRun };
  let rows: LiveRow[];
  try {
    const ids = EVAL_CRITICAL_VERDICTS.map((entry) => entry.feePublishedId);
    rows = await inSavepoint(db, (scope) =>
      scope.unsafe<LiveRow[]>(
        evalVerdictFeesSql(Boolean(options.institutionId)),
        options.institutionId ? [ids, options.institutionId] : [ids],
      ),
    );
  } catch (error) {
    console.error("retireEvalVerdictFees read failed:", error);
    return result;
  }

  const evalRows: EvalTakedown[] = [];
  const ruleRows: EvalTakedown[] = [];
  for (const row of rows) {
    const base = {
      feePublishedId: Number(row.fee_published_id),
      feeVerifiedId: num(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      sourceDocumentId: num(row.source_document_id),
      canonicalFeeKey: row.canonical_fee_key,
      amount: num(row.amount),
      feeName: row.fee_name ?? "",
    };
    const verdict = verdictFor(base);
    if (verdict) {
      evalRows.push({ ...base, kind: verdict.verdict, reason: `${EVAL_REASON_PREFIX}:${verdict.verdict}`, why: verdict.why, source: "eval" });
      continue;
    }
    if (EVAL_CRITICAL_VERDICTS.some((entry) => entry.feePublishedId === base.feePublishedId)) {
      result.evalChanged += 1;
      continue;
    }
    const rule = ruleFor(base.canonicalFeeKey, base.feeName);
    if (!rule) continue;
    const why =
      rule === "rebate"
        ? "A surcharge rebate or reimbursement the bank gives, published as the ATM fee it charges"
        : "A sentence about what is free, not a priced fee line";
    ruleRows.push({ ...base, kind: "not_a_fee", reason: `${RULE_REASON_PREFIX}:${rule}`, why, source: "rule" });
  }
  result.evalMatched = evalRows.length;
  result.ruleFailing = ruleRows.length;
  if (evalRows.length === 0 && ruleRows.length === 0) return result;

  // Every takedown is logged; the eval rows come down now (James, Oct 8), the rule rows after
  // the usual second look.
  const look = await secondLook(db, { check: EVAL_VERDICT_CHECK, runId: options.runId, failing: [...evalRows, ...ruleRows], dryRun: options.dryRun });
  result.flagged = look.flagged;
  result.waiting = look.waiting;
  const confirmedRules = new Set(look.confirmed.filter((fee) => fee.source === "rule").map((fee) => fee.feePublishedId));
  const confirmed = [...evalRows, ...ruleRows.filter((fee) => confirmedRules.has(fee.feePublishedId))].slice(0, limit);
  if (options.dryRun) {
    result.rolledBack = confirmed;
    return result;
  }
  if (confirmed.length === 0) return result;

  try {
    result.rolledBack = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${options.batchId},
               rolled_back_reason = v.reason
          FROM unnest(${confirmed.map((fee) => fee.feePublishedId)}::bigint[], ${confirmed.map((fee) => fee.reason)}::text[])
               AS v(fee_published_id, reason)
         WHERE fp.fee_published_id = v.fee_published_id
           AND fp.rolled_back_at IS NULL
        RETURNING fp.fee_published_id
      `;
      const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
      const closed = confirmed.filter((fee) => ids.has(fee.feePublishedId));
      const verified = closed.filter((fee) => fee.feeVerifiedId != null);
      if (verified.length > 0) {
        await scope`
          UPDATE verified_fee_observations fv
             SET review_status = 'rejected',
                 outlier_flags = CASE
                   WHEN fv.outlier_flags ? v.flag THEN fv.outlier_flags
                   ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(v.flag)
                 END
            FROM unnest(${verified.map((fee) => fee.feeVerifiedId as number)}::bigint[], ${verified.map((fee) => fee.reason)}::text[])
                 AS v(fee_verified_id, flag)
           WHERE fv.fee_verified_id = v.fee_verified_id
             AND fv.review_status IN ('verified', 'approved')
        `;
      }
      return closed;
    });
  } catch (error) {
    console.error("eval verdict rollback failed:", error);
    return result;
  }
  if (result.rolledBack.length === 0) return result;
  invalidatePublicReadCache();

  const lessons: FeedbackRow[] = result.rolledBack.map((fee) => ({
    aboutStage: "extract",
    signal: "wrong",
    kind: fee.kind,
    reportedBy: "hamilton",
    checkName: EVAL_VERDICT_CHECK,
    institutionId: fee.institutionId,
    sourceDocumentId: fee.sourceDocumentId,
    feeVerifiedId: fee.feeVerifiedId,
    feePublishedId: fee.feePublishedId,
    canonicalFeeKey: fee.canonicalFeeKey,
    amount: fee.amount,
    runId: options.runId,
    dedupeKey: `${EVAL_VERDICT_CHECK}:pub:${fee.feePublishedId}`,
    evidence: {
      reason: fee.reason,
      why: fee.why,
      fee_name: fee.feeName,
      source: fee.source === "eval" ? "complete-record eval, Oct 8 2026 (confirm list rows 1-11)" : `name rule ${fee.reason}`,
      version: EVAL_VERDICT_VERSION,
    },
  }));
  try {
    await inSavepoint(db, async (scope) => {
      await recordFeedback(scope, lessons);
      await scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, 'hamilton.eval_verdict_rolled_back', 'completed',
          ${`Archived ${result.rolledBack.length} fee(s) the complete-record eval or a name rule found wrong`},
          ${JSON.stringify({
            batch_id: options.batchId,
            rolled_back: result.rolledBack.length,
            eval_rows: result.rolledBack.filter((fee) => fee.source === "eval").length,
            rule_rows: result.rolledBack.filter((fee) => fee.source === "rule").length,
            samples: result.rolledBack.slice(0, 20).map((fee) => ({
              fee_published_id: fee.feePublishedId,
              institution_id: fee.institutionId,
              canonical_fee_key: fee.canonicalFeeKey,
              fee_name: fee.feeName,
              amount: fee.amount,
              reason: fee.reason,
            })),
          })}::jsonb
        )
      `;
    });
  } catch (error) {
    console.error("eval verdict lesson/event failed:", error);
  }
  return result;
}
