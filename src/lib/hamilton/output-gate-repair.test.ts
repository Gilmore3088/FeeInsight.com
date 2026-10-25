import { describe, expect, it, vi } from "vitest";

import { CLAIM_GOLDEN_CASES, heldOutLeaks, type ClaimGoldenCase } from "./claim-golden-set";
import { gateAnswer, type GateInput } from "./output-gate";
import {
  GATE_REPAIR_SWITCH,
  PARTIAL_ANSWER_LEAD,
  gatedAnswerView,
  isBetterVerdict,
  isGateRepairEnabled,
  repairFeedback,
  runGatedAnswer,
} from "./output-gate-repair";

const DATA = { tested_price: 30, peer_median: 29 };
const simulate = (text: string): GateInput => ({
  surface: "simulate", text, evidence: { kind: "data", data: DATA },
  identity: { researchInstitutionId: null, accountInstitutionId: null },
});
const gate = (draft: { text: string }) => gateAnswer(simulate(draft.text));

const PASSING = "The tested price of $30 sits above the peer median of $29.";
const UNTRACED = "The tested price of $41 sits above the peer median of $29.";
const ADVICE = "The bank should lower the fee to match its peers.";
const WITH_ADVICE = `${PASSING} ${ADVICE}`;

describe("the repair switch (#1077, claim contract step 5)", () => {
  it("is off unless HAMILTON_GATE_REPAIR is exactly true, 1 or on", () => {
    expect(GATE_REPAIR_SWITCH).toBe("HAMILTON_GATE_REPAIR");
    expect(isGateRepairEnabled({})).toBe(false);
    for (const value of ["", "false", "0", "off", "yes", "enabled"]) expect(isGateRepairEnabled({ HAMILTON_GATE_REPAIR: value }), value).toBe(false);
    for (const value of ["true", "1", "on", " ON "]) expect(isGateRepairEnabled({ HAMILTON_GATE_REPAIR: value }), value).toBe(true);
  });
});

describe("runGatedAnswer", () => {
  it("makes no rewrite for a validated draft", async () => {
    const repair = vi.fn();
    const result = await runGatedAnswer({ draft: { text: PASSING }, gate, repair, allowRepair: () => true });
    expect(result).toMatchObject({ repair: "not_needed", repairCalls: 0 });
    expect(result.verdict.status).toBe("validated");
    expect(repair).not.toHaveBeenCalled();
  });

  it("fails then passes: one rewrite, validated, the gate's failures fed back", async () => {
    const repair = vi.fn(async (_feedback: string) => ({ text: PASSING }));
    const result = await runGatedAnswer({ draft: { text: UNTRACED }, gate, repair, allowRepair: () => true });
    expect(result).toMatchObject({ repair: "used", repairCalls: 1, draft: { text: PASSING } });
    expect(result.first.status).toBe("held");
    expect(result.verdict.status).toBe("validated");
    expect(repair).toHaveBeenCalledTimes(1);
    expect(repair.mock.calls[0][0]).toContain("$41");
  });

  it("fails twice with a non-critical failure: ready_partial, and the view keeps only the supported sentence", async () => {
    const repair = vi.fn(async () => ({ text: WITH_ADVICE }));
    const result = await runGatedAnswer({ draft: { text: WITH_ADVICE }, gate, repair, allowRepair: () => true });
    expect(result.verdict.status).toBe("ready_partial");
    expect(result).toMatchObject({ repair: "kept_first", repairCalls: 1 });
    const view = gatedAnswerView(result.draft.text, result.verdict);
    expect(view).toMatchObject({ status: "ready_partial", text: PASSING, lead: PARTIAL_ANSWER_LEAD, leftOut: 1 });
  });

  it("an untraced figure stays critical: a rewrite that keeps it is held, and the view shows nothing", async () => {
    const repair = vi.fn(async () => ({ text: UNTRACED }));
    const result = await runGatedAnswer({ draft: { text: UNTRACED }, gate, repair, allowRepair: () => true });
    expect(result.verdict.status).toBe("held");
    expect(result.verdict.failures[0]).toMatchObject({ code: "untraced_figure", critical: true });
    expect(gatedAnswerView(result.draft.text, result.verdict)).toMatchObject({ status: "held", text: null });
  });

  it("makes no rewrite while the switch, budget or quota says no", async () => {
    const repair = vi.fn();
    const result = await runGatedAnswer({ draft: { text: UNTRACED }, gate, repair, allowRepair: async () => false });
    expect(result).toMatchObject({ repair: "not_allowed", repairCalls: 0 });
    expect(result.verdict.status).toBe("held");
    expect(repair).not.toHaveBeenCalled();
    const throwing = await runGatedAnswer({ draft: { text: UNTRACED }, gate, repair, allowRepair: () => { throw new Error("quota unreadable"); } });
    expect(throwing.repair).toBe("not_allowed");
  });

  it("keeps the first draft when the rewrite hits a provider stop, and never tries again", async () => {
    const repair = vi.fn(async () => { throw new Error("usage limit reached"); });
    const result = await runGatedAnswer({ draft: { text: UNTRACED }, gate, repair, allowRepair: () => true });
    expect(result).toMatchObject({ repair: "failed", repairCalls: 1, error: "usage limit reached", draft: { text: UNTRACED } });
    expect(result.verdict.status).toBe("held");
    expect(repair).toHaveBeenCalledTimes(1);
  });

  it("does not rewrite a verdict that needs fresh reads", async () => {
    const repair = vi.fn();
    const first = gate({ text: UNTRACED });
    const result = await runGatedAnswer({ draft: { text: UNTRACED }, gate: () => ({ ...first, repairable: false }), repair, allowRepair: () => true });
    expect(result.repair).toBe("not_repairable");
    expect(repair).not.toHaveBeenCalled();
  });

  it("takes the better verdict by the status table", () => {
    const validated = gate({ text: PASSING });
    const partial = gate({ text: WITH_ADVICE });
    const held = gate({ text: UNTRACED });
    expect(isBetterVerdict(validated, partial)).toBe(true);
    expect(isBetterVerdict(partial, held)).toBe(true);
    expect(isBetterVerdict(held, partial)).toBe(false);
    expect(isBetterVerdict(held, held)).toBe(false);
    expect(isBetterVerdict(partial, partial)).toBe(false);
  });
});

describe("gatedAnswerView", () => {
  it("shows a validated answer whole, with no lead", () => {
    expect(gatedAnswerView(PASSING, gate({ text: PASSING }))).toEqual({ status: "validated", text: PASSING, lead: null, corrections: [], leftOut: 0 });
  });

  it("puts a premise correction first and leaves the contradicted sentence out of a partial answer", () => {
    type Written = Extract<ClaimGoldenCase, { surface: "written_answer" }>;
    const byId = (id: string) => CLAIM_GOLDEN_CASES.find((x): x is Written => x.surface === "written_answer" && x.id === id)!;
    const restated = byId("wp-fee-restated");
    const corrected = byId("wp-fee-corrected");
    const text = `${corrected.text} ${restated.text}`;
    const verdict = gateAnswer({ surface: "written_answer", text, question: restated.question,
      evidence: { kind: "tool_reads", toolOutputs: restated.reads.map((r) => r.output), reads: restated.reads },
      identity: { researchInstitutionId: restated.institutionId, accountInstitutionId: null } });
    expect(verdict.status).toBe("ready_partial");
    const view = gatedAnswerView(text, verdict);
    expect(view.corrections.length).toBeGreaterThan(0);
    expect(view).toMatchObject({ lead: PARTIAL_ANSWER_LEAD, text: corrected.text, leftOut: 1 });
  });

  it("a held answer shows nothing, corrections included", () => {
    expect(gatedAnswerView(UNTRACED, gate({ text: UNTRACED }))).toEqual({ status: "held", text: null, lead: null, corrections: [], leftOut: 0 });
  });
});

describe("repair feedback", () => {
  it("is built from the gate's own lines and holds no golden case text", () => {
    const feedback = repairFeedback(gate({ text: WITH_ADVICE }));
    expect(feedback).toContain("This reads as advice:");
    expect(heldOutLeaks(repairFeedback(gate({ text: UNTRACED })))).toEqual([]);
  });
});
