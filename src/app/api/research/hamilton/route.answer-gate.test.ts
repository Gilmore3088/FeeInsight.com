/**
 * The streamed written answer passes the shared evidence gate (answer-gate.ts, #981).
 * With no held line, a failing answer streams as before and its verdict is saved; with
 * one (the shipped default), a failing answer is never shown or saved and a passing one still is.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  stream: vi.fn(), generate: vi.fn(), briefing: vi.fn(), check: vi.fn(), save: vi.fn(), write: vi.fn(), merge: vi.fn(), usage: vi.fn(), shadow: vi.fn(), afterTasks: [] as Array<() => unknown>,
  deferAfter: false,
  held: { message: null as string | null },
  gateThrows: false,
  claimsThrow: false,
}));
vi.mock("@/lib/hamilton/answer-save", async () => {
  const actual = await vi.importActual<typeof import("@/lib/hamilton/answer-save")>("@/lib/hamilton/answer-save");
  return {
    ...actual,
    writtenAnswerCheck: (...args: Parameters<typeof actual.writtenAnswerCheck>) => {
      if (mocks.gateThrows) throw new Error("synthetic gate failure");
      mocks.check(...args);
      return actual.writtenAnswerCheck(...args);
    },
    writtenAnswerClaims: (...args: Parameters<typeof actual.writtenAnswerClaims>) => {
      if (mocks.claimsThrow) throw new Error("synthetic claims failure");
      return actual.writtenAnswerClaims(...args);
    },
  };
});
// The real shadow store, over a ledger write that never settles: a response that waited on it would never resolve.
vi.mock("@/lib/agents/run-store", () => ({ recordProRequest: mocks.shadow }));
vi.mock("next/server", () => ({ after: (task: () => unknown) => { if (mocks.deferAfter) mocks.afterTasks.push(task); else void task(); } }));
vi.mock("@/lib/api-hardening/route-wrapper", () => ({ withApiRoutePolicy: (_id: string, _method: string, handler: unknown) => handler }));
vi.mock("@/lib/api-hardening/audit", () => ({ getRequestSubjectKey: () => "synthetic-user" }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => ({ id: 7, role: "premium" }) }));
vi.mock("@/lib/access", () => ({ canAccessPremium: () => true }));
vi.mock("@/lib/hamilton/institution-membership", () => ({ getUserInstitutionMemberships: async () => [] }));
vi.mock("@/lib/hamilton/institution-briefing", () => ({ buildHamiltonInstitutionBriefingSnapshot: mocks.briefing }));
vi.mock("@/lib/data-store", () => ({ getInstitutionById: async (id: number) => ({ id, institution_name: `Synthetic Subject ${id}` }) }));
vi.mock("@/lib/hamilton/quota", () => ({ checkProAiQuota: async () => ({ allowed: true }), quotaExceededMessage: () => "quota" }));
vi.mock("@/lib/research/history", () => ({ logUsage: async () => {} }));
vi.mock("@/lib/analytics-server", () => ({ trackFirstHamiltonUse: async () => {} }));
vi.mock("@/lib/data-store/hamilton-analyses", () => ({ insertSavedAnalysis: mocks.save }));
vi.mock("@/lib/ai-provider", () => ({
  getAnthropicLanguageModel: () => ({}), hasAnthropicApiKey: () => true,
  isProviderLimitError: () => false, MISSING_ANTHROPIC_API_KEY_MESSAGE: "missing",
}));
vi.mock("@/lib/ai-provider-usage", async () => ({
  observedProviderUsage: (await vi.importActual<typeof import("@/lib/ai-provider-usage")>("@/lib/ai-provider-usage")).observedProviderUsage,
  ProviderBudgetBlockedError: class extends Error {}, ProviderCircuitOpenError: class extends Error {},
  guardProviderCall: async () => Date.now(), recordProviderUsage: mocks.usage, estimateAnthropicCostMicrousd: () => 0,
  trackAnthropicRequest: async (_context: unknown, call: () => Promise<unknown>) => call(),
}));
vi.mock("@/lib/research/agents", () => ({
  getHamilton: async () => ({ systemPrompt: "Hamilton base.", model: "test-model", tools: {}, maxTokens: 100, maxSteps: 1 }),
  buildAnalyzeModeSuffix: () => "", buildMonitorModeSuffix: () => "", buildSavedPeerSetPrompt: () => "", savedPeerSetUsed: () => false,
}));
vi.mock("@/lib/hamilton/active-peer-set", () => ({ getActivePeerSet: async () => null }));
vi.mock("@/lib/research/skills", () => ({
  detectSkill: () => null, buildSkillInjection: () => "", buildSkillExecution: () => "", isSkillOptIn: () => false, findOfferedSkill: () => null,
}));
vi.mock("@/lib/research/tool-output", () => ({
  cachedSystem: (text: string) => text, cacheLatestMessage: (messages: unknown) => messages, ledgerUsage: () => ({}), trackerUsage: () => ({}),
}));
vi.mock("@/lib/hamilton/answer-gate", async () => {
  const actual = await vi.importActual<typeof import("@/lib/hamilton/answer-gate")>("@/lib/hamilton/answer-gate");
  return {
    ...actual,
    get HELD_ANSWER_MESSAGE() {
      return mocks.held.message;
    },
  };
});
vi.mock("ai", () => ({
  generateText: mocks.generate, streamText: mocks.stream, convertToModelMessages: async (messages: unknown) => messages, stepCountIs: () => ({}),
  createUIMessageStream: ({ execute }: { execute: (input: unknown) => Promise<void> }) => execute({ writer: { merge: mocks.merge, write: mocks.write } }),
  createUIMessageStreamResponse: async ({ stream }: { stream: Promise<void> }) => { await stream; return new Response("synthetic stream"); },
}));
import { withConversationContext } from "@/lib/hamilton/conversation-context";
import { POST } from "./route";

const TOOL_OUTPUT = { fee: 35, peer_median: 29 };
const PASSING = "## Hamilton's View\nThe overdraft fee of $35 sits above the peer median of $29.";
const UNTRACED = "## Hamilton's View\nThe overdraft fee of $35 sits above the peer median of $27.";
const ADVICE = "## Hamilton's View\nThe overdraft fee of $35 sits above the peer median of $29, so the bank should lower the fee.";

const request = (text = "How does our overdraft fee compare?") => new Request("https://example.test/api/research/hamilton", {
  method: "POST", headers: { "content-type": "application/json" },
  body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text }] }], mode: "analyze", institutionId: 202 }),
});

function answers(text: string) {
  mocks.stream.mockImplementation((options) => ({
    consumeStream: async () => options.onFinish({
      finishReason: "stop",
      totalUsage: { inputTokens: 1, outputTokens: 1 },
      text,
      steps: [{ toolResults: [{ output: TOOL_OUTPUT }] }],
    }),
    toUIMessageStream: () => new ReadableStream({ start(c) { c.enqueue({ type: "finish", finishReason: "stop" }); c.close(); } }),
  }));
}

function metadata() {
  return mocks.write.mock.calls.map(([chunk]) => chunk).find((chunk) => chunk.type === "message-metadata")?.messageMetadata;
}

beforeEach(() => {
  mocks.held.message = null;
  mocks.gateThrows = false;
  mocks.usage.mockReset();
  mocks.stream.mockReset();
  mocks.generate.mockReset();
  mocks.check.mockReset();
  mocks.briefing.mockReset().mockResolvedValue({ prompt: "Research evidence.", evidence: [] });
  mocks.save.mockReset().mockResolvedValue("saved-1");
  mocks.write.mockReset();
  mocks.merge.mockReset();
  mocks.shadow.mockReset().mockImplementation(() => new Promise(() => {}));
  mocks.afterTasks = [];
  mocks.deferAfter = false;
  mocks.claimsThrow = false;
});

describe("written answer evidence gate", () => {
  const incomeFact = { institution_id: 202, institution_name: "Synthetic Subject 202", context_role: "research",
    metric: "service_charge_income", value: 57260, unit: "thousands of dollars", report_date: "2026-06-30",
    period_basis: "ytd", source: "ncua", publisher: "NCUA", evidence_tier: "regulatory" };

  it("validates the streamed answer against the same briefing snapshot as the prompt", async () => {
    mocks.held.message = "Synthetic held line.";
    const evidence = [incomeFact];
    mocks.briefing.mockResolvedValueOnce({ prompt: JSON.stringify(evidence), evidence });
    answers("## Hamilton's View\nFee income through June was $57.26 million year to date.");

    await POST(request("What was fee income through June?"));

    expect(mocks.briefing).toHaveBeenCalledTimes(1);
    expect(mocks.stream.mock.calls[0][0].system).toContain(JSON.stringify(evidence));
    expect(mocks.check.mock.calls[0][3].briefingEvidence).toEqual(evidence);
    expect(mocks.check.mock.calls[0][3].briefingEvidence[0]).toBe(incomeFact);
    expect(mocks.check.mock.calls[0][3]).toMatchObject({ institutionId: 202, toolResults: [{ output: TOOL_OUTPUT }] });
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(metadata()).toMatchObject({ answerEvidence: { passed: true, held: false } });
  });

  it("uses the same evidence snapshot and named tool inputs in the citation-gated path", async () => {
    const evidence = [incomeFact];
    mocks.briefing.mockResolvedValueOnce({ prompt: JSON.stringify(evidence), evidence });
    const text = "## Evidence\n" + Array.from({ length: 5 }, () => "NCUA 5300 reports fee income through June of $57.26 million year to date.").join("\n");
    const toolResult = { toolName: "queryData", input: { source: "ncua" }, output: { source: "ncua", rows: [] } };
    mocks.generate.mockResolvedValueOnce({ text, finishReason: "stop", steps: [{ toolResults: [toolResult] }], totalUsage: {} });
    const req = new Request("https://example.test/api/research/hamilton", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: "What was fee income through June?" }] }], mode: "analyze", institutionId: 202, gate_citations: true }) });

    const response = await POST(req);

    expect((await response.json()).status).toBe("ok");
    expect(mocks.briefing).toHaveBeenCalledTimes(1);
    expect(mocks.generate.mock.calls[0][0].system).toContain(JSON.stringify(evidence));
    expect(mocks.check.mock.calls[0][3].briefingEvidence).toEqual(evidence);
    expect(mocks.check.mock.calls[0][3].briefingEvidence[0]).toBe(incomeFact);
    expect(mocks.check.mock.calls[0][3]).toMatchObject({ institutionId: 202, toolResults: [toolResult] });
    expect(mocks.save).not.toHaveBeenCalled();
  });

  it.each(["Overdraft fees generated no revenue.", "Nobody paid overdraft fees.", "The customer base is growing."])("holds unsupported NCUA interpretation without showing or saving it: %s", async (claim) => {
    mocks.held.message = "Synthetic held line.";
    mocks.briefing.mockResolvedValueOnce({ prompt: JSON.stringify([incomeFact]), evidence: [incomeFact] });
    answers(`## Hamilton's View\n${claim}`);
    await POST(request("What does the NCUA filing establish?"));
    expect(mocks.merge).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(metadata()).toMatchObject({ answerEvidence: { passed: false, held: true } });
  });

  it("shows a sourced financial answer with a period caution", async () => {
    mocks.held.message = "Synthetic held line.";
    mocks.briefing.mockResolvedValueOnce({ prompt: JSON.stringify([incomeFact]), evidence: [incomeFact] });
    answers("## Hamilton's View\nFee income was $57.26 million year to date. This six-month figure should not be annualized.");
    await POST(request("What was fee income through June?"));
    expect(mocks.merge).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(metadata()).toMatchObject({ answerEvidence: { passed: true, held: false } });
  });

  it.each(["error", "length", "content-filter", "tool-calls", "other"])("does not save a terminal %s stream as a completed answer", async (finishReason) => {
    mocks.stream.mockImplementation((options) => ({
      consumeStream: async () => {
        if (finishReason === "error") await options.onError({ error: new Error("synthetic response failure") });
        await options.onFinish({ totalUsage: { inputTokens: 1, outputTokens: 1 }, text: PASSING, finishReason,
          steps: [{ toolResults: [{ output: TOOL_OUTPUT }] }] });
      },
      toUIMessageStream: () => new ReadableStream({ start(c) { c.enqueue({ type: "finish", finishReason: "error" }); c.close(); } }),
    }));
    await POST(request());
    expect(mocks.save).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(mocks.usage.mock.calls.filter((call) => call[1] === "failed")).toHaveLength(1));
    expect(mocks.usage.mock.calls.some((call) => call[1] === "completed")).toBe(false);
    expect(metadata()).not.toHaveProperty("savedAnalysisId");
  });

  it("saves a passing answer with its verdict and streams it", async () => {
    answers(PASSING);
    expect((await POST(request())).status).toBe(200);
    expect(mocks.merge).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0][0].response.answerEvidence).toEqual({ passed: true, problems: [] });
    expect(metadata()).toMatchObject({ savedAnalysisId: "saved-1", answerEvidence: { passed: true, held: false } });
  });

  it("records an untraced figure while no held line is approved, and still shows the answer", async () => {
    answers(UNTRACED);
    await POST(request());
    expect(mocks.merge).toHaveBeenCalledTimes(1);
    const saved = mocks.save.mock.calls[0][0].response;
    expect(saved.answerEvidence.passed).toBe(false);
    expect(saved.answerEvidence.problems.join(" ")).toContain("$27");
    expect(saved.confidence.level).toBe("low");
    expect(metadata()).toMatchObject({ answerEvidence: { passed: false, held: false } });
  });

  it("counts a figure the reader typed as traced, but not one from the appended earlier question (#1425)", async () => {
    answers(UNTRACED);
    await POST(request("Would a $27 overdraft fee sit below peers?"));
    expect(mocks.save.mock.calls[0][0].response.answerEvidence).toEqual({ passed: true, problems: [] });
    mocks.save.mockClear();
    await POST(request(withConversationContext("How does our overdraft fee compare?", [{ question: "Is $27 a normal overdraft fee?", lead: null }])));
    expect(mocks.save.mock.calls[0][0].response.answerEvidence.passed).toBe(false);
  });

  it("records advice the memo gate would refuse", async () => {
    answers(ADVICE);
    await POST(request());
    expect(mocks.save.mock.calls[0][0].response.answerEvidence.problems.join(" ")).toContain('"should"');
  });

  it("holds a failing answer once the held line is approved: never shown, never saved", async () => {
    mocks.held.message = "Synthetic held line.";
    answers(UNTRACED);
    await POST(request());
    expect(mocks.merge).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    const text = mocks.write.mock.calls.map(([chunk]) => chunk).filter((chunk) => chunk.type === "text-delta").map((chunk) => chunk.delta).join("");
    expect(text).toBe("Synthetic held line.");
    expect(text).not.toContain("$27");
    expect(metadata()).toEqual(expect.objectContaining({ answerEvidence: { passed: false, held: true } }));
    expect(metadata()).not.toHaveProperty("savedAnalysisId");
  });

  it("holds the answer when the gate itself cannot run, so the reader is never left waiting", async () => {
    mocks.held.message = "Synthetic held line.";
    mocks.gateThrows = true;
    answers(PASSING);
    await POST(request());
    expect(mocks.merge).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(metadata()).toEqual(expect.objectContaining({ answerEvidence: { passed: false, held: true } }));
    // The paid call still finishes its ledger row.
    expect(mocks.usage).toHaveBeenCalledWith(expect.anything(), "completed", expect.anything(), expect.anything());
  });

  it("still shows and saves a passing answer once the held line is approved", async () => {
    mocks.held.message = "Synthetic held line.";
    answers(PASSING);
    await POST(request());
    expect(mocks.merge).toHaveBeenCalledTimes(1);
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.write.mock.calls.some(([chunk]) => chunk.type === "text-delta")).toBe(false);
    expect(metadata()).toMatchObject({ savedAnalysisId: "saved-1", answerEvidence: { passed: true, held: false } });
  });

  it("matches a repeat on the full request, so the same follow-up after different questions saves twice (#1274)", async () => {
    answers(PASSING);
    const followUp = "How does that compare to peers?";
    await POST(request(withConversationContext(followUp, [{ question: "What is our overdraft fee?", lead: null }])));
    await POST(request(withConversationContext(followUp, [{ question: "What is our NSF fee?", lead: null }])));
    const [first, second] = mocks.save.mock.calls.map(([input]) => input);
    // The saved prompt is the reader's words only; the request matched on carries the earlier turns.
    expect(first.prompt).toBe(followUp);
    expect(second.prompt).toBe(followUp);
    expect(first.replaceRecentDuplicate.request).toContain("overdraft");
    expect(second.replaceRecentDuplicate.request).toContain("NSF");
    expect(first.replaceRecentDuplicate.request).not.toBe(second.replaceRecentDuplicate.request);
    // A written answer is never matched against an engine storyline row.
    expect(first.replaceRecentDuplicate.request.startsWith("written\n")).toBe(true);
  });
});

describe("written answer sentence binding (#981, H06-T06)", () => {
  // Invented banks: the profile lookup returns Synthetic Bank A's $10 overdraft fee as a catalog row.
  const PROFILE = {
    identity: { id: 9001, name: "Synthetic Bank A" },
    fees: { verified: [{ fee_name: "Overdraft", fee_category: "overdraft", amount: 10, frequency: "per item", status: "verified", record_id: 1, source_document_id: 101 }], provisional: [] },
  };
  const OTHER = { identity: { id: 9002, name: "Synthetic Bank B" }, fees: { verified: [{ fee_name: "Overdraft", fee_category: "overdraft", amount: 35, frequency: "per item", status: "verified", record_id: 2, source_document_id: 102 }], provisional: [] } };
  const BOUND = "## Hamilton's View\nSynthetic Bank A charges $10 for an overdraft. Synthetic Bank A charges $35 for an overdraft.\n\nSynthetic Bank B charges $35, near the $29 peer median.";
  let streamOptions: Array<{ messageMetadata?: (input: { part: { type: string } }) => unknown }> = [];

  function answersFrom(text: string, outputs: unknown[]) {
    streamOptions = [];
    mocks.stream.mockImplementation((options) => ({
      consumeStream: async () => options.onFinish({
        finishReason: "stop",
        totalUsage: { inputTokens: 1, outputTokens: 1 },
        text,
        steps: [{ toolResults: outputs.map((output) => ({ output })) }],
      }),
      toUIMessageStream: (streamOptionsIn: (typeof streamOptions)[number]) => {
        streamOptions.push(streamOptionsIn);
        return new ReadableStream({ start(c) { c.enqueue({ type: "finish", finishReason: "stop" }); c.close(); } });
      },
    }));
  }

  it("saves the binding with the answer, leaves the contradicted sentence out of the saved text, and sends the binding", async () => {
    answersFrom(BOUND, [PROFILE, OTHER, TOOL_OUTPUT]);
    await POST(request());
    const saved = mocks.save.mock.calls[0][0].response;
    expect(saved.hamiltonView).not.toContain("Synthetic Bank A charges $35");
    expect(saved.hamiltonView).toContain("Synthetic Bank A charges $10 for an overdraft.");
    expect(saved.narrativeBinding.omitted).toEqual([{ text: "Synthetic Bank A charges $35 for an overdraft.", reason: "wrong_institution" }]);
    expect(saved.narrativeBinding.supported[0]).toEqual({ text: "Synthetic Bank A charges $10 for an overdraft.", factIds: ["fee:published:1"] });
    expect(saved.narrativeBinding.interpretation).toEqual(["Synthetic Bank B charges $35, near the $29 peer median."]);
    expect(metadata()).toMatchObject({ narrativeBinding: saved.narrativeBinding, answerEvidence: { passed: true, held: false } });
    // #1077 step 6: the claims are saved with the binding, with the cited record's value, and never sent to the browser.
    expect(saved.claims).toMatchObject({ version: 1, bindingVersion: 1, factsTruncated: false });
    expect(saved.claims.claims.map((c: { outcome: string }) => c.outcome)).toEqual(
      [...saved.narrativeBinding.supported.map(() => "supported"), "reading", "omitted"]);
    expect(saved.claims.claims.at(-1)).toEqual({ text: "Synthetic Bank A charges $35 for an overdraft.", outcome: "omitted", factIds: [], reason: "wrong_institution" });
    expect(saved.claims.facts).toContainEqual(expect.objectContaining({ id: "fee:published:1", value: 10, unit: "usd" }));
    expect(metadata()).not.toHaveProperty("claims");
  });

  it("records every published fee row the profile reads returned, so a correction finds the saved answer by fee (#1077 defect 4)", async () => {
    // A pipeline preview row has no record id; a local competitor's price is an aggregate, not a record.
    const PREVIEW = { identity: { id: 9003, name: "Synthetic Bank C" }, fees: { verified: [], provisional: [
      { fee_name: "Overdraft", fee_category: "overdraft", amount: 33, status: "provisional", pipeline_stage: "verified_unpublished" },
    ] } };
    const COMPETITORS = { institution: "Synthetic Bank A", your_fees: { overdraft: 10 }, market: "Synthetic County",
      source: "FDIC Summary of Deposits 2025; verified published fee amounts", competitors: [{ name: "Synthetic Bank D", fees: { overdraft: 30 } }] };
    answersFrom(BOUND, [PROFILE, OTHER, PREVIEW, COMPETITORS, TOOL_OUTPUT]);
    await POST(request());
    // Bank B's row is recorded though its sentence is a reading: the save records what the tools read, as a storyline does.
    expect(mocks.save.mock.calls[0][0].feeRefs).toEqual([
      { feePublishedId: 1, institutionId: 9001, sourceDocumentId: 101, sourceContentHash: null },
      { feePublishedId: 2, institutionId: 9002, sourceDocumentId: 102, sourceContentHash: null },
    ]);
  });

  it("records no fee rows when the profile holds only pipeline preview rows, so the answer keeps the institution match", async () => {
    const PREVIEW_ONLY = { identity: { id: 9001, name: "Synthetic Bank A" }, fees: { verified: [], provisional: [
      { fee_name: "Overdraft", fee_category: "overdraft", amount: 10, status: "provisional", pipeline_stage: "raw_unverified" },
    ] } };
    answersFrom("## Hamilton's View\nSynthetic Bank A lists a $10 overdraft fee.", [PREVIEW_ONLY]);
    await POST(request());
    expect(mocks.save).toHaveBeenCalledTimes(1);
    expect(mocks.save.mock.calls[0][0].feeRefs).toEqual([]);
  });

  it("still saves the answer, with its binding and without claims, when the claims build throws (PR #2583 review)", async () => {
    mocks.claimsThrow = true;
    const logged = vi.spyOn(console, "error").mockImplementation(() => {});
    answersFrom(BOUND, [PROFILE, OTHER, TOOL_OUTPUT]);
    await POST(request());
    expect(mocks.save).toHaveBeenCalledTimes(1);
    const saved = mocks.save.mock.calls[0][0].response;
    expect(saved).not.toHaveProperty("claims");
    expect(saved.narrativeBinding.omitted).toHaveLength(1);
    expect(metadata()).toMatchObject({ answerEvidence: { passed: true, held: false } });
    expect(logged.mock.calls.some(([line]) => String(line).includes("saved claims could not be built"))).toBe(true);
    logged.mockRestore();
  });

  it("makes no binding when the tools returned no fee record, so the answer saves as before", async () => {
    answersFrom(PASSING, [TOOL_OUTPUT]);
    await POST(request());
    expect(mocks.save.mock.calls[0][0].response).not.toHaveProperty("narrativeBinding");
    expect(mocks.save.mock.calls[0][0].response).not.toHaveProperty("claims");
    expect(metadata()).not.toHaveProperty("narrativeBinding");
  });

  it("with the held line on, sends the binding on the first chunk so a left-out sentence never shows", async () => {
    mocks.held.message = "Synthetic held line.";
    answersFrom(BOUND, [PROFILE, OTHER, TOOL_OUTPUT]);
    await POST(request());
    expect(mocks.merge).toHaveBeenCalledTimes(1);
    const start = streamOptions[0].messageMetadata?.({ part: { type: "start" } }) as { narrativeBinding: { omitted: unknown[] } };
    expect(start.narrativeBinding.omitted).toHaveLength(1);
    expect(streamOptions[0].messageMetadata?.({ part: { type: "finish" } })).toBeUndefined();
  });

  it("holds an answer that has nothing left once the contradicted sentences go", async () => {
    mocks.held.message = "Synthetic held line.";
    answersFrom("## Hamilton's View\nSynthetic Bank A charges $35 for an overdraft.", [PROFILE, OTHER]);
    await POST(request());
    expect(mocks.merge).not.toHaveBeenCalled();
    expect(mocks.save).not.toHaveBeenCalled();
    expect(metadata()).toEqual(expect.objectContaining({ answerEvidence: { passed: true, held: true } }));
    expect(metadata()).not.toHaveProperty("narrativeBinding");
  });
});

describe("the one output gate in shadow (#1077, claim contract step 4)", () => {
  const shadowRecords = () => mocks.shadow.mock.calls.map(([input]) => input.detail.gate_shadow);
  const noMode = (text = "How does our overdraft fee compare?") => new Request("https://example.test/api/research/hamilton", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text }] }], institutionId: 202 }),
  });

  it("records the unified verdict beside today's on an Analyze answer, and changes nothing the reader gets", async () => {
    mocks.held.message = "Synthetic held line.";
    answers(PASSING);
    await POST(request());
    expect(shadowRecords()).toEqual([expect.objectContaining({ surface: "written_answer", path: "written_streaming", mode: "analyze",
      today: "shown", unified: "validated", agrees: true, disagreement: null })]);
    expect(mocks.shadow.mock.calls[0][0]).toMatchObject({ operation: "answer_gate_shadow", userId: 7, detail: { research_institution_id: 202 } });
    expect(mocks.merge).toHaveBeenCalledTimes(1);
    expect(metadata()).toMatchObject({ savedAnalysisId: "saved-1", answerEvidence: { passed: true, held: false } });
  });

  it("gates an admin chat that sends no mode, in shadow only: the answer still streams ungated and unsaved", async () => {
    mocks.held.message = "Synthetic held line.";
    answers(UNTRACED);
    await POST(noMode());
    expect(mocks.merge).toHaveBeenCalledTimes(1);
    expect(mocks.save).not.toHaveBeenCalled();
    expect(metadata()).not.toHaveProperty("answerEvidence");
    const [record] = shadowRecords();
    expect(record).toMatchObject({ mode: null, today: "shown_ungated", unified: "held", agrees: false, disagreement: "unified_holds" });
    expect(record.critical).toContain("untraced_figure");
  });

  it("counts a held Analyze answer the unified gate also holds as agreement", async () => {
    mocks.held.message = "Synthetic held line.";
    answers(UNTRACED);
    await POST(request());
    expect(shadowRecords()).toEqual([expect.objectContaining({ today: "held", unified: "held", agrees: true })]);
  });

  it("gives the streaming and the buffered path the same verdict for the same steps", async () => {
    const text = "## Evidence\n" + Array.from({ length: 5 }, () => "The overdraft fee of $35 sits above the peer median of $29 per the fee schedule.").join("\n");
    answers(text);
    await POST(request());
    mocks.generate.mockResolvedValueOnce({ text, finishReason: "stop", steps: [{ toolResults: [{ output: TOOL_OUTPUT }] }], totalUsage: {} });
    await POST(new Request("https://example.test/api/research/hamilton", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: "How does our overdraft fee compare?" }] }], mode: "analyze", institutionId: 202, gate_citations: true }) }));
    const [streaming, buffered] = shadowRecords();
    expect(streaming.path).toBe("written_streaming");
    expect(buffered.path).toBe("written_buffered");
    expect({ unified: buffered.unified, codes: buffered.codes }).toEqual({ unified: streaming.unified, codes: streaming.codes });
  });

  it("records a shadow that could not run without changing today's hold", async () => {
    mocks.held.message = "Synthetic held line.";
    mocks.gateThrows = true;
    answers(PASSING);
    await POST(request());
    expect(mocks.merge).not.toHaveBeenCalled();
    expect(metadata()).toEqual(expect.objectContaining({ answerEvidence: { passed: false, held: true } }));
    expect(shadowRecords()).toEqual([expect.objectContaining({ today: "held", error: "gate_threw" })]);
  });

  it("answers while the shadow write is still pending, on the streaming and the buffered path", async () => {
    answers(PASSING);
    const streamed = await POST(request());
    expect(streamed.status).toBe(200);
    mocks.generate.mockResolvedValueOnce({ text: PASSING, finishReason: "stop", steps: [{ toolResults: [{ output: TOOL_OUTPUT }] }], totalUsage: {} });
    const buffered = await POST(new Request("https://example.test/api/research/hamilton", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ messages: [{ role: "user", parts: [{ type: "text", text: "How does our overdraft fee compare?" }] }], mode: "analyze", institutionId: 202, gate_citations: true }) }));
    expect(buffered.status).toBe(200);
    // Both writes started and neither has settled (the mock never resolves), yet both responses are back.
    expect(mocks.shadow).toHaveBeenCalledTimes(2);
  });

  it("computes the shadow after the response, from inputs captured before it", async () => {
    mocks.deferAfter = true;
    answers(PASSING);
    await POST(request());
    expect(mocks.shadow).not.toHaveBeenCalled();
    expect(mocks.afterTasks).toHaveLength(1);
    for (const task of mocks.afterTasks) void task();
    await vi.waitFor(() => expect(mocks.shadow).toHaveBeenCalledTimes(1));
    expect(shadowRecords()).toEqual([expect.objectContaining({ path: "written_streaming", today: "shown", unified: "validated" })]);
  });
});
