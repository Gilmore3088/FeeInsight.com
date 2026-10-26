import { sql } from "@/lib/data-store/connection";
import { runSourceFirstRecoveryRead, sourceFirstRecoverySummary, type SourceFirstRecoveryRead } from "./source-first-recovery-run";
import { inSavepoint } from "@/lib/agents/savepoint";
import { recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { KNOX_RULES_STRATEGY } from "@/lib/agents/knox/specialists";
import type { InstitutionText } from "@/lib/agents/hamilton/source-check";
import {
  NAME_QUALITY_CHECK,
  NOT_A_FEE_CHECK,
  readEvidence,
  scoreFreshAudit,
  type FreshAuditEvidence,
  type FreshAuditFee,
} from "./fresh-audit";
import registry from "./error-fixes.json";

type SqlTag = typeof sql;

/**
 * The error loop (#2058): a process fix names the error rows it fixes, the institutions behind
 * them are re-run through the fixed step, and each named error is re-checked against the bank's
 * own document, so a fix is known to have fixed its errors rather than assumed to.
 *
 * 1. A process-fix PR adds an entry to `error-fixes.json` in the same PR: the stage it fixed, the
 *    day it merged, the Knox rules version that carries the fix, and the `pipeline_feedback` rows
 *    it fixes (by check name, kind or id).
 * 2. Atlas's direct path (`selectPriorityInstitutions`) asks for each named row's institution as a
 *    request dated `merged_on`, so it is fetched, read, extracted, verified and published again
 *    under the fixed code; a run of its state's lane serves it just as well.
 * 3. Deming's daily `deming-error-fix-recheck` step (Atlas's scoreboard run) waits until a
 *    completed run has extracted the institution again at the fixed rules version, after the
 *    error, then judges
 *    the fee as it now stands with the fresh audit's checks (the shared source check
 *    `checkFeeAgainstSource` through `traceLiveFee`, the category guard, evidence and name). A row
 *    whose fee now matches is closed; a row still wrong is reported
 *    and recorded once, and is judged again each day in case a later pass fixes it.
 *
 * Only what the judgement can see is named. A row is named only when the check that raised it is
 * one the fresh audit re-runs (`ERROR_FIX_CHECKS`), so a fee that still has the error fails that
 * same check and is never closed; an audience, frequency or hand judgement is not re-run here.
 * Only extract fixes are named for now: Knox reads a stored text again only when its rules version
 * moves (`knox/extract.ts`), and Rosetta reads unchanged bytes only once, so a read, verify or
 * publish fix would never reach the bank's fee through a re-run (follow-ups on #2058).
 * Writes only weight-0 `pipeline_feedback` ledger rows with no strategy, so neither outcome counts
 * as a lesson signal twice. No model calls.
 */

export const ERROR_FIX_CLOSED_KIND = "error_fix_closed";
export const ERROR_FIX_STILL_WRONG_KIND = "error_fix_still_wrong";
export const ERROR_FIX_CHECK = "deming.error_fix_recheck";
/** Named rows read per entry per run; later runs take the rest. */
export const ERROR_FIX_ROWS_PER_ENTRY = 200;
/** Institutions asked for at once across every entry; the rest wait until these are served. */
export const ERROR_FIX_MAX_INSTITUTIONS = 100;

/**
 * The steps whose fix a re-run reaches: an extract fix ships with a Knox rules version, and Knox
 * reads every stored text again once that version moves. A wrong document is Magellan's link
 * search (#2055), not a re-run.
 */
export const ERROR_FIX_STAGES = ["extract"] as const;
export type ErrorFixStage = (typeof ERROR_FIX_STAGES)[number];

/**
 * The extract-stage checks the fresh audit re-runs on a live fee, so only their errors can be
 * judged gone. Its evidence checks (another bank's document, an article or product page) are
 * filed against discover or publish, so no extract entry could name them.
 */
export const ERROR_FIX_CHECKS = ["hamilton.source_check", "hamilton.category_guard", NOT_A_FEE_CHECK, NAME_QUALITY_CHECK] as const;

export interface ErrorFixEntry {
  pr: number;
  issue?: number | null;
  stage: ErrorFixStage;
  /** ISO date the PR merged; only errors recorded before it are named. */
  merged_on: string;
  /** The Knox rules version (`KNOX_RULES_STRATEGY.version`) that carries the fix. */
  knox_version: number;
  kinds?: string[];
  checks?: string[];
  feedback_ids?: number[];
  note?: string | null;
}

export const ERROR_FIXES: ErrorFixEntry[] = (registry as { entries: ErrorFixEntry[] }).entries;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Pure: what is wrong with each entry, so CI refuses a registry the step could not read. */
export function errorFixProblems(entries: readonly ErrorFixEntry[]): string[] {
  const problems: string[] = [];
  const seen = new Set<number>();
  for (const entry of entries) {
    const name = `PR #${entry.pr}`;
    if (!Number.isInteger(entry.pr) || entry.pr <= 0) problems.push(`${name}: pr must be a PR number`);
    if (seen.has(entry.pr)) problems.push(`${name}: listed twice; name every row in one entry`);
    seen.add(entry.pr);
    if (!(ERROR_FIX_STAGES as readonly string[]).includes(entry.stage)) {
      problems.push(`${name}: stage must be one of ${ERROR_FIX_STAGES.join(", ")} (a wrong document re-runs through Magellan's link search)`);
    }
    if (!ISO_DAY.test(entry.merged_on ?? "") || Number.isNaN(Date.parse(entry.merged_on))) problems.push(`${name}: merged_on must be an ISO date (YYYY-MM-DD)`);
    if (!Number.isInteger(entry.knox_version) || entry.knox_version < 1) {
      problems.push(`${name}: knox_version must be the Knox rules version that carries the fix (bump KNOX_RULES_STRATEGY.version)`);
    } else if (entry.knox_version > KNOX_RULES_STRATEGY.version) {
      // No extract could ever reach it, so every named row would wait for good.
      problems.push(`${name}: knox_version ${entry.knox_version} is above the shipped Knox rules version ${KNOX_RULES_STRATEGY.version}`);
    }
    const unjudged = (entry.checks ?? []).filter((check) => !(ERROR_FIX_CHECKS as readonly string[]).includes(check));
    if (unjudged.length > 0) problems.push(`${name}: the daily re-check cannot judge ${unjudged.join(", ")}; name rows raised by ${ERROR_FIX_CHECKS.join(", ")}`);
    const named = (entry.kinds?.length ?? 0) + (entry.checks?.length ?? 0) + (entry.feedback_ids?.length ?? 0);
    if (named === 0) problems.push(`${name}: name the error rows by kinds, checks or feedback_ids`);
    if (entry.feedback_ids?.some((id) => !Number.isInteger(id) || id <= 0)) problems.push(`${name}: feedback_ids must be row ids`);
  }
  return problems;
}

function truthy(value: boolean | string | null | undefined): boolean {
  return value === true || value === "t" || value === "true";
}

function ledgerKey(pr: number, feedbackId: number, outcome: "closed" | "still_wrong"): string {
  return `deming.error_fix:${pr}:${feedbackId}:${outcome}`;
}

export interface NamedErrorRow {
  id: number | string;
  institution_id: number | string;
  fee_published_id: number | string;
  /** The document the error names, when it names one: the re-run must read that document. */
  source_document_id?: number | string | null;
  /** A newer copy has replaced that document, so the re-run reads (and its fees cite) the newer one. */
  document_replaced?: boolean | string | null;
  canonical_fee_key: string | null;
  kind: string;
  check_name: string | null;
  created_at: string | Date;
  /** A completed run extracted the institution again at the fixed rules version after this error. */
  rerun: boolean | string | null;
  /** The ledger already holds a still-wrong record of this row for this fix. */
  reported_still_wrong?: boolean | string | null;
  /** The bank is no longer active, so the direct path never asks for it: not waiting for a re-run. */
  bank_inactive?: boolean | string | null;
}

/**
 * The entry's named errors not yet closed for it: wrong judgements of a published fee about its
 * stage, raised by a check the re-check can judge. `waiting` reads only rows of active banks not
 * yet re-run, for the direct path's requests, in id order so the read stops at the limit.
 * Otherwise every open row is read, rows already recorded as still wrong last and the rest in an
 * order that changes each day, so neither stubborn rows nor rows with no stored text hold the
 * limit for good. `bank_inactive` marks a row whose bank is no longer active: the direct path never
 * asks for it, so it is reported apart from the rows waiting for a re-run.
 */
async function namedRows(db: SqlTag, entry: ErrorFixEntry, limit: number, waiting = false): Promise<NamedErrorRow[]> {
  const ids = (entry.feedback_ids ?? []).map(Number);
  const closedPrefix = `deming.error_fix:${entry.pr}:`;
  const rerun = db`
    EXISTS (
      SELECT 1 FROM pipeline_attempts again
        JOIN agent_runs run ON run.id = again.agent_run_id AND run.status = 'completed'
       WHERE again.institution_id = f.institution_id
         AND again.stage = 'extract'
         AND again.strategy = ${KNOX_RULES_STRATEGY.strategy}::text
         AND again.strategy_version >= ${entry.knox_version}::int
         AND again.created_at > f.created_at
         -- The error's own document, or any once a newer copy has replaced it (the re-run reads that).
         AND (f.source_document_id IS NULL OR again.source_document_id = f.source_document_id
              OR EXISTS (SELECT 1 FROM source_documents old
                          WHERE old.id = f.source_document_id AND old.superseded_by_id IS NOT NULL))
    )`;
  const active = db`
    EXISTS (
      SELECT 1 FROM institution_sources inst
       WHERE inst.id = f.institution_id AND COALESCE(inst.status, 'active') = 'active'
    )`;
  const stillWrong = db`
    EXISTS (
      SELECT 1 FROM pipeline_feedback still
       WHERE still.dedupe_key = ${closedPrefix}::text || f.id::text || ':still_wrong'
    )`;
  return db<NamedErrorRow[]>`
    SELECT f.id, f.institution_id, f.fee_published_id, f.source_document_id, f.canonical_fee_key, f.kind, f.check_name, f.created_at,
           EXISTS (SELECT 1 FROM source_documents old
                    WHERE old.id = f.source_document_id AND old.superseded_by_id IS NOT NULL) AS document_replaced,
           ${waiting ? db`FALSE` : rerun} AS rerun,
           ${waiting ? db`FALSE` : stillWrong} AS reported_still_wrong,
           ${waiting ? db`FALSE` : db`NOT ${active}`} AS bank_inactive
      FROM pipeline_feedback f
     WHERE f.signal = 'wrong'
       AND f.about_stage = ${entry.stage}::text
       -- Before the merge day (UTC): an error filed after the fixed rules already read its text could
       -- never see a later read of that unchanged text, and its bank would be asked for daily.
       AND f.created_at < ${entry.merged_on}::date::timestamp AT TIME ZONE 'UTC'
       AND f.fee_published_id IS NOT NULL
       AND f.institution_id IS NOT NULL
       AND f.check_name = ANY(${[...ERROR_FIX_CHECKS]}::text[])
       AND (f.id = ANY(${ids}::bigint[]) OR f.kind = ANY(${entry.kinds ?? []}::text[]) OR f.check_name = ANY(${entry.checks ?? []}::text[]))
       AND NOT EXISTS (
         SELECT 1 FROM pipeline_feedback done
          WHERE done.dedupe_key = ${closedPrefix}::text || f.id::text || ':closed'
       )
       ${waiting ? db`
       AND NOT ${rerun}
       AND ${active}` : db``}
     ORDER BY ${waiting ? db`f.id` : db`rerun DESC, reported_still_wrong ASC, md5(f.id::text || CURRENT_DATE::text)`}
     LIMIT ${limit}::int
  `;
}

export interface ErrorFixRequest {
  institutionId: number;
  institutionName: string;
  reason: string;
  requestedAt: string;
  minExtractVersion: number;
}

/**
 * The institutions to re-run for the registry's fixes, as direct-path requests dated the day each
 * fix merged: one per active institution with a named error not yet closed nor extracted again at
 * the fixed version. A request ends once a run has done that, so an institution whose error is
 * still wrong after its re-run is not asked for again. Read-only.
 */
export async function errorFixRequests(db: SqlTag, entries: readonly ErrorFixEntry[] = ERROR_FIXES): Promise<ErrorFixRequest[]> {
  if (entries.length === 0 || errorFixProblems(entries).length > 0) return [];
  const requests = new Map<number, ErrorFixRequest>();
  for (const entry of entries) {
    if (requests.size >= ERROR_FIX_MAX_INSTITUTIONS) break;
    // Only active banks not yet extracted again at the fixed version (by its lane or a direct run).
    const rows = await namedRows(db, entry, ERROR_FIX_ROWS_PER_ENTRY, true);
    for (const row of rows) {
      const id = Number(row.institution_id);
      if (requests.has(id) || requests.size >= ERROR_FIX_MAX_INSTITUTIONS) continue;
      requests.set(id, {
        institutionId: id,
        institutionName: "",
        reason: `re-check an error here after PR #${entry.pr}${entry.issue ? ` (#${entry.issue})` : ""} fixed the ${entry.stage} step`,
        requestedAt: entry.merged_on,
        minExtractVersion: entry.knox_version,
      });
    }
  }
  return [...requests.values()];
}

export type ErrorFixVerdict = "now_matches" | "still_wrong" | "not_reproduced" | "unknown";

export interface ErrorFixJudgement {
  verdict: ErrorFixVerdict;
  /** The live fees judged: the named one while it is live, otherwise the fees the re-run extracted in its place. */
  judged: number[];
  check?: string;
  reason?: string;
}

/**
 * A live fee with two times that together tell a fee the re-run produced from an older one:
 * `reread_at`, the last time a completed run read its document text at the fix's Knox rules
 * version (`pipeline_attempts`, stage extract), and `published_at`, when its published row was
 * written. The raw row's age cannot tell them apart: a fee Knox reads again with the same
 * document, name, amount, audience and line share hits `insertCandidate`'s ON CONFLICT, which
 * takes over only an unclassified, untraced or superseded raw row and otherwise leaves the old
 * row, and its old date, as they were. Nor can the read alone: a rules bump re-reads every stored
 * text, so every fee on the document gets a new `reread_at`, including one live all along.
 */
export type ErrorFixFee = FreshAuditFee & { reread_at?: string | Date | null; published_at?: string | Date | null };

function time(value: string | Date | null | undefined): number {
  return value == null ? Number.NaN : new Date(value).getTime();
}

/**
 * Pure: is the named error gone? The named fee is judged while it is still live. Once it is down
 * (a takedown names a fee already down), only a fee put in its place after the error is judged: a
 * live fee in its category whose document text the fixed Knox rules read after the error
 * (`reread_at`) and whose published row was written after the error (`published_at`), from the
 * error's document when it names one (any document once a newer copy has replaced it, as the
 * re-run guard counts). Both are needed: a rules bump re-reads every text, so a fee live all along
 * on the same document has a new `reread_at` too, and a fee published after the error from a read
 * the fix never saw proves nothing either. A restore that clears `rolled_back_at` on the old
 * published row keeps its old `published_at`, so it never counts: a restore is not a fix. Every
 * judged fee must pass the fresh audit's checks. With no such fee the error is `not_reproduced`:
 * the fix has not yet brought a right fee back (or the corrected fee has not cleared Darwin and
 * Hamilton), so the row stays open. A fee with no stored text is unknown, never closed, and so is a named fee still
 * published but not among the dollar fees judged here (a rate) or one with no category.
 */
export function judgeErrorFix(
  row: Pick<NamedErrorRow, "fee_published_id" | "canonical_fee_key" | "created_at" | "source_document_id" | "document_replaced">,
  live: ErrorFixFee[],
  texts: InstitutionText[],
  evidence?: FreshAuditEvidence,
  namedStillPublished = false,
): ErrorFixJudgement {
  const own = live.filter((fee) => Number(fee.fee_published_id) === Number(row.fee_published_id));
  if (own.length === 0 && (namedStillPublished || row.canonical_fee_key == null)) return { verdict: "unknown", judged: [], reason: "named_fee_not_judged_here" };
  const errorAt = time(row.created_at);
  const fees = own.length > 0 ? own : live.filter((fee) =>
    fee.canonical_fee_key === row.canonical_fee_key
    && time(fee.reread_at) > errorAt
    && time(fee.published_at) > errorAt
    && (row.source_document_id == null || truthy(row.document_replaced) || Number(fee.source_document_id) === Number(row.source_document_id)));
  const judged = fees.map((fee) => Number(fee.fee_published_id));
  if (fees.length === 0) return { verdict: "not_reproduced", judged };
  const byInstitution = new Map<number, InstitutionText[]>();
  for (const fee of fees) byInstitution.set(Number(fee.institution_id), texts);
  const score = scoreFreshAudit(fees, byInstitution, evidence);
  const [miss] = score.misses;
  if (miss) return { verdict: "still_wrong", judged, check: miss.check, reason: miss.reason };
  if (score.noText > 0) return { verdict: "unknown", judged, reason: "no_stored_text" };
  return { verdict: "now_matches", judged };
}

export interface ErrorFixEntryResult {
  pr: number;
  issue: number | null;
  stage: ErrorFixStage;
  named: number;
  /** Not yet re-run, at an active bank the direct path asks for. */
  waiting: number;
  /** Not yet re-run, at a bank no longer active: no run will ask for it, so it is not waiting. */
  inactive: number;
  /** This fix's reads failed (rolled back to their savepoint); it is re-checked on the next run. */
  readFailed: boolean;
  nowMatches: number;
  /** The named fee is down and the re-run extracted no fee in its place: open, judged again daily. */
  notReproduced: number;
  stillWrong: number;
  unknown: number;
  /** Still wrong after the re-run, for the step's detail: row, fee and the check it fails. */
  stillWrongRows: Array<{ feedbackId: number; feePublishedId: number; institutionId: number; check?: string; reason?: string }>;
}

export interface ErrorFixRecheckResult {
  /** Read-only official-source obligation outcomes, never a release approval. */
  sourceFirst?: SourceFirstRecoveryRead;
  entries: number;
  problems: string[];
  results: ErrorFixEntryResult[];
  written: number;
  skipped: string[];
}

function emptyOutcome(entry: ErrorFixEntry, named = 0): ErrorFixEntryResult {
  return {
    pr: entry.pr, issue: entry.issue ?? null, stage: entry.stage, named,
    waiting: 0, inactive: 0, readFailed: false, nowMatches: 0, notReproduced: 0, stillWrong: 0, unknown: 0, stillWrongRows: [],
  };
}

/** One fix's named rows judged, with the ledger rows they earn. Reads only. */
async function recheckEntry(db: SqlTag, entry: ErrorFixEntry, runId: number | null): Promise<{ outcome: ErrorFixEntryResult; ledger: FeedbackRow[] }> {
  const ledger: FeedbackRow[] = [];
  const rows = await namedRows(db, entry, ERROR_FIX_ROWS_PER_ENTRY);
  const outcome = emptyOutcome(entry, rows.length);
  const ready = rows.filter((row) => truthy(row.rerun));
  for (const row of rows) {
    if (truthy(row.rerun)) continue;
    if (truthy(row.bank_inactive)) outcome.inactive += 1;
    else outcome.waiting += 1;
  }
  if (ready.length === 0) return { outcome, ledger };
  const institutions = [...new Set(ready.map((row) => Number(row.institution_id)))];
  // reread_at: the last time a completed run read the fee's own document at this fix's Knox rules
  // version. A raw row that records the text it came from (`text_hash=`) must match that read's text.
  // published_at: when the fee's published row was written; a fee live since before the error never counts.
  // raw_created_at stays for the fresh audit's own checks; the judgement never dates a fee by it.
  const live = await db<ErrorFixFee[]>`
    SELECT c.id AS fee_id, c.fee_published_id, c.fee_verified_id AS lineage_ref, c.fee_raw_id, c.institution_id, c.source,
           c.source_document_id, c.canonical_fee_key, c.fee_name, c.amount, c.amount_kind, c.rate_percent,
           sd.document_url, fr.created_at AS raw_created_at, fp.published_at,
           (SELECT MAX(pa.created_at)
              FROM pipeline_attempts pa
              JOIN agent_runs run ON run.id = pa.agent_run_id AND run.status = 'completed'
             WHERE pa.institution_id = c.institution_id
               AND pa.source_document_id = c.source_document_id
               AND pa.stage = 'extract'
               AND pa.strategy = ${KNOX_RULES_STRATEGY.strategy}::text
               AND pa.strategy_version >= ${entry.knox_version}::int
               AND (substring(COALESCE(fr.extraction_note, fr.conditions, '') FROM 'text_hash=([^;]+);') IS NULL
                    OR pa.input_fingerprint = substring(COALESCE(fr.extraction_note, fr.conditions, '') FROM 'text_hash=([^;]+);'))
           ) AS reread_at
      FROM published_fee_catalog c
      JOIN published_fee_records fp ON fp.fee_published_id = c.fee_published_id
      LEFT JOIN source_documents sd ON sd.id = c.source_document_id
      LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = c.fee_raw_id
     WHERE c.institution_id = ANY(${institutions}::bigint[])
       AND c.review_status = 'approved'
       AND c.amount IS NOT NULL
       AND c.amount_kind IS DISTINCT FROM 'percent'
  `;
  const texts = await db<Array<InstitutionText & { institution_id: number | string }>>`
    SELECT DISTINCT ON (source_document_id) institution_id, source_document_id, normalized_text
      FROM agent_source_texts
     WHERE institution_id = ANY(${institutions}::bigint[])
       AND status = 'completed'
       AND normalized_text IS NOT NULL
     ORDER BY source_document_id, id DESC
  `;
  const evidence = await readEvidence(db, live.map((fee) => Number(fee.fee_published_id)));
  // Named fees still published but outside the dollar catalog read above, e.g. a rate.
  const stillPublished = new Set((await db<Array<{ fee_published_id: number | string }>>`
    SELECT fee_published_id FROM published_fee_records
     WHERE fee_published_id = ANY(${ready.map((row) => Number(row.fee_published_id))}::bigint[])
       AND rolled_back_at IS NULL
       AND quarantined_at IS NULL
  `).map((fee) => Number(fee.fee_published_id)));
  for (const row of ready) {
    const institutionId = Number(row.institution_id);
    const judgement = judgeErrorFix(
      row,
      live.filter((fee) => Number(fee.institution_id) === institutionId),
      texts.filter((text) => Number(text.institution_id) === institutionId),
      evidence,
      stillPublished.has(Number(row.fee_published_id)),
    );
    const feedbackId = Number(row.id);
    const feePublishedId = Number(row.fee_published_id);
    if (judgement.verdict === "unknown") { outcome.unknown += 1; continue; }
    if (judgement.verdict === "not_reproduced") { outcome.notReproduced += 1; continue; }
    if (judgement.verdict === "still_wrong") {
      outcome.stillWrong += 1;
      outcome.stillWrongRows.push({ feedbackId, feePublishedId, institutionId, check: judgement.check, reason: judgement.reason });
    } else outcome.nowMatches += 1;
    const closed = judgement.verdict === "now_matches";
    // A still-wrong row is recorded once per fix; it is judged again each day all the same.
    if (!closed && truthy(row.reported_still_wrong)) continue;
    ledger.push({
      aboutStage: entry.stage,
      signal: closed ? "right" : "wrong",
      kind: closed ? ERROR_FIX_CLOSED_KIND : ERROR_FIX_STILL_WRONG_KIND,
      reportedBy: "deming",
      checkName: ERROR_FIX_CHECK,
      institutionId,
      feePublishedId,
      canonicalFeeKey: row.canonical_fee_key,
      weight: 0,
      runId,
      evidence: {
        pr: entry.pr,
        issue: entry.issue ?? null,
        feedback_id: feedbackId,
        feedback_kind: row.kind,
        feedback_check: row.check_name,
        verdict: judgement.verdict,
        judged: judgement.judged,
        ...(judgement.check ? { check: judgement.check, reason: judgement.reason } : {}),
      },
      dedupeKey: ledgerKey(entry.pr, feedbackId, closed ? "closed" : "still_wrong"),
    });
  }
  return { outcome, ledger };
}

/**
 * Deming's daily error-fix re-check. Writes only the ledger rows, and nothing on a dry run. It runs
 * on the scoreboard step's transaction, so each fix's reads run in their own savepoint: a failed
 * read rolls back only that savepoint and is reported in `skipped`, and never aborts the
 * transaction the rest of the step, its ledger write and the scoreboard run go on with.
 */
export async function runErrorFixRecheck({
  db = sql,
  runId = null,
  dryRun = false,
  entries = ERROR_FIXES,
  sourceFirstRead = false,
}: { db?: SqlTag; runId?: number | null; dryRun?: boolean; entries?: readonly ErrorFixEntry[]; sourceFirstRead?: boolean } = {}): Promise<ErrorFixRecheckResult> {
  const problems = errorFixProblems(entries);
  const result: ErrorFixRecheckResult = { entries: entries.length, problems, results: [], written: 0, skipped: [] };
  if (sourceFirstRead) {
    try { result.sourceFirst = await runSourceFirstRecoveryRead(db); }
    catch (error) { result.skipped.push(`source-first read-only audit: ${error instanceof Error ? error.message : String(error)}`); }
  }
  if (entries.length === 0 || problems.length > 0) return result;
  const ledger: FeedbackRow[] = [];
  for (const entry of entries) {
    try {
      const checked = await inSavepoint(db, (scope) => recheckEntry(scope, entry, runId));
      result.results.push(checked.outcome);
      ledger.push(...checked.ledger);
    } catch (error) {
      result.results.push({ ...emptyOutcome(entry), readFailed: true });
      result.skipped.push(`PR #${entry.pr} read: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  if (dryRun) {
    result.skipped.push("dry run");
    return result;
  }
  if (ledger.length > 0) {
    try {
      result.written = await inSavepoint(db, (scope) => recordFeedback(scope, ledger));
    } catch (error) {
      result.skipped.push(`ledger: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}

export function summarizeErrorFixRecheck(result: ErrorFixRecheckResult): string {
  if (result.problems.length > 0) return `The error-fix registry has ${result.problems.length} problem(s); nothing re-checked: ${result.problems.join("; ")}`;
  if (result.entries === 0) return result.sourceFirst?.enrolled ? `No registered process fixes. ${sourceFirstRecoverySummary(result.sourceFirst)}` : "No process fix names the errors it fixes yet.";
  const total = (key: "named" | "waiting" | "inactive" | "nowMatches" | "notReproduced" | "stillWrong" | "unknown") =>
    result.results.reduce((sum, entry) => sum + entry[key], 0);
  const failed = result.results.filter((entry) => entry.readFailed).length;
  const inactive = total("inactive") > 0 ? ` ${total("inactive")} at banks no longer active, so never re-run.` : "";
  const unread = failed > 0 ? ` The read failed for ${failed} fix(es); they are re-checked on the next run.` : "";
  // Each fix's rows are read up to a limit, so a full window is a floor, not the total.
  const capped = result.results.some((entry) => entry.named >= ERROR_FIX_ROWS_PER_ENTRY);
  return `${capped ? "At least " : ""}${total("named")} open error(s) named by ${result.entries} fix(es): ${total("nowMatches")} closed (now match the bank's document), ${total("stillWrong")} still wrong after a re-run, ${total("notReproduced")} taken down with no right fee extracted in their place, ${total("waiting")} waiting for a re-run, ${total("unknown")} not judged (no stored text, or the fee is a rate or has no category).${inactive}${unread}`;
}

/** The step's detail: totals for the narration, and each fix's counts and still-wrong rows. */
export function errorFixDetail(result: ErrorFixRecheckResult) {
  const total = (pick: (entry: ErrorFixEntryResult) => number) => result.results.reduce((sum, entry) => sum + pick(entry), 0);
  return {
    entries: result.entries,
    problems: result.problems,
    closed: total((entry) => entry.nowMatches),
    not_reproduced: total((entry) => entry.notReproduced),
    still_wrong: total((entry) => entry.stillWrong),
    waiting: total((entry) => entry.waiting),
    inactive: total((entry) => entry.inactive),
    read_failed: result.results.filter((entry) => entry.readFailed).length,
    unknown: total((entry) => entry.unknown),
    written: result.written,
    skipped: result.skipped,
    fixes: result.results,
    source_first: result.sourceFirst ?? null,
  };
}
