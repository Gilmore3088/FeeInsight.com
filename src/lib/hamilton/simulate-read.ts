/**
 * Hamilton's read of one tested price (the Simulate screen's prose). The prompt is built here so
 * the live route (`/api/hamilton/simulate`, streamed) and the paid answer eval (#1079, buffered)
 * write from the same words, and the eval scores the same answer a reader gets.
 *
 * The route's streamed text has no gate of its own; the eval checks it with the shared evidence
 * gate (`checkAnswerEvidence`): every figure traces to the numbers the model was given, and no line
 * tells the bank what to do. Server only for `writeSimulateRead`.
 */

import { withRawProviderResponseOperation } from "@/lib/ai-response-budget";

import { getAnthropicMessagesClient, extractAnthropicText, getHamiltonModel, hasAnthropicApiKey, isProviderLimitError } from "@/lib/ai-provider";
import { trackAnthropicRequest, assertCompletedAnthropicTextResponse, incompleteProviderResponse } from "@/lib/ai-provider-usage";
import { checkAnswerEvidence, type AnswerEvidenceCheck } from "./answer-gate";
import type { MemoClient, MemoTracking } from "./memo";
import { HAMILTON_PAUSED_MESSAGE } from "./provider-paused";
import { HAMILTON_SYSTEM_PROMPT } from "./voice";
import { shadowGate, type GateShadowRecord, type ShadowPath, type TodayDecision } from "./output-gate-shadow";
import { enforcedOutcome, enforcedProblems, isAnswerGateEnforced, tryGateAnswer } from "./output-gate-enforce";
import type { GateInput } from "./output-gate";

export const SIMULATE_ROUTE_ID = "api.hamilton.simulate";
/** The live route's output cap; thinking counts toward it. */
export const SIMULATE_MAX_TOKENS = 4000;
const REQUEST_TIMEOUT_MS = 90_000;

export interface SimulateInput {
  feeCategory: string;
  currentFee: number;
  proposedFee: number;
  distribution: {
    p25_amount: number | null;
    median_amount: number | null;
    p75_amount: number | null;
    institution_count: number;
    peer_label?: string | null;
  };
  institution?: { institution_name: string; charter_type?: string | null; asset_size_tier?: string | null } | null;
}

export interface SimulatePrompts {
  system: string;
  user: string;
  /** Every number the model is given, for the evidence gate. */
  data: Record<string, number | null>;
}

export function simulatePrompts(input: SimulateInput): SimulatePrompts {
  const { feeCategory, currentFee, proposedFee, distribution, institution } = input;
  const { median_amount, p25_amount, p75_amount } = distribution;
  const institutionCount = distribution.institution_count;
  const peerLabel = distribution.peer_label || "verified peer baseline";
  // The tested price is the reader's to try, never a proposal: say only where it sits against the current fee.
  const changeDollars = Math.abs(proposedFee - currentFee).toFixed(2);
  const againstCurrent =
    proposedFee > currentFee
      ? `$${changeDollars} above the current fee`
      : proposedFee < currentFee
      ? `$${changeDollars} below the current fee`
      : "the same as the current fee";
  const displayCategory = feeCategory.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());

  // Hamilton's shared voice carries the no-advice rule (voice.ts); this answer adds only its format.
  const system = `${HAMILTON_SYSTEM_PROMPT}

THIS ANSWER: a short read of one price the user is testing.
- Plain prose, 3 to 4 sentences, no headers, bullets or lists.
- Say where the tested price sits against the peer 25th percentile, median and 75th percentile, and how many institutions stand behind them.
- Characterize the revenue direction only (revenue-positive, revenue-neutral or revenue-compressing); give no dollar projections.
- Do not cite complaint volumes, attrition, migration patterns or regulatory actions: that data is not supplied here.
- Never say whether to make the change. Describe what this price would mean and the question it puts to management.`;

  const institutionLine = institution
    ? `Institution: ${institution.institution_name} (${institution.charter_type === "credit_union" ? "credit union" : "bank"}${institution.asset_size_tier ? `, ${institution.asset_size_tier}` : ""})`
    : "";

  const user = `${institutionLine}

Fee category: ${displayCategory}
Current fee: $${currentFee.toFixed(2)}
Tested price: $${proposedFee.toFixed(2)} (${againstCurrent})

Peer group: ${peerLabel}
Peer distribution (${institutionCount} institutions):
- P25: $${p25_amount?.toFixed(2) ?? "N/A"}
- Median: $${median_amount?.toFixed(2) ?? "N/A"}
- P75: $${p75_amount?.toFixed(2) ?? "N/A"}

What would this price mean competitively, and what question does it put to management?`.trim();

  return {
    system,
    user,
    data: {
      current_fee: currentFee,
      tested_price: proposedFee,
      change: Math.abs(proposedFee - currentFee),
      p25: p25_amount,
      median: median_amount,
      p75: p75_amount,
      institutions: institutionCount,
    },
  };
}

export type SimulateReadResult =
  | { status: "written"; text: string; check: AnswerEvidenceCheck }
  /** Only with HAMILTON_ANSWER_GATE_ENFORCE on: the one output gate held the read, so its text is not returned. */
  | { status: "held"; reason: string; problems: string[] }
  | { status: "unavailable"; reason: string };

/** What a reader sees in place of a Simulate read the one output gate holds (HAMILTON_ANSWER_GATE_ENFORCE on). */
export const SIMULATE_HELD_MESSAGE = "This read didn't pass Hamilton's source check, so it isn't shown. Try the price again.";

/** The read as one buffered call, checked with the shared evidence gate. Used by the eval. */
export async function writeSimulateRead(
  input: SimulateInput,
  options: {
    client?: MemoClient; model?: string; institutionId?: number | null; tracking?: MemoTracking;
    /** Given a thunk for the one output gate's shadow verdict on the read (#1077 step 4). */
    onGateShadow?: (compute: () => GateShadowRecord) => void;
  } = {},
): Promise<SimulateReadResult> {
  if (!options.client && !hasAnthropicApiKey("hamilton")) return { status: "unavailable", reason: "Hamilton's writer is not configured." };
  const model = options.model ?? getHamiltonModel();
  const prompts = simulatePrompts(input);
  let client: MemoClient;
  try {
    client = options.client ?? anthropicSimulateClient(options.institutionId ?? null, options.tracking);
  } catch (error) {
    return { status: "unavailable", reason: error instanceof Error ? error.message : String(error) };
  }
  let text: string;
  try {
    text = (await client.create({ system: prompts.system, user: prompts.user, model })).trim();
  } catch (error) {
    const incomplete = incompleteProviderResponse(error);
    if (incomplete) return { status: "unavailable", reason: incomplete.message };
    if (isProviderLimitError(error)) return { status: "unavailable", reason: HAMILTON_PAUSED_MESSAGE };
    const message = error instanceof Error ? error.message : String(error);
    return { status: "unavailable", reason: /budget|usage limit/i.test(message) ? "Hamilton's writing budget for today is used up." : "Hamilton's writer could not be reached." };
  }
  const check = checkAnswerEvidence(text, prompts.data);
  const enforce = isAnswerGateEnforced();
  // The one output gate in shadow (#1077 step 4): handed over as a thunk with its inputs captured,
  // so the caller computes and records it after its own work, never before returning.
  if (options.onGateShadow) {
    const today: TodayDecision = check.passed ? "shown" : "held";
    const data = prompts.data;
    options.onGateShadow(() => simulateGateShadow(text, data, today, "simulate_read", enforce));
  }
  // HAMILTON_ANSWER_GATE_ENFORCE on (#1077 T4): the read is returned only when the one output gate
  // validates it. A read has no partial view, so a partial verdict holds too.
  if (enforce) {
    const verdict = tryGateAnswer(simulateGateInput(text, prompts.data));
    if (enforcedOutcome(verdict, false) !== "validated") return { status: "held", reason: SIMULATE_HELD_MESSAGE, problems: enforcedProblems(verdict) };
  }
  return { status: "written", text, check };
}

/** The one output gate's shadow verdict on a Simulate read (#1077 step 4): its text against the numbers the model was given. */
export function simulateGateShadow(text: string, data: SimulatePrompts["data"], today: TodayDecision, path: ShadowPath, enforced = false): GateShadowRecord {
  return shadowGate(simulateGateInput(text, data), today, { path, ...(enforced ? { enforced } : {}) });
}

/** The one output gate's input for a Simulate read: its text against the numbers the model was given. */
export function simulateGateInput(text: string, data: SimulatePrompts["data"]): GateInput {
  return { surface: "simulate", text, evidence: { kind: "data", data }, identity: { researchInstitutionId: null, accountInstitutionId: null } };
}

/**
 * The Simulate stream's body with HAMILTON_ANSWER_GATE_ENFORCE on (#1077 T4): nothing is sent until
 * the read is finished and gated; then the read, or `SIMULATE_HELD_MESSAGE` in its place. A read
 * that never finishes (`text` rejects) errors the body, as an unfinished stream does today.
 */
export function enforcedSimulateBody(text: PromiseLike<string>, data: SimulatePrompts["data"]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const read = await text;
        const verdict = read.trim() ? tryGateAnswer(simulateGateInput(read, data)) : null;
        const shown = read.trim() && enforcedOutcome(verdict, false) === "validated" ? read : SIMULATE_HELD_MESSAGE;
        controller.enqueue(encoder.encode(shown));
        controller.close();
      } catch (error) {
        controller.error(error);
      }
    },
  });
}

function anthropicSimulateClient(institutionId: number | null, tracking?: MemoTracking): MemoClient {
  return {
    async create({ system, user, model }) {
      const response = await trackAnthropicRequest(
        {
          model,
          agent: "hamilton",
          operation: tracking?.operation ?? "simulate_fee_change",
          routeId: SIMULATE_ROUTE_ID,
          ...(tracking?.subjectKey ? { subjectKey: tracking.subjectKey } : {}),
          ...(tracking?.agentRunId ? { agentRunId: tracking.agentRunId } : {}),
          metadata: { institution_id: institutionId },
        },
        () => withRawProviderResponseOperation(REQUEST_TIMEOUT_MS, (scope) => {
          const client = getAnthropicMessagesClient("Hamilton simulate read", "hamilton", scope);
          return (attempt) => client.messages.create(
            { model, max_tokens: SIMULATE_MAX_TOKENS, system, messages: [{ role: "user", content: user }] },
            { ...attempt, timeout: REQUEST_TIMEOUT_MS },
          );
        }).then((response) => assertCompletedAnthropicTextResponse(response)),
      );
      return extractAnthropicText(response);
    },
  };
}
