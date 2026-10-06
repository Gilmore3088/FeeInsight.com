import { createHash } from "crypto";

import { sql } from "@/lib/data-store/connection";
import { learningSchemaReady, recordAttempt } from "@/lib/agents/learning/attempts";
import { countOutcomes, type AttemptOutcome } from "@/lib/agents/learning/outcomes";
import { normalizeStateCode } from "@/lib/agents/state-lane-memory";
import { WHOLE_DOCUMENT_BATCH } from "@/lib/agents/document-batch";
import { CATEGORY_GUARD_VERSION, checkFeeCategory, refileCategory } from "@/lib/fee-category-guard";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { CANONICAL_KEY_MAP } from "@/lib/fee-taxonomy";
import { recordHamiltonMonitorSignal } from "@/lib/hamilton/monitor-signals";
import { inSavepoint } from "@/lib/agents/savepoint";
import { institutionTier } from "@/lib/agents/state-expert/memory";

import {
  amountEnvelopeFor,
  isExplicitZeroFee,
  withinAmountEnvelope,
  ZERO_FEE_RAW_FLAG,
  ZERO_FEE_VERIFIED_FLAG,
} from "./envelopes";
import {
  DARWIN_PEER_STRATEGY,
  DARWIN_SECOND_SOURCE_STRATEGY,
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
  | "duplicate_verified";

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
};

function decisionFor(code: DarwinReasonCode | null): DarwinDecision {
  if (code == null) return "verified";
  if (code === "outside_envelope" || code === "peer_outlier") return "needs_review";
  if (code === "duplicate_in_batch" || code === "duplicate_verified") return "duplicate";
  return "rejected";
}

export interface RawFeeRow {
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
  /** Verified rows that are explicit $0 (free) fees. */
  zeroFeesVerified: number;
  /** Pass 2: rows held for review as far outside their state peers. */
  peerOutliers: number;
  /** Pass 2: rows whose amount another stored document of the same bank confirms. */
  secondSourceAgreements: number;
  /** Pass 2: rows another stored document of the same bank shows at a different amount. */
  secondSourceDisagreements: number;
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

function normalizedAmount(value: number | string | null): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100) / 100;
}

/** The first rule a row fails, or null when it can be verified. Exported for tests. */
export function verificationReasonCode(row: RawFeeRow, canonicalFeeKey: string | null): DarwinReasonCode | null {
  if (!canonicalFeeKey) return "missing_canonical";
  if (!row.fee_name?.trim()) return "missing_name";
  if (!checkFeeCategory(canonicalFeeKey, row.fee_name).ok) return "category_mismatch";
  if (!row.source_url?.trim() && !row.document_r2_key?.trim()) return "missing_lineage";
  const amount = normalizedAmount(row.amount);
  if (amount == null || amount < 0) return "invalid_amount";
  if (amount === 0) {
    return isExplicitZeroFee(amount, parseFlags(row.outlier_flags), ZERO_FEE_RAW_FLAG) ? null : "invalid_amount";
  }
  if (!withinAmountEnvelope(canonicalFeeKey, amount)) return "outside_envelope";
  return null;
}

/**
 * Is the fee stated in the stored text of the document Knox read it from? The shared
 * accuracy check (`checkFeeAgainstSource`), with Hamilton's reading: a tiered price is the
 * bank's real price for its band. A row with no stored text cannot be traced. Exported for tests.
 */
export function statedInOwnSource(
  row: Pick<RawFeeRow, "fee_name" | "amount" | "source_document_id">,
  texts: ReadonlyMap<number, string>,
): boolean {
  const amount = normalizedAmount(row.amount);
  if (amount == null || row.source_document_id == null) return false;
  const text = texts.get(Number(row.source_document_id));
  if (!text) return false;
  const result = checkFeeAgainstSource(text, row.fee_name, amount, ".");
  return result.ok || result.reason === "tiered_fee";
}

/** The newest completed text of each document, as Hamilton's source check reads it. */
async function loadSourceTexts(db: SqlTag, documentIds: number[]): Promise<Map<number, string>> {
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

/** Same institution, category, amount, frequency and source: the same fee line. */
function batchKey(row: RawFeeRow, canonicalFeeKey: string): string {
  return [
    Number(row.institution_id),
    canonicalFeeKey,
    normalizedAmount(row.amount),
    (row.frequency ?? "").trim().toLowerCase(),
    (row.source_url ?? row.document_r2_key ?? "").trim(),
  ].join("|");
}

async function selectRawFees(
  db: SqlTag,
  limit: number,
  learning: boolean,
  institutionId?: number,
  stateCode?: string,
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
    // rejected, or one a new re-file rule now places, is not lost.
    const guardParam = `$${params.push(CATEGORY_GUARD_VERSION)}`;
    filters.push(`AND NOT EXISTS (
           SELECT 1
             FROM pipeline_attempts pa
            WHERE pa.input_fingerprint = 'raw:' || fr.fee_raw_id::text
              AND pa.strategy = ${strategyParam}
              AND pa.strategy_version = ${versionParam}
              AND NOT (
                pa.detail->>'reason_code' = 'category_mismatch'
                AND COALESCE((pa.detail->>'category_guard_version')::int, 0) < ${guardParam}
              )
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

async function insertVerifiedFee(
  db: SqlTag,
  options: {
    runId: number;
    row: RawFeeRow;
    canonicalFeeKey: string;
    secondSourceAgrees?: boolean;
  },
): Promise<number | null> {
  const feeRawId = Number(options.row.fee_raw_id);
  const institutionId = Number(options.row.institution_id);
  const amount = normalizedAmount(options.row.amount);
  const eventId = stableUuid(`darwin:${options.runId}:${feeRawId}:${options.canonicalFeeKey}`);
  const flags = ["agentic_darwin_verified"];
  if (amount === 0) flags.push(ZERO_FEE_VERIFIED_FLAG);
  if (options.secondSourceAgrees) flags.push(SECOND_SOURCE_FLAG);
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
      review_status
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
      ${options.row.frequency},
      'verified'
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
    envelopes: Record<string, { min: number; max: number }>;
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
        group.envelopes[result.canonicalFeeKey] = amountEnvelopeFor(result.canonicalFeeKey);
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
  const rows = await selectRawFees(db, limit, learning, options.institutionId, options.stateCode);
  const rowByRawFeeId = new Map(rows.map((row) => [Number(row.fee_raw_id), row]));
  const results: DarwinVerificationResult[] = [];

  const verifiedInBatch = new Set<string>();
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
    let reasonCode = verificationReasonCode(row, canonicalFeeKey);
    if (!reasonCode && !statedInOwnSource(row, sourceTexts)) reasonCode = "not_in_source";
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
      const levels = await peers.forState(row.state_code ?? options.stateCode);
      peer = peerCheck(levels, canonicalFeeKey, institutionTier(row.asset_size_tier, row.asset_size), base.amount);
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
      if (peer?.outlier) reasonCode = "peer_outlier";
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
        },
      });
      await recordPassTwoAttempts(db, options, result);
    }
  }

  if (!dryRun) {
    await recordVerificationSignals(db, options.runId, results, rowByRawFeeId);
  }

  const reasonCounts: Partial<Record<DarwinReasonCode, number>> = {};
  for (const result of results) {
    if (result.reasonCode) reasonCounts[result.reasonCode] = (reasonCounts[result.reasonCode] ?? 0) + 1;
  }

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
    zeroFeesVerified: results.filter((result) => result.status === "verified" && result.amount === 0).length,
    peerOutliers: results.filter((result) => result.reasonCode === "peer_outlier").length,
    secondSourceAgreements: results.filter((result) => result.secondSource?.verdict === "agrees").length,
    secondSourceDisagreements: results.filter((result) => result.secondSource?.verdict === "disagrees").length,
    results,
  };
}
