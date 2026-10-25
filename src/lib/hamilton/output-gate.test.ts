import { describe, expect, it, vi } from "vitest";

vi.mock("@/lib/ai-provider", async (importOriginal) => ({
  isProviderLimitError: (await importOriginal<typeof import("@/lib/ai-provider")>()).isProviderLimitError,
  getAnthropicMessagesClient: () => { throw new Error("no provider in tests"); },
  extractAnthropicText: () => "",
  getHamiltonModel: () => "test-model",
  hasAnthropicApiKey: () => false,
}));

import { checkAnswerEvidence } from "./answer-gate";
import { writtenAnswerBinding, writtenAnswerCheck } from "./answer-save";
import { CLAIM_GOLDEN_CASES, type ClaimGoldenCase } from "./claim-golden-set";
import { replayClaimGoldenGate } from "./claim-gate-replay";
import { memoBinding, memoGateInput, memoProblems, writeStorylineMemo, type MemoClient } from "./memo";
import { gateAnswer, type GateInput } from "./output-gate";
import { causeLines } from "./output-gate-signals";
import { GATE_SHADOW_ERROR, gateShadowRecord, readGateShadowRecord, shadowDisagreement, shadowGate, tallyGateShadow, type GateShadowRecord } from "./output-gate-shadow";
import { simulateGateShadow, simulatePrompts, writeSimulateRead } from "./simulate-read";
import { buildFeeAnswer } from "./workspace/answer";
import { overdraftResearch } from "./workspace/test-fixtures";

type Written = Extract<ClaimGoldenCase, { surface: "written_answer" }>;
const written = CLAIM_GOLDEN_CASES.filter((c): c is Written => c.surface === "written_answer");
const byId = (id: string) => written.find((c) => c.id === id)!;
const writtenInput = (c: Written, text = c.text, extra: Partial<GateInput> = {}): GateInput => ({
  surface: "written_answer", text, question: c.question,
  evidence: { kind: "tool_reads", toolOutputs: c.reads.map((read) => read.output), reads: c.reads },
  identity: { researchInstitutionId: c.institutionId, accountInstitutionId: c.accountInstitutionId ?? null },
  ...extra,
});

describe("gateAnswer (#1077, claim contract step 4)", () => {
  it("reads the same evidence today's written-answer gate and binding read", () => {
    for (const c of written) {
      const outputs = c.reads.map((read) => read.output);
      const verdict = gateAnswer(writtenInput(c));
      expect(verdict.check, c.id).toEqual(writtenAnswerCheck(c.text, outputs, c.question, { toolResults: c.reads, institutionId: c.institutionId }));
      expect(verdict.binding, c.id).toEqual(writtenAnswerBinding(c.text, outputs, c.question,
        { toolResults: c.reads, institutionId: c.institutionId, accountInstitutionId: c.accountInstitutionId ?? null }));
    }
  });

  it("cuts a sentence that states a cause and shows the rest as partial; with the cause rule off it validates", () => {
    const c = byId("ca-fee-only");
    const control = byId("sb-control");
    // The research subject's own figure, then the stated cause.
    const text = `${control.text} ${c.text}`;
    const input = writtenInput(control, text, { evidence: { kind: "tool_reads", toolOutputs: [...control.reads, ...c.reads].map((r) => r.output), reads: [...control.reads, ...c.reads] } });
    expect(causeLines(text).length).toBeGreaterThan(0);
    const verdict = gateAnswer(input);
    expect(verdict.status).toBe("ready_partial");
    const cause = verdict.failures.find((f) => f.code === "causal_unsupported")!;
    expect(cause).toMatchObject({ critical: false, sentences: [c.text] });
    expect(gateAnswer({ ...input, cause: "off" }).status).toBe("validated");
  });

  it("holds a single stated-cause sentence: nothing is left once it goes", () => {
    const verdict = gateAnswer(writtenInput(byId("ca-fee-only")));
    expect(verdict.status).toBe("held");
    expect(verdict.failures.map((f) => f.code)).toEqual(expect.arrayContaining(["causal_unsupported", "nothing_left"]));
  });

  it("keeps an untraced figure critical (James, 2026-10-15)", () => {
    const verdict = gateAnswer({ surface: "simulate", text: "The tested price of $41.00 is far above the rest.", evidence: { kind: "data", data: { tested_price: 30 } },
      identity: { researchInstitutionId: null, accountInstitutionId: null } });
    expect(verdict.status).toBe("held");
    expect(verdict.failures[0]).toMatchObject({ code: "untraced_figure", critical: true, source: "check" });
  });

  it("holds an answer that names the reader's own institution with no fact about it", () => {
    const c = byId("sb-control");
    const verdict = gateAnswer(writtenInput(c, `${c.text} Synthetic Home Bank is not in these reads.`,
      { identity: { researchInstitutionId: c.institutionId, accountInstitutionId: 9999, accountInstitutionName: "Synthetic Home Bank" } }));
    expect(verdict.status).toBe("held");
    expect(verdict.failures.find((f) => f.code === "account_identity")).toMatchObject({ critical: true, source: "identity" });
  });

  it("holds on a surface's own rule, which cannot be cut by sentence", () => {
    const c = byId("sb-control");
    const verdict = gateAnswer(writtenInput(c, c.text, { extra: ["The memo did not identify any supporting evidence_fact_ids."] }));
    expect(verdict.status).toBe("held");
    expect(verdict.failures).toEqual([expect.objectContaining({ code: "surface_rule", critical: true })]);
  });
});

describe("the gate in shadow", () => {
  it("names each disagreement between today's decision and the unified status", () => {
    expect(shadowDisagreement("shown", "validated")).toBeNull();
    expect(shadowDisagreement("shown_ungated", "validated")).toBeNull();
    expect(shadowDisagreement("held", "held")).toBeNull();
    expect(shadowDisagreement("shown_partial", "ready_partial")).toBeNull();
    expect(shadowDisagreement("shown", "held")).toBe("unified_holds");
    expect(shadowDisagreement("shown_ungated", "held")).toBe("unified_holds");
    expect(shadowDisagreement("held", "ready_partial")).toBe("unified_shows");
    expect(shadowDisagreement("shown", "ready_partial")).toBe("partial_differs");
    expect(shadowDisagreement("shown_partial", "validated")).toBe("partial_differs");
  });

  it("never throws: a gate error is a record with the error, and today's decision stands", () => {
    const record = shadowGate({ surface: "memo", text: null as unknown as string, evidence: { kind: "data", data: {} },
      identity: { researchInstitutionId: null, accountInstitutionId: null } }, "shown", { path: "memo" });
    expect(record).toMatchObject({ today: "shown", agrees: false, disagreement: null });
    // A fixed code, never the thrown message.
    expect(record.error).toBe(GATE_SHADOW_ERROR);
  });

  it("keeps failure codes, never the answer's text, and reads back from the ledger", () => {
    const c = byId("sb-fee");
    const record = gateShadowRecord(gateAnswer(writtenInput(c)), "held", { path: "written_streaming", mode: "analyze" });
    expect(JSON.stringify(record)).not.toContain(c.text);
    expect(readGateShadowRecord(JSON.parse(JSON.stringify(record)))).toEqual(record);
    expect(record.version).toBe(2);
    // A record from before the version 2 bump (thin_peer_group) still reads back, under its own version.
    expect(readGateShadowRecord({ ...record, version: 1 })).toEqual({ ...record, version: 1 });
    expect(readGateShadowRecord({ ...record, version: 3 })).toBeNull();
    expect(readGateShadowRecord("nope")).toBeNull();
  });

  it("counts agreements, disagreements and what the unified gate holds for", () => {
    const base = { version: 1 as const, origin: "reader" as const, surface: "written_answer" as const, mode: null, codes: [] as GateShadowRecord["codes"], corrections: 0, cause: false };
    const records: GateShadowRecord[] = [
      { ...base, path: "written_streaming", today: "shown", unified: "validated", agrees: true, disagreement: null, critical: [] },
      { ...base, path: "written_streaming", today: "shown_ungated", unified: "held", agrees: false, disagreement: "unified_holds", critical: ["untraced_figure"] },
      { ...base, path: "written_buffered", today: "held", unified: "ready_partial", agrees: false, disagreement: "unified_shows", critical: [], cause: true },
      { ...base, path: "written_buffered", today: "held", unified: "held", agrees: false, disagreement: null, critical: [], error: "boom" },
    ];
    const tally = tallyGateShadow(records);
    expect(tally).toMatchObject({ total: 4, agree: 1, disagree: 2, errors: 1,
      byDisagreement: { unified_holds: 1, unified_shows: 1, partial_differs: 0 }, heldBy: { untraced_figure: 1 }, cause: { flagged: 1, held: 0 } });
    expect(tally.byPath["written_answer/written_streaming"]).toEqual({ total: 2, disagree: 1, unifiedHolds: 1, unifiedShows: 0 });
  });

  it("counts each origin apart, so the paid eval's samples never stand in for readers' answers", () => {
    const base = { version: 1 as const, surface: "written_answer" as const, mode: null, codes: [] as GateShadowRecord["codes"], corrections: 0, cause: false, critical: [] };
    const records: GateShadowRecord[] = [
      { ...base, origin: "reader", path: "written_streaming", today: "shown", unified: "validated", agrees: true, disagreement: null },
      { ...base, origin: "paid_eval", path: "written_streaming", today: "shown", unified: "held", agrees: false, disagreement: "unified_holds" },
      { ...base, origin: "paid_eval", path: "memo", today: "held", unified: "validated", agrees: false, disagreement: "unified_shows" },
      { ...base, origin: "golden", path: "golden_replay", today: "held", unified: "held", agrees: true, disagreement: null },
    ];
    const tally = tallyGateShadow(records);
    expect(tally).toMatchObject({ total: 4, agree: 2, disagree: 2 });
    expect(tally.byOrigin.reader).toMatchObject({ total: 1, agree: 1, disagree: 0 });
    expect(tally.byOrigin.paid_eval).toMatchObject({ total: 2, disagree: 2, byDisagreement: { unified_holds: 1, unified_shows: 1, partial_differs: 0 } });
    expect(tally.byOrigin.golden).toMatchObject({ total: 1, agree: 1 });
    expect(tallyGateShadow([]).byOrigin.paid_eval.total).toBe(0);
  });

  it("reads a record written before origins were kept as a reader's, and keeps a known origin", () => {
    const record = gateShadowRecord(gateAnswer(writtenInput(byId("sb-fee"))), "held", { path: "written_streaming", mode: "analyze" });
    expect(record.origin).toBe("reader");
    const { origin: _origin, ...old } = JSON.parse(JSON.stringify(record)) as Record<string, unknown>;
    expect(readGateShadowRecord(old)?.origin).toBe("reader");
    expect(readGateShadowRecord({ ...old, origin: "paid_eval" })?.origin).toBe("paid_eval");
    expect(readGateShadowRecord({ ...old, origin: "someone" })?.origin).toBe("reader");
    expect(gateShadowRecord(gateAnswer(writtenInput(byId("sb-fee"))), "held", { path: "golden_replay", origin: "golden" }).origin).toBe("golden");
  });

  it("gives a Simulate read a verdict against the numbers the model was given", () => {
    const { data } = simulatePrompts({ feeCategory: "overdraft", currentFee: 25, proposedFee: 30,
      distribution: { p25_amount: 20, median_amount: 27, p75_amount: 32, institution_count: 40 } });
    expect(simulateGateShadow("At $30.00 the tested price sits above the $27.00 median and below the $32.00 75th percentile.", data, "shown_ungated", "simulate_stream"))
      .toMatchObject({ surface: "simulate", unified: "validated", agrees: true });
  });

  it("hands the memo's caller one shadow thunk for the draft the decision rests on, computed only when run", async () => {
    const storyline = buildFeeAnswer(overdraftResearch(), { story: { wantsDecision: true } }).storyline!;
    const reply = JSON.stringify({ summary: "The overdraft fee is $412 per item.", board: "Board line.", market: "Market line.", questions: ["What is at stake?"] });
    const client: MemoClient = { create: async () => reply };
    const thunks: Array<() => GateShadowRecord> = [];
    const result = await writeStorylineMemo(storyline, "q", { client, onGateShadow: (compute) => thunks.push(compute) });
    expect(result.status).toBe("withheld");
    expect(thunks).toHaveLength(1);
    expect(thunks[0]()).toEqual(expect.objectContaining({ surface: "memo", path: "memo", today: "held", unified: "held", agrees: true }));
  });

  it("hands a Simulate read's caller a shadow thunk instead of computing it before returning", async () => {
    const thunks: Array<() => GateShadowRecord> = [];
    const client: MemoClient = { create: async () => "At $30.00 the tested price sits above the $27.00 median." };
    const result = await writeSimulateRead({ feeCategory: "overdraft", currentFee: 25, proposedFee: 30,
      distribution: { p25_amount: 20, median_amount: 27, p75_amount: 32, institution_count: 40 } }, { client, onGateShadow: (compute) => thunks.push(compute) });
    expect(result.status).toBe("written");
    expect(result).not.toHaveProperty("gateShadow");
    expect(thunks[0]()).toMatchObject({ surface: "simulate", path: "simulate_read", today: "shown", unified: "validated" });
  });
});

describe("the memo surface reads exactly today's memo inputs", () => {
  type Bundle = Extract<ClaimGoldenCase, { surface: "evidence_bundle" }>;
  const bundles = CLAIM_GOLDEN_CASES.filter((c): c is Bundle => c.surface === "evidence_bundle");
  const identity = { version: 1 as const, researchInstitutionId: 9001, accountInstitutionId: 9002, accountStatus: "linked" as const,
    researchInstitutionName: "Bank A", accountInstitutionName: "Bank B" };

  it("gives the same check and binding as memoProblems on every memo golden case", () => {
    expect(bundles.length).toBeGreaterThan(0);
    for (const c of bundles) {
      const draft = { summary: c.text, board: "", market: "", questions: [] as string[] };
      const payload = { fact_evidence: c.bundle, identityContext: identity };
      const verdict = gateAnswer(memoGateInput(draft, payload, c.question));
      const all = [draft.summary, draft.board, draft.market, ...draft.questions].join("\n");
      expect(verdict.check, c.id).toEqual(checkAnswerEvidence(all, payload));
      expect(verdict.binding, c.id).toEqual(memoBinding(draft, payload, c.question));
      expect(verdict.binding, c.id).toEqual(memoProblems(draft, payload, c.question).binding);
    }
  });

  it("counts the memo's account-institution rule once, as its own surface rule", () => {
    const draft = { summary: "Bank B is not in this storyline.", board: "", market: "", questions: [] as string[] };
    const payload = { fact_evidence: bundles[0].bundle, identityContext: identity };
    const verdict = gateAnswer(memoGateInput(draft, payload, undefined));
    expect(verdict.failures.filter((f) => f.code === "account_identity")).toEqual([]);
    expect(verdict.failures.filter((f) => f.code === "surface_rule" && f.message.includes("Bank B"))).toHaveLength(1);
  });
});

describe("the golden set replayed through the unified gate", () => {
  const replay = replayClaimGoldenGate();

  it("decides every case as its target says; it parts from today only on the causes step 3 records in shadow", () => {
    expect(replay.total).toBe(48);
    expect(replay.meetsTarget).toBe(48);
    expect(replay.controlsValidated).toBe(replay.controls);
    expect(replay.controls).toBe(20);
    expect(replay.tally).toMatchObject({ agree: 45, disagree: 3, errors: 0, byStatus: { validated: 20, ready_partial: 1, held: 27 },
      byDisagreement: { unified_holds: 3, unified_shows: 0, partial_differs: 0 } });
    // Exactly the cases the golden set marks wrong today (todayWrong), and each of them a stated cause.
    const disagreeing = replay.results.filter((r) => r.disagreement).map((r) => r.id).sort();
    expect(disagreeing).toEqual(CLAIM_GOLDEN_CASES.filter((c) => c.todayWrong).map((c) => c.id).sort());
    expect(disagreeing).toEqual(["ca-fee-only", "ca-fee-only-pricing", "ca-financial-traced"]);
  });

  it("reports how often the cause rule flags and alone holds an answer", () => {
    expect(replay.cause).toEqual({ flags: 7, holds: 4, cuts: 0 });
    expect(replay.results.filter((r) => r.cause === "holds").map((r) => r.id).sort())
      .toEqual(["ca-fee-only", "ca-fee-only-pricing", "ca-financial-pricing", "ca-financial-traced"]);
    for (const r of replay.results.filter((x) => x.control)) expect(r.cause, r.id).toBe("none");
  });
});

describe("gateAnswer: the peer minimum (T5, #1726)", () => {
  const profile = { toolName: "getInstitution", input: { id: 9101 }, output: {
    identity: { id: 9101, name: "Harbor Point Bank", state: "TX", city: "Synthetic City", charter_type: "bank" },
    fees: { verified: [{ fee_name: "Overdraft", fee_category: "overdraft", amount: 30, status: "verified", record_id: 1, source_document_id: 1001 }], provisional: [] },
  } };
  const index = (count: number) => ({ toolName: "searchIndex", input: { state: "WY", charter: "credit_union" }, output: {
    scope: "filtered", filters: { state: "WY", charter: "credit_union", district: null },
    data: [{ category: "overdraft", median: 27.5, p25: 25, p75: 30, institution_count: count }],
  } });
  const local = (fees: number[]) => ({ toolName: "getLocalCompetitors", input: { institution_id: 9101 }, output: {
    institution: "Harbor Point Bank", institution_id: 9101, your_fees: { overdraft: 30 },
    competitors: fees.map((amount, i) => ({ institution_id: 9131 + i, name: `Synthetic Competitor ${i}`, fees: { overdraft: amount } })),
  } });
  const gate = (text: string, reads: Array<{ toolName: string; input: unknown; output: unknown }>) => gateAnswer({
    surface: "written_answer", text,
    evidence: { kind: "tool_reads", toolOutputs: reads.map((r) => r.output), reads },
    identity: { researchInstitutionId: 9101, accountInstitutionId: 9101 },
  });

  it("cuts an index median over fewer than 10 institutions and keeps the rest of the answer", () => {
    const verdict = gate("Harbor Point Bank's overdraft fee is $30. The median overdraft fee for WY credit unions is $27.50.", [profile, index(6)]);
    expect(verdict.status).toBe("ready_partial");
    expect(verdict.failures.find((f) => f.code === "thin_peer_group")?.sentences).toEqual(["The median overdraft fee for WY credit unions is $27.50."]);
  });

  it("holds an answer that is only a thin median, and leaves a 10-institution median alone", () => {
    expect(gate("The median overdraft fee for WY credit unions is $27.50.", [profile, index(6)]).status).toBe("held");
    expect(gate("The median overdraft fee for WY credit unions is $27.50.", [profile, index(10)]).status).toBe("validated");
  });

  it("cuts a median of fewer than 5 local competitors, never one of 5", () => {
    const text = "The median overdraft fee among Harbor Point Bank's local competitors is $33.";
    expect(gate(text, [profile, local([25, 33, 36])]).failures.map((f) => f.code)).toContain("thin_peer_group");
    expect(gate(text, [profile, local([25, 29, 33, 34, 36])]).status).toBe("validated");
    // Naming the competitors' prices is the house rule's alternative, and is never cut.
    expect(gate("Its three local competitors charge $25, $33 and $36 for an overdraft.", [profile, local([25, 33, 36])]).status).toBe("validated");
  });
});
