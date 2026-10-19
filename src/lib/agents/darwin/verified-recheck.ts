import { createHash, randomUUID } from "node:crypto";
import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { recordAttestedAttempt } from "@/lib/agents/learning/attempts";
import { inSavepoint } from "@/lib/agents/savepoint";
import { excerptOf } from "@/lib/agents/hamilton/frequency-fill";
import { PENDING_KIND, SECOND_LOOK_MIN_MINUTES, secondLook, secondLookDedupeKey } from "@/lib/agents/hamilton/second-look";
import { refileCategory } from "@/lib/fee-category-guard";

import { tierPerkZero } from "./tier-perk";
import { DARWIN_VERIFY_STRATEGY, loadSourceTexts, normalizedAmount, postSourceCheck, sourceLineFor, type RawFeeRow } from "./verify";

type SqlTag = typeof sql;

/**
 * Darwin's own second look at the rows it verified: every row verified by `verify.rules` is
 * read once more under the checks that follow the source check (`postSourceCheck`: live
 * category, no conditional $0, Hamilton's name rules). A row that fails and is not live is
 * rejected with a flag; one that is live is archived (rolled back with the reason, never
 * deleted) in the same step once `DARWIN_RECHECK_SAME_STEP_TAKEDOWN` is on, and until then is
 * flagged through the shared 12-hour second look. Never a hand UPDATE. Each row is read once per
 * version, recorded as a `verify.recheck` attempt.
 *
 * v1 (2026-10-09): UAT's 20-row check of the not_in_source re-select (#883) found 16 right;
 * three misses were $0 "free if you meet a condition" readings of $2.50-$6.95 fees, one a
 * package list verified into the retired `estatement_fee` type.
 * v2 (2026-10-09): UAT's 10-row takedown check of v1 found 7 right; the misses read a non-member
 * price, a comparison table's other column and another label's figure as the fee's fallback
 * price. The $0 rule now reads the fee's own cell and label (`ownSegment`). v2 also re-reads the
 * rows v1 rejected (flag `darwin_recheck:*`): one that passes now is restored to verified with the
 * flag removed; a live row that passes now has its pending second-look flag cleared.
 * v3 (2026-10-15, #1397): a $0 from one account tier's own schedule, or named for a tier's
 * account, is that tier's perk, not the bank's price (`tierPerkZero`). One large bank's live overdraft,
 * NSF, stop payment and wire fees all read $0 from its Premium Account schedule.
 * v4 (2026-10-16, #1571, #1574): on a run-on line the $0 rule reads only the fee's own row, so a
 * neighbouring row's price is no longer this free fee's condition; and an account's own monthly or
 * minimum-balance $0 named for the account ("Premier Checking") is its price, not a tier's perk.
 * v5 (2026-10-16, #1593): the $0 rule reads a two-column page by its columns and a domestic wire's
 * international price as another fee's, with the document text as evidence; a $0 traced to a line
 * that lacks a word of its name is read on the line that prints it. Of the 31 live conditional-$0
 * flags hand-checked on Oct 16, 8 were real free fees held this way.
 */
export const DARWIN_RECHECK_STRATEGY = { strategy: "verify.recheck", version: 5 } as const;
export const RECHECK_LIMIT = 200;
/** The shared second look's check name while live failures are only flagged. */
export const DARWIN_RECHECK_CHECK = "darwin.verified_recheck";
/**
 * Default-off switch for archiving a failing live fee in the same step (James, 11:55 UTC
 * 2026-10-09: "stop waiting 12 hours. go"). Off: the live row is flagged `takedown_pending`
 * through the shared second look (the 12-hour path). It turns on by PR once UAT has hand-checked
 * 10 of the rows a dry read says the recheck would take down and found at least 9 right (the
 * takedown spot-check bar).
 */
export const DARWIN_RECHECK_SAME_STEP_TAKEDOWN = false;
export const RECHECK_REJECTED_FLAG_PREFIX = "darwin_recheck";
/**
 * Default-off switch (#1568): also re-read live fees that `verify.rules` verified under an older
 * version. The recheck reads only rows of the current verify version, so a rule added here never
 * reached fees that went live earlier (15 live tier-perk $0s, Oct 16). Off, each step reads a
 * sample of those rows and reports what the recheck would do (`olderLive`), writing nothing; on,
 * they join the recheck and fail or pass like any other row. It turns on by PR once James approves
 * the dry-run count by reason.
 */
export const DARWIN_RECHECK_OLDER_LIVE = false;
/** Older live rows read per step for the shadow report, on every `OLDER_LIVE_SHADOW_EVERY`th run. */
export const OLDER_LIVE_SHADOW_LIMIT = 200;
export const OLDER_LIVE_SHADOW_EVERY = 4;
/**
 * Default-off switch (#1397): give each first look its second look. A failing live row is flagged
 * `takedown_pending` and comes down only when a run 12 hours on fails it again, but the recheck
 * reads a row once per version, so that second read never came: Frost's 14 premium-schedule $0s
 * were flagged `tier_perk_zero` on 2026-10-15 08:35 and stayed live. On, each step re-reads up to
 * `SECOND_LOOK_DUE_LIMIT` live rows whose first look is due, and the shared second look confirms
 * (archives) or clears each. Off, it reports what that would do (`dueSecondLooks`) and writes
 * nothing. It turns on by PR once James approves the count of due flags.
 */
export const DARWIN_RECHECK_SECOND_LOOK_LIVE = false;
/**
 * The narrow switch-on (James, 2026-10-16 03:37 UTC, "2-4' yes"): with
 * `DARWIN_RECHECK_SECOND_LOOK_LIVE` still off, only first looks flagged under these reason codes get
 * their second look. A due row is confirmed (archived) only when the recheck fails it again under
 * one of these codes, and cleared when it now passes; one that fails under another code is left
 * flagged and only reported. Every other code (conditional_zero, name_rule and the rest) stays in
 * the shadow report. Count when it went on: 15 live `tier_perk_zero` flags, all due (14 on one
 * large bank's premium-account schedule, 1 credit union "Premier Checking" $0 that the v4 rule now
 * passes). Roll back by emptying the list.
 */
export const DARWIN_RECHECK_SECOND_LOOK_LIVE_CODES: readonly string[] = ["tier_perk_zero"];
export const SECOND_LOOK_DUE_LIMIT = 100;

interface RecheckRow extends RawFeeRow {
  fee_verified_id: number | string;
  review_status: string;
  canonical_fee_key: string;
  verified_amount: number | string | null;
  fee_published_id: number | string | null;
  selected_verified: string;
  selected_raw: string;
  selected_published: string | null;
  selected_feedback: string | null;
}

export interface VerifiedRecheckResult {
  execution?: RecheckExecution;
  checked: number;
  passed: number;
  rejected: Array<{ feeVerifiedId: number; code: string }>;
  /** Rows an earlier recheck version rejected that pass now, set back to verified. */
  restored: number[];
  /** Live rows whose pending second-look flag was cleared because they pass now. */
  cleared: number;
  /** Live rows flagged for the 12-hour second look (switch off). */
  flagged: number;
  /** Live rows already flagged and still inside the 12 hours (switch off). */
  waiting: number;
  /** Live records archived (rolled back with the reason) in this step. */
  takenDown: number[];
  /** While `DARWIN_RECHECK_OLDER_LIVE` is off: what the recheck would do to older live rows (#1568). */
  olderLive?: OlderLiveShadow | null;
  /** While `DARWIN_RECHECK_SECOND_LOOK_LIVE` is off: what the due second looks would do (#1397), for codes not switched on. */
  dueSecondLooks?: DueSecondLookShadow | null;
  /** Due rows read for a switched-on code that now fail under another code: left flagged, not confirmed. */
  secondLookOtherCode?: number;
}

export interface DueSecondLookShadow {
  /** Live rows whose first look is at least 12 hours old (up to the limit). */
  due: number;
  /** Still failing: the second look would archive them, by reason code. */
  wouldConfirm: Record<string, number>;
  /** Passing now: the second look would clear their flags. */
  wouldClear: number;
  samples: Array<{ feePublishedId: number; institutionId: number; canonicalFeeKey: string; feeName: string; amount: number | null; code: string }>;
  error?: string;
}

export interface OlderLiveShadow {
  /** Older live rows read this step (a sample read up from a random id). */
  read: number;
  /** Of those, the ones the recheck would fail, by reason code. */
  wouldFail: Record<string, number>;
  samples: Array<{ feePublishedId: number; feeVerifiedId: number; institutionId: number; canonicalFeeKey: string; feeName: string; amount: number | null; code: string }>;
  error?: string;
}

const EMPTY: VerifiedRecheckResult = { checked: 0, passed: 0, rejected: [], restored: [], cleared: 0, flagged: 0, waiting: 0, takenDown: [] };

/**
 * Live verified rows the recheck never selects (#1568): their `verify.rules` attempt is not a
 * `verified` one at the current version, and this recheck version has not read them. A sample (the
 * shadow report) reads up from `from` in id order, so it walks the index and stops at the limit
 * instead of sorting the whole backlog; otherwise newest first.
 */
function selectOlderLiveRows(db: SqlTag, limit: number, from: "random" | "start" | null): Promise<RecheckRow[]> {
  const sample = from != null;
  const randomStart = from === "random";
  return inSavepoint(db, (scope) => scope<RecheckRow[]>`
      SELECT md5(to_jsonb(v)::text) AS selected_verified, md5(to_jsonb(r)::text) AS selected_raw,
             v.fee_verified_id, v.review_status, v.canonical_fee_key, v.amount AS verified_amount,
             r.fee_raw_id, r.institution_id, r.source_url, r.document_r2_key, r.extraction_confidence,
             r.fee_name, r.amount, r.frequency, r.outlier_flags, COALESCE(r.extraction_note, r.conditions) AS conditions, r.source_document_id,
             r.amount_kind, r.rate_percent, live.fee_published_id, live.selected_published, live.selected_feedback
        FROM verified_fee_observations v
        JOIN raw_fee_observations r ON r.fee_raw_id = v.fee_raw_id
        JOIN LATERAL (
          SELECT p.fee_published_id, md5(to_jsonb(p)::text) AS selected_published,
                 (SELECT md5(to_jsonb(f)::text) FROM pipeline_feedback f
                   WHERE f.dedupe_key = ${secondLookDedupeKey(DARWIN_RECHECK_CHECK, 0).replace(/0$/, "")} || p.fee_published_id::text) AS selected_feedback
            FROM published_fee_records p
           WHERE p.lineage_ref = v.fee_verified_id AND p.rolled_back_at IS NULL AND p.quarantined_at IS NULL
           ORDER BY p.fee_published_id DESC LIMIT 1
        ) live ON true
       WHERE v.review_status IN ('verified', 'approved')
         AND (NOT ${randomStart}::boolean OR v.fee_verified_id >= (SELECT floor(random() * max(fee_verified_id))::bigint FROM verified_fee_observations))
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_attempts pa
            WHERE pa.input_fingerprint = 'raw:' || v.fee_raw_id::text
              AND pa.strategy = ${DARWIN_VERIFY_STRATEGY.strategy}
              AND pa.strategy_version = ${DARWIN_VERIFY_STRATEGY.version}
              AND pa.detail->>'decision' = 'verified'
         )
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_attempts pa
            WHERE pa.input_fingerprint = 'verified:' || v.fee_verified_id::text
              AND pa.strategy = ${DARWIN_RECHECK_STRATEGY.strategy}
              AND pa.strategy_version = ${DARWIN_RECHECK_STRATEGY.version}
         )
       ORDER BY CASE WHEN ${sample}::boolean THEN v.fee_verified_id END ASC,
                v.fee_verified_id DESC
       LIMIT ${limit}::int
    `);
}

/**
 * Which due first looks to read, by the code in their reason (`darwin_recheck:<code>[:<rule>]`):
 * `only` those codes, every code `except` those, or every code when neither is given.
 */
export interface DueCodeFilter {
  only?: readonly string[];
  except?: readonly string[];
}

/** Live rows whose recheck first look (`takedown_pending`) is due its second look (#1397). */
function selectDueSecondLookRows(db: SqlTag, limit: number, codes: DueCodeFilter = {}): Promise<RecheckRow[]> {
  const prefix = secondLookDedupeKey(DARWIN_RECHECK_CHECK, 0).replace(/0$/, "");
  const only = codes.only ? [...codes.only] : null;
  const except = codes.except && codes.except.length > 0 ? [...codes.except] : null;
  return inSavepoint(db, (scope) => scope<RecheckRow[]>`
      SELECT md5(to_jsonb(v)::text) AS selected_verified, md5(to_jsonb(r)::text) AS selected_raw,
             v.fee_verified_id, v.review_status, v.canonical_fee_key, v.amount AS verified_amount,
             r.fee_raw_id, r.institution_id, r.source_url, r.document_r2_key, r.extraction_confidence,
             r.fee_name, r.amount, r.frequency, r.outlier_flags, COALESCE(r.extraction_note, r.conditions) AS conditions, r.source_document_id,
             r.amount_kind, r.rate_percent, p.fee_published_id,
             md5(to_jsonb(p)::text) AS selected_published, md5(to_jsonb(f)::text) AS selected_feedback
        FROM pipeline_feedback f
        JOIN published_fee_records p ON p.fee_published_id = f.fee_published_id AND f.dedupe_key = ${prefix} || p.fee_published_id::text
        JOIN verified_fee_observations v ON v.fee_verified_id = p.lineage_ref
        JOIN raw_fee_observations r ON r.fee_raw_id = v.fee_raw_id
       WHERE f.check_name = ${DARWIN_RECHECK_CHECK}
         AND f.kind = ${PENDING_KIND}
         AND (f.evidence->>'flagged_at')::timestamptz <= NOW() - make_interval(mins => ${SECOND_LOOK_MIN_MINUTES})
         AND p.rolled_back_at IS NULL AND p.quarantined_at IS NULL
         AND v.review_status IN ('verified', 'approved')
         AND (${only}::text[] IS NULL OR split_part(f.evidence->>'reason', ':', 2) = ANY(${only}::text[]))
         AND (${except}::text[] IS NULL OR split_part(COALESCE(f.evidence->>'reason', ''), ':', 2) <> ALL(${except}::text[]))
       ORDER BY (f.evidence->>'flagged_at')::timestamptz ASC, p.fee_published_id
       LIMIT ${limit}::int
    `);
}

/** Read-only: what the due second looks would do (#1397). Writes nothing. */
export async function dueSecondLookShadow(db: SqlTag, options: { limit?: number; codes?: DueCodeFilter } = {}): Promise<DueSecondLookShadow> {
  const shadow: DueSecondLookShadow = { due: 0, wouldConfirm: {}, wouldClear: 0, samples: [] };
  try {
    const rows = await selectDueSecondLookRows(db, options.limit ?? SECOND_LOOK_DUE_LIMIT, options.codes);
    if (rows.length === 0) return shadow;
    // In a savepoint, so a failed text read cannot abort the step's transaction.
    const texts = await inSavepoint(db, (scope) => textsFor(scope, rows));
    for (const row of rows) {
      shadow.due += 1;
      const { canonicalFeeKey, amount, check } = recheckOf(row, texts);
      if (!check) {
        shadow.wouldClear += 1;
        continue;
      }
      shadow.wouldConfirm[check.code] = (shadow.wouldConfirm[check.code] ?? 0) + 1;
      if (shadow.samples.length < 20) {
        shadow.samples.push({ feePublishedId: Number(row.fee_published_id), institutionId: Number(row.institution_id), canonicalFeeKey, feeName: row.fee_name ?? "", amount, code: check.code });
      }
    }
  } catch (error) {
    return { ...shadow, error: error instanceof Error ? error.message : String(error) };
  }
  return shadow;
}

function selectRows(db: SqlTag, limit: number, reselectCohort: boolean): Promise<RecheckRow[]> {
  return inSavepoint(db, (scope) => scope<RecheckRow[]>`
      SELECT md5(to_jsonb(v)::text) AS selected_verified, md5(to_jsonb(r)::text) AS selected_raw,
             v.fee_verified_id, v.review_status, v.canonical_fee_key, v.amount AS verified_amount,
             r.fee_raw_id, r.institution_id, r.source_url, r.document_r2_key, r.extraction_confidence,
             r.fee_name, r.amount, r.frequency, r.outlier_flags, COALESCE(r.extraction_note, r.conditions) AS conditions, r.source_document_id,
             r.amount_kind, r.rate_percent,
             (SELECT md5(to_jsonb(p)::text) FROM published_fee_records p
               WHERE p.lineage_ref = v.fee_verified_id AND p.rolled_back_at IS NULL
               ORDER BY p.fee_published_id DESC LIMIT 1) AS selected_published,
             (SELECT md5(to_jsonb(f)::text) FROM published_fee_records p
                LEFT JOIN pipeline_feedback f ON f.dedupe_key = ${secondLookDedupeKey(DARWIN_RECHECK_CHECK, 0).replace(/0$/, "")} || p.fee_published_id::text
               WHERE p.lineage_ref = v.fee_verified_id AND p.rolled_back_at IS NULL
               ORDER BY p.fee_published_id DESC LIMIT 1) AS selected_feedback,
             (SELECT p.fee_published_id FROM published_fee_records p
               WHERE p.lineage_ref = v.fee_verified_id AND p.rolled_back_at IS NULL
               ORDER BY p.fee_published_id DESC LIMIT 1) AS fee_published_id
        FROM verified_fee_observations v
        JOIN raw_fee_observations r ON r.fee_raw_id = v.fee_raw_id
       WHERE (
           (v.review_status IN ('verified', 'approved') AND EXISTS (
             SELECT 1 FROM pipeline_attempts pa
              WHERE pa.input_fingerprint = 'raw:' || v.fee_raw_id::text
                AND pa.strategy = ${DARWIN_VERIFY_STRATEGY.strategy}
                AND pa.strategy_version = ${DARWIN_VERIFY_STRATEGY.version}
                AND pa.detail->>'decision' = 'verified'
           ))
           OR (v.review_status = 'rejected' AND EXISTS (
             SELECT 1 FROM jsonb_array_elements_text(COALESCE(v.outlier_flags, '[]'::jsonb)) flag
              WHERE flag LIKE ${`${RECHECK_REJECTED_FLAG_PREFIX}:%`}
           ))
         )
         AND (${!reselectCohort} OR EXISTS (
           SELECT 1 FROM pipeline_attempts pa
            WHERE pa.input_fingerprint = 'raw:' || v.fee_raw_id::text
              AND pa.strategy = ${DARWIN_VERIFY_STRATEGY.strategy}
              AND pa.detail->>'reason_code' = 'not_in_source'
         ))
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_attempts pa
            WHERE pa.input_fingerprint = 'verified:' || v.fee_verified_id::text
              AND pa.strategy = ${DARWIN_RECHECK_STRATEGY.strategy}
              AND pa.strategy_version = ${DARWIN_RECHECK_STRATEGY.version}
         )
       ORDER BY v.fee_verified_id DESC
       LIMIT ${limit}::int
    `);
}

/** The recheck's verdict on one row: the checks after the source check, then the tier-perk test. Pure. */
function recheckOf(row: RecheckRow, texts: Map<number, string>) {
  const canonicalFeeKey = refileCategory(row.canonical_fee_key, row.fee_name) ?? row.canonical_fee_key;
  const amount = normalizedAmount(row.verified_amount ?? row.amount);
  const line = sourceLineFor(row, texts, canonicalFeeKey) ?? excerptOf(row.conditions);
  const text = row.source_document_id == null ? null : texts.get(Number(row.source_document_id)) ?? null;
  const check: { code: string; rule?: string } | null = postSourceCheck(canonicalFeeKey, row.fee_name, amount, line, text)
    ?? (tierPerkZero(amount, row.fee_name, row.source_url, text, canonicalFeeKey) ? { code: "tier_perk_zero" } : null);
  return { canonicalFeeKey, amount, line, check };
}

function textsFor(db: SqlTag, rows: RecheckRow[]): Promise<Map<number, string>> {
  return loadSourceTexts(db, Array.from(new Set(rows.flatMap((row) => (row.source_document_id == null ? [] : [Number(row.source_document_id)])))));
}

/** Read-only: what the recheck would do to a sample of older live rows (#1568). Writes nothing. */
export async function olderLiveShadow(db: SqlTag, options: { runId: number; limit?: number }): Promise<OlderLiveShadow> {
  const shadow: OlderLiveShadow = { read: 0, wouldFail: {}, samples: [] };
  try {
    const limit = options.limit ?? OLDER_LIVE_SHADOW_LIMIT;
    let rows = await selectOlderLiveRows(db, limit, "random");
    // A start near the top finds fewer than the limit: wrap round to the lowest ids.
    if (rows.length < limit) {
      const seen = new Set(rows.map((row) => String(row.fee_verified_id)));
      const wrapped = await selectOlderLiveRows(db, limit - rows.length, "start");
      rows = [...rows, ...wrapped.filter((row) => !seen.has(String(row.fee_verified_id)))];
    }
    if (rows.length === 0) return shadow;
    // In a savepoint, so a failed text read cannot abort the step's transaction.
    const texts = await inSavepoint(db, (scope) => textsFor(scope, rows));
    for (const row of rows) {
      shadow.read += 1;
      const { canonicalFeeKey, amount, check } = recheckOf(row, texts);
      if (!check) continue;
      shadow.wouldFail[check.code] = (shadow.wouldFail[check.code] ?? 0) + 1;
      if (shadow.samples.length < 20) {
        shadow.samples.push({
          feePublishedId: Number(row.fee_published_id),
          feeVerifiedId: Number(row.fee_verified_id),
          institutionId: Number(row.institution_id),
          canonicalFeeKey,
          feeName: row.fee_name ?? "",
          amount,
          code: check.code,
        });
      }
    }
  } catch (error) {
    return { ...shadow, error: error instanceof Error ? error.message : String(error) };
  }
  return shadow;
}

export const RECHECK_EXECUTION_PROTOCOL = "darwin.recheck.execution.v1";
type PhaseState = "complete" | "partial" | "unavailable" | "not_run" | "cadence_skip" | "reported_unknown";
export type RecheckUnresolvedCode = "invalid_run_context" | "transaction_unavailable" | "selection_failed" | "source_unavailable" | "identity_changed" | "settlement_failed" | "producer_witness_failed";
export interface RecheckExecution {
  protocol: typeof RECHECK_EXECUTION_PROTOCOL;
  scope: "selected_batch";
  state: "complete" | "partial" | "unavailable";
  runId: number | null;
  stepId: number | null;
  batchKey: string;
  eventId: number | null;
  selected: number | null;
  assessed: number;
  settled: number;
  unresolved: number;
  phases: { primary: PhaseState; due: PhaseState; source: PhaseState; olderShadow: PhaseState; dueShadow: PhaseState };
  reasonCode: RecheckUnresolvedCode | null;
  samples: Array<{ feeVerifiedId: number; code: RecheckUnresolvedCode }>;
}
interface RecheckOptions {
  runId: number;
  stepId?: number | null;
  limit?: number;
  now?: Date;
  sameStepTakedown?: boolean;
  olderLive?: boolean;
  secondLooks?: boolean;
  secondLookCodes?: readonly string[];
}
interface SelectedText {
  id: number | string;
  source_document_id: number | string;
  institution_id: number | string;
  document_institution_id: number | string;
  normalized_text: string;
  selected_source: string;
  selected_document: string;
}
class RecheckDeferred extends Error {
  constructor(readonly code: RecheckUnresolvedCode) { super(code); }
}
function positiveId(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0;
}
function executionFor(options: RecheckOptions): RecheckExecution {
  return { protocol: RECHECK_EXECUTION_PROTOCOL, scope: "selected_batch", state: "unavailable", runId: positiveId(options.runId) ? options.runId : null,
    stepId: positiveId(options.stepId) ? options.stepId : null, batchKey: randomUUID(), eventId: null, selected: null, assessed: 0, settled: 0, unresolved: 0,
    phases: { primary: "not_run", due: "not_run", source: "not_run", olderShadow: "not_run", dueShadow: "not_run" }, reasonCode: null, samples: [] };
}
function freshResult(execution: RecheckExecution): VerifiedRecheckResult {
  return { ...EMPTY, rejected: [], restored: [], takenDown: [], secondLookOtherCode: 0, execution };
}
function defer(execution: RecheckExecution, id: number, code: RecheckUnresolvedCode) {
  execution.unresolved += 1;
  if (execution.samples.length < 20) execution.samples.push({ feeVerifiedId: id, code });
}
/** Pure check remains shared with shadow assessment; no new rule/replay version. */
export const recheckAssessment = recheckOf;

/** Existing members only, NOWAIT: no serializability or unselected-new-row phantom claim. */
async function lockSelected(db: SqlTag, row: RecheckRow, text: SelectedText, dueOrigin: boolean) {
  const publishedId = row.fee_published_id == null ? null : Number(row.fee_published_id);
  if (publishedId != null) {
    const [published] = await db<{ stamp: string; lineage_ref: number | string; institution_id: number | string; rolled_back_at: unknown; quarantined_at: unknown }[]>`
      SELECT md5(to_jsonb(p)::text) AS stamp, lineage_ref, institution_id, rolled_back_at, quarantined_at
        FROM published_fee_records p WHERE fee_published_id = ${publishedId} FOR UPDATE NOWAIT
    `;
    if (!published || published.stamp !== row.selected_published || Number(published.lineage_ref) !== Number(row.fee_verified_id)
      || Number(published.institution_id) !== Number(row.institution_id) || published.rolled_back_at != null || published.quarantined_at != null) throw new RecheckDeferred("identity_changed");
  }
  const [verified] = await db<{ stamp: string; fee_raw_id: number | string; institution_id: number | string }[]>`SELECT md5(to_jsonb(v)::text) AS stamp,fee_raw_id,institution_id FROM verified_fee_observations v WHERE fee_verified_id=${Number(row.fee_verified_id)} FOR UPDATE NOWAIT`;
  const [raw] = await db<{ stamp: string }[]>`SELECT md5(to_jsonb(r)::text) AS stamp FROM raw_fee_observations r WHERE fee_raw_id=${Number(row.fee_raw_id)} FOR UPDATE NOWAIT`;
  if (!verified || !raw || verified.stamp !== row.selected_verified || raw.stamp !== row.selected_raw
    || Number(verified.fee_raw_id) !== Number(row.fee_raw_id) || Number(verified.institution_id) !== Number(row.institution_id)) throw new RecheckDeferred("identity_changed");
  const live = await db<{ fee_published_id: number | string }[]>`
    SELECT fee_published_id FROM published_fee_records WHERE lineage_ref=${Number(row.fee_verified_id)} AND rolled_back_at IS NULL ORDER BY fee_published_id LIMIT 2
  `;
  if (live.length !== (publishedId == null ? 0 : 1) || (publishedId != null && Number(live[0]?.fee_published_id) !== publishedId)) throw new RecheckDeferred("identity_changed");
  if (publishedId != null) {
    const [feedback] = await db<{ stamp: string }[]>`SELECT md5(to_jsonb(f)::text) AS stamp FROM pipeline_feedback f WHERE dedupe_key=${secondLookDedupeKey(DARWIN_RECHECK_CHECK, publishedId)} FOR UPDATE NOWAIT`;
    if ((feedback?.stamp ?? null) !== row.selected_feedback) throw new RecheckDeferred("identity_changed");
    const [correction] = await db<{ present: boolean }[]>`SELECT EXISTS (SELECT 1 FROM published_fee_corrections WHERE fee_published_id=${publishedId} AND status='current') AS present`;
    if (correction?.present) throw new RecheckDeferred("identity_changed");
  }
  const [document] = await db<{ stamp: string }[]>`SELECT md5(to_jsonb(d)::text) AS stamp FROM source_documents d WHERE id=${Number(text.source_document_id)} FOR SHARE NOWAIT`;
  const [source] = await db<{ stamp: string }[]>`SELECT md5(to_jsonb(t)::text) AS stamp FROM agent_source_texts t WHERE id=${Number(text.id)} FOR SHARE NOWAIT`;
  if (!document || !source || document.stamp !== text.selected_document || source.stamp !== text.selected_source) throw new RecheckDeferred("identity_changed");
  if (!dueOrigin) {
    const [already] = await db<{ present: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pipeline_attempts WHERE input_fingerprint=${`verified:${row.fee_verified_id}`} AND strategy=${DARWIN_RECHECK_STRATEGY.strategy} AND strategy_version=${DARWIN_RECHECK_STRATEGY.version}) AS present`;
    if (already?.present) throw new RecheckDeferred("identity_changed");
  }
}

/**
 * Requires a real ledger transaction. Its producer event commits with effects; the later
 * finishAgenticStep receipt is a reference, not the transaction boundary or a new measurement.
 */
export function unavailableRecheckResult(options: RecheckOptions): VerifiedRecheckResult {
  const execution = executionFor(options); execution.reasonCode = "producer_witness_failed";
  return freshResult(execution);
}
export async function recheckVerifiedFees(db: SqlTag, options: RecheckOptions): Promise<VerifiedRecheckResult> {
  let execution = executionFor(options);
  if (!positiveId(options.runId) || !positiveId(options.stepId)) {
    execution.reasonCode = "invalid_run_context"; return freshResult(execution);
  }
  if (typeof (db as unknown as { savepoint?: unknown }).savepoint !== "function") {
    execution.reasonCode = "transaction_unavailable"; return freshResult(execution);
  }
  try {
    return await inSavepoint(db, async scope => {
      const [context] = await scope<{ id: number | string }[]>`
        SELECT s.id FROM agent_run_steps s JOIN agent_runs r ON r.id=s.agent_run_id
         WHERE r.id=${options.runId} AND s.id=${options.stepId} AND s.step_key IN ('classify','verify')
      `;
      if (!context) throw new RecheckDeferred("invalid_run_context");
      const result = freshResult(execution);
      const limit = Math.max(1, Math.min(options.limit ?? RECHECK_LIMIT, 1_000));
      const olderLive = options.olderLive ?? DARWIN_RECHECK_OLDER_LIVE;
      const secondLooks = options.secondLooks ?? DARWIN_RECHECK_SECOND_LOOK_LIVE;
      const secondLookCodes = secondLooks ? [] : [...(options.secondLookCodes ?? DARWIN_RECHECK_SECOND_LOOK_LIVE_CODES)];
      const sameStep = options.sameStepTakedown ?? DARWIN_RECHECK_SAME_STEP_TAKEDOWN;
      if (!olderLive && options.runId % OLDER_LIVE_SHADOW_EVERY === 0) {
        result.olderLive = await olderLiveShadow(scope, { runId: options.runId });
        execution.phases.olderShadow = result.olderLive.error ? "partial" : "reported_unknown";
      } else execution.phases.olderShadow = olderLive ? "not_run" : "cadence_skip";
      if (!secondLooks) {
        result.dueSecondLooks = await dueSecondLookShadow(scope, { codes: { except: secondLookCodes } });
        execution.phases.dueShadow = result.dueSecondLooks.error ? "partial" : "reported_unknown";
      }
      let rows: RecheckRow[] = [];
      const dueIds = new Set<string>();
      try {
        rows = await selectRows(scope, limit, true);
        if (rows.length === 0) rows = await selectRows(scope, limit, false);
        if (olderLive) rows = [...rows, ...await selectOlderLiveRows(scope, Math.ceil(limit / 2), null)];
        execution.phases.primary = "complete";
      } catch {
        // A later primary selector may fail after an earlier one returned rows. The
        // original failed-primary path acts on none; do not retain a hidden partial batch.
        rows = []; execution.phases.primary = "unavailable"; execution.reasonCode = "selection_failed";
      }
      // Preserve original short circuit: a failed primary selection does not expand due work.
      if (execution.phases.primary === "complete" && (secondLooks || secondLookCodes.length > 0)) {
        try {
          const seen = new Set(rows.map(row => String(row.fee_verified_id)));
          const due = (await selectDueSecondLookRows(scope, SECOND_LOOK_DUE_LIMIT, secondLooks ? {} : { only: secondLookCodes })).filter(row => !seen.has(String(row.fee_verified_id)));
          for (const row of due) dueIds.add(String(row.fee_verified_id));
          rows = [...rows, ...due]; execution.phases.due = "complete";
        } catch { execution.phases.due = "unavailable"; execution.reasonCode = "selection_failed"; }
      }
      if (rows.length > 1_600) throw new RecheckDeferred("producer_witness_failed");
      execution.selected = execution.phases.primary === "complete" ? rows.length : null;
      let sources: SelectedText[] = [];
      if (rows.length > 0) {
        try {
          sources = await inSavepoint(scope, tx => tx<SelectedText[]>`
            SELECT DISTINCT ON (t.source_document_id) t.id, t.source_document_id, t.institution_id, d.institution_id AS document_institution_id,
                   t.normalized_text, md5(to_jsonb(t)::text) AS selected_source, md5(to_jsonb(d)::text) AS selected_document
              FROM agent_source_texts t JOIN source_documents d ON d.id=t.source_document_id
             WHERE t.source_document_id=ANY(${rows.flatMap(row => row.source_document_id == null ? [] : [Number(row.source_document_id)])}::bigint[])
               AND t.status='completed' AND t.normalized_text IS NOT NULL
             ORDER BY t.source_document_id,t.id DESC
          `); execution.phases.source = "complete";
        } catch { execution.phases.source = "unavailable"; }
      } else execution.phases.source = execution.phases.primary === "complete" ? "complete" : "not_run";
      const texts = new Map(sources.map(text => [Number(text.source_document_id), text.normalized_text]));
      const witnesses: Array<{ feeVerifiedId: number; attemptId: number; feedbackIds: number[]; action: string }> = [];
      for (const row of rows) {
        const id = Number(row.fee_verified_id);
        const text = sources.find(text => Number(text.source_document_id) === Number(row.source_document_id));
        if (!text || !text.normalized_text.trim() || Number(text.institution_id) !== Number(row.institution_id) || Number(text.document_institution_id) !== Number(row.institution_id)) {
          execution.phases.source = execution.phases.source === "unavailable" ? "unavailable" : "partial";
          defer(execution, id, "source_unavailable"); continue;
        }
        let assessed = false;
        try {
          const settled = await inSavepoint(scope, async tx => {
            await lockSelected(tx, row, text, dueIds.has(String(id)));
            const { canonicalFeeKey, amount, check } = recheckOf(row, texts);
            assessed = true;
            if (check && dueIds.has(String(id)) && !secondLooks && !secondLookCodes.includes(check.code)) return { otherCode: true as const };
            const publishedId = row.fee_published_id == null ? null : Number(row.fee_published_id);
            const wasRejected = row.review_status === "rejected";
            const reason = check ? `${RECHECK_REJECTED_FLAG_PREFIX}:${check.code}${check.rule ? `:${check.rule}` : ""}` : "";
            let action = wasRejected ? "still_rejected" : "passed";
            let feedbackIds: number[] = [], flagged = 0, waiting = 0, cleared = 0;
            if (wasRejected && !check) {
              const updated = await tx<{ fee_verified_id: number | string; fee_raw_id: number | string; review_status: string }[]>`
                UPDATE verified_fee_observations v SET review_status='verified',
                  outlier_flags=COALESCE((SELECT jsonb_agg(flag) FROM jsonb_array_elements(COALESCE(v.outlier_flags,'[]'::jsonb)) flag WHERE flag #>> '{}' NOT LIKE ${`${RECHECK_REJECTED_FLAG_PREFIX}:%`}), '[]'::jsonb)
                 WHERE fee_verified_id=${id} AND review_status='rejected' AND md5(to_jsonb(v)::text)=${row.selected_verified} RETURNING fee_verified_id,fee_raw_id,review_status
              `;
              if (updated.length !== 1 || Number(updated[0].fee_verified_id) !== id || Number(updated[0].fee_raw_id) !== Number(row.fee_raw_id) || updated[0].review_status !== "verified") throw new RecheckDeferred("identity_changed");
              action = "restored";
            } else if (!wasRejected && check && publishedId == null) {
              const updated = await tx<{ fee_verified_id: number | string; fee_raw_id: number | string; review_status: string }[]>`
                UPDATE verified_fee_observations v SET review_status='rejected',
                  outlier_flags=CASE WHEN COALESCE(v.outlier_flags,'[]'::jsonb) ? ${reason} THEN v.outlier_flags ELSE COALESCE(v.outlier_flags,'[]'::jsonb)||jsonb_build_array(${reason}::text) END
                 WHERE fee_verified_id=${id} AND review_status IN ('verified','approved') AND md5(to_jsonb(v)::text)=${row.selected_verified} RETURNING fee_verified_id,fee_raw_id,review_status
              `;
              if (updated.length !== 1 || Number(updated[0].fee_verified_id) !== id || Number(updated[0].fee_raw_id) !== Number(row.fee_raw_id) || updated[0].review_status !== "rejected") throw new RecheckDeferred("identity_changed");
              action = "rejected";
            } else if (publishedId != null && !wasRejected) {
              const candidate = { feePublishedId: publishedId, institutionId: Number(row.institution_id), canonicalFeeKey, amount,
                sourceDocumentId: Number(row.source_document_id), reason };
              let archive = Boolean(check && sameStep);
              if (!sameStep || !check) {
                const look = await secondLook(tx, { check: DARWIN_RECHECK_CHECK, runId: options.runId,
                  failing: check ? [candidate] : [], passing: check ? [] : [publishedId], dryRun: false, now: options.now, strictPersistence: true });
                feedbackIds = look.feedbackIds ?? []; flagged = look.flagged; waiting = look.waiting; cleared = look.cleared;
                archive = look.confirmed.length === 1;
              }
              action = check ? (archive ? "taken_down" : flagged ? "flagged" : "waiting") : "passed";
              if (archive) {
                const archived = await tx<{ fee_published_id: number | string; lineage_ref: number | string }[]>`
                  UPDATE published_fee_records p SET rolled_back_at=NOW(), rolled_back_by_batch_id=${`darwin-recheck-${options.runId}`},rolled_back_reason=${reason}
                   WHERE fee_published_id=${publishedId} AND lineage_ref=${id} AND rolled_back_at IS NULL AND quarantined_at IS NULL
                     AND md5(to_jsonb(p)::text)=${row.selected_published} RETURNING fee_published_id,lineage_ref
                `;
                if (archived.length !== 1 || Number(archived[0].lineage_ref) !== id || Number(archived[0].fee_published_id) !== publishedId) throw new RecheckDeferred("identity_changed");
                const rejected = await tx<{ fee_verified_id: number | string; fee_raw_id: number | string; review_status: string }[]>`
                  UPDATE verified_fee_observations v SET review_status='rejected', outlier_flags=CASE WHEN COALESCE(outlier_flags,'[]'::jsonb) ? ${reason} THEN outlier_flags ELSE COALESCE(outlier_flags,'[]'::jsonb)||jsonb_build_array(${reason}::text) END
                   WHERE fee_verified_id=${id} AND review_status IN ('verified','approved') AND md5(to_jsonb(v)::text)=${row.selected_verified} RETURNING fee_verified_id,fee_raw_id,review_status
                `;
                if (rejected.length !== 1 || Number(rejected[0].fee_verified_id) !== id || Number(rejected[0].fee_raw_id) !== Number(row.fee_raw_id) || rejected[0].review_status !== "rejected") throw new RecheckDeferred("identity_changed");
              }
            }
            const attemptId = await recordAttestedAttempt(tx, { institutionId: Number(row.institution_id), sourceDocumentId: Number(row.source_document_id),
              stage: "verify", strategy: DARWIN_RECHECK_STRATEGY.strategy, version: DARWIN_RECHECK_STRATEGY.version, fingerprint: `verified:${id}`,
              outcome: check ? "evidence_mismatch" : "ok", yieldCount: check ? 0 : 1, costMicrousd: 0, durationMs: 0, runId: options.runId, stepId: options.stepId, foldIntoPlaybook: false,
              detail: { protocol: RECHECK_EXECUTION_PROTOCOL, batch_key: execution.batchKey, fee_verified_id: id, fee_raw_id: Number(row.fee_raw_id), fee_published_id: publishedId,
                canonical_fee_key: canonicalFeeKey, amount, code: check?.code ?? null, rule: check?.rule ?? null, action, feedback_ids: feedbackIds,
                selected_raw: row.selected_raw, selected_verified: row.selected_verified, selected_published: row.selected_published,
                source_text_id: Number(text.id), normalized_text_sha256: createHash("sha256").update(text.normalized_text).digest("hex") } });
            return { otherCode: false as const, action, code: check?.code, publishedId, attemptId, feedbackIds, flagged, waiting, cleared, passed: !wasRejected && !check };
          });
          execution.assessed += 1;
          if (settled.otherCode) { result.secondLookOtherCode = (result.secondLookOtherCode ?? 0) + 1; continue; }
          execution.settled += 1; result.checked += 1;
          if (settled.passed) result.passed += 1;
          if (settled.action === "restored") result.restored.push(id);
          if (settled.action === "rejected") result.rejected.push({ feeVerifiedId: id, code: settled.code! });
          if (settled.action === "taken_down") result.takenDown.push(settled.publishedId!);
          result.flagged += settled.flagged; result.waiting += settled.waiting; result.cleared += settled.cleared;
          witnesses.push({ feeVerifiedId: id, attemptId: settled.attemptId, feedbackIds: settled.feedbackIds, action: settled.action });
        } catch (error) {
          if (assessed) execution.assessed += 1;
          defer(execution, id, error instanceof RecheckDeferred ? error.code : "settlement_failed");
        }
      }
      // Legacy shadow helpers still report unknown assessment completeness; they do not
      // become attested source/fee decisions merely because this producer has a v2 receipt.
      execution.state = execution.phases.primary === "unavailable" ? "unavailable"
        : execution.reasonCode || execution.unresolved || Object.values(execution.phases).some(state => state === "unavailable" || state === "partial") ? "partial" : "complete";
      const proof = { execution, witnesses, selectedManifest: createHash("sha256").update(JSON.stringify(rows.map(row => [row.fee_verified_id,row.selected_verified,row.selected_raw,row.selected_published,row.selected_feedback]))).digest("hex") };
      const payload = JSON.stringify(proof);
      if (Buffer.byteLength(payload, "utf8") > 262_144) throw new RecheckDeferred("producer_witness_failed");
      const events = await scope<{ id: number | string; matches: boolean }[]>`
        INSERT INTO agent_run_events (agent_run_id,step_id,event_type,status,message,detail)
        VALUES (${options.runId},${options.stepId},'darwin.recheck.assessed',${execution.state === "complete" ? "completed" : "blocked"},'Darwin selected-batch recheck execution witness.',${payload}::jsonb) RETURNING id,(agent_run_id=${options.runId} AND step_id=${options.stepId} AND event_type='darwin.recheck.assessed' AND detail=${payload}::jsonb) AS matches
      `;
      const eventId = Number(events[0]?.id);
      if (events.length !== 1 || events[0].matches !== true || !positiveId(eventId)) throw new RecheckDeferred("producer_witness_failed");
      execution.eventId = eventId;
      if (result.takenDown.length > 0) invalidatePublicReadCache();
      return result;
    });
  } catch (error) {
    execution = executionFor(options);
    execution.reasonCode = error instanceof RecheckDeferred ? error.code : "producer_witness_failed";
    return freshResult(execution);
  }
}
