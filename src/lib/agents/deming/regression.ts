import { sql } from "@/lib/data-store/connection";
import { inSavepoint } from "@/lib/agents/savepoint";
import { recordStepWarning } from "@/lib/agents/hamilton/step-warning";
import { CONFIRMED_KIND } from "@/lib/agents/hamilton/second-look";
import { LIMIT_GUARD_CHECK } from "@/lib/agents/hamilton/limit-guard";
import { FIELD_REPLAY_CHECKS, replayCase, SOURCE_CHECK_NAME, WRONG_DOCUMENT_CHECKS, type CaseInput } from "@/lib/agents/deming/checkers";
import { CATEGORY_GUARD_CHECK } from "@/lib/agents/hamilton/category-guard";
import { BUSINESS_SCHEDULE_CHECK } from "@/lib/agents/hamilton/business-schedule";
import { SAME_LINE_DUPLICATE_CHECK, SAME_LINE_DUPLICATE_REASON, sameLineReplacementSql } from "@/lib/agents/hamilton/same-line-duplicates";
import { ACCOUNT_TYPE_HOLD_REASON } from "@/lib/agents/hamilton/account-type-hold";
import { SOURCE_CHECK_RESTORE_PREFIX, SOURCE_CHECK_STRATEGY } from "@/lib/agents/hamilton/source-check";
import { NON_DEPOSIT_CHECK, NON_DEPOSIT_CHECK_VERSION } from "@/lib/agents/darwin/non-deposit-document-check";
import { CATEGORY_GUARD_VERSION } from "@/lib/fee-category-guard";
import { FIXTURE_CASE_KEYS, fixtureDrift, isFixtureCase, type FixtureDrift } from "@/lib/agents/deming/regression-fixture";
import { severityFor, reasonCode, type Severity } from "@/lib/agents/deming/severity";

import { CORRECTIVE_CHECK } from "./corrective-source";
import { runCorrectiveSource, type CorrectiveResult } from "./corrective-source-store";

type SqlTag = typeof sql;

/**
 * Deming's daily regression step (`deming-regression`, Agentic OS PRD 7 and WP-05).
 *
 * 1. Promote: every fee a second look confirmed was wrong (`takedown_confirmed`) and that is
 *    still down becomes one `regression` case in `eval_cases`, with a severity, the check that
 *    caught it, and a frozen copy of what the check read (the fee and its stored text).
 * 2. Replay: the deployed rules run on every replayable case. A case the rule reproduces is
 *    `active`; an active case the rule no longer catches is a regression, reported in the step
 *    detail and on the scoreboard. A takedown case whose fee was restored is `retired`: a later
 *    check found the takedown wrong, so it is not a lesson. Takedowns frozen before their check had
 *    a replayer replay by their check name from the fee's own fields (`FIELD_REPLAY_CHECKS`,
 *    #2064): the category guard, the limit guard, and the audience rules for business-schedule
 *    takedowns (a business fee shown as a consumer one; `replayAudience`). The fresh audit's misses stay candidates the
 *    replay never reads: an audit alone never confirms a label (#1119). Wrong-document takedowns
 *    (product page, article page, non-deposit document) replay on their document's address, and
 *    same-line duplicates on whether the line they repeat is still on the catalog (#2064).
 *    Every fee-fields case, the limit guard's own cases included, reads the fee as live only in
 *    the category it was taken down from, and an active case whose fee is live again while the
 *    rule passes it is a regression (`replayFieldCase`).
 * 3. Accept: a case whose fee a check version deliberately accepts retires only when a reviewed
 *    entry in `ACCEPTED_TAKEDOWNS` names it (PR-reviewed, tied to the check version that accepts
 *    it), so an accepted fee stops flagging daily without a person writing to the database. A
 *    regression whose fee is live names the check that restored it (`restoredBy`, the restore
 *    marker every tagged restore leaves, `markRestoredForSourceCheck`).
 * 4. Fixture: the step counts the active cases the committed CI fixture lacks, and the fixture
 *    keys no longer active (`fixtureDrift`), so a stale fixture shows on the run ledger.
 *
 * Deterministic: no model calls, no fee rows written. Cases are never deleted; their input is
 * never rewritten after insert.
 */

export const DEMING_REGRESSION_VERSION = 2;
export const REGRESSION_PROMOTE_LIMIT = 300;
export const REGRESSION_REPLAY_LIMIT = 400;
/** Fee-fields takedown cases replayed per run, apart from the limit above: each is a pure check of a few fields. */
export const FIELD_REPLAY_LIMIT = 2_500;
const TEXT_CHAR_CAP = 200_000;

export function takedownCaseKey(feePublishedId: number, checkName: string): string {
  return `takedown:${feePublishedId}:${checkName}`;
}

export interface RegressionMiss {
  caseId: number;
  checkName: string | null;
  severity: Severity;
  verdict: string;
  /** The fee is live again: the check whose restore put it back, when the restore left a marker. */
  restoredBy?: string | null;
}

/**
 * A takedown a check version deliberately accepts (#2064): its case retires instead of flagging
 * as a regression every day. Each entry is reviewed in a PR and names the check, the fees, the
 * check version that accepts them (`sinceVersion`, compared with `CHECK_VERSIONS`; an entry for
 * a check with no version applies as soon as it merges) and why. It applies only while today's
 * rule passes the fee: a fee the rule catches again keeps its case.
 */
export interface AcceptedTakedown {
  check: string;
  feePublishedIds: readonly number[];
  sinceVersion?: number;
  why: string;
  issue: number;
}

/** None yet: on 2026-10-27 no active case had its fee live and uncaught (prod, read-only). */
export const ACCEPTED_TAKEDOWNS: readonly AcceptedTakedown[] = [];

/** The deployed version of each check that has one. */
export const CHECK_VERSIONS: Readonly<Record<string, number>> = {
  [CATEGORY_GUARD_CHECK]: CATEGORY_GUARD_VERSION,
  [NON_DEPOSIT_CHECK]: NON_DEPOSIT_CHECK_VERSION,
};

/** Pure: the reviewed acceptance of this case's fee by its check's deployed version, or null. */
export function acceptedTakedown(
  checkName: string | null,
  feePublishedId: number | null,
  list: readonly AcceptedTakedown[] = ACCEPTED_TAKEDOWNS,
  versions: Readonly<Record<string, number>> = CHECK_VERSIONS,
): AcceptedTakedown | null {
  if (!checkName || feePublishedId == null) return null;
  return list.find((entry) => entry.check === checkName && entry.feePublishedIds.includes(feePublishedId)
    && (entry.sinceVersion == null || (versions[checkName] ?? 0) >= entry.sinceVersion)) ?? null;
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
  /** Audience cases left unjudged (no stored text for their document); each keeps its last verdict. */
  notJudged: number;
  /** Cases retired because a reviewed entry says their check's deployed version accepts the fee. */
  accepted?: number;
  /** The committed CI fixture against today's active fixture-eligible cases. */
  fixture?: FixtureDrift | null;
  /** Fee-fields cases due for a replay; above twice the per-run limit the rotation falls behind. */
  fieldEligible?: number | null;
  /** The fee-fields cases this run replays at most (`fieldLimit`). */
  fieldLimit?: number;
  /** The fee-fields read failed: nothing in it was replayed this run (the step records a warning). */
  fieldReadError?: string | null;
  /** Prospective human corrective contexts; historical totals above are not trusted source denominators. */
  corrective?: CorrectiveResult;
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
  /** The address of the document the fee was read from (the business-schedule read's input). */
  document_url?: string | null;
  /** The raw row's own address, the one Darwin reads audience from. */
  raw_source_url?: string | null;
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
  input: CaseInput;
  expected: { publishable: false; caught_by: string; reason: string | null };
  originFeedbackId: number;
  lastVerdict: string | null;
  lastCaught: boolean | null;
}

const num = (value: number | string | null | undefined): number | null =>
  value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value);

const emptySeverities = (): Record<Severity, number> => ({ critical: 0, major: 0, minor: 0, info: 0 });

/** Historical fixture builder. Runtime excludes unbound source takedowns; new source contexts require the canonical v2 path. */
export function buildTakedownCase(row: TakedownRow, texts: TextRow[]): NewCase {
  const feePublishedId = Number(row.fee_published_id);
  const institutionId = Number(row.institution_id);
  const sourceDocumentId = num(row.source_document_id);
  const amount = num(row.amount);
  let input: NewCase["input"];
  let sourceTextHash: string | null = null;
  if (row.check_name === LIMIT_GUARD_CHECK) {
    input = { kind: "limit_guard", canonical_fee_key: row.canonical_fee_key, fee_name: row.fee_name, amount, conditions: row.conditions };
  } else if (row.check_name === CATEGORY_GUARD_CHECK) {
    input = { kind: "category_guard", canonical_fee_key: row.canonical_fee_key, fee_name: row.fee_name, amount, conditions: row.conditions };
  } else if (row.check_name === BUSINESS_SCHEDULE_CHECK) {
    input = { kind: "audience", canonical_fee_key: row.canonical_fee_key, fee_name: row.fee_name, amount, conditions: row.conditions, document_url: row.document_url ?? null, darwin_url: row.raw_source_url ?? null };
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
  const replay = replayCase(input, row.check_name, { documentUrl: row.document_url ?? null, sourceDocumentId });
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
           fv.fee_raw_id, fr.source, fr.source_document_id, COALESCE(fr.extraction_note, fr.conditions) AS conditions,
           sd.document_url, fr.source_url AS raw_source_url
      FROM pipeline_feedback f
      JOIN published_fee_records fp ON fp.fee_published_id = f.fee_published_id
      LEFT JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
      LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
      LEFT JOIN source_documents sd ON sd.id = fr.source_document_id
     WHERE f.kind = ${CONFIRMED_KIND}
       AND f.check_name IS NOT NULL
       AND f.check_name <> ${SOURCE_CHECK_NAME}
       AND fp.rolled_back_at IS NOT NULL
       AND NOT EXISTS (
         SELECT 1 FROM eval_cases c
          WHERE c.case_key = 'takedown:' || f.fee_published_id::text || ':' || f.check_name
       )
     ORDER BY f.id
     LIMIT ${limit}
  `;
}

/**
 * Each document's newest completed text, the one Darwin reads: its verify (`loadSourceTexts`, the
 * audience replay) and its non-deposit opening read (`documentOpeningsSql`). `agent_source_texts`
 * holds one row per document (unique `source_document_id`, prod and the test schema, 2026-10-27),
 * so both reads are this row; a completed row with no text judges nothing, never an older text.
 */
async function loadDocumentTexts(db: SqlTag, documentIds: number[]): Promise<Map<number, string>> {
  if (documentIds.length === 0) return new Map();
  const rows = await db<Array<{ source_document_id: number | string; normalized_text: string | null }>>`
    SELECT DISTINCT ON (source_document_id) source_document_id, normalized_text
      FROM agent_source_texts
     WHERE source_document_id = ANY(${documentIds}::bigint[])
       AND status = 'completed'
     ORDER BY source_document_id, id DESC
  `;
  return new Map(rows.filter((row) => row.normalized_text).map((row) => [Number(row.source_document_id), row.normalized_text as string]));
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

/**
 * Pure: one takedown frozen as fee fields, replayed by its check name (#2064). `fee_live` means the
 * fee is live again in the category it was taken down from (a re-file elsewhere proves the
 * takedown right). Hamilton's category guard restores every takedown today's guard passes, so a
 * restored fee is not by itself a later check finding the takedown wrong: when an active case's
 * rule no longer catches it, the restore is the regression and is reported, and the case stays
 * active until a person retires it. A restored fee the rule still catches was brought back by
 * another check (a second look), so its case retires as before.
 *
 * A wrong-document case (product page, article page, non-deposit document) whose fee is live in its
 * category while today's rule still catches its document is a regression, not a retirement: no
 * second look clears a document's address.
 *
 * A business-schedule case never retires on a restore: Hamilton brings such a fee back when the
 * bank's consumer fee in its category is gone (`restoreBusinessScheduleTakedowns`), which does not
 * make it a consumer fee, and a retired case key would keep every later takedown of the same fee
 * out of the replay. Its case keeps its status while the rules still catch it.
 */
export function replayFieldCase(row: {
  status: string;
  check_name: string | null;
  input: CaseInput;
  fee_live: boolean;
  document_url?: string | null;
  raw_source_url?: string | null;
  document_text?: string | null;
  source_document_id?: number | null;
  kept_line_present?: boolean | null;
  fee_published_id?: number | null;
}, accepted: readonly AcceptedTakedown[] = ACCEPTED_TAKEDOWNS) {
  const replay = replayCase(row.input, row.check_name, {
    documentUrl: row.document_url ?? null,
    darwinUrl: row.raw_source_url ?? null,
    documentText: row.document_text ?? null,
    sourceDocumentId: row.source_document_id ?? null,
    keptLinePresent: row.kept_line_present ?? null,
  });
  const caught = replay?.caught ?? null;
  // A reviewed acceptance retires the case, but only while today's rule passes the fee.
  const acceptance = caught === false ? acceptedTakedown(row.check_name, row.fee_published_id ?? null, accepted) : null;
  if (acceptance) {
    const version = acceptance.sinceVersion == null ? "" : `@v${acceptance.sinceVersion}`;
    return { replay, restored: false, accepted: `accepted:${acceptance.check}${version}`, outcome: { status: "retired" as const, regression: false } };
  }
  if (row.check_name === SAME_LINE_DUPLICATE_CHECK) return { replay, restored: false, accepted: null, outcome: duplicateOutcome(row.status, caught, row.fee_live) };
  // A wrong-document fee live in its category while today's rule still refuses its document is the
  // error back on the catalog (review of #2064): a regression, never a restore that retires the case.
  if (row.check_name && WRONG_DOCUMENT_CHECKS.includes(row.check_name) && row.fee_live && caught === true) {
    return { replay, restored: false, accepted: null, outcome: { status: "active" as const, regression: true } };
  }
  const ruleLetItBack = row.fee_live && caught === false && row.status === "active";
  const keepsThroughRestore = row.check_name === BUSINESS_SCHEDULE_CHECK || row.input.kind === "audience";
  const restored = row.fee_live && !ruleLetItBack && !keepsThroughRestore;
  return { replay, restored, accepted: null, outcome: ruleLetItBack ? { status: "active" as const, regression: true } : replayOutcome(row.status, caught, restored) };
}

/**
 * Pure: a same-line duplicate's replay (#2064). Caught (the line it repeats is still on the
 * catalog) and live again is the error back on the catalog: a regression, whatever the case's
 * status. Caught and down is `active`. Not caught (that line is gone, so Hamilton's restore brings
 * the copy back on purpose) is a `candidate`, never retired, so the case is active again if the
 * line it repeats comes back. Nothing judged keeps the status.
 */
export function duplicateOutcome(status: string, caught: boolean | null, feeLive: boolean): { status: "active" | "candidate"; regression: boolean } {
  if (caught == null) return { status: status === "active" ? "active" : "candidate", regression: false };
  if (caught) return { status: "active", regression: feeLive };
  return { status: "candidate", regression: false };
}

/** A restore marker for one fee: the check that restored it and when. */
export interface RestoreMarker {
  fee_published_id: number | string;
  restored_by: string | null;
  created_at: string | Date;
}

/**
 * Pure: the check whose restore put a live fee back, from its restore markers: the newest marker
 * written after the case's takedown (`takenDownAt`). An older marker is an earlier, unrelated
 * restore, so the fee's restorer is unknown (null) rather than attributed to it.
 */
export function restorerAfter(markers: readonly RestoreMarker[], takenDownAt: string | Date | null): string | null {
  const since = takenDownAt == null ? null : new Date(takenDownAt).getTime();
  const newest = markers
    .filter((marker) => marker.restored_by && (since == null || Number.isNaN(since) || new Date(marker.created_at).getTime() > since))
    .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())[0];
  return newest?.restored_by ?? null;
}

/**
 * Each live fee's restore markers (`markRestoredForSourceCheck`), newest first. A marker is a
 * publish-stage attempt on the fee's institution, so the read goes through the institution index
 * (74 ms on prod for four institutions, 2026-10-27; a fingerprint-prefix read scanned every
 * source-check attempt, 8.5 s).
 */
async function restoreMarkers(db: SqlTag, fees: Array<{ feeId: number; institutionId: number }>): Promise<Map<number, RestoreMarker[]>> {
  if (fees.length === 0) return new Map();
  const rows = await inSavepoint(db, (scope) => scope<RestoreMarker[]>`
    SELECT detail->>'restored_fee_published_id' AS fee_published_id, detail->>'restored_by' AS restored_by, created_at
      FROM pipeline_attempts
     WHERE institution_id = ANY(${[...new Set(fees.map((fee) => fee.institutionId))]}::bigint[])
       AND stage = 'publish'
       AND strategy = ${SOURCE_CHECK_STRATEGY.strategy}
       AND input_fingerprint LIKE ${`${SOURCE_CHECK_RESTORE_PREFIX}%`}
       AND detail->>'restored_fee_published_id' = ANY(${fees.map((fee) => String(fee.feeId))}::text[])
     ORDER BY created_at DESC, id DESC
  `);
  const byFee = new Map<number, RestoreMarker[]>();
  for (const row of rows) {
    const id = Number(row.fee_published_id);
    byFee.set(id, [...(byFee.get(id) ?? []), row]);
  }
  return byFee;
}

export async function runDemingRegression({
  runId,
  dryRun = false,
  db = sql,
  promoteLimit = REGRESSION_PROMOTE_LIMIT,
  replayLimit = REGRESSION_REPLAY_LIMIT,
  fieldLimit = FIELD_REPLAY_LIMIT,
  accepted = ACCEPTED_TAKEDOWNS,
}: {
  runId: number | null;
  dryRun?: boolean;
  db?: SqlTag;
  promoteLimit?: number;
  replayLimit?: number;
  fieldLimit?: number;
  /** The reviewed acceptances (tests pass their own). */
  accepted?: readonly AcceptedTakedown[];
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
    notJudged: 0,
  };
  result.schemaReady = await evalCasesSchemaReady(db);
  if (!result.schemaReady) return result;

  // 1. Promote confirmed takedowns that have no case yet.
  const takedowns = await inSavepoint(db, (scope) => loadNewTakedowns(scope, promoteLimit));
  // Unbound temporal source labels cannot authorize a new extraction lesson. Existing source
  // history remains immutable; prospective human corrections use their own canonical context.
  const cases = takedowns.map((row) => buildTakedownCase(row, []));
  for (const item of cases) {
    result.promotedBySeverity[item.severity] += 1;
    if (item.status === "active") result.promotedActive += 1;
  }
  result.promoted = dryRun ? cases.length : await insertCases(db, cases, runId);

  // 2. Replay every replayable case on the deployed rules, oldest check first. The limit guard's own
  // cases share the fee-fields pass (#2064): a fee is live only in the category it was taken down
  // from, and an active case whose fee is live again while the guard passes it is a regression.
  const updates: Array<{ id: number; status: string; caught: boolean | null; verdict: string | null }> = [];
  // Takedowns frozen as fee fields, replayed by their check name (#2064).
  // An old snapshot froze no addresses: the case's document's own address stands in for the one the
  // business-schedule read judges, and its raw row's `source_url` for the one Darwin reads (as a new
  // case freezes both).
  // A same-line case's kept line: the one its takedown named (the fee's current same-line takedown
  // reason, else the one frozen with the case), present as Hamilton's restore reads it: live or held,
  // or replaced by a line still on the catalog at the copy's institution, category and price.
  type FieldRow = CaseRow & {
    fee_live: boolean; document_url: string | null; raw_source_url: string | null; source_document_id: number | string | null;
    kept_line_present: boolean | null; taken_down_at: string | Date | null; institution_id: number | string | null;
  };
  const fieldWhere = db`
     c.status IN ('active', 'candidate')
       AND (c.input->>'kind' = 'limit_guard'
            OR (c.dataset = 'regression'
                AND c.label_provenance = 'takedown_confirmed'
                AND (c.input->>'kind' IN ('category_guard', 'audience')
                     OR (c.input->>'kind' = 'unreplayable' AND c.check_name = ANY(${[...FIELD_REPLAY_CHECKS]}::text[])))))`;
  let fieldDue: FieldRow[] = [];
  try {
    fieldDue = await inSavepoint(db, (scope) => scope<FieldRow[]>`
    SELECT c.id, c.check_name, c.severity, c.status, c.input, c.fee_published_id, c.source_document_id, c.institution_id,
           sd.document_url, fr.source_url AS raw_source_url,
           COALESCE(origin.created_at, c.created_at) AS taken_down_at,
           (cf.fee_published_id IS NOT NULL AND cf.rolled_back_at IS NULL
            AND cf.canonical_fee_key IS NOT DISTINCT FROM c.input->>'canonical_fee_key') IS TRUE AS fee_live,
           CASE WHEN c.check_name = ${SAME_LINE_DUPLICATE_CHECK} AND kept_id.id IS NOT NULL THEN
             (kept.fee_published_id IS NOT NULL
              AND COALESCE(kept.rolled_back_at IS NULL OR kept.rolled_back_reason LIKE ${`${ACCOUNT_TYPE_HOLD_REASON}:%`}, FALSE))
             OR ${db.unsafe(sameLineReplacementSql("cf", "kept_id.id", { countHeld: true }))} IS NOT NULL
           END AS kept_line_present
      FROM eval_cases c
      LEFT JOIN published_fee_records cf ON cf.fee_published_id = c.fee_published_id
      LEFT JOIN source_documents sd ON sd.id = c.source_document_id
      LEFT JOIN raw_fee_observations fr ON fr.fee_raw_id = c.fee_raw_id
      LEFT JOIN pipeline_feedback origin ON origin.id = c.origin_feedback_id
      -- The kept line's id: the fee's own same-line takedown reason, else the one frozen with the
      -- case (the fee may be down for another reason now). Only 1-18 digits, so the cast never fails.
      LEFT JOIN LATERAL (
        SELECT CASE WHEN length(ref.digits) BETWEEN 1 AND 18 THEN ref.digits::bigint END AS id
          FROM (SELECT substring(COALESCE(
                  CASE WHEN cf.rolled_back_reason LIKE ${`${SAME_LINE_DUPLICATE_REASON}:%`} THEN cf.rolled_back_reason END,
                  c.expected->>'reason') FROM '#([0-9]+)') AS digits) ref
         WHERE c.check_name = ${SAME_LINE_DUPLICATE_CHECK}
      ) kept_id ON TRUE
      LEFT JOIN published_fee_records kept ON kept.fee_published_id = kept_id.id
     WHERE ${fieldWhere}
     ORDER BY c.last_checked_at NULLS FIRST, c.id
     LIMIT ${fieldLimit}
    `);
    const [eligible] = await inSavepoint(db, (scope) => scope<Array<{ n: number | string }>>`SELECT COUNT(*) AS n FROM eval_cases c WHERE ${fieldWhere}`);
    result.fieldEligible = Number(eligible?.n ?? 0);
    result.fieldLimit = fieldLimit;
  } catch (error) {
    // Nothing in the fee-fields pass is judged this run; the step records the warning and goes on.
    result.fieldReadError = error instanceof Error ? error.message : String(error);
    console.warn("[deming] regression fee-fields read failed", result.fieldReadError);
  }
  // Darwin decides audience with the document's newest completed text, and the non-deposit rule
  // reads its opening, so those replays read that text too, once per document.
  const textDocs = [...new Set(fieldDue
    .filter((row) => row.check_name === BUSINESS_SCHEDULE_CHECK || row.check_name === NON_DEPOSIT_CHECK || row.input.kind === "audience")
    .map((row) => num(row.source_document_id))
    .filter((id): id is number => id != null))];
  const documentTexts = await loadDocumentTexts(db, textDocs);
  const limitGuardRows = fieldDue.filter((row) => row.input.kind === "limit_guard").length;
  const misses: Array<RegressionMiss & { feeLive: boolean; feePublishedId: number | null; takenDownAt: string | Date | null; institutionId: number | null }> = [];
  result.accepted = 0;
  for (const row of fieldDue) {
    const documentText = documentTexts.get(num(row.source_document_id) ?? -1) ?? null;
    const feePublishedId = num(row.fee_published_id);
    const { replay, restored, accepted: acceptance, outcome } = replayFieldCase({
      ...row, document_text: documentText, source_document_id: num(row.source_document_id), fee_published_id: feePublishedId,
    }, accepted);
    result.replayed += 1;
    if (replay == null) result.notJudged += 1;
    if (replay?.caught) result.caught += 1;
    if (outcome.status === "active" && row.status !== "active") result.activated += 1;
    if (outcome.status === "retired") result.retired += 1;
    if (acceptance) result.accepted += 1;
    // A live same-line copy the replay catches (its kept line is on the catalog) is back beside it.
    const ruleVerdict = outcome.regression && row.check_name === SAME_LINE_DUPLICATE_CHECK && replay?.caught ? "live_beside_kept_line" : replay?.verdict ?? null;
    if (outcome.regression) {
      misses.push({ caseId: Number(row.id), checkName: row.check_name, severity: row.severity, verdict: ruleVerdict ?? "unknown", feeLive: row.fee_live, feePublishedId, takenDownAt: row.taken_down_at, institutionId: num(row.institution_id) });
    }
    updates.push({ id: Number(row.id), status: outcome.status, caught: replay?.caught ?? null, verdict: acceptance ?? (restored ? "fee_restored" : ruleVerdict) });
  }
  // Tag each live regression with the check whose restore, after its takedown, put its fee back.
  const liveFees = misses.flatMap((miss) => miss.feeLive && miss.feePublishedId != null && miss.institutionId != null
    ? [{ feeId: miss.feePublishedId, institutionId: miss.institutionId }] : []);
  const markers = liveFees.length > 0 ? await restoreMarkers(db, liveFees).catch(() => new Map<number, RestoreMarker[]>()) : new Map<number, RestoreMarker[]>();
  for (const { feeLive, feePublishedId, takenDownAt, institutionId: _institutionId, ...miss } of misses) {
    result.regressions.push(feeLive ? { ...miss, restoredBy: restorerAfter(markers.get(feePublishedId ?? -1) ?? [], takenDownAt) } : miss);
  }
  if (!dryRun && updates.length > 0) {
    await db`
      UPDATE eval_cases c
         SET status = u.status,
             -- A case nothing judged (no stored text) keeps its last verdict.
             last_caught = CASE WHEN u.caught IS NULL AND u.verdict IS NULL THEN c.last_caught ELSE u.caught END,
             last_verdict = COALESCE(u.verdict, c.last_verdict),
             last_checked_at = NOW(),
             last_run_id = ${runId},
             updated_at = NOW()
        FROM jsonb_to_recordset(${JSON.stringify(updates)}::jsonb) AS u(id bigint, status text, caught boolean, verdict text)
       WHERE c.id = u.id
    `;
  }

  result.corrective = await runCorrectiveSource({ db, runId, dryRun, promoteLimit, replayLimit: Math.max(0, replayLimit - limitGuardRows) });
  result.promoted += result.corrective.promoted;
  result.promotedBySeverity.major += result.corrective.promoted;
  result.regressions.push(...result.corrective.regressionCases.map((miss) => ({ ...miss, checkName: CORRECTIVE_CHECK, severity: "major" as const })));
  result.replayed += result.corrective.evaluated;
  result.caught += result.corrective.caught;
  result.activated += result.corrective.activated;

  const [totals] = await db<Array<{ active: number | string; candidate: number | string }>>`
    SELECT COUNT(*) FILTER (WHERE status = 'active') AS active,
           COUNT(*) FILTER (WHERE status = 'candidate') AS candidate
      FROM eval_cases
  `;
  result.activeTotal = Number(totals?.active ?? 0);
  result.candidateTotal = Number(totals?.candidate ?? 0);

  // 4. The committed CI fixture against today's active cases it could hold.
  try {
    const active = await inSavepoint(db, (scope) => scope<Array<{ case_key: string; check_name: string | null; input: CaseInput; dataset: string; label_provenance: string }>>`
      SELECT case_key, check_name, jsonb_build_object('kind', input->>'kind') AS input, dataset, label_provenance
        FROM eval_cases
       WHERE status = 'active' AND last_caught IS TRUE
         AND input->>'kind' IN ('limit_guard', 'category_guard', 'unreplayable')
    `);
    result.fixture = fixtureDrift(FIXTURE_CASE_KEYS, active.filter((row) => isFixtureCase(row)).map((row) => row.case_key));
  } catch (error) {
    console.warn("[deming] regression fixture drift read failed", error instanceof Error ? error.message : error);
    result.fixture = null;
  }
  return result;
}

/**
 * The step's ledger notes (#2064): a failed fee-fields read, and a fee-fields backlog over twice
 * what one run replays, each as one `step.warning` event on the step.
 */
export async function recordRegressionNotes(db: SqlTag, runId: number, stepId: number | null, result: DemingRegressionResult): Promise<void> {
  if (result.fieldReadError) {
    await recordStepWarning(db, { runId, stepId, check: "deming.regression.field_read", what: "Deming's fee-fields regression read", outcome: "read failed, none of those cases judged", error: result.fieldReadError });
  }
  if (fieldBacklog(result)) {
    await recordStepWarning(db, {
      runId, stepId, check: "deming.regression.field_backlog", what: "Deming's fee-fields regression replay", outcome: "fell behind",
      error: `${result.fieldEligible} cases due, over twice the ${result.fieldLimit ?? FIELD_REPLAY_LIMIT} replayed per run`,
    });
  }
}

/** True when more fee-fields cases are due than two runs replay (the step records a note). */
export function fieldBacklog(result: Pick<DemingRegressionResult, "fieldEligible" | "fieldLimit">): boolean {
  return result.fieldEligible != null && result.fieldEligible > 2 * (result.fieldLimit ?? FIELD_REPLAY_LIMIT);
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
  const corrective = result.corrective ? ` Corrective source context: ${result.corrective.evaluated} evaluated, ${result.corrective.caught} matched, ${result.corrective.regressions} semantic regressions; unavailable ${result.corrective.unavailable.count == null ? "unknown" : `${result.corrective.unavailable.atLeast ? "at least " : ""}${result.corrective.unavailable.count}`}. Historical all-dataset totals are not a trusted source denominator. CI fixture import remains unimplemented.` : "";
  const failed = result.corrective?.warnings ?? [];
  const warned = failed.length === 0 ? "" : ` Corrective source could not finish: ${failed.map((w) => `${w.phase.replaceAll("_", " ")}${w.timedOut ? " (statement timeout)" : ""}`).join(", ")}; those rows are unknown, not verdicts.`;
  const history = result.corrective ? `${result.activeTotal} active history, ${result.candidateTotal} candidate history.` : `${result.activeTotal} active, ${result.candidateTotal} waiting for a replayer.`;
  const accepted = result.accepted ? ` Retired ${result.accepted} case${result.accepted === 1 ? "" : "s"} a reviewed check version accepts.` : "";
  const fieldRead = result.fieldReadError ? ` The fee-fields read failed, so none of those cases was judged this run: ${result.fieldReadError}.` : "";
  const perRun = result.fieldLimit ?? FIELD_REPLAY_LIMIT;
  const backlog = fieldBacklog(result)
    ? ` ${result.fieldEligible} fee-fields cases are due, over twice the ${perRun} replayed per run: each waits longer than two runs.`
    : "";
  const fixture = result.fixture && (result.fixture.missing > 0 || result.fixture.stale > 0)
    ? ` CI fixture behind: ${result.fixture.missing} active case${result.fixture.missing === 1 ? "" : "s"} not in it, ${result.fixture.stale} of its cases no longer active.`
    : "";
  return `${added}Replayed ${result.replayed} cases on the deployed rules: ${result.caught} still caught, ${regressions}. ${history}${accepted}${fieldRead}${backlog}${fixture}${corrective}${warned}`;
}
