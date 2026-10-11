import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Briefing } from "@/lib/hamilton/workspace/types";

const mocks = vi.hoisted(() => ({ user: vi.fn(), context: vi.fn(), briefing: vi.fn(), peer: vi.fn(), signals: vi.fn() }));
vi.mock("next/cache", () => ({ unstable_cache: (fn: unknown) => fn, unstable_noStore: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/hamilton/workspace-context", () => ({ resolveHamiltonInstitutionContext: mocks.context }));
vi.mock("@/lib/hamilton/workspace/research", () => ({ COMPETITOR_MOVE_WINDOW_DAYS: 90, getWorkspaceBriefing: mocks.briefing }));
vi.mock("@/lib/hamilton/active-peer-set", () => ({ getActivePeerSet: mocks.peer }));
vi.mock("@/lib/data-store/fee-index", () => ({ getCategoryChargeBases: async () => [] }));
vi.mock("@/lib/hamilton/home-data", () => ({ fetchHomeBriefingSignals: mocks.signals }));

import { InstitutionBriefing as HamiltonHomePage } from "@/components/hamilton/intelligence/InstitutionBriefing";

const subject = { id: 2945, name: "Space Coast Credit Union", stateCode: "FL" };
const localResearch = JSON.stringify({ version: 1, task: "compare", scope: { kind: "local", institutionId: 2945 }, categories: ["overdraft"], charter: "all" });
const briefing: Briefing = {
  institutionId: 2945, institutionName: subject.name, stateCode: "FL", observations: [],
  institutionFinancials: null, nationalIncome: null, nationalIncomeSeries: [], localMarket: null,
  feesReviewed: 1, positions: [{ feeCategory: "overdraft", displayName: "Overdraft", current: 30, band: { p25: 25, median: 30, p75: 35, n: 8 }, peerLabel: "Florida credit unions" }],
  peerLabel: "Florida credit unions", generatedAt: "2026-10-10T00:00:00Z",
  provenance: { engineVersion: "test", generatedAt: "2026-10-10T00:00:00Z", peerGroup: { label: "Florida credit unions", n: 8 }, dataAsOf: {}, sources: [], assumptions: [], clientFacts: [] },
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.user.mockResolvedValue({ id: 25, role: "premium", subscription_status: "active", institution_name: "Self reported institution" });
  mocks.context.mockImplementation(async ({ instId }: { instId?: string | null }) => ({ institution: instId === "2945" ? subject : null, source: instId ? "url" : "none", error: null }));
  mocks.briefing.mockResolvedValue(null);
  mocks.peer.mockResolvedValue(null);
  mocks.signals.mockResolvedValue({ whatChanged: [], priorityAlerts: [], monitorFeed: [] });
});

describe("retained institution briefing research identity", () => {
  it("uses the same explicit local research subject as the shell even without a saved default", async () => {
    const tree = await HamiltonHomePage({ searchParams: Promise.resolve({ research: localResearch }) });
    const html = renderToStaticMarkup(tree);
    expect(mocks.briefing).toHaveBeenCalledWith(2945, expect.any(Date), { peerSet: null });
    expect(html).toContain("Space Coast Credit Union");
    expect(html).not.toContain("Choose your bank");
  });

  it("retains a valid URL research identity when the engine has no briefing", async () => {
    const html = renderToStaticMarkup(await HamiltonHomePage({ searchParams: Promise.resolve({ instId: "2945" }) }));
    expect(mocks.context).toHaveBeenCalledWith(expect.objectContaining({ userId: 25, instId: "2945", persistUrlSelection: false }));
    expect(html).toContain("Space Coast Credit Union");
    expect(html).toContain("No monthly briefing is available");
    expect(html).not.toContain("Choose your bank");
  });

  it("names public research figures and asks about that institution without account pronouns", async () => {
    mocks.briefing.mockResolvedValue(briefing);
    const html = renderToStaticMarkup(await HamiltonHomePage({ searchParams: Promise.resolve({ instId: "2945" }) }));
    expect(mocks.peer).toHaveBeenCalledWith({ userId: 25, institutionId: 2945 });
    expect(html).toContain("Space Coast Credit Union");
    expect(html).not.toMatch(/your published|your fee|your call report|your state|>Yours</i);
    const rendered = document.createElement("div");
    rendered.innerHTML = html;
    const askLink = rendered.querySelector('a[href*="send=1"]') as HTMLAnchorElement;
    expect(new URL(askLink.href).searchParams.get("q")).toBe("How does Space Coast Credit Union's overdraft fee compare with peers?");
    expect(new URL(askLink.href).searchParams.get("instId")).toBe("2945");
  });

  it.each(["not-an-id", "0", "999999"])("does not query an unresolved URL institution %s", async (instId) => {
    const html = renderToStaticMarkup(await HamiltonHomePage({ searchParams: Promise.resolve({ instId }) }));
    expect(mocks.context).toHaveBeenCalledWith(expect.objectContaining({ userId: 25, instId, persistUrlSelection: false }));
    expect(mocks.briefing).not.toHaveBeenCalled();
    expect(mocks.peer).not.toHaveBeenCalled();
    expect(html).not.toContain("Self reported institution");
    expect(html).toContain("Choose a research institution");
  });

  it("does not retarget an explicit market research link to a stored or conflicting local subject", async () => {
    const research = JSON.stringify({ version: 1, task: "compare", scope: { kind: "national" }, categories: ["overdraft"], charter: "all" });
    const html = renderToStaticMarkup(await HamiltonHomePage({ searchParams: Promise.resolve({ instId: "2945", research }) }));
    expect(mocks.context).not.toHaveBeenCalled();
    expect(mocks.briefing).not.toHaveBeenCalled();
    expect(html).toContain("Open the research link in Ask Hamilton for market research");
    expect(html).not.toContain("Space Coast Credit Union");
  });

  it("keeps a named retry when briefing data fails and withholds a mismatched institution result", async () => {
    mocks.briefing.mockRejectedValueOnce(new Error("unavailable"));
    let html = renderToStaticMarkup(await HamiltonHomePage({ searchParams: Promise.resolve({ instId: "2945" }) }));
    expect(html).toContain("monthly briefing for Space Coast Credit Union");
    expect(html).toContain('href="/pro/hamilton?instId=2945"');
    mocks.briefing.mockResolvedValueOnce({ ...briefing, institutionId: 101, institutionName: "Other institution A" });
    html = renderToStaticMarkup(await HamiltonHomePage({ searchParams: Promise.resolve({ instId: "2945" }) }));
    expect(html).not.toContain("Other institution A");
    expect(html).toContain("monthly briefing for Space Coast Credit Union");
  });

  it.each([
    ["invalid", { instId: "invalid" }],
    ["missing", {}],
    ["nonlocal", { research: JSON.stringify({ version: 1, task: "compare", scope: { kind: "national" }, categories: ["overdraft"], charter: "all" }) }],
  ])("does not query unrelated alerts while rendering a %s research subject", async (_label, params) => {
    renderToStaticMarkup(await HamiltonHomePage({ searchParams: Promise.resolve(params) }));
    expect(mocks.signals).not.toHaveBeenCalled();
  });

  it("queries changes only for the named canonical research subject when rendering the briefing", async () => {
    const html = renderToStaticMarkup(await HamiltonHomePage({ searchParams: Promise.resolve({ instId: "2945" }) }));
    expect(html).toContain("Space Coast Credit Union");
    expect(mocks.signals).toHaveBeenCalledWith(25, { institutionIds: ["2945"] });
  });
});
