import { createHash, randomUUID } from "node:crypto";
import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { recordAttestedAttempt } from "@/lib/agents/learning/attempts";
import { inSavepoint } from "@/lib/agents/savepoint";
import { EVAL_VERDICT_SECOND_BATCH_ACTS, failsOnlyAtV9 } from "@/lib/agents/hamilton/eval-verdicts";
import { excerptOf } from "@/lib/agents/hamilton/frequency-fill";
import { PENDING_KIND, SECOND_LOOK_MIN_MINUTES, secondLook, secondLookDedupeKey } from "@/lib/agents/hamilton/second-look";
import { refileCategory } from "@/lib/fee-category-guard";
import { ERROR_FIXES, errorFixVerifyTargets, type ErrorFixEntry } from "@/lib/agents/deming/error-fix-targets";

import { TIER_PATH_SQL, TIER_PERK_RULE_VERSION, tierPerkZero } from "./tier-perk";
import { DARWIN_CONDITIONAL_ZERO_LAYOUT_LIVE, DARWIN_VERIFY_STRATEGY, loadSourceTexts, normalizedAmount, postSourceCheck, sourceLineFor, type RawFeeRow } from "./verify";

type SqlTag = typeof sql;

/**
 * Darwin's own second look at the rows it verified: every row verified by `verify.rules` is
 * read once more under the checks that follow the source check (`postSourceCheck`: live
 * category, no conditional $0, Hamilton's name rules). A row that fails and is not live is
 * rejected with a flag; one that is live is flagged through the shared 12-hour second look and
 * archived (rolled back with the reason, never deleted) once that look confirms it. Never a hand
 * UPDATE. Each row is read once per
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
 * 2026-10-26 (#1593, still v5): the last two of those 8 (published 38491, 56797) pass under the page
 * layout evidence behind `DARWIN_CONDITIONAL_ZERO_LAYOUT_LIVE` (on since 2026-10-31). No version bump: a bump would
 * re-read every verified row under every rule change since v5 with no dry-run count. Rows the
 * recheck reads anyway record on a failing `conditional_zero` attempt whether that evidence would
 * pass them (`layout_would_pass`). The switch turned on (2026-10-31, #2072) without a bump either:
 * the layout cohort (`LAYOUT_RULE_VERSION`) re-reads only the rows a v5 read failed as conditional $0.
 */
export const DARWIN_RECHECK_STRATEGY = { strategy: "verify.recheck", version: 5 } as const;
export const RECHECK_LIMIT = 200;
/** The shared second look's check name while live failures are only flagged. */
export const DARWIN_RECHECK_CHECK = "darwin.verified_recheck";
export const RECHECK_REJECTED_FLAG_PREFIX = "darwin_recheck";
/**
 * Default-off switch (#1568): also re-read live fees that `verify.rules` verified under an older
 * version. The recheck reads only rows of the current verify version, so a rule added here never
 * reached fees that went live earlier (15 live tier-perk $0s, Oct 16). Off, each step reads a
 * sample of those rows and reports what the recheck would do (`olderLive`), writing nothing; on,
 * they join the recheck and fail or pass like any other row. It turns on by PR once James approves
 * the dry-run count by reason.
 * On 2026-10-25 by the sampled-clean rule: a dry run of all 3,266 older live rows against their stored
 * texts fails 4, all `conditional_zero`, each read against the bank's own text and right (a $0 only
 * with e-Statements, direct deposit or a balance). A fifth, a Notary Fee $0 beside a non-customer
 * price ("$5.00 charge for non-F&M customers"), was the rule's error and passes now.
 */
export const DARWIN_RECHECK_OLDER_LIVE = true;
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
 * On 2026-10-25 with `DARWIN_RECHECK_OLDER_LIVE`: no flag was due on a live fee (all 48 pending flags
 * sit on fees already down), so it reaches only the 4 older rows above, 12 hours after their first look.
 */
export const DARWIN_RECHECK_SECOND_LOOK_LIVE = true;
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
/**
 * Default-off switch (#1397, tier-perk rule v2): also re-read live $0 fees whose document address
 * is a tier's own schedule under `TIER_PATH_SQL` and that no recheck at this version has read under
 * the current tier-perk rule (`detail.tier_rule`). The recheck reads each row once per version, and
 * a version bump would re-read every live fee under every check, so a widened tier test reaches
 * the live $0s it newly matches only through this narrow cohort. Each read is recorded on a
 * `verify.recheck` attempt carrying `tier_rule`, so a row is read once per rule version; a failure
 * goes through the shared 12-hour second look like any other.
 * Dry run, prod read-only, 2026-10-26: 13 live $0 fees at 3 institutions newly match (a Bank On
 * truth-in-savings disclosure, a Bank On summary of fees and a premium account's terms and charges);
 * the stored-text read is in `docs/project/findings/2026-10-26-tier-schedule-addresses.md`.
 * It turns on by PR once James approves that count.
 */
export const DARWIN_RECHECK_TIER_RULE_LIVE = false;
export const TIER_RULE_LIMIT = 100;
export const SECOND_LOOK_DUE_LIMIT = 100;
/**
 * The error loop's re-run of a verify fix (#2058): live fees named by a registered verify fix
 * (`error-fixes.json`, stage verify) whose verified row no recheck has read since the fix merged
 * are read once more per step, up to this many, under today's checks. The recheck otherwise reads a
 * row once per version, and a version bump would re-read every verified row. Each read is recorded
 * on its `verify.recheck` attempt with the fix's PR (`error_fix_pr`); Deming's daily error-fix
 * re-check reads that verdict. A failure takes the shared 12-hour second look like any other.
 * Nothing is selected while no verify fix is registered.
 */
export const ERROR_FIX_RECHECK_LIMIT = 100;
/**
 * The page layout's own re-read (#1593, #2072). The layout evidence behind
 * `DARWIN_CONDITIONAL_ZERO_LAYOUT_LIVE` only frees $0s the conditional-$0 test holds, so the only
 * verdicts it can change are rows a recheck at this version failed as `conditional_zero`. While the
 * switch is on, each step re-reads up to `LAYOUT_RULE_LIMIT` of those rows (verified, or rejected
 * with a `darwin_recheck:conditional_zero` flag) that no read at this version has judged with the
 * layout evidence (`detail.layout_rule`), under today's checks; a row that passes now is restored
 * (rejected) or cleared (live), one that still fails is left as it is. Each read records
 * `layout_rule` on its attempt, so a row is read once per layout rule version. A version bump would
 * instead re-read every verified row under every rule change since v5.
 * Dry run, prod read-only, 2026-10-31 (this code over all 89,642 live and recheck-rejected rows and
 * their stored texts): the cohort is 65 rows, all rejected and none live. With the layout evidence
 * 2 pass (verified 37685 / once-published 38491, 59671 / 56797); 2 more pass under today's checks
 * without it (104598, 117104: "Below minimum balance fee (per month) | None" on a savings schedule).
 * 61 still fail. No live fee changes. On since 2026-10-31 with the layout switch (James, "Turn on
 * all 7", #2072): those 4 rejected $0 fees are restored to verified as the cohort reads them.
 */
export const LAYOUT_RULE_VERSION = 1;
export const LAYOUT_RULE_LIMIT = 100;

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
  /** Named fees of a registered verify fix read this step (#2058, `ERROR_FIX_RECHECK_LIMIT`). */
  errorFixRead?: number;
  /** The verify-fix cohort's selection failed (its own savepoint); the rest of the recheck went on. */
  errorFixError?: string;
  /** Rows the layout cohort read this step (#1593, `LAYOUT_RULE_LIMIT`), while the layout switch is on. */
  layoutRuleRead?: number;
  /** The layout cohort's selection failed (its own savepoint); the rest of the recheck went on. */
  layoutRuleError?: string;
  /**
   * Live fees only name rules v9 fail, left untouched while `EVAL_VERDICT_SECOND_BATCH_ACTS` is off
   * (#1696): not flagged, not confirmed, no attempt recorded, so the recheck reads them again once
   * the switch is on. Published ids.
   */
  secondBatchDeferred?: number[];
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
 * Live $0 fees on a tier's own schedule by address (`TIER_PATH_SQL`) that no recheck at this
 * version has read under the current tier-perk rule (#1397, `DARWIN_RECHECK_TIER_RULE_LIVE`).
 */
function selectTierRuleRows(db: SqlTag, limit: number): Promise<RecheckRow[]> {
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
         AND COALESCE(v.amount, r.amount) = 0
         AND regexp_replace(COALESCE(r.source_url, ''), '^[a-z]+://[^/]+', '', 'i') ~* ${TIER_PATH_SQL}
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_attempts pa
            WHERE pa.input_fingerprint = 'verified:' || v.fee_verified_id::text
              AND pa.strategy = ${DARWIN_RECHECK_STRATEGY.strategy}
              AND pa.strategy_version = ${DARWIN_RECHECK_STRATEGY.version}
              AND COALESCE((pa.detail->>'tier_rule')::int, 1) >= ${TIER_PERK_RULE_VERSION}::int
         )
       ORDER BY v.fee_verified_id DESC
       LIMIT ${limit}::int
    `);
}

/**
 * The layout cohort's rows (#1593): rows a recheck at this version failed as `conditional_zero`,
 * still verified or rejected with that flag, that no read at this version has judged with the page
 * layout evidence (`detail.layout_rule`). Pure selection; `LAYOUT_RULE_VERSION`.
 */
function selectLayoutRuleRows(db: SqlTag, limit: number): Promise<RecheckRow[]> {
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
       WHERE v.fee_verified_id IN (
           SELECT substring(pa.input_fingerprint FROM 10)::bigint FROM pipeline_attempts pa
            WHERE pa.strategy = ${DARWIN_RECHECK_STRATEGY.strategy}
              AND pa.strategy_version = ${DARWIN_RECHECK_STRATEGY.version}
              AND pa.input_fingerprint LIKE 'verified:%'
              AND pa.detail->>'code' = 'conditional_zero'
         )
         AND (v.review_status IN ('verified', 'approved') OR (v.review_status = 'rejected' AND EXISTS (
           SELECT 1 FROM jsonb_array_elements_text(COALESCE(v.outlier_flags, '[]'::jsonb)) flag
            WHERE flag LIKE ${`${RECHECK_REJECTED_FLAG_PREFIX}:conditional_zero%`}
         )))
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_attempts pa
            WHERE pa.input_fingerprint = 'verified:' || v.fee_verified_id::text
              AND pa.strategy = ${DARWIN_RECHECK_STRATEGY.strategy}
              AND pa.strategy_version = ${DARWIN_RECHECK_STRATEGY.version}
              AND COALESCE((pa.detail->>'layout_rule')::int, 0) >= ${LAYOUT_RULE_VERSION}::int
         )
       ORDER BY v.fee_verified_id DESC
       LIMIT ${limit}::int
    `);
}

/**
 * The verify-fix cohort's rows (#2058): the verified rows behind live fees a registered verify fix
 * names, not yet read by a recheck since that fix merged (`errorFixVerifyTargets`), each with the
 * fix it is read for.
 */
async function selectErrorFixRows(db: SqlTag, limit: number, entries: readonly ErrorFixEntry[]): Promise<Array<RecheckRow & { error_fix_pr: number; error_fix_since: string }>> {
  if (!entries.some((entry) => entry.stage === "verify")) return [];
  return inSavepoint(db, async (scope) => {
    const targets = await errorFixVerifyTargets(scope, { limit, recheckStrategy: DARWIN_RECHECK_STRATEGY.strategy, entries });
    if (targets.length === 0) return [];
    const fix = new Map(targets.map((target) => [Number(target.fee_verified_id), Number(target.pr)]));
    const since = new Map(entries.map((entry) => [entry.pr, entry.merged_on]));
    const rows = await scope<RecheckRow[]>`
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
       WHERE v.fee_verified_id = ANY(${[...fix.keys()]}::bigint[])
         AND v.review_status IN ('verified', 'approved')
       ORDER BY v.fee_verified_id DESC
    `;
    return rows.map((row) => {
      const pr = fix.get(Number(row.fee_verified_id))!;
      return { ...row, error_fix_pr: pr, error_fix_since: since.get(pr)! };
    });
  });
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

/**
 * The recheck's verdict on one row: the checks after the source check, then the tier-perk test.
 * `layout` reads the page layout evidence (`DARWIN_CONDITIONAL_ZERO_LAYOUT_LIVE` by default). Pure.
 */
function recheckOf(row: RecheckRow, texts: Map<number, string>, layout: boolean = DARWIN_CONDITIONAL_ZERO_LAYOUT_LIVE) {
  const canonicalFeeKey = refileCategory(row.canonical_fee_key, row.fee_name) ?? row.canonical_fee_key;
  const amount = normalizedAmount(row.verified_amount ?? row.amount);
  const line = sourceLineFor(row, texts, canonicalFeeKey) ?? excerptOf(row.conditions);
  const text = row.source_document_id == null ? null : texts.get(Number(row.source_document_id)) ?? null;
  const check: { code: string; rule?: string } | null = postSourceCheck(canonicalFeeKey, row.fee_name, amount, line, text, { layout })
    ?? (tierPerkZero(amount, row.fee_name, row.source_url, text, canonicalFeeKey) ? { code: "tier_perk_zero" } : null);
  return { canonicalFeeKey, amount, line, check, layoutWouldPass: layout ? null : layoutWouldPass(check, canonicalFeeKey, row, amount, line, text) };
}

/**
 * While the layout evidence is off (`DARWIN_CONDITIONAL_ZERO_LAYOUT_LIVE` false, or a caller passes
 * `layout: false`): true when a row failing `conditional_zero`
 * would pass every check with the page layout evidence on (#1593), the dry run recorded on the
 * row's attempt; null when it does not apply (the switch is on, or the row fails another code or
 * none). Pure.
 */
function layoutWouldPass(check: { code: string } | null, canonicalFeeKey: string, row: RecheckRow, amount: number | null, line: string | null, text: string | null): boolean | null {
  if (check?.code !== "conditional_zero") return null;
  return postSourceCheck(canonicalFeeKey, row.fee_name, amount, line, text, { layout: true }) == null
    && !tierPerkZero(amount, row.fee_name, row.source_url, text, canonicalFeeKey);
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
  olderLive?: boolean;
  secondLooks?: boolean;
  secondLookCodes?: readonly string[];
  /** Overrides `EVAL_VERDICT_SECOND_BATCH_ACTS` (#1696). */
  secondBatchActs?: boolean;
  /** Overrides `DARWIN_RECHECK_TIER_RULE_LIVE` (#1397). */
  tierRule?: boolean;
  /** Overrides `DARWIN_CONDITIONAL_ZERO_LAYOUT_LIVE` for the recheck: its checks and its layout cohort (#1593). */
  layoutRule?: boolean;
  /** The error-fix registry the verify-fix cohort reads (#2058); the shipped one by default. */
  errorFixes?: readonly ErrorFixEntry[];
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
  return { ...EMPTY, rejected: [], restored: [], takenDown: [], secondLookOtherCode: 0, secondBatchDeferred: [], execution };
}
function defer(execution: RecheckExecution, id: number, code: RecheckUnresolvedCode) {
  execution.unresolved += 1;
  if (execution.samples.length < 20) execution.samples.push({ feeVerifiedId: id, code });
}
/** Pure check remains shared with shadow assessment; no new rule/replay version. */
export const recheckAssessment = recheckOf;

/** Existing members only, NOWAIT: no serializability or unselected-new-row phantom claim. */
async function lockSelected(db: SqlTag, row: RecheckRow, text: SelectedText, origin: "primary" | "due" | "tier_rule" | "error_fix" | "layout_rule", errorFixSince?: string) {
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
  if (origin === "primary") {
    const [already] = await db<{ present: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pipeline_attempts WHERE input_fingerprint=${`verified:${row.fee_verified_id}`} AND strategy=${DARWIN_RECHECK_STRATEGY.strategy} AND strategy_version=${DARWIN_RECHECK_STRATEGY.version}) AS present`;
    if (already?.present) throw new RecheckDeferred("identity_changed");
  } else if (origin === "tier_rule") {
    // #1397: read again only while no attempt at this version has read it under the current tier rule.
    const [already] = await db<{ present: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pipeline_attempts WHERE input_fingerprint=${`verified:${row.fee_verified_id}`} AND strategy=${DARWIN_RECHECK_STRATEGY.strategy} AND strategy_version=${DARWIN_RECHECK_STRATEGY.version} AND COALESCE((detail->>'tier_rule')::int, 1) >= ${TIER_PERK_RULE_VERSION}::int) AS present`;
    if (already?.present) throw new RecheckDeferred("identity_changed");
  } else if (origin === "layout_rule") {
    // #1593: read again only while no attempt at this version has read it with the layout evidence.
    const [already] = await db<{ present: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pipeline_attempts WHERE input_fingerprint=${`verified:${row.fee_verified_id}`} AND strategy=${DARWIN_RECHECK_STRATEGY.strategy} AND strategy_version=${DARWIN_RECHECK_STRATEGY.version} AND COALESCE((detail->>'layout_rule')::int, 0) >= ${LAYOUT_RULE_VERSION}::int) AS present`;
    if (already?.present) throw new RecheckDeferred("identity_changed");
  } else if (origin === "error_fix") {
    // #2058: read again only while no recheck has read it since its fix merged.
    const [already] = await db<{ present: boolean }[]>`SELECT EXISTS (SELECT 1 FROM pipeline_attempts WHERE input_fingerprint=${`verified:${row.fee_verified_id}`} AND strategy=${DARWIN_RECHECK_STRATEGY.strategy} AND created_at >= (${errorFixSince ?? "infinity"}::date::timestamp AT TIME ZONE 'UTC')) AS present`;
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
  const stepId = options.stepId;
  if (typeof (db as unknown as { savepoint?: unknown }).savepoint !== "function") {
    execution.reasonCode = "transaction_unavailable"; return freshResult(execution);
  }
  try {
    return await inSavepoint(db, async scope => {
      const [context] = await scope<{ id: number | string }[]>`
        SELECT s.id FROM agent_run_steps s JOIN agent_runs r ON r.id=s.agent_run_id
         WHERE r.id=${options.runId} AND s.id=${stepId} AND s.step_key IN ('classify','verify')
      `;
      if (!context) throw new RecheckDeferred("invalid_run_context");
      const result = freshResult(execution);
      const limit = Math.max(1, Math.min(options.limit ?? RECHECK_LIMIT, 1_000));
      const olderLive = options.olderLive ?? DARWIN_RECHECK_OLDER_LIVE;
      const secondLooks = options.secondLooks ?? DARWIN_RECHECK_SECOND_LOOK_LIVE;
      const secondLookCodes = secondLooks ? [] : [...(options.secondLookCodes ?? DARWIN_RECHECK_SECOND_LOOK_LIVE_CODES)];
      const secondBatchActs = options.secondBatchActs ?? EVAL_VERDICT_SECOND_BATCH_ACTS;
      const tierRule = options.tierRule ?? DARWIN_RECHECK_TIER_RULE_LIVE;
      const layoutRule = options.layoutRule ?? DARWIN_CONDITIONAL_ZERO_LAYOUT_LIVE;
      const errorFixes = options.errorFixes ?? ERROR_FIXES;
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
      const tierRuleIds = new Set<string>();
      const errorFixIds = new Map<string, { pr: number; since: string }>();
      const layoutRuleIds = new Set<string>();
      try {
        rows = await selectRows(scope, limit, true);
        if (rows.length === 0) rows = await selectRows(scope, limit, false);
        if (olderLive) rows = [...rows, ...await selectOlderLiveRows(scope, Math.ceil(limit / 2), null)];
        if (tierRule) {
          const seen = new Set(rows.map(row => String(row.fee_verified_id)));
          const cohort = (await selectTierRuleRows(scope, TIER_RULE_LIMIT)).filter(row => !seen.has(String(row.fee_verified_id)));
          for (const row of cohort) tierRuleIds.add(String(row.fee_verified_id));
          rows = [...rows, ...cohort];
        }
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
      // #2058: a registered verify fix's named fees, read once more since the fix merged. After the
      // due rows, so a row due its second look keeps the due path; a row the primary selection holds
      // is read there, which serves the fix as well. Its own savepoint: a failed selection is
      // reported and the rest of the recheck goes on.
      if (execution.phases.primary === "complete") {
        const seen = new Set(rows.map(row => String(row.fee_verified_id)));
        const cohort = (await selectErrorFixRows(scope, ERROR_FIX_RECHECK_LIMIT, errorFixes).catch((error: unknown) => {
          result.errorFixError = error instanceof Error ? error.message : String(error);
          return [];
        })).filter(row => !seen.has(String(row.fee_verified_id)));
        for (const row of cohort) errorFixIds.set(String(row.fee_verified_id), { pr: row.error_fix_pr, since: row.error_fix_since });
        rows = [...rows, ...cohort];
      }
      // #1593: with the layout evidence on, the rows a v5 read failed as conditional $0 and no read has
      // judged with it. Last, so a row another path holds keeps that path; its own savepoint.
      if (execution.phases.primary === "complete" && layoutRule) {
        const seen = new Set(rows.map(row => String(row.fee_verified_id)));
        const cohort = (await selectLayoutRuleRows(scope, LAYOUT_RULE_LIMIT).catch((error: unknown) => {
          result.layoutRuleError = error instanceof Error ? error.message : String(error);
          return [];
        })).filter(row => !seen.has(String(row.fee_verified_id)));
        for (const row of cohort) layoutRuleIds.add(String(row.fee_verified_id));
        rows = [...rows, ...cohort];
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
            const errorFix = errorFixIds.get(String(id));
            await lockSelected(tx, row, text, dueIds.has(String(id)) ? "due" : tierRuleIds.has(String(id)) ? "tier_rule" : errorFix ? "error_fix" : layoutRuleIds.has(String(id)) ? "layout_rule" : "primary", errorFix?.since);
            const { canonicalFeeKey, amount, check, line, layoutWouldPass: layoutPass } = recheckOf(row, texts, layoutRule);
            assessed = true;
            // #1696: a live fee only the v9 name rules fail belongs to Hamilton's second takedown
            // batch; while its switch is off, this path neither flags nor archives it.
            if (!secondBatchActs && check?.code === "name_rule" && row.fee_published_id != null && row.review_status !== "rejected"
              && failsOnlyAtV9(canonicalFeeKey, row.fee_name, amount, line)) return { secondBatch: Number(row.fee_published_id) };
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
              const look = await secondLook(tx, { check: DARWIN_RECHECK_CHECK, runId: options.runId,
                failing: check ? [candidate] : [], passing: check ? [] : [publishedId], dryRun: false, now: options.now, strictPersistence: true });
              feedbackIds = look.feedbackIds ?? []; flagged = look.flagged; waiting = look.waiting; cleared = look.cleared;
              const archive = look.confirmed.length === 1;
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
              outcome: check ? "evidence_mismatch" : "ok", yieldCount: check ? 0 : 1, costMicrousd: 0, durationMs: 0, runId: options.runId, stepId, foldIntoPlaybook: false,
              detail: { protocol: RECHECK_EXECUTION_PROTOCOL, batch_key: execution.batchKey, fee_verified_id: id, fee_raw_id: Number(row.fee_raw_id), fee_published_id: publishedId,
                canonical_fee_key: canonicalFeeKey, amount, code: check?.code ?? null, rule: check?.rule ?? null, tier_rule: TIER_PERK_RULE_VERSION, ...(layoutPass == null ? {} : { layout_would_pass: layoutPass }), ...(layoutRule ? { layout_rule: LAYOUT_RULE_VERSION } : {}), ...(errorFix ? { error_fix_pr: errorFix.pr } : {}), action, feedback_ids: feedbackIds,
                selected_raw: row.selected_raw, selected_verified: row.selected_verified, selected_published: row.selected_published,
                source_text_id: Number(text.id), normalized_text_sha256: createHash("sha256").update(text.normalized_text).digest("hex") } });
            return { otherCode: false as const, action, code: check?.code, publishedId, attemptId, feedbackIds, flagged, waiting, cleared, passed: !wasRejected && !check };
          });
          execution.assessed += 1;
          if ("secondBatch" in settled && settled.secondBatch != null) { result.secondBatchDeferred!.push(settled.secondBatch); continue; }
          if (settled.otherCode) { result.secondLookOtherCode = (result.secondLookOtherCode ?? 0) + 1; continue; }
          execution.settled += 1; result.checked += 1;
          if (errorFixIds.has(String(id))) result.errorFixRead = (result.errorFixRead ?? 0) + 1;
          if (layoutRuleIds.has(String(id))) result.layoutRuleRead = (result.layoutRuleRead ?? 0) + 1;
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
        VALUES (${options.runId},${stepId},'darwin.recheck.assessed',${execution.state === "complete" ? "completed" : "blocked"},'Darwin selected-batch recheck execution witness.',${payload}::jsonb) RETURNING id,(agent_run_id=${options.runId} AND step_id=${stepId} AND event_type='darwin.recheck.assessed' AND detail=${payload}::jsonb) AS matches
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
