import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { secondLook } from "@/lib/agents/hamilton/second-look";
import { AMOUNT_PATTERN, loanPaymentExample } from "@/lib/agents/knox/rules";
import { storedLine } from "@/lib/agents/darwin/rate-floor-check";

type SqlTag = typeof sql;

/**
 * Darwin's live re-check of fees that are a loan's payment example (#2854; decision 2026-10-15, "Darwin
 * re-checks every live fee against today's rules"). Pelican's disclosures page (institution 7482,
 * document 31892) prints "APR is 3.99%, which includes a $75.00 Loan Documentation Fee, estimated
 * payment of $1,473.89"; Knox read the payment as "Loan Documentation Fee, estimated payment" and four
 * sample-loan payments went live as other_lending_fee (141052-141055, $622.75 to $1,473.89). Knox v153
 * no longer reads such a price (`loanPaymentExample`, rules pass and family experts), but the fees read
 * before stay live: the name and price still trace to the stored text, so Hamilton's rules re-check
 * and the shared source check keep them.
 *
 * Each verify step reads every live flat fee above $0 whose stored line (Knox's `excerpt="..."`) has
 * payment words (the SQL prefilter), and `loanPaymentExampleMatch` decides on the line with Knox's own
 * test at each place the line prints the fee's price: the words right before it are a payment example
 * ("estimated payment of", "60 monthly payments of", "total of payments", "amount financed"), or "per
 * $1,000 borrowed" follows it, or "for 60 months" follows it after payment words with no fee word
 * between. An institution-scoped run reads that institution's only. Admin-corrected fees are never
 * read. Switched on, a match goes through the shared 12-hour second look (check
 * `darwin.loan_payment_example`) and is archived on its second failure: rolled back with
 * `loan_payment_example: <price> follows "<words>"`, its verified row rejected with the
 * `loan_payment_example` flag so publish does not bring it back, never deleted, and a
 * `darwin.loan_payment_example_takedown` event lists them. In a dry run, or with the switch off (the
 * default), the step only reports.
 *
 * The switch is the environment variable `DARWIN_LOAN_PAYMENT_EXAMPLE_TAKEDOWN_LIVE` ("true" turns it on;
 * unset or anything else is off), read once when the module loads.
 *
 * Dry run, prod read-only, 2026-11-01: the prefilter selects 443 live flat fees, none admin-corrected;
 * 4 match (141052, 141053, 141054, 141055, all Pelican 7482). The bank's own $75 Loan Documentation
 * Fee from the same sentences stays live (80375). See
 * docs/project/findings/2026-11-01-loan-payment-example-read-as-fee.md.
 */
export const LOAN_PAYMENT_EXAMPLE_CHECK = "darwin.loan_payment_example";
export const LOAN_PAYMENT_EXAMPLE_CHECK_VERSION = 1;
/** The switch, off unless the environment says "true": on takes matches down after the second look. */
export const LOAN_PAYMENT_EXAMPLE_TAKEDOWN_LIVE: boolean = process.env.DARWIN_LOAN_PAYMENT_EXAMPLE_TAKEDOWN_LIVE === "true";
export const LOAN_PAYMENT_EXAMPLE_REASON = "loan_payment_example";
export const LOAN_PAYMENT_EXAMPLE_FLAG = "loan_payment_example";
export const LOAN_PAYMENT_EXAMPLE_LIMIT = 2_000;
export const LOAN_PAYMENT_EXAMPLE_SAMPLES = 20;

export interface LoanPaymentExampleRow {
  fee_published_id: number | string;
  fee_verified_id: number | string | null;
  institution_id: number | string;
  fee_name: string | null;
  amount: number | string | null;
  canonical_fee_key: string | null;
  source_line: string | null;
}

export interface LoanPaymentExampleMatch {
  feePublishedId: number;
  feeVerifiedId: number | null;
  institutionId: number;
  feeName: string;
  amount: number;
  canonicalFeeKey: string | null;
  sourceLine: string;
  reason: string;
}

export interface LoanPaymentExampleFindings {
  checked: number;
  matched: number;
  institutions: number;
  samples: LoanPaymentExampleMatch[];
}

export interface LoanPaymentExampleResult extends LoanPaymentExampleFindings {
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
 * Pure: whether a live fee's stored line prints its price only as a loan's payment example, read with
 * Knox v153's own test. Every place the line prints the price must be one; a line that also prints the
 * price as a fee ("Skip-a-Payment Fee | $35", beside a "$35 monthly payment") is kept.
 */
export function loanPaymentExampleMatch(line: string, amount: number): { before: string } | null {
  if (!line) return null;
  let found: { before: string } | null = null;
  for (const match of line.matchAll(new RegExp(AMOUNT_PATTERN.source, "g"))) {
    if (Math.abs(Number(match[1].replace(/,/g, "")) - amount) >= 0.005) continue;
    const start = match.index ?? 0;
    const before = line.slice(0, start);
    if (!loanPaymentExample(before, line.slice(start + match[0].length))) return null;
    found ??= { before };
  }
  return found;
}

function dollars(value: number): string {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

/** Pure: the matches among the rows the read selected. */
export function findLoanPaymentExamples(rows: LoanPaymentExampleRow[]): LoanPaymentExampleFindings & { matches: LoanPaymentExampleMatch[] } {
  const matches: LoanPaymentExampleMatch[] = [];
  const seen = new Set<number>();
  for (const row of [...rows].sort((a, b) => Number(a.fee_published_id) - Number(b.fee_published_id))) {
    const feeId = Number(row.fee_published_id);
    if (seen.has(feeId)) continue;
    seen.add(feeId);
    const amount = num(row.amount);
    const line = storedLine(row.source_line);
    if (amount == null || amount <= 0) continue;
    const found = loanPaymentExampleMatch(line, amount);
    if (!found) continue;
    const words = found.before.trim().split(/\s+/).slice(-5).join(" ");
    matches.push({
      feePublishedId: feeId,
      feeVerifiedId: num(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      feeName: (row.fee_name ?? "").trim(),
      amount,
      canonicalFeeKey: row.canonical_fee_key,
      sourceLine: line.slice(0, 300),
      reason: `${LOAN_PAYMENT_EXAMPLE_REASON}: ${dollars(amount)} follows "${words.slice(0, 120)}"`,
    });
  }
  return {
    checked: seen.size,
    matched: matches.length,
    institutions: new Set(matches.map((fee) => fee.institutionId)).size,
    samples: matches.slice(0, LOAN_PAYMENT_EXAMPLE_SAMPLES),
    matches,
  };
}

/** Postgres pre-filter on Knox's stored note: payment words, the amount financed, per $1,000 or "for N months". */
export const LOAN_PAYMENT_EXAMPLE_PREFILTER = String.raw`excerpt=.*(\m(estimated|estimate|sample|example|approximate|approx|typical|resulting|scheduled|regular|total|monthly|weekly|bi-?weekly|semi-?monthly|\d{1,3})\s+(\w+\s+){0,2}payments?\M|total of (all )?payments|amount financed|per \$\s?1,?000|for \d{1,3} months)`;

/** Read-only: every live flat fee above $0 whose stored line passes the pre-filter. */
export function loanPaymentExampleRowsSql(db: SqlTag, options: { institutionId?: number; limit?: number } = {}) {
  const scoped = options.institutionId != null;
  const limit = Math.max(1, Math.min(options.limit ?? LOAN_PAYMENT_EXAMPLE_LIMIT, 10_000));
  return db<LoanPaymentExampleRow[]>`
    SELECT fp.fee_published_id, fp.lineage_ref AS fee_verified_id, fp.institution_id, fp.fee_name, fp.amount,
           fp.canonical_fee_key, fr.extraction_note AS source_line
      FROM published_fee_records fp
      JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
      JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
     WHERE fp.rolled_back_at IS NULL
       AND fp.quarantined_at IS NULL
       AND fp.amount_kind = 'flat'
       AND fp.amount > 0
       AND fr.extraction_note ~* ${LOAN_PAYMENT_EXAMPLE_PREFILTER}
       -- notAdminCorrectedSql("fp") (fee-correction-guard), written inline for the tagged template: never take down an admin-corrected fee.
       AND NOT EXISTS (SELECT 1 FROM published_fee_corrections corrected WHERE corrected.fee_published_id = fp.fee_published_id AND corrected.status = 'current')
       AND (${!scoped} OR fp.institution_id = ${options.institutionId ?? 0})
     ORDER BY fp.fee_published_id
     LIMIT ${limit}::int
  `;
}

/**
 * One step's re-check (see the module note). Never throws: a failed read reports nothing, and a
 * failed write leaves the fees as they were.
 */
export async function recheckLoanPaymentExamples(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number; now?: Date },
): Promise<LoanPaymentExampleResult> {
  const live = options.live ?? LOAN_PAYMENT_EXAMPLE_TAKEDOWN_LIVE;
  const result: LoanPaymentExampleResult = {
    live, dryRun: options.dryRun, scoped: options.institutionId != null,
    checked: 0, matched: 0, institutions: 0, samples: [], flagged: 0, waiting: 0, takenDown: [],
  };

  let rows: LoanPaymentExampleRow[];
  try {
    rows = await inSavepoint(db, (scope) => loanPaymentExampleRowsSql(scope, { institutionId: options.institutionId, limit: options.limit }));
  } catch (error) {
    console.warn("[darwin] loan payment example check read failed", error instanceof Error ? error.message : error);
    return result;
  }
  const { matches, ...findings } = findLoanPaymentExamples(rows);
  Object.assign(result, findings);

  if (live && !options.dryRun && matches.length > 0) {
    const look = await secondLook(db, {
      check: LOAN_PAYMENT_EXAMPLE_CHECK, runId: options.runId, failing: matches, passing: [], dryRun: false, now: options.now,
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
          ${options.runId}, ${options.stepId ?? null}, ${LOAN_PAYMENT_EXAMPLE_CHECK}, 'completed',
          ${`Read live fees that are a loan's payment example: ${result.matched} of ${result.checked} live fee(s) at ${result.institutions} institution(s); ${live ? `${result.flagged} flagged, ${result.takenDown.length} archived` : "switch off, would take down, nothing written"}`},
          ${JSON.stringify(loanPaymentExampleDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] loan payment example check event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

/** Archive confirmed fees: rolled back with the reason, the verified row rejected with the flag. Never deleted. */
async function archive(db: SqlTag, runId: number, fees: LoanPaymentExampleMatch[]): Promise<number[]> {
  try {
    const closed = await inSavepoint(db, async (scope) => {
      const updated = await scope<{ fee_published_id: number | string }[]>`
        UPDATE published_fee_records fp
           SET rolled_back_at = NOW(),
               rolled_back_by_batch_id = ${`darwin-loan-payment-example-${runId}`},
               rolled_back_reason = v.reason
          FROM unnest(${fees.map((fee) => fee.feePublishedId)}::bigint[], ${fees.map((fee) => fee.reason)}::text[],
                      ${fees.map((fee) => fee.amount)}::numeric[])
               AS v(fee_published_id, reason, amount)
         WHERE fp.fee_published_id = v.fee_published_id
           AND fp.amount = v.amount
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
                   WHEN fv.outlier_flags ? ${LOAN_PAYMENT_EXAMPLE_FLAG} THEN fv.outlier_flags
                   ELSE COALESCE(fv.outlier_flags, '[]'::jsonb) || jsonb_build_array(${LOAN_PAYMENT_EXAMPLE_FLAG}::text)
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
    console.error("[darwin] loan payment example takedown failed", error instanceof Error ? error.message : error);
    return [];
  }
}

async function recordTakedownEvent(
  db: SqlTag,
  options: { runId: number; stepId?: number | null },
  confirmed: LoanPaymentExampleMatch[],
  takenDown: number[],
): Promise<void> {
  const done = new Set(takenDown);
  const archived = confirmed.filter((fee) => done.has(fee.feePublishedId));
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, ${options.stepId ?? null}, 'darwin.loan_payment_example_takedown', 'completed',
        ${`Archived ${archived.length} live fee(s) that are a loan's payment example, on their second look`},
        ${JSON.stringify({ version: LOAN_PAYMENT_EXAMPLE_CHECK_VERSION, taken_down: archived.length, samples: archived.slice(0, 50).map(sampleDetail) })}::jsonb
      )
    `);
  } catch (error) {
    console.error("[darwin] loan payment example takedown event failed", error instanceof Error ? error.message : error);
  }
}

function sampleDetail(fee: LoanPaymentExampleMatch) {
  return {
    fee_published_id: fee.feePublishedId,
    institution_id: fee.institutionId,
    fee_name: fee.feeName,
    amount: fee.amount,
    canonical_fee_key: fee.canonicalFeeKey,
    source_line: fee.sourceLine,
    reason: fee.reason,
  };
}

/** The step's detail for the run ledger. */
export function loanPaymentExampleDetail(result: LoanPaymentExampleResult) {
  return {
    check: LOAN_PAYMENT_EXAMPLE_CHECK,
    version: LOAN_PAYMENT_EXAMPLE_CHECK_VERSION,
    switch_live: result.live,
    dry_run: result.dryRun,
    scoped: result.scoped,
    checked: result.checked,
    matched: result.matched,
    institutions: result.institutions,
    flagged: result.flagged,
    waiting: result.waiting,
    taken_down: result.takenDown,
    samples: result.samples.map(sampleDetail),
  };
}
