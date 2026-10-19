/**
 * Hamilton's answer eval on live data: the quality bar's consultant questions asked of a
 * spread of real banks and credit unions, through the same engine path as the Ask bar,
 * scored by the quality bar (and the four-roles eval) plus checks only live data can
 * make: a regulation answer names the institution's own regulator and lists the Regulatory
 * Wire's recent items for it, and a state question names its own state. It also replays the questions Pro readers really asked (kept in the Ask
 * ledger and saved analyses) through today's engine, so a question Hamilton could not answer
 * stays on the list until it can. Each answer is scored twice: on form (the quality bar) and on
 * correctness (#1079: its fee figures tie to live rows in published_fee_catalog under the
 * statistics contract, `answer-correctness.ts`). Deterministic and read-only: nothing is saved and
 * no model is called.
 * Server only.
 */

import { sql } from "@/lib/data-store/connection";
import type { SqlTag } from "@/lib/agents/hamilton/studies/common";
import { getInstitutionRegulators, type InstitutionRegulators } from "@/lib/data-store/regulators";
import { STATE_NAMES } from "@/lib/us-states";
import { resolveAskIntent } from "./ask-service";
import { buildAskResponse, feeCategoriesIn } from "./workspace/ask";
import { proseFeeName } from "./workspace/names";
import { asksWholeSchedule, type ScheduleOverview } from "./workspace/schedule";
import { asksIncome, asksIncomeWhy } from "./workspace/why";
import { liveCatalogReader, reconcileAnswer, type LiveReader } from "./answer-correctness";
import { QUALITY_QUESTIONS, scoreResponse, type QualityQuestion } from "./workspace/quality-bar";
import { regulatorSentence } from "./workspace/regulators";
import { isWireFact } from "./workspace/wire";
import { getFeeResearch } from "./workspace/research";
import { withDepth } from "./workspace/story-extras";
import { getPeerListRows, getPeerListSubject } from "@/lib/data-store/hamilton-peer-list";
import { parsePeerListQuestion, planPeerList, type PeerListRow } from "./peer-list";
import type { AskResponse, FeeResearch } from "./workspace/types";

/** The questions asked of every institution: one per kind of ask, across six fees. */
export const EVAL_QUESTION_IDS = ["q01", "q04", "q06", "q07", "q09", "q10", "q11", "q12", "q15", "q17", "q18", "q23", "q25", "q26", "q27", "q31", "q32"] as const;
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
  /** Form failures: the quality bar and the live-data checks. */
  failures: string[];
  /** Correctness failures (figures that do not tie to the live catalog); null when the answer could not be checked. */
  correctness?: string[] | null;
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
 * institution when that is on file, in the sentence the answer writes for it (with or without
 * its name); a question about "our state" names the state.
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
    // The answer names the institution in this sentence (regulatoryFacts passes its name); the
    // second-person form is the same sentence where no name is on hand. Either names the regulator.
    const named = regulatorSentence(regulators, institution.stateCode, institution.charterType, institution.name);
    const unnamed = regulatorSentence(regulators, institution.stateCode, institution.charterType);
    if (named && !text.includes(named) && !(unnamed && text.includes(unnamed))) failures.push(`does not name its regulator ("${named}")`);
  }
  if (STATE.has(item.id) && institution.stateCode) {
    const state = STATE_NAMES[institution.stateCode] ?? institution.stateCode;
    if (!text.includes(state)) failures.push(`does not name its state (${state})`);
  }
  return failures;
}

/**
 * A regulation answer lists the Regulatory Wire's recent rules, bills and enforcement for this
 * bank when the Wire holds any (#1090), and every Wire line it shows carries a date and a link.
 */
export function wireFailures(item: QualityQuestion, response: AskResponse, research: FeeResearch | null): string[] {
  if (!REGULATION.has(item.id) || !research) return [];
  const failures: string[] = [];
  const held = research.regulation.filter((f) => isWireFact(f) && f.source.table !== "reg_articles");
  const shown = (response.answer?.storyline?.watch ?? []).filter(isWireFact);
  if (held.length > 0 && !shown.some((f) => f.source.table !== "reg_articles")) {
    failures.push(`lists none of the ${held.length} recent rules, bills or enforcement actions the Regulatory Wire holds for it`);
  }
  for (const f of shown) {
    if (!f.source.url || !f.source.asOf) failures.push(`Regulatory Wire line without a date and link: "${f.text}"`);
  }
  return failures;
}

/** The one fee a response answers about, from the page it opens; null for a question asked back or saved. */
function answeredFee(response: AskResponse): string | null {
  return "feeCategory" in response.pageChange ? response.pageChange.feeCategory : null;
}

/**
 * An answer about a different subject from the question (#1077). A question that names fees is
 * answered for one of them; one that names none is answered for a fee only when it asked about
 * every fee or about fee income (the fee furthest from its median is then the detail). Any
 * other fee in the answer was put in the question's place, as overdraft once was.
 */
export function offSubjectFailure(question: string, response: AskResponse): string | null {
  const answered = answeredFee(response);
  if (!answered) return null;
  const named = feeCategoriesIn(question);
  if (named.length > 0) {
    return named.includes(answered) ? null : `answers a different subject: the ${proseFeeName(answered)} fee, not the fee asked about`;
  }
  if (asksWholeSchedule(question) || asksIncome(question) || asksIncomeWhy(question)) return null;
  return `answers a different subject: the ${proseFeeName(answered)} fee, which the question does not name`;
}

export interface Answered {
  response: AskResponse;
  research: FeeResearch | null;
  schedule: ScheduleOverview | null;
}

/** One question for one institution, through the Ask bar's engine path, with research cached per fee. */
export async function answer(institutionId: number, question: string, research: Map<string, Promise<FeeResearch | null>>): Promise<Answered> {
  const { intent, schedule, why } = await resolveAskIntent(institutionId, question, {});
  let found: FeeResearch | null = null;
  if (intent.feeCategory) {
    const key = `${intent.feeCategory}|${intent.segment ? JSON.stringify(intent.segment) : ""}`;
    if (!research.has(key)) research.set(key, getFeeResearch(institutionId, intent.feeCategory, new Date(), { segment: intent.segment }).catch(() => null));
    found = await research.get(key)!;
  }
  const built = buildAskResponse({ question, intent, research: found, memory: [] });
  return { response: withDepth(built, schedule, why, found?.provenance.dataAsOf.fees ?? null), research: found, schedule };
}

/** The answer's correctness failures against the live catalog; null when it could not be checked. */
async function correctnessOf(institutionId: number, question: string, answered: Answered, live: LiveReader): Promise<string[] | null> {
  const values = await live(institutionId, answered.research, answered.schedule).catch(() => null);
  const result = reconcileAnswer({ question, response: answered.response, research: answered.research, schedule: answered.schedule, live: values });
  return result.checked ? result.failures : null;
}

/** Everything one institution's questions fail on. */
export async function evaluateInstitution(institution: EvalInstitution, live: LiveReader = liveCatalogReader()): Promise<EvalResult[]> {
  const regulators = await getInstitutionRegulators(institution.id).catch(() => null);
  const research = new Map<string, Promise<FeeResearch | null>>();
  const out: EvalResult[] = [];
  for (const id of EVAL_QUESTION_IDS) {
    const item = QUALITY_QUESTIONS.find((q) => q.id === id)!;
    try {
      const answered = await answer(institution.id, item.question, research);
      const { response } = answered;
      const failures = [
        ...scoreResponse(item, response).failures,
        ...liveDataFailures(item, response, institution, regulators),
        ...wireFailures(item, response, answered.research),
      ];
      const correctness = await correctnessOf(institution.id, item.question, answered, live);
      out.push({ institutionId: institution.id, questionId: id, question: item.question, kind: response.kind, failures, correctness });
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

/**
 * Institutions an earlier eval run asked today. A run stops at its time budget, often before all
 * eleven groups (6 of 11 in run 7166), so the next run asks the rest first and the day's runs
 * together cover the whole sample (#1076).
 */
export async function institutionsAskedToday(db: SqlTag, day: string): Promise<Set<number>> {
  const rows = await db`
    SELECT e.detail->'institutionIds' AS ids
      FROM agent_run_events e
      JOIN agent_runs r ON r.id = e.agent_run_id
     WHERE r.params_json->>'source' = 'hamilton.answer_eval'
       AND e.event_type = 'step.finished'
       AND e.created_at >= (${day}::date::timestamp AT TIME ZONE 'UTC')
       AND e.created_at < ((${day}::date + 1)::timestamp AT TIME ZONE 'UTC')
  `;
  const asked = new Set<number>();
  for (const r of rows as unknown as Array<{ ids: unknown }>) {
    if (Array.isArray(r.ids)) for (const id of r.ids) if (Number.isFinite(Number(id))) asked.add(Number(id));
  }
  return asked;
}

/** The day's sample with the institutions no run has asked yet first, each part in its own order. */
export function unaskedFirst<T extends { id: number }>(institutions: T[], asked: Set<number>): T[] {
  return [...institutions.filter((i) => !asked.has(i.id)), ...institutions.filter((i) => asked.has(i.id))];
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
  /** Correctness failures; null when the answer could not be checked. */
  correctness?: string[] | null;
}

export interface PeerListReplayDeps {
  subject: typeof getPeerListSubject;
  rows: typeof getPeerListRows;
}

/**
 * A list question ("List institutions in Florida over $5B") as the Ask bar answers it: through the
 * peer list, never the fee engine, which would ask which fee (#977). Null when the question is not
 * a list, or needs the reader's saved group or account institution, which a replay does not have.
 */
export async function replayPeerList(
  institutionId: number,
  question: string,
  deps: PeerListReplayDeps = { subject: getPeerListSubject, rows: getPeerListRows },
): Promise<{ kind: "peer_list"; shortAnswer: string; failures: string[] } | null> {
  const intent = parsePeerListQuestion(question);
  if (!intent || intent.saved || intent.accountSubject || (intent.peerBased && !hasExplicitFilters(intent))) return null;
  if (intent.problems.length) return { kind: "peer_list", shortAnswer: intent.problems.join(" "), failures: ["peer list asks for criteria instead of listing"] };
  const asOf = new Date().toISOString().slice(0, 10);
  const subject = await deps.subject(institutionId, asOf);
  if (!subject) return { kind: "peer_list", shortAnswer: "", failures: ["peer list subject could not be loaded"] };
  const planned = planPeerList(intent, subject, null);
  if (!planned.criteria) return { kind: "peer_list", shortAnswer: planned.problem ?? "", failures: ["peer list asks for criteria instead of listing"] };
  const found = await deps.rows(subject.institutionId, planned.criteria, asOf);
  return {
    kind: "peer_list",
    shortAnswer: `${found.rows.length} of ${found.totalMatches} matching institutions for ${subject.name}.`,
    failures: peerListRowFailures(found.rows, planned.criteria.requiresAssets),
  };
}

function hasExplicitFilters(i: NonNullable<ReturnType<typeof parsePeerListQuestion>>): boolean {
  return Boolean(i.charterType || i.bothTypes || i.states.length || i.sameState || i.minAssets || i.maxAssets || i.similarSize || i.largest);
}

/** Every listed institution shows its assets with a filing date and source, and why it is listed. */
export function peerListRowFailures(rows: PeerListRow[], requiresAssets: boolean): string[] {
  const out: string[] = [];
  if (requiresAssets && rows.some((r) => r.totalAssetsUsd === null || !r.reportDate || !r.source)) out.push("listed institution without dated, sourced assets");
  if (rows.some((r) => !r.inclusionReason)) out.push("listed institution without a reason it is listed");
  return out;
}

/** One institution's real questions through today's engine, scored by the same quality bar. */
export async function evaluateProQuestions(institutionId: number, questions: ProQuestion[], live: LiveReader = liveCatalogReader()): Promise<ProQuestionResult[]> {
  const research = new Map<string, Promise<FeeResearch | null>>();
  const out: ProQuestionResult[] = [];
  for (const q of questions) {
    try {
      const listed = await replayPeerList(institutionId, q.question);
      if (listed) {
        out.push({ institutionId, question: q.question, askedAt: q.askedAt, ...listed });
        continue;
      }
      const answered = await answer(institutionId, q.question, research);
      const { response } = answered;
      const correctness = await correctnessOf(institutionId, q.question, answered, live);
      const offSubject = offSubjectFailure(q.question, response);
      const failures = [...(offSubject ? [offSubject] : []), ...scoreResponse({ id: "pro", question: q.question, intent: "a Pro reader's question" }, response).failures];
      out.push({ institutionId, question: q.question, askedAt: q.askedAt, kind: response.kind, shortAnswer: response.shortAnswer, failures, correctness });
    } catch (error) {
      out.push({ institutionId, question: q.question, askedAt: q.askedAt, kind: "error", shortAnswer: "", failures: [`error: ${error instanceof Error ? error.message : String(error)}`] });
    }
  }
  return out;
}

export interface ProReplaySummary {
  questions: number;
  /** Questions drawn for the replay; more than `questions` when the time budget ran out first. */
  planned?: number;
  passed: number;
  /** Questions Hamilton still answers with a question of its own. */
  askedBack: number;
  topFailures: Array<{ failure: string; count: number }>;
  /** Whether the figures tie to the live catalog (#1079); `passed` above is the form pass. */
  correctness: CorrectnessSummary;
  /** Every real question that falls short, so each becomes a fix. */
  failing: ProQuestionResult[];
}

export function summarizeProReplay(results: ProQuestionResult[]): ProReplaySummary {
  return {
    questions: results.length,
    passed: results.filter((r) => r.failures.length === 0).length,
    askedBack: results.filter((r) => r.kind === "clarifying_question").length,
    topFailures: groupFailures(results),
    correctness: summarizeCorrectness(results),
    failing: results.filter((r) => r.failures.length > 0 || (r.correctness?.length ?? 0) > 0),
  };
}

export interface CorrectnessSummary {
  /** Answers whose figures could be checked against the live catalog. */
  checked: number;
  /** Checked answers whose every fee figure ties to a live row. */
  correct: number;
  /** correct / checked; null when none could be checked. */
  rate: number | null;
  topFailures: Array<{ failure: string; count: number }>;
}

export function summarizeCorrectness(results: Array<{ correctness?: string[] | null }>): CorrectnessSummary {
  const checked = results.filter((r): r is { correctness: string[] } => Array.isArray(r.correctness));
  const correct = checked.filter((r) => r.correctness.length === 0).length;
  return {
    checked: checked.length,
    correct,
    rate: checked.length > 0 ? Math.round((correct / checked.length) * 10_000) / 10_000 : null,
    topFailures: groupFailures(checked.map((r) => ({ failures: r.correctness }))),
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
  /** The institutions asked, so a run can be checked against a named bank. */
  institutionIds?: number[];
  answers: number;
  passed: number;
  /** Failure text (institution-specific values stripped) with how many answers hit it, most first. */
  topFailures: Array<{ failure: string; count: number }>;
  /** Whether the figures tie to the live catalog (#1079); `passed` above is the form pass. */
  correctness: CorrectnessSummary;
  /** The path these answers came through: the free Ask engine. Paid paths are sampled by `paid-answer-eval.ts`. */
  path: "free_ask";
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
    correctness: summarizeCorrectness(results),
    path: "free_ask",
    byQuestion: [...byId.entries()].map(([questionId, q]) => ({ questionId, ...q })).sort((a, b) => a.passed / a.total - b.passed / b.total),
    failing: results.filter((r) => r.failures.length > 0 || (r.correctness?.length ?? 0) > 0).slice(0, 60),
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
  // One live read per fee for the whole run, shared by the Pro replay and the sampled institutions.
  const live = liveCatalogReader();
  const proQuestions = await pickProQuestions(db).catch(() => []);
  const byInstitution = new Map<number, ProQuestion[]>();
  for (const q of proQuestions) byInstitution.set(q.institutionId, [...(byInstitution.get(q.institutionId) ?? []), q]);
  // A batch starts only when the slowest batch so far still fits the budget: the route stops at
  // 300 seconds, and a step it stops is left running until the reaper re-queues it (runs 8960, 9168).
  let slowest = 0;
  let timedOut = false;
  const fits = () => Date.now() - started + slowest <= budgetMs;
  const timed = async <T>(work: () => Promise<T>): Promise<T> => {
    const t = Date.now();
    const out = await work();
    slowest = Math.max(slowest, Date.now() - t);
    return out;
  };
  const proResults: ProQuestionResult[] = [];
  const asked = [...byInstitution.entries()];
  for (let i = 0; i < asked.length; i += CONCURRENCY) {
    if (!fits()) {
      timedOut = true;
      break;
    }
    const batch = asked.slice(i, i + CONCURRENCY);
    for (const rows of await timed(() => Promise.all(batch.map(([id, qs]) => evaluateProQuestions(id, qs, live))))) proResults.push(...rows);
  }

  const day = now.toISOString().slice(0, 10);
  const askedToday = await institutionsAskedToday(db, day).catch(() => new Set<number>());
  const institutions = unaskedFirst(await pickEvalInstitutions(db, perGroup, day), askedToday);
  const results: EvalResult[] = [];
  let done = 0;
  // A few institutions at a time: each spends most of its time waiting on reads.
  for (let i = 0; i < institutions.length; i += CONCURRENCY) {
    if (!fits()) {
      timedOut = true;
      break;
    }
    const batch = institutions.slice(i, i + CONCURRENCY);
    for (const rows of await timed(() => Promise.all(batch.map((institution) => evaluateInstitution(institution, live))))) results.push(...rows);
    done += batch.length;
  }
  const summary = { ...summarizeEval(results, done, timedOut, institutions.length), institutionIds: institutions.slice(0, done).map((i) => i.id) };
  return proResults.length > 0 ? { ...summary, pro: { ...summarizeProReplay(proResults), planned: proQuestions.length } } : summary;
}
