import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { checkFeeCategory } from "@/lib/fee-category-guard";
import { recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { LIVE_FRAGMENT_CHECK, LIVE_FRAGMENT_REREAD_KIND } from "@/lib/agents/darwin/live-fragment-check";
import { KNOX_RULES_STRATEGY, runFreeSpecialists } from "@/lib/agents/knox/specialists";
import { insertCandidateWithLearning, type KnoxTextRow } from "@/lib/agents/knox/extract";
import { writeLiveRenames, type RetidyRename } from "@/lib/agents/knox/name-retidy";
import { liveFragmentName } from "@/lib/fee-name-fragments";
import { emptyTakedownLessons, loadTakedownLessons } from "@/lib/agents/knox/takedown-lessons";
import type { ExtractedFeeCandidate } from "@/lib/agents/knox/rules";

type SqlTag = typeof sql;

/**
 * Knox's reader of Darwin's re-read requests (#1511). Darwin's live fragment check
 * (`darwin/live-fragment-check.ts`, `LIVE_FRAGMENT_REREAD_KIND`) writes one `pipeline_feedback`
 * row per live fee whose name is a `sentence_end` fragment it cannot rename ("Paper statement fee
 * for the" $2): `reread` (evidence `kept_live: true`, the fee stays live) or `fragment_reread` (the
 * fee came down because a gate refused its amount). This pass reads each request's line again from
 * the fee's own document with today's free team (`runFreeSpecialists`, rules only: no provider
 * call, so it is a deterministic sub-pass of Knox's extract step and never waits on provider
 * budget), and settles the request once per Knox rules version.
 *
 * A re-read finds the line by its price and its words: a fee today's team reads at the request's
 * amount whose excerpt holds the fragment Darwin read (`evidence.fee_name`) as whole words, or whose
 * name is the fragment. Knox's raw name is not a key: a short raw name ("Service charge") is in
 * any line at that price, so another fee's line could lend its name. A fragment of fewer than
 * `REREAD_MIN_KEY_WORDS` words is too short to find one line by, and is settled `ambiguous`.
 * Outcomes (`RereadOutcome`):
 * - `stale`: the request no longer applies (a kept-live fee that came down or was renamed since,
 *   a taken-down fee that is live again).
 * - `no_text`: the request names no document, or the document has no completed text.
 * - `name_changed` (kept live): the live fee's name changed between the read and the guarded
 *   rename, so the update touched nothing (`writeLiveRenames` returns only the fees it renamed).
 * - `not_found`: today's team reads no fee at that price on that line.
 * - `same_name`: today's team reads the line, but under the same name or another fragment. This
 *   is the usual answer while the rules have not changed since the line was read: the free team
 *   is deterministic, so the same text under the same rules gives the same name. The request is
 *   settled as unresolved for this rules version and is read again only after a rules bump.
 * - `other_category`: a proper name, but under another category than the fee's (left for Darwin).
 * - `ambiguous`: two or more proper names on the line at that price.
 * - `refused`: the proper name fails Darwin's category guard or the shared source check
 *   (`checkFeeAgainstSource`).
 * - `live_twin`: a kept-live fee whose proper name another live fee of the bank already has at
 *   that price (the fragment is a duplicate; left for Darwin and Hamilton).
 * - `renamed` (kept live): the live fee takes the proper name through Knox's live rename path
 *   (`writeLiveRenames`: the old name in `pipeline_feedback`, then the guarded update).
 * - `sent_to_darwin` (taken down): the proper read is inserted as a raw row for Darwin
 *   (`insertCandidate`, `needs_darwin_verification`, `KNOX_REREAD_FEEDBACK_FLAG`), so the fee can
 *   come back through Darwin's own checks; `already_read` when Knox already holds that read;
 *   `held_taken_down` when the read repeats a takedown Hamilton confirmed (`takedown-lessons.ts`):
 *   written held as `knox_review:taken_down`, as the extract writes it, not sent to Darwin. Knox's
 *   category lessons (`applyKnoxLesson`) are not applied: the read already matches the fee's own
 *   category, and loading them is an aggregate over all of `pipeline_feedback`.
 * - A write that fails (`refused`, `write_failed` / `live_twin_check_failed`) is settled too,
 *   unresolved, so a failing request cannot hold the head of the queue; a rules bump reads it again.
 *
 * Each settled request gets one `pipeline_feedback` row of kind `KNOX_REREAD_RESOLVED_KIND`
 * (reported by Knox, weight 0 so it never counts as a lesson) keyed on the request's id, this
 * pass's version and the Knox rules version (`rereadResolutionKey`). The request row itself is
 * never rewritten: Darwin upserts it again on each pass of the live table, which would wipe a mark
 * kept on it, so the resolution lives on its own row and a request is read once per rules version.
 *
 * `KNOX_REREAD_FEEDBACK_LIVE` is on (James's yes, 2026-10-17; `pipeline_feedback_kind_idx` serves
 * the claim). Switched off (false): a one-bank run counts that bank's pending
 * requests (`pipeline_feedback_institution_idx`) and reads up to `KNOX_REREAD_FEEDBACK_SAMPLE` of
 * them read-only, reporting what it would do in one `knox.reread_feedback` event; nothing else is
 * written. A state or all-bank lane skips the pass (`skipSample`): `pipeline_feedback` has no index
 * on `kind`, and the same sample would be read again every step. On: a batch of
 * `KNOX_REREAD_FEEDBACK_BATCH` is claimed first (`FOR UPDATE ... SKIP LOCKED`), and the pending
 * count is read only when the claim found work; then the batch is processed and settled.
 * The event is written only while requests are pending; the step detail (`reread_feedback`) always
 * carries the counts. A dry run writes nothing at all.
 */
export const KNOX_REREAD_FEEDBACK_STRATEGY = { strategy: "knox.reread_feedback", version: 1 } as const;
/** On (James's yes, 2026-10-17). Set to false and the pass counts and reports only. */
export const KNOX_REREAD_FEEDBACK_LIVE = true;
/** Requests claimed and settled per extract step, switch on. */
export const KNOX_REREAD_FEEDBACK_BATCH = 25;
/** Requests read read-only per one-bank extract step, switch off; also the samples kept in the event. */
export const KNOX_REREAD_FEEDBACK_SAMPLE = 3;
/** The fewest words a fragment needs to find its line by. */
export const REREAD_MIN_KEY_WORDS = 3;
/** The settled request's row in `pipeline_feedback`. */
export const KNOX_REREAD_RESOLVED_KIND = "knox_reread_resolved";
/** Flag on a raw row this pass sent to Darwin for a taken-down fee. */
export const KNOX_REREAD_FEEDBACK_FLAG = "knox_reread_feedback";

export type RereadRequestKind = "reread" | "fragment_reread";
export type RereadOutcome =
  | "stale"
  | "no_text"
  | "name_changed"
  | "not_found"
  | "same_name"
  | "other_category"
  | "ambiguous"
  | "refused"
  | "live_twin"
  | "renamed"
  | "sent_to_darwin"
  | "held_taken_down"
  | "already_read";
/** The outcomes that leave the line as it was: the request is settled as unresolved for this rules version. */
export const UNRESOLVED_OUTCOMES: ReadonlySet<RereadOutcome> = new Set(["no_text", "not_found", "same_name", "other_category", "ambiguous", "refused", "live_twin", "held_taken_down"]);

/** The dedupe key of a request's resolution: once per request, pass version and Knox rules version. */
export function rereadResolutionKey(requestId: number, rulesVersion: number = KNOX_RULES_STRATEGY.version): string {
  return `${KNOX_REREAD_FEEDBACK_STRATEGY.strategy}:req:${requestId}:v${KNOX_REREAD_FEEDBACK_STRATEGY.version}:rules${rulesVersion}`;
}

export interface RereadRequestRow {
  request_id: number | string;
  institution_id: number | string | null;
  source_document_id: number | string | null;
  fee_raw_id: number | string | null;
  fee_published_id: number | string | null;
  canonical_fee_key: string | null;
  amount: number | string | null;
  evidence: unknown;
  raw_fee_name: string | null;
  live_fee_name: string | null;
  live_rolled_back: boolean | null;
  document_text_id: number | string | null;
  text_hash: string | null;
  source_url: string | null;
}

export interface RereadRequest {
  requestId: number;
  kind: RereadRequestKind;
  institutionId: number | null;
  sourceDocumentId: number | null;
  feeRawId: number | null;
  feePublishedId: number | null;
  canonicalFeeKey: string | null;
  amount: number | null;
  /** The fragment Darwin read on the live fee. */
  fragmentName: string;
  rawFeeName: string | null;
  liveFeeName: string | null;
  liveRolledBack: boolean | null;
  documentTextId: number | null;
  textHash: string | null;
  sourceUrl: string | null;
}

export interface RereadDecision {
  outcome: RereadOutcome;
  /** The proper name today's team reads on the line, when there is one. */
  newName?: string;
  candidate?: ExtractedFeeCandidate;
  /** Why a proper name was refused (`category_guard`, `source_check:<reason>`). */
  refusedBy?: string;
  /** Names today's team reads on the line at that price (for the record). */
  readNames?: string[];
}

const num = (value: number | string | null | undefined): number | null => {
  if (value == null || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

function evidenceOf(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) return value as Record<string, unknown>;
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
    } catch {
      return {};
    }
  }
  return {};
}

export function toRereadRequest(row: RereadRequestRow): RereadRequest {
  const evidence = evidenceOf(row.evidence);
  const keptLive = evidence.kept_live === true || evidence.kept_live === "true";
  return {
    requestId: Number(row.request_id),
    kind: keptLive ? "reread" : "fragment_reread",
    institutionId: num(row.institution_id),
    sourceDocumentId: num(row.source_document_id),
    feeRawId: num(row.fee_raw_id),
    feePublishedId: num(row.fee_published_id),
    canonicalFeeKey: row.canonical_fee_key,
    amount: num(row.amount),
    fragmentName: typeof evidence.fee_name === "string" ? evidence.fee_name : (row.live_fee_name ?? ""),
    rawFeeName: row.raw_fee_name,
    liveFeeName: row.live_fee_name,
    liveRolledBack: row.live_rolled_back,
    documentTextId: num(row.document_text_id),
    textHash: row.text_hash,
    sourceUrl: row.source_url,
  };
}

/** Lower case, letters and digits only, single spaces: how a line is found again. */
export function lineKey(value: string | null | undefined): string {
  return (value ?? "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

/**
 * What today's free team makes of a request's line. Pure: `text` is the document's newest completed
 * text and `candidates` today's free read of it. Live state (stale, live twin) is the caller's.
 */
export function decideReread(request: RereadRequest, text: string | null, candidates: ExtractedFeeCandidate[]): RereadDecision {
  if (!text || !text.trim() || request.amount == null) return { outcome: "no_text" };
  const amount = request.amount;
  // The line is found by Darwin's fragment only; Knox's raw name only marks a read as not new.
  const key = lineKey(request.fragmentName);
  if (key.length === 0) return { outcome: "not_found" };
  if (key.split(" ").length < REREAD_MIN_KEY_WORDS) return { outcome: "ambiguous" };
  const keys = [key, lineKey(request.rawFeeName)].filter((entry) => entry.length > 0);
  const onLine = candidates.filter((candidate) => {
    if (Math.abs(candidate.amount - amount) >= 0.005) return false;
    return lineKey(candidate.feeName) === key || ` ${lineKey(candidate.excerpt)} `.includes(` ${key} `);
  });
  if (onLine.length === 0) return { outcome: "not_found" };
  const readNames = [...new Set(onLine.map((candidate) => candidate.feeName))];
  const proper = onLine.filter((candidate) => !liveFragmentName(candidate.feeName) && !keys.includes(lineKey(candidate.feeName)));
  if (proper.length === 0) return { outcome: "same_name", readNames };
  const sameCategory = proper.filter((candidate) => request.canonicalFeeKey == null || candidate.canonicalHint === request.canonicalFeeKey);
  if (sameCategory.length === 0) return { outcome: "other_category", readNames };
  const names = new Map(sameCategory.map((candidate) => [lineKey(candidate.feeName), candidate]));
  if (names.size > 1) return { outcome: "ambiguous", readNames };
  const candidate = sameCategory[0];
  const newName = candidate.feeName.replace(/\s+/g, " ").trim();
  const feeKey = request.canonicalFeeKey ?? candidate.canonicalHint;
  if (!checkFeeCategory(feeKey, newName).ok) return { outcome: "refused", refusedBy: "category_guard", newName, readNames };
  const source = checkFeeAgainstSource(text, newName, amount, ".", feeKey);
  if (!source.ok) return { outcome: "refused", refusedBy: `source_check:${"reason" in source ? String(source.reason) : "untraced"}`, newName, readNames };
  return { outcome: request.kind === "reread" ? "renamed" : "sent_to_darwin", newName, candidate, readNames };
}

/** The request no longer applies: a kept-live fee came down or was renamed, a taken-down fee is live again. */
export function rereadStale(request: RereadRequest): boolean {
  if (request.feePublishedId == null || request.liveRolledBack == null) return request.kind === "reread";
  if (request.kind === "reread") return request.liveRolledBack || lineKey(request.liveFeeName) !== lineKey(request.fragmentName);
  return !request.liveRolledBack;
}

export interface RereadFeedbackSample {
  request_id: number;
  kind: RereadRequestKind;
  institution_id: number | null;
  fee_published_id: number | null;
  source_document_id: number | null;
  amount: number | null;
  fragment_name: string;
  outcome: RereadOutcome;
  new_name?: string;
  refused_by?: string;
  read_names?: string[];
}

export interface RereadFeedbackResult {
  live: boolean;
  dryRun: boolean;
  /** Switch off in a state or all-bank lane: nothing read (`skipSample`). */
  skipped: boolean;
  /** Requests not yet settled at this rules version, by kind. */
  pending: number;
  pendingByKind: Record<RereadRequestKind, number>;
  pendingDocuments: number;
  pendingInstitutions: number;
  /** Requests read this step (live: claimed and settled; off: read-only). */
  read: number;
  outcomes: Partial<Record<RereadOutcome, number>>;
  /** Live only: requests settled with a resolution row. */
  resolved: number;
  renamed: number[];
  sentToDarwin: number[];
  samples: RereadFeedbackSample[];
  /** A read failed; nothing was written. */
  failed: boolean;
  takedownLessonsUnknown?: Record<string,number>;
  takedownGuardDeclines?: Record<string,number>;
}

function emptyResult(live: boolean, dryRun: boolean): RereadFeedbackResult {
  return {
    live,
    dryRun,
    skipped: false,
    pending: 0,
    pendingByKind: { reread: 0, fragment_reread: 0 },
    pendingDocuments: 0,
    pendingInstitutions: 0,
    read: 0,
    outcomes: {},
    resolved: 0,
    renamed: [],
    sentToDarwin: [],
    samples: [],
    failed: false,
  };
}

/**
 * The pending requests: kind `LIVE_FRAGMENT_REREAD_KIND` with no resolution row at this pass and
 * rules version, as the step's queries read them (`countPending`, `selectPending`), for the
 * read-only count file.
 */
function pendingWhere(alias: string, rulesVersion: number): string {
  const prefix = `${KNOX_REREAD_FEEDBACK_STRATEGY.strategy}:req:`;
  const suffix = `:v${KNOX_REREAD_FEEDBACK_STRATEGY.version}:rules${rulesVersion}`;
  // The same key as rereadResolutionKey, written out for the SQL editor.
  return `${alias}.kind = '${LIVE_FRAGMENT_REREAD_KIND}'
           AND NOT EXISTS (
             SELECT 1 FROM pipeline_feedback res
              WHERE res.dedupe_key = '${prefix}' || ${alias}.id || '${suffix}'
           )`;
}

/**
 * Read-only count of the pending requests by kind, with their documents and institutions, at the
 * current Knox rules version. Runs in the SQL editor as is.
 */
export function rereadFeedbackCountSql(rulesVersion: number = KNOX_RULES_STRATEGY.version): string {
  return `-- Knox re-read requests from Darwin's live fragment check (#1511), pending at
-- ${KNOX_REREAD_FEEDBACK_STRATEGY.strategy} v${KNOX_REREAD_FEEDBACK_STRATEGY.version}, Knox rules v${rulesVersion}. Read only.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '120s';

WITH req AS (
  SELECT req.id, req.institution_id, req.source_document_id, req.fee_published_id,
         CASE WHEN req.evidence->>'kept_live' = 'true' THEN 'reread' ELSE 'fragment_reread' END AS request_kind,
         NOT (${pendingWhere("req", rulesVersion)}) AS settled
    FROM pipeline_feedback req
   WHERE req.kind = '${LIVE_FRAGMENT_REREAD_KIND}'
)
SELECT COALESCE(request_kind, 'all') AS request_kind,
       count(*) AS requests,
       count(*) FILTER (WHERE NOT settled) AS pending,
       count(*) FILTER (WHERE settled) AS settled_at_this_rules_version,
       count(DISTINCT source_document_id) FILTER (WHERE NOT settled) AS pending_documents,
       count(DISTINCT institution_id) FILTER (WHERE NOT settled) AS pending_institutions,
       count(*) FILTER (WHERE NOT settled AND source_document_id IS NULL) AS pending_without_document
  FROM req
 GROUP BY ROLLUP (request_kind)
 ORDER BY GROUPING(request_kind), request_kind;

-- Settled requests by outcome at this rules version (empty until the switch is on).
SELECT res.evidence->>'request_kind' AS request_kind, res.evidence->>'outcome' AS outcome, count(*) AS requests
  FROM pipeline_feedback res
 WHERE res.kind = '${KNOX_REREAD_RESOLVED_KIND}'
   AND res.about_version = ${KNOX_REREAD_FEEDBACK_STRATEGY.version}
   AND res.evidence->>'rules_version' = '${rulesVersion}'
 GROUP BY 1, 2
 ORDER BY 1, 3 DESC;

ROLLBACK;
`;
}

const RESOLUTION_PREFIX = `${KNOX_REREAD_FEEDBACK_STRATEGY.strategy}:req:`;
const resolutionSuffix = (rulesVersion: number = KNOX_RULES_STRATEGY.version) => `:v${KNOX_REREAD_FEEDBACK_STRATEGY.version}:rules${rulesVersion}`;

async function countPending(db: SqlTag, institutionId: number | null, stateCode: string | null) {
  const [row] = await db<Array<{ reread: number | string; fragment_reread: number | string; documents: number | string; institutions: number | string }>>`
    SELECT count(*) FILTER (WHERE req.evidence->>'kept_live' = 'true') AS reread,
           count(*) FILTER (WHERE req.evidence->>'kept_live' IS DISTINCT FROM 'true') AS fragment_reread,
           count(DISTINCT req.source_document_id) AS documents,
           count(DISTINCT req.institution_id) AS institutions
      FROM pipeline_feedback req
      LEFT JOIN institution_sources inst ON inst.id = req.institution_id
     WHERE req.kind = ${LIVE_FRAGMENT_REREAD_KIND}
       AND NOT EXISTS (
         SELECT 1 FROM pipeline_feedback res
          WHERE res.dedupe_key = ${RESOLUTION_PREFIX}::text || req.id::text || ${resolutionSuffix()}::text
       )
       AND (${institutionId}::bigint IS NULL OR req.institution_id = ${institutionId}::bigint)
       AND (${stateCode}::text IS NULL OR upper(btrim(inst.state_code)) = ${stateCode}::text)
  `;
  return row;
}

async function selectPending(db: SqlTag, limit: number, claim: boolean, institutionId: number | null, stateCode: string | null) {
  // Live, the batch is claimed for the step's transaction: a second lane's step skips it.
  const rows = claim
    ? db<Array<{ request_id: number | string }>>`
        SELECT req.id AS request_id
          FROM pipeline_feedback req
          LEFT JOIN institution_sources inst ON inst.id = req.institution_id
         WHERE req.kind = ${LIVE_FRAGMENT_REREAD_KIND}
           AND NOT EXISTS (
             SELECT 1 FROM pipeline_feedback res
              WHERE res.dedupe_key = ${RESOLUTION_PREFIX}::text || req.id::text || ${resolutionSuffix()}::text
           )
           AND (${institutionId}::bigint IS NULL OR req.institution_id = ${institutionId}::bigint)
           AND (${stateCode}::text IS NULL OR upper(btrim(inst.state_code)) = ${stateCode}::text)
         ORDER BY req.id
         LIMIT ${limit}::int
           FOR UPDATE OF req SKIP LOCKED
      `
    : db<Array<{ request_id: number | string }>>`
        SELECT req.id AS request_id
          FROM pipeline_feedback req
          LEFT JOIN institution_sources inst ON inst.id = req.institution_id
         WHERE req.kind = ${LIVE_FRAGMENT_REREAD_KIND}
           AND NOT EXISTS (
             SELECT 1 FROM pipeline_feedback res
              WHERE res.dedupe_key = ${RESOLUTION_PREFIX}::text || req.id::text || ${resolutionSuffix()}::text
           )
           AND (${institutionId}::bigint IS NULL OR req.institution_id = ${institutionId}::bigint)
           AND (${stateCode}::text IS NULL OR upper(btrim(inst.state_code)) = ${stateCode}::text)
         ORDER BY req.id
         LIMIT ${limit}::int
      `;
  const ids = (await rows).map((row) => Number(row.request_id));
  if (ids.length === 0) return [];
  return db<RereadRequestRow[]>`
    SELECT req.id AS request_id, req.institution_id, req.source_document_id, req.fee_raw_id, req.fee_published_id, req.canonical_fee_key, req.amount, req.evidence,
           fr.fee_name AS raw_fee_name, fp.fee_name AS live_fee_name,
           CASE WHEN fp.fee_published_id IS NULL THEN NULL ELSE fp.rolled_back_at IS NOT NULL END AS live_rolled_back,
           adt.id AS document_text_id, adt.text_hash, adt.source_url
      FROM pipeline_feedback req
      LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = req.fee_raw_id
      LEFT JOIN published_fee_records fp ON fp.fee_published_id = req.fee_published_id
      LEFT JOIN LATERAL (
        SELECT t.id, t.text_hash, t.source_url FROM agent_source_texts t
         WHERE t.source_document_id = req.source_document_id
           AND t.status = 'completed'
           AND t.normalized_text IS NOT NULL
         ORDER BY t.id DESC
         LIMIT 1
      ) adt ON TRUE
     WHERE req.id = ANY(${ids}::bigint[])
     ORDER BY req.id
  `;
}

/** Another live fee of the bank already has this name at this price. */
async function liveTwins(db: SqlTag, picks: Array<{ request: RereadRequest; newName: string }>): Promise<Set<number>> {
  const withFee = picks.filter((pick) => pick.request.institutionId != null && pick.request.amount != null);
  if (withFee.length === 0) return new Set();
  const rows = await db<Array<{ request_id: number | string }>>`
    SELECT DISTINCT v.request_id
      FROM unnest(
             ${withFee.map((pick) => pick.request.requestId)}::bigint[],
             ${withFee.map((pick) => pick.request.institutionId as number)}::bigint[],
             ${withFee.map((pick) => pick.request.feePublishedId ?? 0)}::bigint[],
             ${withFee.map((pick) => pick.newName.toLowerCase())}::text[],
             ${withFee.map((pick) => pick.request.amount as number)}::numeric[]
           ) AS v(request_id, institution_id, fee_published_id, new_name, amount)
      JOIN published_fee_records fp
        ON fp.institution_id = v.institution_id
       AND fp.rolled_back_at IS NULL
       AND fp.fee_published_id <> v.fee_published_id
       AND lower(btrim(fp.fee_name)) = v.new_name
       AND fp.amount = v.amount
  `;
  return new Set(rows.map((row) => Number(row.request_id)));
}

function sampleOf(request: RereadRequest, decision: RereadDecision): RereadFeedbackSample {
  return {
    request_id: request.requestId,
    kind: request.kind,
    institution_id: request.institutionId,
    fee_published_id: request.feePublishedId,
    source_document_id: request.sourceDocumentId,
    amount: request.amount,
    fragment_name: request.fragmentName,
    outcome: decision.outcome,
    ...(decision.newName ? { new_name: decision.newName } : {}),
    ...(decision.refusedBy ? { refused_by: decision.refusedBy } : {}),
    ...(decision.readNames && decision.readNames.length > 0 ? { read_names: decision.readNames.slice(0, 5) } : {}),
  };
}

function resolutionRow(request: RereadRequest, decision: RereadDecision, runId: number): FeedbackRow {
  return {
    aboutStage: "extract",
    aboutStrategy: KNOX_REREAD_FEEDBACK_STRATEGY.strategy,
    aboutVersion: KNOX_REREAD_FEEDBACK_STRATEGY.version,
    signal: UNRESOLVED_OUTCOMES.has(decision.outcome) ? "wrong" : "right",
    kind: KNOX_REREAD_RESOLVED_KIND,
    reportedBy: "knox",
    checkName: KNOX_REREAD_FEEDBACK_STRATEGY.strategy,
    institutionId: request.institutionId,
    sourceDocumentId: request.sourceDocumentId,
    feeRawId: request.feeRawId,
    feePublishedId: request.feePublishedId,
    canonicalFeeKey: request.canonicalFeeKey,
    amount: request.amount,
    // Housekeeping on a request, not a judgement on a read: it never counts as a lesson.
    weight: 0,
    evidence: {
      request_id: request.requestId,
      request_kind: request.kind,
      request_check: LIVE_FRAGMENT_CHECK,
      outcome: decision.outcome,
      resolved: !UNRESOLVED_OUTCOMES.has(decision.outcome),
      ...(decision.outcome === "same_name" ? { note: "unresolved: same name under today's rules" } : {}),
      ...(decision.refusedBy === "write_failed" || decision.refusedBy === "live_twin_check_failed"
        ? { note: "unresolved: the write failed; read again after a rules bump" }
        : {}),
      fragment_name: request.fragmentName,
      ...(decision.newName ? { new_name: decision.newName } : {}),
      ...(decision.refusedBy ? { refused_by: decision.refusedBy } : {}),
      ...(decision.readNames ? { read_names: decision.readNames.slice(0, 5) } : {}),
      document_text_id: request.documentTextId,
      rules_version: KNOX_RULES_STRATEGY.version,
    },
    runId,
    dedupeKey: rereadResolutionKey(request.requestId),
  };
}

/**
 * One extract step's share of the re-read requests (see the module note). Never throws: a failed
 * read reports `failed` and writes nothing; a failed write is settled unresolved for this rules
 * version, so it does not hold the head of the queue.
 */
export async function consumeRereadRequests(
  db: SqlTag,
  options: {
    runId: number;
    stepId?: number | null;
    dryRun: boolean;
    live?: boolean;
    limit?: number;
    institutionId?: number | null;
    stateCode?: string | null;
    /** Switch off: skip the read-only count and sample (a state or all-bank lane). */
    skipSample?: boolean;
  },
): Promise<RereadFeedbackResult> {
  const live = options.live ?? KNOX_REREAD_FEEDBACK_LIVE;
  const dryRun = options.dryRun;
  const claim = live && !dryRun;
  const limit = Math.max(1, Math.min(Number(options.limit) || (claim ? KNOX_REREAD_FEEDBACK_BATCH : KNOX_REREAD_FEEDBACK_SAMPLE), 200));
  const institutionId = options.institutionId ?? null;
  const stateCode = options.stateCode?.trim().toUpperCase() || null;
  const result = emptyResult(live, dryRun);
  // Switched off, a state or all-bank lane reads nothing: no index on `kind`, and the same sample
  // every step. A one-bank run reads its bank's requests by `pipeline_feedback_institution_idx`.
  if (!live && options.skipSample) {
    result.skipped = true;
    return result;
  }

  const count = async () => {
    const counted = await inSavepoint(db, (scope) => countPending(scope, institutionId, stateCode));
    result.pendingByKind = { reread: Number(counted?.reread ?? 0), fragment_reread: Number(counted?.fragment_reread ?? 0) };
    result.pending = result.pendingByKind.reread + result.pendingByKind.fragment_reread;
    result.pendingDocuments = Number(counted?.documents ?? 0);
    result.pendingInstitutions = Number(counted?.institutions ?? 0);
  };
  let requests: RereadRequest[];
  let texts: Map<number, string | null>;
  try {
    // Switch on, the claim comes first: an empty claim means nothing pending, with no count read.
    if (!claim) {
      await count();
      if (result.pending === 0) return result;
    }
    const rows = await inSavepoint(db, (scope) => selectPending(scope, limit, claim, institutionId, stateCode));
    if (claim) {
      if (rows.length === 0) return result;
      await count();
    }
    requests = rows.map(toRereadRequest);
    const textIds = [...new Set(requests.map((request) => request.documentTextId).filter((id): id is number => id != null))];
    const textRows = textIds.length === 0 ? [] : await inSavepoint(db, (scope) => scope<Array<{ id: number | string; normalized_text: string | null }>>`
      SELECT id, normalized_text FROM agent_source_texts WHERE id = ANY(${textIds}::bigint[])
    `);
    texts = new Map(textRows.map((row) => [Number(row.id), row.normalized_text]));
  } catch (error) {
    console.warn("[knox] re-read request read failed", error instanceof Error ? error.message : error);
    result.failed = true;
    return result;
  }

  // Today's free team over each text, once.
  const reads = new Map<number, ExtractedFeeCandidate[]>();
  for (const [id, text] of texts) reads.set(id, text ? runFreeSpecialists(text).candidates : []);

  const decisions: Array<{ request: RereadRequest; decision: RereadDecision }> = requests.map((request) => {
    if (rereadStale(request)) return { request, decision: { outcome: "stale" } };
    const text = request.documentTextId == null ? null : (texts.get(request.documentTextId) ?? null);
    return { request, decision: decideReread(request, text, request.documentTextId == null ? [] : (reads.get(request.documentTextId) ?? [])) };
  });

  // A kept-live fee whose proper name another live fee of the bank has at that price is a duplicate.
  const renames = decisions.filter(({ decision }) => decision.outcome === "renamed" && decision.newName);
  if (renames.length > 0) {
    try {
      const twins = await inSavepoint(db, (scope) => liveTwins(scope, renames.map(({ request, decision }) => ({ request, newName: decision.newName as string }))));
      for (const entry of renames) if (twins.has(entry.request.requestId)) entry.decision = { ...entry.decision, outcome: "live_twin" };
    } catch (error) {
      console.warn("[knox] re-read live twin check failed", error instanceof Error ? error.message : error);
      for (const entry of renames) entry.decision = { ...entry.decision, outcome: "refused", refusedBy: "live_twin_check_failed" };
    }
  }

  if (claim) {
    // Renames through Knox's live rename path (the old name logged first, the update guarded on it).
    const toRename = decisions.filter(({ decision }) => decision.outcome === "renamed");
    if (toRename.length > 0) {
      const rows: RetidyRename[] = toRename.map(({ request, decision }) => ({
        feePublishedId: request.feePublishedId as number,
        institutionId: request.institutionId as number,
        sourceDocumentId: request.sourceDocumentId,
        canonicalFeeKey: request.canonicalFeeKey ?? "",
        amount: request.amount,
        oldName: request.liveFeeName as string,
        newName: decision.newName as string,
      }));
      try {
        const updated = new Set(await inSavepoint(db, (scope) => writeLiveRenames(scope, rows, {
          strategy: KNOX_REREAD_FEEDBACK_STRATEGY.strategy,
          version: KNOX_REREAD_FEEDBACK_STRATEGY.version,
          reportedBy: "knox",
          runId: options.runId,
        })));
        // Only the fees the guarded update touched are renamed; the others changed name since the read.
        for (const entry of toRename) {
          const id = entry.request.feePublishedId as number;
          if (updated.has(id)) result.renamed.push(id);
          else entry.decision = { ...entry.decision, outcome: "name_changed" };
        }
      } catch (error) {
        console.error("[knox] re-read rename failed", error instanceof Error ? error.message : error);
        // Settled unresolved below: read again after a rules bump, never blocking the queue.
        for (const entry of toRename) entry.decision = { ...entry.decision, outcome: "refused", refusedBy: "write_failed" };
      }
    }
    // Taken-down fees: today's proper read goes to Darwin as a raw row; a read repeating a takedown
    // Hamilton confirmed with current original proof is written held, through the extract's shared gate.
    const toDarwin = decisions.filter(({ decision }) => decision.outcome === "sent_to_darwin");
    const takedownLessons = toDarwin.length > 0 ? await loadTakedownLessons(db,toDarwin.flatMap(e=>e.request.institutionId?[e.request.institutionId]:[])) : emptyTakedownLessons();
    result.takedownLessonsUnknown=takedownLessons.unknownReasons;
    result.takedownGuardDeclines={};
    for (const entry of toDarwin) {
      const { request, decision } = entry;
      const row: KnoxTextRow = {
        document_text_id: request.documentTextId as number,
        source_document_id: request.sourceDocumentId as number,
        institution_id: request.institutionId as number,
        source_url: request.sourceUrl,
        text_hash: request.textHash,
      };
      const candidate = decision.candidate as ExtractedFeeCandidate;
      try {
        const receipt = await inSavepoint(db, (scope) => insertCandidateWithLearning(scope, {
          runId: options.runId,
          row,
          candidate,
          extraFlags: [KNOX_REREAD_FEEDBACK_FLAG],
          method: `${KNOX_REREAD_FEEDBACK_STRATEGY.strategy} v${KNOX_REREAD_FEEDBACK_STRATEGY.version} re-read (Darwin request #${request.requestId})`,
        },takedownLessons));
        if (receipt.declinedReason) result.takedownGuardDeclines[receipt.declinedReason]=(result.takedownGuardDeclines[receipt.declinedReason]??0)+1;
        if (!receipt.inserted) entry.decision = { ...decision, outcome: "already_read" };
        else if (receipt.takenDownBy) entry.decision = { ...decision, outcome: "held_taken_down", refusedBy: `taken_down:${receipt.takenDownBy}` };
        else result.sentToDarwin.push(request.feePublishedId ?? request.requestId);
      } catch (error) {
        console.error("[knox] re-read insert failed", error instanceof Error ? error.message : error);
        entry.decision = { ...decision, outcome: "refused", refusedBy: "write_failed" };
      }
    }
  }

  result.read = decisions.length;
  for (const { decision } of decisions) result.outcomes[decision.outcome] = (result.outcomes[decision.outcome] ?? 0) + 1;
  result.samples = decisions.slice(0, KNOX_REREAD_FEEDBACK_SAMPLE).map(({ request, decision }) => sampleOf(request, decision));

  if (claim) {
    // Every request read is settled for this rules version, a failed write too (unresolved): left
    // pending, it would be claimed first again by ORDER BY id and hold the head of the queue.
    const settled = decisions;
    if (settled.length > 0) {
      try {
        result.resolved = await inSavepoint(db, (scope) => recordFeedback(scope, settled.map(({ request, decision }) => resolutionRow(request, decision, options.runId))));
      } catch (error) {
        console.error("[knox] re-read resolution write failed", error instanceof Error ? error.message : error);
        result.resolved = 0;
      }
    }
    if (result.renamed.length > 0) invalidatePublicReadCache();
  }

  if (!dryRun) {
    try {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${options.stepId ?? null}, ${KNOX_REREAD_FEEDBACK_STRATEGY.strategy}, 'completed',
          ${rereadFeedbackMessage(result)},
          ${JSON.stringify(rereadFeedbackDetail(result))}::jsonb
        )
      `);
    } catch (error) {
      console.warn("[knox] re-read event failed", error instanceof Error ? error.message : error);
    }
  }
  return result;
}

const outcomeList = (outcomes: Partial<Record<RereadOutcome, number>>) =>
  Object.entries(outcomes).map(([outcome, count]) => `${count} ${outcome.replace(/_/g, " ")}`).join(", ") || "none";

export function rereadFeedbackMessage(result: RereadFeedbackResult): string {
  const pending = `${result.pending} re-read request(s) from Darwin pending (${result.pendingByKind.reread} kept live, ${result.pendingByKind.fragment_reread} taken down) at ${result.pendingDocuments} document(s), ${result.pendingInstitutions} bank(s)`;
  if (result.failed) return `${pending}; the read failed, nothing written`;
  if (!result.live || result.dryRun) return `${pending}; read ${result.read} with today's rules (would be: ${outcomeList(result.outcomes)}); ${result.dryRun ? "dry run" : "switch off"}, nothing written`;
  return `${pending}; read and settled ${result.resolved} of ${result.read} (${outcomeList(result.outcomes)}): ${result.renamed.length} live fee(s) renamed, ${result.sentToDarwin.length} sent to Darwin`;
}

export function rereadFeedbackDetail(result: RereadFeedbackResult) {
  return {
    strategy: KNOX_REREAD_FEEDBACK_STRATEGY.strategy,
    version: KNOX_REREAD_FEEDBACK_STRATEGY.version,
    rules_version: KNOX_RULES_STRATEGY.version,
    live: result.live,
    dry_run: result.dryRun,
    skipped: result.skipped,
    pending: result.pending,
    pending_by_kind: result.pendingByKind,
    pending_documents: result.pendingDocuments,
    pending_institutions: result.pendingInstitutions,
    read: result.read,
    outcomes: result.outcomes,
    resolved: result.resolved,
    renamed: result.renamed.length,
    sent_to_darwin: result.sentToDarwin.length,
    failed: result.failed,
    takedown_lessons_unknown: result.takedownLessonsUnknown ?? {},
    takedown_guard_declines: result.takedownGuardDeclines ?? {},
    samples: result.samples,
  };
}
