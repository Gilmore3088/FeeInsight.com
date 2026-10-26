/**
 * The one-off paid gate replay batch (#1077): real questions written up by Hamilton's paid paths
 * (the written answer, the memo, the Simulate read and a report's answer page) so the one output
 * gate's shadow verdicts on paid text can be read in volume, not five a day. The first batch,
 * "2026-10-25" (about 200 samples, about $35, James's approval of 2026-10-25), ended at $39.47 of
 * $40. This is the second batch, "2026-10-26" (James's approval of 2026-10-26): 50 written answers
 * and $25, to measure the written answer's hold rate after the gate fixes #2696, #2699, #2700 and
 * #2701, which the first batch's numbers predate.
 *
 * One batch at a time: every sample belongs to `PAID_REPLAY_BATCH_ID`, and every read of the ledger
 * (reservations, usage by subject prefix, finished steps, shadows by sample key, the active run) is
 * scoped to it, so nothing of an earlier batch counts toward this one's caps. The batch stops for
 * good at `PAID_REPLAY_MAX_SAMPLES` samples or `PAID_REPLAY_MAX_COST_MICROUSD` estimated spend,
 * whichever comes first, or once its plan has no question left. Its mix is
 * `PAID_REPLAY_MIX` (50 written answers; memos, Simulate reads and report pages 0), taken in
 * proportion; a path with a share of 0 never reserves a sample and never holds completion back.
 *
 * Questions: the gate replay's plan (`planGateReplay`): every Pro reader question on record first,
 * then the quality bar's questions over a seeded spread of institutions, seeded by the batch id so
 * every run reads the same plan. Each sample is answered by the free engine first; only an answer
 * the path can write up (research for all, a storyline for a memo, a full peer band for Simulate, a
 * report the Reports screen would write) is reserved and paid for. The paid calls are the daily
 * eval's own (`writeUp`, `simulateUp`, `writtenUp`, `reportUp` in paid-answer-eval.ts), tagged with
 * this batch's operations and shadow origin `replay_paid`, so its shadows are never counted as a
 * reader's, the daily eval's or the free replay's.
 *
 * Capped like the daily eval: a provider step (`hamilton-paid-gate-replay`, in
 * `PROVIDER_STEP_KEYS`), so the global provider stop holds it. Its calls are budgeted and recorded
 * as agent `hamilton_replay` with no route (`PAID_REPLAY_LEDGER`), so each passes the global line
 * and the batch's own `agent:hamilton_replay` line, never the live readers' route lines. Each sample is reserved before its first model call
 * by one `paid_replay.sample_reserved` run event, written by a conditional insert under the batch's
 * advisory lock, outside the step's transaction: it refuses a sample key already reserved, a path
 * at its share, a sample past `PAID_REPLAY_MAX_SAMPLES`, a ninth sample in flight across every run,
 * and a sample whose worst-case ceiling would take the batch's charge past the $25 cap. The charge (`batchCharge`) counts a
 * sample at its recorded cost (`ai_api_usage_events.estimated_cost_microusd`) only when it is
 * finished and every usage row completed with a cost; any other sample (running, killed, a failed
 * or aborted call with unknown usage, a lost usage row) counts its full ceiling. A blocked call, a
 * lost usage row or a killed function still leaves the reservation, so retried or concurrent runs
 * never pass either cap.
 * Server only.
 */

import { sql } from "@/lib/data-store/connection";
import { getHamiltonModel } from "@/lib/ai-provider";
import { estimateAnthropicCostMicrousd, ledgerFields, type ProviderLedger } from "@/lib/ai-provider-usage";
import type { SqlTag } from "@/lib/agents/hamilton/studies/common";
import {
  liveCatalogReader, liveFilingReader, type FilingReader, type LiveReader,
} from "./answer-correctness";
import { answer as engineAnswer, pickEvalInstitutions, pickProQuestions, type Answered, type EvalInstitution, type ProQuestion } from "./answer-eval";
import { planGateReplay, type ReplayItem } from "./gate-replay";
import type { MemoClient } from "./memo";
import type { GateFailureCode, GateSurface } from "./output-gate";
import { tallyGateShadow, type GateShadowRecord } from "./output-gate-shadow";
import {
  PAID_PATHS, reportUp, simulateInputFor, simulateUp, summarizePaid, writeUp, writtenUp,
  type PaidPath, type PaidPathSummary, type PaidSampleResult, type SampleTag, type ShadowRecorder,
} from "./paid-answer-eval";
import { liveReportComparison, prepareReportAnswer, writeReportAnswer, type ComparisonReader, type PreparedReportAnswer, type ReportAnswerWriter } from "./report-answer-read";
import type { SimulateInput } from "./simulate-read";
import { writeWrittenAnswer, type WrittenAnswerWriter } from "./written-answer-read";
import type { FeeResearch } from "./workspace/types";

/**
 * The batch James approved (James's approval of 2026-10-26; the first batch, "2026-10-25", is over).
 * A new batch needs a new id and his yes.
 */
export const PAID_REPLAY_BATCH_ID = "2026-10-26";
/**
 * Nothing of the batch is older than this; bounds the spend and shadow reads. The first batch ran
 * into 2026-10-26, so this bound alone does not keep it out: every read is also scoped by batch id
 * (reservations and finished steps by `batch_id`/`batchId`, usage by `PAID_REPLAY_SUBJECT_PREFIX`
 * or a run that reserved in this batch, shadows by that prefix).
 */
export const PAID_REPLAY_BATCH_START = "2026-10-26T00:00:00.000Z";
/** The run source every batch run carries. */
export const PAID_REPLAY_SOURCE = "hamilton.paid_gate_replay";
/** The batch's step: a provider step (PROVIDER_STEP_KEYS). */
export const PAID_REPLAY_STEP_KEY = "hamilton-paid-gate-replay";
/** The run event that reserves one sample; both caps count these. */
export const PAID_REPLAY_RESERVATION = "paid_replay.sample_reserved";
/** The run event that marks a reserved sample's calls finished; a finished sample is charged its recorded cost only when every usage row is clean. */
export const PAID_REPLAY_DONE = "paid_replay.sample_done";
/** Samples in the whole batch, at most. */
export const PAID_REPLAY_MAX_SAMPLES = 50;
/** Estimated spend of the whole batch, at most: $25. */
export const PAID_REPLAY_MAX_COST_MICROUSD = 25_000_000;
/** Samples reserved and not finished, across every run of the batch, at most. */
export const PAID_REPLAY_MAX_IN_FLIGHT = 8;
/** Each path's share of the batch; a path at 0 never reserves a sample. The shares add up to PAID_REPLAY_MAX_SAMPLES. */
export const PAID_REPLAY_MIX: Record<PaidPath, number> = { written_answer: 50, memo: 0, simulate: 0, report: 0 };
/**
 * The worst case of one sample's calls, from each path's own limits (review of 938daa70a): output at
 * every call's `max_tokens` (thinking counts toward it) and an input estimate per call, priced at the
 * cache-write rate (1.25x input), the dearest way an input token is billed (review of 99a45081b).
 * - written answer: the Pro agent's 4 steps x 16,000 output tokens (research/agents.ts), 80,000 input a step
 *   (the briefing plus tool results, which grow the context each step);
 * - memo: 2 attempts x 4,000 (memo.ts MAX_ATTEMPTS, MAX_TOKENS), 20,000 input each;
 * - Simulate read: 1 call x 4,000 (SIMULATE_MAX_TOKENS), 10,000 input;
 * - report page: the draft and its figure-check redraft, 2 x 8,000 (generate.ts), 30,000 input each.
 */
export const PAID_REPLAY_WORST_CASE: Record<PaidPath, { calls: number; inputTokens: number; outputTokens: number }> = {
  written_answer: { calls: 4, inputTokens: 80_000, outputTokens: 16_000 },
  memo: { calls: 2, inputTokens: 20_000, outputTokens: 4_000 },
  simulate: { calls: 1, inputTokens: 10_000, outputTokens: 4_000 },
  report: { calls: 2, inputTokens: 30_000, outputTokens: 8_000 },
};
/**
 * The ceiling floor of one sample: its worst case at the Hamilton model's list price ($4 in, written to
 * the cache at $5, and $20 out per million tokens). Priced again at run time for the model actually configured, whichever is higher.
 */
export const PAID_REPLAY_CEILING_MICROUSD: Record<PaidPath, number> = { written_answer: 2_880_000, memo: 360_000, simulate: 130_000, report: 620_000 };
/** Each path's provider-usage operation, apart from the daily eval's. */
export const PAID_REPLAY_OPERATIONS: Record<PaidPath, string> = {
  memo: "storyline_memo_replay", simulate: "simulate_fee_change_replay", written_answer: "written_answer_replay", report: "report_answer_replay",
};
/**
 * Who every batch call is budgeted and recorded as: agent `hamilton_replay`, no route. Its calls
 * check only `global:provider:default` and `agent:hamilton_replay` (migration
 * 20270110000078_hamilton_replay_budget.sql, raised for batch 2026-10-26 by
 * 20270110000081_hamilton_replay_budget_1026.sql), never the live readers' route lines or
 * `agent:hamilton`, so the batch neither stalls on their $5 days nor uses them up.
 */
export const PAID_REPLAY_LEDGER: ProviderLedger = { agent: "hamilton_replay" };
/** Every batch sample's subject key starts with this. */
export const PAID_REPLAY_SUBJECT_PREFIX = `hamilton-replay-paid:${PAID_REPLAY_BATCH_ID}:`;
/** A reservation with no done mark after this long was killed; it no longer counts in flight, but keeps its full ceiling. */
const IN_FLIGHT_MINUTES = 15;
/** Institutions per charter and asset tier in the plan, as the free replay. */
const PER_GROUP = 2;
/** Questions in the plan, at most. */
const PLAN_CAP = 400;
/** Samples written at once by one run; the batch-wide in-flight cap holds above it. */
const CONCURRENCY = 6;
/** No sample starts after this point of the run, so its calls (a written answer stops at 180 s) fit the 300 s function. */
const START_WINDOW_MS = 100_000;
/** Free-read errors on one path in one run before that path is left for the next run. */
const MAX_PATH_ERRORS = 3;
/** Free-read errors in one run before it stops starting samples. */
const MAX_ENGINE_ERRORS = 8;
/** Runs a question may fail its free reads in before it is passed over for good. */
const MAX_ERROR_RUNS = 3;
/** A report's reads may take this long before the try counts as an error. */
const REPORT_PREP_MS = 60_000;

export interface PaidReplayReservation {
  path: PaidPath;
  sampleKey: string;
  createdAt: string;
  done: boolean;
}

/** The batch as the ledger holds it. */
export interface PaidReplayState {
  reservations: PaidReplayReservation[];
  /** Path-and-question keys earlier runs passed over (nothing to write up), from their steps' detail. */
  settled: Set<string>;
  /** Path-and-question keys whose free reads failed, with how many earlier runs they failed in. */
  errored: Map<string, number>;
  /** Path-and-question keys an earlier run read but could not start before its window closed; they go last, and never count as failures. */
  deferred: Set<string>;
  /** True once a finished batch step said so. */
  complete: boolean;
}

/** One subject's usage rows: their recorded cost, how many there are, and how many are clean (completed, with a cost). */
export interface SubjectUsage {
  microusd: number;
  rows: number;
  clean: number;
}

/** The batch's usage as recorded: in all, and per subject key (one per sample; `run:<id>` for rows with none). */
export interface PaidReplaySpend {
  total: number;
  bySubject: Map<string, SubjectUsage>;
}

export type ReserveRefusal = "duplicate" | "path_full" | "count_cap" | "spend_cap" | "in_flight";
export type ReserveOutcome = { reserved: true } | { reserved: false; reason: ReserveRefusal };

export function sampleKeyFor(path: PaidPath, item: Pick<ReplayItem, "key">): string {
  return `${path}|${item.key}`;
}

export function subjectKeyFor(sampleKey: string): string {
  return `${PAID_REPLAY_SUBJECT_PREFIX}${sampleKey}`;
}

/** Each path's worst case priced for the models configured now, never below the floor. */
export function baseCeilings(models: { hamilton: string; pro: string } = configuredModels()): Record<PaidPath, number> {
  const out = { ...PAID_REPLAY_CEILING_MICROUSD };
  for (const path of PAID_PATHS) {
    const w = PAID_REPLAY_WORST_CASE[path];
    const priced = estimateAnthropicCostMicrousd(path === "written_answer" ? models.pro : models.hamilton, {
      cacheCreationInputTokens: w.calls * w.inputTokens, outputTokens: w.calls * w.outputTokens,
    });
    if (priced !== null && priced > out[path]) out[path] = priced;
  }
  return out;
}

function configuredModels(): { hamilton: string; pro: string } {
  const hamilton = getHamiltonModel();
  // The Pro agent's model (research/agents.ts): BFI_MODEL_PRO, else Hamilton's.
  return { hamilton, pro: process.env.BFI_MODEL_PRO || hamilton };
}

/** A finished sample whose every usage row is completed and costed: the only kind charged its recorded cost alone. */
function cleanSample(r: PaidReplayReservation, spend: PaidReplaySpend): boolean {
  const usage = spend.bySubject.get(subjectKeyFor(r.sampleKey));
  return r.done && !!usage && usage.rows > 0 && usage.clean === usage.rows;
}

/** Each path's ceiling: its worst case, or its costliest clean sample so far when that is higher. */
export function pathCeilings(state: Pick<PaidReplayState, "reservations">, spend: PaidReplaySpend, base: Record<PaidPath, number> = baseCeilings()): Record<PaidPath, number> {
  const ceilings = { ...base };
  for (const r of state.reservations) {
    const cost = spend.bySubject.get(subjectKeyFor(r.sampleKey))?.microusd ?? 0;
    if (cleanSample(r, spend) && cost > ceilings[r.path]) ceilings[r.path] = cost;
  }
  return ceilings;
}

/**
 * What the batch is charged against the cap (review of 938daa70a): a sample is charged its recorded
 * cost only when it is finished and every one of its usage rows completed with a cost. Any other
 * sample (still running, killed, a failed or aborted call whose usage is unknown, a NULL-cost row, or
 * no usage row at all because the usage insert failed) is charged its full ceiling, or its recorded
 * cost when that is higher. Usage rows on a batch run with no sample's subject key are added as recorded.
 */
export function batchCharge(state: Pick<PaidReplayState, "reservations">, spend: PaidReplaySpend, ceilings: Record<PaidPath, number>): number {
  let total = 0;
  const subjects = new Set<string>();
  for (const r of state.reservations) {
    const subject = subjectKeyFor(r.sampleKey);
    subjects.add(subject);
    const recorded = spend.bySubject.get(subject)?.microusd ?? 0;
    total += cleanSample(r, spend) ? recorded : Math.max(recorded, ceilings[r.path]);
  }
  for (const [subject, usage] of spend.bySubject) if (!subjects.has(subject)) total += usage.microusd;
  return total;
}

/** Reservations not finished and younger than a killed function's: the samples writing now. */
export function inFlight(state: Pick<PaidReplayState, "reservations">, now: Date): PaidReplayReservation[] {
  const cutoff = now.getTime() - IN_FLIGHT_MINUTES * 60_000;
  return state.reservations.filter((r) => !r.done && Date.parse(r.createdAt) >= cutoff);
}

/**
 * Whether one more sample on `path` fits: the decision the reservation makes under the batch's lock.
 * It refuses a key already reserved, a sample past PAID_REPLAY_MAX_SAMPLES, a path at its share (a
 * path whose share is 0 always), a ninth sample in flight across every run, and a sample whose
 * ceiling would take the batch's charge (batchCharge: every unfinished or unclean sample at its full
 * ceiling) past PAID_REPLAY_MAX_COST_MICROUSD.
 */
export function reservationDecision(state: Pick<PaidReplayState, "reservations">, spend: PaidReplaySpend, path: PaidPath, sampleKey: string, now: Date, base?: Record<PaidPath, number>): ReserveOutcome {
  if (state.reservations.some((r) => r.sampleKey === sampleKey)) return { reserved: false, reason: "duplicate" };
  if (state.reservations.length >= PAID_REPLAY_MAX_SAMPLES) return { reserved: false, reason: "count_cap" };
  if (state.reservations.filter((r) => r.path === path).length >= PAID_REPLAY_MIX[path]) return { reserved: false, reason: "path_full" };
  if (inFlight(state, now).length >= PAID_REPLAY_MAX_IN_FLIGHT) return { reserved: false, reason: "in_flight" };
  const ceilings = pathCeilings(state, spend, base);
  if (batchCharge(state, spend, ceilings) + ceilings[path] > PAID_REPLAY_MAX_COST_MICROUSD) return { reserved: false, reason: "spend_cap" };
  return { reserved: true };
}

/** Runs `fn` in a transaction holding the batch's advisory lock; a db with no `begin` (a test double) runs it directly. */
async function underBatchLock<T>(db: SqlTag, fn: (tx: SqlTag) => Promise<T>): Promise<T> {
  const begin = (db as unknown as { begin?: (fn: (tx: SqlTag) => Promise<T>) => Promise<T> }).begin;
  if (typeof begin !== "function") return fn(db);
  return begin.call(db, async (tx: SqlTag) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`hamilton-paid-replay:${PAID_REPLAY_BATCH_ID}`}))`;
    return fn(tx);
  });
}

async function readReservations(db: SqlTag): Promise<PaidReplayReservation[]> {
  const rows = await db`
    SELECT event_type, detail->>'sample_key' AS sample_key, detail->>'path' AS path, created_at
      FROM agent_run_events
     WHERE event_type IN (${PAID_REPLAY_RESERVATION}, ${PAID_REPLAY_DONE})
       AND detail->>'batch_id' = ${PAID_REPLAY_BATCH_ID}
       AND created_at >= ${PAID_REPLAY_BATCH_START}::timestamptz
  ` as unknown as Array<{ event_type: string; sample_key: string | null; path: string | null; created_at: string | Date }>;
  const done = new Set(rows.filter((r) => r.event_type === PAID_REPLAY_DONE && r.sample_key).map((r) => r.sample_key as string));
  return rows
    .filter((r) => r.event_type === PAID_REPLAY_RESERVATION && r.sample_key && (PAID_PATHS as readonly string[]).includes(r.path ?? ""))
    .map((r) => ({
      path: r.path as PaidPath,
      sampleKey: r.sample_key as string,
      createdAt: r.created_at instanceof Date ? r.created_at.toISOString() : String(r.created_at),
      done: done.has(r.sample_key as string),
    }));
}

/** The batch's state in the ledger: its reservations, the questions passed over or failing, and whether it is complete. */
export async function readPaidReplayState(db: SqlTag): Promise<PaidReplayState> {
  const reservations = await readReservations(db);
  const rows = await db`
    SELECT e.detail->'settledKeys' AS keys, e.detail->'erroredKeys' AS errored, e.detail->'deferredKeys' AS deferred, e.detail->>'complete' AS complete
      FROM agent_run_events e
      JOIN agent_runs r ON r.id = e.agent_run_id
     WHERE r.params_json->>'source' = ${PAID_REPLAY_SOURCE}
       AND e.event_type = 'step.finished'
       AND e.detail->>'batchId' = ${PAID_REPLAY_BATCH_ID}
       AND e.created_at >= ${PAID_REPLAY_BATCH_START}::timestamptz
  ` as unknown as Array<{ keys: unknown; errored: unknown; deferred?: unknown; complete: string | null }>;
  const settled = new Set<string>();
  const errored = new Map<string, number>();
  const deferred = new Set<string>();
  let complete = false;
  for (const row of rows) {
    if (row.complete === "true") complete = true;
    if (Array.isArray(row.keys)) for (const key of row.keys) if (typeof key === "string") settled.add(key);
    if (Array.isArray(row.errored)) for (const key of new Set(row.errored)) if (typeof key === "string") errored.set(key, (errored.get(key) ?? 0) + 1);
    if (Array.isArray(row.deferred)) for (const key of row.deferred) if (typeof key === "string") deferred.add(key);
  }
  return { reservations, settled, errored, deferred, complete };
}

/**
 * The batch's usage rows: every row with a batch subject key, or on a run that reserved a batch
 * sample, whatever its status, with how many of each subject's rows are clean (completed with a
 * cost). A failed call with unknown usage records a NULL cost, which counts $0 here; batchCharge,
 * not this sum, is what the cap reads.
 */
export async function readPaidReplaySpend(db: SqlTag): Promise<PaidReplaySpend> {
  const rows = await db`
    SELECT COALESCE(subject_key, 'run:' || agent_run_id::text) AS subject,
           COALESCE(SUM(COALESCE(estimated_cost_microusd, 0)), 0)::bigint AS microusd,
           COUNT(*)::int AS rows,
           COUNT(*) FILTER (WHERE status = 'completed' AND estimated_cost_microusd IS NOT NULL)::int AS clean
      FROM public.ai_api_usage_events
     WHERE created_at >= ${PAID_REPLAY_BATCH_START}::timestamptz
       AND (subject_key LIKE ${`${PAID_REPLAY_SUBJECT_PREFIX}%`}
            OR agent_run_id IN (
              SELECT agent_run_id FROM agent_run_events
               WHERE event_type = ${PAID_REPLAY_RESERVATION}
                 AND detail->>'batch_id' = ${PAID_REPLAY_BATCH_ID}
                 AND created_at >= ${PAID_REPLAY_BATCH_START}::timestamptz))
     GROUP BY 1
  ` as unknown as Array<{ subject: string; microusd: number | string; rows: number | string; clean: number | string }>;
  const bySubject = new Map<string, SubjectUsage>();
  let total = 0;
  for (const row of rows) {
    const microusd = Number(row.microusd ?? 0);
    bySubject.set(row.subject, { microusd, rows: Number(row.rows ?? 0), clean: Number(row.clean ?? 0) });
    total += microusd;
  }
  return { total, bySubject };
}

/**
 * Reserves one sample before any model call, under the batch's lock: the caps are decided on a
 * fresh read of the reservations and the usage, then the insert itself refuses a duplicate key, a
 * full path or a sample past the count cap, so a reservation never passes them even if the read was stale.
 * A refused insert is decided again on a fresh read, so the caller gets the real reason. Its own
 * short transaction, never the step's, so a killed function keeps it.
 */
export async function reservePaidReplaySample(
  db: SqlTag,
  input: { runId: number; path: PaidPath; sampleKey: string; now: Date; base?: Record<PaidPath, number> },
): Promise<ReserveOutcome> {
  return underBatchLock(db, async (tx) => {
    const reservations = await readReservations(tx);
    const spend = await readPaidReplaySpend(tx);
    const decision = reservationDecision({ reservations }, spend, input.path, input.sampleKey, input.now, input.base);
    if (!decision.reserved) return decision;
    const subjectKey = subjectKeyFor(input.sampleKey);
    const rows = await tx`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      SELECT ${input.runId}, NULL, ${PAID_REPLAY_RESERVATION}, 'info',
             ${`Reserved paid replay sample ${subjectKey}.`},
             ${JSON.stringify({ batch_id: PAID_REPLAY_BATCH_ID, sample_key: input.sampleKey, subject_key: subjectKey, path: input.path, recorded_microusd: spend.total })}::jsonb
       WHERE NOT EXISTS (SELECT 1 FROM agent_run_events
                          WHERE event_type = ${PAID_REPLAY_RESERVATION}
                            AND detail->>'batch_id' = ${PAID_REPLAY_BATCH_ID}
                            AND detail->>'sample_key' = ${input.sampleKey})
         AND (SELECT COUNT(*) FROM agent_run_events
               WHERE event_type = ${PAID_REPLAY_RESERVATION}
                 AND detail->>'batch_id' = ${PAID_REPLAY_BATCH_ID}
                 AND detail->>'path' = ${input.path}) < ${PAID_REPLAY_MIX[input.path]}
         AND (SELECT COUNT(*) FROM agent_run_events
               WHERE event_type = ${PAID_REPLAY_RESERVATION}
                 AND detail->>'batch_id' = ${PAID_REPLAY_BATCH_ID}) < ${PAID_REPLAY_MAX_SAMPLES}
      RETURNING id
    `;
    if ((rows as unknown as unknown[]).length > 0) return { reserved: true };
    const again = reservationDecision({ reservations: await readReservations(tx) }, await readPaidReplaySpend(tx), input.path, input.sampleKey, input.now, input.base);
    return again.reserved ? { reserved: false, reason: "duplicate" } : again;
  });
}

/** Marks a reserved sample's calls finished. A lost mark leaves it charged its full ceiling for good. */
async function markSampleDone(db: SqlTag, input: { runId: number; path: PaidPath; sampleKey: string; status: string }): Promise<void> {
  await db`
    INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
    VALUES (${input.runId}, NULL, ${PAID_REPLAY_DONE}, 'info', ${`Paid replay sample ${input.sampleKey}: ${input.status}.`},
            ${JSON.stringify({ batch_id: PAID_REPLAY_BATCH_ID, sample_key: input.sampleKey, path: input.path, status: input.status })}::jsonb)
  `;
}

/** Whether the batch is over: a finished step said complete, or its PAID_REPLAY_MAX_SAMPLES samples are reserved. The route then starts no run. */
export async function paidReplayBatchComplete(db: SqlTag = sql): Promise<boolean> {
  const state = await readPaidReplayState(db);
  return state.complete || state.reservations.length >= PAID_REPLAY_MAX_SAMPLES;
}

/** A running batch run touched within this long is live; an older one was killed and the reaper will re-queue it. */
const ACTIVE_RUN_MINUTES = 6;

/**
 * The batch's queued run, or its live running one, so the route never stacks runs; null when there is
 * none. Only this batch's runs (`params_json.batch_id`): a run of an earlier batch left queued or
 * running is never picked up as this one's (and runPaidGateReplay starts nothing for it anyway).
 */
export async function activePaidReplayRun(db: SqlTag = sql): Promise<{ id: number; status: "queued" | "running" } | null> {
  const rows = await db`
    SELECT id, status
      FROM agent_runs
     WHERE params_json->>'source' = ${PAID_REPLAY_SOURCE}
       AND params_json->>'batch_id' = ${PAID_REPLAY_BATCH_ID}
       AND (status = 'queued'
            OR (status = 'running' AND updated_at >= NOW() - make_interval(mins => ${ACTIVE_RUN_MINUTES})))
     ORDER BY (status = 'running') DESC, id ASC
     LIMIT 1
  ` as unknown as Array<{ id: number | string; status: "queued" | "running" }>;
  return rows[0] ? { id: Number(rows[0].id), status: rows[0].status } : null;
}

/** One surface's shadow counts in the batch. */
export interface PaidReplaySurfaceCounts {
  total: number;
  validated: number;
  ready_partial: number;
  held: number;
  agree: number;
  disagree: number;
  errors: number;
  topCodes: Array<{ code: GateFailureCode; count: number }>;
}

export function countBySurface(records: readonly GateShadowRecord[]): Partial<Record<GateSurface, PaidReplaySurfaceCounts>> {
  const out: Partial<Record<GateSurface, PaidReplaySurfaceCounts>> = {};
  for (const surface of new Set(records.map((r) => r.surface))) {
    const own = records.filter((r) => r.surface === surface);
    const tally = tallyGateShadow(own);
    const codes = new Map<GateFailureCode, number>();
    for (const r of own) if (!r.error) for (const code of new Set(r.codes)) codes.set(code, (codes.get(code) ?? 0) + 1);
    out[surface] = {
      total: tally.total, ...tally.byStatus, agree: tally.agree, disagree: tally.disagree, errors: tally.errors,
      topCodes: [...codes].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)).slice(0, 5),
    };
  }
  return out;
}

export interface PaidReplaySummary {
  batchId: string;
  caps: { samples: number; costMicrousd: number; inFlight: number; mix: Record<PaidPath, number> };
  /** Samples reserved in the whole batch, in all and by path, after this run. */
  reserved: { total: number; byPath: Record<PaidPath, number> };
  /** Reserved before this run. */
  reservedBefore: number;
  /** The batch's usage as recorded after this run, in micro-dollars (a failed call with unknown usage counts $0 here). */
  spentMicrousd: number;
  /** What the cap reads (batchCharge): every unfinished or unclean sample at its full ceiling. */
  chargedMicrousd: number;
  /** This run's samples, scored as the daily eval scores them. */
  paths: PaidPathSummary[];
  results: PaidSampleResult[];
  /** Why this run started no more samples. */
  stopped: string | null;
  /** Paths this run left for the next one (a budget line refused, or their free reads kept failing), with why. */
  blocked: Partial<Record<PaidPath, string>>;
  /** Path-and-question keys this run passed over (nothing to write up), so later runs skip them. */
  settledKeys: string[];
  /** Path-and-question keys whose free reads failed this run; tried again until they fail in MAX_ERROR_RUNS runs. */
  erroredKeys: string[];
  /** Path-and-question keys read this run but not started before the start window closed: tried again last, never passed over for it. */
  deferredKeys: string[];
  /** True once the batch is over for good: no later run starts a sample. */
  complete: boolean;
  /** Why the batch is complete. */
  completeReason: "samples" | "cost" | "plan" | "already" | null;
  /** The batch's shadows so far, every run's together, by surface; null when they could not be read. */
  shadows: { total: number; bySurface: Partial<Record<GateSurface, PaidReplaySurfaceCounts>> } | null;
}

/** A budget line's verdict before a sample is reserved: null when it allows the call, else why not. */
export type PathPreflight = (path: PaidPath, agentRunId: number) => Promise<string | null>;

/** The budget context of a batch call on `path`, as its tracked call books it (ledgerFields over PAID_REPLAY_LEDGER). */
export function replayBudgetContext(path: PaidPath, agentRunId: number) {
  return {
    provider: "anthropic", model: getHamiltonModel(), operation: PAID_REPLAY_OPERATIONS[path], agentRunId,
    // The ledger always applies to a batch call, so the path's own agent and route never do.
    ...ledgerFields(PAID_REPLAY_LEDGER, { agent: PAID_REPLAY_LEDGER.agent, routeId: PAID_REPLAY_LEDGER.routeId ?? "" }),
  };
}

const budgetPreflight: PathPreflight = async (path, agentRunId) => {
  const { assertProviderBudgetAllowed } = await import("@/lib/api-hardening/budget");
  // The same keys the real call checks: the global line and the batch's own agent line, no route.
  const decision = await assertProviderBudgetAllowed(replayBudgetContext(path, agentRunId));
  return decision.allowed ? null : (decision.message ?? decision.reasonCode ?? "blocked by the provider budget");
};

export interface PaidReplayDeps {
  pickProQuestions: (db: SqlTag, limit: number) => Promise<ProQuestion[]>;
  pickInstitutions: (db: SqlTag, perGroup: number, seed: string) => Promise<EvalInstitution[]>;
  /** The free answer; it must throw on a failed read, never hand back an empty answer for one. */
  answer: (institutionId: number, question: string, research: Map<string, Promise<FeeResearch | null>>) => Promise<Answered>;
  /** Null when the Reports screen would write no report; throws on a failed read. */
  prepareReport: (institutionId: number, institutionName: string, now: Date) => Promise<PreparedReportAnswer | null>;
  /** The memo's and Simulate read's client; the default builds them through ai-provider.ts. */
  client?: MemoClient;
  written: WrittenAnswerWriter;
  writeReport: ReportAnswerWriter;
  live: LiveReader;
  filings: FilingReader;
  comparison: ComparisonReader;
  recordShadow: ShadowRecorder;
  /** The batch's shadows so far, for the summary. */
  batchShadows: () => Promise<GateShadowRecord[]>;
  preflight: PathPreflight;
  /** Each path's worst-case ceiling; the default prices the configured models. */
  ceilings: () => Record<PaidPath, number>;
}

const defaultDeps = (): PaidReplayDeps => ({
  pickProQuestions: (db, limit) => pickProQuestions(db, limit),
  pickInstitutions: (db, perGroup, seed) => pickEvalInstitutions(db, perGroup, seed),
  // Strict: a failed fee-research read throws, so the question is kept for a later run (the daily eval's answer is unchanged).
  answer: (institutionId, question, research) => engineAnswer(institutionId, question, research, { strict: true }),
  prepareReport: prepareReportAnswer,
  written: writeWrittenAnswer,
  writeReport: writeReportAnswer,
  live: liveCatalogReader(),
  filings: liveFilingReader(),
  comparison: liveReportComparison,
  recordShadow: async (record, context) => (await import("./output-gate-shadow-store")).recordGateShadow(record, context),
  // Only this batch's samples: an earlier batch's replay_paid shadows after the start carry its own prefix.
  batchShadows: async () => (await import("./output-gate-shadow-store")).gateShadowRecordsSince("replay_paid", PAID_REPLAY_BATCH_START)
    .then((rows) => rows.filter((r) => r.key?.startsWith(PAID_REPLAY_SUBJECT_PREFIX)).map((r) => r.record)),
  preflight: budgetPreflight,
  ceilings: () => baseCeilings(),
});

/** Each path walks the plan from its own offset, so the paths write up different questions first. */
const PATH_OFFSET: Record<PaidPath, number> = { written_answer: 0, memo: 0.25, simulate: 0.5, report: 0.75 };

function byPathCounts(reservations: readonly PaidReplayReservation[]): Record<PaidPath, number> {
  const counts = { memo: 0, simulate: 0, written_answer: 0, report: 0 } as Record<PaidPath, number>;
  for (const r of reservations) counts[r.path] += 1;
  return counts;
}

type Prepared = {
  candidate: { institutionId: number; question: string; from: string };
  answered: Answered & { research: FeeResearch };
  simulate?: SimulateInput;
  report?: PreparedReportAnswer;
};

/**
 * One run of the batch: reads the ledger, stops at once when the batch is over, else writes up
 * samples six at a time, the path furthest behind its share first, until the start window closes,
 * a cap refuses, or the plan runs out.
 */
export async function runPaidGateReplay({
  db = sql,
  now = () => new Date(),
  agentRunId,
  runBatchId,
  startWindowMs = START_WINDOW_MS,
  deps: overrides = {},
}: {
  db?: SqlTag;
  now?: () => Date;
  agentRunId: number;
  /** The batch the run was started for (`params_json.batch_id`); a run of another batch starts nothing. */
  runBatchId?: unknown;
  startWindowMs?: number;
  deps?: Partial<PaidReplayDeps>;
}): Promise<PaidReplaySummary> {
  const deps = { ...defaultDeps(), ...overrides };
  const started = Date.now();
  const base = deps.ceilings();
  const before = await readPaidReplayState(db);
  const blocked: Partial<Record<PaidPath, string>> = {};
  const settledKeys: string[] = [];
  const erroredKeys: string[] = [];
  const deferredKeys: string[] = [];
  const results: PaidSampleResult[] = [];
  let stopped: string | null = null;

  const summarize = async (complete: boolean, completeReason: PaidReplaySummary["completeReason"]): Promise<PaidReplaySummary> => {
    const after = await readPaidReplayState(db);
    const spend = await readPaidReplaySpend(db);
    const shadows = await deps.batchShadows()
      .then((records) => ({ total: records.length, bySurface: countBySurface(records) }))
      .catch((error) => {
        console.error("[hamilton] the paid replay batch's shadows could not be read", error);
        return null;
      });
    return {
      batchId: PAID_REPLAY_BATCH_ID,
      caps: { samples: PAID_REPLAY_MAX_SAMPLES, costMicrousd: PAID_REPLAY_MAX_COST_MICROUSD, inFlight: PAID_REPLAY_MAX_IN_FLIGHT, mix: PAID_REPLAY_MIX },
      reserved: { total: after.reservations.length, byPath: byPathCounts(after.reservations) },
      reservedBefore: before.reservations.length,
      spentMicrousd: spend.total,
      chargedMicrousd: batchCharge(after, spend, pathCeilings(after, spend, base)),
      paths: PAID_PATHS.map((p) => summarizePaid(results.filter((r) => r.path === p), p)),
      results,
      stopped,
      blocked,
      settledKeys,
      erroredKeys,
      deferredKeys,
      complete,
      completeReason,
      shadows,
    };
  };

  // A run started for an earlier batch (left queued or re-queued after that batch ended) never writes this batch's samples.
  if (runBatchId !== undefined && runBatchId !== PAID_REPLAY_BATCH_ID) {
    stopped = `This run belongs to batch ${String(runBatchId)}, not ${PAID_REPLAY_BATCH_ID}; nothing was started.`;
    return summarize(false, null);
  }

  if (before.complete || before.reservations.length >= PAID_REPLAY_MAX_SAMPLES) {
    stopped = "The batch is complete; nothing was started.";
    return summarize(true, "already");
  }

  // These reads fail the run rather than fall back to empty: an empty plan would mark the batch complete.
  const pro = await deps.pickProQuestions(db, PLAN_CAP);
  const institutions = await deps.pickInstitutions(db, PER_GROUP, PAID_REPLAY_BATCH_ID);
  const plan = planGateReplay(PAID_REPLAY_BATCH_ID, pro, institutions, PLAN_CAP);

  // A question whose free reads failed in MAX_ERROR_RUNS runs is passed over for good; one that failed fewer goes last.
  const gaveUp = [...before.errored].filter(([, runs]) => runs >= MAX_ERROR_RUNS).map(([key]) => key);
  const taken = new Set([...before.reservations.map((r) => r.sampleKey), ...before.settled, ...gaveUp]);
  const queues = Object.fromEntries(PAID_PATHS.map((path) => {
    const start = Math.floor(plan.length * PATH_OFFSET[path]);
    const ordered = [...plan.slice(start), ...plan.slice(0, start)].filter((item) => !taken.has(sampleKeyFor(path, item)));
    // Questions that failed, or were left at a window's close, go last so a run never re-reads the same ones first.
    const failedBefore = (item: ReplayItem) => before.errored.has(sampleKeyFor(path, item)) || before.deferred.has(sampleKeyFor(path, item));
    return [path, [...ordered.filter((i) => !failedBefore(i)), ...ordered.filter(failedBefore)]];
  })) as Record<PaidPath, ReplayItem[]>;
  const counts = byPathCounts(before.reservations);
  const full = new Set<PaidPath>(PAID_PATHS.filter((p) => counts[p] >= PAID_REPLAY_MIX[p]));
  // Paths whose next sample's ceiling would pass the spend cap this run; a cheaper path may still fit.
  const overCost = new Set<PaidPath>();
  let countCapped = false;
  let inFlightCapped = false;
  const research = new Map<number, Map<string, Promise<FeeResearch | null>>>();

  /** The path furthest behind its share that can still take a sample this run. */
  const nextPath = (): PaidPath | null => {
    const open = PAID_PATHS.filter((p) => !full.has(p) && !overCost.has(p) && !blocked[p] && queues[p].length > 0);
    if (open.length === 0) return null;
    return [...open].sort((a, b) => counts[a] / PAID_REPLAY_MIX[a] - counts[b] / PAID_REPLAY_MIX[b] || PAID_PATHS.indexOf(a) - PAID_PATHS.indexOf(b))[0];
  };

  /** Free reads that threw (or a report's reads that timed out) this run, in all and by path. */
  let engineErrors = 0;
  const pathErrors = { memo: 0, simulate: 0, written_answer: 0, report: 0 } as Record<PaidPath, number>;
  const prepare = async (path: PaidPath, item: ReplayItem): Promise<Prepared | null | "error" | "deferred"> => {
    if (!research.has(item.institutionId)) research.set(item.institutionId, new Map());
    // A free read still running when the start window closes is left for a later run: it could not start a
    // sample in this one, and the question is not at fault, so it is deferred, never counted as a failure.
    let answered: Answered;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      const left = Math.max(1, startWindowMs - (Date.now() - started));
      const read = await Promise.race([
        deps.answer(item.institutionId, item.question, research.get(item.institutionId)!),
        new Promise<"slow">((resolve) => { timer = setTimeout(() => resolve("slow"), left); }),
      ]);
      if (read === "slow") return "deferred";
      answered = read;
    } catch {
      return "error";
    } finally {
      clearTimeout(timer);
    }
    if (!answered?.research) return null;
    const withResearch = answered as Answered & { research: FeeResearch };
    const candidate = { institutionId: item.institutionId, question: item.question, from: item.from };
    if (path === "memo") return withResearch.response.answer?.storyline ? { candidate, answered: withResearch } : null;
    if (path === "simulate") {
      const input = simulateInputFor(withResearch.research);
      return input ? { candidate, answered: withResearch, simulate: input } : null;
    }
    if (path === "report") {
      // A failed or slow read is an error, kept for a later run; only a clean "no report" passes the question over.
      let timer: ReturnType<typeof setTimeout> | undefined;
      const report = await Promise.race([
        deps.prepareReport(item.institutionId, withResearch.research.institutionName, now()).catch(() => "error" as const),
        new Promise<"error">((resolve) => { timer = setTimeout(() => resolve("error"), REPORT_PREP_MS); }),
      ]).finally(() => clearTimeout(timer));
      if (report === "error") return "error";
      return report ? { candidate, answered: withResearch, report } : null;
    }
    return { candidate, answered: withResearch };
  };

  const write = (path: PaidPath, prepared: Prepared, sampleKey: string): Promise<PaidSampleResult> => {
    const subjectKey = subjectKeyFor(sampleKey);
    const tag: SampleTag = { origin: "replay_paid", operation: PAID_REPLAY_OPERATIONS[path], shadowKey: subjectKey, ledger: PAID_REPLAY_LEDGER };
    const { candidate, answered } = prepared;
    const shared = { subjectKey, agentRunId, recordShadow: deps.recordShadow, tag };
    if (path === "simulate" && prepared.simulate) return simulateUp(candidate, answered, prepared.simulate, deps.live, { ...shared, client: deps.client });
    if (path === "written_answer") return writtenUp(candidate, answered, deps.live, { ...shared, written: deps.written, filings: deps.filings });
    if (path === "report" && prepared.report) return reportUp(candidate, prepared.report, { ...shared, writeReport: deps.writeReport, comparison: deps.comparison });
    return writeUp(candidate, answered, deps.live, { ...shared, client: deps.client });
  };

  const windowClosed = () => {
    if (Date.now() - started <= startWindowMs) return false;
    stopped ??= "Stopped at the start window; the next run continues.";
    return true;
  };

  const worker = async () => {
    for (;;) {
      if (countCapped || inFlightCapped || windowClosed()) return;
      const path = nextPath();
      if (!path) return;
      const item = queues[path].shift()!;
      const sampleKey = sampleKeyFor(path, item);
      const prepared = await prepare(path, item);
      if (prepared === "deferred") {
        deferredKeys.push(sampleKey);
        continue;
      }
      if (prepared === "error") {
        // A database or engine fault must not pass the question over and end the batch early.
        erroredKeys.push(sampleKey);
        engineErrors += 1;
        if (++pathErrors[path] >= MAX_PATH_ERRORS) blocked[path] ??= `${pathErrors[path]} free reads failed this run`;
        if (engineErrors >= MAX_ENGINE_ERRORS) {
          stopped ??= `Stopped after ${engineErrors} free-read errors; the next run tries again.`;
          return;
        }
        continue;
      }
      if (!prepared) {
        settledKeys.push(sampleKey);
        continue;
      }
      // A spent budget line refuses before the reservation, so it never uses up the batch's samples.
      const refusal = await deps.preflight(path, agentRunId).catch((error) => `budget check failed: ${error instanceof Error ? error.message : String(error)}`);
      if (refusal) {
        blocked[path] ??= refusal;
        continue;
      }
      // A sample read in full after the window closed is deferred, not dropped: dropped, the next run
      // read the same questions first again and the batch stalled for good (2026-10-26).
      if (windowClosed()) {
        deferredKeys.push(sampleKey);
        return;
      }
      const outcome = await reservePaidReplaySample(db, { runId: agentRunId, path, sampleKey, now: now(), base });
      if (!outcome.reserved) {
        if (outcome.reason === "path_full") full.add(path);
        else if (outcome.reason === "count_cap") countCapped = true;
        else if (outcome.reason === "spend_cap") overCost.add(path);
        else if (outcome.reason === "in_flight") inFlightCapped = true;
        continue;
      }
      counts[path] += 1;
      if (counts[path] >= PAID_REPLAY_MIX[path]) full.add(path);
      const result = await write(path, prepared, sampleKey).catch((error): PaidSampleResult => ({
        ...prepared.candidate, path, status: "unavailable",
        failures: [`error: ${error instanceof Error ? error.message : String(error)}`], correctness: null, figures: 0,
      }));
      results.push(result);
      // Marking done releases nothing by itself: the sample is charged its recorded cost only if every usage row is clean.
      await markSampleDone(db, { runId: agentRunId, path, sampleKey, status: result.status }).catch((error) => {
        console.error("[hamilton] a paid replay sample could not be marked done", error);
      });
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (overCost.size) stopped ??= `The next ${[...overCost].join(", ")} sample's ceiling would take the batch past $${PAID_REPLAY_MAX_COST_MICROUSD / 1e6}.`;
  if (countCapped) stopped ??= `The batch's ${PAID_REPLAY_MAX_SAMPLES} samples are reserved.`;
  if (inFlightCapped) stopped ??= `${PAID_REPLAY_MAX_IN_FLIGHT} samples are already in flight; the next run continues.`;
  if (Object.keys(blocked).length) stopped ??= "A path was left for the next run (a budget line refused, or its free reads failed).";

  // Over for good: every sample reserved, every path at its share, no sample left that fits the
  // spend cap with nothing in flight, or no question left on any unfinished path.
  const after = await readPaidReplayState(db);
  const spend = await readPaidReplaySpend(db);
  const afterCounts = byPathCounts(after.reservations);
  const unfinished = PAID_PATHS.filter((p) => afterCounts[p] < PAID_REPLAY_MIX[p]);
  const ceilings = pathCeilings(after, spend, base);
  const charged = batchCharge(after, spend, ceilings);
  const nothingInFlight = inFlight(after, now()).length === 0;
  const noneFits = unfinished.every((p) => charged + ceilings[p] > PAID_REPLAY_MAX_COST_MICROUSD);
  // The plan is spent only when this run stopped for no other reason, no question failed its reads,
  // and no unfinished path has a question left.
  const planSpent = stopped === null && erroredKeys.length === 0 && deferredKeys.length === 0 && unfinished.every((p) => queues[p].length === 0);
  const completeReason: PaidReplaySummary["completeReason"] =
    after.reservations.length >= PAID_REPLAY_MAX_SAMPLES || unfinished.length === 0 ? "samples"
      : nothingInFlight && noneFits ? "cost"
        : planSpent ? "plan"
          : null;
  return summarize(completeReason !== null, completeReason);
}

const usd = (microusd: number) => `$${(microusd / 1e6).toFixed(2)}`;
const NAMES: Record<PaidPath, string> = { written_answer: "written answers", memo: "memos", simulate: "Simulate reads", report: "report pages" };
const SURFACE_NAMES: Partial<Record<GateSurface, string>> = { written_answer: "written answer", memo: "memo", simulate: "Simulate", report_section: "report section" };

/** The step's summary in the run ledger: spend so far, samples done, and the batch's shadow counts by surface. */
export function paidReplaySummaryLine(s: PaidReplaySummary): string {
  const reserved = PAID_PATHS.filter((p) => s.caps.mix[p]).map((p) => `${s.reserved.byPath[p]}/${s.caps.mix[p]} ${NAMES[p]}`).join(", ");
  const ran = s.paths.filter((p) => p.sampled > 0).map((p) => `${NAMES[p.path]} ${p.passed} of ${p.answers} passed`).join("; ");
  const surfaces = s.shadows
    ? Object.entries(s.shadows.bySurface).map(([surface, c]) =>
      `${SURFACE_NAMES[surface as GateSurface] ?? surface} ${c!.validated}/${c!.ready_partial}/${c!.held} of ${c!.total}, agrees ${c!.agree}, disagrees ${c!.disagree}${c!.topCodes.length ? ` (top: ${c!.topCodes.slice(0, 3).map((t) => `${t.code.replace(/_/g, " ")} ${t.count}`).join(", ")})` : ""}`).join("; ")
    : null;
  const parts = [
    `Paid gate replay batch ${s.batchId}: ${s.reserved.total} of ${s.caps.samples} samples reserved (${reserved}); ${usd(s.chargedMicrousd)} of ${usd(s.caps.costMicrousd)} charged against the cap (${usd(s.spentMicrousd)} recorded; unfinished or unclean samples count their full ceiling).`,
    `This run wrote ${s.results.length} sample${s.results.length === 1 ? "" : "s"}${ran ? ` (${ran})` : ""}${s.settledKeys.length ? `, passed over ${s.settledKeys.length} with nothing to write up` : ""}.`,
    surfaces === null ? "The batch's shadow counts could not be read." : surfaces ? `Shadow gate by surface (validated/partial/held): ${surfaces}.` : "No shadow recorded yet.",
    Object.keys(s.blocked).length ? `Budget refused: ${Object.entries(s.blocked).map(([p, why]) => `${NAMES[p as PaidPath]} (${why})`).join("; ")}.` : "",
    s.complete
      ? `The batch is complete (${s.completeReason === "cost" ? "the spend cap" : s.completeReason === "plan" ? "no question left" : s.completeReason === "already" ? "already" : "every sample"}); no run starts again.`
      : s.stopped ?? "The next run continues.",
  ];
  return parts.filter(Boolean).join(" ");
}
