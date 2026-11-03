import { sql } from "@/lib/data-store/connection";
import { inSavepoint } from "@/lib/agents/savepoint";
import { eligibleReferences, loadReferenceInputs, readReferenceEligibility } from "@/lib/data-store/answer-key-reference-store";
import type { ReferenceKeySnapshot } from "@/lib/data-store/answer-key-eligibility";
import { FIXED_ANSWER_KEY_COHORT } from "@/lib/agents/deming/fixed-cohort";
import { readShadow, reconcileBank, ShadowOutOfTime, type CurrentText, type LiveInput } from "./bank";
import { gradeReconciliation, gradeSummary, type KeyedBank, type ReconcileGrade } from "./grade";
import type { BankReconciliation, SideFee } from "./types";

type SqlTag = typeof sql;

/**
 * The reconciliation batch runner (James, 2026-11-03). Each step takes the batch's next banks, reads
 * each bank's live fees and its current documents, runs today's pipeline on those documents in memory
 * (`readShadow`), reconciles every fee (`reconcileBank`) and records one `deming.reconcile_bank` event
 * per bank. It then grades every bank the batch has done so far and records one
 * `deming.reconcile_grade` event. It writes only run events: no fee row, no hold, no takedown.
 * Rules only: no provider call.
 */

export const RECONCILE_SOURCE = "deming.reconcile";
export const RECONCILE_STEP_KEY = "deming-reconcile";
export const RECONCILE_BANK_EVENT = "deming.reconcile_bank";
export const RECONCILE_GRADE_EVENT = "deming.reconcile_grade";
/** A bank whose read failed: counted as done, so one bad bank never holds the batch open. */
export const RECONCILE_FAILED_EVENT = "deming.reconcile_bank_failed";
export const RECONCILE_VERSION = 1;

/**
 * The pilot (coordinator's plan, Nov 3): the 62 frozen answer-key banks, which hold the 8 banks the
 * daily review scores, so the diff and the rule can be checked against hand-checked keys first.
 * A full run over every bank with live fees is a new batch id and waits for James's yes.
 */
export const RECONCILE_BATCH_ID = "pilot-2026-11-03";
export const RECONCILE_BATCH_INSTITUTIONS: readonly number[] = FIXED_ANSWER_KEY_COHORT.map((row) => row.institutionId);

/** Banks a step reconciles at most, and the time after which it starts no new bank. */
export const RECONCILE_BANKS_PER_STEP = 12;
/** No bank starts, and no document of a bank is read, after this long; a bank cut short is read again next step. */
export const RECONCILE_STOP_AFTER_MS = 60_000;
/** One stored text is read at most this long (characters): a few schedules run to 300k. */
const MAX_TEXT_CHARS = 400_000;
const READ_TIMEOUT_MS = 20_000;

/** Knox's line (`excerpt="..."` in the raw row's conditions), as `growth/market-snapshot.ts` reads it. */
function rowExcerpt(conditions: string | null): string | null {
  const match = conditions?.match(/excerpt="((?:[^"\\]|\\.)*)"/);
  return match ? match[1].replace(/\\"/g, "\"").trim() || null : null;
}

const num = (value: unknown): number | null => (value == null || value === "" || !Number.isFinite(Number(value)) ? null : Number(value));
const AUDIENCES = new Set(["consumer", "business", "both"]);
const audienceOf = (value: unknown): SideFee["audience"] => (typeof value === "string" && AUDIENCES.has(value) ? (value as SideFee["audience"]) : "unknown");

/** Runs `work` under a statement timeout, then puts the step transaction's own timeout back. */
async function withTimeout<T>(db: SqlTag, work: (scope: SqlTag) => Promise<T>): Promise<T> {
  return inSavepoint(db, async (scope) => {
    const [before] = await scope<Array<{ value: string }>>`SELECT current_setting('statement_timeout') AS value`;
    await scope.unsafe(`SET LOCAL statement_timeout = ${READ_TIMEOUT_MS}`);
    // On failure the savepoint rolls back, which restores the setting and keeps the real error.
    const result = await work(scope);
    await scope`SELECT set_config('statement_timeout', ${before?.value ?? "0"}, true)`;
    return result;
  });
}

/** The bank's live dollar fees, each with Knox's line and the stored text of its own document. */
export async function readLiveFees(db: SqlTag, institutionId: number): Promise<LiveInput[]> {
  const rows = await db<Array<{
    fee_published_id: number | string; fee_name: string | null; amount: number | string | null; canonical_fee_key: string | null;
    fee_audience: string | null; source_document_id: number | string | null; conditions: string | null; superseded: boolean | null;
  }>>`
    SELECT c.fee_published_id, c.fee_name, c.amount, c.canonical_fee_key, c.fee_audience, c.source_document_id,
           COALESCE(c.conditions, r.conditions) AS conditions, (d.superseded_by_id IS NOT NULL) AS superseded
      FROM published_fee_catalog c
      LEFT JOIN raw_fee_observations r ON r.fee_raw_id = c.fee_raw_id
      LEFT JOIN source_documents d ON d.id = c.source_document_id
     WHERE c.institution_id = ${institutionId} AND c.amount IS NOT NULL AND c.canonical_fee_key IS NOT NULL
     ORDER BY c.fee_published_id`;
  // Each document's text once, however many fees it carries.
  const documentIds = [...new Set(rows.map((row) => num(row.source_document_id)).filter((id): id is number => id != null))];
  const texts = documentIds.length === 0 ? [] : await db<Array<{ source_document_id: number | string; text: string }>>`
    SELECT DISTINCT ON (source_document_id) source_document_id, left(normalized_text, ${MAX_TEXT_CHARS}) AS text
      FROM agent_source_texts
     WHERE source_document_id = ANY(${documentIds}::bigint[]) AND status = 'completed' AND char_count > 0
     ORDER BY source_document_id, id DESC`;
  const textOf = new Map(texts.map((row) => [Number(row.source_document_id), row.text]));
  return rows.map((row) => ({
    canonicalFeeKey: String(row.canonical_fee_key),
    feeName: row.fee_name ?? "",
    amountCents: Math.round(Number(row.amount) * 100),
    audience: audienceOf(row.fee_audience),
    line: rowExcerpt(row.conditions),
    sourceDocumentId: num(row.source_document_id),
    feePublishedId: num(row.fee_published_id),
    onSupersededCopy: row.superseded === true,
    ownText: textOf.get(num(row.source_document_id) ?? -1) ?? null,
  }));
}

/** The newest stored text of each of the bank's pages that no newer copy supersedes. */
export async function readCurrentTexts(db: SqlTag, institutionId: number): Promise<CurrentText[]> {
  const rows = await db<Array<{ source_document_id: number | string; document_url: string | null; text: string }>>`
    SELECT DISTINCT ON (t.source_document_id) t.source_document_id, d.document_url, left(t.normalized_text, ${MAX_TEXT_CHARS}) AS text
      FROM agent_source_texts t
      JOIN source_documents d ON d.id = t.source_document_id
     WHERE d.institution_id = ${institutionId} AND d.superseded_by_id IS NULL
       AND t.status = 'completed' AND t.char_count > 0
     ORDER BY t.source_document_id, t.id DESC`;
  return rows.map((row) => ({ sourceDocumentId: Number(row.source_document_id), url: row.document_url, text: row.text }));
}

const confirmedFees = (key: ReferenceKeySnapshot) => key.fees
  .filter((fee) => fee.status === "confirmed" && fee.canonicalKey !== "unmapped")
  .map((fee) => ({ canonicalKey: fee.canonicalKey, amount: fee.amount, amountKind: fee.amountKind as KeyedBank["expected"][number]["amountKind"] }));

/** Confirmed keys of the batch's banks, and of the banks eligible today (the daily review's cohort). */
export async function readKeys(db: SqlTag): Promise<{ keyed: KeyedBank[]; eligibleToday: KeyedBank[] }> {
  const [inputs, snapshot] = await Promise.all([loadReferenceInputs(db), readReferenceEligibility(db)]);
  const confirmed = inputs.map((input) => input.key).filter((key) => key.status === "confirmed");
  return {
    keyed: confirmed.map((key) => ({ institutionId: key.institutionId, expected: confirmedFees(key) })),
    eligibleToday: eligibleReferences(snapshot).map(({ input: { key } }) => ({ institutionId: key.institutionId, expected: confirmedFees(key) })),
  };
}

async function doneInstitutions(db: SqlTag, batchId: string): Promise<Set<number>> {
  const rows = await db<Array<{ institution_id: number | string }>>`
    SELECT DISTINCT (detail->>'institutionId')::int AS institution_id
      FROM agent_run_events
     WHERE event_type = ANY(${[RECONCILE_BANK_EVENT, RECONCILE_FAILED_EVENT]}::text[]) AND detail->>'batch' = ${batchId}`;
  return new Set(rows.map((row) => Number(row.institution_id)));
}

async function batchResults(db: SqlTag, batchId: string): Promise<BankReconciliation[]> {
  const rows = await db<Array<{ detail: BankReconciliation & { batch: string } }>>`
    SELECT DISTINCT ON ((detail->>'institutionId')::int) detail
      FROM agent_run_events
     WHERE event_type = ${RECONCILE_BANK_EVENT} AND detail->>'batch' = ${batchId}
     ORDER BY (detail->>'institutionId')::int, id DESC`;
  return rows.map((row) => row.detail);
}

export interface ReconcileStepResult {
  batch: string;
  version: number;
  dryRun: boolean;
  reconciled: number[];
  failed: Array<{ institutionId: number; error: string }>;
  banksLeft: number;
  stoppedForTime: boolean;
  grade: ReconcileGrade | null;
  gradeError: string | null;
  summary: string;
}

/** Pure: the banks a step takes, in batch order, skipping those done. */
export function nextBanks(batch: readonly number[], done: ReadonlySet<number>, limit = RECONCILE_BANKS_PER_STEP): number[] {
  return batch.filter((id) => !done.has(id)).slice(0, limit);
}

export async function runReconcileStep({ db = sql, runId, stepId, dryRun, batchId = RECONCILE_BATCH_ID, batch = RECONCILE_BATCH_INSTITUTIONS, now = Date.now }: {
  db?: SqlTag; runId: number; stepId: number; dryRun: boolean; batchId?: string; batch?: readonly number[]; now?: () => number;
}): Promise<ReconcileStepResult> {
  const started = now();
  const done = await withTimeout(db, (scope) => doneInstitutions(scope, batchId));
  const todo = nextBanks(batch, done);
  const keys = await withTimeout(db, (scope) => readKeys(scope));
  const keyByBank = new Map(keys.keyed.map((bank) => [bank.institutionId, bank.expected]));
  const reconciled: number[] = [];
  const failed: ReconcileStepResult["failed"] = [];
  let stoppedForTime = false;
  const outOfTime = () => now() - started > RECONCILE_STOP_AFTER_MS;
  for (const institutionId of todo) {
    if (outOfTime()) { stoppedForTime = true; break; }
    try {
      const bankStarted = now();
      const [live, current] = await withTimeout(db, async (scope) => [await readLiveFees(scope, institutionId), await readCurrentTexts(scope, institutionId)] as const);
      const shadow = readShadow(current, undefined, outOfTime);
      const result = reconcileBank({ institutionId, live, current, shadow, keys: keyByBank.get(institutionId) ?? null, ms: now() - bankStarted });
      if (!dryRun) {
        await inSavepoint(db, (scope) => scope`
          INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
          VALUES (${runId}, ${stepId}, ${RECONCILE_BANK_EVENT}, 'info',
                  ${`Bank ${institutionId}: ${result.liveFees} live, ${result.shadowFees} shadow, ${result.counts.same} same, ${result.conflicts.length} differences.`},
                  ${JSON.stringify({ batch: batchId, version: RECONCILE_VERSION, ...result })}::jsonb)`);
      }
      reconciled.push(institutionId);
    } catch (error) {
      // A bank cut short is read again next step, unless it was this step's first bank: then it
      // alone outlasts a step and would come first every time, so it is recorded as failed.
      const firstOfStep = reconciled.length === 0 && failed.length === 0;
      if (error instanceof ShadowOutOfTime && !firstOfStep) { stoppedForTime = true; break; }
      const message = error instanceof Error ? error.message.slice(0, 300) : String(error);
      failed.push({ institutionId, error: message });
      if (error instanceof ShadowOutOfTime) stoppedForTime = true;
      // Recorded as done, so the batch moves on and ends; the grade counts it as failed, never as clean.
      if (!dryRun) {
        await inSavepoint(db, (scope) => scope`
          INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
          VALUES (${runId}, ${stepId}, ${RECONCILE_FAILED_EVENT}, 'failed', ${`Bank ${institutionId}: reconcile failed: ${message}`},
                  ${JSON.stringify({ batch: batchId, version: RECONCILE_VERSION, institutionId, error: message })}::jsonb)`)
          .catch((recordError: unknown) => console.error("Reconcile: failed bank could not be recorded", recordError));
      }
      if (error instanceof ShadowOutOfTime) break;
    }
  }
  let grade: ReconcileGrade | null = null;
  let gradeError: string | null = null;
  try {
    const banks = await withTimeout(db, (scope) => batchResults(scope, batchId));
    const inBatch = new Set(batch);
    grade = gradeReconciliation(
      banks,
      keys.keyed.filter((bank) => inBatch.has(bank.institutionId)),
      keys.eligibleToday.filter((bank) => inBatch.has(bank.institutionId)),
    );
    if (!dryRun) {
      await inSavepoint(db, (scope) => scope`
        INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
        VALUES (${runId}, ${stepId}, ${RECONCILE_GRADE_EVENT}, 'info', ${gradeSummary(grade!)},
                ${JSON.stringify({ batch: batchId, version: RECONCILE_VERSION, ...grade, byCause: grade!.byCause.slice(0, 60) })}::jsonb)`);
    }
  } catch (error) {
    gradeError = error instanceof Error ? error.message.slice(0, 300) : String(error);
  }
  const banksLeft = Math.max(0, batch.length - done.size - reconciled.length - failed.length);
  const head = `Reconcile ${batchId}: ${reconciled.length} banks this step${failed.length ? `, ${failed.length} failed` : ""}, ${banksLeft} left${stoppedForTime ? " (stopped for time)" : ""}.`;
  return {
    batch: batchId, version: RECONCILE_VERSION, dryRun, reconciled, failed, banksLeft, stoppedForTime, grade, gradeError,
    summary: `${head} ${grade ? gradeSummary(grade) : `Grade failed: ${gradeError}`}`,
  };
}

/** The step detail: the grade without per-bank rows, so the ledger row stays small. */
export function reconcileDetail(result: ReconcileStepResult): Record<string, unknown> {
  return { ...result, grade: result.grade ? { ...result.grade, byCause: result.grade.byCause.slice(0, 20) } : null };
}

/** Banks of the batch still to do; read by the scheduler. */
export async function reconcileBanksLeft(db: SqlTag = sql, batchId = RECONCILE_BATCH_ID, batch: readonly number[] = RECONCILE_BATCH_INSTITUTIONS): Promise<number> {
  const done = await doneInstitutions(db, batchId);
  return batch.filter((id) => !done.has(id)).length;
}
