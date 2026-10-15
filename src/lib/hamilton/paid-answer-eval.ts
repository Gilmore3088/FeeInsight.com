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
 * budget line (`api.hamilton.ask.memo`). The daily cap counts samples already started today in
 * `ai_api_usage_events`, so a retried or repeated run never goes past five. The written answer,
 * simulate and report paths are not sampled yet.
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
/** The provider-usage operation the cap counts. */
export const PAID_EVAL_OPERATION = "storyline_memo_eval";
/** Free answers tried in search of storylines to write up, before the run gives up. */
const MAX_CANDIDATES = 24;

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

/** Samples started today: one subject key per sample, whatever its calls did. Blocked calls never reached the model. */
export async function paidSamplesToday(db: SqlTag, now: Date): Promise<number> {
  const [row] = await db`
    SELECT COUNT(DISTINCT subject_key)::int AS n
      FROM ai_api_usage_events
     WHERE operation = ${PAID_EVAL_OPERATION}
       AND status <> 'blocked'
       AND created_at >= ${dayStart(now)}::timestamptz
  `;
  return Number(row?.n ?? 0);
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
}: { db?: SqlTag; now?: Date; cap?: number; agentRunId?: number; client?: MemoClient; live?: LiveReader } = {}): Promise<PaidAnswerEvalSummary> {
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
    if (picked.length >= remaining) break;
    if (!research.has(candidate.institutionId)) research.set(candidate.institutionId, new Map());
    const answered = await answer(candidate.institutionId, candidate.question, research.get(candidate.institutionId)!).catch(() => null);
    if (answered?.research && answered.response.answer?.storyline) {
      picked.push({ candidate, answered: answered as Answered & { research: FeeResearch } });
    }
  }
  if (picked.length === 0) {
    return { ...base, paths: [summarizePaid([])], note: "No sampled question produced a storyline to write up.", results: [] };
  }

  const stamp = now.toISOString().slice(0, 10);
  const results = await Promise.all(
    picked.map(({ candidate, answered }, i) =>
      writeUp(candidate, answered, live, { subjectKey: `hamilton-eval:${stamp}:${usedBefore + i + 1}`, agentRunId, client }).catch((error) => ({
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
