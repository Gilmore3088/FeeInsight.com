import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => ({ sql: Object.assign(vi.fn(), { unsafe: vi.fn() }) }));
vi.mock("./peer-markets", () => ({ getHomeMarket: vi.fn(), getMarketInstitutionIds: vi.fn(), getMarketBranchCities: vi.fn(), getMarketPresence: vi.fn() }));

import { sql } from "./connection";
import { getHomeMarket, getMarketBranchCities, getMarketPresence } from "./peer-markets";
import type { PeerFeeValue } from "./fee-index";
import { buildPeerExplorerSet, explorerFee, getPeerExplorerSet, groupBranchCities } from "./peer-explorer";
import { activeInstitutionFilter } from "./fee-stats";

const ACTIVE_RULE = "<active institution rule>";

const value = (institution_id: number, amount: number, records: [number, number, string | null, string | null][] = []): PeerFeeValue => ({
  institution_id,
  institution_name: `Bank ${institution_id}`,
  state_code: "FL",
  amount,
  source_document_ids: [],
  document_urls: [],
  published_at: null,
  fee_records: records.map(([id, amt, fee_name, conditions]) => ({
    id, amount: amt, fee_name, conditions, frequency: "monthly", fee_audience: "consumer", source_document_id: 1, document_url: null,
  })),
});

const fact = (id: number, name: string, asset_size: number | null, city = "TALLAHASSEE", state_code = "FL") => ({
  id, institution_name: name, asset_size, city, state_code, charter_type: "bank",
});

describe("explorerFee", () => {
  it("lists every price behind a value, lowest first, with its name and waiver", () => {
    expect(explorerFee(value(1, 8.45, [[7, 11.9, "Premier Checking Monthly Service Fee", null], [3, 5, "Basic Checking Monthly Service Fee", "Waived with   $500 balance"]]))).toEqual({
      amount: 8.45,
      prices: [
        { amount: 5, name: "Basic Checking Monthly Service Fee", account: "Basic Checking", conditions: "Waived with $500 balance" },
        { amount: 11.9, name: "Premier Checking Monthly Service Fee", account: "Premier Checking", conditions: null },
      ],
    });
  });

  it("derives each price's short account name from the fee's own name, or none", () => {
    const fee = explorerFee(value(1, 8.45, [[1, 7.95, "Carefree Checking Monthly Maintenance Fee", null], [2, 8.95, "Monthly service charge (Everyday Checking)", null], [3, 9.5, "Monthly Service Fee", null]]));
    expect(fee.prices?.map((price) => price.account)).toEqual(["Carefree Checking", "Everyday Checking", null]);
  });

  it("keeps a single price as the value alone", () => {
    expect(explorerFee(value(1, 10, [[1, 10, "Monthly Service Fee", null]]))).toEqual({ amount: 10 });
  });
});

describe("buildPeerExplorerSet", () => {
  const byCategory = new Map<string, PeerFeeValue[]>([
    ["monthly_maintenance", [1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((id) => value(id, id))],
    ["overdraft", [value(1, 35), value(2, 30)]],
  ]);
  const facts = [
    fact(1, "Capital City Bank", 4_447_362),
    ...[2, 3, 4, 5, 6, 7, 8, 9].map((id) => fact(id, `Peer ${id}`, id * 1_000_000)),
    fact(10, "Frost Bank", 52_000_000, "SAN ANTONIO", "TX"),
  ];

  it("keeps the subject apart, converts assets to dollars and leaves Frost Bank out of every figure", () => {
    const set = buildPeerExplorerSet(1, facts, byCategory)!;
    expect(set.subject).toMatchObject({ id: 1, name: "Capital City Bank", assets: 4_447_362_000, city: "Tallahassee", state: "FL" });
    expect(set.peers.map((p) => p.id)).toEqual([2, 3, 4, 5, 6, 7, 8, 9]);
    // Eight peers publish maintenance (2..9): median 5.5; Frost's $10 is not among them.
    expect(set.medians.monthly_maintenance).toEqual({ median: 5.5, peers: 8 });
    // One peer publishes overdraft: below the floor, so no median.
    expect(set.medians.overdraft).toBeUndefined();
  });

  it("shows nothing on a page whose own institution is never named", () => {
    expect(buildPeerExplorerSet(10, facts, byCategory)).toBeNull();
    expect(buildPeerExplorerSet(99, facts, byCategory)).toBeNull();
  });
});

describe("getPeerExplorerSet", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads a chosen set's facts and fees for only its institutions, with their conditions", async () => {
    const db = sql as unknown as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
    db.mockResolvedValueOnce([{ id: 1, charter_type: "bank", asset_size: 4_447_362 }]);
    db.mockResolvedValueOnce([fact(1, "Capital City Bank", 4_447_362), fact(2, "Peer 2", 2_000_000)]);
    db.unsafe.mockReturnValueOnce(ACTIVE_RULE).mockResolvedValueOnce([]);
    const set = await getPeerExplorerSet(1, { institutionIds: [2, 3] });
    expect(set?.peers.map((p) => p.id)).toEqual([2]);
    // The facts read leaves out institutions the regulator marks inactive, except the page's own.
    expect(db.unsafe.mock.calls[0]).toEqual([activeInstitutionFilter("s")]);
    const [query, params] = db.unsafe.mock.calls[1];
    expect(query).toContain("ef.conditions");
    expect(query).toContain("ef.institution_id = ANY($2::bigint[])");
    expect(params[1]).toEqual([1, 2]);
  });
});

describe("getPeerExplorerSet for a large set", () => {
  beforeEach(() => vi.clearAllMocks());

  it("reads amounts for every member, then prices and conditions for the 50 closest in assets only", async () => {
    const db = sql as unknown as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
    const ids = Array.from({ length: 3000 }, (_, i) => i + 2);
    db.mockResolvedValueOnce([{ id: 1, charter_type: "bank", asset_size: 1_000_000 }]);
    db.mockResolvedValueOnce([fact(1, "Capital City Bank", 1_000_000), ...ids.map((id) => fact(id, `Peer ${id}`, id * 1_000))]);
    db.unsafe.mockReturnValueOnce(ACTIVE_RULE).mockResolvedValueOnce([]).mockResolvedValueOnce([]);
    const set = await getPeerExplorerSet(1, { institutionIds: ids });
    expect(set?.peers).toHaveLength(50);
    expect(set?.whole?.peers).toBe(3000);
    // Closest to $1B: 1,000 (=$1.0B) first, then 999 and 1,001, and so on.
    expect(set?.peers[0].id).toBe(1000);
    const [wholeQuery, wholeParams] = db.unsafe.mock.calls[1];
    expect(wholeQuery).not.toContain("ef.conditions");
    expect(wholeParams[1]).toHaveLength(3001);
    const [shownQuery, shownParams] = db.unsafe.mock.calls[2];
    expect(shownQuery).toContain("ef.conditions");
    expect(shownParams[1]).toHaveLength(51);
  });
});

describe("getPeerExplorerSet for the home metro", () => {
  it("adds the metro's branch cities for the institutions shown", async () => {
    const db = sql as unknown as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
    db.mockResolvedValueOnce([{ id: 1, charter_type: "bank", asset_size: 4_447_362 }]);
    db.mockResolvedValueOnce([fact(1, "Capital City Bank", 4_447_362), fact(2, "Peer 2", 2_000_000)]);
    db.unsafe.mockReturnValueOnce(ACTIVE_RULE).mockResolvedValueOnce([]);
    vi.mocked(getHomeMarket).mockResolvedValue({ code: 45220, name: "Tallahassee, FL" });
    vi.mocked(getMarketBranchCities).mockResolvedValue([{ institution_id: 2, city: "QUINCY", state: "FL" }]);
    vi.mocked(getMarketPresence).mockResolvedValue({ totalDeposits: 1e10, rows: [{ institution_id: 2, branches: 3, deposits: 5e8 }] });
    const set = await getPeerExplorerSet(1, { institutionIds: [2] }, true);
    expect(getMarketBranchCities).toHaveBeenCalledWith(45220, [1, 2]);
    expect(set?.market).toEqual({
      name: "Tallahassee, FL",
      cities: [{ city: "QUINCY", state: "FL", ids: [2] }],
      presence: { 2: { branches: 3, deposits: 5e8 } },
      totalDeposits: 1e10,
    });
  });
});

describe("groupBranchCities", () => {
  it("lists each city once with every institution that has a branch there", () => {
    expect(
      groupBranchCities([
        { institution_id: 1, city: "TALLAHASSEE", state: "FL" },
        { institution_id: 2, city: "TALLAHASSEE", state: "FL" },
        { institution_id: 2, city: "QUINCY", state: "FL" },
        { institution_id: 1, city: "Tallahassee", state: "FL" },
      ]),
    ).toEqual([
      { city: "TALLAHASSEE", state: "FL", ids: [1, 2] },
      { city: "QUINCY", state: "FL", ids: [2] },
    ]);
  });
});
