import type { sql } from "@/lib/data-store/connection";
import registry from "./error-fixes.json";

type SqlTag = typeof sql;

/**
 * The error-fix registry (#2058) as the fixed steps read it. A light module: Rosetta's read step
 * and Darwin's verified recheck import it to force their re-run of the named rows, and neither may
 * load Deming's judgement (`error-fixes.ts` reaches Darwin's verify through the fresh audit, so
 * importing it from Darwin would be a cycle). The judgement, its validation and the ledger stay in
 * `error-fixes.ts`.
 */

/**
 * The steps whose fix a re-run reaches, each with its own re-run:
 * - read: Rosetta reads unchanged bytes only once, so its read step reopens the named documents
 *   (a `read.reopen` attempt naming the fix) and reads them again under the fixed reader;
 * - extract: Knox reads every stored text again once its rules version moves (`knox_version`);
 * - verify: Darwin's verified recheck reads the named fees once more after the merge day;
 * - publish: a direct run's publish step for the named institution runs Hamilton's publish and
 *   sweeps again after the merge day.
 * A wrong document is Magellan's link search (#2055), not a re-run.
 */
export const ERROR_FIX_STAGES = ["read", "extract", "verify", "publish"] as const;
export type ErrorFixStage = (typeof ERROR_FIX_STAGES)[number];

/**
 * The checks the fresh audit re-runs on a live fee (`fresh-audit.ts`: the shared source check, the
 * category guard, the not-a-fee line and name quality), so their errors can be judged gone at any
 * stage. Literal here so the light module loads nothing; `error-fixes.test.ts` pins them to the
 * fresh audit's own names.
 */
export const ERROR_FIX_CHECKS = ["hamilton.source_check", "hamilton.category_guard", "deming.not_a_fee_line", "deming.name_quality"] as const;

/**
 * A check the fresh audit does not run, re-run by the stage's own re-run: Darwin's verified recheck
 * reads the named fee again under today's verify checks and records its verdict on a
 * `verify.recheck` attempt, so a verify fix can name the rows that recheck raised.
 */
export const DARWIN_VERIFIED_RECHECK_CHECK = "darwin.verified_recheck";
export const STAGE_RERUN_CHECKS: Readonly<Partial<Record<ErrorFixStage, readonly string[]>>> = {
  verify: [DARWIN_VERIFIED_RECHECK_CHECK],
};

/** The checks whose rows an entry at this stage may name. */
export function judgedChecks(stage: ErrorFixStage): string[] {
  return [...ERROR_FIX_CHECKS, ...(STAGE_RERUN_CHECKS[stage] ?? [])];
}

export interface ErrorFixEntry {
  pr: number;
  issue?: number | null;
  stage: ErrorFixStage;
  /** ISO date the PR merged; only errors recorded before it are named. */
  merged_on: string;
  /** Extract fixes only: the Knox rules version (`KNOX_RULES_STRATEGY.version`) that carries the fix. */
  knox_version?: number | null;
  kinds?: string[];
  checks?: string[];
  feedback_ids?: number[];
  note?: string | null;
}

export const ERROR_FIXES: ErrorFixEntry[] = (registry as { entries: ErrorFixEntry[] }).entries;

export function errorFixLedgerPrefix(pr: number): string {
  return `deming.error_fix:${pr}:`;
}

/**
 * SQL (feedback alias `f`): the entry's named errors not yet closed for it. Wrong judgements of a
 * published fee about the entry's stage, recorded before the merge day (UTC), raised by a check the
 * re-check can judge at that stage, and named by id, kind or check. A read fix names only rows that
 * name a document, since the re-run reopens that document.
 */
export function namedErrorSql(db: SqlTag, entry: ErrorFixEntry) {
  const ids = (entry.feedback_ids ?? []).map(Number);
  return db`
       f.signal = 'wrong'
       AND f.about_stage = ${entry.stage}::text
       -- Before the merge day (UTC): an error filed after the fixed step already ran could never see
       -- a later run of it, and its bank would be asked for daily.
       AND f.created_at < ${entry.merged_on}::date::timestamp AT TIME ZONE 'UTC'
       AND f.fee_published_id IS NOT NULL
       AND f.institution_id IS NOT NULL
       ${entry.stage === "read" ? db`AND f.source_document_id IS NOT NULL` : db``}
       AND f.check_name = ANY(${judgedChecks(entry.stage)}::text[])
       AND (f.id = ANY(${ids}::bigint[]) OR f.kind = ANY(${entry.kinds ?? []}::text[]) OR f.check_name = ANY(${entry.checks ?? []}::text[]))
       AND NOT EXISTS (
         SELECT 1 FROM pipeline_feedback done
          WHERE done.dedupe_key = ${errorFixLedgerPrefix(entry.pr)}::text || f.id::text || ':closed'
       )`;
}

/** The merge day as a UTC timestamp, the earliest a re-run under the fixed code counts. */
export function mergedAtSql(db: SqlTag, entry: ErrorFixEntry) {
  return db`(${entry.merged_on}::date::timestamp AT TIME ZONE 'UTC')`;
}

export interface ErrorFixVerifyTarget {
  pr: number;
  fee_published_id: number | string;
  fee_verified_id: number | string;
}

/**
 * Darwin's re-run of a verify fix (#2058): the live fees its open named errors point at whose
 * verified row no `verify.recheck` attempt has read since the merge day. Darwin's verified recheck
 * reads these once more under today's checks, in place of waiting for a version bump that would
 * re-read every verified row. Read-only; empty while no verify fix is registered.
 */
export async function errorFixVerifyTargets(
  db: SqlTag,
  { limit, recheckStrategy, entries = ERROR_FIXES }: { limit: number; recheckStrategy: string; entries?: readonly ErrorFixEntry[] },
): Promise<ErrorFixVerifyTarget[]> {
  const targets = new Map<number, ErrorFixVerifyTarget>();
  for (const entry of entries) {
    if (entry.stage !== "verify" || targets.size >= limit) continue;
    const rows = await db<ErrorFixVerifyTarget[]>`
      SELECT DISTINCT ${entry.pr}::int AS pr, p.fee_published_id, p.lineage_ref AS fee_verified_id
        FROM pipeline_feedback f
        JOIN published_fee_records p ON p.fee_published_id = f.fee_published_id
       WHERE ${namedErrorSql(db, entry)}
         AND p.rolled_back_at IS NULL
         AND p.quarantined_at IS NULL
         AND p.lineage_ref IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_attempts pa
            WHERE pa.input_fingerprint = 'verified:' || p.lineage_ref::text
              AND pa.strategy = ${recheckStrategy}::text
              AND pa.created_at >= ${mergedAtSql(db, entry)}
         )
       ORDER BY p.fee_published_id
       LIMIT ${limit - targets.size}::int
    `;
    for (const row of rows) {
      if (!targets.has(Number(row.fee_verified_id))) targets.set(Number(row.fee_verified_id), row);
    }
  }
  return [...targets.values()];
}

export interface ErrorFixRereadDocument {
  pr: number;
  institution_id: number | string;
  source_document_id: number | string;
  content_hash: string;
  feedback_ids: Array<number | string>;
}

/**
 * Rosetta's re-run of a read fix (#2058): the current documents behind open named read errors
 * (the error's own document, or the copy that replaced it) whose bytes no primary read has read
 * since the merge day and that this fix has not reopened yet. Read-only; empty while no read fix
 * is registered.
 */
export async function errorFixRereadDocuments(
  db: SqlTag,
  {
    limit,
    auxiliaryStrategies,
    reopenStrategy,
    institutionId,
    stateCode,
    entries = ERROR_FIXES,
  }: {
    limit: number;
    /** Strategies that never settle a read (`AUXILIARY_READ_STRATEGIES`), so they never count as the re-read. */
    auxiliaryStrategies: readonly string[];
    reopenStrategy: string;
    institutionId?: number;
    stateCode?: string | null;
    entries?: readonly ErrorFixEntry[];
  },
): Promise<ErrorFixRereadDocument[]> {
  const documents: ErrorFixRereadDocument[] = [];
  const state = stateCode?.trim().toUpperCase() || null;
  for (const entry of entries) {
    if (entry.stage !== "read" || documents.length >= limit) continue;
    const rows = await db<ErrorFixRereadDocument[]>`
      SELECT ${entry.pr}::int AS pr, doc.institution_id, doc.id AS source_document_id, doc.content_hash,
             array_agg(DISTINCT f.id ORDER BY f.id) AS feedback_ids
        FROM pipeline_feedback f
        JOIN source_documents named ON named.id = f.source_document_id
        JOIN source_documents doc ON doc.id = COALESCE(named.superseded_by_id, named.id)
        JOIN institution_sources inst ON inst.id = doc.institution_id
       WHERE ${namedErrorSql(db, entry)}
         AND doc.institution_id = f.institution_id
         AND doc.status = 'success'
         AND doc.content_hash IS NOT NULL
         AND doc.superseded_by_id IS NULL
         AND doc.duplicate_of_id IS NULL
         AND COALESCE(inst.status, 'active') = 'active'
         AND (${institutionId ?? null}::bigint IS NULL OR doc.institution_id = ${institutionId ?? null}::bigint)
         AND (${state}::text IS NULL OR upper(btrim(inst.state_code)) = ${state}::text)
         -- Already read under the fixed reader: a primary read of these bytes since the merge day.
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_attempts again
            WHERE again.stage = 'read'
              AND again.institution_id = doc.institution_id
              AND again.input_fingerprint = doc.content_hash
              AND again.strategy <> ALL(${[...auxiliaryStrategies]}::text[])
              AND again.created_at >= ${mergedAtSql(db, entry)}
         )
         -- Reopened once per fix and bytes; a read that fails stays for the daily report.
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_attempts reopen
            WHERE reopen.stage = 'read'
              AND reopen.strategy = ${reopenStrategy}::text
              AND reopen.institution_id = doc.institution_id
              AND reopen.input_fingerprint = doc.content_hash
              AND reopen.detail->>'error_fix_pr' = ${String(entry.pr)}::text
         )
       GROUP BY doc.institution_id, doc.id, doc.content_hash
       ORDER BY doc.id
       LIMIT ${limit - documents.length}::int
    `;
    documents.push(...rows);
  }
  return documents;
}
