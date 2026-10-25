import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ user: vi.fn(), analysis: vi.fn(), report: vi.fn(), save: vi.fn(), sql: vi.fn(), run: vi.fn(), load: vi.fn(), input: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
// The server read is mocked, the loaders above it are real: a save that strips the claims on the way would be caught.
vi.mock("@/lib/hamilton/saved-analysis-record", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/hamilton/saved-analysis-record")>()), readSavedAnalysisRecord: mocks.analysis }));
vi.mock("@/lib/hamilton/pro-tables", () => ({ getHamiltonReportById: mocks.report, saveHamiltonReport: mocks.save }));
vi.mock("@/lib/data-store/connection", () => ({ sql: mocks.sql }));
vi.mock("@/lib/agents/run-store", () => ({ recordProRequest: mocks.run }));
vi.mock("next/navigation", () => ({ redirect: (to: string) => { throw new Error(`REDIRECT ${to}`); } }));
vi.mock("@/components/hamilton/intelligence/IntelligenceWorkspace", () => ({ loadIntelligence: mocks.load }));
vi.mock("@/components/hamilton/intelligence/market-board-brief", () => ({ marketBoardBriefInput: mocks.input }));
import { createMarketBoardBrief, saveBoardBrief } from "./board-actions";
import { encodeLandingResearch } from "@/lib/hamilton/landing-research-handoff";
import { boardBriefFromAnalysis } from "@/lib/hamilton/board-brief";
import { REPORT_START_BLOCKED_MESSAGE } from "@/lib/report-access";
import { NARRATIVE_BINDING_VERSION } from "@/lib/hamilton/narrative-bound";
import { SAVED_CLAIMS_VERSION } from "@/lib/hamilton/saved-claims";
const edits = { title: "Board review", teamNote: "Our note", includeEvidence: true };
const response = { title: "Saved answer", confidence: { level: "medium" as const, basis: ["Limited"] }, hamiltonView: "Original answer", whatThisMeans: "Original context", whyItMatters: [], evidence: { metrics: [{ label: "Fee", value: "$0.00", note: "Published schedule · 2026-06-30" }] }, exploreFurther: ["Inspect terms"] };
beforeEach(() => { vi.clearAllMocks(); mocks.user.mockResolvedValue({ id: 7, role: "user", subscription_status: "active", subscription_tier: "pro" }); mocks.save.mockResolvedValue("report-id"); mocks.run.mockResolvedValue(undefined); });
describe("private board brief writes", () => {
  it("denies unauthenticated saves before reading source artifacts", async () => {
    mocks.user.mockResolvedValue(null);
    expect(await saveBoardBrief({ analysisId: "other", edits })).toMatchObject({ success: false });
    expect(mocks.analysis).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("should_block_new_or_edited_board_briefs_when_cancelled (#1999)", async () => {
    mocks.user.mockResolvedValue({ id: 7, role: "user", subscription_status: "canceled" });
    expect(await saveBoardBrief({ analysisId: "mine", edits })).toEqual({ success: false, error: REPORT_START_BLOCKED_MESSAGE });
    expect(await saveBoardBrief({ reportId: "mine", edits })).toEqual({ success: false, error: REPORT_START_BLOCKED_MESSAGE });
    expect(mocks.analysis).not.toHaveBeenCalled(); expect(mocks.report).not.toHaveBeenCalled(); expect(mocks.save).not.toHaveBeenCalled();
  });
  it("refuses a missing/inaccessible source without accepting browser evidence", async () => {
    mocks.analysis.mockResolvedValue(null);
    expect(await saveBoardBrief({ analysisId: "other", edits })).toMatchObject({ success: false });
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("uses the authenticated saved subject and evidence, with no research regeneration", async () => {
    mocks.analysis.mockResolvedValue({ id: "original", institutionId: "2", responseJson: response });
    expect(await saveBoardBrief({ analysisId: "original", edits })).toEqual({ success: true, reportId: "report-id" });
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, institutionId: "2", reportType: "board_brief", evidencePolicy: "source-diligence", reportJson: expect.objectContaining({ executiveSummary: ["Original answer"] }) }));
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.objectContaining({ provider_call_queued: false, analysis_id: "original" }) }));
  });
  it("lists a written answer's sources from the claims saved with it, and saves no claims in the brief (#1077, Cycle A defect 5)", async () => {
    // Synthetic saved answer: one supported fee sentence and the claim fact it cites.
    const factId = "fee:published:9";
    const sentence = "Research Bank charges $37 for an overdraft.";
    const written = { ...response, hamiltonView: sentence, answerEvidence: { passed: true, problems: [] },
      narrativeBinding: { version: NARRATIVE_BINDING_VERSION, supported: [{ text: sentence, factIds: [factId] }], interpretation: [], omitted: [], limitations: [] },
      claims: { version: SAVED_CLAIMS_VERSION, bindingVersion: NARRATIVE_BINDING_VERSION, claims: [{ text: sentence, outcome: "supported" as const, factIds: [factId] }],
        facts: [{ id: factId, kind: "observed" as const, value: 37, unit: "usd" as const, institutionId: 2, feeCategory: "overdraft", metric: null, reportingDate: null, periodBasis: null, asOf: null }],
        factsTruncated: false, corrections: [] } };
    mocks.analysis.mockResolvedValue({ id: "original", institutionId: "2", responseJson: written });
    expect(await saveBoardBrief({ analysisId: "original", edits })).toEqual({ success: true, reportId: "report-id" });
    const saved = mocks.save.mock.calls[0][0].reportJson;
    const records = saved.exhibits.find((e: { id: string }) => e.id === "evidence_records");
    expect(records?.rows).toEqual([["Overdraft (OD), Institution 2", "$37", "Published fee catalog · record fee:published:9 · date not recorded", "Matches the saved record"]]);
    expect(JSON.stringify(saved)).not.toContain("\"claims\"");
  });
  it("rejects another user's report before the UPDATE", async () => {
    mocks.report.mockResolvedValue(null);
    expect(await saveBoardBrief({ reportId: "other", edits })).toMatchObject({ success: false });
    expect(mocks.report).toHaveBeenCalledWith("other", 7); expect(mocks.sql).not.toHaveBeenCalled();
  });
  it("scopes updates to user and board type while preserving frozen facts", async () => {
    const report = boardBriefFromAnalysis(response, "original", edits);
    mocks.report.mockResolvedValue({ report_type: "board_brief", report_json: report, institution_id: "2" }); mocks.sql.mockResolvedValue([{ id: "owned" }]);
    expect(await saveBoardBrief({ reportId: "owned", edits: { ...edits, teamNote: "Changed" } })).toEqual({ success: true, reportId: "owned" });
    const [strings, json, id, userId] = mocks.sql.mock.calls[0];
    expect(strings.join("")).toContain("AND user_id ="); expect(strings.join("")).toContain("report_type = 'board_brief'");
    expect(id).toBe("owned"); expect(userId).toBe(7); expect(JSON.parse(json).exhibits).toEqual(report.exhibits);
  });
});

describe("Build board brief from a market view", () => {
  const florida = { version: 1 as const, task: "compare" as const, scope: { kind: "state" as const, stateCode: "FL" as const }, categories: ["overdraft"], charter: "all" as const };
  const form = (fields: Record<string, string>) => { const f = new FormData(); for (const [k, v] of Object.entries(fields)) f.set(k, v); return f; };
  const marketInput = { place: "Florida", scopeLabel: "Banks & credit unions, headquartered in Florida", topics: "fees", findings: [{ title: "Florida's median overdraft is $30.00.", body: "Across 40 institutions.", source: "Bank Fee Index published catalog" }], exhibits: [], sources: [], limits: ["Hamilton reports what the data shows. It does not recommend a price."], researchHref: "/pro/intelligence" };
  beforeEach(() => { mocks.load.mockResolvedValue({}); mocks.input.mockReturnValue(marketInput); });

  it("sends a non-subscriber to /subscribe before loading data", async () => {
    mocks.sql.mockResolvedValue([]); // not a seat on a lapsed team
    mocks.user.mockResolvedValue({ id: 7, role: "user", subscription_status: "none" });
    await expect(createMarketBoardBrief(form({ research: encodeLandingResearch(florida) }))).rejects.toThrow("REDIRECT /subscribe");
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it("refuses a local selection", async () => {
    const local = { ...florida, scope: { kind: "local" as const, institutionId: 8109 } };
    await expect(createMarketBoardBrief(form({ research: encodeLandingResearch(local) }))).rejects.toThrow("REDIRECT /pro/hamilton");
    expect(mocks.save).not.toHaveBeenCalled();
  });
  it("keeps only known lenses and sizes, saves under the user and records every lens it read", async () => {
    await expect(createMarketBoardBrief(form({ research: encodeLandingResearch(florida), lenses: "fees,bogus", size: "huge" }))).rejects.toThrow("REDIRECT /pro/reports?report_id=report-id");
    expect(mocks.load).toHaveBeenCalledWith(expect.objectContaining({ task: "compare" }), ["fees"], expect.objectContaining({ segment: null }));
    expect(mocks.save).toHaveBeenCalledWith(expect.objectContaining({ userId: 7, institutionId: "", reportType: "board_brief" }));
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.objectContaining({ provider_call_queued: false, lenses: ["fees"] }) }));
  });
  it("records the default lenses when none are posted", async () => {
    await expect(createMarketBoardBrief(form({ research: encodeLandingResearch(florida) }))).rejects.toThrow("REDIRECT /pro/reports?report_id=report-id");
    const lenses = mocks.load.mock.calls[0][1];
    expect(lenses.length).toBeGreaterThan(1);
    expect(mocks.run).toHaveBeenCalledWith(expect.objectContaining({ detail: expect.objectContaining({ lenses }) }));
  });
  it("saves nothing when no data loaded and shows the error", async () => {
    mocks.input.mockReturnValue({ ...marketInput, findings: [], exhibits: [] });
    await expect(createMarketBoardBrief(form({ research: encodeLandingResearch(florida) }))).rejects.toThrow("REDIRECT /pro/reports?board_error=1");
    expect(mocks.save).not.toHaveBeenCalled();
  });
});
