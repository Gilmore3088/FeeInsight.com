import { sql } from "@/lib/data-store/connection";
import { inSavepoint } from "@/lib/agents/savepoint";
import { recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { KNOX_RULES_STRATEGY } from "@/lib/agents/knox/specialists";
import type { InstitutionText } from "@/lib/agents/hamilton/source-check";
import { readEvidence, scoreFreshAudit, type FreshAuditEvidence, type FreshAuditFee } from "./fresh-audit";
import registry from "./error-fixes.json";

type SqlTag = typeof sql;

/**
 * The error loop (#2058): a process fix names the error rows it fixes, the institutions behind
 * them are re-run through the fixed step, and each named error is re-checked against the bank's
 * own document, so a fix is known to have fixed its errors rather than assumed to.
 *
 * 1. A process-fix PR adds an entry to `error-fixes.json` in the same PR: the stage it fixed, the
 *    day it merged, and the `pipeline_feedback` rows it fixes (by kind, check name or id).
 * 2. Atlas's direct path (`selectPriorityInstitutions`) asks for each named row's institution as a
 *    request dated `merged_on`, so it is fetched, read, extracted, verified and published again
 *    under the fixed code; a run of its state's lane serves it just as well.
 * 3. Deming's daily `deming-error-fix-recheck` step (Atlas's scoreboard run) waits until a
 *    completed run has read the institution again after the fix and after the error, then judges
 *    the fee as it now stands with the fresh audit's checks (the shared source check
 *    `checkFeeAgainstSource` through `traceLiveFee`, the category guard, evidence and name). A row
 *    whose fee now matches, or is no longer published, is closed; a row still wrong is reported
 *    and recorded once, and is judged again each day in case a later pass fixes it.
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

/** The steps a direct run re-runs. A wrong document is Magellan's link search (#2055), not a re-run. */
export const ERROR_FIX_STAGES = ["read", "extract", "verify", "publish"] as const;
export type ErrorFixStage = (typeof ERROR_FIX_STAGES)[number];

export interface ErrorFixEntry {
  pr: number;
  issue?: number | null;
  stage: ErrorFixStage;
  /** ISO date the PR merged; only errors recorded before it are named. */
  merged_on: string;
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
  canonical_fee_key: string | null;
  kind: string;
  check_name: string | null;
  created_at: string | Date;
  /** A completed run read the institution again after the fix and after this error. */
  rerun: boolean | string | null;
  /** The ledger already holds a still-wrong record of this row for this fix. */
  reported_still_wrong?: boolean | string | null;
}

/** The entry's named errors not yet closed for it: wrong judgements of a published fee about its stage. */
async function namedRows(db: SqlTag, entry: ErrorFixEntry, limit: number): Promise<NamedErrorRow[]> {
  const ids = (entry.feedback_ids ?? []).map(Number);
  const closedPrefix = `deming.error_fix:${entry.pr}:`;
  return db<NamedErrorRow[]>`
    SELECT f.id, f.institution_id, f.fee_published_id, f.canonical_fee_key, f.kind, f.check_name, f.created_at,
           EXISTS (
             SELECT 1 FROM pipeline_attempts read
               JOIN agent_runs run ON run.id = read.agent_run_id AND run.status = 'completed'
              WHERE read.institution_id = f.institution_id
                AND read.stage = 'extract'
                AND read.strategy = ${KNOX_RULES_STRATEGY.strategy}::text
                AND read.created_at >= ${entry.merged_on}::timestamptz
                AND read.created_at > f.created_at
           ) AS rerun,
           EXISTS (
             SELECT 1 FROM pipeline_feedback still
              WHERE still.dedupe_key = ${closedPrefix}::text || f.id::text || ':still_wrong'
           ) AS reported_still_wrong
      FROM pipeline_feedback f
     WHERE f.signal = 'wrong'
       AND f.about_stage = ${entry.stage}::text
       AND f.created_at < ${entry.merged_on}::timestamptz
       AND f.fee_published_id IS NOT NULL
       AND f.institution_id IS NOT NULL
       AND (f.id = ANY(${ids}::bigint[]) OR f.kind = ANY(${entry.kinds ?? []}::text[]) OR f.check_name = ANY(${entry.checks ?? []}::text[]))
       AND NOT EXISTS (
         SELECT 1 FROM pipeline_feedback done
          WHERE done.dedupe_key = ${closedPrefix}::text || f.id::text || ':closed'
       )
     -- Rows not yet recorded as still wrong first, so a fix's stubborn rows never crowd out the rest.
     ORDER BY reported_still_wrong ASC, f.id
     LIMIT ${limit}::int
  `;
}

export interface ErrorFixRequest {
  institutionId: number;
  institutionName: string;
  reason: string;
  requestedAt: string;
}

/**
 * The institutions to re-run for the registry's fixes, as direct-path requests dated the day each
 * fix merged: one per institution with a named error not yet closed nor read again since. A request ends once a run
 * started after that date has read the bank (the `requested` tier's own rule), so an institution
 * whose error is still wrong after its re-run is not asked for again. Read-only.
 */
export async function errorFixRequests(db: SqlTag, entries: readonly ErrorFixEntry[] = ERROR_FIXES): Promise<ErrorFixRequest[]> {
  if (entries.length === 0 || errorFixProblems(entries).length > 0) return [];
  const requests = new Map<number, ErrorFixRequest>();
  for (const entry of entries) {
    if (requests.size >= ERROR_FIX_MAX_INSTITUTIONS) break;
    const rows = await namedRows(db, entry, ERROR_FIX_ROWS_PER_ENTRY);
    for (const row of rows) {
      const id = Number(row.institution_id);
      // Already read again after the fix (by its lane or a direct run): nothing to ask for.
      if (truthy(row.rerun)) continue;
      if (requests.has(id) || requests.size >= ERROR_FIX_MAX_INSTITUTIONS) continue;
      requests.set(id, {
        institutionId: id,
        institutionName: "",
        reason: `re-run after PR #${entry.pr}${entry.issue ? ` (#${entry.issue})` : ""} fixed the ${entry.stage} step behind an error read here`,
        requestedAt: entry.merged_on,
      });
    }
  }
  return [...requests.values()];
}

export type ErrorFixVerdict = "now_matches" | "not_live" | "still_wrong" | "unknown";

export interface ErrorFixJudgement {
  verdict: ErrorFixVerdict;
  /** The live fees judged: the named one while it is live, otherwise the bank's live fees in its category. */
  judged: number[];
  check?: string;
  reason?: string;
}

/**
 * Pure: is the named error gone? The named fee is judged while it is still live; once it is down,
 * the bank's live fees in the same category (its replacement) are judged. Every judged fee must
 * pass the fresh audit's checks; none live means the wrong fee is no longer published. A fee with
 * no stored text is unknown, never closed.
 */
export function judgeErrorFix(
  row: Pick<NamedErrorRow, "fee_published_id" | "canonical_fee_key">,
  live: FreshAuditFee[],
  texts: InstitutionText[],
  evidence?: FreshAuditEvidence,
): ErrorFixJudgement {
  const own = live.filter((fee) => Number(fee.fee_published_id) === Number(row.fee_published_id));
  const fees = own.length > 0 ? own : live.filter((fee) => row.canonical_fee_key != null && fee.canonical_fee_key === row.canonical_fee_key);
  const judged = fees.map((fee) => Number(fee.fee_published_id));
  if (fees.length === 0) return { verdict: "not_live", judged };
  const byInstitution = new Map<number, InstitutionText[]>();
  for (const fee of fees) byInstitution.set(Number(fee.institution_id), texts);
  const score = scoreFreshAudit(fees, byInstitution, evidence);
  const [miss] = score.misses;
  if (miss) return { verdict: "still_wrong", judged, check: miss.check, reason: miss.reason };
  if (score.noText > 0) return { verdict: "unknown", judged };
  return { verdict: "now_matches", judged };
}

export interface ErrorFixEntryResult {
  pr: number;
  issue: number | null;
  stage: ErrorFixStage;
  named: number;
  waiting: number;
  nowMatches: number;
  notLive: number;
  stillWrong: number;
  unknown: number;
  /** Still wrong after the re-run, for the step's detail: row, fee and the check it fails. */
  stillWrongRows: Array<{ feedbackId: number; feePublishedId: number; institutionId: number; check?: string; reason?: string }>;
}

export interface ErrorFixRecheckResult {
  entries: number;
  problems: string[];
  results: ErrorFixEntryResult[];
  written: number;
  skipped: string[];
}

/** Deming's daily error-fix re-check. Writes only the ledger rows, and nothing on a dry run. */
export async function runErrorFixRecheck({
  db = sql,
  runId = null,
  dryRun = false,
  entries = ERROR_FIXES,
}: { db?: SqlTag; runId?: number | null; dryRun?: boolean; entries?: readonly ErrorFixEntry[] } = {}): Promise<ErrorFixRecheckResult> {
  const problems = errorFixProblems(entries);
  const result: ErrorFixRecheckResult = { entries: entries.length, problems, results: [], written: 0, skipped: [] };
  if (entries.length === 0 || problems.length > 0) return result;
  const ledger: FeedbackRow[] = [];
  for (const entry of entries) {
    const rows = await namedRows(db, entry, ERROR_FIX_ROWS_PER_ENTRY);
    const outcome: ErrorFixEntryResult = {
      pr: entry.pr, issue: entry.issue ?? null, stage: entry.stage, named: rows.length,
      waiting: 0, nowMatches: 0, notLive: 0, stillWrong: 0, unknown: 0, stillWrongRows: [],
    };
    result.results.push(outcome);
    const ready = rows.filter((row) => truthy(row.rerun));
    outcome.waiting = rows.length - ready.length;
    if (ready.length === 0) continue;
    const institutions = [...new Set(ready.map((row) => Number(row.institution_id)))];
    const live = await db<FreshAuditFee[]>`
      SELECT c.id AS fee_id, c.fee_published_id, c.fee_verified_id AS lineage_ref, c.fee_raw_id, c.institution_id, c.source,
             c.source_document_id, c.canonical_fee_key, c.fee_name, c.amount, c.amount_kind, c.rate_percent,
             sd.document_url
        FROM published_fee_catalog c
        LEFT JOIN source_documents sd ON sd.id = c.source_document_id
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
    for (const row of ready) {
      const institutionId = Number(row.institution_id);
      const judgement = judgeErrorFix(
        row,
        live.filter((fee) => Number(fee.institution_id) === institutionId),
        texts.filter((text) => Number(text.institution_id) === institutionId),
        evidence,
      );
      const feedbackId = Number(row.id);
      const feePublishedId = Number(row.fee_published_id);
      if (judgement.verdict === "unknown") { outcome.unknown += 1; continue; }
      if (judgement.verdict === "still_wrong") {
        outcome.stillWrong += 1;
        outcome.stillWrongRows.push({ feedbackId, feePublishedId, institutionId, check: judgement.check, reason: judgement.reason });
      } else if (judgement.verdict === "now_matches") outcome.nowMatches += 1;
      else outcome.notLive += 1;
      const closed = judgement.verdict !== "still_wrong";
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
  if (result.entries === 0) return "No process fix names the errors it fixes yet.";
  const total = (key: "named" | "waiting" | "nowMatches" | "notLive" | "stillWrong" | "unknown") =>
    result.results.reduce((sum, entry) => sum + entry[key], 0);
  const closed = total("nowMatches") + total("notLive");
  return `${total("named")} open error(s) named by ${result.entries} fix(es): ${closed} closed (${total("nowMatches")} now match the bank's document, ${total("notLive")} no longer published), ${total("stillWrong")} still wrong after a re-run, ${total("waiting")} waiting for a re-run, ${total("unknown")} with no stored text.`;
}

/** The step's detail: totals for the narration, and each fix's counts and still-wrong rows. */
export function errorFixDetail(result: ErrorFixRecheckResult) {
  const total = (pick: (entry: ErrorFixEntryResult) => number) => result.results.reduce((sum, entry) => sum + pick(entry), 0);
  return {
    entries: result.entries,
    problems: result.problems,
    closed: total((entry) => entry.nowMatches + entry.notLive),
    still_wrong: total((entry) => entry.stillWrong),
    waiting: total((entry) => entry.waiting),
    unknown: total((entry) => entry.unknown),
    written: result.written,
    skipped: result.skipped,
    fixes: result.results,
  };
}
