/**
 * Decisions after research: list them with the ledger and turn them into deliverables.
 * Deterministic: no provider calls. Hamilton never chooses an option; recording a chosen
 * option and its watches was built but never reachable, and was removed (#1083).
 */

import { recordProRequest } from "@/lib/agents/run-store";
import { addDecisionEvents, getDecision, getEventsFor, listDecisions, workspaceSchemaReady } from "@/lib/data-store/hamilton-workspace";
import { buildLedger, type Ledger } from "./workspace/decisions";
import { buildDeliverable, type Deliverable } from "./workspace/deliverables";
import { getFeeResearch } from "./workspace/research";
import { getActivePeerSet } from "./active-peer-set";
import { resolveHamiltonInstitutionContext } from "./workspace-context";
import type { DecisionRecord, DeliverableKind } from "./workspace/types";

interface Person {
  id: number;
  display_name?: string | null;
  username?: string | null;
}

export interface ServiceResult<T> {
  status: number;
  body: T | { error: string };
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
  if (!(await workspaceSchemaReady())) return { status: 200, body: { decisions: [], ledger: buildLedger([]) } };
  const decisions = await listDecisions(user.id, Number(resolved.institution.id));
  return { status: 200, body: { decisions, ledger: buildLedger(decisions) } };
}

const DELIVERABLE_KINDS: DeliverableKind[] = [
  "ceo_onepager",
  "board_memo",
  "pricing_packet",
  "competitive_appendix",
  "regulatory_summary",
];
const MAX_DECISIONS_PER_DELIVERABLE = 10;

/** "Turn this into": builds a deliverable from the reader's decisions and logs it on each. */
export async function makeDeliverable(user: Person, kind: unknown, decisionIds: unknown): Promise<ServiceResult<Deliverable>> {
  if (!DELIVERABLE_KINDS.includes(kind as DeliverableKind)) return { status: 400, body: { error: "Pick a deliverable." } };
  const ids = Array.isArray(decisionIds) ? [...new Set(decisionIds.filter((d): d is string => typeof d === "string"))] : [];
  if (ids.length === 0 || ids.length > MAX_DECISIONS_PER_DELIVERABLE) return { status: 400, body: { error: "Pick between one and ten decisions." } };
  if (!(await workspaceSchemaReady())) return { status: 503, body: { error: "Decisions are not set up yet." } };
  const decisions = (await Promise.all(ids.map((id) => getDecision(user.id, id)))).filter((d): d is DecisionRecord => Boolean(d?.feeCategory));
  if (decisions.length !== ids.length) return { status: 404, body: { error: "One of those decisions was not found." } };
  if (new Set(decisions.map((d) => d.institutionId)).size > 1) return { status: 400, body: { error: "Pick decisions for one institution." } };
  const events = await getEventsFor(ids);
  const inputs = [];
  // One institution, so one saved peer set: the deliverable compares against the same group as
  // every other screen (#1893). A failed read falls back to the default group.
  const peerSet = await getActivePeerSet({ userId: user.id, institutionId: decisions[0].institutionId }).catch(() => null);
  for (const decision of decisions) {
    const research = await getFeeResearch(decision.institutionId, decision.feeCategory as string, new Date(), { peerSet });
    if (!research) return { status: 404, body: { error: "That institution could not be loaded." } };
    inputs.push({ decision, events: events.get(decision.id) ?? [], research });
  }
  const deliverable = buildDeliverable(kind as DeliverableKind, inputs);
  for (const decision of decisions) {
    await addDecisionEvents(decision.id, [{ kind: "deliverable_made", detail: { kind, decisionIds: ids }, actor: `user:${user.id}` }]);
  }
  await recordProRequest({
    operation: "decision",
    title: `Hamilton deliverable: ${deliverable.title}`,
    status: "completed",
    summary: `Built a ${String(kind).replace(/_/g, " ")} from ${ids.length} ${ids.length === 1 ? "decision" : "decisions"}.`,
    userId: user.id,
    institutionId: decisions[0].institutionId,
    detail: { kind, decision_ids: ids },
  });
  return { status: 200, body: deliverable };
}
