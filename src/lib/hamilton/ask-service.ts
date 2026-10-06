/**
 * Server side of the Ask bar: resolves the institution, loads the fee's research and the
 * bank's memory, builds the answer (workspace/ask.ts) and logs the exchange to the
 * decision it belongs to. Deterministic: no provider calls.
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
import { buildAskResponse, clarifyAgain, parseAsk, parseObjective } from "./workspace/ask";
import { proseFeeName } from "./workspace/names";
import { getFeeResearch } from "./workspace/research";
import { resolveHamiltonInstitutionContext } from "./workspace-context";
import type { AskObjective, AskResponse, DecisionEventKind, DecisionRecord, MemoryFact } from "./workspace/types";

const OBJECTIVES: AskObjective[] = ["revenue", "customer_treatment", "competitive_position"];
const MAX_QUESTION_CHARS = 1_000;
const MAX_ANSWER_CHARS = 200;
/** Memory keys an answer may set. */
const FIELD_KEY = /^(fee\.[a-z0-9_]{2,60}\.(annual_items|waiver_rate|current_amount|tested_prices)|decision\.objective|ask\.fee_category)$/;

export interface AskBody {
  institutionId?: unknown;
  question?: unknown;
  objective?: unknown;
  decisionId?: unknown;
  answer?: unknown;
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

const NUMERIC_KEYS = /\.(annual_items|waiver_rate|current_amount)$/;

function savedSentence(fieldKey: string, value: unknown): string {
  const fee = fieldKey.match(/^fee\.([a-z0-9_]+)\./)?.[1];
  const name = fee ? proseFeeName(fee) : "";
  const n = typeof value === "number" ? value : NaN;
  if (fieldKey.endsWith(".annual_items")) return `Saved: about ${n.toLocaleString("en-US")} ${name} items a year. Scenarios now use it.`;
  if (fieldKey.endsWith(".waiver_rate")) return `Saved: ${n > 1 ? n : Math.round(n * 1000) / 10}% of ${name} fees waived or refunded. Scenarios now use it.`;
  if (fieldKey.endsWith(".current_amount")) return `Saved: you charge $${n} for one ${name} item.`;
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

export async function answerAsk(user: Asker, body: AskBody): Promise<AskResult> {
  const resolved = await resolveHamiltonInstitutionContext({
    userId: user.id,
    instId: typeof body.institutionId === "number" || typeof body.institutionId === "string" ? body.institutionId : null,
    persistUrlSelection: false,
  });
  const institution = resolved.institution;
  if (!institution) return { status: 400, body: { error: resolved.error ?? "Choose an institution first." } };
  const institutionId = Number(institution.id);
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
      const parsed = fieldKey === "decision.objective" ? parseObjective(text) : NUMERIC_KEYS.test(fieldKey) ? numericAnswer(text) : text;
      if (parsed === null) return { status: 200, body: { ...clarifyAgain(fieldKey), decisionId: decision?.id } };
      let saved: MemoryFact | null = null;
      if (ready) {
        saved = await saveMemoryFact({ userId: user.id, institutionId, fieldKey, value: parsed, givenBy: user.display_name || user.username || actor, source: "answer" });
        await logEvents(decision, [{ kind: "answer_given", detail: { fieldKey, value: parsed, factId: saved.id } }], actor, false);
      }
      const response: AskResponse = {
        kind: "saved_fact",
        shortAnswer: ready ? savedSentence(fieldKey, parsed) : "Hamilton could not save that yet; the workspace tables are not set up.",
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
  const intent = parseAsk(question, fallbackFee);
  const research = intent.feeCategory ? await getFeeResearch(institutionId, intent.feeCategory) : null;
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

  const response = buildAskResponse({ question, intent, research, memory, objective: effectiveObjective, priorTested });
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
    detail: { response_kind: response.kind, fee_category: intent.feeCategory, decision_id: decision?.id ?? null },
  });
  return { status: 200, body: { ...response, ...(decision ? { decisionId: decision.id } : {}) } };
}
