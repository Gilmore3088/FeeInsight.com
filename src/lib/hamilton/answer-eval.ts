/**
 * Hamilton's answer eval on live data: the quality bar's consultant questions asked of a
 * spread of real banks and credit unions, through the same engine path as the Ask bar,
 * scored by the quality bar (and the four-roles eval) plus two checks only live data can
 * make: a regulation answer names the institution's own regulator, and a state question
 * names its own state. It also replays the questions Pro readers really asked (kept in the Ask
 * ledger and saved analyses) through today's engine, so a question Hamilton could not answer
 * stays on the list until it can. Deterministic and read-only: nothing is saved and no model is called.
 * Server only.
 */

import { sql } from "@/lib/data-store/connection";
import type { SqlTag } from "@/lib/agents/hamilton/studies/common";
import { getInstitutionRegulators, type InstitutionRegulators } from "@/lib/data-store/regulators";
import { STATE_NAMES } from "@/lib/us-states";
import { incomeWhyFor, scheduleFor } from "./ask-service";
import { buildAskResponse, parseAsk } from "./workspace/ask";
import { QUALITY_QUESTIONS, scoreResponse, type QualityQuestion } from "./workspace/quality-bar";
import { regulatorSentence } from "./workspace/regulators";
import { getFeeResearch } from "./workspace/research";
import { withDepth } from "./workspace/story-extras";
import type { AskResponse, FeeResearch } from "./workspace/types";

/** The questions asked of every institution: one per kind of ask, across six fees. */
export const EVAL_QUESTION_IDS = ["q01", "q04", "q06", "q07", "q09", "q10", "q11", "q12", "q15", "q17", "q18", "q23", "q25", "q27"] as const;
const REGULATION = new Set(["q25", "q26"]);
const CONCURRENCY = 3;
const STATE = new Set(["q17"]);

export interface EvalInstitution {
  id: number;
  name: string;
  stateCode: string | null;
  charterType: string | null;
  assetTier: string | null;
}

export interface EvalResult {
  institutionId: number;
  questionId: string;
  question: string;
  kind: string;
  failures: string[];
}

/** Every line of the storyline the reader sees: its framing, both lenses, the exhibits and what to watch. */
function storylineText(response: AskResponse): string[] {
  const story = response.answer?.storyline;
  if (!story) return [];
  return [
    story.governingThought,
    ...[...story.situation, ...story.complication, ...story.lenses.finance, ...story.lenses.market, ...story.watch].map((f) => f.text),
    ...story.exhibits.flatMap((e) => [e.actionTitle, e.takeaway?.text ?? ""]),
  ];
}

/** Every reader-facing line of a response, facts included. */
function answerText(response: AskResponse): string {
  return [
    response.shortAnswer,
    response.answer?.headline ?? "",
    ...(response.answer?.claims ?? []).map((c) => c.text),
    ...(response.facts ?? []).map((f) => f.text),
    ...storylineText(response),
  ].join("\n");
}

/**
 * The checks only live data can make. A regulation answer states who regulates this
 * institution when that is on file; a question about "our state" names the state.
 */
export function liveDataFailures(
  item: QualityQuestion,
  response: AskResponse,
  institution: EvalInstitution,
  regulators: InstitutionRegulators | null,
): string[] {
  const failures: string[] = [];
  const text = answerText(response);
  if (REGULATION.has(item.id)) {
    const sentence = regulatorSentence(regulators, institution.stateCode, institution.charterType);
    if (sentence && !text.includes(sentence)) failures.push(`does not name its regulator ("${sentence}")`);
  }
  if (STATE.has(item.id) && institution.stateCode) {
    const state = STATE_NAMES[institution.stateCode] ?? institution.stateCode;
    if (!text.includes(state)) failures.push(`does not name its state (${state})`);
  }
  return failures;
}

/** One question for one institution, through the Ask bar's engine path, with research cached per fee. */
async function answer(institutionId: number, question: string, research: Map<string, Promise<FeeResearch | null>>): Promise<AskResponse> {
  let intent = parseAsk(question);
  const schedule = !intent.feeCategory ? await scheduleFor(institutionId, question, {}) : null;
  if (schedule?.top) intent = { ...intent, feeCategory: schedule.top };
  const why = await incomeWhyFor(institutionId, question, {});
  if (!intent.feeCategory && why?.top) intent = { ...intent, feeCategory: why.top };
  let found: FeeResearch | null = null;
  if (intent.feeCategory) {
    const key = `${intent.feeCategory}|${intent.segment ? JSON.stringify(intent.segment) : ""}`;
    if (!research.has(key)) research.set(key, getFeeResearch(institutionId, intent.feeCategory, new Date(), { segment: intent.segment }).catch(() => null));
    found = await research.get(key)!;
  }
  const built = buildAskResponse({ question, intent, research: found, memory: [] });
  return withDepth(built, schedule, why, found?.provenance.dataAsOf.fees ?? null);
}

/** Everything one institution's questions fail on. */
export async function evaluateInstitution(institution: EvalInstitution): Promise<EvalResult[]> {
  const regulators = await getInstitutionRegulators(institution.id).catch(() => null);
  const research = new Map<string, Promise<FeeResearch | null>>();
  const out: EvalResult[] = [];
  for (const id of EVAL_QUESTION_IDS) {
    const item = QUALITY_QUESTIONS.find((q) => q.id === id)!;
    try {
      const response = await answer(institution.id, item.question, research);
      const failures = [...scoreResponse(item, response).failures, ...liveDataFailures(item, response, institution, regulators)];
      out.push({ institutionId: institution.id, questionId: id, question: item.question, kind: response.kind, failures });
    } catch (error) {
      out.push({ institutionId: institution.id, questionId: id, question: item.question, kind: "error", failures: [`error: ${error instanceof Error ? error.message : String(error)}`] });
    }
  }
  return out;
}

/**
 * A spread of institutions that publish overdraft and NSF fees: banks and credit unions in
 * every asset tier, different states, a fresh draw each day (seeded by the date).
 */
export async function pickEvalInstitutions(db: SqlTag, perGroup: number, seed: string): Promise<EvalInstitution[]> {
  const rows = await db`
    WITH eligible AS (
      SELECT s.id, s.institution_name, s.state_code, s.charter_type, s.asset_size_tier
        FROM institution_sources s
       WHERE s.asset_size_tier IS NOT NULL AND s.charter_type IN ('bank', 'credit_union')
         AND EXISTS (SELECT 1 FROM published_fee_catalog c WHERE c.institution_id = s.id AND c.fee_category = 'overdraft')
         AND EXISTS (SELECT 1 FROM published_fee_catalog c WHERE c.institution_id = s.id AND c.fee_category = 'nsf')
    ), ranked AS (
      SELECT *, ROW_NUMBER() OVER (PARTITION BY charter_type, asset_size_tier ORDER BY md5(id::text || ${seed})) AS r
        FROM eligible
    )
    SELECT id, institution_name, state_code, charter_type, asset_size_tier
      FROM ranked WHERE r <= ${perGroup}
     ORDER BY charter_type, asset_size_tier, r
  `;
  return [...(rows as unknown as Array<Record<string, unknown>>)].map((r) => ({
    id: Number(r.id),
    name: String(r.institution_name),
    stateCode: (r.state_code as string | null) ?? null,
    charterType: (r.charter_type as string | null) ?? null,
    assetTier: (r.asset_size_tier as string | null) ?? null,
  }));
}

/** A question a Pro reader asked, for the institution they asked it about. */
export interface ProQuestion {
  institutionId: number;
  question: string;
  askedAt: string;
}

const PRO_QUESTION_DAYS = 90;
const PRO_QUESTION_LIMIT = 24;
/** Journey audits and other test asks say so at the start; they are not readers' questions. */
const TEST_QUESTION = /^\s*test\b/i;

/**
 * The newest distinct questions Pro readers asked in the last 90 days: every Ask (the ledger keeps
 * the question since engine 1.16) and every saved analysis. One per institution and wording.
 */
export async function pickProQuestions(db: SqlTag, limit = PRO_QUESTION_LIMIT): Promise<ProQuestion[]> {
  const rows = await db`
    WITH asked AS (
      SELECT r.params_json->>'institution_id' AS institution_id, r.params_json->>'question' AS question, r.started_at AS asked_at
        FROM agent_runs r
       WHERE r.run_kind = 'pro_request' AND r.current_stage = 'pro.ask'
         AND r.params_json ? 'question' AND r.started_at > NOW() - make_interval(days => ${PRO_QUESTION_DAYS})
      UNION ALL
      SELECT a.institution_id, a.prompt, a.created_at
        FROM hamilton_saved_analyses a
       WHERE a.status = 'active' AND a.created_at > NOW() - make_interval(days => ${PRO_QUESTION_DAYS})
    ), latest AS (
      SELECT DISTINCT ON (institution_id, lower(btrim(question))) institution_id::bigint AS institution_id, btrim(question) AS question, asked_at
        FROM asked
       WHERE institution_id ~ '^[0-9]+$' AND btrim(COALESCE(question, '')) <> ''
       ORDER BY institution_id, lower(btrim(question)), asked_at DESC
    )
    SELECT institution_id, question, asked_at FROM latest ORDER BY asked_at DESC LIMIT ${limit * 2}
  `;
  return [...(rows as unknown as Array<Record<string, unknown>>)]
    .map((r) => ({ institutionId: Number(r.institution_id), question: String(r.question), askedAt: new Date(String(r.asked_at)).toISOString() }))
    .filter((q) => !TEST_QUESTION.test(q.question))
    .slice(0, limit);
}

export interface ProQuestionResult {
  institutionId: number;
  question: string;
  askedAt: string;
  kind: string;
  shortAnswer: string;
  failures: string[];
}

/** One institution's real questions through today's engine, scored by the same quality bar. */
export async function evaluateProQuestions(institutionId: number, questions: ProQuestion[]): Promise<ProQuestionResult[]> {
  const research = new Map<string, Promise<FeeResearch | null>>();
  const out: ProQuestionResult[] = [];
  for (const q of questions) {
    try {
      const response = await answer(institutionId, q.question, research);
      const failures = scoreResponse({ id: "pro", question: q.question, intent: "a Pro reader's question" }, response).failures;
      out.push({ institutionId, question: q.question, askedAt: q.askedAt, kind: response.kind, shortAnswer: response.shortAnswer, failures });
    } catch (error) {
      out.push({ institutionId, question: q.question, askedAt: q.askedAt, kind: "error", shortAnswer: "", failures: [`error: ${error instanceof Error ? error.message : String(error)}`] });
    }
  }
  return out;
}

export interface ProReplaySummary {
  questions: number;
  passed: number;
  /** Questions Hamilton still answers with a question of its own. */
  askedBack: number;
  topFailures: Array<{ failure: string; count: number }>;
  /** Every real question that falls short, so each becomes a fix. */
  failing: ProQuestionResult[];
}

export function summarizeProReplay(results: ProQuestionResult[]): ProReplaySummary {
  return {
    questions: results.length,
    passed: results.filter((r) => r.failures.length === 0).length,
    askedBack: results.filter((r) => r.kind === "clarifying_question").length,
    topFailures: groupFailures(results),
    failing: results.filter((r) => r.failures.length > 0),
  };
}

function groupFailures(results: Array<{ failures: string[] }>): Array<{ failure: string; count: number }> {
  const shapes = new Map<string, number>();
  for (const r of results) for (const f of r.failures) shapes.set(failureShape(f), (shapes.get(failureShape(f)) ?? 0) + 1);
  return [...shapes.entries()].map(([failure, count]) => ({ failure, count })).sort((a, b) => b.count - a.count).slice(0, 15);
}

export interface AnswerEvalSummary {
  institutions: number;
  /** Institutions drawn for the run; fewer were asked when the time budget ran out. */
  planned: number;
  answers: number;
  passed: number;
  /** Failure text (institution-specific values stripped) with how many answers hit it, most first. */
  topFailures: Array<{ failure: string; count: number }>;
  /** Pass rate per question, weakest first. */
  byQuestion: Array<{ questionId: string; question: string; passed: number; total: number }>;
  failing: EvalResult[];
  timedOut: boolean;
  /** Pro readers' own questions replayed; absent when none were asked. */
  pro?: ProReplaySummary;
}

/** Strips amounts, counts and quoted text so the same failure groups across institutions. */
export function failureShape(failure: string): string {
  return failure
    .replace(/"[^"]*"/g, '"…"')
    .replace(/\([^)]*\)/g, "(…)")
    .replace(/\$?\d[\d,.]*%?/g, "#");
}

export function summarizeEval(results: EvalResult[], institutions: number, timedOut: boolean, planned = institutions): AnswerEvalSummary {
  const byId = new Map<string, { question: string; passed: number; total: number }>();
  for (const r of results) {
    const q = byId.get(r.questionId) ?? { question: r.question, passed: 0, total: 0 };
    q.total += 1;
    if (r.failures.length === 0) q.passed += 1;
    byId.set(r.questionId, q);
  }
  return {
    institutions,
    planned,
    answers: results.length,
    passed: results.filter((r) => r.failures.length === 0).length,
    topFailures: groupFailures(results),
    byQuestion: [...byId.entries()].map(([questionId, q]) => ({ questionId, ...q })).sort((a, b) => a.passed / a.total - b.passed / b.total),
    failing: results.filter((r) => r.failures.length > 0).slice(0, 60),
    timedOut,
  };
}

/**
 * The eval run: Pro readers' own questions first (they are what a buyer asked), then the sampled
 * institutions, a few at a time, until the time budget is spent.
 */
export async function runAnswerEval({
  db = sql,
  perGroup = 1,
  budgetMs = 220_000,
  now = new Date(),
}: { db?: SqlTag; perGroup?: number; budgetMs?: number; now?: Date } = {}): Promise<AnswerEvalSummary> {
  const started = Date.now();
  const proQuestions = await pickProQuestions(db).catch(() => []);
  const byInstitution = new Map<number, ProQuestion[]>();
  for (const q of proQuestions) byInstitution.set(q.institutionId, [...(byInstitution.get(q.institutionId) ?? []), q]);
  const proResults: ProQuestionResult[] = [];
  const asked = [...byInstitution.entries()];
  for (let i = 0; i < asked.length; i += CONCURRENCY) {
    const batch = asked.slice(i, i + CONCURRENCY);
    for (const rows of await Promise.all(batch.map(([id, qs]) => evaluateProQuestions(id, qs)))) proResults.push(...rows);
  }

  const institutions = await pickEvalInstitutions(db, perGroup, now.toISOString().slice(0, 10));
  const results: EvalResult[] = [];
  let done = 0;
  let timedOut = false;
  // A few institutions at a time: each spends most of its time waiting on reads.
  for (let i = 0; i < institutions.length; i += CONCURRENCY) {
    if (Date.now() - started > budgetMs) {
      timedOut = true;
      break;
    }
    const batch = institutions.slice(i, i + CONCURRENCY);
    for (const rows of await Promise.all(batch.map(evaluateInstitution))) results.push(...rows);
    done += batch.length;
  }
  const summary = summarizeEval(results, done, timedOut, institutions.length);
  return proResults.length > 0 ? { ...summary, pro: summarizeProReplay(proResults) } : summary;
}
