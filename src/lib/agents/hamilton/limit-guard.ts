import { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { DAILY_CAP_CATEGORIES } from "@/lib/custom-report/source-check";

type SqlTag = typeof sql;

/**
 * A transaction limit published as a price: "Zelle® transfer limit | $1,000.00 | Daily",
 * "Mobile Deposit Checks are limited to $1,000.00 per deposit", "Cash Advance: Customer |
 * $2,500 Limit". The figure is how much a customer may move, not what the bank charges.
 *
 * Three readings, each only for a figure of $100 or more (a fee that size is rare, and a
 * limit is rarely smaller), so "ATM cash withdrawal - Dollar Limit | $2.50 $500 per day"
 * keeps its $2.50 fee:
 *   - name_states_limit: the name ends on the limit ("Bill Payment Limits (per 24 Hours)",
 *     "the limit is", "are limited to"), or says the limit is set.
 *   - source_states_limit: in Knox's excerpt the figure sits next to limit wording
 *     ("$2,500 Limit", "($500 Maximum)", "($2,000 daily", "$2,000 maximum/load").
 *   - above_category_ceiling: a figure no bank charges in a category whose rows state
 *     transfer and load limits (Zelle $2,500, mobile deposit $1,000).
 * Over-limit fees are fees ("Bill Pay Program Over-Limit Fee", "Wire Transfer (over daily
 * limit)", "Regulation D Transfer Limit Violation") and are never matched. A daily cap
 * category (`od_daily_cap`, `nsf_daily_cap`) is a limit by design, so only a name that
 * caps no fee ("No Bounce Courtesy Pay Limit") counts there.
 */
export type LimitGuardCode = "name_states_limit" | "source_states_limit" | "above_category_ceiling";

export const LIMIT_GUARD_REASON = "limit_as_fee";
export const LIMIT_GUARD_MIN_AMOUNT = 100;
/** Live rows rolled back per publish step; later steps pick up the rest. */
export const LIMIT_GUARD_ROLLBACK_LIMIT = 200;

/** Categories whose schedules print transfer and load limits next to their fees. */
export const TRANSACTION_LIMIT_CEILINGS: Readonly<Record<string, number>> = {
  zelle_fee: 250,
  mobile_deposit: 250,
  bill_pay: 250,
  cash_advance: 250,
  gift_card_purchase: 250,
  prepaid_card_reload: 250,
};

const OVER_LIMIT =
  /\bover[\s-]*(?:the\s+|your\s+|set\s+|daily\s+|established\s+|credit\s+)?limit|\boverlimit|\bexceed|\bexcess|\bviolation|\bexception|\babove (?:the |established )?limit/i;
/** The name ends on the limit, optionally with its period ("per 24 Hours", "daily"). */
const NAME_ENDS_ON_LIMIT =
  /\b(?:limits?|limited to|limits? (?:is|are)|daily maximum|maximum(?: card load| is)?)(?: (?:per [a-z0-9 ]{1,20}|daily|\d+ hours?))?$/i;
/** The name says what the limit is ("daily limits set by", "the limit is $2,500 per day"). */
const NAME_STATES_LIMIT = /\blimits? (?:is|are|set|start)\b|\blimited to$/i;
const FEE_WORD = /\b(?:fees?|charges?|items?|overdrafts?|nsf)\b/i;
const MAX_WORD = /\bmax(?:imum)?\b/i;
const SOURCE_BEFORE =
  /\b(?:limits?(?: is| are)?|limited to|limits start at|max(?:imum)?\.?(?: card load)?|daily (?:limit|maximum))\s*(?:of|at)?\s*[|:]?\s*\(?\s*$/i;
const SOURCE_AFTER = /^\s*\)?\s*(?:limit\b|max(?:imum)?\b|daily\b|per (?:business )?day\b|\/\s*load\b|& up\b)/i;
const MONEY = /\$\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{2}))?(?!\d)/g;

export interface LimitGuardInput {
  canonical_fee_key: string;
  fee_name: string | null;
  amount: number | string | null;
  /** The raw row's conditions; Knox's excerpt is read from it when present. */
  conditions?: string | null;
}

export interface LimitGuardVerdict {
  code: LimitGuardCode;
  detail: string;
}

function dollars(value: number | string | null): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

/** The name as a sentence: no "unlimited", brackets, cells, dot leaders or marks. */
function plainName(name: string): string {
  return name
    .replace(/\bunlimited\b/gi, " ")
    .replace(/[()[\]|:*®™…•]+/g, " ")
    .replace(/\.{2,}|[.,;\s]+$/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** The excerpt Knox stored with the row ("... excerpt=\"Zelle® ($2,000 daily\""). */
export function knoxExcerpt(conditions: string | null | undefined): string | null {
  const match = conditions?.match(/excerpt="([\s\S]*)"\s*$/);
  return match ? match[1] : null;
}

function sourceStatesLimit(excerpt: string, amount: number): boolean {
  for (const match of excerpt.matchAll(MONEY)) {
    const value = Number(`${match[1].replace(/,/g, "")}.${match[2] ?? "00"}`);
    if (Math.abs(value - amount) >= 0.005) continue;
    const start = match.index ?? 0;
    const before = excerpt.slice(Math.max(0, start - 40), start);
    const after = excerpt.slice(start + match[0].length, start + match[0].length + 25);
    if (OVER_LIMIT.test(before)) continue;
    if (SOURCE_BEFORE.test(before) || SOURCE_AFTER.test(after)) return true;
  }
  return false;
}

/** Pure: does this fee's figure read as a transaction limit rather than a price? */
export function limitGuardVerdict(row: LimitGuardInput): LimitGuardVerdict | null {
  const amount = dollars(row.amount);
  if (amount == null || amount < LIMIT_GUARD_MIN_AMOUNT) return null;
  const name = plainName(row.fee_name ?? "");
  if (OVER_LIMIT.test(name)) return null;
  const dailyCap = DAILY_CAP_CATEGORIES.has(row.canonical_fee_key);
  // A daily cap's name names the fee it caps; one that names no fee is some other limit.
  if (dailyCap && FEE_WORD.test(name)) return null;
  if (NAME_STATES_LIMIT.test(name) || (NAME_ENDS_ON_LIMIT.test(name) && !(dailyCap && MAX_WORD.test(name)))) {
    return { code: "name_states_limit", detail: `the name states a limit ("${name}")` };
  }
  const excerpt = knoxExcerpt(row.conditions);
  if (!dailyCap && excerpt && sourceStatesLimit(excerpt, amount)) {
    return { code: "source_states_limit", detail: `the source states $${amount} as a limit` };
  }
  const ceiling = TRANSACTION_LIMIT_CEILINGS[row.canonical_fee_key];
  if (ceiling != null && amount >= ceiling) {
    return { code: "above_category_ceiling", detail: `$${amount} is a transfer or load limit, not a ${row.canonical_fee_key} price` };
  }
  return null;
}

/** The rolled_back_reason a limit takedown records. */
export function limitGuardReason(verdict: LimitGuardVerdict): string {
  return `${LIMIT_GUARD_REASON}:${verdict.code}: ${verdict.detail}`;
}

interface LiveLimitRow {
  fee_published_id: number | string;
  institution_id: number | string;
  canonical_fee_key: string;
  fee_name: string;
  amount: number | string | null;
  conditions: string | null;
}

export interface LimitRollback {
  feePublishedId: number;
  institutionId: number;
  canonicalFeeKey: string;
  feeName: string;
  amount: number | null;
  code: LimitGuardCode;
  reason: string;
}

/**
 * Roll back live dollar fees whose figure is a transaction limit (`limitGuardVerdict`).
 * Rows are kept, not deleted: `rolled_back_at`, the run's batch id and a reason that
 * names the reading say why, the feedback sync turns each into a lesson for Knox, and
 * clearing `rolled_back_at` restores a row. A dry run reports what it would roll back and
 * writes nothing.
 */
export async function rollBackLimitsPublishedAsFees(
  db: SqlTag,
  options: { runId: number; batchId: string; dryRun: boolean; institutionId?: number; limit?: number },
): Promise<LimitRollback[]> {
  const limit = Math.max(1, Math.min(options.limit ?? LIMIT_GUARD_ROLLBACK_LIMIT, 2_000));
  let candidates: LiveLimitRow[];
  try {
    candidates = await inSavepoint(db, (scope) => scope<LiveLimitRow[]>`
      SELECT fp.fee_published_id, fp.institution_id, fp.canonical_fee_key, fp.fee_name, fp.amount, fr.conditions
        FROM published_fee_records fp
        LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.rolled_back_at IS NULL
         AND fp.amount >= ${LIMIT_GUARD_MIN_AMOUNT}
         ${options.institutionId ? scope`AND fp.institution_id = ${options.institutionId}` : scope``}
       ORDER BY fp.fee_published_id
    `);
  } catch (error) {
    // A failed sweep must never block publishing new verified rows.
    console.error("rollBackLimitsPublishedAsFees failed:", error);
    return [];
  }

  const rollbacks: LimitRollback[] = [];
  for (const row of candidates) {
    const verdict = limitGuardVerdict(row);
    if (!verdict) continue;
    rollbacks.push({
      feePublishedId: Number(row.fee_published_id),
      institutionId: Number(row.institution_id),
      canonicalFeeKey: row.canonical_fee_key,
      feeName: row.fee_name,
      amount: dollars(row.amount),
      code: verdict.code,
      reason: limitGuardReason(verdict),
    });
    if (rollbacks.length >= limit) break;
  }
  if (options.dryRun || rollbacks.length === 0) return rollbacks;

  let closed: LimitRollback[];
  try {
    const updated = await inSavepoint(db, (scope) => scope<{ fee_published_id: number | string }[]>`
      UPDATE published_fee_records fp
         SET rolled_back_at = NOW(),
             rolled_back_by_batch_id = ${options.batchId},
             rolled_back_reason = v.reason
        FROM unnest(${rollbacks.map((r) => r.feePublishedId)}::bigint[], ${rollbacks.map((r) => r.reason)}::text[])
             AS v(fee_published_id, reason)
       WHERE fp.fee_published_id = v.fee_published_id
         AND fp.rolled_back_at IS NULL
      RETURNING fp.fee_published_id
    `);
    const ids = new Set(updated.map((row) => Number(row.fee_published_id)));
    closed = rollbacks.filter((rollback) => ids.has(rollback.feePublishedId));
  } catch (error) {
    console.error("limit rollback failed:", error);
    return [];
  }
  if (closed.length === 0) return closed;

  // Public reads are cached between publishes; drop rows that just left.
  invalidatePublicReadCache();
  const byCode: Partial<Record<LimitGuardCode, number>> = {};
  for (const rollback of closed) byCode[rollback.code] = (byCode[rollback.code] ?? 0) + 1;
  try {
    await inSavepoint(db, (scope) => scope`
      INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, 'hamilton.limit_guard_rolled_back', 'completed',
        ${`Rolled back ${closed.length} live fee(s) whose figure is a transaction limit, not a price`},
        ${JSON.stringify({
          batch_id: options.batchId,
          rolled_back: closed.length,
          by_code: byCode,
          samples: closed.slice(0, 20).map((rollback) => ({
            fee_published_id: rollback.feePublishedId,
            institution_id: rollback.institutionId,
            canonical_fee_key: rollback.canonicalFeeKey,
            fee_name: rollback.feeName,
            amount: rollback.amount,
            reason: rollback.reason,
          })),
        })}::jsonb
      )
    `);
  } catch (error) {
    console.error("limit rollback event failed:", error);
  }
  return closed;
}
