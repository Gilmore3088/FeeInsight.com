import { beforeEach, describe, expect, it, vi } from "vitest";

const getFeeResearch = vi.fn();
const getActivePeerSet = vi.fn();
vi.mock("./active-peer-set", () => ({ getActivePeerSet: (...args: unknown[]) => getActivePeerSet(...args) }));
vi.mock("@/lib/data-store/fee-index", () => ({
  getInstitutionOwnFees: vi.fn(async () => new Map([["wire_domestic_outgoing", { price: 35, low: 35, high: 35, fees: [{ name: "Outgoing wire", amount: 35 }] }]])),
}));
vi.mock("./workspace-context", () => ({ resolveHamiltonInstitutionContext: vi.fn(async () => ({ institution: { id: 323, name: "Capital City Bank" } })) }));
vi.mock("./workspace/research", () => ({ getFeeResearch: (...args: unknown[]) => getFeeResearch(...args) }));

import { feeName, loadFeeWorkspace } from "./fee-workspace-data";

describe("fee workspace", () => {
  beforeEach(() => {
    getFeeResearch.mockReset();
    getActivePeerSet.mockReset();
    getActivePeerSet.mockResolvedValue(null);
  });

  it("compares against the saved peer set, the one every Hamilton screen uses (#1893)", async () => {
    const active = { id: 10, name: "Team peers", label: "Team peers", filters: { institutionIds: [1, 2] } };
    getActivePeerSet.mockResolvedValue(active);
    const saved = (id: number, amount: number) => ({
      institutionId: id,
      institutionName: `Peer ${id}`,
      amount,
      stateCode: "FL",
      sourceDocumentIds: [],
      documentUrls: [],
      publishedAt: `2026-09-0${id}`,
    });
    getFeeResearch.mockResolvedValue({
      institutionName: "CAPITAL CITY BANK",
      ownRows: [],
      localMarket: null,
      localCompetitors: [],
      peerGroupSaved: true,
      peerLabel: "Team peers",
      peers: [saved(2, 30), saved(1, 25)],
      layers: [
        { scope: "national", label: "National", amounts: [10, 20, 30], asOf: null, members: [] },
        { scope: "charter_size", label: "Banks, $1B to $10B in assets", amounts: [1, 2, 3], asOf: null, members: [] },
      ],
    });
    const ws = await loadFeeWorkspace({ userId: 1, instId: "323", fee: "wire_domestic_outgoing", intent: "research" });
    expect(getActivePeerSet).toHaveBeenCalledWith({ userId: 1, institutionId: 323 });
    expect(getFeeResearch).toHaveBeenCalledWith(323, "wire_domestic_outgoing", expect.any(Date), { peerSet: active });
    const peersLayer = ws.layers.find((l) => l.key === "peers");
    expect(peersLayer).toMatchObject({ label: "Team peers", n: 2, amounts: [25, 30], asOf: "2026-09-02" });
    expect(peersLayer?.members?.map((m) => m.institutionId)).toEqual([1, 2]);
    expect(ws.layers.map((l) => l.key)).toEqual(["peers", "national"]);
  });

  it("keeps the default group when the saved set can't be read", async () => {
    getActivePeerSet.mockRejectedValue(new Error("db down"));
    getFeeResearch.mockResolvedValue({ institutionName: "CAPITAL CITY BANK", ownRows: [], layers: [], localMarket: null, localCompetitors: [] });
    await loadFeeWorkspace({ userId: 1, instId: "323", fee: "wire_domestic_outgoing", intent: "research" });
    expect(getFeeResearch).toHaveBeenCalledWith(323, "wire_domestic_outgoing", expect.any(Date), { peerSet: null });
  });

  it("names the researched bank, so nobody viewing it reads 'your'", async () => {
    getFeeResearch.mockResolvedValue({ institutionName: "CAPITAL CITY BANK", ownRows: [], layers: [], localMarket: null, localCompetitors: [] });
    const ws = await loadFeeWorkspace({ userId: 1, instId: "323", fee: "wire_domestic_outgoing", intent: "research" });
    expect(ws.research?.subjectName).toBe("Capital City Bank");
  });

  it("keeps a wire's direction in its name", () => {
    expect(feeName("wire_domestic_outgoing")).toBe("Outgoing Domestic Wire");
    expect(feeName("overdraft")).not.toMatch(/\(/);
  });
});
