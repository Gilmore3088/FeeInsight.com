import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { summarizeLayer, type LayerSummary } from "@/lib/hamilton/research-layers";
import type { PeerValue } from "@/lib/hamilton/workspace/types";

const mocks = vi.hoisted(() => ({ user: vi.fn(), scenario: vi.fn(), workspace: vi.fn(), memory: vi.fn() }));
vi.mock("@/lib/auth", () => ({ getCurrentUser: mocks.user }));
vi.mock("@/lib/hamilton/pro-tables", () => ({ getHamiltonScenarioById: mocks.scenario }));
vi.mock("@/lib/hamilton/fee-workspace-data", () => ({ loadFeeWorkspace: mocks.workspace, layerDates: () => [] }));
vi.mock("@/lib/data-store/hamilton-workspace", () => ({ getMemoryFacts: mocks.memory }));
vi.mock("next/navigation", () => ({
  redirect: (href: string) => { throw new Error(`REDIRECT:${href}`); },
  notFound: () => { throw new Error("NOT_FOUND"); },
}));
import ModelPage from "./page";

const member = (institutionId: number, institutionName: string, amount: number): PeerValue => ({
  institutionId, institutionName, amount, stateCode: "OH", sourceDocumentIds: [], documentUrls: [], publishedAt: "2026-09-30",
});

function workspace(layers: LayerSummary[]) {
  return {
    institution: { id: 303, name: "Synthetic Bank B", charterType: "bank" },
    ownFees: [], fee: "overdraft", feeName: "Overdraft",
    ownAmount: 27, ownSeveral: null, research: null, local: null, ownFeeRows: [], unavailable: [],
    layers,
  };
}

beforeEach(() => {
  mocks.user.mockReset().mockResolvedValue({ id: 7, display_name: "Synthetic tester" });
  mocks.scenario.mockReset().mockResolvedValue(null);
  mocks.memory.mockReset().mockResolvedValue([]);
});

describe("Try a price below Hamilton's median minimum (#1896)", () => {
  it("never offers a thin layer's median as a price to test, and names its institutions instead", async () => {
    // Nine institutions: the public index would give a median ($31), Hamilton needs 10 outside the local market.
    const amounts = [22, 25, 28, 30, 31, 33, 35, 36, 38];
    const state = {
      ...summarizeLayer("state", "Ohio", "Banks and credit unions headquartered in Ohio", amounts, 27),
      members: amounts.map((a, i) => member(i + 1, `Synthetic Peer ${String.fromCharCode(65 + i)}`, a)),
    };
    mocks.workspace.mockResolvedValue(workspace([state]));
    const html = renderToStaticMarkup(await ModelPage({ searchParams: Promise.resolve({ fee: "overdraft", layer: "state" }) }));

    // Default prices are $0 and today's price plus $5, never the thin median.
    expect(html).toContain('name="prices" value="0, 32"');
    expect(html).not.toContain("$31 ");
    expect(html).toContain("Only 9 institutions publish this fee here, fewer than the 10 needed for a median.");
    expect(html).toContain("Each institution, lowest price first:</span> Synthetic Peer A $22; Synthetic Peer B $25;");
    expect(html).toContain("Synthetic Peer I $38.");
  });

  it("offers the median and shows no thin note from 10 institutions", async () => {
    const amounts = [22, 25, 28, 30, 31, 33, 35, 36, 38, 40];
    mocks.workspace.mockResolvedValue(workspace([summarizeLayer("state", "Ohio", "Banks and credit unions headquartered in Ohio", amounts, 27)]));
    const html = renderToStaticMarkup(await ModelPage({ searchParams: Promise.resolve({ fee: "overdraft", layer: "state" }) }));
    expect(html).toContain('name="prices" value="0, 32"');
    expect(html).not.toContain("needed for a median");
  });

  it("lets 5 local competitors give a median, and keeps 4 thin", async () => {
    const five = summarizeLayer("local", "Your market", "Institutions with branches in Synthetic County, OH", [20, 24, 26, 29, 33], 27);
    mocks.workspace.mockResolvedValue(workspace([five]));
    const withMedian = renderToStaticMarkup(await ModelPage({ searchParams: Promise.resolve({ fee: "overdraft", layer: "local" }) }));
    expect(withMedian).toContain('name="prices" value="0, 26, 32"');
    expect(withMedian).not.toContain("needed for a median");

    const four = summarizeLayer("local", "Your market", "Institutions with branches in Synthetic County, OH", [20, 24, 26, 29], 27);
    mocks.workspace.mockResolvedValue(workspace([four]));
    const thin = renderToStaticMarkup(await ModelPage({ searchParams: Promise.resolve({ fee: "overdraft", layer: "local" }) }));
    expect(thin).toContain('name="prices" value="0, 32"');
    expect(thin).toContain("Only 4 institutions publish this fee here, fewer than the 5 needed for a median.");
    // The engine listed nobody, so nobody is named.
    expect(thin).not.toContain("Each institution, lowest price first");
  });
});
