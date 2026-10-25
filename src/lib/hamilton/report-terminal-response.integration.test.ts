/** @vitest-environment node */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { SectionInput } from "./types";

const fixture = vi.hoisted(() => ({
  sql: vi.fn(), assemble: vi.fn(), save: vi.fn(), pro: vi.fn(), usage: vi.fn(),
  budget: vi.fn(), review: vi.fn(), stop: vi.fn(),
}));
vi.mock("@/lib/data-store/connection", async (original) => ({ ...await original<typeof import("@/lib/data-store/connection")>(), sql: fixture.sql }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: async () => ({ id: 7, role: "premium", subscription_status: "active" }) }));
vi.mock("@/lib/hamilton/report-inputs", () => ({ assembleReportInputs: fixture.assemble }));
vi.mock("@/lib/hamilton/partner-review", () => ({ reviewAnswerPage: fixture.review, partnerReviewContext: () => "Review the same supplied figures." }));
vi.mock("@/lib/hamilton/pro-tables", () => ({ saveHamiltonReport: fixture.save }));
vi.mock("@/lib/hamilton/refresh-jobs", () => ({ completeHamiltonRefreshJobsForInstitution: async () => undefined }));
vi.mock("@/lib/hamilton/quota", () => ({ checkProAiQuota: async () => ({ allowed: true }), quotaExceededMessage: () => "quota" }));
vi.mock("@/lib/hamilton/report-cap", () => ({ checkConsultantReportCap: async () => ({ allowed: true }), reportCapMessage: () => "cap" }));
vi.mock("@/lib/agents/run-store", () => ({ recordProRequest: fixture.pro }));
vi.mock("@/lib/research/history", () => ({ logUsage: fixture.usage }));
vi.mock("@/lib/automation-control", async (original) => ({ ...await original<typeof import("@/lib/automation-control")>(),
  assertAutomationEnabled: async () => ({ enabled: true }), findOpenProviderCreditFailure: async () => null, engageEmergencyStop: fixture.stop,
}));
vi.mock("@/lib/api-hardening/budget", async (original) => ({ ...await original<typeof import("@/lib/api-hardening/budget")>(), assertProviderBudgetAllowed: fixture.budget }));
vi.mock("@/lib/api-hardening/audit", () => ({ recordApiRouteAuditEvent: async () => undefined }));

import { generateReport } from "@/app/pro/(hamilton)/reports/actions";
import { generateSection } from "./generate";

interface Reply { stop: string | null; input: number; output: number; text?: string; wait?: Promise<void>; unknownUsage?: boolean }
let replies: Reply[] = [];
let fetches = 0;
const ordinary = "The fee is $32 and the peer median is $29.50.";
const sectionInputs: SectionInput[] = ["overview", "strategic", "recommendation"].map((type) => ({
  type: type as SectionInput["type"], title: `Owned ${type}`, data: { current_amount: 32, peer_median: 29.5 },
}));
const params = { templateType: "competitive_positioning" as const, institutionId: 1, dateFrom: "2026-01-01", dateTo: "2026-06-30" };
const queryText = (input: unknown) => Array.isArray(input) ? input.join(" ") : String(input);
const providerEvents = () => fixture.sql.mock.calls.filter((call) => queryText(call[0]).includes("INSERT INTO ai_api_usage_events"));
function deferred() { let resolve!: () => void; const promise = new Promise<void>((done) => { resolve = done; }); return { promise, resolve }; }

beforeEach(() => {
  replies = []; fetches = 0;
  fixture.sql.mockReset().mockResolvedValue([]);
  fixture.save.mockReset().mockResolvedValue("owned-report");
  fixture.pro.mockReset().mockResolvedValue(1);
  fixture.usage.mockReset().mockResolvedValue(undefined);
  fixture.stop.mockReset();
  fixture.budget.mockReset().mockResolvedValue({ allowed: true, policyId: 1 });
  fixture.review.mockReset().mockReturnValue([]);
  fixture.assemble.mockReset().mockResolvedValue({
    kind: "ready", sectionInputs, institutionName: "Fixture CU", reportTitle: "Fixture fee comparison", period: "2026",
    selectedInstitution: { id: 1, institution_name: "Fixture CU" },
    selectedInstitutionData: { can_generate_verified_benchmark_conclusions: true },
    selectedFeeDeltas: [{ fee_category: "overdraft", institution_amount: 32, peer_median: 29.5, delta_amount: 2.5, evidence_tier: "verified" }],
    topCategories: [], indexData: [{}], peerIndex: { label: "Fixture peers", stamp: {}, peerSetId: null, source: "national", fallbackReason: null },
    exhibitSet: { data: { local_market: null }, exhibits: [], sources: [] }, feeIncomeTrend: null,
    regulatory: { sources: [], exhibit: null }, addedFindings: [], evidencePolicy: "verified-only",
    selectedSourceContext: { selectedSource: "url", selectedSourceLabel: "Fixture selection" },
    selectedVerifiedFees: [{ id: 1, institution_id: 1 }], selectedProvisionalFees: [],
  });
  vi.stubEnv("ANTHROPIC_API_KEY", "synthetic-only");
  vi.stubEnv("ANTHROPIC_API_KEY_HAMILTON", "synthetic-only");
  vi.stubEnv("ANTHROPIC_AUTH_TOKEN", "");
  vi.stubEnv("ANTHROPIC_BASE_URL", "https://fixture.invalid");
  vi.stubGlobal("fetch", vi.fn(async (url, init) => {
    if (String(url) !== "https://fixture.invalid/v1/messages") throw new Error("Unexpected synthetic fetch URL");
    const reply = replies[fetches++];
    if (!reply) throw new Error("Unexpected extra paid request");
    await reply.wait;
    const request = JSON.parse(String(init?.body)) as { model: string; stop_sequences?: string[] };
    expect(request.stop_sequences).toBeUndefined();
    return new Response(JSON.stringify({ id: "msg_fixture", type: "message", role: "assistant", model: request.model,
      content: [{ type: "text", text: reply.text ?? ordinary, citations: null }], stop_reason: reply.stop, stop_sequence: null, stop_details: null,
      usage: reply.unknownUsage ? undefined : { input_tokens: reply.input, output_tokens: reply.output, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    }), { headers: { "content-type": "application/json" } });
  }));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

// The report's own request runs. Each kept section's shadow output gate verdict is its own
// `answer_gate_shadow` run (#1077 step 6), recorded beside the outcome and never part of it.
const reportRuns = () => fixture.pro.mock.calls.filter(([run]) => run.operation !== "answer_gate_shadow");

function expectOneOutcome(status: "completed" | "failed", input: number, output: number) {
  expect(reportRuns()).toHaveLength(1);
  expect(reportRuns()[0][0]).toMatchObject({ status, detail: { input_tokens: input, output_tokens: output } });
  expect(fixture.usage).toHaveBeenCalledTimes(1);
  expect(fixture.usage.mock.calls[0].slice(0, 5)).toEqual([7, null, "hamilton-report", input, output]);
  expect(fixture.stop).not.toHaveBeenCalled();
}

describe("actual raw report completion and final request accounting", () => {
  it("saves an ordinary end_turn report with one user outcome", async () => {
    replies = [10, 20, 30].map((input) => ({ stop: "end_turn", input, output: input / 10 }));
    expect(await generateReport(params)).toMatchObject({ success: true, reportId: "owned-report" });
    expect(fetches).toBe(3); expect(fixture.save).toHaveBeenCalledTimes(1);
    expectOneOutcome("completed", 60, 6);
    // One shadow gate run per kept section, from the real generateVerifiedSection, with no extra provider call.
    const shadows = fixture.pro.mock.calls.filter(([run]) => run.operation === "answer_gate_shadow");
    expect(shadows.map(([run]) => run.detail.gate_shadow)).toEqual(Array.from({ length: 3 }, () => expect.objectContaining({ surface: "report_section", today: "shown" })));
  });

  it("records one final failure when saving rejects after all paid generation settled", async () => {
    replies = [10, 20, 30].map((input) => ({ stop: "end_turn", input, output: input / 10 }));
    fixture.save.mockRejectedValue(new Error("fixture save unavailable"));
    expect(await generateReport(params)).toMatchObject({ success: false, error: expect.stringContaining("save unavailable") });
    expect(fetches).toBe(3); expect(fixture.save).toHaveBeenCalledTimes(1);
    expectOneOutcome("failed", 60, 6);
    expect(providerEvents().map((event) => event[5])).toEqual(["completed", "completed", "completed"]);
  });

  it("does not repeat paid work or the outcome when final receipt storage rejects", async () => {
    replies = [10, 20, 30].map((input) => ({ stop: "end_turn", input, output: input / 10 }));
    fixture.save.mockRejectedValue(new Error("fixture save unavailable"));
    fixture.pro.mockRejectedValue(new Error("fixture receipt unavailable"));
    expect(await generateReport(params)).toMatchObject({ success: false });
    expect(fetches).toBe(3); expect(fixture.save).toHaveBeenCalledTimes(1);
    expectOneOutcome("failed", 60, 6);
  });

  it("settles two unfinished follow-ups then emits one failure without saving or paid retry", async () => {
    replies = [{ stop: "end_turn", input: 10, output: 1 }, { stop: "max_tokens", input: 20, output: 2 }, { stop: "max_tokens", input: 30, output: 3 }];
    expect(await generateReport(params)).toMatchObject({ success: false });
    expect(fetches).toBe(3); expect(fixture.save).not.toHaveBeenCalled();
    expectOneOutcome("failed", 60, 6);
    expect(providerEvents().map((event) => event[5]).sort()).toEqual(["completed", "failed", "failed"]);
  });

  it.each([false, true])("keeps zero versus missing report usage explicit (unknown=%s)", async (unknownUsage) => {
    replies = [{ stop: "max_tokens", input: 0, output: 0, unknownUsage }];
    expect(await generateReport(params)).toMatchObject({ success: false });
    expect(fetches).toBe(1); expect(fixture.save).not.toHaveBeenCalled();
    expectOneOutcome("failed", 0, 0);
    expect(reportRuns()[0][0]).toMatchObject({ detail: {
      estimated_cost_microusd: unknownUsage ? null : 0,
      provider_response_events: 1, unknown_usage_response_events: unknownUsage ? 1 : 0,
      token_counts_include_unknown_placeholders: unknownUsage,
    } });
  });

  it.each([false, true])("waits for the successful/failed sibling before its single receipt (failure waits=%s)", async (failureWaits) => {
    const gate = deferred();
    replies = [{ stop: "end_turn", input: 10, output: 1 },
      { stop: "max_tokens", input: 20, output: 2, ...(failureWaits ? { wait: gate.promise } : {}) },
      { stop: "end_turn", input: 30, output: 3, ...(!failureWaits ? { wait: gate.promise } : {}) }];
    const result = generateReport(params);
    await vi.waitFor(() => expect(fetches).toBe(3));
    expect(fixture.pro).not.toHaveBeenCalled(); expect(fixture.usage).not.toHaveBeenCalled();
    gate.resolve();
    expect(await result).toMatchObject({ success: false });
    expect(fixture.save).not.toHaveBeenCalled(); expectOneOutcome("failed", 60, 6);
  });

  it("keeps both physical responses when figure regeneration ends incomplete", async () => {
    replies = [{ stop: "end_turn", input: 10, output: 1, text: "The fee is $999." }, { stop: "max_tokens", input: 20, output: 2 }];
    expect(await generateReport(params)).toMatchObject({ success: false });
    expect(fetches).toBe(2); expect(fixture.save).not.toHaveBeenCalled();
    expectOneOutcome("failed", 30, 3);
    expect(providerEvents().map((event) => event[5])).toEqual(["completed", "failed"]);
  });

  it("retains the valid original after an unfinished partner rewrite and counts its usage", async () => {
    fixture.review.mockReturnValueOnce(["Name the supplied peer median."]);
    replies = [{ stop: "end_turn", input: 10, output: 1 }, { stop: "max_tokens", input: 20, output: 2, text: "UNFINISHED REWRITE" },
      { stop: "end_turn", input: 30, output: 3 }, { stop: "end_turn", input: 40, output: 4 }];
    expect(await generateReport(params)).toMatchObject({ success: true });
    expect(fetches).toBe(4); expect(fixture.save).toHaveBeenCalledTimes(1);
    const saved = fixture.save.mock.calls[0][0] as { reportJson: { executiveSummary: string[] } };
    expect(saved.reportJson.executiveSummary).toContain(ordinary);
    expect(JSON.stringify(saved)).not.toContain("UNFINISHED REWRITE");
    expectOneOutcome("completed", 100, 10);
  });

  it("does not repeat a provider call when its observation callback fails", async () => {
    replies = [{ stop: "end_turn", input: 0, output: 0 }];
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    expect(await generateSection(sectionInputs[0], { onProviderResponse: () => { throw new Error("fixture observer"); } })).toMatchObject({ narrative: ordinary });
    expect(fetches).toBe(1);
    vi.restoreAllMocks();
  });

  it("pre-call budget denial makes no provider request and no user model-call quota row", async () => {
    fixture.budget.mockResolvedValue({ allowed: false, reasonCode: "budget_daily_exhausted", policyId: 1, message: "Fixture budget denial" });
    expect(await generateReport(params)).toMatchObject({ success: false });
    expect(fetches).toBe(0); expect(fixture.save).not.toHaveBeenCalled(); expect(fixture.usage).not.toHaveBeenCalled();
    expect(fixture.pro).toHaveBeenCalledTimes(1);
    // A budget denial is never retried (#1921, task-faults.ts): one blocked row, no provider call.
    expect(providerEvents().map((event) => event[5])).toEqual(["blocked"]);
  });
});
