/**
 * #1931: a named competitor or peer shows the price its schedule states, or the range and each
 * fee by name when it states several; group statistics keep one value per institution.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("./connection", () => {
  const sql = vi.fn() as ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
  sql.unsafe = vi.fn();
  return { sql, getSql: () => sql };
});

import { getFeeValuesForInstitutions, getOwnFeesForInstitutions, getPeerFeeValues } from "./fee-index";
import { getLocalMarketCompetitors } from "./local-market";
import { summarizeFees } from "./fee-stats";
import { sql } from "./connection";

type Mock = ReturnType<typeof vi.fn> & { unsafe: ReturnType<typeof vi.fn> };
const db = sql as unknown as Mock;

function peerRow(institution_id: number | string, amount: number | string, fee_name: string, id: number, fee_category = "garnishment") {
  return {
    id,
    fee_category,
    amount,
    fee_name,
    institution_id,
    institution_name: `Bank ${institution_id}`,
    review_status: "approved",
    created_at: "2026-10-03T00:00:00Z",
    charter_type: "bank",
    asset_size_tier: "community_mid",
    fed_district: 6,
    state_code: "FL",
    source_document_id: Number(institution_id) * 10,
    document_url: null,
    fee_published_id: id,
  };
}

describe("getPeerFeeValues names each peer's stated fees", () => {
  beforeEach(() => db.unsafe.mockReset());

  it("gives a peer with one fee its price and no range", async () => {
    db.unsafe.mockResolvedValueOnce([peerRow(7, "30.00", "Garnishment", 1), peerRow(7, "30.00", "Garnishment", 2)]);
    const [byCategory] = await getPeerFeeValues([{}], ["garnishment"]);
    const [peer] = byCategory.get("garnishment")!;
    expect(peer.amount).toBe(30);
    expect(peer.several).toBeUndefined();
  });

  it("gives a peer with several fees their range and names, never their median as its price", async () => {
    db.unsafe.mockResolvedValueOnce([peerRow(8, 175, "Garnishment", 3), peerRow(8, 150, "Levy", 4)]);
    const [byCategory] = await getPeerFeeValues([{}], ["garnishment"]);
    const [peer] = byCategory.get("garnishment")!;
    expect(peer.several).toEqual({ low: 150, high: 175, fees: [{ name: "Levy", amount: 150 }, { name: "Garnishment", amount: 175 }] });
    // The statistics value is still the one per-institution median.
    expect(peer.amount).toBe(162.5);
  });

  it("keeps group statistics one value per institution", async () => {
    const rows = [
      peerRow(1, 20, "Garnishment", 10),
      peerRow(2, 175, "Garnishment", 11),
      peerRow(2, 150, "Levy", 12),
      peerRow(3, 100, "Garnishment", 13),
      peerRow(4, 125, "Garnishment", 14),
      peerRow(5, 90, "Garnishment", 15),
    ];
    db.unsafe.mockResolvedValueOnce(rows);
    const [byCategory] = await getPeerFeeValues([{}], ["garnishment"]);
    const values = byCategory.get("garnishment")!;
    expect(values.map((v) => v.amount)).toEqual([20, 90, 100, 125, 162.5]);
    const stats = summarizeFees(values.map((v) => ({ institution_id: v.institution_id, amount: v.amount, fee_category: "garnishment" })));
    expect(stats.median_amount).toBe(100);
    expect(stats.institution_count).toBe(5);
  });

  it("reads ids that arrive as text", async () => {
    db.unsafe.mockResolvedValueOnce([peerRow("9", "175.00", "Garnishment", 5), peerRow("9", "150.00", "Levy", 6)]);
    const [byCategory] = await getPeerFeeValues([{}], ["garnishment"], 1);
    const [peer] = byCategory.get("garnishment")!;
    expect(peer.institution_id).toBe(9);
    expect(peer.several).toMatchObject({ low: 150, high: 175 });
  });
});

describe("getOwnFeesForInstitutions", () => {
  beforeEach(() => db.unsafe.mockReset());

  const rows = [
    { institution_id: "11", fee_category: "nsf", fee_name: "NSF", amount: "32.00" },
    { institution_id: "12", fee_category: "nsf", fee_name: "NSF item", amount: "25.00" },
    { institution_id: "12", fee_category: "nsf", fee_name: "NSF ACH", amount: "35.00" },
  ];

  it("keeps each named institution's fees apart, with ids read from text", async () => {
    db.unsafe.mockResolvedValueOnce(rows);
    const fees = await getOwnFeesForInstitutions([11, 12], ["nsf"]);
    expect(fees.get(11)?.get("nsf")).toMatchObject({ price: 32, value: 32 });
    expect(fees.get(12)?.get("nsf")).toMatchObject({ price: null, value: 30, low: 25, high: 35, fees: [{ name: "NSF item", amount: 25 }, { name: "NSF ACH", amount: 35 }] });
  });

  it("leaves out inactive institutions, as getContractFeeRows does, so the answer eval never reads a shown member as missing (#975)", async () => {
    db.unsafe.mockResolvedValueOnce([]);
    await getOwnFeesForInstitutions([11, 12], ["nsf"]);
    const query = String(db.unsafe.mock.calls[0][0]);
    expect(query).toMatch(/JOIN institution_sources ct ON ef\.institution_id = ct\.id/);
    expect(query).toContain("ct.regulatory_status IS DISTINCT FROM 'inactive'");
  });

  it("gives the same values getFeeValuesForInstitutions gives for statistics", async () => {
    db.unsafe.mockResolvedValueOnce(rows);
    const own = await getOwnFeesForInstitutions([11, 12], ["nsf"]);
    db.unsafe.mockResolvedValueOnce(rows);
    const values = await getFeeValuesForInstitutions([11, 12], ["nsf"]);
    expect(values.get(11)?.get("nsf")).toBe(own.get(11)?.get("nsf")?.value);
    expect(values.get(12)?.get("nsf")).toBe(own.get(12)?.get("nsf")?.value);
  });
});

describe("getLocalMarketCompetitors", () => {
  beforeEach(() => {
    db.mockReset();
  });

  it("keeps each competitor's value for local medians and marks several fees with their range and names", async () => {
    db.mockResolvedValueOnce([{ county_fips: 12009, year: 2025, city: "Melbourne", state: "FL", deposits: 100 }]);
    db.mockResolvedValueOnce([
      { institution_id: "21", deposits: "500", institution_name: "First Bank", charter_type: "bank", fee_category: "garnishment", amount: "100", lines: [{ fee_name: "Garnishment", amount: 100 }], document_url: null, document_date: null },
      // jsonb as text, and ids as text.
      { institution_id: "22", deposits: "400", institution_name: "Second Bank", charter_type: "bank", fee_category: "garnishment", amount: "162.5", lines: JSON.stringify([{ fee_name: "Garnishment", amount: 175 }, { fee_name: "Levy", amount: 150 }]), document_url: null, document_date: null },
    ]);
    const market = await getLocalMarketCompetitors({ institutionId: 1, certNumber: "123", city: null, stateCode: null, categories: ["garnishment"] });
    const [first, second] = market!.competitors;
    expect(first).toMatchObject({ institution_id: 21, fees: { garnishment: 100 } });
    expect(first.several?.garnishment).toBeUndefined();
    expect(second.institution_id).toBe(22);
    expect(second.fees.garnishment).toBe(162.5);
    expect(second.several?.garnishment).toEqual({ low: 150, high: 175, fees: [{ name: "Levy", amount: 150 }, { name: "Garnishment", amount: 175 }] });
  });
});
