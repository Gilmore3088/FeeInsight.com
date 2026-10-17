import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ record: vi.fn(), notFound: vi.fn(() => { throw new Error("NEXT_NOT_FOUND"); }) }));
vi.mock("next/navigation", () => ({ notFound: mocks.notFound }));
vi.mock("@/app/pro/(hamilton)/analyze/actions", () => ({ loadAnalysisRecord: mocks.record }));
vi.mock("@/components/hamilton/analyze/PeerListView", () => ({ PeerListView: () => null }));
import SavedPeerResearchPage from "./page";

const id = "11111111-1111-1111-1111-111111111111";
const subject = {
  institutionId: 202, name: "Synthetic Research CU", charterType: "credit_union",
  city: "Orlando", stateCode: "FL", totalAssetsUsd: 1_000_000_000,
  reportDate: "2026-06-30", source: "ncua", sourceUrl: null, recordId: 202,
};
const record = {
  id, institutionId: "202", analysisFocus: "Exact peer research snapshot", prompt: "Compare their NSF fees",
  responseJson: { hamiltonView: "Published fees for the selected peers", peerListSnapshot: {
    version: 1, status: "ready", subject, rows: [], criteria: null,
    notes: [], totalMatches: 0, queriedAt: "2026-10-11T00:00:00Z",
  } },
};
beforeEach(() => { mocks.record.mockReset().mockResolvedValue(record); mocks.notFound.mockClear(); });
describe("user-scoped saved peer research reopening", () => {
  it("renders the historical selected research subject without replacing its dated evidence", async () => {
    const node = await SavedPeerResearchPage({ params: Promise.resolve({ id }) });
    expect(mocks.record).toHaveBeenCalledWith(id);
    const [header] = node.props.children;
    expect(header.props.title).toBe("Compare their NSF fees");
    expect(JSON.stringify(header.props.dek)).toContain("as they were on that date");
    expect(header.props.actions.props.href).toBe("/pro/analyze?q=Compare+their+NSF+fees&instId=202&send=1");
  });
  it("does not open a record from another user", async () => {
    mocks.record.mockResolvedValue(null);
    await expect(SavedPeerResearchPage({ params: Promise.resolve({ id }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
  it("rejects a stored answer whose subject was swapped, not a live re-query", async () => {
    mocks.record.mockResolvedValue({ ...record, institutionId: "303" });
    await expect(SavedPeerResearchPage({ params: Promise.resolve({ id }) })).rejects.toThrow("NEXT_NOT_FOUND");
  });
  it("rejects malformed IDs without hitting the database action", async () => {
    await expect(SavedPeerResearchPage({ params: Promise.resolve({ id: "not-a-uuid" }) })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(mocks.record).not.toHaveBeenCalled();
  });
});
