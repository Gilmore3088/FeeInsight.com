import { sql } from "@/lib/data-store/connection";
import { inSavepoint } from "@/lib/agents/savepoint";
import { recordFeedback, type FeedbackRow } from "@/lib/agents/learning/feedback";
import { getDisplayName } from "@/lib/fee-taxonomy";
import { AMOUNT_ERROR_KINDS, AMOUNT_LAYOUT_LABEL, amountClassRows, type AmountErrorRow, type AmountLayout } from "./amount-patterns";

type SqlTag = typeof sql;

/**
 * Error classes (#2063): the week's confirmed errors grouped by the step that made them and the
 * pattern they share, so the data lane fixes a class of errors at its step instead of one fee or
 * one bank at a time.
 *
 * A confirmed error is a `wrong` or `missed` `pipeline_feedback` row with weight from the last
 * seven days that is about a fee that went live, or was recorded by a person (a hold, a
 * correction). That includes Deming's own audit misses (a live fee checked against the bank's
 * document), which count at their lower weight's word: evidence, enough to group. Pre-publish
 * rejects that never reached a customer, and a missed fee with no live fee or person behind it, are
 * the owning agent's own batch signal, not a confirmed error. Rows group by stage, kind and pattern:
 *
 *   fee-level rows      the fee category (`canonical_fee_key`) the error repeats in
 *   document-level rows the document kind Rosetta stored (`agent_source_texts.document_kind`), or
 *                       for a read error the reader and document type (the layout)
 *   live wrong amounts  extract-stage amount errors on a live fee (`AMOUNT_ERROR_KINDS`) group by
 *                       the text layout around the fee (`amount-patterns.ts`, #2067), not by
 *                       category, and count how many rows today's source check still passes
 *
 * A class needs errors at two or more banks and a shared pattern; a pattern seen at one bank, or a
 * row with no pattern at all, is counted, not listed. Each class names its owner (the agent that
 * runs the stage) and keeps one weight-0 ledger row (`error_class`, `deming.error_classes`), opened
 * the first day it is seen and updated each day it is seen again with that day's counts, its date
 * and a GitHub-ready title and body. A class not seen again keeps its last date, which says how old
 * its counts are.
 * Read-only apart from that ledger; no model calls.
 */

export const ERROR_CLASS_KIND = "error_class";
export const ERROR_CLASS_CHECK = "deming.error_classes";
export const ERROR_CLASS_WINDOW_DAYS = 7;
/** Banks a pattern must reach to be a class rather than one bank's error. */
export const ERROR_CLASS_MIN_BANKS = 2;
/** Classes written and listed per run, largest first. */
export const ERROR_CLASS_LIMIT = 100;
const EXAMPLES = 5;
/** Live amount errors read with their document per run; a week holds a few dozen. */
const AMOUNT_ROW_LIMIT = 500;

export type ErrorClassStage = "discover" | "fetch" | "read" | "extract" | "verify" | "publish";

/** The agent that runs each stage, and so owns the fix for its classes. */
export const STAGE_OWNER: Record<ErrorClassStage, string> = {
  discover: "magellan",
  fetch: "magellan",
  read: "rosetta",
  extract: "knox",
  verify: "darwin",
  publish: "hamilton",
};

export interface ErrorClass {
  key: string;
  stage: ErrorClassStage;
  kind: string;
  /** What the errors share: `category:<key>`, `document:<kind>`, `layout:<reader>/<type>` or `amount:<layout>`. */
  pattern: string;
  owner: string;
  banks: number;
  fees: number;
  rows: number;
  checks: string[];
  exampleInstitutions: number[];
  exampleFees: number[];
  exampleFeedback: number[];
  /** Amount classes only: rows today's source check still passes, so no rule blocks the layout yet. */
  passesToday?: number;
}

export interface ErrorClassSummary {
  windowDays: number;
  confirmedRows: number;
  /** Patterns seen at only one bank. */
  oneBankPatterns: number;
  /** Rows with no category, layout or document kind to group by. */
  unpatternedRows: number;
  classes: ErrorClass[];
}

interface ClassRow {
  about_stage: string;
  kind: string;
  pattern: string;
  banks: number | string;
  fees: number | string;
  rows: number | string;
  checks: string[] | null;
  institutions: Array<number | string> | null;
  fee_ids: Array<number | string> | null;
  feedback_ids: Array<number | string> | null;
  passes_today?: number;
}

/** The read: confirmed errors, their pattern, grouped. Exported for the DB test. */
export async function readErrorClasses(db: SqlTag = sql, windowDays = ERROR_CLASS_WINDOW_DAYS): Promise<ErrorClassSummary> {
  const rows = await db<ClassRow[]>`
    WITH confirmed AS (
      SELECT f.id, f.about_stage, f.kind, f.check_name, f.institution_id, f.fee_published_id,
             CASE
               WHEN COALESCE(f.canonical_fee_key, fp.canonical_fee_key) IS NOT NULL
                 AND f.about_stage IN ('extract', 'verify', 'publish')
                 THEN 'category:' || COALESCE(f.canonical_fee_key, fp.canonical_fee_key)
               WHEN f.about_stage = 'read' AND t.reader IS NOT NULL
                 THEN 'layout:' || t.reader || '/' || COALESCE(t.document_type, 'unknown')
               WHEN t.document_kind IS NOT NULL THEN 'document:' || t.document_kind
               WHEN COALESCE(f.canonical_fee_key, fp.canonical_fee_key) IS NOT NULL
                 THEN 'category:' || COALESCE(f.canonical_fee_key, fp.canonical_fee_key)
               ELSE 'unknown'
             END AS pattern
        FROM pipeline_feedback f
        LEFT JOIN published_fee_records fp ON fp.fee_published_id = f.fee_published_id
        LEFT JOIN agent_source_texts t ON t.source_document_id = f.source_document_id
       WHERE f.created_at >= NOW() - make_interval(days => ${windowDays}::int)
         AND f.signal IN ('wrong', 'missed')
         AND f.weight > 0
         AND (f.fee_published_id IS NOT NULL OR f.reported_by = 'human')
         AND NOT (f.about_stage = 'extract' AND f.kind = ANY(${[...AMOUNT_ERROR_KINDS]}::text[]) AND f.fee_published_id IS NOT NULL)
    )
    SELECT about_stage, kind, pattern,
           COUNT(DISTINCT institution_id)::int AS banks,
           COUNT(DISTINCT fee_published_id)::int AS fees,
           COUNT(*)::int AS rows,
           array_agg(DISTINCT split_part(COALESCE(check_name, ''), ':', 1)) FILTER (WHERE check_name IS NOT NULL) AS checks,
           (array_agg(DISTINCT institution_id) FILTER (WHERE institution_id IS NOT NULL))[1:${EXAMPLES}] AS institutions,
           (array_agg(DISTINCT fee_published_id) FILTER (WHERE fee_published_id IS NOT NULL))[1:${EXAMPLES}] AS fee_ids,
           (array_agg(id ORDER BY id DESC))[1:${EXAMPLES}] AS feedback_ids
      FROM confirmed
     GROUP BY about_stage, kind, pattern
     ORDER BY banks DESC, rows DESC, about_stage, kind, pattern
  `;
  // The fee's document: the row's own, else the one Knox read the live fee from.
  const amountRows = await db<AmountErrorRow[]>`
    SELECT f.id AS feedback_id, f.kind, f.check_name, f.institution_id, f.fee_published_id,
           fp.fee_name, fp.amount, COALESCE(f.canonical_fee_key, fp.canonical_fee_key) AS canonical_fee_key,
           t.normalized_text AS text
      FROM pipeline_feedback f
      JOIN published_fee_records fp ON fp.fee_published_id = f.fee_published_id
      LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
      LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
      LEFT JOIN agent_source_texts t ON t.source_document_id = COALESCE(f.source_document_id, fr.source_document_id)
     WHERE f.created_at >= NOW() - make_interval(days => ${windowDays}::int)
       AND f.signal IN ('wrong', 'missed')
       AND f.weight > 0
       AND f.about_stage = 'extract'
       AND f.kind = ANY(${[...AMOUNT_ERROR_KINDS]}::text[])
     ORDER BY f.id DESC
     LIMIT ${AMOUNT_ROW_LIMIT}
  `;
  return summarizeRows([...rows, ...amountClassRows(amountRows, EXAMPLES)], windowDays);
}

/** Pure: rows into classes and the one-bank count. */
export function summarizeRows(rows: ClassRow[], windowDays = ERROR_CLASS_WINDOW_DAYS): ErrorClassSummary {
  const classes: ErrorClass[] = [];
  let confirmedRows = 0;
  let oneBankPatterns = 0;
  let unpatternedRows = 0;
  for (const row of rows) {
    confirmedRows += Number(row.rows);
    if (row.pattern === "unknown") {
      unpatternedRows += Number(row.rows);
      continue;
    }
    if (Number(row.banks) < ERROR_CLASS_MIN_BANKS) {
      oneBankPatterns += 1;
      continue;
    }
    const stage = row.about_stage as ErrorClassStage;
    classes.push({
      key: `${stage}:${row.kind}:${row.pattern}`,
      stage,
      kind: row.kind,
      pattern: row.pattern,
      owner: STAGE_OWNER[stage] ?? "unknown",
      banks: Number(row.banks),
      fees: Number(row.fees),
      rows: Number(row.rows),
      checks: [...(row.checks ?? [])].filter(Boolean).sort(),
      exampleInstitutions: (row.institutions ?? []).map(Number),
      exampleFees: (row.fee_ids ?? []).map(Number),
      exampleFeedback: (row.feedback_ids ?? []).map(Number),
      ...(row.passes_today === undefined ? {} : { passesToday: row.passes_today }),
    });
  }
  classes.sort((a, b) => b.banks - a.banks || b.rows - a.rows || a.key.localeCompare(b.key));
  return { windowDays, confirmedRows, oneBankPatterns, unpatternedRows, classes: classes.slice(0, ERROR_CLASS_LIMIT) };
}

/** Pure: the pattern in words. */
export function patternLabel(pattern: string): string {
  const [type, ...rest] = pattern.split(":");
  const value = rest.join(":");
  if (type === "category") return `${getDisplayName(value)} fees`;
  if (type === "document") return `${value.replaceAll("_", " ")} documents`;
  if (type === "layout") return `documents read by ${value}`;
  if (type === "amount") return AMOUNT_LAYOUT_LABEL[value as AmountLayout] ?? `amounts laid out as ${value}`;
  return "no shared pattern";
}


/** Pure: a record ready to paste into a GitHub issue for the class. */
export function classRecord(cls: ErrorClass, windowDays = ERROR_CLASS_WINDOW_DAYS): { title: string; body: string } {
  const title = `Error class: ${cls.kind.replaceAll("_", " ")} at ${cls.stage}, ${patternLabel(cls.pattern)} (${cls.banks} banks)`;
  const body = [
    `Deming's error classes (#2063) found this class in the last ${windowDays} days of confirmed errors.`,
    "",
    `- Step and owner: ${cls.stage} (${cls.owner})`,
    `- Error kind: \`${cls.kind}\`; checks: ${cls.checks.length ? cls.checks.map((check) => `\`${check}\``).join(", ") : "none recorded"}`,
    `- Pattern: \`${cls.pattern}\``,
    `- Reach: ${cls.banks} banks, ${cls.fees} live fees, ${cls.rows} error rows`,
    `- Examples: institutions ${cls.exampleInstitutions.join(", ") || "none"}; fees ${cls.exampleFees.join(", ") || "none"}; feedback rows ${cls.exampleFeedback.join(", ") || "none"}`,
    ...(cls.passesToday === undefined ? [] : [
      cls.passesToday > 0
        ? `- Today's source check still passes ${cls.passesToday} of ${cls.rows} rows, so Knox would keep this layout's wrong amount at a new bank: write the extraction rule, with its Darwin dry-run count (2026-10-15).`
        : `- Today's source check refuses all ${cls.rows} rows, so Knox's self-check already blocks this layout at every bank; re-run the banks behind it.`,
    ]),
    "",
    `Fix the ${cls.stage} step so the whole class is fixed, re-run the banks behind it, and add a ${cls.owner} lesson (#2054). Name the rows in \`error-fixes.json\` so Deming re-checks them after the fix (#2058).`,
  ].join("\n");
  return { title, body };
}

export interface ErrorClassesResult {
  summary: ErrorClassSummary | null;
  /** The UTC day the counts are for. */
  asOf: string;
  written: number;
  skipped: string[];
}

export async function runErrorClasses({
  db = sql,
  runId = null,
  dryRun = false,
  now = new Date(),
}: { db?: SqlTag; runId?: number | null; dryRun?: boolean; now?: Date } = {}): Promise<ErrorClassesResult> {
  const asOf = now.toISOString().slice(0, 10);
  const result: ErrorClassesResult = { summary: null, asOf, written: 0, skipped: [] };
  try {
    result.summary = await inSavepoint(db, (scope) => readErrorClasses(scope));
  } catch (error) {
    result.skipped.push(`read: ${error instanceof Error ? error.message : String(error)}`);
    return result;
  }
  if (dryRun) {
    result.skipped.push("dry run");
    return result;
  }
  const ledger: FeedbackRow[] = result.summary.classes.map((cls) => {
    const record = classRecord(cls, result.summary!.windowDays);
    return {
      aboutStage: cls.stage,
      signal: "wrong",
      kind: ERROR_CLASS_KIND,
      reportedBy: "deming",
      checkName: ERROR_CLASS_CHECK,
      weight: 0,
      runId,
      evidence: {
        as_of: asOf,
        window_days: result.summary!.windowDays,
        class_key: cls.key,
        error_kind: cls.kind,
        pattern: cls.pattern,
        owner: cls.owner,
        banks: cls.banks,
        fees: cls.fees,
        rows: cls.rows,
        checks: cls.checks,
        example_institutions: cls.exampleInstitutions,
        example_fees: cls.exampleFees,
        example_feedback: cls.exampleFeedback,
        ...(cls.passesToday === undefined ? {} : { passes_today: cls.passesToday }),
        github_title: record.title,
        github_body: record.body,
      },
      dedupeKey: `${ERROR_CLASS_CHECK}:${cls.key}`,
    };
  });
  if (ledger.length > 0) {
    try {
      result.written = await inSavepoint(db, (scope) => recordFeedback(scope, ledger));
    } catch (error) {
      result.skipped.push(`ledger: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}

export function summarizeErrorClasses(result: ErrorClassesResult): string {
  const summary = result.summary;
  if (!summary) return `Could not group the week's errors (${result.skipped.join("; ") || "no read"}).`;
  if (summary.classes.length === 0) return `No error pattern reached ${ERROR_CLASS_MIN_BANKS} banks in the last ${summary.windowDays} days (${summary.confirmedRows} confirmed error rows).`;
  const top = summary.classes[0];
  const classes = summary.classes.length === 1 ? "1 class" : `${summary.classes.length} classes`;
  return `Grouped ${summary.confirmedRows} confirmed error rows into ${classes} across banks; the largest is ${top.kind} at ${top.stage} on ${patternLabel(top.pattern)} (${top.banks} banks, ${top.owner}).`;
}

export function errorClassesDetail(result: ErrorClassesResult) {
  const summary = result.summary;
  return {
    as_of: result.asOf,
    window_days: summary?.windowDays ?? ERROR_CLASS_WINDOW_DAYS,
    confirmed_rows: summary?.confirmedRows ?? null,
    one_bank_patterns: summary?.oneBankPatterns ?? null,
    unpatterned_rows: summary?.unpatternedRows ?? null,
    classes: summary?.classes.length ?? null,
    written: result.written,
    skipped: result.skipped,
    top: (summary?.classes ?? []).slice(0, 25).map((cls) => ({
      key: cls.key, owner: cls.owner, banks: cls.banks, fees: cls.fees, rows: cls.rows,
      ...(cls.passesToday === undefined ? {} : { passes_today: cls.passesToday }),
    })),
  };
}

/** Pure: the morning brief's line, so the data lane starts from classes, not fees. */
export function errorClassLines(summary: ErrorClassSummary | null | undefined, shown = 3): string[] {
  if (summary === undefined) return [];
  if (summary === null) return ["Error classes this week: unavailable today."];
  if (summary.classes.length === 0) return [`Error classes this week (${ERROR_CLASS_MIN_BANKS}+ banks): none.`];
  const top = summary.classes.slice(0, shown).map((cls) => `${cls.kind} at ${cls.stage} on ${patternLabel(cls.pattern)} (${cls.banks} banks, ${cls.owner})`);
  return [`Error classes this week (${ERROR_CLASS_MIN_BANKS}+ banks): ${summary.classes.length}. Largest: ${top.join("; ")}.`];
}
