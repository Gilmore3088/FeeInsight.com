import type { sql } from "@/lib/data-store/connection";
import { checkFeeAgainstSource, type SourceCheckFailure } from "@/lib/custom-report/source-check";
import { learningSchemaReady, recordAttempt } from "@/lib/agents/learning/attempts";
import { normalizeStateCode } from "@/lib/agents/state-lane-memory";
import { withinAmountEnvelope } from "./envelopes";
import { recordDarwinFeedback } from "./feedback";
import { knoxStrategyFromFlags, type FeedbackRow } from "@/lib/agents/learning/feedback";
import {
  DARWIN_VERIFY_STRATEGY,
  insertVerifiedFee,
  loadSourceTexts,
  rawFeeFingerprint,
  type RawFeeRow,
} from "./verify";

type SqlTag = typeof sql;

/**
 * The way out for fees Darwin holds for review (James, 2026-10-06: "close all those
 * gaps"; the held-fees card's recommended option). A fee is held when its amount is
 * outside its category's range (`outside_envelope`) or far outside its state's peers
 * (`peer_outlier`), and until now nothing ever looked at it again.
 *
 * Each held fee is checked against the bank's own stored schedule with the shared
 * accuracy check (`checkFeeAgainstSource`):
 * - not stated: `reject`, with the source check's reason recorded.
 * - stated, held only for being unusual next to peers: `release` (verified, so Hamilton
 *   can publish it). The audit found half of the peer holds were real prices.
 * - stated, but outside the category's hand-set range: `keep` for a person. Hamilton's
 *   publish gate uses the same range, so releasing it would not publish it.
 *
 * Version 1 is a dry run on live data: it records each verdict in the attempt log and
 * changes nothing. Acting (inserting released fees, writing rejects to the learning
 * store) is version 2, so every held fee is judged again when it switches on.
 */
export const DARWIN_RELEASE_STRATEGY = { strategy: "verify.release", version: 1 } as const;
export const DARWIN_RELEASE_ACTS = false;
export const DARWIN_RELEASE_BATCH = 200;

export type HeldReason = "outside_envelope" | "peer_outlier";
export type ReleaseVerdict = "release" | "reject" | "keep" | "duplicate";

export interface HeldFeeRow extends RawFeeRow {
  held_reason: HeldReason;
  held_canonical_fee_key: string;
}

export type ReleaseSourceCheck = "stated" | SourceCheckFailure | "no_amount";

export interface ReleaseDecision {
  feeRawId: number;
  institutionId: number;
  canonicalFeeKey: string;
  amount: number | null;
  heldReason: HeldReason;
  verdict: ReleaseVerdict;
  sourceCheck: ReleaseSourceCheck;
  sourceLine: string | null;
  feeVerifiedId: number | null;
}

export interface RunDarwinReleaseResult {
  selected: number;
  acted: boolean;
  verdicts: Partial<Record<ReleaseVerdict, number>>;
  released: number;
  feedbackWritten: number | null;
  decisions: ReleaseDecision[];
}

function amountOf(value: number | string | null): number | null {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.round(parsed * 100) / 100 : null;
}

/** Pure: the verdict for one held fee, given its stored schedule text. */
export function releaseVerdict(
  row: Pick<HeldFeeRow, "fee_name" | "amount" | "held_reason" | "held_canonical_fee_key">,
  text: string | null | undefined,
): { verdict: Exclude<ReleaseVerdict, "duplicate">; sourceCheck: ReleaseSourceCheck; sourceLine: string | null } {
  const amount = amountOf(row.amount);
  if (amount == null || amount <= 0) return { verdict: "reject", sourceCheck: "no_amount", sourceLine: null };
  const check = checkFeeAgainstSource(text, row.fee_name, amount, ".");
  // A tiered price is the bank's real price for its band, as Darwin and Hamilton read it.
  const stated = check.ok || check.reason === "tiered_fee";
  if (!stated) return { verdict: "reject", sourceCheck: check.ok ? "stated" : check.reason, sourceLine: null };
  const sourceLine = check.ok ? check.sourceLine : null;
  if (row.held_reason === "outside_envelope" && !withinAmountEnvelope(row.held_canonical_fee_key, amount)) {
    return { verdict: "keep", sourceCheck: "stated", sourceLine };
  }
  return { verdict: "release", sourceCheck: "stated", sourceLine };
}

/** Same institution, category, amount and source as a fee already verified. */
function duplicateKey(institutionId: number, key: string, amount: number | null, source: string | null): string {
  return [institutionId, key, amount, (source ?? "").trim()].join("|");
}

async function selectHeldFees(db: SqlTag, limit: number, stateCode?: string, institutionId?: number): Promise<HeldFeeRow[]> {
  const params: Array<string | number> = [
    limit,
    DARWIN_VERIFY_STRATEGY.strategy,
    DARWIN_VERIFY_STRATEGY.version,
    DARWIN_RELEASE_STRATEGY.strategy,
    DARWIN_RELEASE_STRATEGY.version,
  ];
  const filters: string[] = [];
  const state = normalizeStateCode(stateCode);
  if (state) filters.push(`AND upper(btrim(inst.state_code)) = $${params.push(state)}`);
  if (institutionId) filters.push(`AND fr.institution_id = $${params.push(institutionId)}`);
  return db.unsafe<HeldFeeRow[]>(
    `
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
             pa.detail->>'reason_code' AS held_reason,
             pa.detail->>'canonical_fee_key' AS held_canonical_fee_key
        FROM pipeline_attempts pa
        JOIN raw_fee_observations fr ON fr.fee_raw_id = substring(pa.input_fingerprint from 5)::bigint
        JOIN institution_sources inst ON inst.id = fr.institution_id
       WHERE pa.stage = 'verify'
         AND pa.strategy = $2
         AND pa.strategy_version = $3
         AND pa.input_fingerprint LIKE 'raw:%'
         AND pa.detail->>'decision' = 'needs_review'
         AND pa.detail->>'reason_code' IN ('outside_envelope', 'peer_outlier')
         AND pa.detail->>'canonical_fee_key' IS NOT NULL
         ${filters.join("\n         ")}
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_attempts later
            WHERE later.input_fingerprint = pa.input_fingerprint
              AND later.strategy = pa.strategy
              AND later.strategy_version = pa.strategy_version
              AND later.created_at > pa.created_at
         )
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_attempts done
            WHERE done.input_fingerprint = pa.input_fingerprint
              AND done.strategy = $4
              AND done.strategy_version = $5
         )
         AND NOT EXISTS (SELECT 1 FROM verified_fee_observations fv WHERE fv.fee_raw_id = fr.fee_raw_id)
       ORDER BY pa.created_at ASC, fr.fee_raw_id ASC
       LIMIT $1
    `,
    params,
  );
}

async function loadVerifiedKeys(db: SqlTag, institutionIds: number[]): Promise<Set<string>> {
  if (institutionIds.length === 0) return new Set();
  const rows = await db<Array<{ institution_id: number | string; canonical_fee_key: string; amount: number | string | null; source_url: string | null }>>`
    SELECT institution_id, canonical_fee_key, amount, source_url
      FROM verified_fee_observations
     WHERE institution_id = ANY(${institutionIds}::int[])
  `;
  return new Set((rows ?? []).map((row) =>
    duplicateKey(Number(row.institution_id), row.canonical_fee_key, amountOf(row.amount), row.source_url)));
}

function feedbackFor(decision: ReleaseDecision, row: HeldFeeRow, runId: number): FeedbackRow | null {
  if (decision.verdict !== "release" && decision.verdict !== "reject") return null;
  let flags: string[] = [];
  try {
    const parsed: unknown = typeof row.outlier_flags === "string" ? JSON.parse(row.outlier_flags) : row.outlier_flags;
    if (Array.isArray(parsed)) flags = parsed.map(String);
  } catch {
    flags = [];
  }
  return {
    aboutStage: "extract",
    aboutStrategy: knoxStrategyFromFlags(flags),
    signal: decision.verdict === "release" ? "right" : "wrong",
    kind: decision.verdict === "release" ? "darwin_verified" : "not_on_schedule",
    reportedBy: "darwin",
    checkName: "darwin.release",
    institutionId: decision.institutionId,
    sourceDocumentId: row.source_document_id == null ? null : Number(row.source_document_id),
    sourceUrl: row.source_url ?? null,
    feeRawId: decision.feeRawId,
    feeVerifiedId: decision.feeVerifiedId,
    canonicalFeeKey: decision.canonicalFeeKey,
    amount: decision.amount,
    weight: decision.verdict === "release" ? 0.5 : 1,
    evidence: {
      fee_name: row.fee_name,
      held_reason: decision.heldReason,
      source_check: decision.sourceCheck,
      source_line: decision.sourceLine,
    },
    runId,
    dedupeKey: `darwin.release:raw:${decision.feeRawId}`,
  };
}

/**
 * Judge up to DARWIN_RELEASE_BATCH held fees. With DARWIN_RELEASE_ACTS off (version 1)
 * it only records verdicts; a dry-run agent run records nothing.
 */
export async function runDarwinReleaseHeld(options: {
  runId: number;
  stepId?: number;
  stateCode?: string;
  institutionId?: number;
  dryRun?: boolean;
  limit?: number;
  db: SqlTag;
}): Promise<RunDarwinReleaseResult> {
  const { db } = options;
  const learning = !options.dryRun && (await learningSchemaReady(db));
  const acts = DARWIN_RELEASE_ACTS && learning;
  const rows = await selectHeldFees(db, options.limit ?? DARWIN_RELEASE_BATCH, options.stateCode, options.institutionId);
  const texts = await loadSourceTexts(
    db,
    Array.from(new Set(rows.flatMap((row) => (row.source_document_id == null ? [] : [Number(row.source_document_id)])))),
  );
  const verified = await loadVerifiedKeys(db, Array.from(new Set(rows.map((row) => Number(row.institution_id)))));

  const decisions: ReleaseDecision[] = [];
  const feedback: FeedbackRow[] = [];
  for (const row of rows) {
    const text = row.source_document_id == null ? null : texts.get(Number(row.source_document_id));
    const judged = releaseVerdict(row, text);
    const amount = amountOf(row.amount);
    const key = duplicateKey(Number(row.institution_id), row.held_canonical_fee_key, amount, row.source_url);
    let verdict: ReleaseVerdict = judged.verdict;
    if (verdict === "release" && verified.has(key)) verdict = "duplicate";

    let feeVerifiedId: number | null = null;
    if (verdict === "release" && acts) {
      feeVerifiedId = await insertVerifiedFee(db, { runId: options.runId, row, canonicalFeeKey: row.held_canonical_fee_key });
      if (feeVerifiedId == null) verdict = "duplicate";
      else verified.add(key);
    } else if (verdict === "release") {
      verified.add(key);
    }

    const decision: ReleaseDecision = {
      feeRawId: Number(row.fee_raw_id),
      institutionId: Number(row.institution_id),
      canonicalFeeKey: row.held_canonical_fee_key,
      amount,
      heldReason: row.held_reason,
      verdict,
      sourceCheck: judged.sourceCheck,
      sourceLine: judged.sourceLine,
      feeVerifiedId,
    };
    decisions.push(decision);
    if (acts) {
      const entry = feedbackFor(decision, row, options.runId);
      if (entry) feedback.push(entry);
    }

    if (learning) {
      await recordAttempt(db, {
        institutionId: decision.institutionId,
        sourceDocumentId: row.source_document_id == null ? null : Number(row.source_document_id),
        stage: "verify",
        strategy: DARWIN_RELEASE_STRATEGY.strategy,
        version: DARWIN_RELEASE_STRATEGY.version,
        fingerprint: rawFeeFingerprint(decision.feeRawId),
        outcome: verdict === "release" ? "ok" : verdict === "reject" ? "rejected" : "unchanged",
        yieldCount: verdict === "release" ? 1 : 0,
        costMicrousd: 0,
        runId: options.runId,
        stepId: options.stepId ?? null,
        foldIntoPlaybook: false,
        detail: {
          fee_raw_id: decision.feeRawId,
          fee_name: row.fee_name,
          canonical_fee_key: decision.canonicalFeeKey,
          amount: decision.amount,
          held_reason: decision.heldReason,
          verdict,
          source_check: decision.sourceCheck,
          source_line: decision.sourceLine?.slice(0, 300) ?? null,
          fee_verified_id: feeVerifiedId,
          acted: acts,
        },
      });
    }
  }

  const verdicts: Partial<Record<ReleaseVerdict, number>> = {};
  for (const decision of decisions) verdicts[decision.verdict] = (verdicts[decision.verdict] ?? 0) + 1;
  return {
    selected: rows.length,
    acted: acts,
    verdicts,
    released: decisions.filter((decision) => decision.feeVerifiedId != null).length,
    feedbackWritten: acts ? await recordDarwinFeedback(db, feedback) : null,
    decisions,
  };
}
