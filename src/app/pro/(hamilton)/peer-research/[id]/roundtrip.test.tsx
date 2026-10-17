// @vitest-environment jsdom
/**
 * Saved peer research reopens exactly (#977, H02-T08): the list a user saves is the list the saved
 * page shows, row for row, with the same criteria, fees and CSV file.
 */
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PeerListResponse, PeerListRow } from "@/lib/hamilton/peer-list";

const mocks = vi.hoisted(() => ({ insert: vi.fn(), account: vi.fn(), record: vi.fn(), notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }) }));
vi.mock("@/lib/data-store/hamilton-analyses", () => ({ insertSavedAnalysis: mocks.insert }));
vi.mock("@/lib/hamilton/account-context-store", () => ({ loadHamiltonAccountContext: mocks.account }));
vi.mock("@/app/pro/(hamilton)/analyze/actions", () => ({ loadAnalysisRecord: mocks.record }));
vi.mock("@/app/pro/(hamilton)/settings/actions", () => ({ createPeerSet: vi.fn() }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
const { savePeerResearchSnapshot } = await import("@/lib/hamilton/peer-list-snapshots");
const { peerListCsv } = await import("@/lib/hamilton/peer-list-export");
const { default: SavedPeerResearchPage } = await import("./page");

const id = "11111111-1111-1111-1111-111111111111";
const row = (institutionId: number, name: string, stateCode: string, assets: number | null): PeerListRow => ({
  institutionId, name, charterType: "credit_union", city: "Tampa", stateCode, totalAssetsUsd: assets,
  reportDate: assets === null ? null : "2026-06-30", source: assets === null ? null : "ncua", sourceUrl: null,
  recordId: assets === null ? null : institutionId, feeCoverage: "available", inclusionReason: "Matches the stated criteria.",
});
const shown: PeerListResponse = {
  kind: "peer_list", shortAnswer: "Published NSF fees for 2 selected peers.",
  peerList: {
    version: 1, status: "ready", subject: { ...row(202, "Research CU", "FL", 8_000_000_000) },
    criteria: { basis: "explicit_filters", charterType: "credit_union", states: ["FL"], minAssets: null, maxAssets: null, institutionIds: [303, 304], assetTiers: [], fedDistricts: [], peerSetId: null, peerSetLabel: null, sort: "largest_assets", referenceAssetsUsd: null, requiresAssets: false, limit: 10, requestedCount: 10, descriptions: ["Credit unions; Florida (headquarters state)."] },
    rows: [row(303, "Gulf CU", "FL", 2_000_000_000), row(304, "Bay CU", "FL", null)],
    totalMatches: 2, queriedAt: "2026-10-17T09:00:00.000Z", notes: ["Only the previously displayed peer IDs were considered; no new peers were introduced. Reporting dates were rechecked."],
    feeComparison: { category: "nsf", label: "NSF", comparedPeerIds: [303, 304], fees: [{ institutionId: 303, id: 41, name: "NSF fee", amount: 0, frequency: "per_item", publishedAt: "2026-09-01T00:00:00.000Z", sourceDocumentId: 9, documentUrl: "https://gulf.example/fees.pdf", sourceUrl: null }], rateFees: [], account: null, includesAccount: false, note: "Each consumer NSF fee a peer publishes is listed on its own line, $0 fees included." },
  },
};
afterEach(cleanup);

describe("saved peer research round trip", () => {
  it("reopens the saved list with the same rows, fees, criteria and file as the screen", async () => {
    mocks.account.mockResolvedValue({ status: "identified", institution: { id: 101, name: "Home CU" }, profileLabel: null });
    mocks.insert.mockResolvedValue(id);
    expect(await savePeerResearchSnapshot({ id: 7 }, "Compare their NSF fees", shown, shown.peerList)).toBe(id);
    const saved = mocks.insert.mock.calls[0][0];
    mocks.record.mockResolvedValue({ id, institutionId: saved.institutionId, analysisFocus: saved.analysisFocus, prompt: saved.prompt, responseJson: JSON.parse(JSON.stringify(saved.response)) });

    render(await SavedPeerResearchPage({ params: Promise.resolve({ id }) }));
    expect(screen.getByText("Question: Compare their NSF fees")).toBeTruthy();
    expect(screen.getByRole("heading", { name: shown.shortAnswer })).toBeTruthy();
    const table = within(screen.getByRole("region", { name: "Peer table; scroll horizontally" }));
    expect(table.getAllByRole("rowheader").map(cell => within(cell).getAllByRole("link")[0].textContent)).toEqual(["Gulf CU", "Bay CU"]);
    expect(table.getByText("$2,000,000,000")).toBeTruthy();
    expect(table.getAllByText("Not available")).toHaveLength(2);
    const fees = within(screen.getByRole("table", { name: "Published NSF charges" }));
    expect(fees.getByText("$0")).toBeTruthy();
    expect(fees.getByText("No published consumer NSF fee on file")).toBeTruthy();
    expect(screen.getByText("Credit unions; Florida (headquarters state).")).toBeTruthy();
    // Reopened research is read-only: no save or refine actions, but the same file.
    expect(screen.queryByRole("button", { name: "Save this peer research" })).toBeNull();
    expect(screen.getByText(/This is the list as it was saved/)).toBeTruthy();
    expect(peerListCsv(saved.response.peerListSnapshot)).toBe(peerListCsv(shown.peerList));
  });
});
