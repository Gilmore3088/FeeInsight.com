import { feePageKey } from "@/lib/agents/hamilton/page-key";
import { sql } from "@/lib/data-store/connection";
import { isRetiredCategory } from "@/lib/fee-fold";
import { invalidateFeeSummaryCache } from "@/lib/data-store/fee-cache";
import {
  isExplicitZeroFee,
  withinAmountEnvelope,
  ZERO_FEE_VERIFIED_FLAG,
} from "@/lib/agents/darwin/envelopes";
import { learningSchemaReady, recordAttempt } from "@/lib/agents/learning/attempts";
import { countOutcomes, type AttemptOutcome } from "@/lib/agents/learning/outcomes";
import { WHOLE_DOCUMENT_BATCH } from "@/lib/agents/document-batch";
import { inSavepoint } from "@/lib/agents/savepoint";
import { normalizeStateCode } from "@/lib/agents/state-lane-memory";
import { checkFeeCategory, type CategoryGuardCode } from "@/lib/fee-category-guard";
import { limitGuardVerdict } from "@/lib/agents/hamilton/limit-guard";
import { repairNameShape, tidyFeeName } from "@/lib/agents/knox/layout";
import { stripFootnoteMarks } from "@/lib/agents/knox/rules";
import { isCutoffName, retidiedFeeName } from "@/lib/agents/knox/name-retidy";
import { CANONICAL_KEY_MAP } from "@/lib/fee-taxonomy";
import { PERCENT_FEE_RANGES, isPercentFee, percentFeeAllowed, ratePercentOf, type RateFields } from "@/lib/percent-fees";
import { recordHamiltonMonitorSignal } from "@/lib/hamilton/monitor-signals";
import { confirmFeeChange } from "@/lib/report-assemblers/monthly-pulse";
import { mayBeSameSchedule } from "@/lib/agents/hamilton/schedule-edition";
import { isArticlePage } from "@/lib/agents/hamilton/article-page";
import { FREE_READ_PREFIX, isProductPage, productPageTakedownEnabled } from "@/lib/agents/hamilton/product-page";
import { DARWIN_SCHEDULE_REFILED_FLAG } from "@/lib/agents/darwin/schedule-refile";
import { priceInName, RULE_WHY, ruleFor } from "@/lib/agents/hamilton/eval-verdicts";
import { feeKey, reproducibleFees, RULES_RECHECK_REASON } from "@/lib/agents/hamilton/rules-recheck";

type SqlTag = typeof sql;

/** The publisher recorded in the attempt log; bump the version when the rules change. */
export const HAMILTON_PUBLISH_STRATEGY = { strategy: "publish.rules", version: 2 } as const;

export const HAMILTON_PUBLISH_DEFAULT_LIMIT = 100;
export const HAMILTON_PUBLISH_MAX_LIMIT = 500;
export const HAMILTON_PUBLISH_DEFAULT_MIN_CONFIDENCE = 0.8;
/**
 * An institution enters the catalog only once it has this many distinct fees (canonical
 * fee keys) live or ready to publish. One overdraft fee is not a fee schedule, and
 * counting it as a covered institution overstates coverage. Rows for thinner
 * institutions stay verified and unpublished, and publish on a later run once Knox
 * finds more of the schedule (Rosetta re-reads documents with few Knox fees).
 */
export const HAMILTON_PUBLISH_MIN_INSTITUTION_FEES = 3;

const VALID_CANONICAL_KEYS = new Set(Object.values(CANONICAL_KEY_MAP));
const BLOCKING_FLAGS = new Set([
  "ambiguous",
  "challenge",
  "challenged",
  "lineage_missing",
  "needs_human",
  "needs_manual_review",
  "outlier",
  "rejected",
]);

export interface VerifiedFeeRow extends RateFields {
  fee_verified_id: number | string;
  fee_raw_id: number | string;
  institution_id: number | string;
  source_url: string | null;
  document_r2_key: string | null;
  extraction_confidence: number | string | null;
  canonical_fee_key: string;
  variant_type: string | null;
  outlier_flags: unknown;
  verified_by_agent_event_id: string;
  fee_name: string;
  amount: number | string | null;
  frequency: string | null;
  raw_agent_event_id: string | null;
  /** The source document Knox read this fee from; null for rows without one. */
  source_document_id?: number | string | null;
  /** When that document was fetched; orders documents for the same fee. */
  document_crawled_at?: string | Date | null;
  /** The document's companion page (companion-streams.ts); null for the main fee link. */
  document_stream?: string | null;
  /** The URL that document was fetched from; names the page a price was read on. */
  document_url?: string | null;
  institution_name?: string | null;
  /** True when this row was skipped as identical to a live fee the rules re-check took down. */
  twin_recheck?: boolean | null;
  /** Skipped as identical before the same-line check (9 Oct) and decided once more. */
  same_line_reselect?: boolean | null;
  /** True when Knox's free-fee reader read this row (product-page.ts). */
  free_read?: boolean | null;
}

interface PriorPublishedFeeRow extends RateFields {
  fee_published_id: number | string;
  amount: number | string | null;
  fee_name: string;
  published_at: string | Date;
  source_url?: string | null;
  source_document_id?: number | string | null;
  document_crawled_at?: string | Date | null;
  document_stream?: string | null;
  document_url?: string | null;
}

export interface HamiltonPublishResult {
  feeVerifiedId: number;
  institutionId: number;
  feeName: string;
  amount: number | null;
  canonicalFeeKey: string;
  status: "published" | "skipped";
  reason: string | null;
  feePublishedId: number | null;
  previousFeePublishedId: number | null;
  previousAmount: number | null;
  amountDelta: number | null;
  movementDirection: "increase" | "decrease" | null;
  /** The live row this publish replaced (closed with rolled_back_reason 'superseded'). */
  supersededFeePublishedId: number | null;
  /** True once the change was written to fee_change_records. */
  changeRecorded: boolean;
}

export interface RunHamiltonPublishOptions {
  runId: number;
  limit?: number;
  institutionId?: number;
  stateCode?: string;
  minConfidence?: number;
  /** Distinct fees an institution needs before any of its rows publish. */
  minInstitutionFees?: number;
  stepId?: number;
  dryRun?: boolean;
  db?: SqlTag;
}

export interface HeldThinInstitution {
  institutionId: number;
  institutionName: string;
  /** Distinct fees live or ready to publish for this institution. */
  feeCount: number;
  heldRows: number;
}

export interface RunHamiltonPublishResult {
  selectedVerifiedFees: number;
  processedVerifiedFees: number;
  publishedFees: number;
  skippedFees: number;
  /** Live rows closed because the same fee was published at a new amount. */
  supersededFees: number;
  /** Published rows that are explicit $0 (free) fees. */
  zeroFeesPublished: number;
  learning: boolean;
  outcomes: Partial<Record<AttemptOutcome, number>>;
  limit: number;
  minConfidence: number;
  minInstitutionFees: number;
  /** Rows not published because their institution is below the fee minimum. */
  heldFees: number;
  heldInstitutions: HeldThinInstitution[];
  dryRun: boolean;
  batchId: string;
  results: HamiltonPublishResult[];
}

function boundedLimit(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return HAMILTON_PUBLISH_DEFAULT_LIMIT;
  return Math.min(Math.max(Math.floor(parsed), 1), HAMILTON_PUBLISH_MAX_LIMIT);
}

function boundedConfidence(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return HAMILTON_PUBLISH_DEFAULT_MIN_CONFIDENCE;
  return Math.min(Math.max(parsed, 0), 1);
}

function boundedMinInstitutionFees(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return HAMILTON_PUBLISH_MIN_INSTITUTION_FEES;
  return Math.min(Math.max(Math.floor(parsed), 1), 50);
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

function normalizedAmount(value: number | string | null): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100) / 100;
}

function normalizedConfidence(value: number | string | null): number {
  if (value == null || value === "") return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(parsed, 0), 1);
}

function coverageTier(confidence: number): "strong" | "provisional" {
  return confidence >= 0.9 ? "strong" : "provisional";
}

export function publishSkipReason(row: VerifiedFeeRow, minConfidence: number, productPageOn: boolean = productPageTakedownEnabled()): string | null {
  const flags = parseFlags(row.outlier_flags);
  if (!flags.includes("agentic_darwin_verified")) return "Not verified by the agentic Darwin path";
  const blockingFlag = flags.find((flag) => BLOCKING_FLAGS.has(flag));
  if (blockingFlag) return `Blocking flag: ${blockingFlag}`;
  if (!VALID_CANONICAL_KEYS.has(row.canonical_fee_key)) return "Invalid canonical fee key";
  // A fee whose wording found no home among the top 50 (fee-fold.ts) is not published.
  if (isRetiredCategory(row.canonical_fee_key)) return "Category folded into the top 50 with no home for this fee";
  if (!row.fee_name?.trim()) return "Missing fee name";
  if (!row.source_url?.trim() && !row.document_r2_key?.trim()) return "Missing source lineage";
  if (!row.verified_by_agent_event_id?.trim()) return "Missing Darwin verification event";
  // A blog post or story quotes national averages, not this bank's price (article-page.ts).
  if (isArticlePage(row.source_url)) return "Read from an article page, not a fee schedule";
  // A $0 benefit bullet on a product page, once James turns the check on (product-page.ts).
  if (row.free_read && normalizedAmount(row.amount) === 0 && isProductPage(row.document_url) && productPageOn) {
    return "Read from a product page's benefits, not a fee schedule";
  }
  const amount = normalizedAmount(row.amount);
  if (isPercentFee(row)) {
    // A rate publishes only in a category that publishes rates, inside its range.
    const rate = ratePercentOf(row);
    if (!percentFeeAllowed(row.canonical_fee_key)) return "Rate in a category that does not publish rates";
    if (rate == null || amount != null) return "Missing or invalid rate";
    const range = PERCENT_FEE_RANGES[row.canonical_fee_key];
    if (rate < range.min || rate > range.max) return "Rate outside the category's plausible range";
  } else if (amount == null || amount < 0) return "Missing or invalid amount";
  else if (amount === 0) {
    // $0 is a real price (a free fee) only when Darwin verified it as one.
    if (!isExplicitZeroFee(amount, flags, ZERO_FEE_VERIFIED_FLAG)) return "Missing or invalid amount";
  } else if (!withinAmountEnvelope(row.canonical_fee_key, amount)) {
    return "Amount outside the category's plausible range";
  }
  // A transfer or deposit limit read as a price; Knox's excerpt is checked by the sweep.
  const limit = isPercentFee(row) ? null : limitGuardVerdict(row);
  if (limit) return `Transaction limit, not a price: ${limit.detail}`;
  if (normalizedConfidence(row.extraction_confidence) < minConfidence) {
    return "Below publish confidence threshold";
  }
  return null;
}

/** The attempt-log fingerprint for one verified row. */
export function verifiedFeeFingerprint(feeVerifiedId: number | string): string {
  return `verified:${feeVerifiedId}`;
}

/** The verified-row flag a category-guard rejection leaves behind. */
export function categoryGuardFlag(code: CategoryGuardCode): string {
  return `category_guard:${code}`;
}

/**
 * Retire a verified row the category guard rejects, so Hamilton's publish selection
 * (verified/approved rows without a live published row) never picks it up again.
 */
export async function rejectVerifiedFeeForCategory(
  db: SqlTag,
  feeVerifiedId: number,
  code: CategoryGuardCode,
): Promise<void> {
  await rejectVerifiedFee(db, feeVerifiedId, categoryGuardFlag(code));
}

/** The flag a verified row keeps when publish holds it for its name (`publishNameHold`). */
export function publishHoldFlag(code: string): string {
  return `publish_hold:${code}`;
}

/** Retire a verified row with the flag that says why; the row and its raw read stay. */
export async function rejectVerifiedFee(db: SqlTag, feeVerifiedId: number, flag: string): Promise<void> {
  await db`
    UPDATE verified_fee_observations
       SET review_status = 'rejected',
           outlier_flags = CASE
             WHEN outlier_flags @> ${JSON.stringify([flag])}::jsonb THEN outlier_flags
             ELSE outlier_flags || ${JSON.stringify([flag])}::jsonb
           END
     WHERE fee_verified_id = ${feeVerifiedId}
       AND review_status IN ('verified', 'approved')
  `;
}

async function selectVerifiedFees(
  db: SqlTag,
  limit: number,
  learning: boolean,
  minConfidence: number,
  minInstitutionFees: number,
  institutionId?: number,
  stateCode?: string,
): Promise<VerifiedFeeRow[]> {
  const params: Array<number | string> = [limit];
  const filters: string[] = [];
  if (minInstitutionFees > 1) {
    // Rough cut in SQL so thin institutions' rows do not fill every batch and starve
    // the rest of the queue; the exact count (with every publish rule) runs after.
    const confidenceParam = `$${params.push(minConfidence)}`;
    const minFeesParam = `$${params.push(minInstitutionFees)}`;
    filters.push(`AND (
           SELECT COUNT(DISTINCT depth.canonical_fee_key)
             FROM (
               SELECT fp.canonical_fee_key
                 FROM published_fee_records fp
                WHERE fp.institution_id = fv.institution_id
                  AND fp.rolled_back_at IS NULL
               UNION
               SELECT pv.canonical_fee_key
                 FROM verified_fee_observations pv
                WHERE pv.institution_id = fv.institution_id
                  AND pv.review_status IN ('verified', 'approved')
                  AND pv.outlier_flags ? 'agentic_darwin_verified'
                  AND COALESCE(pv.extraction_confidence, 0) >= ${confidenceParam}
             ) depth
         ) >= ${minFeesParam}`);
  }
  if (institutionId) {
    params.push(institutionId);
    filters.push(`AND fv.institution_id = $${params.length}`);
  }
  const normalizedState = normalizeStateCode(stateCode);
  if (normalizedState) {
    params.push(normalizedState);
    filters.push(`AND upper(btrim(inst.state_code)) = $${params.length}`);
  }
  if (learning) {
    // A row this rule version already decided on (published, skipped as identical, or
    // rejected) is never selected again, so skipped rows cannot starve the batch. Two
    // exceptions: a row Darwin re-filed after a takedown (verify.schedule_refile), whose
    // decision under its old category does not count; and a row the category guard rejected
    // that the guard re-queue step (publish.guard_requeue, flag `category_guard_requeued:g<n>`)
    // has since passed under a newer guard, whose guard rejection does not count. Without the
    // second, the nine rows re-queued on 2026-10-09 01:38 UTC were never selected again.
    const strategyParam = `$${params.push(HAMILTON_PUBLISH_STRATEGY.strategy)}`;
    const versionParam = `$${params.push(HAMILTON_PUBLISH_STRATEGY.version)}`;
    const refiledParam = `$${params.push(DARWIN_SCHEDULE_REFILED_FLAG)}`;
    filters.push(`AND NOT EXISTS (
           SELECT 1
             FROM pipeline_attempts pa
            WHERE pa.input_fingerprint = 'verified:' || fv.fee_verified_id::text
              AND pa.strategy = ${strategyParam}
              AND pa.strategy_version = ${versionParam}
              AND NOT (
                fv.outlier_flags ? ${refiledParam}
                AND pa.detail->>'canonical_fee_key' IS DISTINCT FROM fv.canonical_fee_key
              )
              AND NOT (
                pa.outcome = 'rejected'
                AND pa.detail->>'reason' LIKE 'Category guard%'
                AND EXISTS (
                  SELECT 1 FROM jsonb_array_elements_text(fv.outlier_flags) flag
                   WHERE flag LIKE 'category_guard_requeued:%'
                )
              )
              -- A row skipped as identical to a live fee the rules re-check later took down
              -- (that judged one document's read, not the fee) is selected again: AllSouth's
              -- second copy of its $10 early closure fee (verified 13856) sat unpublished after
              -- 16807 came down on Oct 5, and the bank showed no early closure fee.
              AND NOT (
                pa.outcome = 'unchanged'
                AND EXISTS (
                  SELECT 1 FROM published_fee_records prev
                   WHERE prev.fee_published_id = NULLIF(pa.detail->>'previous_fee_published_id', '')::bigint
                     AND prev.rolled_back_reason = 'rules_recheck_unreproduced'
                )
              )
              -- A row skipped as identical before the same-line check (9 Oct) to a live line of its
              -- own document under another name is decided once more: Wildfire's $5 ATM balance
              -- inquiry (verified 8019) sat behind its $5 "ATM Adjustment" (14754). The new decision
              -- carries same_line_check, so it is final. A box-size row decided by check 1 is decided
              -- once more by check 2, which reads "3 x 5" and "2 x 10" as two lines (CBB, 9 Oct).
              AND NOT (
                pa.outcome = 'unchanged'
                AND ${SAME_LINE_RESELECT_SQL}
                AND EXISTS (
                  SELECT 1 FROM published_fee_records prev
                    JOIN verified_fee_observations prev_fv ON prev_fv.fee_verified_id = prev.lineage_ref
                    JOIN raw_fee_observations prev_fr ON prev_fr.fee_raw_id = prev_fv.fee_raw_id
                   WHERE prev.fee_published_id = NULLIF(pa.detail->>'previous_fee_published_id', '')::bigint
                     AND prev.rolled_back_at IS NULL
                     AND prev_fr.source_document_id = fr.source_document_id
                     AND lower(regexp_replace(prev.fee_name, '[^a-zA-Z0-9]+', '', 'g'))
                         <> lower(regexp_replace(fv.fee_name, '[^a-zA-Z0-9]+', '', 'g'))
                )
              )
              AND NOT (pa.outcome = 'unchanged' AND ${THRESHOLD_RESELECT_SQL})
              AND NOT (pa.outcome = 'unchanged' AND ${OLDER_DOCUMENT_RESELECT_SQL})
         )`);
  }
  return db.unsafe<VerifiedFeeRow[]>(
    `
      WITH eligible AS (
      SELECT fv.fee_verified_id,
             fv.fee_raw_id,
             fv.institution_id,
             fv.source_url,
             fv.document_r2_key,
             fv.extraction_confidence,
             fv.canonical_fee_key,
             fv.variant_type,
             fv.outlier_flags,
             fv.verified_by_agent_event_id,
             fv.fee_name,
             fv.amount,
             fv.frequency,
             fv.amount_kind,
             fv.rate_percent,
             fv.rate_min_amount,
             fv.rate_max_amount,
             fv.rate_basis,
             fr.agent_event_id AS raw_agent_event_id,
             fr.source_document_id,
             sd.crawled_at AS document_crawled_at,
             -- Read through jsonb so this works before the companion-pages migration.
             to_jsonb(sd)->>'companion_source_id' AS document_stream,
             sd.document_url,
             inst.institution_name,
             EXISTS (
               SELECT 1
                 FROM pipeline_attempts twin_pa
                 JOIN published_fee_records twin
                   ON twin.fee_published_id = NULLIF(twin_pa.detail->>'previous_fee_published_id', '')::bigint
                WHERE twin_pa.input_fingerprint = 'verified:' || fv.fee_verified_id::text
                  AND twin_pa.outcome = 'unchanged'
                  AND twin.rolled_back_reason = '${RULES_RECHECK_REASON}'
             ) AS twin_recheck,
             EXISTS (
               SELECT 1
                 FROM pipeline_attempts sl_pa
                WHERE sl_pa.input_fingerprint = 'verified:' || fv.fee_verified_id::text
                  AND sl_pa.outcome = 'unchanged'
                  AND (${SAME_LINE_RESELECT_SQL.replaceAll("pa.detail", "sl_pa.detail")}
                       OR ${THRESHOLD_RESELECT_SQL.replaceAll("pa.detail", "sl_pa.detail")})
             ) AS same_line_reselect,
             COALESCE(fr.conditions LIKE '${FREE_READ_PREFIX}%', false) AS free_read,
             COALESCE(fr.source_document_id::text, 'row:' || fv.fee_verified_id::text) AS batch_document_key,
             fv.created_at AS batch_created_at
        FROM verified_fee_observations fv
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
        LEFT JOIN source_documents sd ON sd.id = fr.source_document_id
        JOIN institution_sources inst ON inst.id = fv.institution_id
       WHERE fv.review_status IN ('verified', 'approved')
         AND fv.outlier_flags ? 'agentic_darwin_verified'
         ${filters.join("\n         ")}
         AND NOT EXISTS (
           SELECT 1
             FROM published_fee_records fp
            WHERE fp.lineage_ref = fv.fee_verified_id
              AND fp.rolled_back_at IS NULL
         )
      )
      ${WHOLE_DOCUMENT_BATCH}
       ORDER BY eligible.batch_created_at ASC, eligible.fee_verified_id ASC
    `,
    params,
  );
}

interface InstitutionDepthRow extends VerifiedFeeRow {
  depth_source: "published" | "pending";
}

/**
 * Distinct fees per institution that are live in the catalog or would publish now
 * under every publish rule. Covers all of an institution's pending rows, not only
 * this batch's, so a batch cut by the limit does not hold a deep institution.
 */
async function institutionFeeDepth(
  db: SqlTag,
  institutionIds: number[],
  minConfidence: number,
): Promise<Map<number, number>> {
  const depth = new Map<number, Set<string>>();
  if (institutionIds.length === 0) return new Map();
  const rows = await db.unsafe<InstitutionDepthRow[]>(
    `
      -- institution_fee_depth
      SELECT 'published' AS depth_source,
             fp.institution_id,
             fp.canonical_fee_key,
             NULL::text AS fee_name,
             NULL::text AS source_url,
             NULL::text AS document_r2_key,
             NULL::text AS verified_by_agent_event_id,
             NULL::numeric AS amount,
             NULL::text AS amount_kind,
             NULL::numeric AS rate_percent,
             NULL::numeric AS extraction_confidence,
             '[]'::jsonb AS outlier_flags
        FROM published_fee_records fp
       WHERE fp.institution_id = ANY($1::bigint[])
         AND fp.rolled_back_at IS NULL
      UNION ALL
      SELECT 'pending' AS depth_source,
             fv.institution_id,
             fv.canonical_fee_key,
             fv.fee_name,
             fv.source_url,
             fv.document_r2_key,
             fv.verified_by_agent_event_id::text,
             fv.amount,
             fv.amount_kind,
             fv.rate_percent,
             fv.extraction_confidence,
             fv.outlier_flags
        FROM verified_fee_observations fv
       WHERE fv.institution_id = ANY($1::bigint[])
         AND fv.review_status IN ('verified', 'approved')
         AND fv.outlier_flags ? 'agentic_darwin_verified'
    `,
    [institutionIds],
  );
  for (const row of rows) {
    if (row.depth_source === "pending" && publishSkipReason(row, minConfidence)) continue;
    const id = Number(row.institution_id);
    const keys = depth.get(id) ?? new Set<string>();
    keys.add(row.canonical_fee_key);
    depth.set(id, keys);
  }
  return new Map(Array.from(depth, ([id, keys]) => [id, keys.size]));
}

export async function insertPublishedFee(
  db: SqlTag,
  options: {
    runId: number;
    batchId: string;
    row: VerifiedFeeRow;
  },
): Promise<number | null> {
  const feeVerifiedId = Number(options.row.fee_verified_id);
  const institutionId = Number(options.row.institution_id);
  const confidence = normalizedConfidence(options.row.extraction_confidence);
  const percent = isPercentFee(options.row);
  const amount = percent ? null : normalizedAmount(options.row.amount);
  // The publish gate is Darwin's verification, so its event id is the handshake id;
  // Hamilton no longer mints a stand-in id for an adversarial step that never ran.
  const publishEventId = options.row.verified_by_agent_event_id;
  const inserted = await db`
    INSERT INTO published_fee_records (
      lineage_ref,
      institution_id,
      canonical_fee_key,
      source_url,
      document_r2_key,
      extraction_confidence,
      agent_event_id,
      verified_by_agent_event_id,
      published_by_adversarial_event_id,
      fee_name,
      amount,
      frequency,
      variant_type,
      coverage_tier,
      batch_id,
      amount_kind,
      rate_percent,
      rate_min_amount,
      rate_max_amount,
      rate_basis
    )
    VALUES (
      ${feeVerifiedId},
      ${institutionId},
      ${options.row.canonical_fee_key},
      ${options.row.source_url},
      ${options.row.document_r2_key},
      ${confidence},
      ${options.row.raw_agent_event_id}::uuid,
      ${options.row.verified_by_agent_event_id}::uuid,
      ${publishEventId}::uuid,
      ${publishedFeeName(options.row.fee_name, options.row.canonical_fee_key)},
      ${amount},
      ${options.row.frequency},
      ${options.row.variant_type},
      ${coverageTier(confidence)},
      ${options.batchId},
      ${percent ? "percent" : "flat"},
      ${percent ? ratePercentOf(options.row) : null},
      ${percent ? options.row.rate_min_amount ?? null : null},
      ${percent ? options.row.rate_max_amount ?? null : null},
      ${percent ? options.row.rate_basis ?? null : null}
    )
    ON CONFLICT DO NOTHING
    RETURNING fee_published_id
  `;
  return inserted[0]?.fee_published_id == null ? null : Number(inserted[0].fee_published_id);
}

/** Live rows for the same fee (institution, canonical key, variant, frequency), newest first. */
async function selectLivePublishedFees(
  db: SqlTag,
  row: VerifiedFeeRow,
  options: { anyVariant?: boolean } = {},
): Promise<PriorPublishedFeeRow[]> {
  const anyVariant = options.anyVariant === true;
  try {
    return await inSavepoint(db, (scope) => scope<PriorPublishedFeeRow[]>`
      SELECT fp.fee_published_id,
             fp.amount,
             fp.amount_kind,
             fp.rate_percent,
             fp.fee_name,
             fp.published_at,
             fp.source_url,
             fr.source_document_id,
             sd.crawled_at AS document_crawled_at,
             to_jsonb(sd)->>'companion_source_id' AS document_stream,
             sd.document_url
        FROM published_fee_records fp
        LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
        LEFT JOIN source_documents sd ON sd.id = fr.source_document_id
       WHERE fp.institution_id = ${Number(row.institution_id)}
         AND fp.canonical_fee_key = ${row.canonical_fee_key}
         AND (${anyVariant} OR COALESCE(fp.variant_type, '') = COALESCE(${row.variant_type}, ''))
         AND (${anyVariant} OR COALESCE(fp.frequency, '') = COALESCE(${row.frequency}, ''))
         AND fp.rolled_back_at IS NULL
       ORDER BY fp.published_at DESC, fp.fee_published_id DESC
    `);
  } catch (error) {
    console.error("selectLivePublishedFees failed:", error);
    return [];
  }
}

function sameDocument(a: number | string | null | undefined, b: number | string | null | undefined): boolean {
  return a != null && b != null && String(a) === String(b);
}

/** The document stream a fee came from: "" for the main fee link, else its companion page. */
function documentStream(value: string | null | undefined): string {
  return value == null ? "" : String(value);
}

/** Both rows were read from the same page (two copies of it count as one). */
/**
 * The change log's like-for-like flag when the change is recorded: true on the same page, false
 * across audiences (business against consumer), and left for the pairing pass (null) when the
 * same audience's schedule moved to another page, since only the two texts' effective dates
 * can say whether it is a newer edition (schedule-edition.ts).
 */
function likeForLikeAtRecord(row: VerifiedFeeRow, prior: PriorPublishedFeeRow): boolean | null {
  return mayBeSameSchedule(prior.document_url ?? prior.source_url, row.document_url ?? row.source_url);
}

function samePage(row: VerifiedFeeRow, prior: PriorPublishedFeeRow): boolean {
  const rowPage = feePageKey(row.document_url ?? row.source_url);
  const priorPage = feePageKey(prior.document_url ?? prior.source_url);
  return rowPage != null && rowPage === priorPage;
}

/** Compared as Knox now names it, so a line published under an older untidy name ("Per Item | Stop Payment") is still the same line. */
export function normalizedFeeName(name: string | null | undefined): string {
  return (name ? repairNameShape(tidyFeeName(name)) : "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * The name a published fee shows: the verified name with a cut-off parenthesis or a doubled
 * word repaired (`repairNameShape`). Knox and Darwin keep the name as read, since its words
 * are the category evidence; the repair applies only when the category guard still accepts
 * the shorter name.
 */
/**
 * A dot leader run or a price glued onto the name ("ATM Balance Inquiry (at non-Wildfire ATM)
 * .........", "Courtesy Pay (Paid Overdraft) Fee…..….$35.005 | 3x10"): the name ends where they
 * start, when what is left still names something. A price inside an open parenthesis is the
 * name's own threshold ("Service charge (daily balance falls below $500)") and stays: cutting
 * it published "(daily balance falls below" on 2026-10-09.
 */
const LEADER_OR_PRICE = /(?:[.…]\s*){2,}|\s+\$\s?\d/g;
function insideParenthesis(text: string): boolean {
  return (text.match(/\(/g)?.length ?? 0) > (text.match(/\)/g)?.length ?? 0);
}
export function nameBeforeLeaders(name: string): string {
  const stop = [...name.matchAll(LEADER_OR_PRICE)].find(
    (match) => !match[0].includes("$") || !insideParenthesis(name.slice(0, match.index)),
  );
  const cut = name.slice(0, stop?.index ?? name.length).replace(/[\s:;,.\-–—|]+$/u, "").trim();
  return cut.length >= 3 && /[a-z]/i.test(cut) ? cut : name.trim();
}

/** A dollar price inside a name; a third decimal is a footnote mark printed onto it ("$35.005"). */
/**
 * Why a verified row is held at publish for its name, or null: a name rule the eval takes live
 * fees down for (`ruleFor`: a waiver or no-fee sentence, a rebate, a merchant's fee, two fees on
 * one line), or a price printed inside the name that is not the row's amount ("Courtesy Pay
 * (Paid Overdraft) Fee…$35.005" stored at $50.00, the next column's rent). UAT found both among
 * the rows the guard re-queue step passed on 2026-10-09. The row is retired with
 * `publish_hold:<code>`; no row is deleted.
 */
const ADDON_PRICE_NAME = /(?:\bplus|\band|\+)\s*[(\s]*$/i;
export function publishNameHold(name: string, canonicalKey: string, amount: number | null): { code: string; reason: string } | null {
  const rule = ruleFor(canonicalKey, name, amount);
  // The price-in-name rule keeps its own hold code (PR 797); the eval check is its live-row twin.
  if (rule === "price_in_name") return { code: rule, reason: `Price in name ($${priceInName(name)?.toFixed(2)}) is not the amount ($${amount?.toFixed(2)})` };
  if (rule) return { code: `name_rule:${rule}`, reason: `Name rule (${rule}): ${RULE_WHY[rule]}` };
  // "Research Fee (plus" at $1: the price after "plus" is added to the fee's own price ($50 per
  // hour on that line), so the amount is not the fee.
  if (ADDON_PRICE_NAME.test(name.trim())) return { code: "price_is_addon", reason: "Name ends in \"plus\": the amount is an add-on to the fee's price, not the fee" };
  // A name cut from a sentence or a table that Knox's repair cannot turn into a fee's name
  // ("GUASFCU charges a") is not published as it is.
  if (isCutoffName(name) && !retidiedFeeName(name, canonicalKey)) {
    return { code: "cutoff_name", reason: "Name is cut from a sentence or a table and has no repaired form" };
  }
  // A name that would show only a condition ("(balance falls below $1,000)", cut from "(balance
  // falls below $1,000) $15.00 Copy of Check $3.00"): the fee it belongs to is on another cell,
  // so neither the name nor the category can be trusted (106318, live 9 Oct).
  if (CONDITION_ONLY_NAME.test(publishedFeeName(name, canonicalKey))) {
    return { code: "condition_only_name", reason: "Name is only a parenthetical condition; the fee it belongs to is in another cell" };
  }
  return null;
}

const CONDITION_ONLY_NAME = /^\s*\([^()]*\)\s*$/;
/** Another line's parenthetical cell glued to the front of the name: "(Fee depends on style of check selected): Rental Late Fee". */
const LEADING_PARENTHETICAL_CELL = /^\s*\([^()]*\)\s*:\s*(?=[A-Z])/;
/** A footnote number after a box size's inch mark: "3x10” 8" is box 3x10, footnote 8. */
const BOX_FOOTNOTE = /^(\s*\d+(?:\.\d+)?\s*[xX\u00d7]\s*\d+(?:\.\d+)?\s*["\u201d\u2033])\s*\d{1,2}\s*$/;

/**
 * The name with a neighbouring line's leading parenthetical cell or a box size's footnote number
 * taken off, when what is left still passes the category guard; otherwise the name. Pure.
 */
export function withoutNeighbourCell(name: string, canonicalKey: string): string {
  const box = name.match(BOX_FOOTNOTE);
  if (box) return box[1].trim();
  if (!LEADING_PARENTHETICAL_CELL.test(name)) return name;
  const rest = name.replace(LEADING_PARENTHETICAL_CELL, "").trim();
  return rest && checkFeeCategory(canonicalKey, rest).ok ? rest : name;
}

export function publishedFeeName(name: string, canonicalKey: string): string {
  const current = withoutNeighbourCell(nameBeforeLeaders(name), canonicalKey);
  // A name the guard rejects only because a neighbouring cell or dot leaders ran into it ("per
  // order | Returned Items", "Return Item . . . .") publishes under Knox's re-tidied name when
  // that name passes the guard (Darwin's returned-check refile, Oct 9).
  // A name cut from a sentence or a table ("paper statement fee is waived if enrolled in
  // eStatements") publishes under Knox's repaired name too (retidy v6), so the shape never goes
  // live to be tidied later.
  if (!checkFeeCategory(canonicalKey, current).ok || isCutoffName(current)) {
    const retidied = retidiedFeeName(current, canonicalKey);
    if (retidied && checkFeeCategory(canonicalKey, retidied).ok) return retidied;
  }
  // Reads Knox made before the footnote strip (PR 545) still carry "Fee1"; publish drops it too.
  const repaired = repairNameShape(stripFootnoteMarks(current));
  if (!repaired || repaired === current) return current;
  if (checkFeeCategory(canonicalKey, current).ok && !checkFeeCategory(canonicalKey, repaired).ok) return current;
  return repaired;
}

function documentTime(value: string | Date | null | undefined): number | null {
  if (value == null) return null;
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : null;
}

export type PriorFeeDecision =
  | { kind: "new" }
  | { kind: "identical"; prior: PriorPublishedFeeRow }
  | { kind: "older_document"; prior: PriorPublishedFeeRow }
  | { kind: "additional_line" }
  | { kind: "supersede"; prior: PriorPublishedFeeRow };

/**
 * How a verified row relates to the fee's live rows. A price change is recorded only
 * when it really happened: the same fee line (same name) at a new amount in a newer
 * document. One schedule can list several prices for one fee key (a $28 and a $15 stop
 * payment for different channels), and a bank can publish several schedules; those are
 * separate lines, published side by side. A row from an older document than a live
 * line is stale and never replaces it.
 *
 * Only documents of the same stream are compared by age: the main fee link with its own
 * earlier copies, a companion page (one account's page) with its own. Freedom Checking's
 * monthly fee never replaces or outdates Value Checking's; each is its own line.
 *
 * Nor does one page replace another (coordinator, 8 Oct): a newer read of a bank's
 * consumer schedule took its business schedule's prices off the live catalog (Tidemark
 * FCU cashier's check $8 vs $5, Opportunity Bank international wire $75 vs $100). Only a
 * newer copy of the same page (`feePageKey`) replaces or outdates a line.
 */
export function decidePriorFee(
  row: VerifiedFeeRow,
  live: PriorPublishedFeeRow[],
  apart: (prior: PriorPublishedFeeRow) => boolean = () => false,
): PriorFeeDecision {
  if (live.length === 0) return { kind: "new" };
  // A rate and a dollar amount are different values: "1%" is never identical to "$1.00".
  // A live line at the same price that is another line of the page (\`apart\`) is not this fee.
  const value = feeValue(row);
  const identical = live.find((prior) => feeValue(prior) === value && !apart(prior));
  if (identical) return { kind: "identical", prior: identical };
  const rowTime = documentTime(row.document_crawled_at);
  const stream = documentStream(row.document_stream);
  const fromOtherDocuments = live.filter(
    (prior) =>
      !sameDocument(prior.source_document_id, row.source_document_id) &&
      documentStream(prior.document_stream) === stream &&
      samePage(row, prior),
  );
  if (rowTime == null) return { kind: "additional_line" };
  const newer = fromOtherDocuments.find((prior) => {
    const priorTime = documentTime(prior.document_crawled_at);
    return priorTime != null && priorTime > rowTime;
  });
  if (newer) return { kind: "older_document", prior: newer };
  const name = normalizedFeeName(row.fee_name);
  const prior = fromOtherDocuments.find((candidate) => {
    const priorTime = documentTime(candidate.document_crawled_at);
    return priorTime != null && priorTime < rowTime && normalizedFeeName(candidate.fee_name) === name;
  });
  // A rate never replaces a dollar amount, or the reverse; each stays its own line.
  return prior && isPercentFee(prior) === isPercentFee(row) ? { kind: "supersede", prior } : { kind: "additional_line" };
}

/** Words that say nothing about which fee a line is ("Fee", "per item", "monthly service charge"). */
const FILLER_WORDS = new Set([
  "a", "an", "and", "at", "be", "charge", "charges", "each", "fee", "fees", "for", "in", "is", "item", "items",
  "month", "monthly", "of", "on", "or", "per", "s", "service", "the", "to", "up", "will", "with", "your", "amp",
]);

/** One form per word, so "Check Copies" and "Check Copy", "Legal Process" and "Legal Processing" match. */
function stem(word: string): string {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 5 && word.endsWith("ing")) return word.slice(0, -3);
  if (word.length > 3 && word.endsWith("s") && !word.endsWith("ss")) return word.slice(0, -1);
  return word;
}

/**
 * The same-line check's version on each publish attempt (\`detail.same_line_check\`). An identical
 * skip decided before a version is decided again by it: every row before check 1, box-size
 * rows ("3 x 5") before check 2, whose names check 1 read as the same line, and balance-named
 * rows skipped as an older document before check 3.
 */
const SAME_LINE_CHECK_VERSION = 3;
const OLDER_DOCUMENT_REASON_TEXT = "Older document than the live price";
const SAME_LINE_RESELECT_SQL = `(pa.detail->>'same_line_check' IS NULL
                OR (pa.detail->>'same_line_check' = '1' AND fv.fee_name ~ '\\d\\s*[xX\u00d7]\\s*\\d'))`;

/** A balance a fee applies below ("Money Market Savings Account (below $2,500)"). */
const BALANCE_THRESHOLD = /\b(?:below|under|less than)\s*\$\s?(\d[\d,]*(?:\.\d{2})?)/i;
const BALANCE_THRESHOLD_SQL = `'(below|under|less than)\\s*\\$\\s?[0-9]'`;
/**
 * An identical skip decided by check 1 or before against a live line that names a balance is
 * decided again by check 2, which reads the balance (SCCU's Interest Checking $15 low balance fee
 * sat behind its Money Market "below $2,500" $15 line, 9 Oct).
 */
const THRESHOLD_RESELECT_SQL = `(COALESCE((pa.detail->>'same_line_check')::int, 0) < 2 AND EXISTS (
                  SELECT 1 FROM published_fee_records th_prev
                   WHERE th_prev.fee_published_id = NULLIF(pa.detail->>'previous_fee_published_id', '')::bigint
                     AND th_prev.rolled_back_at IS NULL
                     AND th_prev.fee_name ~* ${BALANCE_THRESHOLD_SQL}
                ))`;

/** A balance-named row skipped as an older document before check 3 is decided again (`newerCopyPrintsLine`). */
const OLDER_DOCUMENT_RESELECT_SQL = `(COALESCE((pa.detail->>'same_line_check')::int, 0) < 3
                AND pa.detail->>'reason' = '${OLDER_DOCUMENT_REASON_TEXT}'
                AND fv.fee_name ~* ${BALANCE_THRESHOLD_SQL})`;

export function balanceThreshold(name: string | null | undefined): number | null {
  const match = (name ?? "").match(BALANCE_THRESHOLD);
  return match ? Number(match[1].replace(/,/g, "")) : null;
}

/** Does the page print this balance anywhere ("$2,500", "2500.00")? */
function pagePrintsAmount(text: string, amount: number): boolean {
  const plain = text.replace(/(\d),(\d{3})/g, "$1$2");
  const whole = Number.isInteger(amount) ? `${amount}(?:\\.00)?` : amount.toFixed(2).replace(".", "\\.");
  return new RegExp(`(?<![\\d.])${whole}(?![\\d])`).test(plain);
}

/**
 * Pure: a live line at the same price that names a balance is another fee when this row names a
 * different balance ("below $7,500" beside "below $1,000"), or, from another document, when this
 * row's page never prints that balance.
 */
export function otherBalanceLine(row: VerifiedFeeRow, prior: PriorPublishedFeeRow, rowText: string | null): boolean {
  const priorBalance = balanceThreshold(prior.fee_name);
  if (priorBalance == null) return false;
  const rowBalance = balanceThreshold(row.fee_name);
  if (rowBalance != null) return rowBalance !== priorBalance;
  if (sameDocument(prior.source_document_id, row.source_document_id) || !rowText) return false;
  return !pagePrintsAmount(rowText, priorBalance);
}

/**
 * Pure: the newer copy of the page still prints this balance-named line, its balance followed by
 * its price ("Minimum Balance Fee (if Balance is Below $7,500): $15"). A newer copy's live line at
 * another balance then does not make this row stale: OnTap's $7,500 line (verified 56431, March
 * copy) sat behind the October copy's $2,500 and $1,000 lines though October prints it too.
 */
export function newerCopyPrintsLine(row: Pick<VerifiedFeeRow, "fee_name" | "amount">, newerText: string | null): boolean {
  const balance = balanceThreshold(row.fee_name);
  const amount = Number(row.amount);
  if (balance == null || !newerText || !Number.isFinite(amount) || amount <= 0) return false;
  const plain = newerText.replace(/(\d),(\d{3})/g, "$1$2");
  const money = (value: number) => (Number.isInteger(value) ? `${value}(?:\\.00)?` : value.toFixed(2).replace(".", "\\."));
  return new RegExp(`(?:below|under|less than)\\s*\\$\\s?${money(balance)}(?![\\d])[^$]{0,60}\\$\\s?${money(amount)}(?![\\d])`, "i").test(plain);
}

/** A box or size ("3 x 5", "2.5x10"): one word, so "3 x 5" and "2 x 10" are two lines (CBB, 9 Oct). */
const BOX_SIZE = /(\d+(?:\.\d+)?)\s*[x\u00d7]\s*(\d+(?:\.\d+)?)/gi;

/** The box sizes a name gives, smaller side first ("3 x 5" and "5x3" are one box). */
function boxSizes(name: string | null | undefined): Set<string> {
  return new Set(
    [...(name ?? "").matchAll(BOX_SIZE)].map((match) => [Number(match[1]), Number(match[2])].sort((a, b) => a - b).join("x")),
  );
}

function significantWords(name: string | null | undefined): Set<string> {
  return new Set(
    (name ?? "").toLowerCase()
      .replace(BOX_SIZE, (_, a: string, b: string) => ` ${a.replace(".", "p")}x${b.replace(".", "p")} `)
      .replace(/[^a-z0-9]+/g, " ").trim()
      .split(" ")
      .filter((word) => word && !/^\d+$/.test(word) && !FILLER_WORDS.has(word))
      .map(stem),
  );
}

/** A name read from page text or a page header: it says nothing about which line it is. */
const SENTENCE_WORD = /^(?:the|there|is|are|may|you|our|we|this|that|if)$/;
const MAX_LINE_WORDS = 10;
export function unclearName(name: string | null | undefined): boolean {
  const text = (name ?? "").replace(/[\u200b\ufeff]/g, "").trim();
  // A name starting lower-case is the rest of a line ("per mailed statement"), not its start;
  // a box size ("3 x 5") is a line's start. A name ending on "a" or "of" is a cut-off sentence
  // ("GUASFCU charges a", the $1 check copy line read again).
  if (!/^(?:[A-Z]|\d+(?:\.\d+)?\s*[xX\u00d7]\s*\d)/.test(text) || /www\.|https?:|\d{3}-\d{3,4}/i.test(text)) return true;
  if (/\b(?:a|an|of|the)$/i.test(text)) return true;
  return text.toLowerCase().split(/[^a-z]+/).filter((word) => SENTENCE_WORD.test(word)).length >= 2;
}

/**
 * Two lines' words, each without a parenthetical aside ("(Only applies to members who ...)")
 * when the rest of both names still says something.
 */
function linePair(a: string | null | undefined, b: string | null | undefined): [Set<string>, Set<string>] {
  const outside = (name: string | null | undefined) => significantWords((name ?? "").replace(/\([^)]*\)/g, " "));
  const [aOut, bOut] = [outside(a), outside(b)];
  return aOut.size > 0 && bOut.size > 0 ? [aOut, bOut] : [significantWords(a), significantWords(b)];
}

/** One name's words all appear in the other's ("Outgoing Wire Fee" in "Wire Transfers - Outgoing: Outgoing Wire Fee"). */
export function namesShareReading(a: string | null | undefined, b: string | null | undefined): boolean {
  const [aWords, bWords] = linePair(a, b);
  // A name of filler alone ("Service Charge") reads as any line.
  const within = (x: Set<string>, y: Set<string>) => [...x].every((word) => y.has(word));
  return within(aWords, bWords) || within(bWords, aWords);
}

/**
 * Two lines of one document at the same price whose names share no reading of each other
 * ("ATM Balance Inquiry (at non-Wildfire ATM)" and "ATM Adjustment", both $5 at Wildfire,
 * 9 Oct): neither name's words all appear in the other's. Two reads of one line differ by
 * filler or a carried-in heading ("Stop payment" / "Stop Payment of Checks and ACHs") and
 * stay identical. Across documents the same fee is often named differently, so only one
 * document's lines are told apart this way.
 */
export function separateLines(row: VerifiedFeeRow, prior: PriorPublishedFeeRow): boolean {
  if (!sameDocument(prior.source_document_id, row.source_document_id)) return false;
  if (unclearName(row.fee_name) || unclearName(prior.fee_name)) return false;
  const [rowWords, priorWords] = linePair(row.fee_name, prior.fee_name);
  if (rowWords.size > MAX_LINE_WORDS || priorWords.size > MAX_LINE_WORDS) return false;
  const within = (a: Set<string>, b: Set<string>) => [...a].every((word) => b.has(word));
  return !within(rowWords, priorWords) && !within(priorWords, rowWords);
}

/** Text as words: lower case, every run of other characters one space, padded with spaces. */
function pageWords(text: string): string {
  return ` ${text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim()} `;
}

/**
 * Pure: does the page print both names as their own lines at this price? Each name must be found
 * in the page's words, the two places must not overlap, and the price must follow each within six
 * words, with no "of" between ("A nonsufficient funds (NSF) charge of $25.00" is a sentence about
 * the table line, not a second line). A name not on the current copy, or inside the other line
 * ("Inactive Checking" in "Inactive Checking3"), is a read of the same line.
 * Every place a name is printed counts ("5 x 10" also sits inside "2.5 x 10"), a footnote mark
 * glued to a name's last word is the name ("Premium overdraft fee2"), and the words before the
 * price may be another column's price ("5 x 10 | $150.00 per year | $110.00 per year"). A box of
 * another size that the page does not print needs only the row's own line.
 */
export function linesApartOnPage(text: string, rowName: string, priorName: string, amount: number | string | null): boolean {
  const value = amount == null ? NaN : Number(amount);
  if (!Number.isFinite(value) || value < 0) return false;
  const cents = Math.round(value * 100);
  const whole = Math.floor(cents / 100);
  const price = cents % 100 === 0 ? `${whole}(?: 00)?` : `${whole} ${String(cents % 100).padStart(2, "0")}`;
  const follows = new RegExp(`^ (?:(?!of )[a-z0-9]+ ){0,6}${price} `);
  const page = pageWords(text);
  const printed = (name: string) => {
    const words = pageWords(name).trim();
    if (!words) return [];
    const mark = /[a-z]$/.test(words) ? "(?:\\d{1,2})?" : "";
    const pattern = new RegExp(`(?<= )${escapeRegExp(words)}${mark}(?= )`, "g");
    return [...page.matchAll(pattern)].map((match) => {
      const start = (match.index ?? 0) - 1;
      return { start, end: start + match[0].length + 1 };
    });
  };
  const places = (name: string) => printed(name).filter((place) => follows.test(page.slice(place.end)));
  const a = places(rowName);
  // A box of another size that this copy does not print at all is another line (CBB's 3 x 5 at
  // $45 beside a misread "SAFE DEPOSIT BOX: 2.5 x 10" at $45, 9 Oct). One printed without this
  // price is a price-first table ("$25.00 Safe Deposit Box 3x5"), where the price after a name
  // is the next line's, so it stays the same line.
  const rowSizes = boxSizes(rowName);
  const priorSizes = boxSizes(priorName);
  if (rowSizes.size > 0 && priorSizes.size > 0 && ![...rowSizes].some((size) => priorSizes.has(size)) && printed(priorName).length === 0) {
    return a.length > 0;
  }
  const b = places(priorName);
  return a.some((one) => b.some((two) => one.end <= two.start || two.end <= one.start));
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** The current read of a document (\`agent_source_texts\`), for the same-line check. */
async function selectDocumentText(db: SqlTag, documentId: number | string | null | undefined): Promise<string | null> {
  if (documentId == null) return null;
  try {
    const [row] = await inSavepoint(db, (scope) => scope<{ normalized_text: string | null }[]>`
      SELECT normalized_text FROM agent_source_texts
       WHERE source_document_id = ${Number(documentId)} AND normalized_text IS NOT NULL
       ORDER BY id DESC
       LIMIT 1
    `);
    return row?.normalized_text ?? null;
  } catch (error) {
    console.error("selectDocumentText failed:", error);
    return null;
  }
}

/**
 * The live rows that are another line of this row's page at the same price: names that share no
 * reading (\`separateLines\`) printed apart on the page, each with the price (\`linesApartOnPage\`).
 * Source spot checks of 20 such rows, 9 Oct: words alone 13, 10 and 14 of 20; with the page check
 * see docs/project/findings/2026-10-09-identical-skip-ignored-name.md.
 */
async function linesApartFrom(db: SqlTag, row: VerifiedFeeRow, live: PriorPublishedFeeRow[]): Promise<Set<PriorPublishedFeeRow>> {
  if (isPercentFee(row)) return new Set();
  const value = feeValue(row);
  const sameValue = live.filter((prior) => feeValue(prior) === value);
  const candidates = sameValue.filter((prior) => separateLines(row, prior));
  const balanced = sameValue.filter((prior) => balanceThreshold(prior.fee_name) != null);
  if (candidates.length === 0 && balanced.length === 0) return new Set();
  const text = await selectDocumentText(db, row.source_document_id);
  const apart = new Set(balanced.filter((prior) => otherBalanceLine(row, prior, text)));
  if (!text) return apart;
  for (const prior of candidates) {
    if (linesApartOnPage(text, row.fee_name ?? "", prior.fee_name ?? "", row.amount)) apart.add(prior);
  }
  return apart;
}

/**
 * The older live line a live fee repeats, if any: a same-valued line of its category (any
 * frequency or variant) published before it that the same-line check does not set apart.
 * Used to find the duplicates the same-line re-decide published on 9 Oct (same-line-duplicates.ts).
 */
export async function sameLineDuplicateOf(db: SqlTag, row: VerifiedFeeRow, feePublishedId: number): Promise<number | null> {
  const value = feeValue(row);
  const older = (await selectLivePublishedFees(db, row, { anyVariant: true })).filter(
    (prior) => Number(prior.fee_published_id) < feePublishedId && feeValue(prior) === value,
  );
  if (older.length === 0) return null;
  const apart = await linesApartFrom(db, row, older);
  // A line of another document repeats this one only when one name reads as the other: the
  // re-decide's duplicates were renamed reads of one line, and "Return Mail/ Bad Address" is not
  // another document's "Excessive Transaction Fee" (both $10, 9 Oct).
  const repeated = older.find(
    (prior) => !apart.has(prior) && (sameDocument(prior.source_document_id, row.source_document_id) || namesShareReading(row.fee_name, prior.fee_name)),
  );
  return repeated ? Number(repeated.fee_published_id) : null;
}

/** A fee's comparable value: its rate for a percentage fee, else its amount. */
export function feeValue(row: RateFields & { amount: number | string | null }): string {
  return isPercentFee(row) ? `rate:${ratePercentOf(row)}` : `amount:${normalizedAmount(row.amount)}`;
}

export interface ListedFeeLine {
  source_document_id: number | string | null;
  fee_name: string | null;
  amount: number | string | null;
}

/** Every line Knox read from these documents, for the same-name price check below. */
export async function selectListedFeeLines(db: SqlTag, documentIds: Array<number | string | null | undefined>): Promise<ListedFeeLine[]> {
  const ids = documentIds.filter((id) => id != null).map(Number);
  if (ids.length === 0) return [];
  try {
    return await inSavepoint(db, (scope) => scope<ListedFeeLine[]>`
      SELECT source_document_id, fee_name, amount
        FROM raw_fee_observations
       WHERE source_document_id = ANY(${ids}::bigint[])
    `);
  } catch (error) {
    console.error("selectListedFeeLines failed:", error);
    return [];
  }
}

/**
 * Pure: does either document list this fee name at both prices? A page that prints one
 * fee name twice ("Returned Deposit Fee $10" and "Returned Deposit Fee $3" for two
 * accounts) has two lines, not a price change, whichever document is newer.
 */
export type ListedPrice = RateFields & Pick<VerifiedFeeRow, "fee_name" | "amount" | "source_document_id">;

export function listsBothPrices(lines: ListedFeeLine[], row: ListedPrice, prior: ListedPrice): boolean {
  // Knox's listed lines carry no rate here, so two rates are never read as two lines.
  if (isPercentFee(row) || isPercentFee(prior)) return false;
  const name = normalizedFeeName(row.fee_name);
  const listed = (documentId: number | string | null | undefined, amount: number | string | null) =>
    lines.some(
      (line) =>
        sameDocument(line.source_document_id, documentId) &&
        normalizedFeeName(line.fee_name) === name &&
        normalizedAmount(line.amount) === normalizedAmount(amount),
    );
  return listed(row.source_document_id, prior.amount) || listed(prior.source_document_id, row.amount);
}

/**
 * Close the prior live row for this fee after a new amount is published, so the
 * catalog holds one current price per fee, and record the change in
 * fee_change_records. The closed row stays in published_fee_records as history.
 */
async function supersedePriorFee(
  db: SqlTag,
  options: {
    batchId: string;
    row: VerifiedFeeRow;
    prior: PriorPublishedFeeRow;
    feePublishedId: number;
  },
): Promise<{ superseded: boolean; changeRecorded: boolean }> {
  const priorId = Number(options.prior.fee_published_id);
  const previousAmount = normalizedAmount(options.prior.amount);
  const newAmount = normalizedAmount(options.row.amount);
  const closed = await db`
    UPDATE published_fee_records
       SET rolled_back_at = NOW(),
           rolled_back_by_batch_id = ${options.batchId},
           rolled_back_reason = ${`superseded by #${options.feePublishedId}`}
     WHERE fee_published_id = ${priorId}
       AND rolled_back_at IS NULL
    RETURNING fee_published_id
  `;
  if (closed.length === 0) return { superseded: false, changeRecorded: false };
  // fee_change_records holds dollar amounts only; a rate change is not written there.
  if (isPercentFee(options.row)) return { superseded: true, changeRecorded: false };

  // Same vocabulary as FeeChangeEvent in data-store/fee-changes.ts.
  const changeType = newAmount != null && previousAmount != null && newAmount < previousAmount ? "decrease" : "increase";
  // The change log is history, not the price itself: if it cannot be written the
  // savepoint keeps the supersede, and the result says the change was not recorded.
  const changeRecorded = await inSavepoint(db, async (scope) => {
    await scope`
      INSERT INTO fee_change_records (
        institution_id,
        fee_category,
        canonical_fee_key,
        previous_amount,
        old_amount,
        new_amount,
        change_type,
        detected_at,
        changed_at,
        previous_fee_published_id,
        new_fee_published_id,
        like_for_like
      )
      VALUES (
        ${Number(options.row.institution_id)},
        ${options.row.canonical_fee_key},
        ${options.row.canonical_fee_key},
        ${previousAmount},
        ${previousAmount},
        ${newAmount},
        ${changeType},
        NOW(),
        NOW(),
        ${priorId},
        ${options.feePublishedId},
        ${likeForLikeAtRecord(options.row, options.prior)}
      )
    `;
    return true;
  }).catch((error) => {
    console.error("recordFeeChange failed:", error);
    return false;
  });
  return { superseded: true, changeRecorded };
}

function institutionLabel(row: Pick<VerifiedFeeRow, "institution_id" | "institution_name">): string {
  return row.institution_name?.trim() || `Institution ${row.institution_id}`;
}

function rowCountLabel(count: number): string {
  return `${count} verified fee row${count === 1 ? "" : "s"}`;
}

function movementFor(
  prior: PriorPublishedFeeRow | null,
  row: VerifiedFeeRow,
): Pick<
  HamiltonPublishResult,
  "previousFeePublishedId" | "previousAmount" | "amountDelta" | "movementDirection"
> {
  const previousFeePublishedId =
    prior?.fee_published_id == null ? null : Number(prior.fee_published_id);
  const previousAmount = normalizedAmount(prior?.amount ?? null);
  const currentAmount = normalizedAmount(row.amount);
  if (
    previousFeePublishedId == null ||
    previousAmount == null ||
    currentAmount == null ||
    Math.abs(currentAmount - previousAmount) < 0.01
  ) {
    return {
      previousFeePublishedId,
      previousAmount,
      amountDelta: null,
      movementDirection: null,
    };
  }
  const amountDelta = Math.round((currentAmount - previousAmount) * 100) / 100;
  return {
    previousFeePublishedId,
    previousAmount,
    amountDelta,
    movementDirection: amountDelta > 0 ? "increase" : "decrease",
  };
}

type MovementGroupEntry = {
  canonical_fee_key: string;
  fee_name: string;
  previous_fee_published_id: number;
  new_fee_published_id: number;
  previous_amount: number;
  new_amount: number;
  amount_delta: number;
  direction: "increase" | "decrease";
};

interface MovementEvidenceRow {
  fee_published_id: number | string;
  fee_name: string | null;
  source_url: string | null;
  document_text: string | null;
}

/** Name, page and current text of each published row, for the movement check below. */
async function selectMovementEvidence(db: SqlTag, feePublishedIds: number[]): Promise<Map<number, MovementEvidenceRow>> {
  if (feePublishedIds.length === 0) return new Map();
  try {
    const rows = await inSavepoint(db, (scope) => scope<MovementEvidenceRow[]>`
      SELECT fp.fee_published_id,
             fp.fee_name,
             fp.source_url,
             (SELECT t.normalized_text
                FROM agent_source_texts t
               WHERE t.source_document_id = fr.source_document_id
                 AND t.status = 'completed'
               ORDER BY t.id DESC
               LIMIT 1) AS document_text
        FROM published_fee_records fp
        LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.fee_published_id = ANY(${feePublishedIds}::bigint[])
    `);
    return new Map(rows.map((row) => [Number(row.fee_published_id), row]));
  } catch (error) {
    console.error("selectMovementEvidence failed:", error);
    return new Map();
  }
}

async function recordPublicationSignals(
  db: SqlTag,
  runId: number,
  batchId: string,
  results: HamiltonPublishResult[],
  rowByVerifiedFeeId: Map<number, VerifiedFeeRow>,
): Promise<void> {
  const grouped = new Map<number, {
    institutionName: string;
    feeVerifiedIds: number[];
    feePublishedIds: number[];
    canonicalFeeKeys: string[];
  }>();
  const movementGroups = new Map<number, {
    institutionName: string;
    movements: MovementGroupEntry[];
  }>();

  results.forEach((result) => {
    if (result.status !== "published" || !result.feePublishedId) return;
    const row = rowByVerifiedFeeId.get(result.feeVerifiedId);
    const institutionId = result.institutionId;
    const group = grouped.get(institutionId) ?? {
      institutionName: row ? institutionLabel(row) : `Institution ${institutionId}`,
      feeVerifiedIds: [],
      feePublishedIds: [],
      canonicalFeeKeys: [],
    };
    group.feeVerifiedIds.push(result.feeVerifiedId);
    group.feePublishedIds.push(result.feePublishedId);
    group.canonicalFeeKeys.push(result.canonicalFeeKey);
    grouped.set(institutionId, group);

    if (
      result.previousFeePublishedId &&
      result.previousAmount != null &&
      result.amountDelta != null &&
      result.movementDirection
    ) {
      const movementGroup = movementGroups.get(institutionId) ?? {
        institutionName: row ? institutionLabel(row) : `Institution ${institutionId}`,
        movements: [],
      };
      movementGroup.movements.push({
        canonical_fee_key: result.canonicalFeeKey,
        fee_name: result.feeName,
        previous_fee_published_id: result.previousFeePublishedId,
        new_fee_published_id: result.feePublishedId,
        previous_amount: result.previousAmount,
        new_amount: result.amount ?? 0,
        amount_delta: result.amountDelta,
        direction: result.movementDirection,
      });
      movementGroups.set(institutionId, movementGroup);
    }
  });

  // A price move alerts watchers only when the bank really changed the fee: the same
  // check the alerts and Monthly Pulse use (confirmFeeChange: same page, same name, the
  // old text states the old price, the new text states the new price and not the old).
  // A re-read of the same edition or a new copy of the page that pairs a fee with a
  // neighbouring price is kept as an unconfirmed movement on the publication signal.
  const unconfirmedMovements = new Map<number, Array<MovementGroupEntry>>();
  const movementIds = Array.from(movementGroups.values()).flatMap((group) =>
    group.movements.flatMap((movement) => [movement.previous_fee_published_id, movement.new_fee_published_id]),
  );
  const evidence = await selectMovementEvidence(db, movementIds);
  for (const [institutionId, group] of movementGroups) {
    const confirmed = group.movements.filter((movement) => {
      const before = evidence.get(movement.previous_fee_published_id);
      const after = evidence.get(movement.new_fee_published_id);
      return confirmFeeChange({
        institution_name: group.institutionName,
        state_code: null,
        charter_type: null,
        fee_key: movement.canonical_fee_key,
        fee_name: after?.fee_name ?? movement.fee_name,
        old_fee_name: before?.fee_name ?? null,
        old_amount: movement.previous_amount,
        new_amount: movement.new_amount,
        changed_at: new Date(),
        source_url: after?.source_url ?? null,
        old_source_url: before?.source_url ?? null,
        new_document_text: after?.document_text ?? null,
        old_document_text: before?.document_text ?? null,
      }) != null;
    });
    const unconfirmed = group.movements.filter((movement) => !confirmed.includes(movement));
    if (unconfirmed.length > 0) unconfirmedMovements.set(institutionId, unconfirmed);
    if (confirmed.length > 0) group.movements = confirmed;
    else movementGroups.delete(institutionId);
  }

  for (const [institutionId, group] of grouped) {
    const count = group.feePublishedIds.length;
    const unconfirmed = unconfirmedMovements.get(institutionId) ?? [];
    await inSavepoint(db, (scope) => recordHamiltonMonitorSignal(
      {
        institutionId,
        signalType: "hamilton_publication_completed",
        // Routine bookkeeping, not a competitive event: never escalates Monitor status.
        severity: "low",
        title: `${group.institutionName} - ${rowCountLabel(count)} published`,
        body:
          `Hamilton published ${rowCountLabel(count)} into the verified fee catalog. ` +
          "Refresh competitive briefs, scenarios, and watchlist analysis for this institution.",
        sourceJson: {
          source: "hamilton_publication",
          run_id: runId,
          batch_id: batchId,
          pipeline_stage: "published_public_ready",
          published_fee_ids: group.feePublishedIds,
          verified_fee_ids: group.feeVerifiedIds,
          canonical_fee_keys: Array.from(new Set(group.canonicalFeeKeys)),
          published_fee_count: count,
          unconfirmed_movement_count: unconfirmed.length,
          unconfirmed_movements: unconfirmed,
          refresh_recommended: ["reports", "scenarios", "watchlist"],
          provider_call_queued: false,
        },
      },
      scope,
    )).catch((error) => {
      console.error("recordHamiltonPublicationSignal failed:", error);
    });
  }

  for (const [institutionId, group] of movementGroups) {
    const count = group.movements.length;
    const increases = group.movements.filter((movement) => movement.direction === "increase").length;
    const severity = increases > 0 ? "high" : "medium";
    await inSavepoint(db, (scope) => recordHamiltonMonitorSignal(
      {
        institutionId,
        signalType: "hamilton_fee_movement_detected",
        severity,
        alertWatchers: true,
        title: `${group.institutionName} - ${count} published fee movement${count === 1 ? "" : "s"} detected`,
        body:
          `Hamilton detected ${count} published fee movement${count === 1 ? "" : "s"} against prior live catalog rows. ` +
          "Refresh competitive briefs, scenarios, and watchlist analysis before using this institution in current recommendations.",
        sourceJson: {
          source: "hamilton_publication",
          run_id: runId,
          batch_id: batchId,
          pipeline_stage: "published_fee_movement",
          movements: group.movements,
          movement_count: count,
          refresh_recommended: ["reports", "scenarios", "watchlist"],
          provider_call_queued: false,
        },
      },
      scope,
    )).catch((error) => {
      console.error("recordHamiltonFeeMovementSignal failed:", error);
    });
  }
}

/**
 * Fraction of the prior amount a fee must move before the guides explaining it are
 * worth re-checking. Token binding keeps the *figures* correct on their own; this
 * catches the surrounding argument going stale — "credit unions charge meaningfully
 * less" can stop being true even while every number on the page is current.
 */
export const GUIDE_STALENESS_MOVEMENT_THRESHOLD = 0.1;

async function flagMovedGuidesStale(
  db: SqlTag,
  runId: number,
  results: HamiltonPublishResult[],
): Promise<void> {
  const moved = new Map<string, number>();
  for (const result of results) {
    if (result.status !== "published") continue;
    const key = result.canonicalFeeKey;
    const previous = result.previousAmount;
    const current = result.amount;
    if (!key || previous === null || current === null || previous === 0) continue;
    const change = Math.abs(current - previous) / Math.abs(previous);
    if (change < GUIDE_STALENESS_MOVEMENT_THRESHOLD) continue;
    moved.set(key, Math.max(moved.get(key) ?? 0, change));
  }
  if (moved.size === 0) return;

  try {
    // A savepoint, so a missing guides table rolls back only this block and not the
    // fee rows this step already wrote in the run transaction.
    await inSavepoint(db, async (scope) => {
      for (const [category, change] of moved) {
        const reason = `Published median moved ${(change * 100).toFixed(0)}% in run ${runId}`;
        const rows = (await scope`
          UPDATE consumer_guides
             SET stale_since = COALESCE(stale_since, NOW()),
                 stale_reason = ${reason},
                 updated_at = NOW()
           WHERE status = 'published'
             AND primary_category = ${category}
             AND stale_since IS NULL
          RETURNING id, slug
        `) as unknown as { id: number; slug: string }[];

        if (rows.length > 0) {
          await scope`
            INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
            VALUES (
              ${runId}, 'guide.flagged_stale', 'completed',
              ${`Flagged ${rows.length} guide(s) for re-check after a ${(change * 100).toFixed(0)}% move in ${category}`},
              ${JSON.stringify({
                fee_category: category,
                movement_fraction: change,
                guides: rows.map((r) => r.slug),
              })}::jsonb
            )
          `;
        }
      }
    });
  } catch {
    // The guides tables may not exist yet in an environment mid-migration. Flagging a
    // guide for review must never fail a publish that has already written fee rows.
  }
}

const OLDER_DOCUMENT_REASON = OLDER_DOCUMENT_REASON_TEXT;
const TWIN_RECHECK_REASON = "Rules re-check: today's rules do not read this fee from its own document";

/**
 * A name that starts mid-sentence or runs across a sentence break ("withdrawals or other means.
 * The NSF fee"). Pure. Used for twins of rules re-check takedowns only; live names are Data
 * inventory's name-noise rules.
 */
export function sentenceFragmentName(name: string): boolean {
  const trimmed = name.trim();
  return /^[a-z]/.test(trimmed) || /[a-z]{2}\.\s+[A-Z]/.test(trimmed);
}

/**
 * Twins of rules re-check takedowns (`twin_recheck`) that today's rules do not read from any
 * completed text of their own document, by verified id. A twin with no document or no text
 * fails too: the check that took its twin down cannot pass it.
 */
async function unreproducedTwins(db: SqlTag, rows: VerifiedFeeRow[]): Promise<Set<number>> {
  const twins = rows.filter((row) => row.twin_recheck);
  const failed = new Set<number>();
  if (twins.length === 0) return failed;
  const documentIds = [...new Set(twins.map((row) => Number(row.source_document_id)).filter((id) => id > 0))];
  const texts = documentIds.length === 0
    ? []
    : await db<Array<{ source_document_id: number | string; normalized_text: string }>>`
        SELECT DISTINCT ON (source_document_id, text_hash) source_document_id, normalized_text
          FROM agent_source_texts
         WHERE source_document_id = ANY(${documentIds}::bigint[])
           AND status = 'completed'
           AND normalized_text IS NOT NULL
         ORDER BY source_document_id, text_hash, id DESC
      `;
  const readsByDocument = new Map<number, Set<string>>();
  for (const text of texts) {
    const id = Number(text.source_document_id);
    const reads = readsByDocument.get(id) ?? new Set<string>();
    for (const key of reproducibleFees(text.normalized_text)) reads.add(key);
    readsByDocument.set(id, reads);
  }
  for (const row of twins) {
    const amount = normalizedAmount(row.amount);
    const reads = readsByDocument.get(Number(row.source_document_id));
    if (amount == null || !reads || !reads.has(feeKey(row.canonical_fee_key, amount))) {
      failed.add(Number(row.fee_verified_id));
    }
  }
  return failed;
}

const NO_MOVEMENT = {
  previousFeePublishedId: null,
  previousAmount: null,
  amountDelta: null,
  movementDirection: null,
} as const;

function attemptOutcome(result: HamiltonPublishResult): AttemptOutcome {
  if (result.status === "published") return "ok";
  return result.reason === "Identical fee already published" ||
    result.reason === "Duplicate published row" ||
    result.reason === OLDER_DOCUMENT_REASON
    ? "unchanged"
    : "rejected";
}

export async function runHamiltonPublish(
  options: RunHamiltonPublishOptions,
): Promise<RunHamiltonPublishResult> {
  const db = options.db ?? sql;
  const limit = boundedLimit(options.limit);
  const minConfidence = boundedConfidence(options.minConfidence);
  const minInstitutionFees = boundedMinInstitutionFees(options.minInstitutionFees);
  const dryRun = Boolean(options.dryRun);
  const learning = !dryRun && (await learningSchemaReady(db));
  const batchId = `agentic-run-${options.runId}`;
  const selected = await selectVerifiedFees(
    db,
    limit,
    learning,
    minConfidence,
    minInstitutionFees,
    options.institutionId,
    options.stateCode,
  );
  // Publish runs only inside state lanes and single-bank reads, so a verified row used to wait
  // for its own state's lane to come round (the 100 re-filed returned-check fees sat across 37
  // states while lanes published 0-44 rows each). A lane whose own queue is short now fills the
  // rest with the oldest eligible rows from any state, as the release review does.
  if (options.stateCode && !options.institutionId && selected.length < limit) {
    const taken = new Set(selected.map((row) => Number(row.fee_verified_id)));
    const others = await selectVerifiedFees(db, limit - selected.length, learning, minConfidence, minInstitutionFees);
    selected.push(...others.filter((row) => !taken.has(Number(row.fee_verified_id))));
  }
  const depthByInstitution = minInstitutionFees > 1
    ? await institutionFeeDepth(
        db,
        Array.from(new Set(selected.map((row) => Number(row.institution_id)))),
        minConfidence,
      )
    : new Map<number, number>();
  // Held rows are left out of results and the attempt log, so they stay selectable
  // and publish on the run where their institution reaches the minimum.
  const held = new Map<number, HeldThinInstitution>();
  const rows = selected.filter((row) => {
    if (minInstitutionFees <= 1) return true;
    const institutionId = Number(row.institution_id);
    const feeCount = depthByInstitution.get(institutionId) ?? 0;
    if (feeCount >= minInstitutionFees) return true;
    const entry = held.get(institutionId) ?? {
      institutionId,
      institutionName: institutionLabel(row),
      feeCount,
      heldRows: 0,
    };
    entry.heldRows += 1;
    held.set(institutionId, entry);
    return false;
  });
  const rowByVerifiedFeeId = new Map(rows.map((row) => [Number(row.fee_verified_id), row]));
  const results: HamiltonPublishResult[] = [];
  const twinUnreproduced = await unreproducedTwins(db, rows);

  for (const row of rows) {
    const base = {
      feeVerifiedId: Number(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      feeName: row.fee_name,
      amount: normalizedAmount(row.amount),
      canonicalFeeKey: row.canonical_fee_key,
      supersededFeePublishedId: null,
      changeRecorded: false,
    };
    let result: HamiltonPublishResult;
    // A row whose name contradicts its category (verified before Darwin had the guard)
    // is retired instead of published.
    const category = checkFeeCategory(row.canonical_fee_key, publishedFeeName(row.fee_name, row.canonical_fee_key), { amount: row.amount });
    if (!category.ok && !dryRun) {
      await rejectVerifiedFeeForCategory(db, Number(row.fee_verified_id), category.code);
    }
    // A name that is not a fee's, or that carries another price, is held before it is live.
    const nameHold = category.ok ? publishNameHold(row.fee_name, row.canonical_fee_key, base.amount) : null;
    if (nameHold && !dryRun) {
      await rejectVerifiedFee(db, Number(row.fee_verified_id), publishHoldFlag(nameHold.code));
    }
    // A twin of a rules re-check takedown publishes only if today's rules read it from its own
    // document, the same test that took its twin down.
    // Its name must read as a fee line too: a twin was often read by an older reader, and
    // "withdrawals or other means. The NSF fee" (101941) went live on Oct 9.
    const twinFails = category.ok && !nameHold && (
      twinUnreproduced.has(Number(row.fee_verified_id)) ||
      (Boolean(row.twin_recheck) && sentenceFragmentName(publishedFeeName(row.fee_name, row.canonical_fee_key)))
    );
    if (twinFails && !dryRun) {
      await rejectVerifiedFee(db, Number(row.fee_verified_id), RULES_RECHECK_REASON);
    }
    const skipReason = category.ok
      ? (nameHold?.reason ?? (twinFails ? TWIN_RECHECK_REASON : publishSkipReason(row, minConfidence)))
      : `Category guard (${category.code}): ${category.reason}`;
    // Dry runs read the prior live row too, so they report the same skips, movements
    // and supersedes a real run would.
    let decision: PriorFeeDecision | null = null;
    if (!skipReason) {
      const live = await selectLivePublishedFees(db, row);
      const apart = await linesApartFrom(db, row, live);
      decision = decidePriorFee(row, live, (prior) => apart.has(prior));
      // A row decided once more after the same-line check may since have had its frequency or
      // variant re-read ("per_item" to none), so the live line it was identical to no longer
      // matches the key above and it went live as a new fee beside it (104684 "Wire Transfers -
      // Outgoing: Outgoing Wire Fee" beside 23698 "Outgoing Wire Fee", 9 Oct). Its identical
      // check reads every live line of the category.
      if (row.same_line_reselect && decision.kind !== "identical") {
        const wide = await selectLivePublishedFees(db, row, { anyVariant: true });
        const wideApart = await linesApartFrom(db, row, wide);
        const wideDecision = decidePriorFee(row, wide, (prior) => wideApart.has(prior));
        if (wideDecision.kind === "identical") decision = wideDecision;
      }
    }
    if (decision?.kind === "older_document" && newerCopyPrintsLine(row, await selectDocumentText(db, decision.prior.source_document_id))) {
      decision = { kind: "additional_line" };
    }
    if (
      decision?.kind === "supersede" &&
      listsBothPrices(await selectListedFeeLines(db, [row.source_document_id, decision.prior.source_document_id]), row, decision.prior)
    ) {
      decision = { kind: "additional_line" };
    }
    const priorPublishedFee = decision?.kind === "supersede" ? decision.prior : null;
    if (skipReason) {
      result = { ...base, status: "skipped", reason: skipReason, feePublishedId: null, ...NO_MOVEMENT };
    } else if (decision?.kind === "identical") {
      // Content-level dedupe: re-verification mints a new fee_verified_id, so the
      // lineage guard alone lets identical fee lines pile up in the catalog.
      result = {
        ...base,
        status: "skipped",
        reason: "Identical fee already published",
        feePublishedId: null,
        ...NO_MOVEMENT,
        previousFeePublishedId: Number(decision.prior.fee_published_id),
        previousAmount: normalizedAmount(decision.prior.amount),
      };
    } else if (decision?.kind === "older_document") {
      result = {
        ...base,
        status: "skipped",
        reason: OLDER_DOCUMENT_REASON,
        feePublishedId: null,
        ...NO_MOVEMENT,
      };
    } else if (dryRun) {
      result = {
        ...base,
        status: "published",
        reason: null,
        feePublishedId: null,
        ...movementFor(priorPublishedFee, row),
        supersededFeePublishedId:
          priorPublishedFee?.fee_published_id == null ? null : Number(priorPublishedFee.fee_published_id),
      };
    } else {
      // Insert and supersede succeed or fail together: never two live prices for one
      // fee, and never a closed row without its replacement.
      const written = await inSavepoint(db, async (scope) => {
        const feePublishedId = await insertPublishedFee(scope, { runId: options.runId, batchId, row });
        if (!feePublishedId || !priorPublishedFee) {
          return { feePublishedId, superseded: false, changeRecorded: false };
        }
        const supersede = await supersedePriorFee(scope, {
          batchId,
          row,
          prior: priorPublishedFee,
          feePublishedId,
        });
        return { feePublishedId, ...supersede };
      });
      const { feePublishedId } = written;
      result = {
        ...base,
        status: feePublishedId ? "published" : "skipped",
        reason: feePublishedId ? null : "Duplicate published row",
        feePublishedId,
        ...(feePublishedId ? movementFor(priorPublishedFee, row) : NO_MOVEMENT),
        supersededFeePublishedId:
          written.superseded && priorPublishedFee ? Number(priorPublishedFee.fee_published_id) : null,
        changeRecorded: written.changeRecorded,
      };
    }
    results.push(result);

    if (learning) {
      await recordAttempt(db, {
        institutionId: result.institutionId,
        stage: "publish",
        strategy: HAMILTON_PUBLISH_STRATEGY.strategy,
        version: HAMILTON_PUBLISH_STRATEGY.version,
        fingerprint: verifiedFeeFingerprint(result.feeVerifiedId),
        outcome: attemptOutcome(result),
        yieldCount: result.status === "published" ? 1 : 0,
        costMicrousd: 0,
        runId: options.runId,
        stepId: options.stepId ?? null,
        detail: {
          fee_verified_id: result.feeVerifiedId,
          fee_published_id: result.feePublishedId,
          canonical_fee_key: result.canonicalFeeKey,
          amount: result.amount,
          reason: result.reason,
          previous_fee_published_id: result.previousFeePublishedId,
          superseded_fee_published_id: result.supersededFeePublishedId,
          change_recorded: result.changeRecorded,
          same_line_check: SAME_LINE_CHECK_VERSION,
        },
      });
    }
  }

  if (!dryRun) {
    await recordPublicationSignals(db, options.runId, batchId, results, rowByVerifiedFeeId);

    // Public benchmark reads are cached between publishes. Drop the cache so readers
    // see the rows this run just published. Never allowed to fail a publish.
    if (results.some((result) => result.status === "published")) {
      invalidateFeeSummaryCache();
      await flagMovedGuidesStale(db, options.runId, results);
    }
  }

  const published = results.filter((result) => result.status === "published");
  const heldInstitutions = Array.from(held.values());
  return {
    selectedVerifiedFees: selected.length,
    processedVerifiedFees: results.length,
    publishedFees: published.length,
    skippedFees: results.length - published.length,
    supersededFees: results.filter((result) => result.supersededFeePublishedId != null).length,
    zeroFeesPublished: published.filter((result) => result.amount === 0).length,
    learning,
    outcomes: learning ? countOutcomes(results.map(attemptOutcome)) : {},
    limit,
    minConfidence,
    minInstitutionFees,
    heldFees: heldInstitutions.reduce((sum, entry) => sum + entry.heldRows, 0),
    heldInstitutions,
    dryRun,
    batchId,
    results,
  };
}
