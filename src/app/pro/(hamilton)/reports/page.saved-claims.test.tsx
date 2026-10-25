/**
 * The board-brief editor is a client component: a saved answer handed to it never carries the
 * answer's saved claims (#1077 step 6, PR #2583 review).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ user: vi.fn(), load: vi.fn() }));
vi.mock("next/navigation", () => ({ redirect: (url: string) => { throw new Error(url); } }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("../analyze/actions", () => ({ loadAnalysisRecord: mocks.load }));
vi.mock("@/components/hamilton/reports/BoardBriefEditor", () => ({ BoardBriefEditor: () => null }));

import ReportsPage from "./page";

const responseJson = { title: "Saved A", hamiltonView: "Synthetic view.", whatThisMeans: "", whyItMatters: [], evidence: { metrics: [] }, exploreFurther: [], confidence: { level: "medium", basis: [] } };

describe("Reports page from a saved answer", () => {
  beforeEach(() => {
    mocks.user.mockReset().mockResolvedValue({ id: 7, role: "premium", subscription_status: "active" });
    mocks.load.mockReset().mockResolvedValue({ id: "saved-a", institutionId: "2945", responseJson: { ...responseJson, claims: { version: 1, claims: [], facts: [] } } });
  });

  it("hands the board-brief editor the saved answer without its claims", async () => {
    const page = await ReportsPage({ searchParams: Promise.resolve({ from_analysis: "saved-a" }) });
    expect(mocks.load).toHaveBeenCalledWith("saved-a");
    expect(page.props.analysis).toEqual(responseJson);
    expect(page.props.analysis).not.toHaveProperty("claims");
  });
});
