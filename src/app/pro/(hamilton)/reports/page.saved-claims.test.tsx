/**
 * The board-brief editor is a client component: a saved answer handed to it never carries the
 * answer's saved claims (#1077 step 6, PR #2583 review). Its source lines are built on the server
 * from those claims and passed instead (#1077, Cycle A defect 5).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import { NARRATIVE_BINDING_VERSION } from "@/lib/hamilton/narrative-bound";
import { SAVED_CLAIMS_VERSION } from "@/lib/hamilton/saved-claims";

const mocks = vi.hoisted(() => ({ user: vi.fn(), load: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
// The server read is mocked, the loaders above it are real: a page that strips the claims before building the lines would be caught.
vi.mock("@/lib/hamilton/saved-analysis-record", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/hamilton/saved-analysis-record")>()), readSavedAnalysisRecord: mocks.load }));
vi.mock("@/components/hamilton/reports/BoardBriefEditor", () => ({ BoardBriefEditor: () => null }));

import ReportsPage from "./page";

// Synthetic saved answer: one supported fee sentence and the claim fact it cites.
const sentence = "Synthetic Bank charges $37 for an overdraft.";
const factId = "fee:published:9";
const responseJson = {
  title: "Saved A", hamiltonView: sentence, whatThisMeans: "", whyItMatters: [], evidence: { metrics: [] }, exploreFurther: [], confidence: { level: "medium", basis: [] },
  answerEvidence: { passed: true, problems: [] },
  narrativeBinding: { version: NARRATIVE_BINDING_VERSION, supported: [{ text: sentence, factIds: [factId] }], interpretation: [], omitted: [], limitations: [] },
};
const claims = {
  version: SAVED_CLAIMS_VERSION, bindingVersion: NARRATIVE_BINDING_VERSION, claims: [{ text: sentence, outcome: "supported", factIds: [factId] }],
  facts: [{ id: factId, kind: "observed", value: 37, unit: "usd", institutionId: 2945, feeCategory: "overdraft", metric: null, reportingDate: null, periodBasis: null, asOf: null }],
  factsTruncated: false, corrections: [],
};

describe("Reports page from a saved answer", () => {
  beforeEach(() => {
    mocks.user.mockReset().mockResolvedValue({ id: 7, role: "premium", subscription_status: "active" });
    mocks.load.mockReset().mockResolvedValue({ id: "saved-a", institutionId: "2945", responseJson: { ...responseJson, claims } });
  });

  it("hands the board-brief editor the saved answer without its claims, and the source lines built from them", async () => {
    const page = await ReportsPage({ searchParams: Promise.resolve({ from_analysis: "saved-a" }) });
    expect(mocks.load).toHaveBeenCalledWith("saved-a");
    expect(page.props.analysis).toEqual(responseJson);
    expect(page.props.analysis).not.toHaveProperty("claims");
    expect(page.props.writtenSources.lines).toEqual([expect.objectContaining({ id: factId, value: 37, complete: true })]);
    expect(JSON.stringify(page.props.writtenSources)).not.toContain("\"claims\"");
  });
});
