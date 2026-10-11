/**
 * Server side of the Ask bar: resolves the institution, loads the fee's research and the
 * bank's memory, builds the answer (workspace/ask.ts) and logs the exchange to the
 * decision it belongs to. The answer itself is deterministic; only answerAskMemo calls the
 * model, to write over the storyline.
 */

import { recordProRequest } from "@/lib/agents/run-store";
import {
  addDecisionEvents,
  findOrOpenDecision,
  getDecision,
  getDecisionEvents,
  getMemoryFacts,
  saveMemoryFact,
  testedPrices,
  workspaceSchemaReady,
} from "@/lib/data-store/hamilton-workspace";
import { getSavedAnalysisResponse, insertSavedAnalysis, updateSavedAnalysisResponse } from "@/lib/data-store/hamilton-analyses";
import { normalizeCanonicalInstitutionId } from "./context-link";
import { buildFeeResearchEvidence } from "./evidence-contract";
import { writeStorylineMemo } from "./memo";
import { analysisFocusFor, analysisTitle, storylineAnalysis, withMemo } from "./workspace/analysis-record";
import { buildAskResponse, clarifyAgain, parseAsk, parseObjective, withSegmentDefault } from "./workspace/ask";
import { proseFeeName } from "./workspace/names";
import { getFeeResearch, getWorkspaceBriefing, type EnginePeerOptions } from "./workspace/research";
import { getActivePeerSet } from "./active-peer-set";
import { asksWholeSchedule, scheduleOverview, type ScheduleOverview } from "./workspace/schedule";
import { asksIncomeLevel, asksIncomeWhy, explainIncome, incomeSplit } from "./workspace/why";
import { withDepth, type IncomeWhy } from "./workspace/story-extras";
import { getServiceChargeIntensity, getServiceChargeIntensityTrend } from "@/lib/data-store/call-reports";
import { peerPhrase } from "./answer-brief";
import { resolveHamiltonInstitutionContext } from "./workspace-context";
import type { StorylineMemoResult } from "./workspace/storyline-types";
import { WORKSPACE_ENGINE_VERSION, type AskObjective, type AskResponse, type DecisionEventKind, type DecisionRecord, type FeeResearch, type MemoryFact } from "./workspace/types";

const OBJECTIVES: AskObjective[] = ["revenue", "customer_treatment", "competitive_position"];
const MAX_QUESTION_CHARS = 1_000;
const MAX_ANSWER_CHARS = 200;
/** Memory keys an answer may set. */
const FIELD_KEY = /^(fee\.[a-z0-9_]{2,60}\.(annual_items|annual_volume|waiver_rate|current_amount|tested_prices)|decision\.objective|ask\.fee_category)$/;

export interface AskBody {
  institutionId?: unknown;
  question?: unknown;
  objective?: unknown;
  decisionId?: unknown;
  answer?: unknown;
  /** Memo requests only: the saved analysis the Ask answer was filed as. */
  savedAnalysisId?: unknown;
}

export interface AskResult {
  status: number;
  body: AskResponse | { error: string };
}

interface Asker {
  id: number;
  display_name?: string | null;
  username?: string | null;
}

function actorOf(user: Asker): string {
  return `user:${user.id}`;
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text && text.length <= max ? text : null;
}

/** A number answer for a numeric key: "12,000" -> 12000, "8%" -> 8. Null when it is not a number. */
function numericAnswer(text: string): number | null {
  const n = Number(text.replace(/[,$%\s]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * A waiver rate is stored as a share (0.08), which scenarios use directly. "8%", "8" and "0.08"
 * all mean 8%; "1%" is 0.01, not 100%. Null above 100%.
 */
export function waiverShare(text: string): number | null {
  const n = numericAnswer(text);
  if (n === null) return null;
  const share = text.includes("%") || n > 1 ? n / 100 : n;
  return share <= 1 ? share : null;
}

const NUMERIC_KEYS = /\.(annual_items|annual_volume|waiver_rate|current_amount)$/;

function savedSentence(fieldKey: string, value: unknown): string {
  const fee = fieldKey.match(/^fee\.([a-z0-9_]+)\./)?.[1];
  const name = fee ? proseFeeName(fee) : "";
  const n = typeof value === "number" ? value : NaN;
  if (fieldKey.endsWith(".annual_items")) return `Saved: about ${n.toLocaleString("en-US")} ${name} items a year. Scenarios now use it.`;
  if (fieldKey.endsWith(".waiver_rate")) return `Saved: ${Math.round(n * 1000) / 10}% of ${name} fees waived or refunded. Scenarios now use it.`;
  if (fieldKey.endsWith(".current_amount")) return `Saved: you charge $${n} for one ${name} item.`;
  if (fieldKey.endsWith(".annual_volume")) return `Saved: your ${name} rate applied to about $${n.toLocaleString("en-US")} over the last 12 months.`;
  if (fieldKey === "decision.objective") return `Saved: weigh the options for ${String(value).replace(/_/g, " ")}.`;
  return "Saved.";
}

async function logEvents(
  decision: DecisionRecord | null,
  events: { kind: DecisionEventKind; detail: Record<string, unknown> }[],
  actor: string,
  moveToModeling: boolean,
): Promise<void> {
  if (!decision) return;
  await addDecisionEvents(
    decision.id,
    events.map((e) => ({ ...e, actor })),
    moveToModeling && decision.status === "researching" ? "modeling" : undefined,
  ).catch((error) => console.error("[hamilton-ask] decision log failed", { decisionId: decision.id, error }));
}

/**
 * Files a storyline answer as a saved analysis, so every Ask lands in the reader's history
 * and can go into a report once, whichever screen asked it. Null when there is no storyline
 * or the save fails; the answer is still returned.
 */
async function fileAnalysis(
  userId: number,
  institutionId: string | number,
  question: string,
  response: AskResponse,
  research: FeeResearch | null,
): Promise<string | null> {
  const storyline = response.answer?.storyline;
  const canonical = normalizeCanonicalInstitutionId(institutionId);
  if (!storyline || !canonical) return null;
  try {
    return await insertSavedAnalysis({
      userId,
      institutionId: canonical,
      title: analysisTitle(storyline),
      analysisFocus: analysisFocusFor(storyline),
      prompt: question,
      response: storylineAnalysis(
        storyline,
        WORKSPACE_ENGINE_VERSION,
        research ? buildFeeResearchEvidence(research) : null,
      ),
    });
  } catch (error) {
    console.error("[hamilton-ask] saving the analysis failed", { institutionId: canonical, error });
    return null;
  }
}

export async function answerAsk(user: Asker, body: AskBody): Promise<AskResult> {
  const resolved = await resolveHamiltonInstitutionContext({
    userId: user.id,
    instId: typeof body.institutionId === "number" || typeof body.institutionId === "string" ? body.institutionId : null,
    persistUrlSelection: false,
  });
  const institution = resolved.institution;
  if (!institution) return { status: 400, body: { error: resolved.error ?? "Choose an institution first." } };
  const institutionId = Number(institution.id);
  // The peer group the bank picked in Settings leads every comparison in the answer.
  const peers: EnginePeerOptions = { peerSet: await getActivePeerSet({ userId: user.id, institutionId }).catch(() => null) };
  const actor = actorOf(user);
  const ready = await workspaceSchemaReady();
  const objective = OBJECTIVES.includes(body.objective as AskObjective) ? (body.objective as AskObjective) : null;
  let decision =
    ready && typeof body.decisionId === "string" ? await getDecision(user.id, body.decisionId).catch(() => null) : null;
  if (decision && decision.institutionId !== institutionId) decision = null;

  let question = cleanText(body.question, MAX_QUESTION_CHARS);
  let fallbackFee = decision?.feeCategory ?? null;
  let effectiveObjective = objective;

  // An answer to Hamilton's own question: save it, or turn it back into a question.
  if (body.answer && typeof body.answer === "object") {
    const { fieldKey, value } = body.answer as { fieldKey?: unknown; value?: unknown };
    const text = cleanText(value, MAX_ANSWER_CHARS);
    if (typeof fieldKey !== "string" || !FIELD_KEY.test(fieldKey) || text === null) {
      return { status: 400, body: { error: "That answer could not be read." } };
    }
    if (fieldKey === "ask.fee_category") {
      question = text;
    } else if (fieldKey.endsWith(".tested_prices")) {
      question = text;
      fallbackFee = fieldKey.split(".")[1];
    } else {
      const parsed = fieldKey === "decision.objective" ? parseObjective(text) : fieldKey.endsWith(".waiver_rate") ? waiverShare(text) : NUMERIC_KEYS.test(fieldKey) ? numericAnswer(text) : text;
      if (parsed === null) return { status: 200, body: { ...clarifyAgain(fieldKey), decisionId: decision?.id } };
      let saved: MemoryFact | null = null;
      if (ready) {
        saved = await saveMemoryFact({ userId: user.id, institutionId, fieldKey, value: parsed, givenBy: user.display_name || user.username || actor, source: "answer" });
        await logEvents(decision, [{ kind: "answer_given", detail: { fieldKey, value: parsed, factId: saved.id } }], actor, false);
      }
      const response: AskResponse = {
        kind: "saved_fact",
        shortAnswer: ready ? savedSentence(fieldKey, parsed) : "Hamilton could not save that just now. Please try again in a few minutes.",
        pageChange: fieldKey === "decision.objective" ? { screen: "none" } : { screen: "data", fieldKey },
        ...(saved ? { savedFact: saved } : {}),
        ...(decision ? { decisionId: decision.id } : {}),
      };
      await recordProRequest({
        operation: "ask",
        title: "Hamilton ask: answer saved",
        status: ready ? "completed" : "failed",
        summary: ready ? `Saved ${fieldKey} for institution ${institutionId}.` : "Workspace tables missing; answer not saved.",
        userId: user.id,
        institutionId,
        detail: { field_key: fieldKey, decision_id: decision?.id ?? null },
      });
      return { status: 200, body: response };
    }
  }

  if (!question) return { status: 400, body: { error: "Ask a question." } };
  let intent = parseAsk(question, fallbackFee);
  // "Where do we stand on every fee?" is answered outright: an overview of every fee,
  // then the fee furthest from its peer median in detail.
  const schedule = !intent.feeCategory ? await scheduleFor(institutionId, question, peers) : null;
  if (schedule?.top) intent = { ...intent, feeCategory: schedule.top };
  // "Why is our fee income lower than peers?" leads with what price explains of the gap, then
  // answers in full for the fee furthest from its median when the question named none.
  const why = await incomeWhyFor(institutionId, question, peers);
  if (!intent.feeCategory && why?.top) intent = { ...intent, feeCategory: why.top };
  intent = withSegmentDefault(intent);
  const research = intent.feeCategory ? await getFeeResearch(institutionId, intent.feeCategory, new Date(), { segment: intent.segment, ...peers }) : null;
  if (intent.feeCategory && !research) return { status: 404, body: { error: "That institution could not be loaded." } };

  const memory = ready ? await getMemoryFacts(user.id, institutionId).catch(() => []) : [];
  if (!effectiveObjective && intent.wantsOpinion) {
    // An objective the reader gave before still holds until they give another.
    const remembered = memory.find((f) => f.fieldKey === "decision.objective")?.value;
    if (OBJECTIVES.includes(remembered as AskObjective)) effectiveObjective = remembered as AskObjective;
  }
  if (ready && intent.feeCategory && !decision) {
    decision = (
      await findOrOpenDecision({
        userId: user.id,
        institutionId,
        feeCategory: intent.feeCategory,
        title: `${proseFeeName(intent.feeCategory)[0].toUpperCase()}${proseFeeName(intent.feeCategory).slice(1)} fee`,
        actor,
      }).catch((error) => {
        console.error("[hamilton-ask] decision open failed", error);
        return null;
      })
    )?.decision ?? null;
  }
  const priorTested = decision ? testedPrices(await getDecisionEvents(decision.id).catch(() => [])) : [];

  const built = buildAskResponse({ question, intent, research, memory, objective: effectiveObjective, priorTested });
  const response = withDepth(built, schedule, why, research?.provenance.dataAsOf.fees ?? null);
  const savedAnalysisId = await fileAnalysis(user.id, institution.id, question, response, research);
  const shown = response.scenario;
  const scenarioEvents =
    response.kind === "scenario"
      ? intent.tested.map((tested) => ({
          kind: "scenario_tested" as const,
          detail:
            shown && shown.tested === tested
              ? {
                  tested,
                  current: shown.current,
                  evidenceLevel: shown.evidenceLevel,
                  revenueEffect: shown.revenueEffect,
                  positionAfter: shown.positionAfter,
                  provenance: shown.provenance,
                }
              : { tested, current: shown?.current ?? null },
        }))
      : [];
  await logEvents(
    decision,
    [
      {
        kind: "question_asked",
        detail: {
          question,
          responseKind: response.kind,
          shortAnswer: response.shortAnswer,
          ...(response.opinion ? { opinion: response.opinion } : {}),
          ...(response.answer ? { provenance: response.answer.provenance } : {}),
        },
      },
      ...scenarioEvents,
    ],
    actor,
    response.kind === "scenario",
  );
  await recordProRequest({
    operation: "ask",
    title: `Hamilton ask: ${intent.feeCategory ?? "no fee named"}`,
    status: "completed",
    summary: `Answered with ${response.kind.replace(/_/g, " ")}.`,
    userId: user.id,
    institutionId,
    // The question and Hamilton's short answer are kept (in our own database) so the answer eval
    // can replay real Pro questions, above all the ones Hamilton asked back on instead of answering.
    detail: {
      question,
      short_answer: response.shortAnswer,
      engine_version: WORKSPACE_ENGINE_VERSION,
      response_kind: response.kind,
      fee_category: intent.feeCategory,
      segment: intent.segment?.label ?? null,
      segment_members: research?.segment?.members.length ?? null,
      decision_id: decision?.id ?? null,
      saved_analysis_id: savedAnalysisId,
    },
  });
  return {
    status: 200,
    body: { ...response, ...(decision ? { decisionId: decision.id } : {}), ...(savedAnalysisId ? { savedAnalysisId } : {}) },
  };
}

/** The whole-schedule overview for a question about every fee, or null for any other question. */
export async function scheduleFor(institutionId: number, question: string, peers: EnginePeerOptions): Promise<ScheduleOverview | null> {
  if (!asksWholeSchedule(question)) return null;
  const briefing = await getWorkspaceBriefing(institutionId, new Date(), peers).catch((error) => {
    console.error("[hamilton-ask] briefing failed", error);
    return null;
  });
  return briefing ? scheduleOverview(briefing.positions) : null;
}

/** The price split of the bank's fee income gap, for a question asking why income is where it is. */
export async function incomeWhyFor(institutionId: number, question: string, peers: EnginePeerOptions): Promise<IncomeWhy | null> {
  // A why question, or one asking where income stands that names no single fee.
  if (!asksIncomeWhy(question) && !(asksIncomeLevel(question) && !parseAsk(question).feeCategory)) return null;
  const [intensity, briefing, trend] = await Promise.all([
    getServiceChargeIntensity(institutionId).catch((error) => {
      console.error("[hamilton-ask] income intensity failed", error);
      return null;
    }),
    getWorkspaceBriefing(institutionId, new Date(), peers).catch((error) => {
      console.error("[hamilton-ask] briefing failed", error);
      return null;
    }),
    getServiceChargeIntensityTrend(institutionId).catch((error) => {
      console.error("[hamilton-ask] income trend failed", error);
      return [];
    }),
  ]);
  if (!intensity || !briefing) return null;
  const split = incomeSplit(intensity, briefing.positions, peerPhrase(intensity.charterType, intensity.assetTier));
  return split ? { split, explained: explainIncome(split), top: scheduleOverview(briefing.positions).top, trend } : null;
}

export interface AskMemoResult {
  status: number;
  body: StorylineMemoResult | { error: string };
}

/**
 * The written memo for an Ask: rebuilds the same deterministic storyline the Ask bar
 * returned (from the institution, the question and the reader's memory, never from the
 * browser) and has Hamilton write over it. Logged to the run ledger; nothing is saved.
 */
export async function answerAskMemo(user: Asker, body: AskBody): Promise<AskMemoResult> {
  const resolved = await resolveHamiltonInstitutionContext({
    userId: user.id,
    instId: typeof body.institutionId === "number" || typeof body.institutionId === "string" ? body.institutionId : null,
    persistUrlSelection: false,
  });
  const institution = resolved.institution;
  if (!institution) return { status: 400, body: { error: resolved.error ?? "Choose an institution first." } };
  const institutionId = Number(institution.id);
  // The peer group the bank picked in Settings leads every comparison in the answer.
  const peers: EnginePeerOptions = { peerSet: await getActivePeerSet({ userId: user.id, institutionId }).catch(() => null) };
  const question = cleanText(body.question, MAX_QUESTION_CHARS);
  if (!question) return { status: 400, body: { error: "Ask a question." } };
  const ready = await workspaceSchemaReady();
  const decision = ready && typeof body.decisionId === "string" ? await getDecision(user.id, body.decisionId).catch(() => null) : null;
  let intent = parseAsk(question, decision && decision.institutionId === institutionId ? decision.feeCategory : null);
  const schedule = !intent.feeCategory ? await scheduleFor(institutionId, question, peers) : null;
  if (schedule?.top) intent = { ...intent, feeCategory: schedule.top };
  const why = await incomeWhyFor(institutionId, question, peers);
  if (!intent.feeCategory && why?.top) intent = { ...intent, feeCategory: why.top };
  intent = withSegmentDefault(intent);
  if (!intent.feeCategory) return { status: 200, body: { status: "unavailable", reason: "Name a fee and Hamilton will write it up." } };
  const research = await getFeeResearch(institutionId, intent.feeCategory, new Date(), { segment: intent.segment, ...peers });
  if (!research) return { status: 404, body: { error: "That institution could not be loaded." } };
  const memory = ready ? await getMemoryFacts(user.id, institutionId).catch(() => []) : [];
  const objective = OBJECTIVES.includes(body.objective as AskObjective) ? (body.objective as AskObjective) : null;
  // The same storyline the Ask returned, overview and income split included.
  const response = withDepth(buildAskResponse({ question, intent, research, memory, objective }), schedule, why, research.provenance.dataAsOf.fees ?? null);
  const storyline = response.answer?.storyline;
  if (!storyline) return { status: 200, body: { status: "unavailable", reason: "There is no storyline to write up for this question." } };

  const factEvidence = buildFeeResearchEvidence(research);
  const result = await writeStorylineMemo(storyline, question, { institutionId, factEvidence });
  let memoSaved = false;
  const savedId = typeof body.savedAnalysisId === "string" ? body.savedAnalysisId : null;
  if (result.status === "written" && savedId) {
    try {
      const saved = await getSavedAnalysisResponse(user.id, savedId);
      if (saved) memoSaved = await updateSavedAnalysisResponse(user.id, savedId, withMemo(saved, result.memo));
    } catch (error) {
      console.error("[hamilton-ask-memo] saving the memo failed", { savedId, error });
    }
  }
  await recordProRequest({
    operation: "ask_memo",
    title: `Hamilton memo: ${intent.feeCategory}`,
    status: result.status === "written" ? "completed" : result.status === "withheld" ? "completed" : "failed",
    summary:
      result.status === "written"
        ? `Memo written; ${result.memo.figureCheck.checked} figures numerically checked and ${result.memo.evidenceFactIds?.length ?? 0} structured evidence records referenced.`
        : `Memo ${result.status}: ${result.reason}`,
    userId: user.id,
    institutionId,
    detail: {
      fee_category: intent.feeCategory,
      storyline_kind: storyline.kind,
      memo_status: result.status,
      figures_checked: result.status === "written" ? result.memo.figureCheck.checked : null,
      model: result.status === "written" ? result.memo.model : null,
      saved_analysis_id: savedId,
      memo_saved: memoSaved,
      withheld_problems: result.status === "withheld" ? (result.problems ?? []) : null,
    },
  });
  return { status: 200, body: result.status === "withheld" ? { status: "withheld", reason: result.reason } : result };
}
