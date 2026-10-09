import { sql } from "@/lib/data-store/connection";
import { CATEGORY_GUARD_VERSION, checkFeeCategory } from "@/lib/fee-category-guard";
import { SOURCE_CHECK_STRATEGY, traceLiveFee, type InstitutionText, type LiveFeeRow } from "@/lib/agents/hamilton/source-check";
import { severityFor, type Severity } from "@/lib/agents/deming/severity";
import { ARTICLE_PAGE_CHECK, isArticlePage } from "@/lib/agents/hamilton/article-page";
import { PRODUCT_PAGE_CHECK, isProductPage } from "@/lib/agents/hamilton/product-page";
import {
  OTHER_BANK_DOCUMENT_CHECK,
  UNCONFIRMED_HOST_CHECK,
  otherBankFeesSql,
  unconfirmedHostFeesSql,
} from "@/lib/agents/hamilton/other-bank-document";

type SqlTag = typeof sql;

/**
 * Deming's fresh audit (the fee-evaluation skill, run by Atlas every day): draw a seeded
 * sample of live dollar fees from `published_fee_catalog` and ask the shipped checks whether
 * the bank's own stored schedule supports each one. Amount: `traceLiveFee`, the same shared
 * source check Hamilton runs. Category: `checkFeeCategory`. Evidence (the source-evidence-audit
 * skill, v2): the document must be the bank's own (`otherBankFeesSql`, `unconfirmedHostFeesSql`)
 * and a fee schedule, not an article or product page (`isArticlePage`, `isProductPage`).
 * Read-only; no writes, no flags, no model calls. Rate fees are not in this sample (they are
 * never pooled with dollars).
 */

export const FRESH_AUDIT_VERSION = 2;
export const FRESH_AUDIT_SAMPLE = 200;
/** Below this many scorable fees the audit reports counts, not a percentage. */
export const FRESH_AUDIT_MIN_SCORABLE = 30;
const MISS_LIMIT = 50;

export interface FreshAuditFee extends LiveFeeRow {
  fee_id: number | string;
  document_url?: string | null;
}

/** Host findings for the sample, from Hamilton's own host reads (by `fee_published_id`). */
export interface FreshAuditEvidence {
  otherBank: Set<number>;
  /** On a host that is neither the bank's nor another institution's, and the text does not name the bank. */
  unconfirmedHost: Set<number>;
  /** A Hamilton second look (`takedown_pending`) is already open on the fee. */
  pending: Set<number>;
}

const NO_EVIDENCE: FreshAuditEvidence = { otherBank: new Set(), unconfirmedHost: new Set(), pending: new Set() };

export interface FreshAuditMiss {
  feeId: number;
  institutionId: number;
  canonicalFeeKey: string;
  feeName: string;
  amount: number | null;
  check: string;
  reason: string;
  severity: Severity;
  /** A second look is already open on this fee: reported, not a new finding. */
  pending: boolean;
}

export interface FreshAuditScore {
  sampled: number;
  right: number;
  amountMiss: number;
  categoryMiss: number;
  /** Amount and category hold, but the document is not the bank's own schedule. */
  evidenceMiss: number;
  /** Stated in another stored document of the bank than the one it was read from. */
  relinked: number;
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
export function scoreFreshAudit(
  fees: FreshAuditFee[],
  textsByInstitution: Map<number, InstitutionText[]>,
  evidence: FreshAuditEvidence = NO_EVIDENCE,
): FreshAuditScore {
  const score: FreshAuditScore = {
    sampled: fees.length,
    right: 0,
    amountMiss: 0,
    categoryMiss: 0,
    evidenceMiss: 0,
    relinked: 0,
    noText: 0,
    scorable: 0,
    accuracy: null,
    bySeverity: { critical: 0, major: 0, minor: 0, info: 0 },
    misses: [],
  };
  const miss = (fee: FreshAuditFee, check: string, reason: string) => {
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
      pending: evidence.pending.has(Number(fee.fee_published_id)),
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
    const evidenceCheck = evidenceFailure(fee, evidence);
    if (evidenceCheck) {
      score.evidenceMiss += 1;
      miss(fee, evidenceCheck, evidenceCheck.replace(/^hamilton\./, ""));
      continue;
    }
    if (verdict.kind === "relinked") score.relinked += 1;
    score.right += 1;
  }
  score.accuracy = score.scorable >= FRESH_AUDIT_MIN_SCORABLE ? score.right / score.scorable : null;
  const order: Record<Severity, number> = { critical: 0, major: 1, minor: 2, info: 3 };
  score.misses.sort((a, b) => order[a.severity] - order[b.severity] || a.feeId - b.feeId);
  return score;
}

/** The first evidence check the fee fails, or null when its document is the bank's own schedule. */
function evidenceFailure(fee: FreshAuditFee, evidence: FreshAuditEvidence): string | null {
  const id = Number(fee.fee_published_id);
  if (evidence.otherBank.has(id)) return OTHER_BANK_DOCUMENT_CHECK;
  if (evidence.unconfirmedHost.has(id)) return UNCONFIRMED_HOST_CHECK;
  if (isArticlePage(fee.document_url)) return ARTICLE_PAGE_CHECK;
  if (isProductPage(fee.document_url)) return PRODUCT_PAGE_CHECK;
  return null;
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
      SELECT c.id AS fee_id, c.fee_published_id, c.fee_verified_id AS lineage_ref, c.fee_raw_id, c.institution_id, c.source,
             c.source_document_id, c.canonical_fee_key, c.fee_name, c.amount, c.amount_kind, c.rate_percent,
             sd.document_url
        FROM published_fee_catalog c
        LEFT JOIN source_documents sd ON sd.id = c.source_document_id
       WHERE c.review_status = 'approved'
         AND c.amount IS NOT NULL
         AND c.amount_kind IS DISTINCT FROM 'percent'
       ORDER BY md5(c.id::text || ${seed})
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
    const evidence = await readEvidence(db, fees.map((fee) => Number(fee.fee_published_id)));
    return { readable: true, ...versions, ...scoreFreshAudit(fees, textsByInstitution, evidence) };
  } catch (error) {
    console.error("runFreshAudit failed:", error);
    return { readable: false, ...versions, ...scoreFreshAudit([], new Map()) };
  }
}

/** Hamilton's own host reads, scoped to the sample, and the second looks already open on it. */
async function readEvidence(db: SqlTag, feeIds: number[]): Promise<FreshAuditEvidence> {
  if (feeIds.length === 0) return NO_EVIDENCE;
  type HostRow = { fee_published_id: number | string; names_own_bank: boolean | string | null };
  const ownBank = (row: HostRow) => row.names_own_bank === true || row.names_own_bank === "t" || row.names_own_bank === "true";
  const [other, unconfirmed, pending] = await Promise.all([
    db.unsafe<HostRow[]>(otherBankFeesSql("fees"), [feeIds]),
    db.unsafe<HostRow[]>(unconfirmedHostFeesSql("fees"), [feeIds]),
    db<{ fee_published_id: number | string }[]>`
      SELECT DISTINCT open.fee_published_id
        FROM pipeline_feedback open
       WHERE open.kind = 'takedown_pending'
         AND open.fee_published_id = ANY(${feeIds}::bigint[])
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_feedback later
            WHERE later.fee_published_id = open.fee_published_id
              AND later.check_name IS NOT DISTINCT FROM open.check_name
              AND later.kind IN ('takedown_confirmed', 'takedown_cleared')
              AND later.created_at >= open.created_at
         )
    `,
  ]);
  const ids = (rows: HostRow[]) => new Set(rows.filter((row) => !ownBank(row)).map((row) => Number(row.fee_published_id)));
  return { otherBank: ids(other), unconfirmedHost: ids(unconfirmed), pending: new Set(pending.map((row) => Number(row.fee_published_id))) };
}

export function summarizeFreshAudit(result: FreshAuditResult): string {
  if (!result.readable) return "Deming's fresh audit could not read the live fees; accuracy is unknown today.";
  const unknown = result.noText > 0 ? `; ${result.noText} with no stored text (unknown)` : "";
  if (result.accuracy == null) {
    return `Deming audited ${result.sampled} live fees but only ${result.scorable} had stored text, too few for a percentage: ${result.right} right${unknown}.`;
  }
  const pct = (result.accuracy * 100).toFixed(1);
  return `Deming audited ${result.sampled} live fees (seed ${result.seed}): ${result.right} of ${result.scorable} right (${pct}%), ${result.amountMiss} amount not supported, ${result.categoryMiss} category not supported, ${result.evidenceMiss} not from the bank's own schedule${unknown}. Critical misses: ${result.bySeverity.critical}.`;
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
    evidence_miss: result.evidenceMiss,
    relinked: result.relinked,
    pending: result.misses.filter((miss) => miss.pending).length,
    no_text: result.noText,
    accuracy: result.accuracy,
    by_severity: result.bySeverity,
    misses: result.misses.slice(0, MISS_LIMIT),
  };
}
