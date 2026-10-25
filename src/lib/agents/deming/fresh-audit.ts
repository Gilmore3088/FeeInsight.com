import { sql } from "@/lib/data-store/connection";
import { CATEGORY_GUARD_VERSION, checkFeeCategory } from "@/lib/fee-category-guard";
import { SOURCE_CHECK_STRATEGY, traceLiveFee, type InstitutionText, type LiveFeeRow } from "@/lib/agents/hamilton/source-check";
import { severityFor, type Severity } from "@/lib/agents/deming/severity";
import { ARTICLE_PAGE_CHECK, isArticlePage } from "@/lib/agents/hamilton/article-page";
import { PRODUCT_PAGE_CONFLICT_CHECK, isSameItemConflict, productPageConflictSql, type ConflictRow } from "@/lib/agents/hamilton/product-page-conflict";
import {
  OTHER_BANK_DOCUMENT_CHECK,
  UNCONFIRMED_HOST_CHECK,
  otherBankFeesSql,
  unconfirmedHostFeesSql,
} from "@/lib/agents/hamilton/other-bank-document";
import { nameHasCutShape } from "@/lib/fee-name-fragments";
import { dropsCondition, isCutoffName, repairCutoffName, NAME_RETIDY_STRATEGY } from "@/lib/agents/knox/name-retidy";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { ACCURACY_DAILY_SAMPLE, ACCURACY_MIN_SCORABLE, ACCURACY_REPORTING_VERSION, type AuditObservation, type AuditVerdict } from "./accuracy-measure";

type SqlTag = typeof sql;

/**
 * Deming's fresh audit (the fee-evaluation skill, run by Atlas every day): draw a seeded
 * sample of live dollar fees from `published_fee_catalog` and ask the shipped checks whether
 * the bank's own stored schedule supports each one. Amount: `traceLiveFee`, the same shared
 * source check Hamilton runs. Category: `checkFeeCategory`. Evidence (the source-evidence-audit
 * skill, v2): the document must be the bank's own (`otherBankFeesSql`, `unconfirmedHostFeesSql`)
 * and a fee schedule, not an article or product page (`isArticlePage`, `isProductPage`).
 * Whole record (v3, after UAT scored 10 "right" rows 8/10): a $0 row must be a priced line, not
 * a perk ("Free checks" in a feature list), and the name must read as a fee's name (no glyph
 * junk, no cut sentence: Darwin's `nameIsFragment`).
 * The audit itself reads only; no flags, no model calls. Its misses are then saved as unconfirmed
 * test cases and sent to their owners (`audit-misses.ts`, #1119). Rate fees are not in this
 * sample (they are never pooled with dollars).
 */

/**
 * v4 (2026-10-13, James): a fee from the bank's own product page is right unless its schedule
 * prices the same fee differently (`productPageConflictSql`); before v4 every product-page fee
 * was a miss. Also v4: a name that keeps its condition, as Hamilton's rename pass leaves it on
 * purpose, is not a bad name (`nameQuality`).
 * v5 (#1196): a name that opens on a cut cents figure ("00 Monthly fee") or a table row number
 * ("14 | Insufficient funds") is a cut name, through Darwin's `nameHasCutShape`.
 * v6 (#2440): a product-page fee is a miss only when its schedule prices the same item
 * differently (`isSameItemConflict`), the rule Hamilton's own conflict check uses.
 * v7: that rule counts only schedule lines on the page's own host, priced above $0 and fetched
 * no earlier than the page, and pairs names only when they are the same item word for word.
 * v8 (#1443): `nameQuality` reads Knox's narrowed `isCutoffName` (Knox v107), so a name whose only
 * sentence words sit in a closed parenthetical ending it ("Notary fee (this service is for members
 * only)") is no longer a `name_fragment`.
 */
export const FRESH_AUDIT_VERSION = 8;
export const FRESH_AUDIT_SAMPLE = ACCURACY_DAILY_SAMPLE;
/** Below this many scorable fees the audit reports counts, not a percentage. */
export const FRESH_AUDIT_MIN_SCORABLE = ACCURACY_MIN_SCORABLE;
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
  /** From a product page whose bank's schedule prices the same fee differently (v4). */
  productPageConflict: Set<number>;
}

const NO_EVIDENCE: FreshAuditEvidence = { otherBank: new Set(), unconfirmedHost: new Set(), pending: new Set(), productPageConflict: new Set() };

export interface FreshAuditMiss {
  feeId: number;
  feePublishedId: number;
  sourceDocumentId: number | null;
  documentUrl: string | null;
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
  /** A $0 row that is a perk in a feature list, not a priced schedule line. */
  notAFee: number;
  /** Everything else holds, but the name is glyph junk or a cut sentence. */
  nameMiss: number;
  /** Stated in another stored document of the bank than the one it was read from. */
  relinked: number;
  /** No completed stored text for the fee: unknown, never right or wrong. */
  noText: number;
  scorable: number;
  /** right / scorable, or null when fewer than FRESH_AUDIT_MIN_SCORABLE fees are scorable. */
  accuracy: number | null;
  bySeverity: Record<Severity, number>;
  misses: FreshAuditMiss[];
  /** Every sampled `fee_published_id`, in draw order, so a reviewer can re-check the same rows. */
  sampleIds: number[];
  /** Full sample, including unknowns; weekly confidence counts each published fee once. */
  observations: AuditObservation[];
}

export interface FreshAuditResult extends FreshAuditScore {
  readable: boolean;
  seed: string;
  categoryGuardVersion: number;
  sourceCheckVersion: number;
  requestedSampleSize?: number;
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
    notAFee: 0,
    nameMiss: 0,
    relinked: 0,
    noText: 0,
    scorable: 0,
    accuracy: null,
    bySeverity: { critical: 0, major: 0, minor: 0, info: 0 },
    misses: [],
    sampleIds: fees.map((fee) => Number(fee.fee_published_id)),
    observations: [],
  };
  const observe = (fee: FreshAuditFee, verdict: AuditVerdict) => score.observations.push([Number(fee.fee_published_id), verdict]);
  const miss = (fee: FreshAuditFee, check: string, reason: string, verdict: AuditVerdict) => {
    observe(fee, verdict);
    const severity = severityFor(check, reason);
    score.bySeverity[severity] += 1;
    score.misses.push({
      feeId: Number(fee.fee_id),
      feePublishedId: Number(fee.fee_published_id),
      sourceDocumentId: fee.source_document_id == null ? null : Number(fee.source_document_id),
      documentUrl: fee.document_url ?? null,
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
      observe(fee, "unknown");
      continue;
    }
    score.scorable += 1;
    if (verdict.kind === "untraceable") {
      score.amountMiss += 1;
      miss(fee, "hamilton.source_check", verdict.reason, "amount");
      continue;
    }
    const category = checkFeeCategory(fee.canonical_fee_key, fee.fee_name);
    if (!category.ok) {
      score.categoryMiss += 1;
      miss(fee, "hamilton.category_guard", category.code, "category");
      continue;
    }
    const evidenceCheck = evidenceFailure(fee, evidence);
    if (evidenceCheck) {
      score.evidenceMiss += 1;
      miss(fee, evidenceCheck, evidenceCheck.replace(/^hamilton\./, ""), "evidence");
      continue;
    }
    const texts = textsByInstitution.get(Number(fee.institution_id)) ?? [];
    const own = texts.find((text) => Number(text.source_document_id) === verdict.sourceDocumentId);
    if (own && zeroIsAPerk(fee, own.normalized_text)) {
      score.notAFee += 1;
      miss(fee, NOT_A_FEE_CHECK, "perk_not_a_price", "notAFee");
      continue;
    }
    const nameProblem = nameQuality(fee.fee_name);
    if (nameProblem) {
      score.nameMiss += 1;
      miss(fee, NAME_QUALITY_CHECK, nameProblem, "name");
      continue;
    }
    if (verdict.kind === "relinked") score.relinked += 1;
    score.right += 1;
    observe(fee, "right");
  }
  score.accuracy = score.scorable >= FRESH_AUDIT_MIN_SCORABLE ? score.right / score.scorable : null;
  const order: Record<Severity, number> = { critical: 0, major: 1, minor: 2, info: 3 };
  score.misses.sort((a, b) => order[a.severity] - order[b.severity] || a.feeId - b.feeId);
  return score;
}

export const NOT_A_FEE_CHECK = "deming.not_a_fee_line";
export const NAME_QUALITY_CHECK = "deming.name_quality";
/** A price written as zero on the line: "$0", "0.00", "No charge", "N/C", "None", "Waived". */
const ZERO_PRICE_TOKEN = /\$\s*0(?:\.00)?(?!\d)|(?<![\d.])0\.00\b|\bno\s+(?:charge|fee|cost)\b|\bn\/c\b|\bnone\b|\bwaived\b/i;
/** Glyphs no fee name carries: Latin Extended letters from a broken font map, the replacement character, controls. */
const JUNK_GLYPH = /[\u0100-\u024F\uFFFD\u0000-\u0008\u000E-\u001F]/;

/** A $0 row named "Free ..." whose own line states no zero price is a perk, not a fee line. */
function zeroIsAPerk(fee: FreshAuditFee, text: string): boolean {
  if (fee.amount == null || Number(fee.amount) !== 0 || !/^\W*free\b/i.test(fee.fee_name)) return false;
  const check = checkFeeAgainstSource(text, fee.fee_name, 0, ".", fee.canonical_fee_key);
  return !check.ok || !ZERO_PRICE_TOKEN.test(check.sourceLine);
}

/** A name that ends on a word cut from its sentence ("ATM A fee of"). */
const TRAILING_CUT_WORD = /\b(?:of|to|from|for|at|is|and|or|with|by|a|an|the|per|than|below|above|up to|each)\s*$/i;
/** A name that is a sentence from the schedule's prose ("If your scheduled payment ..."). */
const PROSE_START = /^\s*(?:if|when|unless|because|in addition|you|we|our|your)\b/i;

/**
 * v4: a name that keeps its condition is a fee's name. Hamilton's rename pass keeps "Bill Pay
 * Inactivity Fee (applies after 60 days of inactivity)" whole on purpose, since dropping the
 * condition would lose what the fee is for (`dropsCondition`, UAT 2026-10-09). Before v4 the audit
 * counted those as bad names (3 of the 7 on Oct 12). A name is bad when it carries a cut shape, when
 * the rename pass could tidy it without losing a condition and has not, or when it is unchanged by
 * the pass yet ends on a cut word or is a sentence of prose.
 */
export function nameQuality(name: string): string | null {
  if (JUNK_GLYPH.test(name)) return "junk_glyphs";
  if (nameHasCutShape(name)) return "name_fragment";
  if (!isCutoffName(name)) return null;
  const repaired = repairCutoffName(name);
  if (repaired !== name) return dropsCondition(name, repaired) ? null : "name_fragment";
  return TRAILING_CUT_WORD.test(name.trim()) || PROSE_START.test(name) ? "name_fragment" : null;
}

/** The first evidence check the fee fails, or null when its document is the bank's own schedule. */
function evidenceFailure(fee: FreshAuditFee, evidence: FreshAuditEvidence): string | null {
  const id = Number(fee.fee_published_id);
  if (evidence.otherBank.has(id)) return OTHER_BANK_DOCUMENT_CHECK;
  if (evidence.unconfirmedHost.has(id)) return UNCONFIRMED_HOST_CHECK;
  if (isArticlePage(fee.document_url)) return ARTICLE_PAGE_CHECK;
  if (evidence.productPageConflict.has(id)) return PRODUCT_PAGE_CONFLICT_CHECK;
  return null;
}

export async function runFreshAudit({
  db = sql,
  now = new Date(),
  sampleSize = FRESH_AUDIT_SAMPLE,
}: { db?: SqlTag; now?: Date; sampleSize?: number } = {}): Promise<FreshAuditResult> {
  const seed = now.toISOString().slice(0, 10);
  const versions = { seed, categoryGuardVersion: CATEGORY_GUARD_VERSION, sourceCheckVersion: SOURCE_CHECK_STRATEGY.version, requestedSampleSize: sampleSize };
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
export async function readEvidence(db: SqlTag, feeIds: number[]): Promise<FreshAuditEvidence> {
  if (feeIds.length === 0) return NO_EVIDENCE;
  type HostRow = { fee_published_id: number | string; names_own_bank: boolean | string | null };
  const ownBank = (row: HostRow) => row.names_own_bank === true || row.names_own_bank === "t" || row.names_own_bank === "true";
  const [other, unconfirmed, pending, conflicts] = await Promise.all([
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
    db.unsafe<ConflictRow[]>(productPageConflictSql("fees"), [feeIds]),
  ]);
  const ids = (rows: HostRow[]) => new Set(rows.filter((row) => !ownBank(row)).map((row) => Number(row.fee_published_id)));
  const sampled = new Set(feeIds);
  return {
    otherBank: ids(other),
    unconfirmedHost: ids(unconfirmed),
    pending: new Set(pending.map((row) => Number(row.fee_published_id))),
    productPageConflict: new Set(conflicts.filter(isSameItemConflict).map((row) => Number(row.fee_published_id)).filter((id) => sampled.has(id))),
  };
}

export function summarizeFreshAudit(result: FreshAuditResult): string {
  if (!result.readable) return "Deming's fresh audit could not read the live fees; accuracy is unknown today.";
  const unknown = result.noText > 0 ? `; ${result.noText} with no stored text (unknown)` : "";
  if (result.accuracy == null) {
    return `Deming audited ${result.sampled} live fees but only ${result.scorable} had stored text, too few for a percentage: ${result.right} right${unknown}.`;
  }
  const pct = (result.accuracy * 100).toFixed(1);
  return `Deming audited ${result.sampled} live fees (seed ${result.seed}): ${result.right} of ${result.scorable} right on amount, category, source, fee line and name (${pct}%); ${result.amountMiss} amount not supported, ${result.categoryMiss} category not supported, ${result.evidenceMiss} not from the bank's own schedule, ${result.notAFee} not a fee line, ${result.nameMiss} bad name${unknown}. Critical misses: ${result.bySeverity.critical}.`;
}

export function freshAuditDetail(result: FreshAuditResult) {
  return {
    version: FRESH_AUDIT_VERSION,
    reporting_version: ACCURACY_REPORTING_VERSION,
    readable: result.readable,
    seed: result.seed,
    category_guard_version: result.categoryGuardVersion,
    source_check_version: result.sourceCheckVersion,
    name_check_version: NAME_RETIDY_STRATEGY.version,
    sample_requested: result.requestedSampleSize ?? FRESH_AUDIT_SAMPLE,
    sampled: result.sampled,
    scorable: result.scorable,
    right: result.right,
    amount_miss: result.amountMiss,
    category_miss: result.categoryMiss,
    evidence_miss: result.evidenceMiss,
    not_a_fee: result.notAFee,
    name_miss: result.nameMiss,
    relinked: result.relinked,
    pending: result.misses.filter((miss) => miss.pending).length,
    no_text: result.noText,
    accuracy: result.accuracy,
    by_severity: result.bySeverity,
    misses: result.misses.slice(0, MISS_LIMIT),
    sample_fee_published_ids: result.sampleIds,
    observations: result.observations,
  };
}
