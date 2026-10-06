/**
 * Decisions after research: list them with the ledger, open one with its log and watch
 * state, record the option management chose (with its implementation plan and watches),
 * and move it through implementing, monitoring and closed. Deterministic: no provider calls.
 *
 * Hamilton never chooses the option. `choose` records the amount the reader names.
 */

import { recordProRequest } from "@/lib/agents/run-store";
import {
  addDecisionEvents,
  getDecision,
  getDecisionEvents,
  getEventsFor,
  getMemoryFacts,
  listDecisions,
  recordChoice,
  workspaceSchemaReady,
} from "@/lib/data-store/hamilton-workspace";
import { getInstitutionById } from "@/lib/data-store/core";
import { institutionFactsFrom, scenariosFor } from "./workspace/ask";
import { buildLedger, defaultWatches, evaluateWatches, type Ledger } from "./workspace/decisions";
import { buildImplementationPlan } from "./workspace/implementation";
import { getFeeResearch } from "./workspace/research";
import { resolveHamiltonInstitutionContext } from "./workspace-context";
import type { DecisionEvent, DecisionRecord, DecisionStatus, ImplementationPlan, Scenario } from "./workspace/types";
import type { WatchState } from "./workspace/decisions";

interface Person {
  id: number;
  display_name?: string | null;
  username?: string | null;
}

export interface ServiceResult<T> {
  status: number;
  body: T | { error: string };
}

const MOVES: Record<DecisionStatus, DecisionStatus[]> = {
  researching: ["modeling", "closed"],
  modeling: ["researching", "closed"],
  decided: ["implementing", "closed"],
  implementing: ["monitoring", "closed"],
  monitoring: ["closed", "researching"],
  closed: ["researching"],
};

function nameOf(user: Person): string {
  return user.display_name || user.username || `user:${user.id}`;
}

/** Decisions for the selected institution, newest first, with the ledger summed over them. */
export async function decisionsOverview(
  user: Person,
  instId: unknown,
): Promise<ServiceResult<{ decisions: DecisionRecord[]; ledger: Ledger }>> {
  const resolved = await resolveHamiltonInstitutionContext({
    userId: user.id,
    instId: typeof instId === "string" || typeof instId === "number" ? instId : null,
    persistUrlSelection: false,
  });
  if (!resolved.institution) return { status: 400, body: { error: resolved.error ?? "Choose an institution first." } };
  if (!(await workspaceSchemaReady())) return { status: 200, body: { decisions: [], ledger: buildLedger([], new Map()) } };
  const decisions = await listDecisions(user.id, Number(resolved.institution.id));
  const events = await getEventsFor(decisions.map((d) => d.id));
  return { status: 200, body: { decisions, ledger: buildLedger(decisions, events) } };
}

/**
 * One decision with its log and the state of its watches. A watch that has tripped since
 * the decision was made is logged once (watch_tripped), which puts the decision back in
 * front of the reader.
 */
export async function decisionDetail(
  user: Person,
  decisionId: string,
): Promise<ServiceResult<{ decision: DecisionRecord; events: DecisionEvent[]; watches: WatchState[] }>> {
  if (!(await workspaceSchemaReady())) return { status: 503, body: { error: "Decisions are not set up yet." } };
  const decision = await getDecision(user.id, decisionId);
  if (!decision) return { status: 404, body: { error: "That decision was not found." } };
  let events = await getDecisionEvents(decision.id);
  let watches: WatchState[] = [];
  if (decision.feeCategory && decision.watchConditions.length > 0 && decision.status !== "closed") {
    const research = await getFeeResearch(decision.institutionId, decision.feeCategory);
    const chosenAt = [...events].reverse().find((e) => e.kind === "option_chosen")?.at ?? decision.updatedAt;
    if (research) watches = evaluateWatches(decision.watchConditions, research, chosenAt);
    const logged = new Set(events.filter((e) => e.kind === "watch_tripped").map((e) => String(e.detail.label)));
    const fresh = watches.filter((w) => w.tripped && !logged.has(w.condition.label));
    if (fresh.length > 0) {
      await addDecisionEvents(
        decision.id,
        fresh.map((w) => ({ kind: "watch_tripped" as const, detail: { label: w.condition.label, evidence: w.evidence }, actor: "hamilton" })),
      );
      events = await getDecisionEvents(decision.id);
    }
  }
  return { status: 200, body: { decision, events, watches } };
}

/** Records the amount management chose, builds its implementation plan and sets its watches. */
export async function chooseOption(
  user: Person,
  decisionId: string,
  amount: unknown,
  decidedOn: unknown,
): Promise<ServiceResult<{ decision: DecisionRecord; scenario: Scenario; plan: ImplementationPlan }>> {
  const chosen = typeof amount === "number" ? amount : Number(amount);
  if (!Number.isFinite(chosen) || chosen < 0 || chosen > 10_000) return { status: 400, body: { error: "Name the amount management chose." } };
  if (!(await workspaceSchemaReady())) return { status: 503, body: { error: "Decisions are not set up yet." } };
  const decision = await getDecision(user.id, decisionId);
  if (!decision?.feeCategory) return { status: 404, body: { error: "That decision was not found." } };
  const [research, institution, memory] = await Promise.all([
    getFeeResearch(decision.institutionId, decision.feeCategory),
    getInstitutionById(decision.institutionId),
    getMemoryFacts(user.id, decision.institutionId),
  ]);
  if (!research || !institution) return { status: 404, body: { error: "That institution could not be loaded." } };
  const stated = memory.find((f) => f.fieldKey === `fee.${decision.feeCategory}.current_amount`);
  const current = research.current ?? (stated ? Number(stated.value) : null);
  if (current === null || !Number.isFinite(current)) return { status: 409, body: { error: "Hamilton needs your current fee first." } };

  const [scenario] = scenariosFor(research, current, [chosen], institutionFactsFrom(memory, decision.feeCategory));
  const on = typeof decidedOn === "string" && /^\d{4}-\d{2}-\d{2}$/.test(decidedOn) ? decidedOn : new Date().toISOString().slice(0, 10);
  const plan = buildImplementationPlan({
    feeCategory: decision.feeCategory,
    current,
    chosen,
    decidedOn: on,
    charterType: institution.charter_type === "credit_union" ? "credit_union" : "bank",
  });
  const watches = defaultWatches(research);
  const by = nameOf(user);
  await recordChoice({
    decisionId: decision.id,
    amount: chosen,
    chosenBy: by,
    watches,
    actor: `user:${user.id}`,
    events: [
      {
        kind: "option_chosen",
        detail: {
          amount: chosen,
          current,
          chosenBy: by,
          evidenceLevel: scenario.evidenceLevel,
          revenueEffect: scenario.revenueEffect,
          positionAfter: scenario.positionAfter,
          provenance: scenario.provenance,
        },
      },
      { kind: "plan_created", detail: { plan } },
    ],
  });
  await recordProRequest({
    operation: "decision",
    title: `Hamilton decision: ${decision.title}`,
    status: "completed",
    summary: `Recorded the option management chose and its implementation plan (${plan.noticeRequiredDays} days' notice).`,
    userId: user.id,
    institutionId: decision.institutionId,
    detail: { decision_id: decision.id, evidence_level: scenario.evidenceLevel },
  });
  const updated = (await getDecision(user.id, decision.id)) ?? decision;
  return { status: 200, body: { decision: updated, scenario, plan } };
}

/** Moves a decision along (implementing, monitoring, closed, or back to researching). */
export async function moveDecision(user: Person, decisionId: string, status: unknown): Promise<ServiceResult<{ decision: DecisionRecord }>> {
  if (!(await workspaceSchemaReady())) return { status: 503, body: { error: "Decisions are not set up yet." } };
  const decision = await getDecision(user.id, decisionId);
  if (!decision) return { status: 404, body: { error: "That decision was not found." } };
  const next = status as DecisionStatus;
  if (!MOVES[decision.status]?.includes(next)) {
    return { status: 409, body: { error: `A ${decision.status} decision cannot move to ${String(status)}.` } };
  }
  await addDecisionEvents(decision.id, [{ kind: "status_changed", detail: { from: decision.status, to: next }, actor: `user:${user.id}` }], next);
  return { status: 200, body: { decision: (await getDecision(user.id, decision.id)) ?? decision } };
}
