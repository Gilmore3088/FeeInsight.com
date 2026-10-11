import { beforeEach, describe, expect, it, vi } from "vitest";
import type { PeerListResponse } from "./peer-list";
const mocks = vi.hoisted(() => ({ insert: vi.fn(), account: vi.fn() }));
vi.mock("@/lib/data-store/hamilton-analyses", () => ({ insertSavedAnalysis: mocks.insert }));
vi.mock("./account-context-store", () => ({ loadHamiltonAccountContext: mocks.account }));
import { matchesFreshPeerSnapshot, savePeerResearchSnapshot } from "./peer-list-snapshots";

const row = { institutionId: 303, name: "Synthetic Peer", charterType: "credit_union", city: "Miami", stateCode: "FL", totalAssetsUsd: 1_000_000_000, reportDate: "2026-06-30", source: "ncua", sourceUrl: null, recordId: 55, feeCoverage: "available", inclusionReason: "Exact criteria." };
const subject = { ...row, institutionId: 202, name: "Research CU" };
const response: PeerListResponse = {
 kind: "peer_list", shortAnswer: "One selected research peer",
 peerList: {
   version: 1, status: "ready", subject, criteria: {
     basis: "explicit_filters", charterType: "credit_union", states: ["FL"], minAssets: null, maxAssets: null, institutionIds: [303],
     assetTiers: [], fedDistricts: [], peerSetId: null, peerSetLabel: null, sort: "name", referenceAssetsUsd: null,
     requiresAssets: false, limit: 10, requestedCount: 10, descriptions: ["Only displayed peer IDs"],
   },
   rows: [row], totalMatches: 1, queriedAt: "2026-10-11T08:45:00Z", notes: [],
   feeComparison: { category: "nsf", comparedPeerIds: [303], fees: [{ institutionId: 303, id: 42, name: "NSF", amount: 0, frequency: "per_item", publishedAt: "2026-10-01T00:00:00Z", sourceDocumentId: 15, documentUrl: "https://example.test/fees.pdf", sourceUrl: null }], account: null, includesAccount: false, note: "Actual published records." },
 },
};
beforeEach(() => {
 mocks.insert.mockReset().mockResolvedValue("11111111-1111-1111-1111-111111111111");
 mocks.account.mockReset().mockResolvedValue({ status: "identified", institution: { id: 101, name: "Verified Home CU" }, profileLabel: null });
});
describe("saved peer evidence continuity", () => {
 it("does not accept browser-only subject, selected ID, fee amount or evidence changes", async () => {
   expect(matchesFreshPeerSnapshot({ ...response.peerList, rows: [{ ...row, institutionId: 999 }] }, response.peerList)).toBe(false);
   expect(matchesFreshPeerSnapshot({ ...response.peerList, subject: { ...subject, institutionId: 101 } }, response.peerList)).toBe(false);
   expect(matchesFreshPeerSnapshot({ ...response.peerList, feeComparison: { ...response.peerList.feeComparison, fees: [{ ...response.peerList.feeComparison!.fees[0], amount: 30 }] } }, response.peerList)).toBe(false);
   expect(matchesFreshPeerSnapshot({ ...response.peerList, queriedAt: "a different time" }, response.peerList)).toBe(true);
 });
 it("persists full exact rows, source dates and server-resolved account identity for the authenticated user", async () => {
   const saved = await savePeerResearchSnapshot({ id: 7 }, "Compare their NSF fees", response, response.peerList);
   expect(saved).toBe("11111111-1111-1111-1111-111111111111");
   const arg = mocks.insert.mock.calls[0][0];
   expect(arg.userId).toBe(7);
   expect(arg.institutionId).toBe("202");
   expect(arg.response.peerListSnapshot).toEqual(response.peerList);
   expect(arg.response.identityContext).toMatchObject({ researchInstitutionId: 202, accountInstitutionId: 101 });
 });
 it("refuses stale mismatches without writing and never treats caller metadata as authorization", async () => {
   const result = await savePeerResearchSnapshot({ id: 7 }, "Compare their NSF fees", response, { ...response.peerList, rows: [] });
   expect(result).toBeNull();
   expect(mocks.insert).not.toHaveBeenCalled();
   expect(mocks.account).not.toHaveBeenCalled();
 });
});
