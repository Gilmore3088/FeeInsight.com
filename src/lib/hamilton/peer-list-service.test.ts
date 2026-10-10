import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ subject: vi.fn(), rows: vi.fn(), resolve: vi.fn(), account: vi.fn(), active: vi.fn(), record: vi.fn() }));
vi.mock("@/lib/data-store/hamilton-peer-list", () => ({ getPeerListSubject: mocks.subject, getPeerListRows: mocks.rows }));
vi.mock("./workspace-context", () => ({ resolveHamiltonInstitutionContext: mocks.resolve }));
vi.mock("./account-context-store", () => ({ loadHamiltonAccountContext: mocks.account }));
vi.mock("./active-peer-set", () => ({ getActivePeerSet: mocks.active }));
vi.mock("@/lib/agents/run-store", () => ({ recordProRequest: mocks.record }));
import { answerPeerList } from "./peer-list-service";
import { makePeerListContinuation } from "./peer-list";
const subject = { institutionId: 202, name: "Synthetic Research CU", charterType: "credit_union", city: "Tampa", stateCode: "FL", totalAssetsUsd: 10_000_000_000, reportDate: "2026-06-30", source: "ncua", sourceUrl: null, recordId: 1 };
const peer = { ...subject, institutionId: 303, name: "Synthetic Peer CU", feeCoverage: "not_found", inclusionReason: "Matches criteria." };
const user = { id: 7, institution_name: "Unverified name" };
beforeEach(() => {
  mocks.subject.mockReset().mockResolvedValue(subject);
  mocks.rows.mockReset().mockResolvedValue({ rows: [peer], totalMatches: 1 });
  mocks.resolve.mockReset().mockImplementation(async ({ instId }: { instId?: string }) => ({ institution: { id: instId ? Number(instId) : 202 }, error: null }));
  mocks.account.mockReset().mockResolvedValue({ status: "identified", institution: { id: 101, name: "Synthetic Account CU" }, profileLabel: null });
  mocks.active.mockReset().mockResolvedValue(null);
  mocks.record.mockReset().mockResolvedValue(undefined);
});

describe("peer list service boundaries", () => {
  it("returns a list response before fee research", async () => { const result = await answerPeerList(user, { institutionId: 202, question: "List ten peers" }); expect(result?.kind).toBe("peer_list"); expect(result?.peerList.rows[0].institutionId).toBe(303); expect(result?.peerList.rows[0].feeCoverage).toBe("not_found"); });
  it("leaves explicit fee and report questions to the legacy service", async () => { expect(await answerPeerList(user, { institutionId: 202, question: "Compare our overdraft fee with peers" })).toBeNull(); expect(mocks.subject).not.toHaveBeenCalled(); });
  it("does not treat an answer to a pending clarification as a new list command", async () => { expect(await answerPeerList(user, { question: "List peers", answer: { value: "peers" } })).toBeNull(); expect(mocks.subject).not.toHaveBeenCalled(); });
  it("does not use account identity for a generic list about the selected research subject", async () => { await answerPeerList(user, { institutionId: 202, question: "List ten peers" }); expect(mocks.account).not.toHaveBeenCalled(); expect(mocks.resolve.mock.calls[0][0].instId).toBe("202"); });
  it("resolves explicit 'our peers' from server account identity, not the browsed institution", async () => { await answerPeerList(user, { institutionId: 202, question: "List our peers" }); expect(mocks.account).toHaveBeenCalledWith(user); expect(mocks.resolve.mock.calls[0][0].instId).toBe("101"); });
  it("does not infer 'my peers' from an unlinked or ambiguous account", async () => { mocks.account.mockResolvedValue({ status: "ambiguous", institution: null }); const result = await answerPeerList(user, { institutionId: 202, question: "List my peers" }); expect(result?.peerList.status).toBe("needs_criteria"); expect(mocks.rows).not.toHaveBeenCalled(); });
  it("keeps an account lookup failure unavailable rather than choosing the viewed institution", async () => { mocks.account.mockResolvedValue({ status: "unavailable", institution: null }); expect((await answerPeerList(user, { institutionId: 202, question: "List my peers" }))?.peerList.status).toBe("unavailable"); expect(mocks.rows).not.toHaveBeenCalled(); });
  it("rejects invalid subject IDs without reading a default", async () => { expect((await answerPeerList(user, { institutionId: "wrong", question: "List peers" }))?.peerList.status).toBe("needs_criteria"); expect(mocks.resolve).not.toHaveBeenCalled(); });
  it("does not query when criteria are unsupported", async () => { expect((await answerPeerList(user, { institutionId: 202, question: "List peers excluding Bank A" }))?.peerList.status).toBe("needs_criteria"); expect(mocks.rows).not.toHaveBeenCalled(); expect(mocks.resolve).not.toHaveBeenCalled(); });
  it("passes dollar bounds and exact inequalities to the query", async () => { await answerPeerList(user, { institutionId: 202, question: "List 10 credit unions above $1B and under $5B" }); expect(mocks.rows.mock.calls[0][1].minAssets).toEqual({ value: 1_000_000_000, inclusive: false }); expect(mocks.rows.mock.calls[0][1].maxAssets).toEqual({ value: 5_000_000_000, inclusive: false }); });
  it("honors authorized saved peers without making up assets for them", async () => { mocks.active.mockResolvedValue({ id: 8, name: "My list", label: "My list", filters: { institutionIds: [303, 404] } }); await answerPeerList(user, { institutionId: 202, question: "List saved peers" }); expect(mocks.active).toHaveBeenCalledWith({ userId: 7, institutionId: 202 }); expect(mocks.rows.mock.calls[0][1].institutionIds).toEqual([303, 404]); });
  it("does not substitute a default after a saved-group lookup failure", async () => { mocks.active.mockRejectedValue(new Error("synthetic saved-group outage")); const result = await answerPeerList(user, { institutionId: 202, question: "List peers" }); expect(result?.peerList.status).toBe("unavailable"); expect(result?.peerList.totalMatches).toBeNull(); expect(mocks.rows).not.toHaveBeenCalled(); });
  it("reports the actual shortage without relaxing the query", async () => { const result = await answerPeerList(user, { institutionId: 202, question: "List ten peers" }); expect(result?.peerList.totalMatches).toBe(1); expect(result?.peerList.notes.join(" ")).toContain("Only 1 institutions meet these criteria"); expect(mocks.rows).toHaveBeenCalledTimes(1); });
  it("keeps zero results distinct from a failed query", async () => { mocks.rows.mockResolvedValue({ rows: [], totalMatches: 0 }); expect((await answerPeerList(user, { institutionId: 202, question: "List peers" }))?.peerList.totalMatches).toBe(0); mocks.rows.mockRejectedValue(new Error("synthetic query outage")); const failed = await answerPeerList(user, { institutionId: 202, question: "List peers" }); expect(failed?.peerList.status).toBe("unavailable"); expect(failed?.peerList.totalMatches).toBeNull(); });
  it("records list criteria and counts without a provider run", async () => { await answerPeerList(user, { institutionId: 202, question: "List peers" }); expect(mocks.record.mock.calls[0][0].detail.provider_called).toBe(false); expect(mocks.record.mock.calls[0][0].detail.matching_count).toBe(1); });
  it("records failed or clarification outcomes as well as successful lists", async () => { await answerPeerList(user, { institutionId: "wrong", question: "List peers" }); expect(mocks.record).toHaveBeenCalledTimes(1); });
});


describe("exact displayed peer-list continuation", () => {
  const gaPeer = { ...peer, institutionId: 404, name: "Georgia CU", stateCode: "GA", recordId: 2 };
  it("refines only the originally displayed IDs, preserving dated records and subject", async () => {
    mocks.rows.mockResolvedValue({ rows: [peer, gaPeer], totalMatches: 200 });
    const original = (await answerPeerList(user, { institutionId: 202, question: "List ten peers" }))!;
    const prior = makePeerListContinuation(original, "List ten peers", "202")!;
    mocks.rows.mockClear();
    mocks.record.mockClear();
    const result = (await answerPeerList(user, { institutionId: 202, question: "Only Florida", previousPeerList: prior }))!;
    expect(result.peerList.status).toBe("ready");
    expect(result.peerList.rows.map(x => x.institutionId)).toEqual([303]);
    expect(result.peerList.totalMatches).toBe(1);
    expect(result.peerList.subject?.institutionId).toBe(202);
    expect(result.peerList.rows[0].reportDate).toBe("2026-06-30");
    expect(result.peerList.notes.join(" ")).toContain("no new peers");
    expect(mocks.rows).toHaveBeenCalledTimes(1);
    expect(mocks.record).toHaveBeenCalledTimes(1);
    expect(mocks.record.mock.calls[0][0].detail.provider_called).toBe(false);
  });
  it("chains a second state refinement without broadening the exact selected list", async () => {
    mocks.rows.mockResolvedValue({ rows: [peer, gaPeer], totalMatches: 2 });
    const original = (await answerPeerList(user, { institutionId: 202, question: "List peers" }))!;
    const prior = makePeerListContinuation(original, "List peers", "202")!;
    const first = (await answerPeerList(user, { institutionId: 202, question: "Only Florida", previousPeerList: prior }))!;
    const second = (await answerPeerList(user, { institutionId: 202, question: "Only Georgia", previousPeerList: { ...prior, selectedIds: first.peerList.rows.map(r => r.institutionId) } }))!;
    expect(second.peerList.status).toBe("ready");
    expect(second.peerList.rows).toHaveLength(0);
    expect(second.peerList.totalMatches).toBe(0);
  });
  it("rejects forged peer IDs and never broadens a client-supplied list", async () => {
    const original = (await answerPeerList(user, { institutionId: 202, question: "List peers" }))!;
    const prior = makePeerListContinuation(original, "List peers", "202")!;
    mocks.rows.mockClear();
    const result = await answerPeerList(user, { question: "Only Florida", previousPeerList: { ...prior, selectedIds: [999] } });
    expect(result?.peerList.status).toBe("needs_criteria");
    expect(mocks.rows).not.toHaveBeenCalled();
  });
  it("rejects stale financial evidence instead of replacing peers silently", async () => {
    const original = (await answerPeerList(user, { institutionId: 202, question: "List peers" }))!;
    const prior = makePeerListContinuation(original, "List peers", "202")!;
    mocks.rows.mockResolvedValue({ rows: [{ ...peer, recordId: 99 }], totalMatches: 1 });
    const result = await answerPeerList(user, { institutionId: 202, question: "Only Florida", previousPeerList: prior });
    expect(result?.peerList.status).toBe("unavailable");
    expect(result?.peerList.rows).toEqual([]);
  });
  it("does not silently route an unsupported fee follow-up to paid analysis", async () => {
    const original = (await answerPeerList(user, { institutionId: 202, question: "List peers" }))!;
    const prior = makePeerListContinuation(original, "List peers", "202")!;
    mocks.rows.mockClear();
    const result = await answerPeerList(user, { institutionId: 202, question: "Compare their NSF fees", previousPeerList: prior });
    expect(result?.peerList.status).toBe("needs_criteria");
    expect(result?.shortAnswer).toContain("not yet supported");
    expect(mocks.rows).not.toHaveBeenCalled();
  });
  it("rejects a different research context without querying the original peers", async () => {
    const original = (await answerPeerList(user, { institutionId: 202, question: "List peers" }))!;
    const prior = makePeerListContinuation(original, "List peers", "202")!;
    mocks.rows.mockClear();
    const result = await answerPeerList(user, { institutionId: 999, question: "Only Florida", previousPeerList: prior });
    expect(result?.peerList.status).toBe("needs_criteria");
    expect(mocks.rows).not.toHaveBeenCalled();
  });

});
