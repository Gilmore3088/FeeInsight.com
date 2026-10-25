import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { summarizeLayer, type LayerSummary } from "@/lib/hamilton/research-layers";
import type { PeerValue } from "@/lib/hamilton/workspace/types";

const mocks = vi.hoisted(() => ({ user: vi.fn(), workspace: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/hamilton/fee-workspace-data", () => ({ loadFeeWorkspace: mocks.workspace, layerDates: () => [] }));
vi.mock("@/lib/data-store/complaints", () => ({ getInstitutionComplaintProfile: async () => null }));
vi.mock("@/lib/data-store/news", () => ({ getArticles: async () => [] }));
vi.mock("@/lib/custom-report/checking-lineup-data", () => ({ loadMarketCheckingLineup: async () => null }));
vi.mock("next/navigation", () => ({
  redirect: (href: string) => { throw new Error(`REDIRECT:${href}`); },
}));
import ResearchPage from "./page";

const member = (institutionId: number, institutionName: string, amount: number): PeerValue => ({
  institutionId, institutionName, amount, stateCode: "OH", sourceDocumentIds: [], documentUrls: [], publishedAt: "2026-09-30",
});

function withMembers(layer: LayerSummary, names: string[]): LayerSummary {
  return { ...layer, members: layer.amounts.map((a, i) => member(i + 1, names[i], a)) };
}

beforeEach(() => {
  mocks.user.mockReset().mockResolvedValue({ id: 7, display_name: "Synthetic tester" });
});

describe("My fees below Hamilton's median minimum (#1896)", () => {
  it("shows a thin layer's count, a plain note and its institutions by name, never its median or middle half", async () => {
    // Six local competitors give a median; seven state institutions do not (Hamilton needs 10 outside the local market).
    const local = summarizeLayer("local", "Your market", "Institutions with branches in Synthetic County, OH", [20, 24, 26, 29, 33, 35], 27);
    const state = withMembers(
      summarizeLayer("state", "Ohio", "Banks and credit unions headquartered in Ohio", [22, 25, 28, 30, 31, 33, 35], 27),
      ["Alder Bank", "Birch Credit Union", "Cedar Savings", "Dogwood Bank", "Elm Federal", "Fir Bank", "Grove Credit Union"],
    );
    mocks.workspace.mockResolvedValue({
      institution: null, ownFees: [], fee: "overdraft", feeName: "Overdraft",
      ownAmount: 27, ownSeveral: null, ownFeeRows: [], research: null, local: null, unavailable: [],
      layers: [local, state],
    });
    const html = renderToStaticMarkup(await ResearchPage({ searchParams: Promise.resolve({ fee: "overdraft", layer: "state" }) }));
    const [localPanel, statePanel] = html.split('id="layer-panel-state"');

    // The local layer (6 of the 5 it needs) keeps its median and middle half.
    expect(localPanel).toContain("Middle (median)");
    expect(localPanel).toContain("Middle half");

    // The state layer (7 of the 10 it needs) shows none of them.
    expect(statePanel).not.toContain("Middle (median)");
    expect(statePanel).not.toContain("Middle half");
    expect(statePanel).not.toContain("read with care");
    expect(statePanel).toContain("Only 7 institutions publish this fee here, fewer than the 10 needed for a median.");
    expect(statePanel).toContain("Each institution, lowest price first:");
    expect(statePanel).toContain("Alder Bank $22; Birch Credit Union $25; Cedar Savings $28; Dogwood Bank $30; Elm Federal $31; Fir Bank $33; Grove Credit Union $35.");
    // Counts stay: who charges nothing and where the bank's own price sits.
    expect(statePanel).toContain("Charge nothing");
    expect(statePanel).toContain("2 of 7 charge less");

    // The tabs: a median for the local market, a count for the thin state layer.
    expect(html).toMatch(/Your market<span[^>]*>\$27\.50<\/span>/);
    expect(html).toMatch(/Ohio<span[^>]*>7, no median<\/span>/);
  });
});
