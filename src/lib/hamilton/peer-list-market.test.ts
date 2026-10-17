import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  class PeerSetError extends Error {}
  return {
    PeerSetError,
    subject: vi.fn(), rows: vi.fn(), resolve: vi.fn(), account: vi.fn(), active: vi.fn(), record: vi.fn(),
    peerSubject: vi.fn(), resolvePeerRequest: vi.fn(),
  };
});
vi.mock("@/lib/data-store/hamilton-peer-list", () => ({ getPeerListSubject: mocks.subject, getPeerListRows: mocks.rows }));
vi.mock("@/lib/data-store/hamilton-peer-fees", () => ({ getPublishedPeerFees: vi.fn(), getPublishedPeerRateFees: vi.fn() }));
vi.mock("./workspace-context", () => ({ resolveHamiltonInstitutionContext: mocks.resolve }));
vi.mock("./account-context-store", () => ({ loadHamiltonAccountContext: mocks.account }));
vi.mock("./active-peer-set", () => ({ getActivePeerSet: mocks.active }));
vi.mock("@/lib/agents/run-store", () => ({ recordProRequest: mocks.record }));
vi.mock("@/lib/data-store/peer-sets", () => ({
  PeerSetError: mocks.PeerSetError, getPeerSubject: mocks.peerSubject, resolvePeerRequest: mocks.resolvePeerRequest,
}));

import { answerPeerList } from "./peer-list-service";
import { parsePeerListQuestion, planPeerList, type PeerListSubject } from "./peer-list";
import type { ActivePeerSet } from "./active-peer-set";

const subject: PeerListSubject = {
  institutionId: 323, name: "Capital City Bank", charterType: "bank", city: "Tallahassee", stateCode: "FL",
  totalAssetsUsd: 4_000_000_000, reportDate: "2026-06-30", source: "fdic", sourceUrl: null, recordId: 1,
};
const market = { name: "Tallahassee, FL", institutionIds: [5, 21, 4956] };
const intent = (q: string) => {
  const parsed = parsePeerListQuestion(q);
  if (!parsed) throw new Error(`not a list: ${q}`);
  return parsed;
};

describe("metro peer lists", () => {
  for (const q of ["List banks in my metro", "Show peers in our metro market", "List 20 credit unions with branches in our home market", "List institutions in the same metro area"]) {
    it(`reads a metro request: ${q}`, () => {
      expect(intent(q).market).toBe(true);
      expect(intent(q).problems).toEqual([]);
    });
  }

  it("still refuses county, distance and local-competitor wording", () => {
    for (const q of ["List banks within 10 miles", "List peers in my county", "List local competitors with assets above $5B"]) {
      expect(intent(q).problems.join(" ")).toContain("not supported in this list yet");
    }
    expect(intent("List banks in Florida").market).toBeUndefined();
  });

  it("lists exactly the metro's institutions, both types unless one is named, with no size band", () => {
    const peers = planPeerList(intent("Show peers in my metro"), subject, null, market);
    expect(peers.problem).toBeNull();
    expect(peers.criteria).toMatchObject({ institutionIds: [5, 21, 4956], charterType: null, minAssets: null, maxAssets: null, basis: "explicit_filters" });
    expect(peers.criteria?.descriptions.join(" ")).toContain("Tallahassee, FL metro");
    const banks = planPeerList(intent("List banks in my metro above $1B"), subject, null, market);
    expect(banks.criteria).toMatchObject({ institutionIds: [5, 21, 4956], charterType: "bank", minAssets: { value: 1e9, inclusive: false } });
  });

  it("keeps a saved group's institutions inside the metro", () => {
    const saved: ActivePeerSet = { status: "ready", institutionCount: 2, institutionId: 323, id: 7, name: "Rivals", label: "Rivals", filters: { institutionIds: [5, 6] } };
    expect(planPeerList(intent("List my saved peers in my metro"), subject, saved, market).criteria?.institutionIds).toEqual([5]);
  });

  it("says None found when no metro is on record", () => {
    expect(planPeerList(intent("List banks in my metro"), subject, null, null).problem).toContain("None found");
  });
});

describe("metro peer list service", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.subject.mockResolvedValue(subject);
    mocks.rows.mockResolvedValue({ rows: [], totalMatches: 0 });
    mocks.resolve.mockImplementation(async ({ instId }: { instId?: string }) => ({ institution: { id: Number(instId ?? 323) }, error: null }));
    mocks.active.mockResolvedValue(null);
    mocks.record.mockResolvedValue(undefined);
    mocks.peerSubject.mockResolvedValue({ id: 323, charter_type: "bank" });
    mocks.account.mockResolvedValue({ status: "identified", institution: { id: 323, name: "Capital City Bank" } });
  });

  it("finds the metro only through the shared peer-set module", async () => {
    mocks.resolvePeerRequest.mockResolvedValue({ definition: { market_code: 45220 }, filters: { institutionIds: [5, 21] }, label: "x", market: { code: 45220, name: "Tallahassee, FL" } });
    const result = await answerPeerList({ id: 7 }, { institutionId: 323, question: "List banks in my metro" });
    expect(mocks.resolvePeerRequest).toHaveBeenCalledWith({ id: 323, charter_type: "bank" }, { market: "same" });
    expect(mocks.rows.mock.calls[0][1]).toMatchObject({ institutionIds: [5, 21], charterType: "bank" });
    expect(result?.peerList.status).toBe("ready");
    expect(mocks.active).not.toHaveBeenCalled();
  });

  it("says None found when the institution has no branch market", async () => {
    mocks.resolvePeerRequest.mockRejectedValue(new mocks.PeerSetError("no branch market"));
    const result = await answerPeerList({ id: 7 }, { institutionId: 323, question: "List banks in my metro" });
    expect(result?.peerList.status).toBe("needs_criteria");
    expect(result?.shortAnswer).toContain("None found");
    expect(mocks.rows).not.toHaveBeenCalled();
  });
});
