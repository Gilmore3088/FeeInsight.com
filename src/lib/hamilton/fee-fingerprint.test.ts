import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getInstitutionOwnFees: vi.fn(),
  getActivePeerSet: vi.fn(),
  getEnginePeerGroup: vi.fn(),
}));
vi.mock("@/lib/data-store/fee-index", () => ({ getInstitutionOwnFees: mocks.getInstitutionOwnFees }));
vi.mock("./active-peer-set", () => ({ getActivePeerSet: mocks.getActivePeerSet }));
vi.mock("./workspace/research", () => ({ getEnginePeerGroup: mocks.getEnginePeerGroup, getFeeResearch: vi.fn() }));
vi.mock("./workspace-context", () => ({ resolveHamiltonInstitutionContext: vi.fn() }));

import { buildFeeFingerprint, buildFingerprintStrip, fingerprintCategories, loadFeeFingerprint } from "./fee-fingerprint";
import { FEATURED_FEES } from "./fee-workspace-data";
import { LOCAL_COMPETITORS_GROUP, MIN_LOCAL_PEERS_FOR_POSITION, MIN_PEERS_FOR_POSITION } from "./workspace/scenario";
import type { PeerValue } from "./workspace/types";

function peer(id: number, amount: number, publishedAt = "2026-09-01"): PeerValue {
  return { institutionId: id, institutionName: `Peer ${id}`, amount, stateCode: "GA", sourceDocumentIds: [id], documentUrls: [], publishedAt };
}
const peers = (n: number, start = 20) => Array.from({ length: n }, (_, i) => peer(i + 1, start + i));
const own = (price: number | null, low = price ?? 25, high = price ?? 35) => ({ price, low, high });

describe("fee position fingerprint strips", () => {
  it("places the fee with a median and percentile at the minimum peer count", () => {
    const strip = buildFingerprintStrip("overdraft", own(29), peers(MIN_PEERS_FOR_POSITION), MIN_PEERS_FOR_POSITION);
    expect(strip.status).toBe("placed");
    expect(strip.peerCount).toBe(MIN_PEERS_FOR_POSITION);
    expect(strip.band).toEqual({ p25: 22.25, median: 24.5, p75: 26.75 });
    expect(strip.percentile).toBeGreaterThan(90);
    expect(strip.namedPeers).toEqual([]);
    expect(strip.period).toEqual({ from: "2026-09-01", to: "2026-09-01" });
  });

  it("names the peers and their prices, with no median, below the minimum", () => {
    const strip = buildFingerprintStrip("overdraft", own(29), peers(MIN_PEERS_FOR_POSITION - 1), MIN_PEERS_FOR_POSITION);
    expect(strip.status).toBe("few_peers");
    expect(strip.band).toBeNull();
    expect(strip.percentile).toBeNull();
    expect(strip.namedPeers).toHaveLength(MIN_PEERS_FOR_POSITION - 1);
    expect(strip.namedPeers[0]).toEqual({ institutionName: "Peer 1", amount: 20 });
  });

  it("counts sister charters of one schedule once", () => {
    const sisters = [...peers(MIN_PEERS_FOR_POSITION - 1), { ...peer(99, 30), countedAs: 1 }];
    const strip = buildFingerprintStrip("overdraft", own(29), sisters, MIN_PEERS_FOR_POSITION);
    expect(strip.peerCount).toBe(MIN_PEERS_FOR_POSITION - 1);
    expect(strip.status).toBe("few_peers");
  });

  it("keeps an unpublished fee as missing, with the peers still counted", () => {
    const strip = buildFingerprintStrip("stop_payment", undefined, peers(12), MIN_PEERS_FOR_POSITION);
    expect(strip.status).toBe("not_published");
    expect(strip.current).toBeNull();
    expect(strip.currentLabel).toBeNull();
    expect(strip.peerCount).toBe(12);
    expect(strip.band).not.toBeNull();
  });

  it("does not place a fee the schedule states at several amounts", () => {
    const strip = buildFingerprintStrip("stop_payment", own(null, 25, 35), peers(12), MIN_PEERS_FOR_POSITION);
    expect(strip.status).toBe("several_amounts");
    expect(strip.percentile).toBeNull();
    expect(strip.currentLabel).toMatch(/to/);
  });

  it("says no peer publishes it when none does", () => {
    expect(buildFingerprintStrip("overdraft", own(29), [], MIN_PEERS_FOR_POSITION).status).toBe("no_peers");
  });

  it("spans the period from the oldest to the newest peer fee", () => {
    const strip = buildFingerprintStrip("overdraft", own(29), [peer(1, 20, "2026-03-04T00:00:00Z"), peer(2, 30, "2026-10-01")], MIN_PEERS_FOR_POSITION);
    expect(strip.period).toEqual({ from: "2026-03-04", to: "2026-10-01" });
  });
});

describe("fee position fingerprint", () => {
  it("lists every featured fee first, missing ones included, then the institution's other fees", () => {
    const categories = fingerprintCategories(["zz_custom_fee", "overdraft"]);
    expect(categories.slice(0, FEATURED_FEES.length)).toEqual([...FEATURED_FEES]);
    expect(categories).toContain("zz_custom_fee");
    expect(categories.filter((c) => c === "overdraft")).toHaveLength(1);
  });

  it("needs 10 peers for a median, or 5 for local competitors", () => {
    const input = {
      institutionName: "Capital City Bank",
      saved: true,
      ownFees: new Map([["overdraft", own(29)]]),
      peersByCategory: new Map([["overdraft", peers(MIN_LOCAL_PEERS_FOR_POSITION)]]),
    };
    const named = buildFeeFingerprint({ ...input, peerLabel: "Team peers" });
    expect(named.minPeers).toBe(MIN_PEERS_FOR_POSITION);
    expect(named.strips.find((s) => s.feeCategory === "overdraft")?.status).toBe("few_peers");
    const local = buildFeeFingerprint({ ...input, peerLabel: LOCAL_COMPETITORS_GROUP });
    expect(local.minPeers).toBe(MIN_LOCAL_PEERS_FOR_POSITION);
    expect(local.strips.find((s) => s.feeCategory === "overdraft")?.status).toBe("placed");
  });

  it("shows every featured fee the institution lacks as missing", () => {
    const fp = buildFeeFingerprint({
      institutionName: "Capital City Bank",
      peerLabel: "Team peers",
      saved: true,
      ownFees: new Map([["overdraft", own(29)]]),
      peersByCategory: new Map(),
    });
    expect(fp.strips).toHaveLength(FEATURED_FEES.length);
    expect(fp.strips.filter((s) => s.status === "not_published")).toHaveLength(FEATURED_FEES.length - 1);
    expect(fp.source).toMatch(/published schedule/);
  });
});

describe("loadFeeFingerprint", () => {
  beforeEach(() => {
    mocks.getActivePeerSet.mockReset();
    mocks.getEnginePeerGroup.mockReset();
    mocks.getInstitutionOwnFees.mockResolvedValue(
      new Map([["overdraft", { category: "overdraft", value: 29, price: 29, low: 29, high: 29, fees: [] }]]),
    );
    mocks.getEnginePeerGroup.mockImplementation(async (_id: number, categories: string[]) => ({
      institutionName: "CAPITAL CITY BANK",
      peerLabel: "Team peers",
      saved: true,
      fees: categories.map((feeCategory) => ({ feeCategory, peers: feeCategory === "overdraft" ? peers(12) : [] })),
    }));
  });

  it("reads the same saved peer set every other screen uses", async () => {
    const active = { id: 10, name: "Team peers", label: "Team peers", filters: { institutionIds: [1, 2, 3] } };
    mocks.getActivePeerSet.mockResolvedValue(active);
    const fp = await loadFeeFingerprint({ userId: 7, institutionId: 323 });
    expect(mocks.getActivePeerSet).toHaveBeenCalledWith({ userId: 7, institutionId: 323 });
    expect(mocks.getEnginePeerGroup).toHaveBeenCalledWith(323, expect.arrayContaining([...FEATURED_FEES]), { peerSet: active });
    expect(fp?.peerLabel).toBe("Team peers");
    expect(fp?.saved).toBe(true);
    expect(fp?.strips.find((s) => s.feeCategory === "overdraft")?.status).toBe("placed");
  });

  it("falls back to the default group when the saved set can't be read", async () => {
    mocks.getActivePeerSet.mockRejectedValue(new Error("db down"));
    await loadFeeFingerprint({ userId: 7, institutionId: 323 });
    expect(mocks.getEnginePeerGroup).toHaveBeenCalledWith(323, expect.any(Array), { peerSet: null });
  });
});
