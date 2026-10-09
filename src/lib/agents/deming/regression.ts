import { sql } from "@/lib/data-store/connection";
import { inSavepoint } from "@/lib/agents/savepoint";
import { CONFIRMED_KIND } from "@/lib/agents/hamilton/second-look";
import { LIMIT_GUARD_CHECK } from "@/lib/agents/hamilton/limit-guard";
import { replayCase, SOURCE_CHECK_NAME, type CaseInput } from "@/lib/agents/deming/checkers";
import { severityFor, reasonCode, type Severity } from "@/lib/agents/deming/severity";

type SqlTag = typeof sql;

/**
 * Deming's daily regression step (`deming-regression`, Agentic OS PRD 7 and WP-05).
 *
 * 1. Promote: every fee a second look confirmed was wrong (`takedown_confirmed`) and that is
 *    still down becomes one `regression` case in `eval_cases`, with a severity, the check that
 *    caught it, and a frozen copy of what the check read (the fee and its stored text).
 * 2. Replay: the deployed rules run on every replayable case. A case the rule reproduces is
 *    `active`; an active case the rule no longer catches is a regression, reported in the step
 *    detail and on the scoreboard. A case whose fee was restored is `retired`: a later check
 *    found the takedown wrong, so it is not a lesson.
 *
 * Deterministic: no model calls, no fee rows written. Cases are never deleted; their input is
 * never rewritten after insert.
 */

export const DEMING_REGRESSION_VERSION = 1;
export const REGRESSION_PROMOTE_LIMIT = 300;
export const REGRESSION_REPLAY_LIMIT = 400;
const TEXT_CHAR_CAP = 200_000;

export function takedownCaseKey(feePublishedId: number, checkName: string): string {
  return `takedown:${feePublishedId}:${checkName}`;
}

export interface RegressionMiss {
  caseId: number;
  checkName: string | null;
  severity: Severity;
  verdict: string;
}

export interface DemingRegressionResult {
  schemaReady: boolean;
  dryRun: boolean;
  promoted: number;
  promotedActive: number;
  promotedBySeverity: Record<Severity, number>;
  replayed: number;
  caught: number;
  /** Active cases the deployed rules no longer catch. */
  regressions: RegressionMiss[];
  activated: number;
  retired: number;
  activeTotal: number;
  candidateTotal: number;
}

interface TakedownRow {
  feedback_id: number | string;
  check_name: string;
  reason: string | null;
  fee_published_id: number | string;
  institution_id: number | string;
  canonical_fee_key: string;
  fee_name: string | null;
  amount: number | string | null;
  amount_kind: string | null;
  rate_percent: number | string | null;
  source_url: string | null;
  lineage_ref: number | string | null;
  fee_raw_id: number | string | null;
  source: string | null;
  source_document_id: number | string | null;
  conditions: string | null;
}

interface TextRow {
  institution_id: number | string;
  source_document_id: number | string;
  normalized_text: string;
  text_hash: string | null;
}

interface CaseRow {
  id: number | string;
  check_name: string | null;
  severity: Severity;
  status: string;
  input: CaseInput;
  fee_published_id: number | string | null;
}

export interface NewCase {
  caseKey: string;
  checkName: string;
  errorClass: string;
  severity: Severity;
  status: "active" | "candidate";
  institutionId: number;
  sourceDocumentId: number | null;
  sourceUrl: string | null;
  sourceTextHash: string | null;
  feePublishedId: number;
  feeVerifiedId: number | null;
  feeRawId: number | null;
  input: CaseInput | { kind: "unreplayable"; fee_name: string | null; amount: number | null; canonical_fee_key: string; conditions: string | null };
  expected: { publishable: false; caught_by: string; reason: string | null };
  originFeedbackId: number;
  lastVerdict: string | null;
  lastCaught: boolean | null;
}

const num = (value: number | string | null | undefined): number | null =>
  value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);

const emptySeverities = (): Record<Severity, number> => ({ critical: 0, major: 0, minor: 0, info: 0 });

/** Pure: one confirmed takedown as a case, replayed on the rules this code ships with. */
export function buildTakedownCase(row: TakedownRow, texts: TextRow[]): NewCase {
  const feePublishedId = Number(row.fee_published_id);
  const institutionId = Number(row.institution_id);
  const sourceDocumentId = num(row.source_document_id);
  const amount = num(row.amount);
  let input: NewCase["input"];
  let sourceTextHash: string | null = null;
  if (row.check_name === LIMIT_GUARD_CHECK) {
    input = { kind: "limit_guard", canonical_fee_key: row.canonical_fee_key, fee_name: row.fee_name, amount, conditions: row.conditions };
  } else if (row.check_name === SOURCE_CHECK_NAME) {
    // A Knox fee answers only to the document Knox read it from (`traceLiveFee`).
    const own = texts.filter((text) => Number(text.institution_id) === institutionId)
      .filter((text) => row.source !== "knox" || num(text.source_document_id) === sourceDocumentId);
    sourceTextHash = own.find((text) => num(text.source_document_id) === sourceDocumentId)?.text_hash ?? null;
    input = {
      kind: "source_check",
      fee: {
        fee_published_id: feePublishedId,
        lineage_ref: num(row.lineage_ref) ?? 0,
        fee_raw_id: num(row.fee_raw_id) ?? 0,
        institution_id: institutionId,
        source: row.source ?? "",
        source_document_id: sourceDocumentId,
        canonical_fee_key: row.canonical_fee_key,
        fee_name: row.fee_name ?? "",
        amount,
        amount_kind: row.amount_kind,
        rate_percent: num(row.rate_percent),
      },
      texts: own.map((text) => ({ source_document_id: Number(text.source_document_id), normalized_text: text.normalized_text.slice(0, TEXT_CHAR_CAP) })),
    };
  } else {
    input = { kind: "unreplayable", fee_name: row.fee_name, amount, canonical_fee_key: row.canonical_fee_key, conditions: row.conditions };
  }
  const replay = input.kind === "unreplayable" ? null : replayCase(input);
  return {
    caseKey: takedownCaseKey(feePublishedId, row.check_name),
    checkName: row.check_name,
    errorClass: reasonCode(row.reason),
    severity: severityFor(row.check_name, row.reason),
    status: replay?.caught ? "active" : "candidate",
    institutionId,
    sourceDocumentId,
    sourceUrl: row.source_url,
    sourceTextHash,
    feePublishedId,
    feeVerifiedId: num(row.lineage_ref),
    feeRawId: num(row.fee_raw_id),
    input,
    expected: { publishable: false, caught_by: row.check_name, reason: row.reason },
    originFeedbackId: Number(row.feedback_id),
    lastVerdict: replay?.verdict ?? null,
    lastCaught: replay?.caught ?? null,
  };
}

export async function evalCasesSchemaReady(db: SqlTag): Promise<boolean> {
  const [row] = await db`SELECT to_regclass('public.eval_cases') IS NOT NULL AS ready`;
  return row?.ready === true;
}

async function loadNewTakedowns(db: SqlTag, limit: number): Promise<TakedownRow[]> {
  return db<TakedownRow[]>`
    SELECT f.id AS feedback_id, f.check_name, f.evidence->>'reason' AS reason,
           fp.fee_published_id, fp.institution_id, fp.canonical_fee_key, fp.fee_name, fp.amount,
           fp.amount_kind, fp.rate_percent, fp.source_url, fp.lineage_ref,
           fv.fee_raw_id, fr.source, fr.source_document_id, fr.conditions
      FROM pipeline_feedback f
      JOIN published_fee_records fp ON fp.fee_published_id = f.fee_published_id
      LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
      LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
     WHERE f.kind = ${CONFIRMED_KIND}
       AND f.check_name IS NOT NULL
       AND fp.rolled_back_at IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM eval_cases c
          WHERE c.case_key = 'takedown:' || f.fee_published_id::text || ':' || f.check_name
       )
     ORDER BY f.id
     LIMIT ${limit}
  `;
}

async function loadTexts(db: SqlTag, institutionIds: number[]): Promise<TextRow[]> {
  if (institutionIds.length === 0) return [];
  return db<TextRow[]>`
    SELECT DISTINCT ON (source_document_id) institution_id, source_document_id, normalized_text, text_hash
      FROM agent_source_texts
     WHERE institution_id = ANY(${institutionIds}::bigint[])
       AND status = 'completed'
       AND normalized_text IS NOT NULL
     ORDER BY source_document_id, id DESC
  `;
}

async function insertCases(db: SqlTag, cases: NewCase[], runId: number | null): Promise<number> {
  let written = 0;
  for (let start = 0; start < cases.length; start += 50) {
    const chunk = cases.slice(start, start + 50).map((item) => ({
      case_key: item.caseKey,
      check_name: item.checkName,
      error_class: item.errorClass,
      severity: item.severity,
      status: item.status,
      institution_id: item.institutionId,
      source_document_id: item.sourceDocumentId,
      source_url: item.sourceUrl,
      source_text_hash: item.sourceTextHash,
      fee_published_id: item.feePublishedId,
      fee_verified_id: item.feeVerifiedId,
      fee_raw_id: item.feeRawId,
      input: item.input,
      expected: item.expected,
      origin_feedback_id: item.originFeedbackId,
      last_verdict: item.lastVerdict,
      last_caught: item.lastCaught,
    }));
    const rows = await db`
      INSERT INTO eval_cases (
        case_key, dataset, status, agent, check_name, error_class, severity, institution_id,
        source_document_id, source_url, source_text_hash, fee_published_id, fee_verified_id, fee_raw_id,
        input, expected, label_provenance, origin_feedback_id, agent_run_id,
        last_checked_at, last_caught, last_verdict, last_run_id
      )
      SELECT case_key, 'regression', status, 'hamilton', check_name, error_class, severity, institution_id,
             source_document_id, source_url, source_text_hash, fee_published_id, fee_verified_id, fee_raw_id,
             input, expected, 'takedown_confirmed', origin_feedback_id, ${runId},
             CASE WHEN last_caught IS NULL THEN NULL ELSE NOW() END, last_caught, last_verdict,
             CASE WHEN last_caught IS NULL THEN NULL ELSE ${runId}::bigint END
        FROM jsonb_to_recordset(${JSON.stringify(chunk)}::jsonb) AS row(
          case_key text, check_name text, error_class text, severity text, status text,
          institution_id bigint, source_document_id bigint, source_url text, source_text_hash text,
          fee_published_id bigint, fee_verified_id bigint, fee_raw_id bigint, input jsonb, expected jsonb,
          origin_feedback_id bigint, last_verdict text, last_caught boolean
        )
      ON CONFLICT (case_key) DO NOTHING
      RETURNING id
    `;
    written += rows.length;
  }
  return written;
}

/** Pure: what one replay pass does to a case. */
export function replayOutcome(
  status: string,
  caught: boolean | null,
  feeRestored: boolean,
): { status: "active" | "candidate" | "retired"; regression: boolean } {
  if (feeRestored) return { status: "retired", regression: false };
  if (caught == null) return { status: status === "active" ? "active" : "candidate", regression: false };
  if (caught) return { status: "active", regression: false };
  return { status: status === "active" ? "active" : "candidate", regression: status === "active" };
}

export async function runDemingRegression({
  runId,
  dryRun = false,
  db = sql,
  promoteLimit = REGRESSION_PROMOTE_LIMIT,
  replayLimit = REGRESSION_REPLAY_LIMIT,
}: {
  runId: number | null;
  dryRun?: boolean;
  db?: SqlTag;
  promoteLimit?: number;
  replayLimit?: number;
}): Promise<DemingRegressionResult> {
  const result: DemingRegressionResult = {
    schemaReady: false,
    dryRun,
    promoted: 0,
    promotedActive: 0,
    promotedBySeverity: emptySeverities(),
    replayed: 0,
    caught: 0,
    regressions: [],
    activated: 0,
    retired: 0,
    activeTotal: 0,
    candidateTotal: 0,
  };
  result.schemaReady = await evalCasesSchemaReady(db);
  if (!result.schemaReady) return result;

  // 1. Promote confirmed takedowns that have no case yet.
  const takedowns = await inSavepoint(db, (scope) => loadNewTakedowns(scope, promoteLimit));
  const sourceInstitutions = [...new Set(takedowns.filter((row) => row.check_name === SOURCE_CHECK_NAME).map((row) => Number(row.institution_id)))];
  const texts = await inSavepoint(db, (scope) => loadTexts(scope, sourceInstitutions));
  const cases = takedowns.map((row) => buildTakedownCase(row, texts));
  for (const item of cases) {
    result.promotedBySeverity[item.severity] += 1;
    if (item.status === "active") result.promotedActive += 1;
  }
  result.promoted = dryRun ? cases.length : await insertCases(db, cases, runId);

  // 2. Replay every replayable case on the deployed rules, oldest check first.
  const due = await db<Array<CaseRow & { fee_live: boolean }>>`
    SELECT c.id, c.check_name, c.severity, c.status, c.input, c.fee_published_id,
           EXISTS (
             SELECT 1 FROM published_fee_records fp
              WHERE fp.fee_published_id = c.fee_published_id AND fp.rolled_back_at IS NULL
           ) AS fee_live
      FROM eval_cases c
     WHERE c.status IN ('active', 'candidate')
       AND c.input->>'kind' IN ('limit_guard', 'source_check')
     ORDER BY c.last_checked_at NULLS FIRST, c.id
     LIMIT ${replayLimit}
  `;
  const updates: Array<{ id: number; status: string; caught: boolean | null; verdict: string | null }> = [];
  for (const row of due) {
    const replay = replayCase(row.input);
    const outcome = replayOutcome(row.status, replay?.caught ?? null, row.fee_live);
    result.replayed += 1;
    if (replay?.caught) result.caught += 1;
    if (outcome.status === "active" && row.status !== "active") result.activated += 1;
    if (outcome.status === "retired") result.retired += 1;
    if (outcome.regression) {
      result.regressions.push({ caseId: Number(row.id), checkName: row.check_name, severity: row.severity, verdict: replay?.verdict ?? "unknown" });
    }
    updates.push({
      id: Number(row.id),
      status: outcome.status,
      caught: replay?.caught ?? null,
      verdict: row.fee_live ? "fee_restored" : replay?.verdict ?? null,
    });
  }
  if (!dryRun && updates.length > 0) {
    await db`
      UPDATE eval_cases c
         SET status = u.status,
             last_caught = u.caught,
             last_verdict = u.verdict,
             last_checked_at = NOW(),
             last_run_id = ${runId},
             updated_at = NOW()
        FROM jsonb_to_recordset(${JSON.stringify(updates)}::jsonb) AS u(id bigint, status text, caught boolean, verdict text)
       WHERE c.id = u.id
    `;
  }

  const [totals] = await db<Array<{ active: number | string; candidate: number | string }>>`
    SELECT COUNT(*) FILTER (WHERE status = 'active') AS active,
           COUNT(*) FILTER (WHERE status = 'candidate') AS candidate
      FROM eval_cases
  `;
  result.activeTotal = Number(totals?.active ?? 0);
  result.candidateTotal = Number(totals?.candidate ?? 0);
  return result;
}

export function summarizeDemingRegression(result: DemingRegressionResult): string {
  if (!result.schemaReady) return "Deming read no cases: the eval_cases table is not created yet.";
  const verb = result.dryRun ? "Would add" : "Added";
  const severity = (["critical", "major", "minor", "info"] as const)
    .filter((key) => result.promotedBySeverity[key] > 0)
    .map((key) => `${result.promotedBySeverity[key]} ${key}`)
    .join(", ");
  const added = result.promoted > 0 ? `${verb} ${result.promoted} confirmed mistakes as test cases${severity ? ` (${severity})` : ""}. ` : "No new confirmed mistakes. ";
  const regressions = result.regressions.length === 0
    ? "no regressions"
    : `${result.regressions.length} regression${result.regressions.length === 1 ? "" : "s"}: the deployed rules no longer catch ${result.regressions.length === 1 ? "a case" : "cases"} they used to`;
  return `${added}Replayed ${result.replayed} cases on the deployed rules: ${result.caught} still caught, ${regressions}. ${result.activeTotal} active, ${result.candidateTotal} waiting for a replayer.`;
}
