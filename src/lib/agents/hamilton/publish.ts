import { createHash } from "crypto";

import { sql } from "@/lib/data-store/connection";
import { invalidateFeeSummaryCache } from "@/lib/data-store/fee-cache";
import { normalizeStateCode } from "@/lib/agents/state-lane-memory";
import { CANONICAL_KEY_MAP } from "@/lib/fee-taxonomy";
import { recordHamiltonMonitorSignal } from "@/lib/hamilton/monitor-signals";

type SqlTag = typeof sql;

export const HAMILTON_PUBLISH_DEFAULT_LIMIT = 100;
export const HAMILTON_PUBLISH_MAX_LIMIT = 500;
export const HAMILTON_PUBLISH_DEFAULT_MIN_CONFIDENCE = 0.8;

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

interface VerifiedFeeRow {
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
  institution_name?: string | null;
}

interface PriorPublishedFeeRow {
  fee_published_id: number | string;
  amount: number | string | null;
  fee_name: string;
  published_at: string | Date;
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
}

export interface RunHamiltonPublishOptions {
  runId: number;
  limit?: number;
  institutionId?: number;
  stateCode?: string;
  minConfidence?: number;
  dryRun?: boolean;
  db?: SqlTag;
}

export interface RunHamiltonPublishResult {
  selectedVerifiedFees: number;
  processedVerifiedFees: number;
  publishedFees: number;
  skippedFees: number;
  limit: number;
  minConfidence: number;
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

function normalizedConfidence(value: number | string | null): number {
  if (value == null || value === "") return 0;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return 0;
  return Math.min(Math.max(parsed, 0), 1);
}

function coverageTier(confidence: number): "strong" | "provisional" {
  return confidence >= 0.9 ? "strong" : "provisional";
}

function publishSkipReason(row: VerifiedFeeRow, minConfidence: number): string | null {
  const flags = parseFlags(row.outlier_flags);
  if (!flags.includes("agentic_darwin_verified")) return "Not verified by the agentic Darwin path";
  const blockingFlag = flags.find((flag) => BLOCKING_FLAGS.has(flag));
  if (blockingFlag) return `Blocking flag: ${blockingFlag}`;
  if (!VALID_CANONICAL_KEYS.has(row.canonical_fee_key)) return "Invalid canonical fee key";
  if (!row.fee_name?.trim()) return "Missing fee name";
  if (!row.source_url?.trim() && !row.document_r2_key?.trim()) return "Missing source lineage";
  const amount = normalizedAmount(row.amount);
  if (amount == null || amount <= 0) return "Missing or invalid amount";
  if (amount > 2_500) return "Amount outside deterministic publish range";
  if (normalizedConfidence(row.extraction_confidence) < minConfidence) {
    return "Below publish confidence threshold";
  }
  return null;
}

async function selectVerifiedFees(
  db: SqlTag,
  limit: number,
  institutionId?: number,
  stateCode?: string,
): Promise<VerifiedFeeRow[]> {
  const params: Array<number | string> = [limit];
  const filters: string[] = [];
  if (institutionId) {
    params.push(institutionId);
    filters.push(`AND fv.institution_id = $${params.length}`);
  }
  const normalizedState = normalizeStateCode(stateCode);
  if (normalizedState) {
    params.push(normalizedState);
    filters.push(`AND upper(btrim(inst.state_code)) = $${params.length}`);
  }
  return db.unsafe<VerifiedFeeRow[]>(
    `
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
             fr.agent_event_id AS raw_agent_event_id,
             inst.institution_name
        FROM verified_fee_observations fv
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
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
       ORDER BY fv.created_at ASC, fv.fee_verified_id ASC
       LIMIT $1
    `,
    params,
  );
}

async function insertPublishedFee(
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
  const amount = normalizedAmount(options.row.amount);
  const publishEventId = stableUuid(
    `hamilton:${options.runId}:${feeVerifiedId}:${options.row.canonical_fee_key}`,
  );
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
      batch_id
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
      ${options.row.fee_name},
      ${amount},
      ${options.row.frequency},
      ${options.row.variant_type},
      ${coverageTier(confidence)},
      ${options.batchId}
    )
    ON CONFLICT DO NOTHING
    RETURNING fee_published_id
  `;
  return inserted[0]?.fee_published_id == null ? null : Number(inserted[0].fee_published_id);
}

async function selectPriorPublishedFee(
  db: SqlTag,
  row: VerifiedFeeRow,
): Promise<PriorPublishedFeeRow | null> {
  try {
    const rows = await db<PriorPublishedFeeRow[]>`
      SELECT fee_published_id,
             amount,
             fee_name,
             published_at
        FROM published_fee_records
       WHERE institution_id = ${Number(row.institution_id)}
         AND canonical_fee_key = ${row.canonical_fee_key}
         AND COALESCE(variant_type, '') = COALESCE(${row.variant_type}, '')
         AND COALESCE(frequency, '') = COALESCE(${row.frequency}, '')
         AND rolled_back_at IS NULL
       ORDER BY published_at DESC, fee_published_id DESC
       LIMIT 1
    `;
    return rows[0] ?? null;
  } catch (error) {
    console.error("selectPriorPublishedFee failed:", error);
    return null;
  }
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
    movements: Array<{
      canonical_fee_key: string;
      fee_name: string;
      previous_fee_published_id: number;
      new_fee_published_id: number;
      previous_amount: number;
      new_amount: number;
      amount_delta: number;
      direction: "increase" | "decrease";
    }>;
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

  for (const [institutionId, group] of grouped) {
    const count = group.feePublishedIds.length;
    await recordHamiltonMonitorSignal(
      {
        institutionId,
        signalType: "hamilton_publication_completed",
        severity: "high",
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
          refresh_recommended: ["reports", "scenarios", "watchlist"],
          provider_call_queued: false,
        },
      },
      db,
    ).catch((error) => {
      console.error("recordHamiltonPublicationSignal failed:", error);
    });
  }

  for (const [institutionId, group] of movementGroups) {
    const count = group.movements.length;
    const increases = group.movements.filter((movement) => movement.direction === "increase").length;
    const severity = increases > 0 ? "high" : "medium";
    await recordHamiltonMonitorSignal(
      {
        institutionId,
        signalType: "hamilton_fee_movement_detected",
        severity,
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
      db,
    ).catch((error) => {
      console.error("recordHamiltonFeeMovementSignal failed:", error);
    });
  }
}

export async function runHamiltonPublish(
  options: RunHamiltonPublishOptions,
): Promise<RunHamiltonPublishResult> {
  const db = options.db ?? sql;
  const limit = boundedLimit(options.limit);
  const minConfidence = boundedConfidence(options.minConfidence);
  const dryRun = Boolean(options.dryRun);
  const batchId = `agentic-run-${options.runId}`;
  const rows = await selectVerifiedFees(db, limit, options.institutionId, options.stateCode);
  const rowByVerifiedFeeId = new Map(rows.map((row) => [Number(row.fee_verified_id), row]));
  const results: HamiltonPublishResult[] = [];

  for (const row of rows) {
    const skipReason = publishSkipReason(row, minConfidence);
    if (skipReason) {
      results.push({
        feeVerifiedId: Number(row.fee_verified_id),
        institutionId: Number(row.institution_id),
        feeName: row.fee_name,
        amount: normalizedAmount(row.amount),
        canonicalFeeKey: row.canonical_fee_key,
        status: "skipped",
        reason: skipReason,
        feePublishedId: null,
        previousFeePublishedId: null,
        previousAmount: null,
        amountDelta: null,
        movementDirection: null,
      });
      continue;
    }

    const priorPublishedFee = dryRun ? null : await selectPriorPublishedFee(db, row);
    // Content-level dedupe: re-verification mints a new fee_verified_id, so the
    // lineage guard alone lets identical fee lines pile up in the catalog.
    if (
      priorPublishedFee &&
      normalizedAmount(priorPublishedFee.amount) === normalizedAmount(row.amount)
    ) {
      results.push({
        feeVerifiedId: Number(row.fee_verified_id),
        institutionId: Number(row.institution_id),
        feeName: row.fee_name,
        amount: normalizedAmount(row.amount),
        canonicalFeeKey: row.canonical_fee_key,
        status: "skipped",
        reason: "Identical fee already published",
        feePublishedId: null,
        previousFeePublishedId: Number(priorPublishedFee.fee_published_id),
        previousAmount: normalizedAmount(priorPublishedFee.amount),
        amountDelta: null,
        movementDirection: null,
      });
      continue;
    }
    const feePublishedId = dryRun
      ? null
      : await insertPublishedFee(db, { runId: options.runId, batchId, row });
    const movement = feePublishedId
      ? movementFor(priorPublishedFee, row)
      : {
          previousFeePublishedId: null,
          previousAmount: null,
          amountDelta: null,
          movementDirection: null,
        };
    results.push({
      feeVerifiedId: Number(row.fee_verified_id),
      institutionId: Number(row.institution_id),
      feeName: row.fee_name,
      amount: normalizedAmount(row.amount),
      canonicalFeeKey: row.canonical_fee_key,
      status: feePublishedId || dryRun ? "published" : "skipped",
      reason: feePublishedId || dryRun ? null : "Duplicate published row",
      feePublishedId,
      ...movement,
    });
  }

  if (!dryRun) {
    await recordPublicationSignals(db, options.runId, batchId, results, rowByVerifiedFeeId);

    // Public benchmark reads are cached between publishes. Drop the cache so readers
    // see the rows this run just published. Never allowed to fail a publish.
    if (results.some((result) => result.status === "published")) {
      invalidateFeeSummaryCache();
    }
  }

  return {
    selectedVerifiedFees: rows.length,
    processedVerifiedFees: results.length,
    publishedFees: results.filter((result) => result.status === "published").length,
    skippedFees: results.filter((result) => result.status === "skipped").length,
    limit,
    minConfidence,
    dryRun,
    batchId,
    results,
  };
}
