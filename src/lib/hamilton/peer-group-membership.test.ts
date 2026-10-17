/**
 * One membership everywhere: a saved peer group gives the peer list, the chart and benchmark
 * index, the engine's peer read and the report the same institutions, for a basic group and
 * for one with wider dimensions. How many of them publish a given fee may differ; who is in the
 * group may not.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { SavedPeerSet } from "@/lib/data-store/saved-peers";

const fee = vi.hoisted(() => ({
  getPeerIndexes: vi.fn(),
  getPeerIndex: vi.fn(),
  getNationalIndex: vi.fn(),
  getNationalIndexCached: vi.fn(),
}));
vi.mock("@/lib/data-store/fee-index", () => fee);
const savedPeers = vi.hoisted(() => ({ getSavedPeerSetById: vi.fn(), getDefaultPeerSets: vi.fn() }));
vi.mock("@/lib/data-store/saved-peers", () => savedPeers);
const peerSets = vi.hoisted(() => {
  class PeerSetError extends Error {}
  return { PeerSetError, resolvePeerSet: vi.fn(), getPeerSubject: vi.fn(), resolvePeerInstitutionIds: vi.fn() };
});
vi.mock("@/lib/data-store/peer-sets", () => peerSets);

import { getActivePeerSet, peerSetCandidate, resolveHamiltonPeerIndex, savedPeerSetDefinition } from "./peer-index";
import { parsePeerListQuestion, planPeerList, type PeerListSubject } from "./peer-list";

const HOME = 323;
const subject: PeerListSubject = {
  institutionId: HOME, name: "Capital City Bank", charterType: "bank", city: "Tallahassee", stateCode: "FL",
  totalAssetsUsd: 4_000_000_000, reportDate: "2026-06-30", source: "fdic", sourceUrl: null, recordId: 1,
};
const detail = { id: HOME, institution_name: "Capital City Bank", state_code: "FL", charter_type: "bank", asset_size_tier: "community_large", fed_district: 6 };
const MEMBERS = [5, 21, 40, 77];

function set(overrides: Partial<SavedPeerSet>): SavedPeerSet {
  return {
    id: 9, name: "Florida banks", tiers: null, districts: null, charter_type: "bank", created_by: "7",
    created_at: "2026-10-17T00:00:00Z", institution_ids: null, states: ["FL"], institution_id: HOME, is_default: true,
    ...overrides,
  };
}

const groups: { kind: string; group: SavedPeerSet }[] = [
  { kind: "basic", group: set({}) },
  { kind: "wider", group: set({ name: "Tallahassee metro banks", advanced: { asset_min: 500_000_000, market_code: 45220 } }) },
];

/** The institutions each surface would read for this group. */
async function membershipEverywhere(group: SavedPeerSet) {
  savedPeers.getDefaultPeerSets.mockResolvedValue([group]);
  savedPeers.getSavedPeerSetById.mockResolvedValue(group);

  // Peer list: the service hands getActivePeerSet's result to planPeerList.
  const active = await getActivePeerSet({ userId: 7, institutionId: HOME, institutionName: subject.name });
  if (active?.status !== "ready") throw new Error("expected a ready group");
  const intent = parsePeerListQuestion("List all saved peers");
  if (!intent) throw new Error("not a list question");
  const peerList = planPeerList(intent, subject, active).criteria?.institutionIds ?? null;

  // Charts and benchmarks: the default group, no peerSetId.
  fee.getPeerIndex.mockClear();
  const chart = await resolveHamiltonPeerIndex({ userId: 7, selectedInstitution: detail });
  const chartIds = fee.getPeerIndex.mock.calls[0]?.[0]?.institutionIds ?? null;

  // The report: the same group picked by id, as the report builder sends it.
  fee.getPeerIndex.mockClear();
  const report = await resolveHamiltonPeerIndex({ userId: 7, peerSetId: String(group.id), selectedInstitution: detail, approvedOnly: true, minUsableCategories: 3 });
  const reportIds = fee.getPeerIndex.mock.calls[0]?.[0]?.institutionIds ?? null;

  // The engine (briefing, research, Ask): its only peer candidate, read by getPeerFeeValues.
  const engine = peerSetCandidate(active).institutionIds ?? null;

  return { active, peerList, chart, chartIds, report, reportIds, engine };
}

describe("a saved group has one membership on every surface", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    peerSets.getPeerSubject.mockResolvedValue({ id: HOME, charter_type: "bank", asset_size: 4_000_000 });
    peerSets.resolvePeerInstitutionIds.mockResolvedValue(MEMBERS);
    peerSets.resolvePeerSet.mockResolvedValue({ definition: {}, filters: { institutionIds: MEMBERS }, label: "Banks", market: null });
    // Thin on purpose: one fee with too few publishers never widens the group.
    fee.getPeerIndex.mockResolvedValue([{ fee_category: "overdraft", median_amount: null, institution_count: 2 }]);
    fee.getPeerIndexes.mockImplementation(async (sets: unknown[]) => sets.map(() => []));
  });

  for (const { kind, group } of groups) {
    it(`gives the peer list, charts, the engine and the report the same institutions (${kind} group)`, async () => {
      const seen = await membershipEverywhere(group);
      expect(seen.peerList).toEqual(MEMBERS);
      expect(seen.chartIds).toEqual(MEMBERS);
      expect(seen.reportIds).toEqual(MEMBERS);
      expect(seen.engine).toEqual(MEMBERS);
      expect(seen.active.institutionCount).toBe(MEMBERS.length);
      for (const result of [seen.chart, seen.report]) {
        expect(result).toMatchObject({
          status: "ready", source: "saved-peer-set", peerSetId: "9", fallbackReason: null,
          group: { institutionCount: MEMBERS.length, institutionName: "Capital City Bank", institutionId: HOME },
        });
      }
      // Never widened to automatic peers or the national index.
      expect(fee.getPeerIndexes).not.toHaveBeenCalled();
      expect(fee.getNationalIndexCached).not.toHaveBeenCalled();
    });
  }

  it("resolves a basic group through resolvePeerInstitutionIds and a wider one through resolvePeerSet, the research institution left out", async () => {
    await membershipEverywhere(groups[0].group);
    expect(peerSets.resolvePeerInstitutionIds).toHaveBeenCalledWith(savedPeerSetDefinition(groups[0].group), { id: HOME });
    expect(peerSets.resolvePeerSet).not.toHaveBeenCalled();
    vi.clearAllMocks();
    await membershipEverywhere(groups[1].group);
    expect(peerSets.resolvePeerSet).toHaveBeenCalledWith(savedPeerSetDefinition(groups[1].group), expect.objectContaining({ id: HOME }));
    expect(peerSets.resolvePeerInstitutionIds).not.toHaveBeenCalled();
  });
});
