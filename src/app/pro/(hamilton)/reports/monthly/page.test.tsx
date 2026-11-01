import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildMonthlyBriefing, editMonthlyBriefing, monthlyBriefingReport } from "@/lib/hamilton/monthly-briefing";

/**
 * /pro/reports/monthly (#1897): build this month's briefing on request, list earlier ones, and open
 * a saved briefing with its six sections, each figure's source and period, and the edit controls.
 */
const NAME = "Harbor Ridge Test Bank";
const briefing = buildMonthlyBriefing({
  now: new Date("2026-10-25T12:00:00Z"),
  institution: { id: 7, name: NAME, charterType: "bank" },
  financial: null,
  financialPeerLabel: "banks in the same asset-size tier",
  competition: {
    peerLabel: "Ohio community banks",
    peerSource: "saved-peer-set",
    fallbackReason: null,
    peerAsOf: "2026-10-24T08:00:00Z",
    fees: [{ feeCategory: "overdraft", own: 35, ownAsOf: "2026-09-02T00:00:00Z", ownUrl: null, peerMedian: 30, peerCount: 42 }],
  },
  economy: null,
  regulation: [],
});

const state = vi.hoisted(() => ({
  institution: null as null | { id: number; name: string },
  saved: null as unknown,
  recent: [] as unknown[],
  byTypeParams: null as unknown,
}));

vi.mock("next/navigation", () => ({ redirect: vi.fn(), useRouter: () => ({ replace: vi.fn() }) }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: vi.fn(async () => ({ id: 1 })) }));
vi.mock("@/lib/team-billing", () => ({ redirectWithoutPremium: vi.fn(async () => undefined) }));
vi.mock("@/lib/hamilton/workspace-context", () => ({
  resolveHamiltonInstitutionContext: vi.fn(async () => ({ institution: state.institution, error: null, source: "manual" })),
}));
vi.mock("@/lib/hamilton/pro-tables", () => ({
  getHamiltonReportById: vi.fn(async () => state.saved),
  getHamiltonReportsByType: vi.fn(async (params: { userId: number; reportType: string; institutionId: string }) => {
    state.byTypeParams = params;
    return state.recent;
  }),
}));
vi.mock("./actions", () => ({ createMonthlyBriefing: vi.fn(), saveMonthlyBriefing: vi.fn() }));

import MonthlyBriefingPage from "./page";

async function render(params: Record<string, string> = {}) {
  const markup = renderToStaticMarkup(await MonthlyBriefingPage({ searchParams: Promise.resolve(params) }));
  return { markup, text: new DOMParser().parseFromString(markup, "text/html").body.textContent ?? "" };
}

describe("/pro/reports/monthly (#1897)", () => {
  beforeEach(() => {
    state.institution = { id: 7, name: NAME };
    state.saved = null;
    state.recent = [];
  });

  it("asks for an institution when none is chosen", async () => {
    state.institution = null;
    expect((await render()).text).toContain("Choose your institution");
  });

  it("offers this month's briefing on request, with the six sections named and nothing scheduled", async () => {
    const { markup, text } = await render();
    expect(text).toMatch(/Build the \w+ \d{4} briefing/);
    for (const heading of ["Summary", "Financials", "Competition", "Market", "Regulation", "Management considerations"]) expect(text).toContain(heading);
    expect(text).toContain("Nothing is scheduled or sent by email.");
    expect(markup).toContain('name="instId" value="7"');
    expect(text).toContain(`No briefings for ${NAME} yet.`);
  });

  it("lists this institution's earlier briefings, read by type with no age limit", async () => {
    state.recent = [{ id: "a", title: "Lakeshore: monthly briefing, March 2025", created_at: "2025-03-25T12:00:00Z" }];
    const { markup, text } = await render();
    expect(state.byTypeParams).toEqual({ userId: 1, reportType: "monthly_briefing", institutionId: "7" });
    expect(markup).toContain("/pro/reports/monthly?report_id=a");
    expect(text).toContain("March 2025");
    expect(text).toContain("Built Mar 25, 2025");
  });

  it("opens a saved briefing with every figure's source and period and the edit controls", async () => {
    state.saved = { id: "r1", report_type: "monthly_briefing", report_json: monthlyBriefingReport(briefing) };
    const { text } = await render({ report_id: "r1" });
    expect(text).toContain(`${NAME}: monthly briefing, October 2026`);
    expect(text).toContain("Bank Fee Index, Ohio community banks, 42 institutions · As of Oct 24, 2026");
    expect(text).toContain("Published Sep 2, 2026");
    expect(text).toContain("Edit words");
    expect(text).toContain("Download PDF");
    expect(text).toContain("No call report filings are on file");
    expect(text).not.toContain("Words edited by your team");
  });

  it("marks a section the team rewrote", async () => {
    const edited = editMonthlyBriefing(monthlyBriefingReport(briefing), { title: "", sections: { market: "Our reading." } });
    state.saved = { id: "r1", report_type: "monthly_briefing", report_json: edited };
    const { text } = await render({ report_id: "r1" });
    expect(text).toContain("Our reading.");
    expect(text).toContain("Words edited by your team.");
  });

  it("refuses a report that is not a monthly briefing", async () => {
    state.saved = { id: "r2", report_type: "board_brief", report_json: { title: "x" } };
    expect((await render({ report_id: "r2" })).text).toContain("Saved briefing not found");
  });
});
