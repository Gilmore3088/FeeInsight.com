import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./core", () => ({ getInstitutionById: vi.fn() }));
vi.mock("./fee-index", () => ({
  getInstitutionOwnFees: vi.fn(),
  getPeerFeeValues: vi.fn(),
  peerInstitutionIds: (f: { institutionIds?: number[] }) => (f.institutionIds?.length ? f.institutionIds : null),
}));
vi.mock("./connection", () => ({ sql: vi.fn() }));
vi.mock("./rate-fees", () => ({ getRateFeesByInstitution: vi.fn(() => Promise.resolve([])) }));

import { getInstitutionById } from "./core";
import { getInstitutionOwnFees, getPeerFeeValues, type PeerFeeValue } from "./fee-index";
import { getRateFeesByInstitution } from "./rate-fees";
import {
  comparePeerCategory,
  defaultPeerFilters,
  describePeerGroup,
  getPeerComparison,
  midRankPercentile,
} from "./peer-comparison";

/** One stated price, as the own-fee reader gives it. */
const one = (price: number) => ({ category: "", value: price, price, low: price, high: price, fees: [{ name: "Fee", amount: price }] });

const peer = (institution_id: number, amount: number): PeerFeeValue => ({
  institution_id,
  institution_name: `Peer ${institution_id}`,
  state_code: "TX",
  amount,
  source_document_ids: [],
  document_urls: [],
  published_at: null,
});

describe("peer comparison math", () => {
  it("places an amount by mid-rank: lower peers plus half of ties", () => {
    // 2 lower, 1 the same, 3 higher of 6: (2 + 0.5) / 6 = 41.7%.
    expect(midRankPercentile(30, [25, 28, 30, 32, 35, 36])).toEqual({ lower: 2, same: 1, higher: 3, percentile: 42 });
    expect(midRankPercentile(10, [20, 30])).toMatchObject({ lower: 0, higher: 2, percentile: 0 });
    expect(midRankPercentile(40, [20, 30])).toMatchObject({ lower: 2, higher: 0, percentile: 100 });
    expect(midRankPercentile(30, [30, 30, 30])).toMatchObject({ same: 3, percentile: 50 });
    // Within half a cent is the same price.
    expect(midRankPercentile(30, [30.004])).toMatchObject({ same: 1 });
    expect(midRankPercentile(30, [])).toMatchObject({ percentile: null });
  });

  it("gives the peers' median and middle half at the minimum sample", () => {
    const row = comparePeerCategory("nsf", one(30), [peer(1, 20), peer(2, 25), peer(3, 30), peer(4, 35), peer(5, 40)]);
    expect(row).toMatchObject({
      category: "nsf",
      amount: 30,
      peer_count: 5,
      peer_median: 30,
      peer_p25: 25,
      peer_p75: 35,
      peers_lower: 2,
      peers_same: 1,
      peers_higher: 2,
      percentile: 50,
      maturity_tier: "provisional",
    });
  });

  it("ranks no price when the institution states several different fees in the category", () => {
    const several = { price: null, low: 150, high: 175, fees: [{ name: "Levy", amount: 150 }, { name: "Garnishment", amount: 175 }] };
    const row = comparePeerCategory("garnishment", several, [peer(1, 100), peer(2, 125), peer(3, 150), peer(4, 160), peer(5, 200)]);
    // The peers' median still shows; the bank's $162.50 median of two fees is never placed among them.
    expect(row).toMatchObject({ amount: null, amount_low: 150, amount_high: 175, peer_median: 150, percentile: null, peers_lower: null });
    expect(row.fees.map((f) => f.name)).toEqual(["Levy", "Garnishment"]);
  });

  it("withholds median, percentiles and placement below the minimum sample", () => {
    const row = comparePeerCategory("nsf", one(30), [peer(1, 20), peer(2, 25), peer(3, 35), peer(4, 40)]);
    expect(row).toMatchObject({
      peer_count: 4,
      peer_median: null,
      peer_p25: null,
      peer_p75: null,
      peers_lower: null,
      peers_same: null,
      peers_higher: null,
      percentile: null,
      maturity_tier: "insufficient",
    });
  });

  it("builds the default peers from charter, asset tier and Fed district, and names them", () => {
    const filters = defaultPeerFilters({ charter_type: "bank", asset_size_tier: "community_mid", fed_district: 11 });
    expect(filters).toEqual({ charter_type: "bank", asset_tiers: ["community_mid"], fed_districts: [11] });
    expect(describePeerGroup(filters)).toBe("Banks with $300M to $1B in assets in the Dallas Fed district");
    expect(defaultPeerFilters({ charter_type: "credit_union", asset_size_tier: null, fed_district: null })).toEqual({ charter_type: "credit_union" });
    expect(describePeerGroup({ institutionIds: [4, 5] })).toBe("2 chosen institutions");
  });
});

describe("getPeerComparison", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(getInstitutionById).mockResolvedValue({
      id: 12, institution_name: "Example Bank", state_code: "TX", charter_type: "bank", asset_size_tier: "community_mid", fed_district: 11,
    } as never);
    vi.mocked(getInstitutionOwnFees).mockResolvedValue(new Map([["overdraft", one(35)], ["wire_domestic_outgoing", one(25)]]));
    vi.mocked(getPeerFeeValues).mockResolvedValue([
      new Map([
        ["overdraft", [peer(1, 25), peer(2, 30), peer(3, 30), peer(4, 32), peer(5, 36), peer(6, 38)]],
        ["wire_domestic_outgoing", [peer(1, 20), peer(2, 30)]],
      ]),
    ]);
  });

  it("compares each dollar fee with the default peers, leaving the institution out", async () => {
    const result = await getPeerComparison(12, null);

    expect(getPeerFeeValues).toHaveBeenCalledWith(
      [{ charter_type: "bank", asset_tiers: ["community_mid"], fed_districts: [11] }],
      ["overdraft", "wire_domestic_outgoing"],
      12,
    );
    expect(result?.peer_group).toMatchObject({ basis: "default", definition: { fed_districts: [11] }, peer_ids: null, peers_with_fees: 6 });
    const overdraft = result?.categories.find((c) => c.category === "overdraft");
    // 4 lower, 0 the same, 2 higher of 6: 66.7%.
    expect(overdraft).toMatchObject({ amount: 35, peer_count: 6, peer_median: 31, peers_lower: 4, peers_higher: 2, percentile: 67 });
    const wire = result?.categories.find((c) => c.category === "wire_domestic_outgoing");
    expect(wire).toMatchObject({ peer_count: 2, peer_median: null, percentile: null });
  });

  it("uses chosen peers exactly, without the institution itself", async () => {
    const result = await getPeerComparison(12, [12, 4, 5]);
    expect(getPeerFeeValues).toHaveBeenCalledWith([{ institutionIds: [4, 5] }], expect.any(Array), 12);
    expect(result?.peer_group).toMatchObject({ basis: "chosen", label: "2 chosen institutions", peer_ids: [4, 5], definition: null });
  });

  it("lists rate fees apart and words nothing as a judgment", async () => {
    vi.mocked(getRateFeesByInstitution).mockResolvedValue([{
      id: 9, institution_id: 12, fee_name: "Foreign Transaction Fee", fee_category: "card_foreign_txn", frequency: null,
      conditions: null, source_url: "https://example.com/fees.pdf", amount_kind: "percent", rate_percent: 3,
      rate_min_amount: null, rate_max_amount: null, rate_basis: "transaction", rate_label: "3% of the transaction",
    }]);
    const result = await getPeerComparison(12, null);

    expect(getRateFeesByInstitution).toHaveBeenCalledWith(12, "consumer");
    expect(result?.rate_fees).toEqual([expect.objectContaining({ category: "card_foreign_txn", rate_percent: 3, rate_terms: "3% of the transaction" })]);
    expect(result?.categories.some((c) => c.category === "card_foreign_txn")).toBe(false);
    const values = JSON.stringify(Object.values(result ?? {}));
    expect(values).not.toMatch(/too high|too low|overpriced|expensive|cheap|recommend|should|consider raising|consider lowering/i);
  });

  it("returns null for an unknown institution", async () => {
    vi.mocked(getInstitutionById).mockResolvedValue(null);
    await expect(getPeerComparison(999, null)).resolves.toBeNull();
  });
});
