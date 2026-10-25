/**
 * The one-off paid gate replay batch (#1077): real questions written up by Hamilton's paid paths
 * (the written answer, the memo, the Simulate read and a report's answer page) so the one output
 * gate's shadow verdicts on paid text can be read in volume, not five a day. James approved one
 * batch of about 200 samples, about $35, on 2026-10-25 (decision card 16:12 UTC; "I approve the
 * update that would run paid models", 17:30 UTC).
 *
 * One batch, never a schedule: every sample belongs to `PAID_REPLAY_BATCH_ID`. The batch stops for
 * good at `PAID_REPLAY_MAX_SAMPLES` samples or `PAID_REPLAY_MAX_COST_MICROUSD` estimated spend,
 * whichever comes first, or once its plan has no question left. Its mix is
 * `PAID_REPLAY_MIX` (100 written answers, 50 memos, 25 Simulate reads, 25 report pages), taken in
 * proportion, so a batch the spend cap stops early still holds every path.
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
 * `PROVIDER_STEP_KEYS`), so the global provider stop and the budget policies hold it, and each
 * call still passes its own path's budget line. Each sample is reserved before its first model call
 * by one `paid_replay.sample_reserved` run event, written by a conditional insert under the batch's
 * advisory lock, outside the step's transaction: it refuses a sample key already reserved, a path
 * at its share, the 200th-plus sample, and a sample whose ceiling estimate would take the spend
 * (`ai_api_usage_events.estimated_cost_microusd` for the batch's subject keys and runs) plus the
 * ceilings of samples still in flight past $40. A blocked call, a lost usage row or a killed
 * function still leaves the reservation, so retried or concurrent runs never pass either cap.
 * Server only.
 */

import { sql } from "@/lib/data-store/connection";
import type { SqlTag } from "@/lib/agents/hamilton/studies/common";
import {
  liveCatalogReader, liveFilingReader, type FilingReader, type LiveReader,
} from "./answer-correctness";
import { answer as engineAnswer, pickEvalInstitutions, pickProQuestions, type Answered, type EvalInstitution, type ProQuestion } from "./answer-eval";
import { planGateReplay, type ReplayItem } from "./gate-replay";
import type { MemoClient } from "./memo";
import type { GateFailureCode, GateStatus, GateSurface } from "./output-gate";
import { tallyGateShadow, type GateShadowRecord } from "./output-gate-shadow";
import {
  PAID_PATHS, reportUp, simulateInputFor, simulateUp, summarizePaid, writeUp, writtenUp,
  type PaidPath, type PaidPathSummary, type PaidSampleResult, type SampleTag, type ShadowRecorder,
} from "./paid-answer-eval";
import { liveReportComparison, prepareReportAnswer, writeReportAnswer, type ComparisonReader, type PreparedReportAnswer, type ReportAnswerWriter } from "./report-answer-read";
import type { SimulateInput } from "./simulate-read";
import { writeWrittenAnswer, type WrittenAnswerWriter } from "./written-answer-read";
import type { FeeResearch } from "./workspace/types";

/** The one batch James approved (2026-10-25). A new batch needs a new id and his yes. */
export const PAID_REPLAY_BATCH_ID = "2026-10-25";
/** Nothing of the batch is older than this; bounds the spend and shadow reads. */
export const PAID_REPLAY_BATCH_START = "2026-10-25T00:00:00.000Z";
/** The run source every batch run carries. */
export const PAID_REPLAY_SOURCE = "hamilton.paid_gate_replay";
/** The batch's step: a provider step (PROVIDER_STEP_KEYS). */
export const PAID_REPLAY_STEP_KEY = "hamilton-paid-gate-replay";
/** The run event that reserves one sample; both caps count these. */
export const PAID_REPLAY_RESERVATION = "paid_replay.sample_reserved";
/** The run event that marks a reserved sample's calls finished, so its ceiling no longer holds spend. */
export const PAID_REPLAY_DONE = "paid_replay.sample_done";
/** Samples in the whole batch, at most. */
export const PAID_REPLAY_MAX_SAMPLES = 200;
/** Estimated spend of the whole batch, at most: $40. */
export const PAID_REPLAY_MAX_COST_MICROUSD = 40_000_000;
/** Each path's share of the batch. */
export const PAID_REPLAY_MIX: Record<PaidPath, number> = { written_answer: 100, memo: 50, simulate: 25, report: 25 };
/**
 * The most one sample is assumed to cost before it starts, from each path's calls at the Hamilton
 * model's price ($4 in, $20 out per million tokens): a written answer up to four tool steps, a memo
 * and a report page up to two calls each, a Simulate read one. A path's costliest sample so far
 * replaces its figure when it is higher.
 */
export const PAID_REPLAY_CEILING_MICROUSD: Record<PaidPath, number> = { written_answer: 900_000, memo: 300_000, simulate: 100_000, report: 500_000 };
/** Each path's provider-usage operation, apart from the daily eval's. */
export const PAID_REPLAY_OPERATIONS: Record<PaidPath, string> = {
  memo: "storyline_memo_replay", simulate: "simulate_fee_change_replay", written_answer: "written_answer_replay", report: "report_answer_replay",
};
/** Each path's budget line, checked before a sample is reserved so a spent line does not use up reservations. */
const PATH_ROUTE: Record<PaidPath, string> = {
  memo: "api.hamilton.ask.memo", simulate: "api.hamilton.simulate", written_answer: "api.research.hamilton", report: "api.reports.generate",
};
/** Every batch sample's subject key starts with this. */
export const PAID_REPLAY_SUBJECT_PREFIX = `hamilton-replay-paid:${PAID_REPLAY_BATCH_ID}:`;
/** A reservation with no done mark after this long was killed: its usage rows, if any, are already written. */
const IN_FLIGHT_MINUTES = 15;
/** Institutions per charter and asset tier in the plan, as the free replay. */
const PER_GROUP = 2;
/** Questions in the plan, at most. */
const PLAN_CAP = 400;
/** Samples written at once. */
const CONCURRENCY = 4;
/** No sample starts after this point of the run, so its calls (a written answer stops at 180 s) fit the 300 s function. */
const START_WINDOW_MS = 100_000;
/** Free-engine errors in one run before it stops starting samples. */
const MAX_ENGINE_ERRORS = 5;
/** A report's reads may take this long before the sample is passed over. */
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
  /** True once a finished batch step said so. */
  complete: boolean;
}

/** The batch's estimated spend: in all, and per subject key (one per sample). */
export interface PaidReplaySpend {
  total: number;
  bySubject: Map<string, number>;
}

export type ReserveOutcome = { reserved: true } | { reserved: false; reason: "duplicate" | "path_full" | "count_cap" | "cost_cap" };

export function sampleKeyFor(path: PaidPath, item: Pick<ReplayItem, "key">): string {
  return `${path}|${item.key}`;
}

export function subjectKeyFor(sampleKey: string): string {
  return `${PAID_REPLAY_SUBJECT_PREFIX}${sampleKey}`;
}

/** Each path's ceiling: its static figure, or its costliest sample so far when that is higher. */
export function pathCeilings(state: Pick<PaidReplayState, "reservations">, spend: PaidReplaySpend): Record<PaidPath, number> {
  const ceilings = { ...PAID_REPLAY_CEILING_MICROUSD };
  for (const r of state.reservations) {
    const cost = spend.bySubject.get(subjectKeyFor(r.sampleKey)) ?? 0;
    if (r.done && cost > ceilings[r.path]) ceilings[r.path] = cost;
  }
  return ceilings;
}

/** Reservations still holding spend: not marked done and younger than a killed function's. */
export function inFlight(state: Pick<PaidReplayState, "reservations">, now: Date): PaidReplayReservation[] {
  const cutoff = now.getTime() - IN_FLIGHT_MINUTES * 60_000;
  return state.reservations.filter((r) => !r.done && Date.parse(r.createdAt) >= cutoff);
}

/**
 * Whether one more sample on `path` fits both caps and its share: the decision the reservation
 * makes under the batch's lock. The spend check holds the ceiling of every sample still in flight,
 * so concurrent runs never start more than the cap can pay for.
 */
export function reservationDecision(state: Pick<PaidReplayState, "reservations">, spend: PaidReplaySpend, path: PaidPath, sampleKey: string, now: Date): ReserveOutcome {
  if (state.reservations.some((r) => r.sampleKey === sampleKey)) return { reserved: false, reason: "duplicate" };
  if (state.reservations.length >= PAID_REPLAY_MAX_SAMPLES) return { reserved: false, reason: "count_cap" };
  if (state.reservations.filter((r) => r.path === path).length >= PAID_REPLAY_MIX[path]) return { reserved: false, reason: "path_full" };
  const ceilings = pathCeilings(state, spend);
  // A sample in flight may already have spent some of its ceiling: hold whichever is larger.
  const held = inFlight(state, now).reduce((sum, r) => sum + Math.max(0, ceilings[r.path] - (spend.bySubject.get(subjectKeyFor(r.sampleKey)) ?? 0)), 0);
  if (spend.total + held + ceilings[path] > PAID_REPLAY_MAX_COST_MICROUSD) return { reserved: false, reason: "cost_cap" };
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

/** The batch's state in the ledger: its reservations, the questions passed over, and whether it is complete. */
export async function readPaidReplayState(db: SqlTag): Promise<PaidReplayState> {
  const reservations = await readReservations(db);
  const rows = await db`
    SELECT e.detail->'settledKeys' AS keys, e.detail->>'complete' AS complete
      FROM agent_run_events e
      JOIN agent_runs r ON r.id = e.agent_run_id
     WHERE r.params_json->>'source' = ${PAID_REPLAY_SOURCE}
       AND e.event_type = 'step.finished'
       AND e.detail->>'batchId' = ${PAID_REPLAY_BATCH_ID}
       AND e.created_at >= ${PAID_REPLAY_BATCH_START}::timestamptz
  ` as unknown as Array<{ keys: unknown; complete: string | null }>;
  const settled = new Set<string>();
  let complete = false;
  for (const row of rows) {
    if (row.complete === "true") complete = true;
    if (Array.isArray(row.keys)) for (const key of row.keys) if (typeof key === "string") settled.add(key);
  }
  return { reservations, settled, complete };
}

/**
 * The batch's estimated spend: every usage row with a batch subject key, or on a run that reserved a
 * batch sample, whatever its status (an estimate on a failed call counts too, so the cap errs high).
 */
export async function readPaidReplaySpend(db: SqlTag): Promise<PaidReplaySpend> {
  const rows = await db`
    SELECT COALESCE(subject_key, 'run:' || agent_run_id::text) AS subject,
           COALESCE(SUM(COALESCE(estimated_cost_microusd, 0)), 0)::bigint AS microusd
      FROM public.ai_api_usage_events
     WHERE created_at >= ${PAID_REPLAY_BATCH_START}::timestamptz
       AND (subject_key LIKE ${`${PAID_REPLAY_SUBJECT_PREFIX}%`}
            OR agent_run_id IN (
              SELECT agent_run_id FROM agent_run_events
               WHERE event_type = ${PAID_REPLAY_RESERVATION}
                 AND detail->>'batch_id' = ${PAID_REPLAY_BATCH_ID}
                 AND created_at >= ${PAID_REPLAY_BATCH_START}::timestamptz))
     GROUP BY 1
  ` as unknown as Array<{ subject: string; microusd: number | string }>;
  const bySubject = new Map<string, number>();
  let total = 0;
  for (const row of rows) {
    const microusd = Number(row.microusd ?? 0);
    bySubject.set(row.subject, microusd);
    total += microusd;
  }
  return { total, bySubject };
}

/**
 * Reserves one sample before any model call, under the batch's lock: the caps are decided on a
 * fresh read of the reservations and the spend, then the insert itself refuses a duplicate key, a
 * full path or the 201st sample, so a reservation never passes them even if the read was stale.
 * Its own short transaction, never the step's, so a killed function keeps it.
 */
export async function reservePaidReplaySample(
  db: SqlTag,
  input: { runId: number; path: PaidPath; sampleKey: string; now: Date },
): Promise<ReserveOutcome> {
  return underBatchLock(db, async (tx) => {
    const reservations = await readReservations(tx);
    const spend = await readPaidReplaySpend(tx);
    const decision = reservationDecision({ reservations }, spend, input.path, input.sampleKey, input.now);
    if (!decision.reserved) return decision;
    const subjectKey = subjectKeyFor(input.sampleKey);
    const rows = await tx`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      SELECT ${input.runId}, NULL, ${PAID_REPLAY_RESERVATION}, 'info',
             ${`Reserved paid replay sample ${subjectKey}.`},
             ${JSON.stringify({ batch_id: PAID_REPLAY_BATCH_ID, sample_key: input.sampleKey, subject_key: subjectKey, path: input.path, spent_microusd: spend.total })}::jsonb
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
    return (rows as unknown as unknown[]).length > 0 ? { reserved: true } : { reserved: false, reason: "duplicate" };
  });
}

/** Marks a reserved sample's calls finished; a lost mark only holds its ceiling until IN_FLIGHT_MINUTES pass. */
async function markSampleDone(db: SqlTag, input: { runId: number; path: PaidPath; sampleKey: string; status: string }): Promise<void> {
  await db`
    INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
    VALUES (${input.runId}, NULL, ${PAID_REPLAY_DONE}, 'info', ${`Paid replay sample ${input.sampleKey}: ${input.status}.`},
            ${JSON.stringify({ batch_id: PAID_REPLAY_BATCH_ID, sample_key: input.sampleKey, path: input.path, status: input.status })}::jsonb)
  `;
}

/** Whether the batch is over: a finished step said complete, or its 200 samples are reserved. The route then starts no run. */
export async function paidReplayBatchComplete(db: SqlTag = sql): Promise<boolean> {
  const state = await readPaidReplayState(db);
  return state.complete || state.reservations.length >= PAID_REPLAY_MAX_SAMPLES;
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
  caps: { samples: number; costMicrousd: number; mix: Record<PaidPath, number> };
  /** Samples reserved in the whole batch, in all and by path, after this run. */
  reserved: { total: number; byPath: Record<PaidPath, number> };
  /** Reserved before this run. */
  reservedBefore: number;
  /** The batch's estimated spend after this run, in micro-dollars. */
  spentMicrousd: number;
  /** This run's samples, scored as the daily eval scores them. */
  paths: PaidPathSummary[];
  results: PaidSampleResult[];
  /** Why this run started no more samples. */
  stopped: string | null;
  /** Paths whose budget line refused this run, with its message. */
  blocked: Partial<Record<PaidPath, string>>;
  /** Path-and-question keys this run passed over (nothing to write up), so later runs skip them. */
  settledKeys: string[];
  /** True once the batch is over for good: no later run starts a sample. */
  complete: boolean;
  /** Why the batch is complete. */
  completeReason: "samples" | "cost" | "plan" | "already" | null;
  /** The batch's shadows so far, every run's together, by surface; null when they could not be read. */
  shadows: { total: number; bySurface: Partial<Record<GateSurface, PaidReplaySurfaceCounts>> } | null;
}

/** A budget line's verdict before a sample is reserved: null when it allows the call, else why not. */
export type PathPreflight = (path: PaidPath, agentRunId: number) => Promise<string | null>;

const budgetPreflight: PathPreflight = async (path, agentRunId) => {
  const { assertProviderBudgetAllowed } = await import("@/lib/api-hardening/budget");
  const decision = await assertProviderBudgetAllowed({
    provider: "anthropic", model: "hamilton", agent: "hamilton", operation: PAID_REPLAY_OPERATIONS[path], routeId: PATH_ROUTE[path], agentRunId,
  });
  return decision.allowed ? null : (decision.message ?? decision.reasonCode ?? "blocked by the provider budget");
};

export interface PaidReplayDeps {
  pickProQuestions: (db: SqlTag, limit: number) => Promise<ProQuestion[]>;
  pickInstitutions: (db: SqlTag, perGroup: number, seed: string) => Promise<EvalInstitution[]>;
  answer: (institutionId: number, question: string, research: Map<string, Promise<FeeResearch | null>>) => Promise<Answered>;
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
}

const defaultDeps = (): PaidReplayDeps => ({
  pickProQuestions: (db, limit) => pickProQuestions(db, limit),
  pickInstitutions: (db, perGroup, seed) => pickEvalInstitutions(db, perGroup, seed),
  answer: engineAnswer,
  prepareReport: prepareReportAnswer,
  written: writeWrittenAnswer,
  writeReport: writeReportAnswer,
  live: liveCatalogReader(),
  filings: liveFilingReader(),
  comparison: liveReportComparison,
  recordShadow: async (record, context) => (await import("./output-gate-shadow-store")).recordGateShadow(record, context),
  batchShadows: async () => (await import("./output-gate-shadow-store")).gateShadowRecordsSince("replay_paid", PAID_REPLAY_BATCH_START).then((rows) => rows.map((r) => r.record)),
  preflight: budgetPreflight,
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
 * samples a few at a time, the path furthest behind its share first, until the start window
 * closes, a cap refuses, or the plan runs out.
 */
export async function runPaidGateReplay({
  db = sql,
  now = () => new Date(),
  agentRunId,
  startWindowMs = START_WINDOW_MS,
  deps: overrides = {},
}: {
  db?: SqlTag;
  now?: () => Date;
  agentRunId: number;
  startWindowMs?: number;
  deps?: Partial<PaidReplayDeps>;
}): Promise<PaidReplaySummary> {
  const deps = { ...defaultDeps(), ...overrides };
  const started = Date.now();
  const before = await readPaidReplayState(db);
  const blocked: Partial<Record<PaidPath, string>> = {};
  const settledKeys: string[] = [];
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
      caps: { samples: PAID_REPLAY_MAX_SAMPLES, costMicrousd: PAID_REPLAY_MAX_COST_MICROUSD, mix: PAID_REPLAY_MIX },
      reserved: { total: after.reservations.length, byPath: byPathCounts(after.reservations) },
      reservedBefore: before.reservations.length,
      spentMicrousd: spend.total,
      paths: PAID_PATHS.map((p) => summarizePaid(results.filter((r) => r.path === p), p)),
      results,
      stopped,
      blocked,
      settledKeys,
      complete,
      completeReason,
      shadows,
    };
  };

  if (before.complete || before.reservations.length >= PAID_REPLAY_MAX_SAMPLES) {
    stopped = "The batch is complete; nothing was started.";
    return summarize(true, "already");
  }

  // These reads fail the run rather than fall back to empty: an empty plan would mark the batch complete.
  const pro = await deps.pickProQuestions(db, PLAN_CAP);
  const institutions = await deps.pickInstitutions(db, PER_GROUP, PAID_REPLAY_BATCH_ID);
  const plan = planGateReplay(PAID_REPLAY_BATCH_ID, pro, institutions, PLAN_CAP);

  const taken = new Set([...before.reservations.map((r) => r.sampleKey), ...before.settled]);
  const queues = Object.fromEntries(PAID_PATHS.map((path) => {
    const start = Math.floor(plan.length * PATH_OFFSET[path]);
    const ordered = [...plan.slice(start), ...plan.slice(0, start)];
    return [path, ordered.filter((item) => !taken.has(sampleKeyFor(path, item)))];
  })) as Record<PaidPath, ReplayItem[]>;
  const counts = byPathCounts(before.reservations);
  const full = new Set<PaidPath>(PAID_PATHS.filter((p) => counts[p] >= PAID_REPLAY_MIX[p]));
  // Paths whose next sample's ceiling would pass the spend cap this run; a cheaper path may still fit.
  const overCost = new Set<PaidPath>();
  let countCapped = false;
  const research = new Map<number, Map<string, Promise<FeeResearch | null>>>();

  /** The path furthest behind its share that can still take a sample this run. */
  const nextPath = (): PaidPath | null => {
    const open = PAID_PATHS.filter((p) => !full.has(p) && !overCost.has(p) && !blocked[p] && queues[p].length > 0);
    if (open.length === 0) return null;
    return [...open].sort((a, b) => counts[a] / PAID_REPLAY_MIX[a] - counts[b] / PAID_REPLAY_MIX[b] || PAID_PATHS.indexOf(a) - PAID_PATHS.indexOf(b))[0];
  };

  /** Free reads that threw this run; a question that threw is kept for a later run, never passed over. */
  let engineErrors = 0;
  const prepare = async (path: PaidPath, item: ReplayItem): Promise<Prepared | null | "error"> => {
    if (!research.has(item.institutionId)) research.set(item.institutionId, new Map());
    let answered: Answered;
    try {
      answered = await deps.answer(item.institutionId, item.question, research.get(item.institutionId)!);
    } catch {
      return "error";
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
      let timer: ReturnType<typeof setTimeout> | undefined;
      const report = await Promise.race([
        deps.prepareReport(item.institutionId, withResearch.research.institutionName, now()).catch(() => null),
        new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), REPORT_PREP_MS); }),
      ]).finally(() => clearTimeout(timer));
      return report ? { candidate, answered: withResearch, report } : null;
    }
    return { candidate, answered: withResearch };
  };

  const write = (path: PaidPath, prepared: Prepared, sampleKey: string): Promise<PaidSampleResult> => {
    const subjectKey = subjectKeyFor(sampleKey);
    const tag: SampleTag = { origin: "replay_paid", operation: PAID_REPLAY_OPERATIONS[path], shadowKey: subjectKey };
    const { candidate, answered } = prepared;
    const base = { subjectKey, agentRunId, recordShadow: deps.recordShadow, tag };
    if (path === "simulate" && prepared.simulate) return simulateUp(candidate, answered, prepared.simulate, deps.live, { ...base, client: deps.client });
    if (path === "written_answer") return writtenUp(candidate, answered, deps.live, { ...base, written: deps.written, filings: deps.filings });
    if (path === "report" && prepared.report) return reportUp(candidate, prepared.report, { ...base, writeReport: deps.writeReport, comparison: deps.comparison });
    return writeUp(candidate, answered, deps.live, { ...base, client: deps.client });
  };

  const worker = async () => {
    for (;;) {
      if (countCapped) return;
      if (Date.now() - started > startWindowMs) {
        stopped ??= "Stopped at the start window; the next run continues.";
        return;
      }
      const path = nextPath();
      if (!path) return;
      const item = queues[path].shift()!;
      const sampleKey = sampleKeyFor(path, item);
      const prepared = await prepare(path, item);
      if (prepared === "error") {
        // A database or engine fault must not pass the plan over and end the batch early.
        if (++engineErrors >= MAX_ENGINE_ERRORS) {
          stopped ??= `Stopped after ${engineErrors} free-engine errors; the next run tries again.`;
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
      if (Date.now() - started > startWindowMs) {
        stopped ??= "Stopped at the start window; the next run continues.";
        return;
      }
      const outcome = await reservePaidReplaySample(db, { runId: agentRunId, path, sampleKey, now: now() });
      if (!outcome.reserved) {
        if (outcome.reason === "path_full") full.add(path);
        else if (outcome.reason === "count_cap") countCapped = true;
        else if (outcome.reason === "cost_cap") overCost.add(path);
        continue;
      }
      counts[path] += 1;
      if (counts[path] >= PAID_REPLAY_MIX[path]) full.add(path);
      const result = await write(path, prepared, sampleKey).catch((error): PaidSampleResult => ({
        ...prepared.candidate, path, status: "unavailable",
        failures: [`error: ${error instanceof Error ? error.message : String(error)}`], correctness: null, figures: 0,
      }));
      results.push(result);
      await markSampleDone(db, { runId: agentRunId, path, sampleKey, status: result.status }).catch((error) => {
        console.error("[hamilton] a paid replay sample could not be marked done", error);
      });
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));

  if (overCost.size) stopped ??= `The next ${[...overCost].join(", ")} sample's ceiling would take the batch past $40.`;
  if (countCapped) stopped ??= `The batch's ${PAID_REPLAY_MAX_SAMPLES} samples are reserved.`;
  if (Object.keys(blocked).length) stopped ??= "A budget line refused; the next run tries again.";

  // Over for good: every sample reserved, every path at its share or out of questions, or no
  // sample left that fits the spend cap with nothing in flight.
  const after = await readPaidReplayState(db);
  const spend = await readPaidReplaySpend(db);
  const afterCounts = byPathCounts(after.reservations);
  const unfinished = PAID_PATHS.filter((p) => afterCounts[p] < PAID_REPLAY_MIX[p]);
  const ceilings = pathCeilings(after, spend);
  const nothingInFlight = inFlight(after, now()).length === 0;
  const noneFits = unfinished.every((p) => spend.total + ceilings[p] > PAID_REPLAY_MAX_COST_MICROUSD);
  // The plan is spent only when this run stopped for no other reason and no unfinished path has a question left:
  // a question taken off a queue but neither reserved nor passed over (a budget refusal, the start window) is tried again.
  const planSpent = stopped === null && unfinished.every((p) => queues[p].length === 0);
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
    `Paid gate replay batch ${s.batchId}: ${s.reserved.total} of ${s.caps.samples} samples reserved (${reserved}); ${usd(s.spentMicrousd)} of ${usd(s.caps.costMicrousd)} estimated spend.`,
    `This run wrote ${s.results.length} sample${s.results.length === 1 ? "" : "s"}${ran ? ` (${ran})` : ""}${s.settledKeys.length ? `, passed over ${s.settledKeys.length} with nothing to write up` : ""}.`,
    surfaces === null ? "The batch's shadow counts could not be read." : surfaces ? `Shadow gate by surface (validated/partial/held): ${surfaces}.` : "No shadow recorded yet.",
    Object.keys(s.blocked).length ? `Budget refused: ${Object.entries(s.blocked).map(([p, why]) => `${NAMES[p as PaidPath]} (${why})`).join("; ")}.` : "",
    s.complete
      ? `The batch is complete (${s.completeReason === "cost" ? "the spend cap" : s.completeReason === "plan" ? "no question left" : s.completeReason === "already" ? "already" : "every sample"}); no run starts again.`
      : s.stopped ?? "The next run continues.",
  ];
  return parts.filter(Boolean).join(" ");
}
