import { collectPayloadNumbers } from "./figure-check";
import { dollarsFromUnit } from "./monetary-units";
/**
 * Hamilton's paid answer eval (#1079): a small daily sample through the paid memo path, scored
 * the way the free eval scores the Ask engine. James set the budget on 2026-10-15: five paid
 * answers a day. Each sample is a question Hamilton answers for free first (a Pro reader's own
 * question, else a quality-bar question for a sampled institution); the memo is then written over
 * that answer's storyline, exactly as the Pro page's "write it up" does.
 *
 * Scored twice, like the free path:
 * - form: the memo was written, i.e. it passed the memo's own checks (every figure traces to the
 *   storyline, cited evidence exists, no advice) within its retry; a withheld memo fails form;
 * - correctness: the answer's values and statistics tie to live `published_fee_catalog` rows and
 *   every dollar figure in the memo ties to a live value (`reconcileMemoText`).
 *
 * Paid and capped: it runs as a provider step (`hamilton-paid-answer-eval`), so the global
 * provider stop and the budget policies hold it, and each model call still passes its own path's
 * budget line (`api.hamilton.ask.memo` for memos, `api.hamilton.simulate` for the Simulate read). Each sample is reserved before its first model call: one
 * `paid_eval.sample_reserved` event on the run, written outside the step's transaction by a
 * conditional insert that refuses once today holds five. A blocked call, a lost usage row or a
 * killed function still leaves the reservation, so a retried or repeated run never goes past five.
 * One sample a day goes through the Simulate read instead (#1079): a tested price against the
 * answer's own peer layer, written by the same prompt as the live screen, form-checked with the
 * shared evidence gate and tied to live values like the memo; the one output gate's shadow verdict
 * on it is recorded as its own run (`simulate_read`, #1077 step 4). One more is a written answer
 * (#1079): the Analyze screen's own prompt and tools for the question, its form scored with the one
 * output gate's verdict (`gateAnswer`, #1077 step 7: held fails, and so does any problem today's
 * evidence check finds) and its own dollar figures tied to live values for the asked fee. Each filing
 * figure the gate's sentence binding supports is re-read live from its filing row and must still
 * match; other money its tools read from other sources (national data, a filing sentence left as
 * Hamilton's reading) is accepted as stated. Every sample's shadow verdict (memo, Simulate, written
 * answer, report section) is recorded as its own run with `origin: "paid_eval"`, at no added
 * provider cost, and the step's summary counts the last week's shadows with readers' answers apart.
 * One more is a report's answer page (#1079): the Reports screen's own inputs and section call for
 * the institution, its first verified draft scored by the figure check and the partner review, and
 * the bank's own fee amounts it states tied to live values. Every paid path is now sampled.
 * Server only.
 */

import { sql } from "@/lib/data-store/connection";
import type { SqlTag } from "@/lib/agents/hamilton/studies/common";
import {
  liveCatalogReader, liveFilingReader, reconcileMemoText, reconcileSimulateText, reconcileWrittenText, supportedFilingClaims,
  type FilingReader, type LiveReader,
} from "./answer-correctness";
import { claimEvidenceFacts } from "./claim-evidence";
import { gateAnswer, type GateFailureCode, type GateStatus } from "./output-gate";
import { gateShadowRecord, type GateShadowCounts, type GateShadowRecord, type GateShadowTally } from "./output-gate-shadow";
import type { GateShadowContext } from "./output-gate-shadow-store";
import { analyzeAnswerDecision } from "./analyze-answer-decision";
import { HELD_ANSWER_MESSAGE } from "./answer-gate";
import { answer, EVAL_QUESTION_IDS, pickEvalInstitutions, pickProQuestions, summarizeCorrectness, type Answered, type CorrectnessSummary } from "./answer-eval";
import { buildFeeResearchEvidence } from "./evidence-contract";
import { writeStorylineMemo, type MemoClient } from "./memo";
import { writeSimulateRead, type SimulateInput } from "./simulate-read";
import { writeWrittenAnswer, type WrittenAnswerWriter } from "./written-answer-read";
import { liveReportComparison, prepareReportAnswer, reconcileReportAnswer, writeReportAnswer, type ComparisonReader, type PreparedReportAnswer, type ReportAnswerWriter } from "./report-answer-read";
import { QUALITY_QUESTIONS } from "./workspace/quality-bar";
import type { FeeResearch } from "./workspace/types";

/** Paid answers a day, James's budget (2026-10-15). */
export const PAID_SAMPLE_DAILY_CAP = 5;
/** The provider-usage operation the memo's calls are tagged with. */
export const PAID_EVAL_OPERATION = "storyline_memo_eval";
/** The run event that reserves one sample; the cap counts these. */
export const PAID_EVAL_RESERVATION = "paid_eval.sample_reserved";
/** The provider-usage operation the Simulate sample's call is tagged with. */
export const PAID_EVAL_SIMULATE_OPERATION = "simulate_fee_change_eval";
/** Simulate reads a day, out of the cap. */
export const SIMULATE_DAILY = 1;
/** The provider-usage operation the written answer sample's call is tagged with. */
export const PAID_EVAL_WRITTEN_OPERATION = "written_answer_eval";
/** Written answers a day, out of the cap: the costliest sample (up to four tool steps). */
export const WRITTEN_DAILY = 1;
/** The provider-usage operation the report answer page's calls are tagged with. */
export const PAID_EVAL_REPORT_OPERATION = "report_answer_eval";
/** Report answer pages a day, out of the cap. */
export const REPORT_DAILY = 1;
/** Institutions tried for a report the screen would write (some have too little evidence). */
const REPORT_TRIES = 2;
/** The report's reads stop by this point of the run, so the paid calls after them still fit the 300 s function. */
const REPORT_PREP_DEADLINE_MS = 75_000;
/** Free answers tried in search of storylines to write up, before the run gives up. */
const MAX_CANDIDATES = 12;
/** Time the free answers may take, so the samples (a written answer stops at 180 s) still fit the 300 s function. */
const SEARCH_BUDGET_MS = 60_000;

export interface PaidCandidate {
  institutionId: number;
  question: string;
  /** "pro" for a Pro reader's own question, else the quality-bar question id. */
  from: string;
}

export type PaidPath = "memo" | "simulate" | "written_answer" | "report";
/** The sampled paths, in the order the summary lists them (memo first). */
const PAID_PATHS: PaidPath[] = ["memo", "simulate", "written_answer", "report"];

export interface PaidSampleResult extends PaidCandidate {
  path: PaidPath;
  status: "written" | "withheld" | "unavailable";
  /** Why a memo was withheld or not written; empty when written. */
  failures: string[];
  /** Figures that do not tie to the live catalog; null when the memo was not written or could not be checked. */
  correctness: string[] | null;
  /** Dollar figures checked in the memo. */
  figures: number;
  /** Written answers: the output gate's verdict that scored form, beside what today's evidence check said. */
  gate?: { status: GateStatus; critical: GateFailureCode[]; checkPassed: boolean };
  /** Written answers: supported filing claims re-read live; absent when none were. */
  filings?: number;
}

/** Records a shadow verdict as its own run (output-gate-shadow-store.ts); never throws. */
export type ShadowRecorder = (record: GateShadowRecord, context: GateShadowContext) => Promise<unknown>;

const recordShadowRun: ShadowRecorder = async (record, context) =>
  (await import("./output-gate-shadow-store")).recordGateShadow(record, context);

/** The shadow records of the last `days` days, counted with each origin apart (output-gate-shadow-store.ts). */
export type ShadowCounter = (days: number) => Promise<GateShadowTally>;

const countShadowRuns: ShadowCounter = async (days) =>
  (await import("./output-gate-shadow-store")).countGateShadowDisagreements(days);

/** Days of shadow records the eval's summary counts. */
export const SHADOW_COUNT_DAYS = 7;

/** One origin's shadow counts as the run ledger shows them. */
export interface ShadowOriginCounts {
  total: number;
  agree: number;
  disagree: number;
  unifiedHolds: number;
  unifiedShows: number;
  partialDiffers: number;
  errors: number;
}

/** The shadow gate's counts for the last `days` days, readers' answers apart from the paid eval's samples. */
export interface PaidShadowCounts {
  days: number;
  reader: ShadowOriginCounts;
  paid_eval: ShadowOriginCounts;
}

function originCounts(counts: GateShadowCounts): ShadowOriginCounts {
  return {
    total: counts.total, agree: counts.agree, disagree: counts.disagree, errors: counts.errors,
    unifiedHolds: counts.byDisagreement.unified_holds, unifiedShows: counts.byDisagreement.unified_shows, partialDiffers: counts.byDisagreement.partial_differs,
  };
}

/**
 * Records each shadow verdict a sample produced as its own run, marked as the paid eval's
 * (`origin: "paid_eval"`), so it is never counted as a reader's answer. A shadow that fails is
 * logged and dropped: it never changes the sample's score.
 */
async function recordEvalShadows(shadows: ReadonlyArray<() => GateShadowRecord>, recordShadow: ShadowRecorder, institutionId: number): Promise<void> {
  for (const compute of shadows) {
    try {
      await recordShadow({ ...compute(), origin: "paid_eval" }, { userId: null, researchInstitutionId: institutionId });
    } catch (error) {
      console.error("[hamilton] the paid eval's shadow output gate could not be recorded", error);
    }
  }
}

export interface PaidPathSummary {
  path: PaidPath;
  /** Answers asked for, unavailable ones included. */
  sampled: number;
  /** Answers the provider gave (written or withheld): the form rate's base. */
  answers: number;
  /** Answers that passed their checks (the memo's own; the evidence gate for Simulate and written answers; figures and partner review for a report). */
  passed: number;
  correctness: CorrectnessSummary;
}

export interface PaidAnswerEvalSummary {
  cap: number;
  /** Samples already started today before this run. */
  usedBefore: number;
  paths: PaidPathSummary[];
  /** Paid paths this eval does not sample yet. */
  notSampled: string[];
  /** Set when the run wrote nothing: the cap was used, no storyline was found, or the provider was unavailable. */
  note?: string;
  results: PaidSampleResult[];
  /** The shadow gate's counts for the last week, readers apart from the eval; null when they could not be read. */
  shadow?: PaidShadowCounts | null;
}

/** UTC midnight of `now`, the day the cap counts. */
export function dayStart(now: Date): string {
  return `${now.toISOString().slice(0, 10)}T00:00:00.000Z`;
}

/** Samples reserved today, by any run, whatever their calls did. */
export async function paidSamplesToday(db: SqlTag, now: Date, path?: PaidPath): Promise<number> {
  const [row] = path
    ? await db`
        SELECT COUNT(*)::int AS n
          FROM agent_run_events
         WHERE event_type = ${PAID_EVAL_RESERVATION}
           AND created_at >= ${dayStart(now)}::timestamptz
           AND detail ->> 'path' = ${path}
      `
    : await db`
        SELECT COUNT(*)::int AS n
          FROM agent_run_events
         WHERE event_type = ${PAID_EVAL_RESERVATION}
           AND created_at >= ${dayStart(now)}::timestamptz
      `;
  return Number(row?.n ?? 0);
}

/** Each non-memo path's daily share of the cap; memos fill the rest. */
const PATH_DAILY: Partial<Record<PaidPath, number>> = { simulate: SIMULATE_DAILY, written_answer: WRITTEN_DAILY, report: REPORT_DAILY };

/**
 * Runs `reserve` inside a transaction that first takes the day's advisory lock, so two runs never
 * both see room for the last slot (#1418): under READ COMMITTED the insert after the lock reads a
 * fresh snapshot, which includes the other run's committed reservation. A db with no `begin`
 * (a test double) runs it directly.
 */
async function underDayLock<T>(db: SqlTag, now: Date, reserve: (tx: SqlTag) => Promise<T>): Promise<T> {
  const begin = (db as unknown as { begin?: (fn: (tx: SqlTag) => Promise<T>) => Promise<T> }).begin;
  if (typeof begin !== "function") return reserve(db);
  return begin.call(db, async (tx: SqlTag) => {
    await tx`SELECT pg_advisory_xact_lock(hashtext(${`hamilton-paid-eval:${dayStart(now)}`}))`;
    return reserve(tx);
  });
}

/**
 * Reserves one sample before any model call: inserts the reservation only while today holds fewer
 * than `cap`, and fewer than its path's daily share (one Simulate, written answer and report each,
 * #1414), and says whether it did. Runs in its own short transaction (not the step's), so a killed
 * function keeps the reservation.
 */
export async function reserveSample(db: SqlTag, input: { runId: number; subjectKey: string; cap: number; now: Date; path?: PaidPath }): Promise<boolean> {
  const path = input.path ?? "memo";
  const pathLimit = PATH_DAILY[path] ?? input.cap;
  const rows = await underDayLock(db, input.now, (tx) => tx`
    INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
    SELECT ${input.runId}, NULL, ${PAID_EVAL_RESERVATION}, 'info',
           ${`Reserved paid answer-eval sample ${input.subjectKey}.`}, ${JSON.stringify({ subject_key: input.subjectKey, path })}::jsonb
     WHERE (SELECT COUNT(*) FROM agent_run_events
             WHERE event_type = ${PAID_EVAL_RESERVATION}
               AND created_at >= ${dayStart(input.now)}::timestamptz
               AND detail ->> 'path' = ${path}) < ${pathLimit}
       AND (SELECT COUNT(*) FROM agent_run_events
             WHERE event_type = ${PAID_EVAL_RESERVATION}
               AND created_at >= ${dayStart(input.now)}::timestamptz) < ${input.cap}
    RETURNING id
  `);
  return rows.length > 0;
}

/**
 * Candidates in order: Pro readers' own questions (what a buyer asked) rotated by the day, then
 * quality-bar questions for today's sampled institutions, one question per institution, also
 * rotated, so the sample moves across fees and kinds of ask from day to day.
 */
export function orderCandidates(pro: Array<{ institutionId: number; question: string }>, institutions: number[], now: Date): PaidCandidate[] {
  const day = Math.floor(Date.parse(dayStart(now)) / 86_400_000);
  const rotate = <T>(items: T[]): T[] => (items.length === 0 ? items : [...items.slice(day % items.length), ...items.slice(0, day % items.length)]);
  const questions = EVAL_QUESTION_IDS.map((id) => QUALITY_QUESTIONS.find((q) => q.id === id)!).filter(Boolean);
  return [
    ...rotate(pro).map((q) => ({ institutionId: q.institutionId, question: q.question, from: "pro" })),
    ...institutions.map((id, i) => {
      const q = questions[(day + i) % questions.length];
      return { institutionId: id, question: q.question, from: q.id };
    }),
  ];
}

async function writeUp(
  candidate: PaidCandidate,
  answered: Answered & { research: FeeResearch },
  live: LiveReader,
  options: { subjectKey: string; agentRunId?: number; client?: MemoClient; recordShadow: ShadowRecorder },
): Promise<PaidSampleResult> {
  const storyline = answered.response.answer!.storyline!;
  // The one output gate's shadow verdict on the draft the memo's decision rests on (#1077 step 4).
  const shadows: Array<() => GateShadowRecord> = [];
  const result = await writeStorylineMemo(storyline, candidate.question, {
    institutionId: candidate.institutionId,
    factEvidence: buildFeeResearchEvidence(answered.research),
    client: options.client,
    tracking: { operation: PAID_EVAL_OPERATION, subjectKey: options.subjectKey, agentRunId: options.agentRunId },
    onGateShadow: (compute) => { shadows.push(compute); },
  });
  await recordEvalShadows(shadows, options.recordShadow, candidate.institutionId);
  if (result.status !== "written") {
    const failures = result.status === "withheld" ? (result.problems?.length ? result.problems : [result.reason]) : [result.reason];
    return { ...candidate, path: "memo", status: result.status, failures, correctness: null, figures: 0 };
  }
  const memo = result.memo;
  const values = await live(candidate.institutionId, answered.research, answered.schedule).catch(() => null);
  const tied = reconcileMemoText({
    question: candidate.question,
    response: answered.response,
    research: answered.research,
    schedule: answered.schedule,
    live: values,
    text: [memo.summary, memo.board, memo.market, ...memo.questions].join("\n"),
  });
  return { ...candidate, path: "memo", status: "written", failures: [], correctness: tied.checked ? tied.failures : null, figures: tied.figures };
}

/**
 * The tested price for a Simulate sample, from the answer's own research: the narrowest layer
 * with a full peer band, and its median as the tested price (or $5 above the current fee when the
 * fee already sits at the median). Null when the bank has no price or no layer has a band.
 */
export function simulateInputFor(research: FeeResearch): SimulateInput | null {
  if (research.current === null) return null;
  const order = ["local", "state", "charter_size", "fed_district", "national"];
  const layer = [...research.layers]
    .filter((l) => l.p25 !== null && l.median !== null && l.p75 !== null && l.n > 0)
    .sort((a, b) => order.indexOf(a.scope) - order.indexOf(b.scope))[0];
  if (!layer) return null;
  const median = layer.median as number;
  const tested = Math.abs(median - research.current) >= 0.5 ? median : research.current + 5;
  return {
    feeCategory: research.feeCategory,
    currentFee: research.current,
    proposedFee: Math.round(tested * 100) / 100,
    distribution: { p25_amount: layer.p25, median_amount: layer.median, p75_amount: layer.p75, institution_count: layer.n, peer_label: layer.label },
    // The research carries no charter, so the institution line is left out rather than guessed.
    institution: null,
  };
}

async function simulateUp(
  candidate: PaidCandidate,
  answered: Answered & { research: FeeResearch },
  input: SimulateInput,
  live: LiveReader,
  options: { subjectKey: string; agentRunId?: number; client?: MemoClient; recordShadow: ShadowRecorder },
): Promise<PaidSampleResult> {
  // The one output gate's shadow verdict on the read (#1077 step 4), recorded as its own run once the
  // read is back. It never changes the score: a shadow that fails is logged and dropped.
  const shadows: Array<() => GateShadowRecord> = [];
  const result = await writeSimulateRead(input, {
    client: options.client,
    institutionId: candidate.institutionId,
    tracking: { operation: PAID_EVAL_SIMULATE_OPERATION, subjectKey: options.subjectKey, agentRunId: options.agentRunId },
    onGateShadow: (compute) => { shadows.push(compute); },
  });
  await recordEvalShadows(shadows, options.recordShadow, candidate.institutionId);
  const sample = { ...candidate, question: `Simulate ${input.feeCategory} at $${input.proposedFee.toFixed(2)}` };
  if (result.status !== "written") {
    return { ...sample, path: "simulate", status: "unavailable", failures: [result.reason], correctness: null, figures: 0 };
  }
  const values = await live(candidate.institutionId, answered.research, answered.schedule).catch(() => null);
  const tied = reconcileSimulateText({
    question: candidate.question,
    response: answered.response,
    research: answered.research,
    schedule: answered.schedule,
    live: values,
    text: result.text,
    // The tested price is the reader's own input: an anchor, so gaps from it tie too. The current fee is
    // not: it must still be the bank's live value.
    readerAnchors: [input.proposedFee],
  });
  return {
    ...sample,
    path: "simulate",
    status: result.check.passed ? "written" : "withheld",
    failures: result.check.problems,
    // Like a withheld memo, a read that fails form is not scored for correctness; nor is one with no figure to tie.
    correctness: result.check.passed && tied.checked && tied.figures > 0 ? tied.failures : null,
    figures: tied.figures,
  };
}

/** Tools that read sources other than the fee catalog (national data, call-report revenue, regulation). */
const OTHER_SOURCE_TOOLS = new Set(["queryNationalData", "queryFeeRevenueCorrelation", "queryRegulatoryRisk"]);
/** Money that is not a fee price: call-report and balance-sheet values, from any tool. */
const OTHER_MONEY_KEY = /revenue|income|deposit|asset|loan|service_charge|expense|equity|capital|earning/i;
/** Fee prices and their statistics: accepted as stated only from an other-source tool. */
const FEE_PRICE_KEY = /amount|median|^p\d{2}|avg|mean|average|^min|^max|price|fee$|charge$/i;
/** Never money: ids, counts and ranks, whatever else the key says. */
const NOT_MONEY_KEY = /(^|_)(id|ids|n|rank)$|count|number|^total$/i;

/** The dollar values in a queryData public-data result (rows of { value, unit }), compacted or not. */
function publicDataDollars(output: unknown): number[] {
  let parsed = output;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed);
    } catch {
      return [];
    }
  }
  if (parsed && typeof parsed === "object" && (parsed as { _shortened?: unknown })._shortened === true) {
    try {
      parsed = JSON.parse(String((parsed as { text?: unknown }).text ?? ""));
    } catch { return []; }
  }
  const rows = (parsed as { rows?: unknown } | null)?.rows;
  if (!Array.isArray(rows)) return [];
  return rows.flatMap((row) => {
    const { value, unit } = (row ?? {}) as { value?: unknown; unit?: unknown };
    const dollars = dollarsFromUnit(value, unit);
    return dollars === null ? [] : [dollars];
  });
}

/** queryData on a public-data measure reads another source: its dollar figures are accepted as read. Fee measures stay with the catalog. */
function publicDataQuery(result: { toolName: string; input?: unknown }): boolean {
  const input = result.input as { measure?: unknown } | null | undefined;
  return result.toolName === "queryData" && typeof input?.measure === "string" && input.measure.startsWith("area:");
}

/**
 * Money values the written answer's tools read from sources other than the fee catalog, which it
 * may state as read. Fee prices from catalog tools are left out: the live catalog decides those.
 */
/**
 * `queryNationalData` with `source: "fee_index"` returns medians derived from the fee catalog, not
 * another source (#1414 item 6). Those are left out, so a stated national median must tie to the
 * live national layer the correctness check recomputes, and a stale index median is caught.
 */
function catalogDerived(result: { toolName: string; input?: unknown }): boolean {
  const input = result.input as { source?: unknown } | null | undefined;
  return result.toolName === "queryNationalData" && typeof input === "object" && input !== null && input.source === "fee_index";
}

export function toolMoneyFigures(results: ReadonlyArray<{ toolName: string; input?: unknown; output: unknown }>): number[] {
  const out: number[] = [];
  for (const r of results) {
    if (catalogDerived(r)) continue;
    if (publicDataQuery(r)) out.push(...publicDataDollars(r.output));
    else {
      for (const number of collectPayloadNumbers(r.output)) {
        const money = !NOT_MONEY_KEY.test(number.key)
          && (OTHER_MONEY_KEY.test(number.key) || (OTHER_SOURCE_TOOLS.has(r.toolName) && FEE_PRICE_KEY.test(number.key)));
        if (money && number.dollars !== null) out.push(number.dollars ?? number.value);
      }
    }
  }
  return out;
}

async function writtenUp(
  candidate: PaidCandidate,
  answered: Answered & { research: FeeResearch },
  live: LiveReader,
  options: { subjectKey: string; agentRunId?: number; written: WrittenAnswerWriter; filings: FilingReader; recordShadow: ShadowRecorder },
): Promise<PaidSampleResult> {
  const result = await options.written({
    institutionId: candidate.institutionId,
    institutionName: answered.research.institutionName,
    question: candidate.question,
    tracking: { operation: PAID_EVAL_WRITTEN_OPERATION, subjectKey: options.subjectKey, agentRunId: options.agentRunId },
  });
  if (result.status !== "written") {
    return { ...candidate, path: "written_answer", status: "unavailable", failures: [result.reason], correctness: null, figures: 0 };
  }
  // Form is the one output gate's verdict (#1077 step 7), over the same reads, briefing and identity
  // the route gives it. Held fails; so does any problem today's evidence check finds (the verdict's
  // own `check`), so an answer whose failing sentence the gate would only cut never passes form here.
  const reads = result.toolResults;
  const verdict = gateAnswer({
    surface: "written_answer",
    text: result.text,
    evidence: { kind: "tool_reads", toolOutputs: reads.map((r) => r.output), reads, briefingEvidence: result.briefingEvidence },
    // The sampled institution stands as the reader's own, as writeWrittenAnswer writes it.
    identity: { researchInstitutionId: candidate.institutionId, accountInstitutionId: candidate.institutionId, accountInstitutionName: answered.research.institutionName },
    question: candidate.question,
  });
  // Its shadow record beside what the Analyze screen would have done with this answer: the route's
  // own rule (analyzeAnswerDecision) over the verdict's check and binding, which are the route's.
  const decision = analyzeAnswerDecision(result.text, verdict.check, verdict.binding, HELD_ANSWER_MESSAGE !== null);
  await recordEvalShadows([() => gateShadowRecord(verdict, decision.today, { path: "written_streaming", mode: "analyze" })], options.recordShadow, candidate.institutionId);
  const gate = { status: verdict.status, critical: verdict.failures.filter((f) => f.critical).map((f) => f.code), checkPassed: result.check.passed };
  if (verdict.status === "held" || !verdict.check.passed) {
    const failures = verdict.status === "held" ? verdict.failures.filter((f) => f.critical).map((f) => `${f.code}: ${f.message}`) : verdict.check.problems;
    return { ...candidate, path: "written_answer", status: "withheld", failures, correctness: null, figures: 0, gate };
  }
  const values = await live(candidate.institutionId, answered.research, answered.schedule).catch(() => null);
  // Each filing figure the binding supports, re-read live from its row (a database read, no model call).
  const claims = reads.length ? supportedFilingClaims(verdict.binding, claimEvidenceFacts(reads, candidate.institutionId)) : [];
  const filingValues = claims.length ? await options.filings(claims.map((c) => c.key)).catch(() => null) : null;
  const tied = reconcileWrittenText({
    question: candidate.question,
    response: answered.response,
    research: answered.research,
    schedule: answered.schedule,
    live: values,
    text: result.text,
    // Money the answer's tools read from other sources counts as stated, except a supported filing claim's, which is re-read.
    extra: toolMoneyFigures(result.toolResults),
    ...(claims.length ? { filings: { claims, live: filingValues } } : {}),
  });
  const scored = tied.checked && (tied.figures > 0 || (tied.filings ?? 0) > 0);
  return {
    ...candidate,
    path: "written_answer",
    status: "written",
    failures: [],
    correctness: scored ? tied.failures : null,
    figures: tied.figures,
    gate,
    ...(tied.filings ? { filings: tied.filings } : {}),
  };
}

async function reportUp(
  candidate: PaidCandidate,
  prepared: PreparedReportAnswer,
  options: { subjectKey: string; agentRunId?: number; writeReport: ReportAnswerWriter; comparison: ComparisonReader; recordShadow: ShadowRecorder },
): Promise<PaidSampleResult> {
  const sample = { ...candidate, question: `Peer Benchmarking report answer page for ${prepared.institutionName}` };
  const result = await options.writeReport(prepared, {
    operation: PAID_EVAL_REPORT_OPERATION, subjectKey: options.subjectKey, agentRunId: options.agentRunId,
    // The sampled institution is the reader's own and the report's subject, so the shadow's account rule can fire.
    gateIdentity: { researchInstitutionId: prepared.institutionId, accountInstitutionId: prepared.institutionId, accountInstitutionName: prepared.institutionName },
  });
  if (result.status === "written" && result.gateShadow) await recordEvalShadows([result.gateShadow], options.recordShadow, prepared.institutionId);
  if (result.status !== "written") {
    return { ...sample, path: "report", status: "unavailable", failures: [result.reason], correctness: null, figures: 0 };
  }
  if (!result.passed) {
    return { ...sample, path: "report", status: "withheld", failures: result.problems, correctness: null, figures: 0 };
  }
  const tied = await reconcileReportAnswer(prepared, result.narrative, options.comparison);
  return { ...sample, path: "report", status: "written", failures: [], correctness: tied.checked && tied.figures > 0 ? tied.failures : null, figures: tied.figures };
}

export function summarizePaid(results: PaidSampleResult[], path: PaidPath = "memo"): PaidPathSummary {
  const answered = results.filter((r) => r.status !== "unavailable");
  return {
    path,
    sampled: results.length,
    answers: answered.length,
    passed: answered.filter((r) => r.status === "written").length,
    correctness: summarizeCorrectness(results),
  };
}

type PaidEvalOptions = Parameters<typeof samplePaidAnswers>[0] & {
  /** Counts the last week's shadow records, each origin apart, for the summary. */
  countShadows?: ShadowCounter;
};

/**
 * The daily paid sample (samplePaidAnswers), then the shadow gate's counts for the last week with
 * readers' answers apart from the eval's samples, so the run ledger shows both (#1077). Each
 * sample's shadow verdict is recorded at no added provider cost: the gate runs over answers the
 * eval already paid for.
 */
export async function runPaidAnswerEval({ countShadows = countShadowRuns, ...options }: PaidEvalOptions): Promise<PaidAnswerEvalSummary> {
  const summary = await samplePaidAnswers(options);
  const shadow = await countShadows(SHADOW_COUNT_DAYS)
    .then((tally): PaidShadowCounts => ({ days: SHADOW_COUNT_DAYS, reader: originCounts(tally.byOrigin.reader), paid_eval: originCounts(tally.byOrigin.paid_eval) }))
    .catch((error) => {
      console.error("[hamilton] the shadow gate's counts could not be read", error);
      return null;
    });
  return { ...summary, shadow };
}

/** The shadow counts as one line of the paid eval step's summary. */
export function shadowCountsLine(shadow: PaidShadowCounts | null | undefined): string {
  if (!shadow) return " Shadow gate counts could not be read.";
  const part = (label: string, c: ShadowOriginCounts) =>
    `${label} ${c.total} (${c.disagree} disagree: ${c.unifiedHolds} the unified gate would hold, ${c.unifiedShows} it would show, ${c.partialDiffers} cut differently${c.errors ? `; ${c.errors} errors` : ""})`;
  return ` Shadow gate, last ${shadow.days} days: ${part("reader answers", shadow.reader)}; ${part("paid eval samples", shadow.paid_eval)}.`;
}

/**
 * Finds up to the day's remaining samples among free answers that carry a storyline, then writes
 * their memos together (each takes up to two model calls).
 */
async function samplePaidAnswers({
  db = sql,
  now = new Date(),
  cap = PAID_SAMPLE_DAILY_CAP,
  agentRunId,
  client,
  live = liveCatalogReader(),
  written = writeWrittenAnswer,
  prepareReport = prepareReportAnswer,
  writeReport = writeReportAnswer,
  comparison = liveReportComparison,
  filings = liveFilingReader(),
  recordShadow = recordShadowRun,
}: {
  db?: SqlTag;
  now?: Date;
  cap?: number;
  agentRunId: number;
  client?: MemoClient;
  live?: LiveReader;
  written?: WrittenAnswerWriter;
  prepareReport?: (institutionId: number, institutionName: string, now: Date) => Promise<PreparedReportAnswer | null>;
  writeReport?: ReportAnswerWriter;
  comparison?: ComparisonReader;
  /** Live filing re-reads for the written answer's supported filing claims. */
  filings?: FilingReader;
  /** Where each sample's shadow verdict is recorded (as the paid eval's, never a reader's). */
  recordShadow?: ShadowRecorder;
}): Promise<PaidAnswerEvalSummary> {
  const started = Date.now();
  const usedBefore = await paidSamplesToday(db, now);
  const remaining = Math.max(0, cap - usedBefore);
  const base = { cap, usedBefore, notSampled: [] as string[] };
  const empty = (note: string): PaidAnswerEvalSummary => ({ ...base, paths: PAID_PATHS.map((p) => summarizePaid([], p)), note, results: [] });
  if (remaining === 0) return empty(`Today's ${cap} paid samples are already used.`);
  const wantSimulate = (await paidSamplesToday(db, now, "simulate")) < SIMULATE_DAILY;
  const wantWritten = (await paidSamplesToday(db, now, "written_answer")) < WRITTEN_DAILY;
  const wantReport = (await paidSamplesToday(db, now, "report")) < REPORT_DAILY;

  const pro = await pickProQuestions(db).catch(() => []);
  const institutions = await pickEvalInstitutions(db, 1, now.toISOString().slice(0, 10)).catch(() => []);
  const candidates = orderCandidates(pro, institutions.map((i) => i.id), now).slice(0, MAX_CANDIDATES);

  // Free first: only an answer with its fee research is written up (a memo also needs a storyline).
  type Pick = { path: PaidPath; candidate: PaidCandidate; answered: Answered & { research: FeeResearch }; simulate?: SimulateInput; report?: PreparedReportAnswer };
  const memos: Pick[] = [];
  let simulate: Pick | null = null;
  let writtenPick: Pick | null = null;
  // Answered candidates, in order: the report sample tries their institutions after the search.
  const answeredCandidates: Array<{ candidate: PaidCandidate; answered: Answered & { research: FeeResearch } }> = [];
  const research = new Map<number, Map<string, Promise<FeeResearch | null>>>();
  for (const candidate of candidates) {
    const simulateDone: boolean = !wantSimulate || simulate !== null;
    const writtenDone: boolean = !wantWritten || writtenPick !== null;
    if ((memos.length >= remaining && simulateDone && writtenDone) || Date.now() - started > SEARCH_BUDGET_MS) break;
    if (!research.has(candidate.institutionId)) research.set(candidate.institutionId, new Map());
    const answered = await answer(candidate.institutionId, candidate.question, research.get(candidate.institutionId)!).catch(() => null);
    if (!answered?.research) continue;
    const withResearch = answered as Answered & { research: FeeResearch };
    answeredCandidates.push({ candidate, answered: withResearch });
    const input: SimulateInput | null = !simulateDone ? simulateInputFor(withResearch.research) : null;
    if (input) simulate = { path: "simulate", candidate, answered: withResearch, simulate: input };
    // The written answer takes the first answered question; it needs research but no storyline.
    if (!writtenDone) writtenPick = { path: "written_answer", candidate, answered: withResearch };
    if (answered.response.answer?.storyline && memos.length < remaining) memos.push({ path: "memo", candidate, answered: withResearch });
  }
  // A report the Reports screen would write, for one of the answered institutions (reads only).
  let reportPick: Pick | null = null;
  if (wantReport) {
    const tried = new Set<number>();
    for (const { candidate, answered } of answeredCandidates) {
      const left = REPORT_PREP_DEADLINE_MS - (Date.now() - started);
      if (tried.has(candidate.institutionId) || tried.size >= REPORT_TRIES || left <= 0) continue;
      tried.add(candidate.institutionId);
      let deadline: ReturnType<typeof setTimeout> | undefined;
      const prepared = await Promise.race([
        prepareReport(candidate.institutionId, answered.research.institutionName, now).catch(() => null),
        new Promise<null>((resolve) => { deadline = setTimeout(() => resolve(null), left); }),
      ]).finally(() => clearTimeout(deadline));
      if (prepared) {
        reportPick = { path: "report", candidate, answered, report: prepared };
        break;
      }
    }
  }
  // The Simulate, written answer and report samples take their slots first; memos fill the rest of today's cap.
  const picked = [...(simulate ? [simulate] : []), ...(writtenPick ? [writtenPick] : []), ...(reportPick ? [reportPick] : []), ...memos].slice(0, remaining);
  if (picked.length === 0) return empty("No sampled question produced an answer to write up.");

  // Reserve each sample before spending; the reservation refuses past the cap.
  const stamp = now.toISOString().slice(0, 10);
  const reserved: Array<Pick & { subjectKey: string }> = [];
  for (const [i, pick] of picked.entries()) {
    const subjectKey = `hamilton-eval:${stamp}:${agentRunId}:${i + 1}${pick.path === "memo" ? "" : `:${pick.path}`}`;
    if (!(await reserveSample(db, { runId: agentRunId, subjectKey, cap, now, path: pick.path }))) break;
    reserved.push({ ...pick, subjectKey });
  }
  if (reserved.length === 0) return empty(`Today's ${cap} paid samples are already used.`);
  const results = await Promise.all(
    reserved.map(({ path, candidate, answered, simulate: input, report, subjectKey }) =>
      (path === "simulate" && input
        ? simulateUp(candidate, answered, input, live, { subjectKey, agentRunId, client, recordShadow })
        : path === "written_answer"
          ? writtenUp(candidate, answered, live, { subjectKey, agentRunId, written, filings, recordShadow })
          : path === "report" && report
            ? reportUp(candidate, report, { subjectKey, agentRunId, writeReport, comparison, recordShadow })
            : writeUp(candidate, answered, live, { subjectKey, agentRunId, client, recordShadow })
      ).catch((error) => ({
        ...candidate,
        path,
        status: "unavailable" as const,
        failures: [`error: ${error instanceof Error ? error.message : String(error)}`],
        correctness: null,
        figures: 0,
      })),
    ),
  );
  const paths = PAID_PATHS.map((p) => summarizePaid(results.filter((r) => r.path === p), p));
  return {
    ...base,
    paths,
    ...(paths.every((p) => p.answers === 0) ? { note: "The provider wrote nothing: it is paused, over budget, or could not be reached." } : {}),
    results,
  };
}
