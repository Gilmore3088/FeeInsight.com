/**
 * The claim golden set (claim-golden-set.ts) replayed through the one output gate (#1077, claim
 * contract step 4). Deterministic: no reads, no model calls. For each case it reports today's
 * decision (the route's or the Ask bar's steps, `claimGoldenOutcome`), the unified gate's status
 * and reasons, whether they disagree, whether the unified status meets the case's target, and what
 * the cause rule (step 3, a shadow input) does to it: whether it alone holds the answer or cuts
 * sentences from it.
 *
 * The cases are synthetic; the results say how the gate decides them, never how accurate the
 * live data is.
 */

import { CLAIM_GOLDEN_CASES, CLAIM_GOLDEN_NAMES, CLAIM_GOLDEN_SET_VERSION, claimGoldenOutcome, type ClaimGoldenCase } from "./claim-golden-set";
import { gateAnswer, type GateFailureCode, type GateInput, type GateStatus } from "./output-gate";
import { gateShadowRecord, tallyGateShadow, type GateShadowRecord, type GateShadowTally, type TodayDecision } from "./output-gate-shadow";

export interface ClaimGateReplayResult {
  id: string;
  group: ClaimGoldenCase["group"];
  control: boolean;
  target: ClaimGoldenCase["target"]["status"];
  today: TodayDecision;
  unified: GateStatus;
  codes: GateFailureCode[];
  disagreement: GateShadowRecord["disagreement"];
  /** The unified gate holds exactly when the target holds. */
  meetsTarget: boolean;
  /** What the cause rule changes: "holds" when the answer is held only with it, "cuts" when it alone makes the answer partial. */
  cause: "holds" | "cuts" | "flags" | "none";
}

export interface ClaimGateReplay {
  version: string;
  total: number;
  /** Cases where the unified gate holds exactly when the target does. */
  meetsTarget: number;
  /** Controls the unified gate validates. */
  controlsValidated: number;
  controls: number;
  /** Cases the cause rule flags, holds alone, and cuts sentences from alone. */
  cause: { flags: number; holds: number; cuts: number };
  tally: GateShadowTally;
  results: ClaimGateReplayResult[];
}

function gateInputFor(c: ClaimGoldenCase): GateInput {
  if (c.surface === "written_answer") {
    return {
      surface: "written_answer", text: c.text, question: c.question,
      evidence: { kind: "tool_reads", toolOutputs: c.reads.map((read) => read.output), reads: c.reads },
      identity: { researchInstitutionId: c.institutionId, accountInstitutionId: c.accountInstitutionId ?? null },
    };
  }
  return {
    surface: "memo", text: c.text, question: c.question,
    evidence: { kind: "data", data: c.bundle, bundle: c.bundle, names: CLAIM_GOLDEN_NAMES },
    identity: { researchInstitutionId: null, accountInstitutionId: null },
  };
}

/** Today's decision on a case, in the shadow's terms. */
export function todayDecisionFor(c: ClaimGoldenCase): TodayDecision {
  const outcome = claimGoldenOutcome(c);
  if (outcome.status === "held") return "held";
  return outcome.binding && outcome.binding.omitted.length > 0 ? "shown_partial" : "shown";
}

export function replayClaimGoldenCase(c: ClaimGoldenCase): { result: ClaimGateReplayResult; record: GateShadowRecord } {
  const input = gateInputFor(c);
  const verdict = gateAnswer(input);
  const withoutCause = gateAnswer({ ...input, cause: "off" });
  const today = todayDecisionFor(c);
  const record = gateShadowRecord(verdict, today, { path: "golden_replay", origin: "golden" });
  const flagged = verdict.failures.some((f) => f.code === "causal_unsupported");
  const cause: ClaimGateReplayResult["cause"] = !flagged ? "none"
    : verdict.status === "held" && withoutCause.status !== "held" ? "holds"
      : verdict.status === "ready_partial" && withoutCause.status === "validated" ? "cuts" : "flags";
  return {
    record,
    result: {
      id: c.id, group: c.group, control: c.control, target: c.target.status, today, unified: verdict.status,
      codes: record.codes, disagreement: record.disagreement,
      meetsTarget: (verdict.status === "held") === (c.target.status === "held"), cause,
    },
  };
}

/** Every golden case through the unified gate, with the counts a later step reads. */
export function replayClaimGoldenGate(cases: readonly ClaimGoldenCase[] = CLAIM_GOLDEN_CASES): ClaimGateReplay {
  const replayed = cases.map(replayClaimGoldenCase);
  const results = replayed.map((r) => r.result);
  const controls = results.filter((r) => r.control);
  return {
    version: CLAIM_GOLDEN_SET_VERSION,
    total: results.length,
    meetsTarget: results.filter((r) => r.meetsTarget).length,
    controlsValidated: controls.filter((r) => r.unified === "validated").length,
    controls: controls.length,
    cause: {
      flags: results.filter((r) => r.cause !== "none").length,
      holds: results.filter((r) => r.cause === "holds").length,
      cuts: results.filter((r) => r.cause === "cuts").length,
    },
    tally: tallyGateShadow(replayed.map((r) => r.record)),
    results,
  };
}
