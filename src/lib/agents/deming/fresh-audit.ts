import { sql } from "@/lib/data-store/connection";
import { CATEGORY_GUARD_VERSION, checkFeeCategory } from "@/lib/fee-category-guard";
import { SOURCE_CHECK_STRATEGY, traceLiveFee, type InstitutionText, type LiveFeeRow } from "@/lib/agents/hamilton/source-check";
import { severityFor, type Severity } from "@/lib/agents/deming/severity";

type SqlTag = typeof sql;

/**
 * Deming's fresh audit (the fee-evaluation skill, run by Atlas every day): draw a seeded
 * sample of live dollar fees from `published_fee_catalog` and ask the shipped checks whether
 * the bank's own stored schedule supports each one. Amount: `traceLiveFee`, the same shared
 * source check Hamilton runs. Category: `checkFeeCategory`. Read-only; no writes, no flags,
 * no model calls. Rate fees are not in this sample (they are never pooled with dollars).
 */

export const FRESH_AUDIT_VERSION = 1;
export const FRESH_AUDIT_SAMPLE = 200;
/** Below this many scorable fees the audit reports counts, not a percentage. */
export const FRESH_AUDIT_MIN_SCORABLE = 30;
const MISS_LIMIT = 50;

export interface FreshAuditFee extends LiveFeeRow {
  fee_id: number | string;
}

export interface FreshAuditMiss {
  feeId: number;
  institutionId: number;
  canonicalFeeKey: string;
  feeName: string;
  amount: number | null;
  check: "hamilton.source_check" | "hamilton.category_guard";
  reason: string;
  severity: Severity;
}

export interface FreshAuditScore {
  sampled: number;
  right: number;
  amountMiss: number;
  categoryMiss: number;
  /** No completed stored text for the fee: unknown, never right or wrong. */
  noText: number;
  scorable: number;
  /** right / scorable, or null when fewer than FRESH_AUDIT_MIN_SCORABLE fees are scorable. */
  accuracy: number | null;
  bySeverity: Record<Severity, number>;
  misses: FreshAuditMiss[];
}

export interface FreshAuditResult extends FreshAuditScore {
  readable: boolean;
  seed: string;
  categoryGuardVersion: number;
  sourceCheckVersion: number;
}

/** Pure: score a sample against its institutions' stored texts. */
export function scoreFreshAudit(fees: FreshAuditFee[], textsByInstitution: Map<number, InstitutionText[]>): FreshAuditScore {
  const score: FreshAuditScore = {
    sampled: fees.length,
    right: 0,
    amountMiss: 0,
    categoryMiss: 0,
    noText: 0,
    scorable: 0,
    accuracy: null,
    bySeverity: { critical: 0, major: 0, minor: 0, info: 0 },
    misses: [],
  };
  const miss = (fee: FreshAuditFee, check: FreshAuditMiss["check"], reason: string) => {
    const severity = severityFor(check, reason);
    score.bySeverity[severity] += 1;
    score.misses.push({
      feeId: Number(fee.fee_id),
      institutionId: Number(fee.institution_id),
      canonicalFeeKey: fee.canonical_fee_key,
      feeName: fee.fee_name,
      amount: fee.amount == null ? null : Number(fee.amount),
      check,
      reason,
      severity,
    });
  };
  for (const fee of fees) {
    const verdict = traceLiveFee(fee, textsByInstitution.get(Number(fee.institution_id)) ?? []);
    if (verdict.kind === "untraceable" && verdict.reason === "no_source_text") {
      score.noText += 1;
      continue;
    }
    score.scorable += 1;
    if (verdict.kind === "untraceable") {
      score.amountMiss += 1;
      miss(fee, "hamilton.source_check", verdict.reason);
      continue;
    }
    const category = checkFeeCategory(fee.canonical_fee_key, fee.fee_name);
    if (!category.ok) {
      score.categoryMiss += 1;
      miss(fee, "hamilton.category_guard", category.code);
      continue;
    }
    score.right += 1;
  }
  score.accuracy = score.scorable >= FRESH_AUDIT_MIN_SCORABLE ? score.right / score.scorable : null;
  const order: Record<Severity, number> = { critical: 0, major: 1, minor: 2, info: 3 };
  score.misses.sort((a, b) => order[a.severity] - order[b.severity] || a.feeId - b.feeId);
  return score;
}

export async function runFreshAudit({
  db = sql,
  now = new Date(),
  sampleSize = FRESH_AUDIT_SAMPLE,
}: { db?: SqlTag; now?: Date; sampleSize?: number } = {}): Promise<FreshAuditResult> {
  const seed = now.toISOString().slice(0, 10);
  const versions = { seed, categoryGuardVersion: CATEGORY_GUARD_VERSION, sourceCheckVersion: SOURCE_CHECK_STRATEGY.version };
  try {
    const fees = await db<FreshAuditFee[]>`
      SELECT id AS fee_id, fee_published_id, fee_verified_id AS lineage_ref, fee_raw_id, institution_id, source,
             source_document_id, canonical_fee_key, fee_name, amount, amount_kind, rate_percent
        FROM published_fee_catalog
       WHERE review_status = 'approved'
         AND amount IS NOT NULL
         AND amount_kind IS DISTINCT FROM 'percent'
       ORDER BY md5(id::text || ${seed})
       LIMIT ${sampleSize}
    `;
    const institutionIds = [...new Set(fees.map((fee) => Number(fee.institution_id)))];
    const texts = institutionIds.length === 0 ? [] : await db<Array<InstitutionText & { institution_id: number | string }>>`
      SELECT DISTINCT ON (source_document_id) institution_id, source_document_id, normalized_text
        FROM agent_source_texts
       WHERE institution_id = ANY(${institutionIds}::bigint[])
         AND status = 'completed'
         AND normalized_text IS NOT NULL
       ORDER BY source_document_id, id DESC
    `;
    const textsByInstitution = new Map<number, InstitutionText[]>();
    for (const text of texts) {
      const id = Number(text.institution_id);
      textsByInstitution.set(id, [...(textsByInstitution.get(id) ?? []), text]);
    }
    return { readable: true, ...versions, ...scoreFreshAudit(fees, textsByInstitution) };
  } catch (error) {
    console.error("runFreshAudit failed:", error);
    return { readable: false, ...versions, ...scoreFreshAudit([], new Map()) };
  }
}

export function summarizeFreshAudit(result: FreshAuditResult): string {
  if (!result.readable) return "Deming's fresh audit could not read the live fees; accuracy is unknown today.";
  const unknown = result.noText > 0 ? `; ${result.noText} with no stored text (unknown)` : "";
  if (result.accuracy == null) {
    return `Deming audited ${result.sampled} live fees but only ${result.scorable} had stored text, too few for a percentage: ${result.right} right${unknown}.`;
  }
  const pct = (result.accuracy * 100).toFixed(1);
  return `Deming audited ${result.sampled} live fees (seed ${result.seed}): ${result.right} of ${result.scorable} right (${pct}%), ${result.amountMiss} amount not supported, ${result.categoryMiss} category not supported${unknown}. Critical misses: ${result.bySeverity.critical}.`;
}

export function freshAuditDetail(result: FreshAuditResult) {
  return {
    version: FRESH_AUDIT_VERSION,
    readable: result.readable,
    seed: result.seed,
    category_guard_version: result.categoryGuardVersion,
    source_check_version: result.sourceCheckVersion,
    sampled: result.sampled,
    scorable: result.scorable,
    right: result.right,
    amount_miss: result.amountMiss,
    category_miss: result.categoryMiss,
    no_text: result.noText,
    accuracy: result.accuracy,
    by_severity: result.bySeverity,
    misses: result.misses.slice(0, MISS_LIMIT),
  };
}
