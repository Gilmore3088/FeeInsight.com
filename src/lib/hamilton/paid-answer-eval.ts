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
 * provider stop and the budget policies hold it, and each model call still passes the memo's own
 * budget line (`api.hamilton.ask.memo`). Each sample is reserved before its first model call: one
 * `paid_eval.sample_reserved` event on the run, written outside the step's transaction by a
 * conditional insert that refuses once today holds five. A blocked call, a lost usage row or a
 * killed function still leaves the reservation, so a retried or repeated run never goes past five.
 * The written answer, simulate and report paths are not sampled yet.
 * Server only.
 */

import { sql } from "@/lib/data-store/connection";
import type { SqlTag } from "@/lib/agents/hamilton/studies/common";
import { liveCatalogReader, reconcileMemoText, type LiveReader } from "./answer-correctness";
import { answer, EVAL_QUESTION_IDS, pickEvalInstitutions, pickProQuestions, summarizeCorrectness, type Answered, type CorrectnessSummary } from "./answer-eval";
import { buildFeeResearchEvidence } from "./evidence-contract";
import { writeStorylineMemo, type MemoClient } from "./memo";
import { QUALITY_QUESTIONS } from "./workspace/quality-bar";
import type { FeeResearch } from "./workspace/types";

/** Paid answers a day, James's budget (2026-10-15). */
export const PAID_SAMPLE_DAILY_CAP = 5;
/** The provider-usage operation the memo's calls are tagged with. */
export const PAID_EVAL_OPERATION = "storyline_memo_eval";
/** The run event that reserves one sample; the cap counts these. */
export const PAID_EVAL_RESERVATION = "paid_eval.sample_reserved";
/** Free answers tried in search of storylines to write up, before the run gives up. */
const MAX_CANDIDATES = 12;
/** Time the free answers may take, so the memos (up to two 90 s calls) still fit the 300 s function. */
const SEARCH_BUDGET_MS = 60_000;

export interface PaidCandidate {
  institutionId: number;
  question: string;
  /** "pro" for a Pro reader's own question, else the quality-bar question id. */
  from: string;
}

export interface PaidSampleResult extends PaidCandidate {
  path: "memo";
  status: "written" | "withheld" | "unavailable";
  /** Why a memo was withheld or not written; empty when written. */
  failures: string[];
  /** Figures that do not tie to the live catalog; null when the memo was not written or could not be checked. */
  correctness: string[] | null;
  /** Dollar figures checked in the memo. */
  figures: number;
}

export interface PaidPathSummary {
  path: "memo";
  /** Memos asked for, unavailable ones included. */
  sampled: number;
  /** Memos the provider answered (written or withheld): the form rate's base. */
  answers: number;
  /** Memos written: they passed the memo's own checks. */
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
export async function paidSamplesToday(db: SqlTag, now: Date): Promise<number> {
  const [row] = await db`
    SELECT COUNT(*)::int AS n
      FROM agent_run_events
     WHERE event_type = ${PAID_EVAL_RESERVATION}
       AND created_at >= ${dayStart(now)}::timestamptz
  `;
  return Number(row?.n ?? 0);
}

/**
 * Reserves one sample before any model call: inserts the reservation only while today holds fewer
 * than `cap`, and says whether it did. Runs on its own connection (not the step's transaction), so a
 * killed function keeps the reservation.
 */
export async function reserveSample(db: SqlTag, input: { runId: number; subjectKey: string; cap: number; now: Date }): Promise<boolean> {
  const rows = await db`
    INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
    SELECT ${input.runId}, NULL, ${PAID_EVAL_RESERVATION}, 'info',
           ${`Reserved paid answer-eval sample ${input.subjectKey}.`}, ${JSON.stringify({ subject_key: input.subjectKey })}::jsonb
     WHERE (SELECT COUNT(*) FROM agent_run_events
             WHERE event_type = ${PAID_EVAL_RESERVATION}
               AND created_at >= ${dayStart(input.now)}::timestamptz) < ${input.cap}
    RETURNING id
  `;
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

export function summarizePaid(results: PaidSampleResult[]): PaidPathSummary {
  const answered = results.filter((r) => r.status !== "unavailable");
  return {
    path: "memo",
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
}: { db?: SqlTag; now?: Date; cap?: number; agentRunId: number; client?: MemoClient; live?: LiveReader }): Promise<PaidAnswerEvalSummary> {
  const started = Date.now();
  const usedBefore = await paidSamplesToday(db, now);
  const remaining = Math.max(0, cap - usedBefore);
  const base = { cap, usedBefore, notSampled: ["written_answer", "simulate", "report"] };
  if (remaining === 0) {
    return { ...base, paths: [summarizePaid([])], note: `Today's ${cap} paid samples are already used.`, results: [] };
  }

  const pro = await pickProQuestions(db).catch(() => []);
  const institutions = await pickEvalInstitutions(db, 1, now.toISOString().slice(0, 10)).catch(() => []);
  const candidates = orderCandidates(pro, institutions.map((i) => i.id), now).slice(0, MAX_CANDIDATES);

  // Free first: only an answer with a storyline and its fee research is written up.
  const picked: Array<{ candidate: PaidCandidate; answered: Answered & { research: FeeResearch } }> = [];
  const research = new Map<number, Map<string, Promise<FeeResearch | null>>>();
  for (const candidate of candidates) {
    if (picked.length >= remaining || Date.now() - started > SEARCH_BUDGET_MS) break;
    if (!research.has(candidate.institutionId)) research.set(candidate.institutionId, new Map());
    const answered = await answer(candidate.institutionId, candidate.question, research.get(candidate.institutionId)!).catch(() => null);
    if (answered?.research && answered.response.answer?.storyline) {
      picked.push({ candidate, answered: answered as Answered & { research: FeeResearch } });
    }
  }
  if (picked.length === 0) {
    return { ...base, paths: [summarizePaid([])], note: "No sampled question produced a storyline to write up.", results: [] };
  }

  // Reserve each sample before spending; the reservation refuses past the cap.
  const stamp = now.toISOString().slice(0, 10);
  const reserved: Array<(typeof picked)[number] & { subjectKey: string }> = [];
  for (const [i, pick] of picked.entries()) {
    const subjectKey = `hamilton-eval:${stamp}:${agentRunId}:${i + 1}`;
    if (!(await reserveSample(db, { runId: agentRunId, subjectKey, cap, now }))) break;
    reserved.push({ ...pick, subjectKey });
  }
  if (reserved.length === 0) {
    return { ...base, paths: [summarizePaid([])], note: `Today's ${cap} paid samples are already used.`, results: [] };
  }
  const results = await Promise.all(
    reserved.map(({ candidate, answered, subjectKey }) =>
      writeUp(candidate, answered, live, { subjectKey, agentRunId, client }).catch((error) => ({
        ...candidate,
        path: "memo" as const,
        status: "unavailable" as const,
        failures: [`error: ${error instanceof Error ? error.message : String(error)}`],
        correctness: null,
        figures: 0,
      })),
    ),
  );
  const summary = summarizePaid(results);
  return {
    ...base,
    paths: [summary],
    ...(summary.answers === 0 ? { note: "The provider wrote no memo: it is paused, over budget, or could not be reached." } : {}),
    results,
  };
}
