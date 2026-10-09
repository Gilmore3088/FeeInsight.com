import type { sql } from "@/lib/data-store/connection";

import { ATTEMPT_STAGES } from "./outcomes";

type SqlTag = typeof sql;

/**
 * The shared learning store (`pipeline_feedback`). Every agent reads and writes it:
 * one row is one judgement about one agent's output (a fee Hamilton took down, a Darwin
 * category reject, an answer-key fee, a link that produced live fees). It sits beside
 * `pipeline_attempts`, which records what an agent did; this records whether that
 * turned out right. Rows are upserted on `dedupe_key`, so a writer can re-judge the
 * same thing (a link's live-fee count, a takedown later restored) without duplicates.
 *
 * Join rule for every agent: a document by `source_document_id`, a fee by
 * `fee_raw_id` / `fee_published_id`, a link by `source_url`.
 */

export type FeedbackSignal = "wrong" | "right" | "missed" | "restored";
/**
 * Who may judge an output. Mirrors `pipeline_feedback_reported_by_check`
 * (migration 20270110000024); a test keeps the two lists equal.
 */
export const FEEDBACK_REPORTERS = ["atlas", "magellan", "rosetta", "knox", "darwin", "hamilton", "growth", "human"] as const;
export type FeedbackReporter = (typeof FEEDBACK_REPORTERS)[number];

/**
 * The stage an output came from: a pipeline stage (`ATTEMPT_STAGES`), or `marketing` for
 * growth's posts, emails and PRs. Mirrors `pipeline_feedback_about_stage_check`
 * (migration 20270110000024). `pipeline_attempts` keeps the pipeline stages only.
 */
export const FEEDBACK_STAGES = [...ATTEMPT_STAGES, "marketing"] as const;
export type FeedbackStage = (typeof FEEDBACK_STAGES)[number];

/**
 * Known kinds. Writers may add new ones; keep them snake_case and list them here.
 *   Fee level: wrong_category, wrong_amount, not_a_fee, threshold, not_on_schedule,
 *     unreproduced, outside_range, off_taxonomy, duplicate, answer_key,
 *     restored_after_takedown, darwin_verified, missing_lineage
 *   Link level (Magellan): produced_live_fees, thin_link, wrong_document, dead_link,
 *     business_schedule (a main link that is a business-only schedule)
 *   Text level (Rosetta, `rosetta/text-survival.ts`): text_held_up, text_lost_fees
 *   Read level (Rosetta, `rosetta/batch-review.ts`): no_fees_found, short_text, missed_fee_page,
 *     unresolved_fee_page, unread, batch_error_rate (one row per batch of reads)
 *   Extract level (Knox, `knox/batch-review.ts`): batch_miss, batch_error_rate (one row per
 *     batch of 500 Knox reads)
 *   Second look (Hamilton, `hamilton/second-look.ts`): takedown_pending, takedown_confirmed,
 *     takedown_cleared (a fee's current state, one row per fee and check) and the appended
 *     audit trail flag_recorded, flag_cleared, flag_confirmed (one row per event, never rewritten)
 */
export type FeedbackKind =
  | "wrong_category"
  | "wrong_amount"
  | "not_a_fee"
  | "threshold"
  | "not_on_schedule"
  | "unreproduced"
  | "outside_range"
  | "off_taxonomy"
  | "duplicate"
  | "refreshed"
  | "answer_key"
  | "restored_after_takedown"
  | "darwin_verified"
  | "missing_lineage"
  | "produced_live_fees"
  | "thin_link"
  | "wrong_document"
  | "dead_link"
  | "text_held_up"
  | "text_lost_fees"
  | (string & {});

export interface FeedbackRow {
  /** Stage and strategy that produced the output being judged. */
  aboutStage: FeedbackStage;
  aboutStrategy?: string | null;
  aboutVersion?: number | null;
  /** The `pipeline_attempts.id` that produced it, when known. */
  aboutAttemptId?: number | null;
  signal: FeedbackSignal;
  kind: FeedbackKind;
  reportedBy: FeedbackReporter;
  /** The check that judged it, e.g. `hamilton.rules_recheck`, `darwin.category_guard`. */
  checkName?: string | null;
  institutionId?: number | null;
  sourceDocumentId?: number | null;
  sourceUrl?: string | null;
  feeRawId?: number | null;
  feeVerifiedId?: number | null;
  feePublishedId?: number | null;
  canonicalFeeKey?: string | null;
  amount?: number | null;
  /** 1 by default; a link's live-fee count, or below 1 for a judgement that is not proof. */
  weight?: number;
  /** What the judgement rests on: the source line, expected vs observed. */
  evidence?: Record<string, unknown>;
  runId?: number | null;
  /** Unique per judgement, e.g. `darwin.verify:raw:123`, `magellan.link_yield:doc:45`. */
  dedupeKey: string;
}

/** Rows per INSERT statement. */
const WRITE_CHUNK = 500;

/**
 * Upserts judgements on `dedupe_key`: a re-judgement replaces the earlier row's signal,
 * kind, weight and evidence and keeps its `created_at`. Returns the rows written.
 */
export async function recordFeedback(db: SqlTag, rows: FeedbackRow[]): Promise<number> {
  let written = 0;
  for (let start = 0; start < rows.length; start += WRITE_CHUNK) {
    const chunk = rows.slice(start, start + WRITE_CHUNK).map((row) => ({
      about_stage: row.aboutStage,
      about_strategy: row.aboutStrategy ?? null,
      about_version: row.aboutVersion ?? null,
      about_attempt_id: row.aboutAttemptId ?? null,
      signal: row.signal,
      kind: row.kind,
      reported_by: row.reportedBy,
      check_name: row.checkName ?? null,
      institution_id: row.institutionId ?? null,
      source_document_id: row.sourceDocumentId ?? null,
      source_url: row.sourceUrl ?? null,
      fee_raw_id: row.feeRawId ?? null,
      fee_verified_id: row.feeVerifiedId ?? null,
      fee_published_id: row.feePublishedId ?? null,
      canonical_fee_key: row.canonicalFeeKey ?? null,
      amount: row.amount ?? null,
      weight: row.weight ?? 1,
      evidence: row.evidence ?? {},
      agent_run_id: row.runId ?? null,
      dedupe_key: row.dedupeKey,
    }));
    const result = await db`
      INSERT INTO pipeline_feedback (
        about_stage, about_strategy, about_version, about_attempt_id, signal, kind, reported_by,
        check_name, institution_id, source_document_id, source_url, fee_raw_id, fee_verified_id,
        fee_published_id, canonical_fee_key, amount, weight, evidence, agent_run_id, dedupe_key
      )
      SELECT about_stage, about_strategy, about_version, about_attempt_id, signal, kind, reported_by,
             check_name, institution_id, source_document_id, source_url, fee_raw_id, fee_verified_id,
             fee_published_id, canonical_fee_key, amount, weight, evidence, agent_run_id, dedupe_key
        FROM jsonb_to_recordset(${JSON.stringify(chunk)}::jsonb) AS row(
          about_stage text, about_strategy text, about_version integer, about_attempt_id bigint,
          signal text, kind text, reported_by text, check_name text, institution_id bigint,
          source_document_id bigint, source_url text, fee_raw_id bigint, fee_verified_id bigint,
          fee_published_id bigint, canonical_fee_key text, amount numeric, weight numeric,
          evidence jsonb, agent_run_id bigint, dedupe_key text
        )
      ON CONFLICT (dedupe_key) DO UPDATE
         SET signal = EXCLUDED.signal,
             kind = EXCLUDED.kind,
             weight = EXCLUDED.weight,
             evidence = EXCLUDED.evidence,
             about_attempt_id = COALESCE(EXCLUDED.about_attempt_id, pipeline_feedback.about_attempt_id),
             agent_run_id = EXCLUDED.agent_run_id,
             updated_at = NOW()
      RETURNING id
    `;
    written += result.length;
  }
  return written;
}

const readyCache = new WeakMap<object, boolean>();

/** True once `pipeline_feedback` exists. Only a positive answer is cached. */
export async function feedbackSchemaReady(db: SqlTag): Promise<boolean> {
  if (readyCache.get(db)) return true;
  const [row] = await db`SELECT to_regclass('public.pipeline_feedback') IS NOT NULL AS ready`;
  const ready = row?.ready === true;
  if (ready) readyCache.set(db, true);
  return ready;
}

/** Knox's strategy for a raw row, from its flags (`knox_specialist:*`, `knox_paid_extraction`). */
export function knoxStrategyFromFlags(flags: unknown): string {
  const list = Array.isArray(flags) ? flags.map(String) : [];
  if (list.includes("knox_paid_extraction")) return "extract.paid";
  const specialist = list.find((flag) => flag.startsWith("knox_specialist:"));
  return specialist ? specialist.slice("knox_specialist:".length) : "extract.rules";
}

/**
 * A takedown reason's group without the row it points at ("refreshed by #69017" ->
 * "refreshed by"), so a check or kind is one name, never one per fee; the id stays in
 * the row's evidence (`takedownPointer`).
 */
function takedownGroup(group: string): string {
  return group.replace(/\s*#\d+\s*$/, "").trim();
}

/** The live row a takedown reason points at ("superseded by #69017" -> 69017), if any. */
export function takedownPointer(reason: string): number | null {
  const match = reason.split(":")[0].match(/#(\d+)\s*$/);
  return match ? Number(match[1]) : null;
}

/**
 * A refresh closes a live row because the current copy of the page states the same fee
 * (same name and amount) and that row was published in its place: Knox's read and
 * Darwin's approval held up, so it is a `right` signal, not a takedown.
 */
export function takedownSignal(reason: string): "wrong" | "right" {
  return takedownGroup(reason.split(":")[0]) === "refreshed by" ? "right" : "wrong";
}

/** The feedback kind for a Hamilton takedown reason (`published_fee_records.rolled_back_reason`). */
export function takedownKind(reason: string): FeedbackKind {
  const [rawGroup, detail] = reason.split(":");
  const group = takedownGroup(rawGroup);
  if (group === "refreshed by") return "refreshed";
  if (group === "rules_recheck_unreproduced") return "unreproduced";
  if (group === "category_guard") return "wrong_category";
  if (group === "amount_outside_category_range") return "outside_range";
  if (group === "category_outside_taxonomy") return "off_taxonomy";
  if (group === "limit_as_fee") return "not_a_fee";
  if (/^(duplicate of|superseded by|older document than)/.test(group)) return "duplicate";
  if (group === "source_check_untraceable") {
    if (detail === "amount_is_a_threshold") return "threshold";
    if (detail === "amount_not_the_fee") return "wrong_amount";
    if (detail === "priced_per_amount") return "priced_per_amount";
    if (detail === "category_not_in_text") return "wrong_category";
    return "not_on_schedule";
  }
  return group.replace(/[^a-z0-9]+/gi, "_").toLowerCase();
}

/** The Hamilton check behind a takedown reason. */
export function takedownCheck(reason: string): string {
  const group = takedownGroup(reason.split(":")[0]);
  if (group === "refreshed by") return "hamilton.refresh_copy";
  if (/^(duplicate of|superseded by|older document than)/.test(group)) return "hamilton.duplicate_collapse";
  if (group === "rules_recheck_unreproduced") return "hamilton.rules_recheck";
  if (group === "source_check_untraceable") return "hamilton.source_check";
  return `hamilton.${group}`;
}
