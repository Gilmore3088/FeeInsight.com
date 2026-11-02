import type { sql } from "@/lib/data-store/connection";
import { inSavepoint } from "@/lib/agents/savepoint";
import { learningSchemaReady, recordAttempt } from "@/lib/agents/learning/attempts";
import type { AttemptOutcome } from "@/lib/agents/learning/outcomes";
import { feedbackSchemaReady, recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { currentCopySchemaReady } from "@/lib/agents/magellan/current-copy";
import { LIVE_SOURCE_REFETCH_DAYS } from "@/lib/agents/magellan/live-source-refetch";
import { runFreeSpecialists } from "@/lib/agents/knox/specialists";
import { insertCandidateWithLearning, type KnoxTextRow } from "@/lib/agents/knox/extract";
import { loadTakedownLessons } from "@/lib/agents/knox/takedown-lessons";
import { lineKey } from "@/lib/agents/knox/reread-feedback";
import type { ExtractedFeeCandidate } from "@/lib/agents/knox/rules";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { checkFeeCategory, refileCategory } from "@/lib/fee-category-guard";
import { foldContext } from "@/lib/fee-fold";
import { withinAmountEnvelope } from "./envelopes";
import { DARWIN_REJECT_SECOND_LOOK_HOURS, releaseCategoryPattern } from "./release-held";
import { DARWIN_VERIFY_STRATEGY, rawFeeFingerprint } from "./verify";
import { HOLD_REFETCH_REQUEST_KIND, HOLD_SOURCE_REREAD_CHECK, HOLD_SOURCE_REREAD_LIVE, HOLD_SOURCE_REREAD_STRATEGY } from "./hold-source-reread-switch";

export { HOLD_REFETCH_REQUEST_KIND, HOLD_SOURCE_REREAD_CHECK, HOLD_SOURCE_REREAD_LIVE, HOLD_SOURCE_REREAD_STRATEGY } from "./hold-source-reread-switch";

type SqlTag = typeof sql;

/**
 * Holds cleared by reading the bank's page again (Pipeline wiring audit, Nov 2, gap 2; #1115 step 2).
 *
 * On Nov 2 prod held 5,551 fees for range (`outside_envelope`) or peer (`peer_outlier`) review, median
 * age 24 days, oldest Oct 4. The release pass (`release-held.ts`) judges each against the stored copy
 * it was read from, and its releases have been paused since Oct 8; nothing ever fetched the page
 * again or had Knox read it again, so a hold read from a stale copy, or misread by an older Knox
 * rules version, stayed held. The only re-read channel (`knox_reread_requested`, read by
 * `knox/reread-feedback.ts`) carries live fragment names, not holds.
 *
 * A verify step, at most once every HOLD_SOURCE_REREAD_INTERVAL_MINUTES across lanes (a one-bank run
 * always, for its bank), takes the oldest range and peer holds (HOLD_SOURCE_REREAD_LIMIT) and routes each
 * by the bank's current copy of its page (the document itself, or the copy that superseded it):
 * - `refetch`: the current copy was last fetched or confirmed over LIVE_SOURCE_REFETCH_DAYS ago.
 *   Magellan is asked for a fresh copy (`HOLD_REFETCH_REQUEST_KIND`, read by Magellan's live-source
 *   pass, `magellan/live-source-refetch.ts`, which fetches it as it fetches pages live fees cite).
 *   A new copy supersedes the old one; the same bytes move its check date forward. Either way the
 *   hold's next route is `reread`.
 * - `no_text`: a fresh copy with no completed text yet. Counted; Rosetta's own queue reads it.
 * - `reread`: Knox's free team (`runFreeSpecialists`, rules only, no provider call) reads the current
 *   copy's newest text again, and `judgeHoldReread` decides:
 *   - `confirmed`: today's team reads the fee's name in its category at the held amount, and the
 *     shared source check traces it. The hold goes back to Darwin's verify step, which judges it
 *     once more under today's rules (`holdRereadRecheckSql`): it clears when today's range and peer
 *     checks accept it, and is held again (a fresh hold) when they do not.
 *   - `changed`: today's team reads the name in its category at exactly one other amount, the
 *     source check traces that amount and no longer finds the held one. The new read goes in as a
 *     raw row through Knox's own insert path (`insertCandidateWithLearning`, as Knox's re-read pass
 *     inserts), so Darwin verifies it as any read, and the held row is retired (flags
 *     `superseded_by_reread`, `HOLD_REREAD_REPLACED_FLAG`). The retire comes first, in the same
 *     savepoint (`replaceHeldWithReread`): `superseded_by_reread` is the flag Knox's take-over and
 *     Darwin's held re-check read, so a read with the held row's own key (a recategorized read of
 *     the copy it came from) re-keys the held row under today's category (`knox_reread_took_over`)
 *     and sends it to Darwin. A write that leaves no row keeps the hold, unless another live or
 *     pending row already has the new read's key.
 *   - `recategorized`: no read in the held category, but today's team reads the same line at the
 *     same amount under exactly one other category ("Reissue Lost/Stolen Visa ATM/Check Card" $15,
 *     held as a non-network ATM fee, read today as a card replacement); the category guard accepts
 *     the name there and the source check traces it. Replaced the same way as `changed`.
 *   - `not_found`: no read of the name at any amount and the source check finds neither the name nor
 *     the amount as the fee (`name_not_in_text`, `amount_not_the_fee`; a balance threshold is
 *     still on the page and stays held). Scrapping is a last resort (James, Oct 7): the first such look is
 *     `not_found_pending`; a second at least DARWIN_REJECT_SECOND_LOOK_HOURS later archives the held
 *     row (flag `HOLD_REREAD_ARCHIVED_FLAG`, never deleted; the flag is the takedown route of a
 *     row that was never live).
 *   - Kept as held: `stated_unread` (the shared check finds it, or finds its amount as a threshold,
 *     but today's team reads no such line, a Knox miss), `ambiguous` (several other amounts), `refused` (the other amount fails the
 *     category guard or the source trace), `unconfirmed` (read at the held amount but not traced).
 *
 * Every handled hold gets one `pipeline_attempts` row (stage `verify`, HOLD_SOURCE_REREAD_STRATEGY),
 * keyed by `detail.reread_key` (`fetch:<doc>`, `notext:<doc>`, `text:<text id>`), so a hold is read
 * once per current text: a refetch request again after LIVE_SOURCE_REFETCH_DAYS, a pending
 * not-found once more after its wait. The step writes one `darwin.hold_source_reread` event.
 *
 * HOLD_SOURCE_REREAD_LIVE off (or a dry run): the step routes the batch and re-reads up to
 * HOLD_SOURCE_REREAD_SAMPLE of its texts, and reports the counts; it writes no attempt, request, raw
 * row or flag (the event only, outside a dry run).
 */
export const HOLD_SOURCE_REREAD_LIMIT = 100;
/** Texts re-read per step with the switch off (a report). */
export const HOLD_SOURCE_REREAD_SAMPLE = 10;
/** Decisions kept as samples in the step's ledger detail (`samples`), on or off. */
export const HOLD_SOURCE_REREAD_SAMPLES = 15;
/** Minutes between whole-table passes (a one-bank run always reads its bank's holds). */
export const HOLD_SOURCE_REREAD_INTERVAL_MINUTES = 30;
/** The re-read stops starting new texts after this long, so the verify step keeps its time. */
export const HOLD_SOURCE_REREAD_BUDGET_MS = 20_000;
/** A current copy fetched or confirmed this recently is fresh (Magellan's live-source window). */
export const HOLD_SOURCE_STALE_DAYS = LIVE_SOURCE_REFETCH_DAYS;
/** A raw row this pass inserted from a changed re-read. */
export const HOLD_REREAD_FLAG = "darwin_hold_reread";
/** On a held row a changed re-read replaced. */
export const HOLD_REREAD_REPLACED_FLAG = "darwin_hold_reread_replaced";
/** On a held row the bank's current copy no longer states, after two looks. */
export const HOLD_REREAD_ARCHIVED_FLAG = "darwin_hold_not_on_current_copy";

export type HoldRoute = "refetch" | "no_text" | "reread" | "no_document";
/** Outcomes whose new read replaces the held row. */
export const HOLD_REREAD_REPLACING: ReadonlySet<HoldRereadOutcome> = new Set(["changed", "recategorized"]);

export type HoldRereadOutcome =
  | "confirmed"
  | "changed"
  | "recategorized"
  | "not_found_pending"
  | "not_found"
  | "stated_unread"
  | "ambiguous"
  | "refused"
  | "unconfirmed"
  | "no_text";

export interface HoldRereadRow {
  fee_raw_id: number | string;
  institution_id: number | string;
  source_document_id: number | string | null;
  fee_name: string | null;
  amount: number | string | null;
  held_reason: string;
  held_canonical_fee_key: string;
  held_at: string | Date;
  current_document_id: number | string | null;
  current_url: string | null;
  current_checked_at: string | Date | null;
  document_text_id: number | string | null;
  text_hash: string | null;
  text_source_url: string | null;
  route: HoldRoute;
  reread_key: string;
  /** The first `not_found_pending` look on this key, when there was one. */
  first_not_found_at: string | Date | null;
}

export interface HoldRereadVerdict {
  outcome: HoldRereadOutcome;
  /** `changed`: today's read. */
  candidate?: ExtractedFeeCandidate;
  newAmount?: number;
  /** `recategorized`: the category today's read files the line under. */
  newKey?: string;
  /** `ambiguous`: the categories today's reads file the line under. */
  newKeys?: string[];
  /** `changed` / `recategorized`: the new read sits inside its category's hand-set range. */
  newWithinRange?: boolean;
  sourceLine?: string;
  refusedBy?: string;
  readAmounts?: number[];
}

export interface HoldRereadDecision extends HoldRereadVerdict {
  feeRawId: number;
  institutionId: number;
  feeName: string;
  amount: number | null;
  heldReason: string;
  canonicalFeeKey: string;
  route: HoldRoute;
  superseded: boolean;
  rereadKey: string;
}

export interface HoldRereadResult {
  live: boolean;
  dryRun: boolean;
  /** A whole-table pass ran within HOLD_SOURCE_REREAD_INTERVAL_MINUTES, so this step read nothing. */
  skipped?: boolean;
  /** A one-bank run: its event does not count as the whole-table pass. */
  scoped?: boolean;
  selected: number;
  routes: Partial<Record<HoldRoute, number>>;
  /** Of the batch, holds whose own document a newer copy superseded. */
  superseded: number;
  /** Holds re-read this step (all `reread` routes on, up to the sample off). */
  reread: number;
  outcomes: Partial<Record<HoldRereadOutcome, number>>;
  /** Live: documents Magellan was asked to fetch again. */
  refetchRequested: number;
  /** Live: holds handed back to the verify step (`confirmed`). */
  handedBack: number;
  /** Live: held rows a changed read replaced (a new raw row, or one already live or pending). */
  replaced: number[];
  /** Live: held rows Knox's take-over re-keyed under today's category and sent back to Darwin. */
  takenOver: number[];
  /** Live: held rows archived after two not-found looks. */
  archived: number[];
  attempts: number;
  samples: HoldRereadDecision[];
  failed: boolean;
}

const num = (value: number | string | null | undefined): number | null => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const sameAmount = (a: number, b: number) => Math.abs(a - b) < 0.005;

/** The category Darwin's verify files a read under (as its other re-read checks read it). */
function filedKey(candidate: ExtractedFeeCandidate, text: string): string {
  return refileCategory(candidate.canonicalHint, candidate.feeName, foldContext(text, candidate.feeName, candidate.amount)) ?? candidate.canonicalHint;
}

/** A read of the held fee's line: the same name, or (for a name of 3+ words) an excerpt holding it as whole words. */
function readsName(candidate: ExtractedFeeCandidate, name: string): boolean {
  const key = lineKey(name);
  if (!key) return false;
  if (lineKey(candidate.feeName) === key) return true;
  return key.split(" ").length >= 3 && ` ${lineKey(candidate.excerpt)} `.includes(` ${key} `);
}

/**
 * The source check's not-stated reasons: the name is not on the page, or the amount is not its price.
 * A balance threshold (`amount_is_a_threshold`, "$1,000.00 minimum balance") is not one: on a
 * minimum-balance fee the threshold is the value (held raw 117384, "Talbot" $1,500), and on any other
 * fee the amount is still on the page. It stays held as `stated_unread`.
 */
const NOT_STATED = new Set(["name_not_in_text", "amount_not_the_fee"]);

/**
 * Pure: what today's free read of the current copy makes of one held fee. `text` is the current
 * copy's newest completed text and `candidates` today's free read of it; `secondLook` is true when
 * a `not_found_pending` look on the same text is at least DARWIN_REJECT_SECOND_LOOK_HOURS old.
 */
export function judgeHoldReread(
  row: Pick<HoldRereadRow, "fee_name" | "amount" | "held_canonical_fee_key">,
  text: string | null | undefined,
  candidates: ExtractedFeeCandidate[],
  secondLook = false,
): HoldRereadVerdict {
  const amount = num(row.amount);
  const name = (row.fee_name ?? "").replace(/\s+/g, " ").trim();
  const key = row.held_canonical_fee_key;
  if (!text || !text.trim() || amount == null || !name) return { outcome: "no_text" };
  const pattern = releaseCategoryPattern(key) ?? ".";
  const onName = candidates.filter((candidate) => readsName(candidate, name));
  const inCategory = onName.filter((candidate) => candidate.canonicalHint === key || filedKey(candidate, text) === key);
  const readAmounts = [...new Set(inCategory.map((candidate) => Math.round(candidate.amount * 100) / 100))].sort((a, b) => a - b);
  const held = checkFeeAgainstSource(text, name, amount, pattern, key);
  const heldReason = held.ok ? null : held.reason;
  const heldStated = held.ok || heldReason === "tiered_fee" || heldReason === "category_not_in_text";

  if (inCategory.some((candidate) => sameAmount(candidate.amount, amount))) {
    if (!held.ok) return { outcome: "unconfirmed", refusedBy: `source_check:${heldReason}`, readAmounts };
    return { outcome: "confirmed", sourceLine: held.sourceLine, readAmounts };
  }
  const others = readAmounts.filter((value) => !sameAmount(value, amount));
  if (others.length > 1) return { outcome: "ambiguous", readAmounts };
  if (others.length === 1) {
    // The held amount still printed as this fee's price: the page holds both, so no replacement.
    if (heldStated) return { outcome: "ambiguous", readAmounts };
    const newAmount = others[0];
    const candidate = inCategory.find((entry) => sameAmount(entry.amount, newAmount)) as ExtractedFeeCandidate;
    const newName = candidate.feeName.replace(/\s+/g, " ").trim();
    if (!checkFeeCategory(key, newName, { amount: newAmount }).ok) return { outcome: "refused", refusedBy: "category_guard", newAmount, readAmounts };
    const traced = checkFeeAgainstSource(text, newName, newAmount, pattern, key);
    if (!traced.ok) return { outcome: "refused", refusedBy: `source_check:${traced.reason}`, newAmount, readAmounts };
    return {
      outcome: "changed",
      candidate: { ...candidate, canonicalHint: key },
      newAmount,
      newWithinRange: withinAmountEnvelope(key, newAmount, newName),
      sourceLine: traced.sourceLine,
      readAmounts,
    };
  }
  // No read of the name in its category. Today's team reading the same line at the same price under
  // exactly one other category re-files it: the hold was a misfiled read (a card reissue held as a
  // non-network ATM fee), and the new read replaces it.
  const otherKeys = new Map<string, ExtractedFeeCandidate>();
  for (const candidate of onName) {
    if (sameAmount(candidate.amount, amount)) otherKeys.set(filedKey(candidate, text), candidate);
  }
  if (otherKeys.size > 1) return { outcome: "ambiguous", readAmounts, newKeys: [...otherKeys.keys()] };
  if (otherKeys.size === 1) {
    const [[newKey, candidate]] = [...otherKeys];
    const newName = candidate.feeName.replace(/\s+/g, " ").trim();
    if (!checkFeeCategory(newKey, newName, { amount }).ok) return { outcome: "refused", refusedBy: "category_guard", newKey, readAmounts };
    const traced = checkFeeAgainstSource(text, newName, amount, releaseCategoryPattern(newKey) ?? ".", newKey);
    if (!traced.ok) return { outcome: "refused", refusedBy: `source_check:${traced.reason}`, newKey, readAmounts };
    return {
      outcome: "recategorized",
      candidate: { ...candidate, canonicalHint: newKey },
      newKey,
      newWithinRange: withinAmountEnvelope(newKey, amount, newName),
      sourceLine: traced.sourceLine,
      readAmounts,
    };
  }
  // A line the shared check still finds (or finds as a threshold) keeps the fee held: only a page
  // that states neither the name nor the amount as its price is a not-found.
  if (heldStated || heldReason === "amount_is_a_threshold") return { outcome: "stated_unread", readAmounts };
  if (onName.length > 0 || !heldReason || !NOT_STATED.has(heldReason)) {
    return { outcome: "refused", refusedBy: onName.length > 0 ? "read_in_other_category" : `source_check:${heldReason}`, readAmounts };
  }
  return { outcome: secondLook ? "not_found" : "not_found_pending", refusedBy: `source_check:${heldReason}`, readAmounts };
}

/** Pure: a hold's route from its current copy (see the module note). */
export function holdRoute(row: Pick<HoldRereadRow, "current_document_id" | "current_checked_at" | "document_text_id">, now: Date = new Date()): HoldRoute {
  if (row.current_document_id == null) return "no_document";
  const checked = row.current_checked_at == null ? null : new Date(row.current_checked_at).getTime();
  if (checked == null || !Number.isFinite(checked) || checked < now.getTime() - HOLD_SOURCE_STALE_DAYS * 86_400_000) return "refetch";
  if (row.document_text_id == null) return "no_text";
  return "reread";
}

/**
 * Read-only: the oldest range and peer holds this pass would handle now, each with its current copy,
 * route and re-read key. `$1` the row cap, `$2` an institution id or null.
 * The step's own read; run in a read-only transaction for the dry run.
 */
export function holdRereadRowsSql(): string {
  const stale = `make_interval(days => ${HOLD_SOURCE_STALE_DAYS})`;
  return `
    WITH held AS (
      SELECT fr.fee_raw_id, fr.institution_id, fr.source_document_id, fr.fee_name, fr.amount,
             last.created_at AS held_at, last.reason AS held_reason, last.canonical_fee_key AS held_canonical_fee_key
        FROM raw_fee_observations fr
        JOIN LATERAL (
          SELECT pa.detail->>'reason_code' AS reason, pa.detail->>'decision' AS decision,
                 pa.detail->>'canonical_fee_key' AS canonical_fee_key, pa.created_at
            FROM pipeline_attempts pa
           WHERE pa.input_fingerprint = 'raw:' || fr.fee_raw_id::text
             AND pa.strategy = '${DARWIN_VERIFY_STRATEGY.strategy}'
             AND pa.strategy_version = ${DARWIN_VERIFY_STRATEGY.version}
           ORDER BY pa.created_at DESC
           LIMIT 1
        ) last ON TRUE
       WHERE fr.source = 'knox'
         AND fr.outlier_flags ? 'needs_darwin_verification'
         AND NOT EXISTS (SELECT 1 FROM verified_fee_observations fv WHERE fv.fee_raw_id = fr.fee_raw_id)
         AND last.decision = 'needs_review'
         AND last.reason IN ('outside_envelope', 'peer_outlier')
         AND last.canonical_fee_key IS NOT NULL
         AND ($2::bigint IS NULL OR fr.institution_id = $2::bigint)
    ), routed AS (
      SELECT h.*, cur.id AS current_document_id, cur.document_url AS current_url,
             COALESCE(cur.last_checked_at, cur.crawled_at) AS current_checked_at,
             txt.id AS document_text_id, txt.text_hash, txt.source_url AS text_source_url,
             CASE
               WHEN cur.id IS NULL THEN 'no_document'
               WHEN COALESCE(cur.last_checked_at, cur.crawled_at) IS NULL
                 OR COALESCE(cur.last_checked_at, cur.crawled_at) < NOW() - ${stale} THEN 'refetch'
               WHEN txt.id IS NULL THEN 'no_text'
               ELSE 'reread'
             END AS route
        FROM held h
        LEFT JOIN source_documents sd ON sd.id = h.source_document_id
        LEFT JOIN source_documents cur ON cur.id = COALESCE(sd.superseded_by_id, sd.id)
        LEFT JOIN LATERAL (
          SELECT t.id, t.text_hash, t.source_url FROM agent_source_texts t
           WHERE t.source_document_id = cur.id
             AND t.status = 'completed'
             AND t.normalized_text IS NOT NULL
           ORDER BY t.id DESC
           LIMIT 1
        ) txt ON TRUE
    ), keyed AS (
      SELECT r.*,
             CASE r.route
               WHEN 'no_document' THEN 'nodoc:' || r.fee_raw_id
               WHEN 'refetch' THEN 'fetch:' || r.current_document_id
               WHEN 'no_text' THEN 'notext:' || r.current_document_id
               ELSE 'text:' || r.document_text_id
             END AS reread_key
        FROM routed r
    )
    SELECT k.*, look.first_not_found_at
      FROM keyed k
      LEFT JOIN LATERAL (
        SELECT min(a.created_at) FILTER (WHERE a.detail->>'outcome' = 'not_found_pending') AS first_not_found_at,
               bool_or(CASE
                 WHEN k.route = 'refetch' THEN a.created_at > NOW() - ${stale}
                 WHEN a.detail->>'outcome' = 'not_found_pending' THEN a.created_at > NOW() - make_interval(hours => ${DARWIN_REJECT_SECOND_LOOK_HOURS})
                 ELSE TRUE
               END) AS done
          FROM pipeline_attempts a
         WHERE a.input_fingerprint = 'raw:' || k.fee_raw_id::text
           AND a.strategy = '${HOLD_SOURCE_REREAD_STRATEGY.strategy}'
           AND a.strategy_version = ${HOLD_SOURCE_REREAD_STRATEGY.version}
           AND a.detail->>'reread_key' = k.reread_key
      ) look ON TRUE
     WHERE NOT COALESCE(look.done, FALSE)
     ORDER BY k.held_at ASC, k.fee_raw_id ASC
     LIMIT $1::int`;
}

/**
 * Read-only, for the SQL editor: every range and peer hold by the route this pass would give it now,
 * with the oldest hold and the documents behind each route.
 */
export function holdRereadCountSql(): string {
  return `-- Darwin hold source re-read (${HOLD_SOURCE_REREAD_STRATEGY.strategy} v${HOLD_SOURCE_REREAD_STRATEGY.version}): range and peer holds by route. Read only.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '120s';
WITH due AS (${holdRereadRowsSql().replace(/\$1::int/, "1000000").replace(/\$2::bigint/g, "NULL::bigint")})
SELECT route, count(*) AS holds, count(*) FILTER (WHERE current_document_id IS DISTINCT FROM source_document_id) AS superseded,
       count(DISTINCT current_document_id) AS documents, min(held_at) AS oldest
  FROM due
 GROUP BY ROLLUP (route)
 ORDER BY GROUPING(route), route;
ROLLBACK;
`;
}

export function selectHoldRereadRows(db: SqlTag, options: { limit?: number; institutionId?: number } = {}): Promise<HoldRereadRow[]> {
  const limit = Math.max(1, Math.min(options.limit ?? HOLD_SOURCE_REREAD_LIMIT, 1_000));
  return db.unsafe<HoldRereadRow[]>(holdRereadRowsSql(), [limit, options.institutionId ?? null]);
}

function decisionOf(row: HoldRereadRow, verdict: HoldRereadVerdict | null): HoldRereadDecision {
  return {
    ...(verdict ?? { outcome: "no_text" as const }),
    feeRawId: Number(row.fee_raw_id),
    institutionId: Number(row.institution_id),
    feeName: row.fee_name ?? "",
    amount: num(row.amount),
    heldReason: row.held_reason,
    canonicalFeeKey: row.held_canonical_fee_key,
    route: row.route,
    superseded: row.current_document_id != null && String(row.current_document_id) !== String(row.source_document_id),
    rereadKey: row.reread_key,
  };
}

function emptyResult(live: boolean, dryRun: boolean): HoldRereadResult {
  return {
    live, dryRun, selected: 0, routes: {}, superseded: 0, reread: 0, outcomes: {}, refetchRequested: 0, handedBack: 0,
    replaced: [], takenOver: [], archived: [], attempts: 0, samples: [], failed: false,
  };
}

const ATTEMPT_OUTCOME: Record<HoldRereadOutcome | "refetch_requested" | "no_document", AttemptOutcome> = {
  confirmed: "ok",
  changed: "ok",
  recategorized: "ok",
  not_found: "rejected",
  not_found_pending: "unchanged",
  stated_unread: "unchanged",
  ambiguous: "unchanged",
  refused: "unchanged",
  unconfirmed: "unchanged",
  no_text: "empty",
  refetch_requested: "unchanged",
  no_document: "empty",
};

/**
 * One verify step's pass (see the module note). Never throws: a failed read reports `failed`, and a
 * failed write leaves that hold as it was (it is read again on a later step).
 */
export async function runHoldSourceReread(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun: boolean; institutionId?: number; live?: boolean; limit?: number; now?: Date; budgetMs?: number },
): Promise<HoldRereadResult> {
  const live = options.live ?? HOLD_SOURCE_REREAD_LIVE;
  const acts = live && !options.dryRun;
  const result = emptyResult(live, options.dryRun);
  const now = options.now ?? new Date();
  const scoped = options.institutionId != null;
  if (scoped) result.scoped = true;
  // The whole-table selection reads every hold (about 5.5 s on prod, Nov 2): at most once an interval.
  if (!scoped && !options.dryRun && await ranRecently(db, now)) return { ...result, skipped: true };
  let rows: HoldRereadRow[] = [];
  try {
    if (!(await currentCopySchemaReady(db))) return result;
    // The attempt log is the pass's memory; without it, acting would read the same holds every step.
    if (acts && !(await learningSchemaReady(db))) return result;
    rows = await inSavepoint(db, (scope) => selectHoldRereadRows(scope, { limit: options.limit, institutionId: options.institutionId }));
  } catch (error) {
    console.warn("[darwin] hold source re-read selection failed", error instanceof Error ? error.message : error);
    result.failed = true;
  }
  result.selected = rows.length;
  for (const row of rows) {
    result.routes[row.route] = (result.routes[row.route] ?? 0) + 1;
    if (row.current_document_id != null && String(row.current_document_id) !== String(row.source_document_id)) result.superseded += 1;
  }

  // Today's free team over each current text, once; off, only a sample of the texts.
  const rereadRows = rows.filter((row) => row.route === "reread");
  const textIds = [...new Set(rereadRows.map((row) => Number(row.document_text_id)))].slice(0, acts ? undefined : HOLD_SOURCE_REREAD_SAMPLE);
  const texts = new Map<number, string | null>();
  if (textIds.length > 0) {
    try {
      const loaded = await inSavepoint(db, (scope) => scope<Array<{ id: number | string; normalized_text: string | null }>>`
        SELECT id, normalized_text FROM agent_source_texts WHERE id = ANY(${textIds}::bigint[])
      `);
      for (const entry of loaded) texts.set(Number(entry.id), entry.normalized_text);
    } catch (error) {
      console.warn("[darwin] hold source re-read text load failed", error instanceof Error ? error.message : error);
      result.failed = true;
    }
  }
  const deadline = Date.now() + (options.budgetMs ?? HOLD_SOURCE_REREAD_BUDGET_MS);
  const reads = new Map<number, ExtractedFeeCandidate[]>();
  for (const id of textIds) {
    if (Date.now() > deadline) break;
    const text = texts.get(id);
    if (text == null) continue;
    try {
      reads.set(id, runFreeSpecialists(text).candidates);
    } catch (error) {
      console.warn("[darwin] hold source re-read free read failed", error instanceof Error ? error.message : error);
    }
  }

  const decisions: HoldRereadDecision[] = [];
  for (const row of rows) {
    if (row.route !== "reread") {
      decisions.push(decisionOf(row, null));
      continue;
    }
    const textId = Number(row.document_text_id);
    const candidates = reads.get(textId);
    // Not read this step (off: past the sample; on: past the time budget): left for a later step.
    if (!candidates) continue;
    const firstLook = row.first_not_found_at == null ? null : new Date(row.first_not_found_at).getTime();
    const secondLook = firstLook != null && firstLook <= now.getTime() - DARWIN_REJECT_SECOND_LOOK_HOURS * 3_600_000;
    const verdict = judgeHoldReread(row, texts.get(textId), candidates, secondLook);
    decisions.push(decisionOf(row, verdict));
    result.reread += 1;
    result.outcomes[verdict.outcome] = (result.outcomes[verdict.outcome] ?? 0) + 1;
  }
  result.samples = [
    ...decisions.filter((decision) => decision.route === "reread"),
    ...decisions.filter((decision) => decision.route !== "reread"),
  ].slice(0, HOLD_SOURCE_REREAD_SAMPLES);

  if (acts && decisions.length > 0) await act(db, rows, decisions, texts, result, options.runId, options.stepId ?? null);

  // Written even when nothing was due, so the interval clock runs; a one-bank run writes none.
  if (!options.dryRun && (!scoped || rows.length > 0)) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${HOLD_SOURCE_REREAD_CHECK}, ${result.failed ? "failed" : "completed"},
          ${holdRereadMessage(result)},
          ${JSON.stringify(holdRereadDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[darwin] hold source re-read event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

async function act(
  db: SqlTag,
  rows: HoldRereadRow[],
  decisions: HoldRereadDecision[],
  texts: Map<number, string | null>,
  result: HoldRereadResult,
  runId: number,
  stepId: number | null,
): Promise<void> {
  const byRaw = new Map(rows.map((row) => [Number(row.fee_raw_id), row]));
  const feedback = await feedbackSchemaReady(db).catch(() => false);

  // Stale copies: one Magellan request per current document (upserted, so a repeat refreshes it).
  const refetch = decisions.filter((decision) => decision.route === "refetch");
  const refetchDocs = new Map<number, HoldRereadRow[]>();
  for (const decision of refetch) {
    const row = byRaw.get(decision.feeRawId) as HoldRereadRow;
    const doc = Number(row.current_document_id);
    refetchDocs.set(doc, [...(refetchDocs.get(doc) ?? []), row]);
  }
  const requested = new Set<number>();
  if (feedback && refetchDocs.size > 0) {
    try {
      await inSavepoint(db, (scope) => recordFeedback(scope, [...refetchDocs].map(([doc, held]) => refetchRequestRow(doc, held, runId))));
      for (const doc of refetchDocs.keys()) requested.add(doc);
      result.refetchRequested = requested.size;
    } catch (error) {
      console.error("[darwin] hold source re-read refetch request failed", error instanceof Error ? error.message : error);
    }
  }

  // Changed reads: Knox's own insert path, then the held row retired. Takedown lessons once per bank.
  const changed = decisions.filter((decision) => (decision.outcome === "changed" || decision.outcome === "recategorized") && decision.candidate);
  const lessons = changed.length > 0 ? await loadTakedownLessons(db, changed.map((decision) => decision.institutionId)) : null;

  for (const decision of decisions) {
    const row = byRaw.get(decision.feeRawId) as HoldRereadRow;
    let outcome: HoldRereadOutcome | "refetch_requested" | "no_document" = decision.route === "reread" ? decision.outcome : decision.route === "refetch" ? "refetch_requested" : decision.route === "no_document" ? "no_document" : "no_text";
    // A refetch whose request was not written is left for a later step, with no attempt.
    if (decision.route === "refetch" && !requested.has(Number(row.current_document_id))) continue;
    let writeNote: string | null = null;
    try {
      await inSavepoint(db, async (scope) => {
        if ((decision.outcome === "changed" || decision.outcome === "recategorized") && decision.route === "reread" && decision.candidate && lessons) {
          const textRow: KnoxTextRow = {
            document_text_id: Number(row.document_text_id),
            source_document_id: Number(row.current_document_id),
            institution_id: Number(row.institution_id),
            source_url: row.text_source_url ?? row.current_url,
            text_hash: row.text_hash,
            normalized_text: texts.get(Number(row.document_text_id)) ?? undefined,
          };
          const written = await replaceHeldWithReread(scope, {
            feeRawId: decision.feeRawId,
            runId,
            row: textRow,
            candidate: decision.candidate,
            lessons,
          });
          writeNote = written.note;
          if (written.result === "kept") outcome = "refused";
          else if (written.result === "taken_over") result.takenOver.push(decision.feeRawId);
          else result.replaced.push(decision.feeRawId);
        } else if (decision.outcome === "not_found" && decision.route === "reread") {
          const retired = await retireHeld(scope, decision.feeRawId, [HOLD_REREAD_ARCHIVED_FLAG]);
          if (retired) result.archived.push(decision.feeRawId);
        }
        await recordAttempt(scope, {
          institutionId: decision.institutionId,
          sourceDocumentId: num(row.source_document_id),
          stage: "verify",
          strategy: HOLD_SOURCE_REREAD_STRATEGY.strategy,
          version: HOLD_SOURCE_REREAD_STRATEGY.version,
          fingerprint: rawFeeFingerprint(decision.feeRawId),
          outcome: ATTEMPT_OUTCOME[outcome],
          yieldCount: outcome === "changed" || outcome === "recategorized" ? 1 : 0,
          costMicrousd: 0,
          runId,
          stepId,
          foldIntoPlaybook: false,
          detail: { ...attemptDetail(decision, row), outcome, ...(writeNote ? { write: writeNote } : {}) },
        });
        result.attempts += 1;
        if (outcome === "confirmed") result.handedBack += 1;
      });
    } catch (error) {
      console.error("[darwin] hold source re-read write failed", error instanceof Error ? error.message : error);
      for (const list of [result.replaced, result.takenOver]) {
        const at = list.indexOf(decision.feeRawId);
        if (at >= 0) list.splice(at, 1);
      }
      const archivedAt = result.archived.indexOf(decision.feeRawId);
      if (archivedAt >= 0) result.archived.splice(archivedAt, 1);
    }
  }
}

/** True when an unscoped pass wrote its event under the interval ago. A failed read never skips. */
async function ranRecently(db: SqlTag, now: Date): Promise<boolean> {
  try {
    const rows = await inSavepoint(db, (scope) => scope<{ created_at: Date | string | null }[]>`
      SELECT created_at
        FROM agent_run_events
       WHERE event_type = ${HOLD_SOURCE_REREAD_CHECK}
         AND status = 'completed'
         AND detail->>'scoped' IS DISTINCT FROM 'true'
         AND created_at > NOW() - make_interval(mins => ${HOLD_SOURCE_REREAD_INTERVAL_MINUTES})
       ORDER BY created_at DESC, id DESC
       LIMIT 1
    `);
    const at = rows[0]?.created_at == null ? null : new Date(rows[0].created_at).getTime();
    return at != null && Number.isFinite(at) && now.getTime() - at < HOLD_SOURCE_REREAD_INTERVAL_MINUTES * 60_000;
  } catch (error) {
    console.warn("[darwin] hold source re-read interval read failed", error instanceof Error ? error.message : error);
    return false;
  }
}

/** Retire a held row: it stops going to Darwin, never deleted. Only while it is still held and unverified. */
async function retireHeld(db: SqlTag, feeRawId: number, flags: string[]): Promise<boolean> {
  const rows = await db<{ fee_raw_id: number | string }[]>`
    UPDATE raw_fee_observations fr
       SET outlier_flags = (COALESCE(fr.outlier_flags, '[]'::jsonb) - 'needs_darwin_verification') || ${JSON.stringify(flags)}::jsonb
     WHERE fr.fee_raw_id = ${feeRawId}
       AND fr.outlier_flags ? 'needs_darwin_verification'
       AND NOT EXISTS (SELECT 1 FROM verified_fee_observations fv WHERE fv.fee_raw_id = fr.fee_raw_id)
    RETURNING fr.fee_raw_id
  `;
  return rows.length > 0;
}

/** What a changed or recategorized read did to its held row. */
export interface HeldReplacement {
  /**
   * `replaced`: Knox wrote a new raw row and the held row is retired.
   * `taken_over`: the new read has the held row's own key (same document, name and amount; a
   * recategorized read of the copy it was read from), so Knox's take-over re-keyed the held row
   * under today's category (`knox_reread_took_over`, `knox_takeover_from:<old>`) and sent it to Darwin.
   * `already_read`: Knox wrote nothing, and another row with the new read's key is already live or
   * waiting for Darwin; the held row is retired.
   * `kept`: Knox wrote nothing and no such row exists; the held row stays held as it was.
   */
  result: "replaced" | "taken_over" | "already_read" | "kept";
  note: string;
}

/** Thrown inside the replacement's savepoint to roll the retire back. */
class KeepHeld extends Error {
  constructor(readonly note: string) {
    super(note);
  }
}

type CandidateInsert = typeof insertCandidateWithLearning;

/**
 * Replace a held row with today's read of it, in one savepoint.
 *
 * The held row is retired first (`superseded_by_reread`), then the read goes through Knox's insert.
 * The order matters: a recategorized read of the held row's own copy has the held row's raw key, and
 * Knox's ON CONFLICT takes over only a row without `needs_darwin_verification`. Inserted before the
 * retire, the write did nothing and the held row was retired anyway, losing the fee (held raw
 * 111826, review of Nov 2). A write that leaves no row behind rolls the retire back, unless another
 * live or pending row already carries the new read's key.
 */
export async function replaceHeldWithReread(
  db: SqlTag,
  input: {
    feeRawId: number;
    runId: number;
    row: KnoxTextRow;
    candidate: ExtractedFeeCandidate;
    lessons: Awaited<ReturnType<typeof loadTakedownLessons>>;
    /** Knox's insert; tests pass the plain one. */
    insert?: CandidateInsert;
  },
): Promise<HeldReplacement> {
  const insert = input.insert ?? insertCandidateWithLearning;
  try {
    return await inSavepoint(db, async (scope) => {
      if (!(await retireHeld(scope, input.feeRawId, ["superseded_by_reread"]))) throw new KeepHeld("not_held");
      const receipt = await insert(scope, {
        runId: input.runId,
        row: input.row,
        candidate: input.candidate,
        extraFlags: [HOLD_REREAD_FLAG],
        method: `${HOLD_SOURCE_REREAD_STRATEGY.strategy} v${HOLD_SOURCE_REREAD_STRATEGY.version} re-read of held raw #${input.feeRawId}`,
      }, input.lessons);
      if (receipt.inserted) {
        const [held] = await scope<{ pending: boolean }[]>`
          SELECT COALESCE(outlier_flags, '[]'::jsonb) ? 'needs_darwin_verification' AS pending
            FROM raw_fee_observations
           WHERE fee_raw_id = ${input.feeRawId}
        `;
        if (held?.pending) return { result: "taken_over", note: "taken_over" };
        await markReplaced(scope, input.feeRawId);
        return { result: "replaced", note: receipt.takenDownBy ? `inserted_held:${receipt.takenDownBy}` : "inserted" };
      }
      // Nothing written: the read is only "already read" when another row with its key is live or pending.
      const others = await scope<{ fee_raw_id: number | string }[]>`
        SELECT fr.fee_raw_id
          FROM raw_fee_observations fr
         WHERE fr.source = 'knox'
           AND fr.source_document_id = ${input.row.source_document_id}
           AND lower(fr.fee_name) = lower(${input.candidate.feeName})
           AND COALESCE(fr.amount, '-1'::numeric) = COALESCE(${input.candidate.amount}::numeric, '-1'::numeric)
           AND fr.line_share = ${input.candidate.lineShare ?? ""}
           AND fr.fee_raw_id <> ${input.feeRawId}
           AND (COALESCE(fr.outlier_flags, '[]'::jsonb) ? 'needs_darwin_verification'
                OR EXISTS (SELECT 1 FROM verified_fee_observations fv WHERE fv.fee_raw_id = fr.fee_raw_id))
         LIMIT 1
      `;
      if (others.length === 0) throw new KeepHeld(receipt.declinedReason ? `insert_declined:${receipt.declinedReason}` : "insert_no_row");
      await markReplaced(scope, input.feeRawId);
      return { result: "already_read", note: `already_read:${Number(others[0].fee_raw_id)}` };
    });
  } catch (error) {
    if (!(error instanceof KeepHeld)) throw error;
    // A real transaction rolled the retire back with the savepoint; a test double has none.
    if (typeof (db as unknown as { savepoint?: unknown }).savepoint !== "function" && error.note !== "not_held") {
      await db`
        UPDATE raw_fee_observations
           SET outlier_flags = (COALESCE(outlier_flags, '[]'::jsonb) - 'superseded_by_reread') || '["needs_darwin_verification"]'::jsonb
         WHERE fee_raw_id = ${input.feeRawId}
           AND outlier_flags ? 'superseded_by_reread'
           AND NOT outlier_flags ? 'needs_darwin_verification'
      `;
    }
    return { result: "kept", note: error.note };
  }
}

async function markReplaced(db: SqlTag, feeRawId: number): Promise<void> {
  await db`
    UPDATE raw_fee_observations
       SET outlier_flags = COALESCE(outlier_flags, '[]'::jsonb) || ${JSON.stringify([HOLD_REREAD_REPLACED_FLAG])}::jsonb
     WHERE fee_raw_id = ${feeRawId}
  `;
}

function refetchRequestRow(documentId: number, held: HoldRereadRow[], runId: number): FeedbackRow {
  const first = held[0];
  return {
    aboutStage: "fetch",
    signal: "wrong",
    kind: HOLD_REFETCH_REQUEST_KIND,
    reportedBy: "darwin",
    checkName: HOLD_SOURCE_REREAD_CHECK,
    institutionId: Number(first.institution_id),
    sourceDocumentId: documentId,
    sourceUrl: first.current_url,
    // A request, not a judgement of Magellan's fetch: no lesson weight.
    weight: 0,
    evidence: {
      request: "refetch_page",
      held_fees: held.length,
      fee_raw_ids: held.slice(0, 20).map((row) => Number(row.fee_raw_id)),
      last_checked_at: first.current_checked_at == null ? null : new Date(first.current_checked_at).toISOString(),
      strategy_version: HOLD_SOURCE_REREAD_STRATEGY.version,
      consumer: "magellan.live_source (live-source-refetch.ts)",
    },
    runId,
    dedupeKey: `${HOLD_SOURCE_REREAD_CHECK}:refetch:doc:${documentId}`,
  };
}

function attemptDetail(decision: HoldRereadDecision, row: HoldRereadRow) {
  return {
    fee_raw_id: decision.feeRawId,
    fee_name: decision.feeName,
    amount: decision.amount,
    canonical_fee_key: decision.canonicalFeeKey,
    held_reason: decision.heldReason,
    route: decision.route,
    reread_key: decision.rereadKey,
    superseded: decision.superseded,
    current_document_id: num(row.current_document_id),
    document_text_id: num(row.document_text_id),
    ...(decision.newAmount != null ? { new_amount: decision.newAmount } : {}),
    ...(decision.newKey ? { new_key: decision.newKey } : {}),
    ...(decision.newKeys ? { new_keys: decision.newKeys } : {}),
    ...(decision.newWithinRange != null ? { new_within_range: decision.newWithinRange } : {}),
    ...(decision.sourceLine ? { source_line: decision.sourceLine.slice(0, 300) } : {}),
    ...(decision.refusedBy ? { refused_by: decision.refusedBy } : {}),
    ...(decision.readAmounts && decision.readAmounts.length > 0 ? { read_amounts: decision.readAmounts.slice(0, 10) } : {}),
  };
}

function sampleDetail(decision: HoldRereadDecision) {
  return {
    fee_raw_id: decision.feeRawId,
    institution_id: decision.institutionId,
    fee_name: decision.feeName,
    amount: decision.amount,
    canonical_fee_key: decision.canonicalFeeKey,
    held_reason: decision.heldReason,
    route: decision.route,
    outcome: decision.route === "reread" ? decision.outcome : null,
    superseded: decision.superseded,
    ...(decision.newAmount != null ? { new_amount: decision.newAmount } : {}),
    ...(decision.newKey ? { new_key: decision.newKey } : {}),
    ...(decision.newKeys ? { new_keys: decision.newKeys } : {}),
    ...(decision.newWithinRange != null ? { new_within_range: decision.newWithinRange } : {}),
    ...(decision.refusedBy ? { refused_by: decision.refusedBy } : {}),
    ...(decision.readAmounts && decision.readAmounts.length > 0 ? { read_amounts: decision.readAmounts.slice(0, 5) } : {}),
  };
}

export function holdRereadMessage(result: HoldRereadResult): string {
  const routes = Object.entries(result.routes).map(([route, count]) => `${count} ${route.replace(/_/g, " ")}`).join(", ") || "none";
  const outcomes = Object.entries(result.outcomes).map(([outcome, count]) => `${count} ${outcome.replace(/_/g, " ")}`).join(", ") || "none";
  const action = result.live && !result.dryRun
    ? `${result.refetchRequested} page(s) sent for a fresh fetch, ${result.handedBack} handed back to verify, ${result.replaced.length} replaced by a new read, ${result.takenOver.length} re-filed by Knox's take-over, ${result.archived.length} archived`
    : `${result.dryRun ? "dry run" : "switch off"}, nothing written`;
  return `Hold source re-read: ${result.selected} oldest range/peer hold(s) (${routes}); re-read ${result.reread} (${outcomes}); ${action}`;
}

/** The step's detail for the run ledger. */
export function holdRereadDetail(result: HoldRereadResult) {
  return {
    check: HOLD_SOURCE_REREAD_CHECK,
    version: HOLD_SOURCE_REREAD_STRATEGY.version,
    switch_live: result.live,
    dry_run: result.dryRun,
    skipped: result.skipped ?? false,
    scoped: result.scoped ?? false,
    interval_minutes: HOLD_SOURCE_REREAD_INTERVAL_MINUTES,
    failed: result.failed,
    selected: result.selected,
    routes: result.routes,
    superseded: result.superseded,
    reread: result.reread,
    outcomes: result.outcomes,
    refetch_requested: result.refetchRequested,
    handed_back: result.handedBack,
    replaced: result.replaced,
    taken_over: result.takenOver,
    archived: result.archived,
    attempts: result.attempts,
    samples: result.samples.map(sampleDetail),
  };
}
