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
 * shared evidence gate and tied to live values like the memo. One more is a written answer (#1079):
 * the Analyze screen's own prompt and tools for the question, form-checked with the route's evidence
 * gate and its own dollar figures tied to live values for the asked fee, money its tools read from
 * other sources (call reports, national data) accepted as stated.
 * One more is a report's answer page (#1079): the Reports screen's own inputs and section call for
 * the institution, its first verified draft scored by the figure check and the partner review, and
 * the bank's own fee amounts it states tied to live values. Every paid path is now sampled.
 * Server only.
 */

import { sql } from "@/lib/data-store/connection";
import type { SqlTag } from "@/lib/agents/hamilton/studies/common";
import { liveCatalogReader, reconcileMemoText, reconcileWrittenText, type LiveReader } from "./answer-correctness";
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
  options: { subjectKey: string; agentRunId?: number; client?: MemoClient },
): Promise<PaidSampleResult> {
  const storyline = answered.response.answer!.storyline!;
  const result = await writeStorylineMemo(storyline, candidate.question, {
    institutionId: candidate.institutionId,
    factEvidence: buildFeeResearchEvidence(answered.research),
    client: options.client,
    tracking: { operation: PAID_EVAL_OPERATION, subjectKey: options.subjectKey, agentRunId: options.agentRunId },
  });
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
  options: { subjectKey: string; agentRunId?: number; client?: MemoClient },
): Promise<PaidSampleResult> {
  const result = await writeSimulateRead(input, {
    client: options.client,
    institutionId: candidate.institutionId,
    tracking: { operation: PAID_EVAL_SIMULATE_OPERATION, subjectKey: options.subjectKey, agentRunId: options.agentRunId },
  });
  const sample = { ...candidate, question: `Simulate ${input.feeCategory} at $${input.proposedFee.toFixed(2)}` };
  if (result.status !== "written") {
    return { ...sample, path: "simulate", status: "unavailable", failures: [result.reason], correctness: null, figures: 0 };
  }
  const values = await live(candidate.institutionId, answered.research, answered.schedule).catch(() => null);
  const tied = reconcileMemoText({
    question: candidate.question,
    response: answered.response,
    research: answered.research,
    schedule: answered.schedule,
    live: values,
    text: result.text,
    // The tested price is the reader's own input, not a published value.
    extra: [input.proposedFee, Math.abs(input.proposedFee - input.currentFee)],
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

/**
 * Money values the written answer's tools read from sources other than the fee catalog, which it
 * may state as read. Fee prices from catalog tools are left out: the live catalog decides those.
 */
export function toolMoneyFigures(results: ReadonlyArray<{ toolName: string; output: unknown }>): number[] {
  const out: number[] = [];
  const walk = (value: unknown, key: string, depth: number, otherSource: boolean) => {
    if (depth > 8 || value === null || value === undefined) return;
    const money = !NOT_MONEY_KEY.test(key) && (OTHER_MONEY_KEY.test(key) || (otherSource && FEE_PRICE_KEY.test(key)));
    if (typeof value === "number") {
      if (Number.isFinite(value) && money) out.push(value);
    } else if (typeof value === "string") {
      const text = value.trim();
      // Compacted tool results carry their JSON as text.
      if (text.startsWith("{") || text.startsWith("[")) {
        try {
          walk(JSON.parse(text), key, depth + 1, otherSource);
        } catch {
          // Not JSON: nothing to read.
        }
      } else if (money && /^-?\$?\d[\d,]*(\.\d+)?$/.test(text)) out.push(Number(text.replace(/[$,]/g, "")));
    } else if (Array.isArray(value)) {
      for (const item of value) walk(item, key, depth + 1, otherSource);
    } else if (typeof value === "object") {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) walk(v, k, depth + 1, otherSource);
    }
  };
  for (const r of results) walk(r.output, "", 0, OTHER_SOURCE_TOOLS.has(r.toolName));
  return out;
}

async function writtenUp(
  candidate: PaidCandidate,
  answered: Answered & { research: FeeResearch },
  live: LiveReader,
  options: { subjectKey: string; agentRunId?: number; written: WrittenAnswerWriter },
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
  if (!result.check.passed) {
    return { ...candidate, path: "written_answer", status: "withheld", failures: result.check.problems, correctness: null, figures: 0 };
  }
  const values = await live(candidate.institutionId, answered.research, answered.schedule).catch(() => null);
  const tied = reconcileWrittenText({
    question: candidate.question,
    response: answered.response,
    research: answered.research,
    schedule: answered.schedule,
    live: values,
    text: result.text,
    // Money the answer's tools read from other sources (call reports, national data) counts as stated.
    extra: toolMoneyFigures(result.toolResults),
  });
  return {
    ...candidate,
    path: "written_answer",
    status: "written",
    failures: [],
    correctness: tied.checked && tied.figures > 0 ? tied.failures : null,
    figures: tied.figures,
  };
}

async function reportUp(
  candidate: PaidCandidate,
  prepared: PreparedReportAnswer,
  options: { subjectKey: string; agentRunId?: number; writeReport: ReportAnswerWriter; comparison: ComparisonReader },
): Promise<PaidSampleResult> {
  const sample = { ...candidate, question: `Peer Benchmarking report answer page for ${prepared.institutionName}` };
  const result = await options.writeReport(prepared, { operation: PAID_EVAL_REPORT_OPERATION, subjectKey: options.subjectKey, agentRunId: options.agentRunId });
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

/**
 * The daily paid sample. Finds up to the day's remaining samples among free answers that carry a
 * storyline, then writes their memos together (each takes up to two model calls).
 */
export async function runPaidAnswerEval({
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
        ? simulateUp(candidate, answered, input, live, { subjectKey, agentRunId, client })
        : path === "written_answer"
          ? writtenUp(candidate, answered, live, { subjectKey, agentRunId, written })
          : path === "report" && report
            ? reportUp(candidate, report, { subjectKey, agentRunId, writeReport, comparison })
            : writeUp(candidate, answered, live, { subjectKey, agentRunId, client })
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
