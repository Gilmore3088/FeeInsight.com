import { createHash } from "crypto";

import { sql } from "@/lib/data-store/connection";
import { learningSchemaReady, recordAttempt } from "@/lib/agents/learning/attempts";
import { countOutcomes, type AttemptOutcome } from "@/lib/agents/learning/outcomes";
import { normalizeStateCode } from "@/lib/agents/state-lane-memory";
import { WHOLE_DOCUMENT_BATCH } from "@/lib/agents/document-batch";
import { currentCopySchemaReady } from "@/lib/agents/magellan/current-copy";
import { CATEGORY_GUARD_VERSION, checkFeeCategory, refileCategory } from "@/lib/fee-category-guard";
import { RETIRED_CATEGORIES } from "@/lib/fee-fold";
import { RULE_WHY, ruleFor } from "@/lib/agents/hamilton/eval-verdicts";
import { checkFeeAgainstSource, checkRateAgainstSource } from "@/lib/custom-report/source-check";
import { settledFrequency } from "@/lib/fee-frequency";
import { excerptOf } from "@/lib/agents/hamilton/frequency-fill";
import { PERCENT_FEE_RANGES, isPercentFee, percentFeeAllowed, ratePercentOf, type RateFields } from "@/lib/percent-fees";
import { darwinFeedbackRows, recordDarwinFeedback } from "./feedback";
import { recheckVerifiedFees, type VerifiedRecheckResult } from "./verified-recheck";
import { CANONICAL_KEY_MAP } from "@/lib/fee-taxonomy";
import { recordHamiltonMonitorSignal } from "@/lib/hamilton/monitor-signals";
import { inSavepoint } from "@/lib/agents/savepoint";
import { institutionTier } from "@/lib/agents/state-expert/memory";
import {
  DARWIN_CATEGORY_MODEL_STRATEGY,
  categoryOpinion,
  loadCategoryModel,
  type CategoryOpinion,
} from "./category-model";

import {
  isExplicitZeroFee,
  ZERO_FEE_RAW_FLAG,
  ZERO_FEE_VERIFIED_FLAG,
  CATEGORY_AMOUNT_ENVELOPES,
} from "./envelopes";
import { darwinEnvelopeFor, loadLearnedEnvelopes, type LearnedEnvelope } from "./learned-envelopes";
import {
  DARWIN_PEER_STRATEGY,
  DARWIN_SECOND_SOURCE_STRATEGY,
  districtOfState,
  holdsForPeerReview,
  loadSourceCopies,
  PeerLevelCache,
  peerCheck,
  peerOutlierReason,
  SECOND_SOURCE_FLAG,
  secondSourceCheck,
  type PeerCheckResult,
  type SecondSourceResult,
} from "./peer-checks";

type SqlTag = typeof sql;

/**
 * The verifier recorded in the attempt log; bump the version when the rules change.
 * v3 added the category guard (src/lib/fee-category-guard.ts): a fee name must support
 * the category it was filed under.
 */
// The `not_in_source` check joined version 3 without a bump on purpose: a new version
// re-selects every decided row, and rows once held back as `duplicate_in_batch` would
// then be verified as second copies of an already verified fee (only `fee_raw_id` is unique).
export const DARWIN_VERIFY_STRATEGY = { strategy: "verify.rules", version: 3 } as const;
/**
 * The source check (`checkFeeAgainstSource`, Accuracy's `src/lib/custom-report/source-check.ts`)
 * as Darwin read it, recorded on every decision. A `not_in_source` rejection was final: the row
 * was never read again, so a fee the check could not trace before a fix stayed rejected after it
 * (1,126 rows at 499 banks by 2026-10-09, Northern Trust's wrapped-name $25 overdraft among them).
 * Raising this number gives every `not_in_source` rejection stamped lower one more read, the way
 * a guard bump re-checks `category_mismatch`; a row the check still fails is stamped and done.
 * Bump it when a source-check fix lands that should reach rejected rows. v1: 2026-10-09, after
 * Knox v62 (#861) taught the check wrapped leader names, per-wire lines and former-fee columns.
 */
export const DARWIN_SOURCE_CHECK_VERSION = 1;
/**
 * The verified row's frequency was settled from the fee's own schedule line (`settledFrequency`,
 * the same rule as Hamilton's frequency fill and Knox v52) because Knox's stated frequency
 * contradicted it or was never stated there: "$1.00 per withdrawal in excess of six per month"
 * read as monthly is charged per item (held excess-withdrawal rows, Oct 9).
 */
export const FREQUENCY_SETTLED_FLAG = "darwin_frequency_settled";

export const DARWIN_VERIFY_DEFAULT_LIMIT = 100;
export const DARWIN_VERIFY_MAX_LIMIT = 500;

const VALID_CANONICAL_KEYS = new Set(Object.values(CANONICAL_KEY_MAP));

/**
 * Why Darwin did not verify a row. Every skipped row carries exactly one code, in the
 * attempt log and in the review signal's reason counts.
 */
export type DarwinReasonCode =
  | "missing_canonical"
  | "missing_name"
  | "category_mismatch"
  | "missing_lineage"
  | "invalid_amount"
  | "not_in_source"
  | "outside_envelope"
  | "peer_outlier"
  | "duplicate_in_batch"
  | "duplicate_verified"
  | "percent_not_publishable"
  | "category_lesson_pending"
  | "retired_category"
  | "conditional_zero"
  | "name_rule";

/**
 * `rejected`: the row cannot become a verified fee as read. `needs_review`: the row may
 * be right but a person should look first (an amount outside its category's range).
 * `duplicate`: the same fee was already verified. All three are terminal for this rule
 * version, so a skipped row never comes back to starve the batch.
 */
export type DarwinDecision = "verified" | "rejected" | "needs_review" | "duplicate";

export const DARWIN_REASON_TEXT: Readonly<Record<DarwinReasonCode, string>> = {
  missing_canonical: "Missing or invalid canonical hint",
  missing_name: "Missing fee name",
  category_mismatch: "Fee name does not support its category",
  missing_lineage: "Missing source lineage",
  invalid_amount: "Missing or invalid amount",
  not_in_source: "Fee and amount not found in the bank's own stored schedule",
  outside_envelope: "Amount outside the category's plausible range",
  peer_outlier: "Amount far outside the state's peer range for this fee and asset size",
  duplicate_in_batch: "Same fee already verified in this batch",
  duplicate_verified: "Duplicate verified row",
  percent_not_publishable: "A rate in a category that does not publish rates (often an interest rate, not a fee)",
  category_lesson_pending: "Fee name belongs to a category the guard does not place it in yet; held until the guard learns it",
  retired_category: "Category retired by the top-50 fold and the name has no home in a live one; Hamilton never publishes it",
  conditional_zero: "A $0 fee whose own schedule line prices it ($0 if a condition is met, else a charge); the charge is the fee",
  name_rule: "The name or line fails a rule Hamilton would take the live fee down for",
};

const NONZERO_DOLLAR = /\$\s*(\d[\d,]*(?:\.\d{1,2})?)/g;
const PRICE_CELL = /\$|\bfree\b|\bn\/c\b|\bno charge\b/i;

/**
 * The part of a schedule line that belongs to this fee: on a table line (cells split by " | ")
 * the cell that carries the most words of the fee name, plus the next cell when it reads as a
 * price ("$6.95 per Month", "FREE"); a prose line is used whole. Keeps a neighbour's price in
 * the same table row ("Monthly Maintenance | Free | Assisted Phone Transactions* | $3") from
 * being read as this fee's. Pure.
 */
export function ownSegment(line: string, feeName: string | null | undefined): string {
  const cells = line.split(/\s\|\s/);
  if (cells.length < 2) return line;
  const tokens = (feeName ?? "").toLowerCase().match(/[a-z]{3,}/g) ?? [];
  let best = -1;
  let bestScore = 0;
  cells.forEach((cell, index) => {
    const lower = cell.toLowerCase();
    const score = tokens.filter((token) => lower.includes(token)).length;
    if (score > bestScore) {
      bestScore = score;
      best = index;
    }
  });
  if (best < 0) return line;
  const next = cells[best + 1];
  const nextIsPrice = next != null && PRICE_CELL.test(next) && (next.match(/[a-z]+/gi)?.length ?? 0) <= 4;
  return nextIsPrice ? `${cells[best]} | ${next}` : cells[best];
}

/**
 * A $0 fee is conditional when its own part of the line (or its name) also prices it or names a
 * balance band: "Monthly Fee: $0 with $100 minimum daily balance OR $2.50/month", "Bill Pay - FREE
 * with E-Statements and Debit Card | $6.95 per Month", "Monthly fee for balance of $500 & over |
 * FREE" (the $5 row is the line below). The customer who misses the condition pays the charge, so
 * $0 is not the fee; the row is held, never verified as free (UAT, 2026-10-09: 3 of the 4 wrong
 * rows in a 20-row check of the not_in_source re-select were $0 readings of priced fees). A
 * neighbour's price in the same table row does not count (dry read, 2026-10-09: "Monthly
 * Maintenance | Free | Assisted Phone Transactions* | $3" is a free fee). Pure.
 */
export function conditionalZero(amount: number | null, line: string | null | undefined, feeName: string | null | undefined): boolean {
  if (amount !== 0) return false;
  const text = `${line ? ownSegment(line, feeName) : ""} ${feeName ?? ""}`;
  return [...text.matchAll(NONZERO_DOLLAR)].some((match) => Number(match[1].replace(/,/g, "")) > 0);
}

/**
 * Category lessons Darwin knows before the shared guard does. The guard
 * (`src/lib/fee-category-guard.ts`, Accuracy's) is the one place a name is matched to a
 * category, so Darwin never re-files a row itself: a row whose filed category matches a
 * lesson here is held as `category_lesson_pending` (needs_review, no verified row, so Hamilton
 * cannot publish it) and comes back for one more read when `CATEGORY_GUARD_VERSION` rises,
 * the same path a `category_mismatch` takes. Once the guard carries the lesson its re-file rule
 * moves the row and the hold no longer matches; drop the entry here in the same change.
 * 2026-10-09: "Bond return items" $35 (raw 246460) filed `nsf` passed the v57 guard; a returned
 * bond or coupon is a returned deposited item (RDI), not a customer NSF.
 */
export const DARWIN_CATEGORY_HOLDS: ReadonlyArray<{
  filedAs: string;
  shouldBe: string;
  when: RegExp;
  since: string;
}> = [
  // The bond-return hold (2026-10-09) ended with guard v58, which re-files those rows.
];

/** The pending category lesson that holds this row, if any. */
export function pendingCategoryLesson(canonicalFeeKey: string | null, feeName: string | null | undefined) {
  if (!canonicalFeeKey || !feeName) return null;
  return DARWIN_CATEGORY_HOLDS.find((hold) => hold.filedAs === canonicalFeeKey && hold.when.test(feeName)) ?? null;
}

function decisionFor(code: DarwinReasonCode | null): DarwinDecision {
  if (code == null) return "verified";
  if (code === "outside_envelope" || code === "peer_outlier" || code === "category_lesson_pending" || code === "conditional_zero") return "needs_review";
  if (code === "duplicate_in_batch" || code === "duplicate_verified") return "duplicate";
  return "rejected";
}

export interface RawFeeRow extends RateFields {
  fee_raw_id: number | string;
  institution_id: number | string;
  source_url: string | null;
  document_r2_key: string | null;
  extraction_confidence: number | string | null;
  fee_name: string;
  amount: number | string | null;
  frequency: string | null;
  outlier_flags: unknown;
  conditions: string | null;
  institution_name?: string | null;
  source_document_id?: number | string | null;
  state_code?: string | null;
  asset_size_tier?: string | null;
  asset_size?: number | string | null;
}

export interface DarwinVerificationResult {
  feeRawId: number;
  institutionId: number;
  feeName: string;
  amount: number | null;
  canonicalFeeKey: string | null;
  status: "verified" | "skipped";
  decision: DarwinDecision;
  reasonCode: DarwinReasonCode | null;
  reason: string | null;
  feeVerifiedId: number | null;
  /** Pass 2 peer check; null when the state has too few peers for this fee. */
  peerCheck?: PeerCheckResult | null;
  /** Pass 2 second-source check; null when no other stored document has this fee. */
  secondSource?: SecondSourceResult | null;
  /** Layer 2 learned category check, in shadow: recorded, never decides. Null without a model. */
  categoryModel?: CategoryOpinion | null;
}

export interface RunDarwinVerifyOptions {
  runId: number;
  stepId?: number;
  limit?: number;
  institutionId?: number;
  stateCode?: string;
  dryRun?: boolean;
  db?: SqlTag;
}

export interface RunDarwinVerifyResult {
  selectedRawFees: number;
  processedRawFees: number;
  verifiedFees: number;
  skippedFees: number;
  limit: number;
  dryRun: boolean;
  learning: boolean;
  outcomes: Partial<Record<AttemptOutcome, number>>;
  /** Skipped rows by reason code. */
  reasonCounts: Partial<Record<DarwinReasonCode, number>>;
  recheck: VerifiedRecheckResult | null;
  /** Verified rows that are explicit $0 (free) fees. */
  zeroFeesVerified: number;
  /** Pass 2: rows held for review as far outside their state peers. */
  peerOutliers: number;
  /** Pass 2: rows compared with their Fed district or national peers (state had too few). */
  peerFallbackChecks: number;
  /** Pass 2: fallback comparisons far outside the district or national range (recorded, not held). */
  peerFallbackOutliers: number;
  /** Rows held because the amount is above a learned (not hand-set) category range. */
  learnedEnvelopeHolds: number;
  /** Pass 2: rows whose amount another stored document of the same bank confirms. */
  secondSourceAgreements: number;
  /** Pass 2: rows another stored document of the same bank shows at a different amount. */
  secondSourceDisagreements: number;
  /** Layer 2 (shadow): rows whose category the learned model disputes. */
  categoryModelDisputes: number;
  /** Judgements written to `pipeline_feedback`; null when skipped (dry run, no store yet, or a write error). */
  feedbackWritten: number | null;
  results: DarwinVerificationResult[];
}

/** The attempt-log fingerprint for one raw row. */
export function rawFeeFingerprint(feeRawId: number | string): string {
  return `raw:${feeRawId}`;
}

function boundedLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DARWIN_VERIFY_DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(parsed), 1), DARWIN_VERIFY_MAX_LIMIT);
}

function parseFlags(value: unknown): string[] {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as unknown;
      return parseFlags(parsed);
    } catch {
      return [];
    }
  }
  return [];
}

function canonicalHintFrom(row: Pick<RawFeeRow, "outlier_flags" | "conditions">): string | null {
  const fromFlag = parseFlags(row.outlier_flags)
    .find((flag) => flag.startsWith("canonical_hint:"))
    ?.slice("canonical_hint:".length)
    .trim();
  const hint = fromFlag || row.conditions?.match(/canonical_hint=([a-z0-9_]+)/i)?.[1] || null;
  if (!hint) return null;
  return VALID_CANONICAL_KEYS.has(hint) ? hint : null;
}

function stableUuid(value: string): string {
  const hex = createHash("sha256").update(value).digest("hex");
  const variant = ((Number.parseInt(hex.slice(16, 18), 16) & 0x3f) | 0x80)
    .toString(16)
    .padStart(2, "0");
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    `4${hex.slice(13, 16)}`,
    `${variant}${hex.slice(18, 20)}`,
    hex.slice(20, 32),
  ].join("-");
}

export function normalizedAmount(value: number | string | null): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100) / 100;
}

const NO_LEARNED_ENVELOPES: ReadonlyMap<string, LearnedEnvelope> = new Map();

/** The first rule a row fails, or null when it can be verified. Exported for tests. */
export function verificationReasonCode(
  row: RawFeeRow,
  canonicalFeeKey: string | null,
  learnedEnvelopes: ReadonlyMap<string, LearnedEnvelope> = NO_LEARNED_ENVELOPES,
): DarwinReasonCode | null {
  if (!canonicalFeeKey) return "missing_canonical";
  if (!row.fee_name?.trim()) return "missing_name";
  if (!checkFeeCategory(canonicalFeeKey, row.fee_name, row).ok) return "category_mismatch";
  if (!row.source_url?.trim() && !row.document_r2_key?.trim()) return "missing_lineage";
  if (isPercentFee(row)) {
    if (!percentFeeAllowed(canonicalFeeKey)) return "percent_not_publishable";
    const rate = ratePercentOf(row);
    if (rate == null || row.amount != null) return "invalid_amount";
    const range = PERCENT_FEE_RANGES[canonicalFeeKey];
    return rate < range.min || rate > range.max ? "outside_envelope" : null;
  }
  const amount = normalizedAmount(row.amount);
  if (amount == null || amount < 0) return "invalid_amount";
  if (amount === 0) {
    return isExplicitZeroFee(amount, parseFlags(row.outlier_flags), ZERO_FEE_RAW_FLAG) ? null : "invalid_amount";
  }
  const envelope = darwinEnvelopeFor(canonicalFeeKey, learnedEnvelopes);
  if (amount < envelope.min || amount > envelope.max) return "outside_envelope";
  return null;
}

/**
 * Is the fee stated in the stored text of the document Knox read it from? The shared
 * accuracy check (`checkFeeAgainstSource`), with Hamilton's reading: a tiered price is the
 * bank's real price for its band. A row with no stored text cannot be traced. Exported for tests.
 */
export function statedInOwnSource(
  row: Pick<RawFeeRow, "fee_name" | "amount" | "source_document_id" | "amount_kind" | "rate_percent">,
  texts: ReadonlyMap<number, string>,
  canonicalFeeKey?: string | null,
): boolean {
  if (isPercentFee(row)) {
    const rate = ratePercentOf(row);
    const text = row.source_document_id == null ? undefined : texts.get(Number(row.source_document_id));
    return rate != null && !!text && checkRateAgainstSource(text, row.fee_name, rate, ".").ok;
  }
  const amount = normalizedAmount(row.amount);
  if (amount == null || row.source_document_id == null) return false;
  const text = texts.get(Number(row.source_document_id));
  if (!text) return false;
  const result = checkFeeAgainstSource(text, row.fee_name, amount, ".", canonicalFeeKey);
  return result.ok || result.reason === "tiered_fee";
}

/** The schedule line the shared source check traced the fee to, or null when it did not. */
export function sourceLineFor(
  row: Pick<RawFeeRow, "fee_name" | "amount" | "source_document_id" | "amount_kind" | "rate_percent">,
  texts: ReadonlyMap<number, string>,
  canonicalFeeKey?: string | null,
): string | null {
  if (isPercentFee(row)) return null;
  const amount = normalizedAmount(row.amount);
  if (amount == null || row.source_document_id == null) return null;
  const text = texts.get(Number(row.source_document_id));
  if (!text) return null;
  const result = checkFeeAgainstSource(text, row.fee_name, amount, ".", canonicalFeeKey);
  return result.ok ? result.sourceLine : null;
}

/**
 * The checks a verified row must still pass after the shared source check has traced it:
 * a live category, not a conditional $0, and none of the name rules Hamilton takes a live fee
 * down for (`ruleFor`), applied before the row is verified instead of after it is published.
 * `line` is the traced schedule line, else Knox's excerpt. Pure.
 */
export function postSourceCheck(
  canonicalFeeKey: string,
  feeName: string,
  amount: number | null,
  line: string | null,
): { code: "retired_category" | "conditional_zero" | "name_rule"; rule?: string } | null {
  if (canonicalFeeKey in RETIRED_CATEGORIES) return { code: "retired_category" };
  if (conditionalZero(amount, line, feeName)) return { code: "conditional_zero" };
  const rule = ruleFor(canonicalFeeKey, feeName, amount, line);
  return rule ? { code: "name_rule", rule } : null;
}

/** The newest completed text of each document, as Hamilton's source check reads it. */
export async function loadSourceTexts(db: SqlTag, documentIds: number[]): Promise<Map<number, string>> {
  if (documentIds.length === 0) return new Map();
  const texts = await db<{ source_document_id: number | string; normalized_text: string }[]>`
    SELECT DISTINCT ON (source_document_id) source_document_id, normalized_text
      FROM agent_source_texts
     WHERE source_document_id = ANY(${documentIds}::bigint[])
       AND status = 'completed'
       AND normalized_text IS NOT NULL
     ORDER BY source_document_id, id DESC
  `;
  return new Map(texts.map((text) => [Number(text.source_document_id), text.normalized_text]));
}

/**
 * Version of the in-batch duplicate key, recorded on each attempt. Version 1 keyed on the
 * source URL, so a fee on a bank's current copy of a page was held as a duplicate of the
 * same fee on an older copy at that URL, and only the older copy was ever verified.
 * Version 2 keys on the stored document. Version 3 adds the fee's own source line, so two
 * products' fees with one price on one document ("Money Market Savings Account (below $2,500) |
 * $15/mo." and "Interest Checking (below $1,500) | $15/mo.", SCCU 8109) are two fees, while the
 * same line read twice (two Knox runs of one document) is still one.
 */
export const DARWIN_BATCH_KEY_VERSION = 3;

/** The source line Knox read, spacing folded; empty when the row has none. */
function sourceLineKey(conditions: string | null): string {
  return (excerptOf(conditions) ?? "").replace(/\s+/g, " ").trim().toLowerCase();
}

/** Same institution, category, amount, frequency, document and source line: the same fee line. */
function batchKey(row: RawFeeRow, canonicalFeeKey: string): string {
  return [
    Number(row.institution_id),
    canonicalFeeKey,
    normalizedAmount(row.amount),
    isPercentFee(row) ? `rate:${ratePercentOf(row)}` : "",
    (row.frequency ?? "").trim().toLowerCase(),
    row.source_document_id != null
      ? `doc:${Number(row.source_document_id)}`
      : (row.source_url ?? row.document_r2_key ?? "").trim(),
    sourceLineKey(row.conditions),
  ].join("|");
}

async function selectRawFees(
  db: SqlTag,
  limit: number,
  learning: boolean,
  institutionId?: number,
  stateCode?: string,
  currentCopy = false,
): Promise<RawFeeRow[]> {
  const params: Array<number | string> = [limit];
  const filters: string[] = [];
  if (institutionId) {
    params.push(institutionId);
    filters.push(`AND fr.institution_id = $${params.length}`);
  }
  const normalizedState = normalizeStateCode(stateCode);
  if (normalizedState) {
    params.push(normalizedState);
    filters.push(`AND upper(btrim(inst.state_code)) = $${params.length}`);
  }
  if (learning) {
    // A row this rule version already rejected is never selected again, so rejected
    // rows cannot starve the batch.
    const strategyParam = `$${params.push(DARWIN_VERIFY_STRATEGY.strategy)}`;
    const versionParam = `$${params.push(DARWIN_VERIFY_STRATEGY.version)}`;
    // A category rejection under an older guard version is the exception: a guard change
    // (CATEGORY_GUARD_VERSION) re-checks those rows once, so a real fee a rule wrongly
    // rejected, or one a new re-file rule now places, is not lost. A row held for a category
    // lesson the guard has not learned yet (DARWIN_CATEGORY_HOLDS) takes the same path.
    const guardParam = `$${params.push(CATEGORY_GUARD_VERSION)}`;
    // A `not_in_source` rejection under an older source-check version is re-read once
    // (DARWIN_SOURCE_CHECK_VERSION), so a fix to the shared source check reaches the rows it
    // was made for; a row the check still fails is stamped with today's version and rests.
    const sourceCheckParam = `$${params.push(DARWIN_SOURCE_CHECK_VERSION)}`;
    // A row held outside its category's hand-set amount envelope is re-checked once when
    // today's envelope would take its amount (the account_research floor went from $5 to $1 on
    // 2026-10-09 for the returned mail and fax fees pooled there), so an envelope change reaches
    // the rows it was made for. Learned envelopes move with the data and never re-select.
    const envelopesParam = `$${params.push(JSON.stringify(CATEGORY_AMOUNT_ENVELOPES))}`;
    // A row held as an in-batch duplicate under an older key is re-checked once when it sits
    // on the bank's current copy and nothing on that same document is verified as the same fee
    // from the same source line (v3); a row with a verified twin on its own line stays a
    // duplicate. Needs the current-copy column (source_documents.superseded_by_id).
    const batchKeyParam = currentCopy ? `$${params.push(DARWIN_BATCH_KEY_VERSION)}` : null;
    const duplicateRecheck = batchKeyParam ? `
              AND NOT (
                pa.detail->>'reason_code' = 'duplicate_in_batch'
                AND COALESCE((pa.detail->>'batch_key_version')::int, 1) < ${batchKeyParam}
                AND EXISTS (
                  SELECT 1 FROM source_documents sd
                   WHERE sd.id = fr.source_document_id AND sd.superseded_by_id IS NULL
                )
                AND NOT EXISTS (
                  SELECT 1
                    FROM verified_fee_observations twin
                    JOIN raw_fee_observations twin_raw ON twin_raw.fee_raw_id = twin.fee_raw_id
                   WHERE twin_raw.source_document_id = fr.source_document_id
                     AND twin.canonical_fee_key = pa.detail->>'canonical_fee_key'
                     AND twin.amount IS NOT DISTINCT FROM fr.amount
                     AND lower(regexp_replace(COALESCE(substring(twin_raw.conditions from 'excerpt="?(.*?)"?$'), ''), '\\s+', ' ', 'g'))
                         = lower(regexp_replace(COALESCE(substring(fr.conditions from 'excerpt="?(.*?)"?$'), ''), '\\s+', ' ', 'g'))
                )
              )` : "";
    filters.push(`AND NOT EXISTS (
           SELECT 1
             FROM pipeline_attempts pa
            WHERE pa.input_fingerprint = 'raw:' || fr.fee_raw_id::text
              AND pa.strategy = ${strategyParam}
              AND pa.strategy_version = ${versionParam}
              AND NOT (
                pa.detail->>'reason_code' IN ('category_mismatch', 'category_lesson_pending')
                AND COALESCE((pa.detail->>'category_guard_version')::int, 0) < ${guardParam}
              )
              AND NOT (
                pa.detail->>'reason_code' = 'not_in_source'
                AND COALESCE((pa.detail->>'source_check_version')::int, 0) < ${sourceCheckParam}
              )
              AND NOT (
                pa.detail->>'reason_code' = 'outside_envelope'
                AND ${envelopesParam}::jsonb ? (pa.detail->>'canonical_fee_key')
                AND (pa.detail->>'amount')::numeric
                    BETWEEN (${envelopesParam}::jsonb->(pa.detail->>'canonical_fee_key')->>'min')::numeric
                        AND (${envelopesParam}::jsonb->(pa.detail->>'canonical_fee_key')->>'max')::numeric
              )
${duplicateRecheck}
         )`);
  }
  return db.unsafe<RawFeeRow[]>(
    `
      WITH eligible AS (
      SELECT fr.fee_raw_id,
             fr.institution_id,
             fr.source_url,
             fr.document_r2_key,
             fr.extraction_confidence,
             fr.fee_name,
             fr.amount,
             fr.frequency,
             fr.outlier_flags,
             fr.conditions,
             fr.amount_kind,
             fr.rate_percent,
             fr.rate_min_amount,
             fr.rate_max_amount,
             fr.rate_basis,
             inst.institution_name,
             fr.source_document_id,
             upper(btrim(inst.state_code)) AS state_code,
             inst.asset_size_tier,
             inst.asset_size,
             COALESCE(fr.source_document_id::text, 'row:' || fr.fee_raw_id::text) AS batch_document_key,
             fr.created_at AS batch_created_at
        FROM raw_fee_observations fr
        JOIN institution_sources inst ON inst.id = fr.institution_id
       WHERE fr.source = 'knox'
         AND fr.outlier_flags ? 'needs_darwin_verification'
         ${filters.join("\n         ")}
         AND NOT EXISTS (
           SELECT 1
             FROM verified_fee_observations fv
            WHERE fv.fee_raw_id = fr.fee_raw_id
         )
      )
      ${WHOLE_DOCUMENT_BATCH}
       ORDER BY eligible.batch_created_at ASC, eligible.fee_raw_id ASC
    `,
    params,
  );
}

export async function insertVerifiedFee(
  db: SqlTag,
  options: {
    runId: number;
    row: RawFeeRow;
    canonicalFeeKey: string;
    secondSourceAgrees?: boolean;
    extraFlags?: string[];
  },
): Promise<number | null> {
  const feeRawId = Number(options.row.fee_raw_id);
  const institutionId = Number(options.row.institution_id);
  const percent = isPercentFee(options.row);
  const amount = percent ? null : normalizedAmount(options.row.amount);
  const eventId = stableUuid(`darwin:${options.runId}:${feeRawId}:${options.canonicalFeeKey}`);
  const flags = ["agentic_darwin_verified"];
  if (amount === 0) flags.push(ZERO_FEE_VERIFIED_FLAG);
  if (options.secondSourceAgrees) flags.push(SECOND_SOURCE_FLAG);
  if (options.extraFlags) flags.push(...options.extraFlags);
  const stated = options.row.frequency ?? null;
  const frequency = amount == null ? stated : settledFrequency(excerptOf(options.row.conditions), amount, stated, options.canonicalFeeKey);
  if (frequency !== stated) flags.push(FREQUENCY_SETTLED_FLAG);
  const inserted = await db`
    INSERT INTO verified_fee_observations (
      fee_raw_id,
      institution_id,
      source_url,
      document_r2_key,
      extraction_confidence,
      canonical_fee_key,
      variant_type,
      outlier_flags,
      verified_by_agent_event_id,
      fee_name,
      amount,
      frequency,
      review_status,
      amount_kind,
      rate_percent,
      rate_min_amount,
      rate_max_amount,
      rate_basis
    )
    VALUES (
      ${feeRawId},
      ${institutionId},
      ${options.row.source_url},
      ${options.row.document_r2_key},
      ${options.row.extraction_confidence},
      ${options.canonicalFeeKey},
      ${null},
      ${JSON.stringify(flags)}::jsonb,
      ${eventId}::uuid,
      ${options.row.fee_name},
      ${amount},
      ${frequency},
      'verified',
      ${percent ? "percent" : "flat"},
      ${percent ? ratePercentOf(options.row) : null},
      ${percent ? options.row.rate_min_amount ?? null : null},
      ${percent ? options.row.rate_max_amount ?? null : null},
      ${percent ? options.row.rate_basis ?? null : null}
    )
    ON CONFLICT DO NOTHING
    RETURNING fee_verified_id
  `;
  return inserted[0]?.fee_verified_id == null ? null : Number(inserted[0].fee_verified_id);
}

function institutionLabel(row: Pick<RawFeeRow, "institution_id" | "institution_name">): string {
  return row.institution_name?.trim() || `Institution ${row.institution_id}`;
}

function rowCountLabel(count: number): string {
  return `${count} fee row${count === 1 ? "" : "s"}`;
}

async function recordVerificationSignals(
  db: SqlTag,
  runId: number,
  results: DarwinVerificationResult[],
  rowByRawFeeId: Map<number, RawFeeRow>,
  learnedEnvelopes: ReadonlyMap<string, LearnedEnvelope>,
): Promise<void> {
  const grouped = new Map<number, {
    institutionName: string;
    feeRawIds: number[];
    feeVerifiedIds: number[];
    canonicalFeeKeys: string[];
  }>();
  const reviewGrouped = new Map<number, {
    institutionName: string;
    feeRawIds: number[];
    canonicalFeeKeys: string[];
    reasons: Map<DarwinReasonCode, number>;
    envelopes: Record<string, { min: number; max: number; source: string }>;
    peerOutliers: Array<Record<string, string | number | boolean | null>>;
  }>();

  results.forEach((result) => {
    const row = rowByRawFeeId.get(result.feeRawId);
    const institutionId = result.institutionId;
    if (result.status === "skipped") {
      const group = reviewGrouped.get(institutionId) ?? {
        institutionName: row ? institutionLabel(row) : `Institution ${institutionId}`,
        feeRawIds: [],
        canonicalFeeKeys: [],
        reasons: new Map<DarwinReasonCode, number>(),
        envelopes: {},
        peerOutliers: [],
      };
      group.feeRawIds.push(result.feeRawId);
      if (result.canonicalFeeKey) group.canonicalFeeKeys.push(result.canonicalFeeKey);
      const code = result.reasonCode ?? "invalid_amount";
      group.reasons.set(code, (group.reasons.get(code) ?? 0) + 1);
      if (code === "outside_envelope" && result.canonicalFeeKey) {
        group.envelopes[result.canonicalFeeKey] = darwinEnvelopeFor(result.canonicalFeeKey, learnedEnvelopes);
      }
      if (code === "peer_outlier" && result.peerCheck) {
        group.peerOutliers.push({
          fee_raw_id: result.feeRawId,
          canonical_fee_key: result.canonicalFeeKey,
          amount: result.amount,
          peer_low: result.peerCheck.low,
          peer_high: result.peerCheck.high,
          peer_median: result.peerCheck.median,
          peer_count: result.peerCheck.peerCount,
          peer_tier: result.peerCheck.levelTier,
          reason: result.reason,
          second_source: result.secondSource?.verdict ?? null,
        });
      }
      reviewGrouped.set(institutionId, group);
      return;
    }

    if (result.status !== "verified" || !result.feeVerifiedId) return;
    const group = grouped.get(institutionId) ?? {
      institutionName: row ? institutionLabel(row) : `Institution ${institutionId}`,
      feeRawIds: [],
      feeVerifiedIds: [],
      canonicalFeeKeys: [],
    };
    group.feeRawIds.push(result.feeRawId);
    group.feeVerifiedIds.push(result.feeVerifiedId);
    if (result.canonicalFeeKey) group.canonicalFeeKeys.push(result.canonicalFeeKey);
    grouped.set(institutionId, group);
  });

  for (const [institutionId, group] of grouped) {
    const count = group.feeVerifiedIds.length;
    await inSavepoint(db, (scope) => recordHamiltonMonitorSignal(
      {
        institutionId,
        signalType: "darwin_verification_completed",
        severity: "medium",
        title: `${group.institutionName} - ${rowCountLabel(count)} verified`,
        body:
          `Darwin verified ${rowCountLabel(count)} from source-grounded Knox observations. ` +
          "These rows are ready for Hamilton publication review before verified benchmark scoring changes.",
        sourceJson: {
          source: "darwin_verification",
          run_id: runId,
          pipeline_stage: "verified_unpublished",
          verified_fee_ids: group.feeVerifiedIds,
          raw_fee_ids: group.feeRawIds,
          canonical_fee_keys: Array.from(new Set(group.canonicalFeeKeys)),
          verified_fee_count: count,
          provider_call_queued: false,
        },
      },
      scope,
    )).catch((error) => {
      console.error("recordDarwinVerificationSignal failed:", error);
    });
  }

  for (const [institutionId, group] of reviewGrouped) {
    const count = group.feeRawIds.length;
    await inSavepoint(db, (scope) => recordHamiltonMonitorSignal(
      {
        institutionId,
        signalType: "darwin_verification_needs_review",
        severity: "medium",
        title: `${group.institutionName} - ${rowCountLabel(count)} needs verification review`,
        body:
          `Darwin skipped ${rowCountLabel(count)} during deterministic verification. ` +
          "Review canonical hints, amounts, and source lineage before publishing or using these rows in benchmark scoring.",
        sourceJson: {
          source: "darwin_verification",
          run_id: runId,
          pipeline_stage: "verification_needs_review",
          raw_fee_ids: group.feeRawIds,
          canonical_fee_keys: Array.from(new Set(group.canonicalFeeKeys)),
          reason_counts: Object.fromEntries(group.reasons),
          reason_text: Object.fromEntries(
            Array.from(group.reasons.keys()).map((code) => [code, DARWIN_REASON_TEXT[code]]),
          ),
          ...(Object.keys(group.envelopes).length > 0 ? { amount_envelopes: group.envelopes } : {}),
          ...(group.peerOutliers.length > 0 ? { peer_outliers: group.peerOutliers } : {}),
          skipped_fee_count: count,
          provider_call_queued: false,
        },
      },
      scope,
    )).catch((error) => {
      console.error("recordDarwinVerificationReviewSignal failed:", error);
    });
  }
}

function attemptOutcome(result: DarwinVerificationResult): AttemptOutcome {
  if (result.decision === "verified") return "ok";
  return result.decision === "duplicate" ? "unchanged" : "rejected";
}

/** One attempt per pass 2 check that had evidence to work with, each its own strategy. */
async function recordPassTwoAttempts(
  db: SqlTag,
  options: RunDarwinVerifyOptions,
  result: DarwinVerificationResult,
): Promise<void> {
  const common = {
    institutionId: result.institutionId,
    stage: "verify" as const,
    fingerprint: rawFeeFingerprint(result.feeRawId),
    costMicrousd: 0,
    runId: options.runId,
    stepId: options.stepId ?? null,
  };
  if (result.peerCheck) {
    await recordAttempt(db, {
      ...common,
      strategy: DARWIN_PEER_STRATEGY.strategy,
      version: DARWIN_PEER_STRATEGY.version,
      // A peer outlier is a flag for review, not a rejection.
      outcome: result.peerCheck.outlier ? "evidence_mismatch" : "ok",
      yieldCount: result.peerCheck.outlier ? 0 : 1,
      detail: {
        fee_raw_id: result.feeRawId,
        canonical_fee_key: result.canonicalFeeKey,
        amount: result.amount,
        peer_outlier: result.peerCheck.outlier,
        peer_scope: result.peerCheck.scope,
        peer_held: holdsForPeerReview(result.peerCheck),
        peer_low: result.peerCheck.low,
        peer_high: result.peerCheck.high,
        peer_p25: result.peerCheck.p25,
        peer_median: result.peerCheck.median,
        peer_p75: result.peerCheck.p75,
        peer_count: result.peerCheck.peerCount,
        institution_tier: result.peerCheck.tier,
        peer_tier: result.peerCheck.levelTier,
        decision: result.decision,
        reason: result.peerCheck.outlier ? result.reason : null,
      },
    });
  }
  if (result.categoryModel) {
    const opinion = result.categoryModel;
    await recordAttempt(db, {
      ...common,
      strategy: DARWIN_CATEGORY_MODEL_STRATEGY.strategy,
      version: DARWIN_CATEGORY_MODEL_STRATEGY.version,
      // Shadow: a dispute is evidence for the adjudicator, not a rejection.
      outcome: opinion.disputed ? "evidence_mismatch" : "ok",
      yieldCount: opinion.disputed ? 0 : 1,
      detail: {
        fee_raw_id: result.feeRawId,
        fee_name: result.feeName,
        canonical_fee_key: result.canonicalFeeKey,
        amount: result.amount,
        disputed: opinion.disputed,
        probability: Number(opinion.probability.toFixed(4)),
        suggested_key: opinion.suggested,
        suggested_probability: Number(opinion.suggestedProbability.toFixed(4)),
        decision: result.decision,
      },
    });
  }
  if (result.secondSource) {
    await recordAttempt(db, {
      ...common,
      strategy: DARWIN_SECOND_SOURCE_STRATEGY.strategy,
      version: DARWIN_SECOND_SOURCE_STRATEGY.version,
      outcome: result.secondSource.verdict === "agrees" ? "ok" : "evidence_mismatch",
      yieldCount: result.secondSource.agreeingDocumentIds.length,
      detail: {
        fee_raw_id: result.feeRawId,
        fee_verified_id: result.feeVerifiedId,
        canonical_fee_key: result.canonicalFeeKey,
        amount: result.amount,
        verdict: result.secondSource.verdict,
        agreeing_source_document_ids: result.secondSource.agreeingDocumentIds,
        disagreeing: result.secondSource.disagreeing,
      },
    });
  }
}

export async function runDarwinVerify(
  options: RunDarwinVerifyOptions,
): Promise<RunDarwinVerifyResult> {
  const db = options.db ?? sql;
  const limit = boundedLimit(options.limit);
  const dryRun = Boolean(options.dryRun);
  const learning = !dryRun && (await learningSchemaReady(db));
  const currentCopy = learning && (await currentCopySchemaReady(db));
  const rows = await selectRawFees(db, limit, learning, options.institutionId, options.stateCode, currentCopy);
  const rowByRawFeeId = new Map(rows.map((row) => [Number(row.fee_raw_id), row]));
  const results: DarwinVerificationResult[] = [];

  const verifiedInBatch = new Set<string>();
  const categoryModel = rows.length > 0 ? await loadCategoryModel(db).catch(() => null) : null;
  const learnedEnvelopes = rows.length > 0 ? await loadLearnedEnvelopes(db) : NO_LEARNED_ENVELOPES;
  const sourceTexts = await loadSourceTexts(
    db,
    Array.from(new Set(rows.flatMap((row) => (row.source_document_id == null ? [] : [Number(row.source_document_id)])))),
  );

  // Pass 2 evidence, loaded once per batch: state peer levels and the banks' other
  // stored documents for the same fees.
  const peers = new PeerLevelCache(db);
  // A row Knox filed under a neighbouring category is checked under the one its name says.
  const categoryOf = (row: RawFeeRow) => refileCategory(canonicalHintFrom(row), row.fee_name);
  const hintedRows = rows.filter((row) => canonicalHintFrom(row) != null);
  const sourceCopies = await loadSourceCopies(
    db,
    Array.from(new Set(hintedRows.map((row) => Number(row.institution_id)))),
    Array.from(new Set(hintedRows.map((row) => canonicalHintFrom(row) as string))),
    canonicalHintFrom,
  );

  for (const row of rows) {
    const canonicalFeeKey = categoryOf(row);
    let reasonCode = verificationReasonCode(row, canonicalFeeKey, learnedEnvelopes);
    const categoryHold = reasonCode ? null : pendingCategoryLesson(canonicalFeeKey, row.fee_name);
    if (categoryHold) reasonCode = "category_lesson_pending";
    if (!reasonCode && !statedInOwnSource(row, sourceTexts, canonicalFeeKey)) reasonCode = "not_in_source";
    // Traced to its line: the line must also price it as read, in a live category, under
    // Hamilton's own name rules (2026-10-09: the re-select verified "$0 if condition" fees).
    const sourceLine = reasonCode || !canonicalFeeKey ? null : sourceLineFor(row, sourceTexts, canonicalFeeKey) ?? excerptOf(row.conditions);
    const postCheck = reasonCode || !canonicalFeeKey ? null : postSourceCheck(canonicalFeeKey, row.fee_name, normalizedAmount(row.amount), sourceLine);
    if (postCheck) reasonCode = postCheck.code;
    if (!reasonCode && canonicalFeeKey && verifiedInBatch.has(batchKey(row, canonicalFeeKey))) {
      reasonCode = "duplicate_in_batch";
    }
    const base = {
      feeRawId: Number(row.fee_raw_id),
      institutionId: Number(row.institution_id),
      feeName: row.fee_name,
      amount: normalizedAmount(row.amount),
      canonicalFeeKey,
    };

    // Pass 2 runs only on rows the rules accept.
    let peer: PeerCheckResult | null = null;
    let secondSource: SecondSourceResult | null = null;
    if (!reasonCode && canonicalFeeKey && base.amount != null) {
      const stateCode = row.state_code ?? options.stateCode;
      const levels = await peers.forState(stateCode);
      peer = peerCheck(
        levels,
        canonicalFeeKey,
        institutionTier(row.asset_size_tier, row.asset_size),
        base.amount,
        await peers.widerLevels(),
        districtOfState(stateCode),
      );
      secondSource = secondSourceCheck(
        {
          feeRawId: base.feeRawId,
          institutionId: base.institutionId,
          sourceDocumentId: row.source_document_id == null ? null : Number(row.source_document_id),
          canonicalFeeKey,
          amount: base.amount,
        },
        sourceCopies,
      );
      if (holdsForPeerReview(peer)) reasonCode = "peer_outlier";
    }

    let result: DarwinVerificationResult;
    if (reasonCode || !canonicalFeeKey) {
      const code = reasonCode ?? "missing_canonical";
      result = {
        ...base,
        status: "skipped",
        decision: decisionFor(code),
        reasonCode: code,
        reason: code === "peer_outlier" && peer && base.amount != null
          ? `${DARWIN_REASON_TEXT[code]}: ${peerOutlierReason(peer, base.amount)}`
          : code === "name_rule" && postCheck?.rule
            ? `${DARWIN_REASON_TEXT[code]}: ${postCheck.rule} (${RULE_WHY[postCheck.rule as keyof typeof RULE_WHY]})`
            : DARWIN_REASON_TEXT[code],
        feeVerifiedId: null,
        peerCheck: peer,
        secondSource,
      };
    } else {
      const feeVerifiedId = dryRun
        ? null
        : await insertVerifiedFee(db, {
          runId: options.runId,
          row,
          canonicalFeeKey,
          secondSourceAgrees: secondSource?.verdict === "agrees",
        });
      const verified = Boolean(feeVerifiedId) || dryRun;
      const code: DarwinReasonCode | null = verified ? null : "duplicate_verified";
      if (verified) verifiedInBatch.add(batchKey(row, canonicalFeeKey));
      result = {
        ...base,
        status: verified ? "verified" : "skipped",
        decision: decisionFor(code),
        reasonCode: code,
        reason: code ? DARWIN_REASON_TEXT[code] : null,
        feeVerifiedId,
        peerCheck: peer,
        secondSource,
      };
    }
    result.categoryModel = categoryModel && canonicalFeeKey
      ? categoryOpinion(categoryModel, row.fee_name, canonicalFeeKey)
      : null;
    results.push(result);

    if (learning) {
      await recordAttempt(db, {
        institutionId: result.institutionId,
        stage: "verify",
        strategy: DARWIN_VERIFY_STRATEGY.strategy,
        version: DARWIN_VERIFY_STRATEGY.version,
        fingerprint: rawFeeFingerprint(result.feeRawId),
        outcome: attemptOutcome(result),
        yieldCount: result.status === "verified" ? 1 : 0,
        costMicrousd: 0,
        runId: options.runId,
        stepId: options.stepId ?? null,
        detail: {
          fee_raw_id: result.feeRawId,
          fee_verified_id: result.feeVerifiedId,
          canonical_fee_key: result.canonicalFeeKey,
          amount: result.amount,
          decision: result.decision,
          reason_code: result.reasonCode,
          reason: result.reason,
          category_guard_version: CATEGORY_GUARD_VERSION,
          source_check_version: DARWIN_SOURCE_CHECK_VERSION,
          batch_key_version: DARWIN_BATCH_KEY_VERSION,
          category_hold: categoryHold
            ? { filed_as: categoryHold.filedAs, should_be: categoryHold.shouldBe, since: categoryHold.since }
            : undefined,
          name_rule: postCheck?.rule,
          source_line: postCheck && sourceLine ? sourceLine.slice(0, 300) : undefined,
          amount_envelope: result.reasonCode === "outside_envelope" && result.canonicalFeeKey
            ? darwinEnvelopeFor(result.canonicalFeeKey, learnedEnvelopes)
            : undefined,
        },
      });
      await recordPassTwoAttempts(db, options, result);
    }
  }

  if (!dryRun) {
    await recordVerificationSignals(db, options.runId, results, rowByRawFeeId, learnedEnvelopes);
  }

  // Each decision goes to the shared learning store as a judgement on Knox's read.
  const feedbackWritten = !dryRun && learning
    ? await recordDarwinFeedback(
        db,
        darwinFeedbackRows(results, rowByRawFeeId, { runId: options.runId, verifyVersion: DARWIN_VERIFY_STRATEGY.version }),
      )
    : null;

  const reasonCounts: Partial<Record<DarwinReasonCode, number>> = {};
  for (const result of results) {
    if (result.reasonCode) reasonCounts[result.reasonCode] = (reasonCounts[result.reasonCode] ?? 0) + 1;
  }

  // Darwin's second look at rows it verified earlier under weaker checks (verified-recheck.ts).
  const recheck = learning
    ? await recheckVerifiedFees(db, { runId: options.runId, stepId: options.stepId ?? null }).catch((error) => {
        console.warn("[darwin] verified recheck failed", error instanceof Error ? error.message : error);
        return null;
      })
    : null;

  return {
    selectedRawFees: rows.length,
    processedRawFees: results.length,
    verifiedFees: results.filter((result) => result.status === "verified").length,
    skippedFees: results.filter((result) => result.status === "skipped").length,
    limit,
    dryRun,
    learning,
    outcomes: learning ? countOutcomes(results.map(attemptOutcome)) : {},
    reasonCounts,
    recheck,
    zeroFeesVerified: results.filter((result) => result.status === "verified" && result.amount === 0).length,
    peerOutliers: results.filter((result) => result.reasonCode === "peer_outlier").length,
    peerFallbackChecks: results.filter((result) => result.peerCheck && result.peerCheck.scope !== "state").length,
    peerFallbackOutliers: results.filter((result) => result.peerCheck?.outlier && result.peerCheck.scope !== "state").length,
    learnedEnvelopeHolds: results.filter((result) =>
      result.reasonCode === "outside_envelope" &&
      result.canonicalFeeKey != null &&
      darwinEnvelopeFor(result.canonicalFeeKey, learnedEnvelopes).source === "learned"
    ).length,
    secondSourceAgreements: results.filter((result) => result.secondSource?.verdict === "agrees").length,
    secondSourceDisagreements: results.filter((result) => result.secondSource?.verdict === "disagrees").length,
    categoryModelDisputes: results.filter((result) => result.categoryModel?.disputed).length,
    feedbackWritten,
    results,
  };
}
