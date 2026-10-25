/**
 * The one output gate's replay on real questions (#1077, claim contract step 4): so the decision
 * to switch enforcement on can be read from counts today, not after a week of reader shadows.
 *
 * Each day it answers every Pro reader question on record (`pickProQuestions`) and the quality
 * bar's questions for a seeded spread of real institutions (`pickEvalInstitutions`), up to
 * `GATE_REPLAY_DAILY_CAP` answers, through the same free engine path as the Ask bar (`answer`). Each
 * answer with a storyline is put through the one output gate with the input the live Ask path builds
 * for that storyline (the memo's: `memoPayload` over the storyline and its fee evidence, checked with
 * no question and bound with no account, as `memoGateInput` does), and its verdict is recorded as a
 * shadow run exactly as a live one is (`recordGateShadow`), with `origin: "replay"` so it never counts
 * as a reader's. The Ask bar shows the engine's storyline with no gate, so today's decision is
 * `shown_ungated`: a held verdict is an answer enforcement would stop, a partial one is an answer it
 * would cut.
 *
 * Deterministic and free: the engine reads the database and no model is called. The written answer,
 * the memo, Simulate and a report section need a model to write their text, so this replay covers
 * the free Ask path only; the paid eval (`paid-answer-eval.ts`) samples those. A step runs within a
 * time budget, so the day's replay may take several runs (`/api/admin/crew/gate-replay`, hourly):
 * each answer's key is kept with its shadow (and a skipped answer's in its step's detail), so a later
 * run picks up where the last stopped and nothing is recorded twice. The golden set's replay
 * (claim-gate-replay.ts) rides on every summary. Server only.
 */

import { sql } from "@/lib/data-store/connection";
import type { SqlTag } from "@/lib/agents/hamilton/studies/common";
import {
  answer as engineAnswer, EVAL_QUESTION_IDS, pickEvalInstitutions, pickProQuestions, storylineText,
  type Answered, type EvalInstitution, type ProQuestion,
} from "./answer-eval";
import { replayClaimGoldenGate } from "./claim-gate-replay";
import { buildFeeResearchEvidence } from "./evidence-contract";
import { memoPayload } from "./memo";
import type { GateFailureCode, GateInput, GateStatus, GateSurface } from "./output-gate";
import { shadowGate, tallyGateShadow, type GateShadowCounts, type GateShadowRecord, type GateShadowTally, type ShadowDisagreement } from "./output-gate-shadow";
import type { GateShadowContext } from "./output-gate-shadow-store";
import { parsePeerListQuestion } from "./peer-list";
import { QUALITY_QUESTIONS } from "./workspace/quality-bar";
import type { FeeResearch } from "./workspace/types";

/** Answers a day's replay asks at most. */
export const GATE_REPLAY_DAILY_CAP = 400;
/** The run source every replay run carries. */
export const GATE_REPLAY_SOURCE = "hamilton.gate_replay";
/** The replay's step. Deterministic: not a provider step. */
export const GATE_REPLAY_STEP_KEY = "hamilton-gate-replay";
/** Institutions per charter and asset tier: 11 groups x 2 x 17 questions fills the cap after the Pro questions. */
const PER_GROUP = 2;
const CONCURRENCY = 3;
/** Time the answers may take in one run, so the step finishes inside the route's 300 s. */
const BUDGET_MS = 200_000;

/** One answer to replay: a Pro reader's question ("pro") or a quality-bar question (its id). */
export interface ReplayItem {
  institutionId: number;
  question: string;
  from: string;
  key: string;
}

export interface GateReplayDeps {
  pickProQuestions: (db: SqlTag, limit: number) => Promise<ProQuestion[]>;
  pickInstitutions: (db: SqlTag, perGroup: number, seed: string) => Promise<EvalInstitution[]>;
  answer: (institutionId: number, question: string, research: Map<string, Promise<FeeResearch | null>>) => Promise<Answered>;
  /** Records one shadow as its own run; null when it could not be written. */
  record: (record: GateShadowRecord, context: GateShadowContext) => Promise<number | null>;
  /** Replay shadows recorded since a time, with their keys. */
  recordedSince: (since: string) => Promise<Array<{ record: GateShadowRecord; key: string | null }>>;
  /** Keys earlier runs today settled without a shadow (skipped or failed for good). */
  settledToday: (db: SqlTag, day: string) => Promise<Set<string>>;
  /** Every origin's shadows over the last `days` days, for the readers' counts beside the replay's. */
  recentTally: (days: number) => Promise<GateShadowTally>;
}

const defaultDeps: GateReplayDeps = {
  pickProQuestions: (db, limit) => pickProQuestions(db, limit),
  pickInstitutions: (db, perGroup, seed) => pickEvalInstitutions(db, perGroup, seed),
  answer: engineAnswer,
  record: async (record, context) => (await import("./output-gate-shadow-store")).recordGateShadow(record, context),
  recordedSince: async (since) => (await import("./output-gate-shadow-store")).gateShadowRecordsSince("replay", since),
  settledToday: (db, day) => replaySettledToday(db, day),
  recentTally: async (days) => (await import("./output-gate-shadow-store")).countGateShadowDisagreements(days),
};

/** A short stable hash (FNV-1a), so a key names an answer without carrying the question's text. */
function hash(text: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function replayKey(day: string, institutionId: number, from: string, question: string): string {
  return `${day}:${institutionId}:${from === "pro" ? `pro-${hash(question.trim().toLowerCase())}` : from}`;
}

/** The day's plan: every Pro question first, then each sampled institution's quality-bar questions, up to the cap. */
export function planGateReplay(day: string, pro: readonly ProQuestion[], institutions: readonly EvalInstitution[], cap = GATE_REPLAY_DAILY_CAP): ReplayItem[] {
  const items: ReplayItem[] = [];
  const seen = new Set<string>();
  const add = (institutionId: number, question: string, from: string) => {
    const key = replayKey(day, institutionId, from, question);
    if (seen.has(key)) return;
    seen.add(key);
    items.push({ institutionId, question, from, key });
  };
  for (const q of pro) add(q.institutionId, q.question, "pro");
  for (const institution of institutions) {
    for (const id of EVAL_QUESTION_IDS) add(institution.id, QUALITY_QUESTIONS.find((q) => q.id === id)!.question, id);
  }
  return items.slice(0, cap);
}

/**
 * The gate input the live Ask path builds over a storyline (memoGateInput's: the storyline as the
 * memo's payload, its fee evidence for the binding, no question for the check and no account for
 * the binding), with the engine's own storyline text in place of a memo. Null when the answer has
 * no storyline to gate, or is a list, which the Ask path never writes up.
 */
export function askGateInput(institutionId: number, question: string, answered: Answered): GateInput | null {
  const { response, research } = answered;
  const storyline = response.answer?.storyline;
  if (!storyline || storyline.kind === "list") return null;
  const lines = [response.shortAnswer, ...storylineText(response)].map((line) => line?.trim() ?? "").filter(Boolean);
  if (lines.length === 0) return null;
  const bundle = research ? buildFeeResearchEvidence(research) : null;
  const names = new Map<number, string>();
  if (research?.institutionName) names.set(institutionId, research.institutionName);
  return {
    surface: "ask",
    text: lines.join("\n"),
    evidence: { kind: "data", data: memoPayload(storyline, bundle), bundle, names, checkQuestion: false, bindIdentity: false },
    identity: { researchInstitutionId: institutionId, accountInstitutionId: null },
    question,
  };
}

/** Keys earlier replay runs today settled without a shadow, from their finished steps' detail. */
export async function replaySettledToday(db: SqlTag, day: string): Promise<Set<string>> {
  const rows = await db`
    SELECT e.detail->'settledKeys' AS keys
      FROM agent_run_events e
      JOIN agent_runs r ON r.id = e.agent_run_id
     WHERE r.params_json->>'source' = ${GATE_REPLAY_SOURCE}
       AND e.event_type = 'step.finished'
       AND e.created_at >= (${day}::date::timestamp AT TIME ZONE 'UTC')
       AND e.created_at < ((${day}::date + 1)::timestamp AT TIME ZONE 'UTC')
  `;
  const settled = new Set<string>();
  for (const r of rows as unknown as Array<{ keys: unknown }>) {
    if (Array.isArray(r.keys)) for (const key of r.keys) if (typeof key === "string") settled.add(key);
  }
  return settled;
}

/** Whether a finished replay run today already covered the whole plan; the hourly route then starts none. */
export async function gateReplayCompleteToday(day: string, db: SqlTag = sql): Promise<boolean> {
  const rows = await db`
    SELECT 1
      FROM agent_run_events e
      JOIN agent_runs r ON r.id = e.agent_run_id
     WHERE r.params_json->>'source' = ${GATE_REPLAY_SOURCE}
       AND e.event_type = 'step.finished'
       AND e.detail->>'complete' = 'true'
       AND e.detail->>'day' = ${day}
     LIMIT 1
  `;
  return (rows as unknown as unknown[]).length > 0;
}

/** One set of replay counts, in the terms the enforcement decision reads. */
export interface GateReplayCounts {
  total: number;
  byStatus: Record<GateStatus, number>;
  agree: number;
  disagree: number;
  errors: number;
  byDisagreement: Record<ShadowDisagreement, number>;
  /** Every failure code, counted once per answer, most first. */
  topCodes: Array<{ code: GateFailureCode; count: number }>;
  /** The critical codes that made the gate hold, counted once per held answer, most first. */
  heldBy: Array<{ code: GateFailureCode; count: number }>;
  bySurface: Partial<Record<GateSurface, { total: number } & Record<GateStatus, number>>>;
  /** Pro readers' own questions apart from the quality bar's. */
  byFrom: { pro: GateShadowCountsLite; quality: GateShadowCountsLite };
}

export interface GateShadowCountsLite {
  total: number;
  validated: number;
  ready_partial: number;
  held: number;
}

function ranked<T extends string>(counts: Map<T, number>): Array<{ code: T; count: number }> {
  return [...counts].map(([code, count]) => ({ code, count })).sort((a, b) => b.count - a.count || a.code.localeCompare(b.code)).slice(0, 10);
}

function lite(counts: GateShadowCounts): GateShadowCountsLite {
  return { total: counts.total, ...counts.byStatus };
}

export function countGateReplay(records: readonly GateShadowRecord[]): GateReplayCounts {
  const tally = tallyGateShadow(records);
  const codes = new Map<GateFailureCode, number>();
  const bySurface: GateReplayCounts["bySurface"] = {};
  for (const record of records) {
    if (record.error) continue;
    for (const code of new Set(record.codes)) codes.set(code, (codes.get(code) ?? 0) + 1);
    const surface = bySurface[record.surface] ??= { total: 0, validated: 0, ready_partial: 0, held: 0 };
    surface.total += 1;
    surface[record.unified] += 1;
  }
  const pro = tallyGateShadow(records.filter((r) => r.mode === "pro"));
  const quality = tallyGateShadow(records.filter((r) => r.mode !== "pro"));
  return {
    total: tally.total, byStatus: tally.byStatus, agree: tally.agree, disagree: tally.disagree, errors: tally.errors,
    byDisagreement: tally.byDisagreement,
    topCodes: ranked(codes),
    heldBy: ranked(new Map(Object.entries(tally.heldBy) as Array<[GateFailureCode, number]>)),
    bySurface,
    byFrom: { pro: lite(pro), quality: lite(quality) },
  };
}

export interface GateReplayGolden {
  version: string;
  total: number;
  meetsTarget: number;
  controls: number;
  controlsValidated: number;
  byStatus: Record<GateStatus, number>;
  disagree: number;
  cause: { flags: number; holds: number; cuts: number };
}

export interface GateReplaySummary {
  day: string;
  cap: number;
  /** Answers in today's plan, and how many of them are Pro readers' questions. */
  planned: number;
  proQuestions: number;
  institutions: number;
  /** This run's work. */
  run: {
    answered: number;
    recorded: number;
    /** Shadows the ledger refused; they are tried again by the next run. */
    unrecorded: number;
    /** Answers with nothing to gate, by why: the response kind, a list, a peer list. */
    skipped: Record<string, number>;
    errors: number;
    timedOut: boolean;
  };
  /** Keys this run settled without a shadow, so the next run skips them. */
  settledKeys: string[];
  /** Answers of the plan not settled yet. */
  remaining: number;
  /** True once every answer of today's plan is settled. */
  complete: boolean;
  /** Today's replay shadows, every run's together. */
  today: GateReplayCounts;
  /** The last week's shadows by origin, replays apart from readers' answers; null when they could not be read. */
  recent: { days: number; reader: GateShadowCountsLite & { disagree: number }; paid_eval: GateShadowCountsLite & { disagree: number }; replay: GateShadowCountsLite & { disagree: number } } | null;
  golden: GateReplayGolden;
}

export function goldenTotals(): GateReplayGolden {
  const golden = replayClaimGoldenGate();
  return {
    version: golden.version, total: golden.total, meetsTarget: golden.meetsTarget, controls: golden.controls,
    controlsValidated: golden.controlsValidated, byStatus: golden.tally.byStatus, disagree: golden.tally.disagree, cause: golden.cause,
  };
}

const RECENT_DAYS = 7;

/** The replay run: today's plan, minus what earlier runs settled, a few institutions at a time until the budget. */
export async function runGateReplay({
  db = sql,
  now = new Date(),
  cap = GATE_REPLAY_DAILY_CAP,
  perGroup = PER_GROUP,
  budgetMs = BUDGET_MS,
  deps = defaultDeps,
}: { db?: SqlTag; now?: Date; cap?: number; perGroup?: number; budgetMs?: number; deps?: GateReplayDeps } = {}): Promise<GateReplaySummary> {
  const started = Date.now();
  const day = now.toISOString().slice(0, 10);
  const since = `${day}T00:00:00.000Z`;
  const pro = await deps.pickProQuestions(db, cap).catch(() => []);
  const institutions = await deps.pickInstitutions(db, perGroup, day).catch(() => []);
  const plan = planGateReplay(day, pro, institutions, cap);
  const earlier = await deps.recordedSince(since).catch(() => []);
  const settled = await deps.settledToday(db, day).catch(() => new Set<string>());
  const done = new Set([...settled, ...earlier.map((e) => e.key).filter((k): k is string => !!k)]);
  const pending = plan.filter((item) => !done.has(item.key));

  // One institution's answers share its research reads, so they run together.
  const byInstitution = new Map<number, ReplayItem[]>();
  for (const item of pending) byInstitution.set(item.institutionId, [...(byInstitution.get(item.institutionId) ?? []), item]);
  const groups = [...byInstitution.entries()];

  const fresh: GateShadowRecord[] = [];
  const settledKeys: string[] = [];
  const recordedKeys: string[] = [];
  const run: GateReplaySummary["run"] = { answered: 0, recorded: 0, unrecorded: 0, skipped: {}, errors: 0, timedOut: false };
  const skip = (item: ReplayItem, why: string) => {
    run.skipped[why] = (run.skipped[why] ?? 0) + 1;
    settledKeys.push(item.key);
  };

  const replayOne = async (item: ReplayItem, research: Map<string, Promise<FeeResearch | null>>) => {
    // A list question is answered by the peer list, never the fee engine, and has no storyline to gate.
    if (parsePeerListQuestion(item.question)) return skip(item, "peer_list");
    let answered: Answered;
    try {
      answered = await deps.answer(item.institutionId, item.question, research);
    } catch {
      run.errors += 1;
      settledKeys.push(item.key);
      return;
    }
    run.answered += 1;
    const input = askGateInput(item.institutionId, item.question, answered);
    if (!input) return skip(item, answered.response.answer?.storyline?.kind === "list" ? "list" : answered.response.kind);
    const record = shadowGate(input, "shown_ungated", { path: "ask_replay", mode: item.from, origin: "replay" });
    const id = await deps.record(record, { userId: null, researchInstitutionId: item.institutionId, replayKey: item.key }).catch(() => null);
    if (id === null) {
      run.unrecorded += 1;
      return;
    }
    run.recorded += 1;
    recordedKeys.push(item.key);
    fresh.push(record);
  };

  let slowest = 0;
  for (let i = 0; i < groups.length; i += CONCURRENCY) {
    if (Date.now() - started + slowest > budgetMs) {
      run.timedOut = true;
      break;
    }
    const t = Date.now();
    await Promise.all(groups.slice(i, i + CONCURRENCY).map(async ([, items]) => {
      const research = new Map<string, Promise<FeeResearch | null>>();
      for (const item of items) await replayOne(item, research);
    }));
    slowest = Math.max(slowest, Date.now() - t);
  }

  const settledNow = new Set([...done, ...settledKeys, ...recordedKeys]);
  const remaining = plan.filter((item) => !settledNow.has(item.key)).length;
  const recent = await deps.recentTally(RECENT_DAYS).then((tally) => ({
    days: RECENT_DAYS,
    reader: { ...lite(tally.byOrigin.reader), disagree: tally.byOrigin.reader.disagree },
    paid_eval: { ...lite(tally.byOrigin.paid_eval), disagree: tally.byOrigin.paid_eval.disagree },
    replay: { ...lite(tally.byOrigin.replay), disagree: tally.byOrigin.replay.disagree },
  })).catch(() => null);
  return {
    day, cap, planned: plan.length, proQuestions: plan.filter((p) => p.from === "pro").length, institutions: institutions.length,
    run, settledKeys, remaining, complete: plan.length > 0 && remaining === 0,
    today: countGateReplay([...earlier.map((e) => e.record), ...fresh]),
    recent,
    golden: goldenTotals(),
  };
}

const codeList = (codes: Array<{ code: string; count: number }>) => codes.slice(0, 5).map((c) => `${c.code.replace(/_/g, " ")} ${c.count}`).join(", ");

/** The step's summary in the run ledger: today's counts in the enforcement decision's terms, the golden set beside them. */
export function gateReplaySummaryLine(s: GateReplaySummary): string {
  const t = s.today;
  const skipped = Object.values(s.run.skipped).reduce((a, b) => a + b, 0);
  const parts = [
    `Gate replay ${s.day}: ${t.total} of ${s.planned} planned answers gated so far (${s.proQuestions} Pro questions in the plan, ${s.institutions} sampled institutions); this run recorded ${s.run.recorded} and skipped ${skipped} with no storyline${s.run.errors ? `, ${s.run.errors} engine errors` : ""}${s.run.unrecorded ? `, ${s.run.unrecorded} not recorded` : ""}.`,
    `Unified gate: ${t.byStatus.validated} validated, ${t.byStatus.ready_partial} partial, ${t.byStatus.held} held; agrees with today's Ask bar (shown, no gate) on ${t.agree}, disagrees on ${t.disagree} (${t.byDisagreement.unified_holds} it would hold, ${t.byDisagreement.partial_differs} it would cut${t.byDisagreement.unified_shows ? `, ${t.byDisagreement.unified_shows} it would show` : ""})${t.errors ? `; ${t.errors} gate errors` : ""}.`,
    `Pro questions ${t.byFrom.pro.validated}/${t.byFrom.pro.ready_partial}/${t.byFrom.pro.held} of ${t.byFrom.pro.total}; quality bar ${t.byFrom.quality.validated}/${t.byFrom.quality.ready_partial}/${t.byFrom.quality.held} of ${t.byFrom.quality.total} (validated/partial/held).`,
    t.heldBy.length ? `Held by: ${codeList(t.heldBy)}.` : "",
    t.topCodes.length ? `Top failure codes: ${codeList(t.topCodes)}.` : "",
    `Golden set ${s.golden.version}: ${s.golden.meetsTarget} of ${s.golden.total} meet target, ${s.golden.controlsValidated} of ${s.golden.controls} controls validated.`,
    s.recent
      ? `Last ${s.recent.days} days, kept apart: reader answers ${s.recent.reader.total} (${s.recent.reader.disagree} disagree), paid eval ${s.recent.paid_eval.total} (${s.recent.paid_eval.disagree} disagree).`
      : "Last week's reader counts could not be read.",
    s.complete ? "Today's plan is complete." : `${s.remaining} answers left for the next run${s.run.timedOut ? " (stopped at the time budget)" : ""}.`,
  ];
  return parts.filter(Boolean).join(" ");
}
