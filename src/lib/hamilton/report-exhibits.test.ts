import { describe, expect, it } from "vitest";
import { annualServiceCharges, buildFeeImpacts, buildLocalComparisons, buildReportExhibits, cheapestRank, countedLocalCompetitors, MIN_LOCAL_COMPETITORS_FOR_MEDIAN, peerBand } from "./report-exhibits";
import { SISTER_CHARTERS_NOTE } from "./workspace/deliverables";
import { checkNarrativeFigures } from "./figure-check";
import type { SelectedInstitutionFeeDelta } from "./report-evidence";
import type { LocalMarket } from "@/lib/data-store/local-market";

function delta(fee_category: string, institution_amount: number, peer_median: number): SelectedInstitutionFeeDelta {
  return {
    fee_name: fee_category,
    fee_category,
    institution_amount,
    peer_median,
    peer_p25: null,
    peer_p75: null,
    delta_amount: institution_amount - peer_median,
    delta_percent: ((institution_amount - peer_median) / peer_median) * 100,
    position: institution_amount > peer_median ? "above_peer_median" : "below_peer_median",
    evidence_tier: "verified",
    excluded_from_verified_benchmark: false,
    institution_count: 40,
    maturity: "strong",
    confidence: null,
    source_url: null,
  };
}

function market(fees: Array<Record<string, number>>): LocalMarket {
  return {
    basis: "branch_counties",
    label: "Flora, IL area",
    county_fips: [17025],
    sod_year: 2026,
    competitors: fees.map((f, i) => ({
      institution_id: i + 1,
      institution_name: `Bank ${i + 1}`,
      charter_type: "bank",
      market_deposits: null,
      fees: f,
      document_url: null,
      document_date: null,
    })),
  };
}

describe("buildLocalComparisons", () => {
  it(`gives a local median only with at least ${MIN_LOCAL_COMPETITORS_FOR_MEDIAN} competitors publishing the fee`, () => {
    const rows = buildLocalComparisons(
      [delta("nsf", 25, 30), delta("overdraft", 30, 32)],
      market([{ nsf: 30, overdraft: 35 }, { nsf: 32 }, { nsf: 28, overdraft: 33 }, { nsf: 26, overdraft: 37 }, { nsf: 34, overdraft: 31 }]),
    );
    const nsf = rows.find((row) => row.fee_category === "nsf");
    const overdraft = rows.find((row) => row.fee_category === "overdraft");
    expect(nsf).toMatchObject({ local_median: 30, local_competitor_count: 5, position_vs_local: "below" });
    expect(overdraft).toMatchObject({ local_median: null, local_competitor_count: 4, position_vs_local: null });
  });
});

describe("buildFeeImpacts", () => {
  it("sizes each gap per item against the local median when there is one, with no income figure (#1896)", () => {
    const deltas = [delta("nsf", 25, 30), delta("overdraft", 30, 32)];
    const local = buildLocalComparisons(deltas, market([{ nsf: 30 }, { nsf: 32 }, { nsf: 28 }, { nsf: 26 }, { nsf: 34 }]));
    const impacts = buildFeeImpacts(deltas, local);
    expect(impacts).toEqual([
      expect.objectContaining({ fee_category: "nsf", reference: "local median", gap_amount: 5 }),
      expect.objectContaining({ fee_category: "overdraft", reference: "peer median", gap_amount: 2 }),
    ]);
    for (const impact of impacts) {
      expect(impact).not.toHaveProperty("income_per_1000_amount");
      expect(impact).not.toHaveProperty("share_of_service_charges_pct");
    }
    // The figures Hamilton may quote trace back to the payload; a per-1,000 income figure no longer does.
    expect(checkNarrativeFigures("Moving NSF from $25 to $30 adds $5 per item.", { impacts }).unmatched).toEqual([]);
    expect(checkNarrativeFigures("Moving NSF to $30 is worth $5,000 per 1,000 charges.", { impacts }).unmatched).not.toEqual([]);
  });

  it("shows each price move per item and by rank, with no per-1,000 or share-of-income column, on screen and in the PDF alike", () => {
    const { exhibits } = buildReportExhibits({
      institutionName: "Example Bank",
      deltas: [delta("nsf", 25, 30), delta("overdraft", 30, 32)],
      peerLabel: "peers",
      market: market([{ nsf: 30 }, { nsf: 32 }, { nsf: 28 }, { nsf: 26 }, { nsf: 34 }]),
      serviceCharges: { year: 2025, amount: 1_000_000, source: "fdic" },
    });
    const move = exhibits.find((e) => e.id === "dollar_impact");
    expect(move?.columns).toEqual(["Fee", "Move", "Change per item", "Local rank, lowest price first", "Against peers"]);
    expect(move?.title).toBe("The largest price move is the NSF / returned item fee: $25.00 to the local median of $30.00, +$5.00 per item");
    expect(move?.rows[0]).toEqual(["NSF / Returned Item", "$25.00 to $30.00 (local median)", "+$5.00", "1st to 3rd of 6", "From below the median to at the median"]);
    const text = JSON.stringify(move);
    expect(text).not.toMatch(/1,000|Share of|income change/i);
  });
});

describe("price-move scenarios", () => {
  it("ranks the fee among local competitors before and after moving to the reference price", () => {
    const deltas = [delta("nsf", 36, 30)];
    const local = buildLocalComparisons(deltas, market([{ nsf: 30 }, { nsf: 32 }, { nsf: 28 }, { nsf: 35 }, { nsf: 31 }]));
    const [impact] = buildFeeImpacts(deltas, local);
    // Local median of 28, 30, 31, 32, 35 is 31; today 36 is the most expensive of 6.
    expect(impact).toMatchObject({ reference_amount: 31, local_rank_today: 6, local_rank_at_reference: 3, local_field_size: 6 });
  });

  it("places amounts in peer bands, falling back to above/below the median without quartiles", () => {
    expect(peerBand(40, 25, 30, 35)).toBe("above the 75th percentile");
    expect(peerBand(30, 25, 30, 35)).toBe("at the median");
    expect(peerBand(27, 25, 30, 35)).toBe("between the 25th percentile and the median");
    expect(peerBand(20, null, 30, null)).toBe("below the median");
    expect(cheapestRank(30, [30, 30, 25])).toBe(2);
  });
});

describe("competitor moves", () => {
  it("lists local price changes newest first and tells the model when tracking began", () => {
    const result = buildReportExhibits({
      institutionName: "Example Bank",
      deltas: [delta("nsf", 30, 30)],
      peerLabel: "state peers",
      market: market([{ nsf: 30 }]),
      serviceCharges: null,
      moves: [{ institution_id: 1, institution_name: "Bank  1", fee_category: "nsf", previous_amount: 35, new_amount: 30, detected_at: "2026-10-06" }],
    });
    const exhibit = result.exhibits.find((e) => e.id === "competitor_moves");
    expect(exhibit?.title).toBe("1 local price change on these fees since 2026-10-05: 0 up, 1 down");
    expect(exhibit?.rows[0]).toEqual(["Bank 1", expect.any(String), "$35.00", "$30.00", "-$5.00", "2026-10-06"]);
    expect(result.data.local_moves).toMatchObject({ tracked_since: "2026-10-05", moves: [{ change_amount: -5 }] });
  });

  it("shows no exhibit without moves, but still tells the model tracking began", () => {
    const result = buildReportExhibits({ institutionName: "Example Bank", deltas: [delta("nsf", 30, 30)], peerLabel: "peers", market: market([{ nsf: 30 }]), serviceCharges: null });
    expect(result.exhibits.some((e) => e.id === "competitor_moves")).toBe(false);
    expect(result.data.local_moves).toEqual({ tracked_since: "2026-10-05", moves: [] });
  });
});

describe("annualServiceCharges", () => {
  it("sums the four FDIC quarters of the latest complete year, in dollars", () => {
    const quarters = ["2025-03-31", "2025-06-30", "2025-09-30", "2025-12-31"].map((report_date) => ({
      report_date, source: "fdic", service_charge_income: 250,
    }));
    const partial = { report_date: "2026-03-31", source: "fdic", service_charge_income: 300 };
    expect(annualServiceCharges([partial, ...quarters])).toEqual({ year: 2025, amount: 1_000_000, source: "fdic" });
  });

  it("uses the December year-to-date value for NCUA and ignores ffiec rows", () => {
    expect(
      annualServiceCharges([
        { report_date: "2025-06-30", source: "ncua", service_charge_income: 282_949 },
        { report_date: "2025-12-31", source: "ncua", service_charge_income: 574_830 },
      ]),
    ).toEqual({ year: 2025, amount: 574_830_000, source: "ncua" });
    expect(
      annualServiceCharges([{ report_date: "2025-12-31", source: "ffiec", service_charge_income: 821_921_000_000 }]),
    ).toBeNull();
  });

  it("returns null without a complete year", () => {
    expect(annualServiceCharges([{ report_date: "2026-06-30", source: "fdic", service_charge_income: 10 }])).toBeNull();
  });
});

describe("named local competitors with several fees (#1931)", () => {
  it("names a competitor's stated price, or its range with each fee, and keeps the local median per institution", () => {
    const m = market([{ garnishment: 100 }, { garnishment: 162.5 }, { garnishment: 120 }, { garnishment: 110 }, { garnishment: 140 }]);
    m.competitors[1].several = { garnishment: { low: 150, high: 175, fees: [{ name: "Levy", amount: 150 }, { name: "Garnishment", amount: 175 }] } };
    const [row] = buildLocalComparisons([delta("garnishment", 125, 110)], m);
    // Group statistics: one value per institution, unchanged.
    expect(row.local_median).toBe(120);
    expect(row.local_amounts).toEqual([100, 110, 120, 140, 162.5]);
    const { exhibits } = buildReportExhibits({ institutionName: "Subject", deltas: [delta("garnishment", 125, 110)], peerLabel: "peers", market: m, serviceCharges: null });
    const cell = exhibits.find((e) => e.id === "local_market")!.rows[0][4];
    expect(cell).toBe("Bank 1 $100.00; Bank 2 $150.00 to $175.00 (Levy $150.00; Garnishment $175.00); Bank 3 $120.00");
  });
});

describe("sister charters in the local exhibit count once (statistics rule 7, #1441)", () => {
  // The Laredo shape with invented amounts: IBC Laredo (160), Commerce Bank Laredo (1319) and
  // IBC Zapata (1769) share one fee schedule, so seven charters are five counted institutions.
  function laredo(): LocalMarket {
    const m = market([{ nsf: 30 }, { nsf: 30 }, { nsf: 30 }, { nsf: 25 }, { nsf: 35 }, { nsf: 20 }, { nsf: 40 }]);
    const ids = [160, 1319, 1769, 11, 12, 13, 14];
    const names = ["IBC Laredo", "Commerce Bank Laredo", "IBC Zapata"];
    m.competitors.forEach((c, i) => {
      c.institution_id = ids[i];
      if (names[i]) c.institution_name = names[i];
    });
    m.competitors[1].counted_as = { nsf: 160 };
    m.competitors[2].counted_as = { nsf: 160 };
    return m;
  }

  it("takes the median, range, count and ranks over five institutions, not seven charters", () => {
    const [row] = buildLocalComparisons([delta("nsf", 33, 30)], laredo());
    expect(row.local_amounts).toEqual([20, 25, 30, 35, 40]);
    expect(row).toMatchObject({ local_median: 30, local_competitor_count: 5, local_min: 20, local_max: 40, position_vs_local: "above" });
    // Every charter keeps its named row (the exhibit names the first three).
    expect(row.competitors.map((c) => c.name)).toEqual(["IBC Laredo", "Commerce Bank Laredo", "IBC Zapata"]);
    const [impact] = buildFeeImpacts([delta("nsf", 33, 30)], [row]);
    expect(impact).toMatchObject({ local_rank_today: 4, local_field_size: 6 });
  });

  it("gives no median when the counted institutions fall below the minimum, though the charters reach it", () => {
    const m = laredo();
    m.competitors = m.competitors.slice(0, 6);
    const [row] = buildLocalComparisons([delta("nsf", 33, 30)], m);
    expect(row).toMatchObject({ local_median: null, local_competitor_count: 4 });
    const { exhibits } = buildReportExhibits({ institutionName: "Subject", deltas: [delta("nsf", 33, 30)], peerLabel: "peers", market: m, serviceCharges: null });
    expect(exhibits.find((e) => e.id === "local_market")!.rows[0][2]).toBe("n=4, too few");
  });

  it("counts five competitors in the title and data, and says why in the note", () => {
    const result = buildReportExhibits({ institutionName: "Subject", deltas: [delta("nsf", 33, 30)], peerLabel: "peers", market: laredo(), serviceCharges: null });
    const exhibit = result.exhibits.find((e) => e.id === "local_market")!;
    expect(exhibit.title).toBe("Against 5 local competitors, Subject is above the local median on 1 of 1 fees and below on 0");
    expect(exhibit.note).toContain(SISTER_CHARTERS_NOTE);
    expect(exhibit.note).not.toMatch(/—/);
    expect(result.data.local_market?.competitors_with_fees).toBe(5);
    expect(countedLocalCompetitors(laredo())).toBe(5);
  });

  it("adds no note when every charter counts as itself", () => {
    const result = buildReportExhibits({ institutionName: "Subject", deltas: [delta("nsf", 33, 30)], peerLabel: "peers", market: market([{ nsf: 30 }, { nsf: 25 }, { nsf: 35 }, { nsf: 20 }, { nsf: 40 }]), serviceCharges: null });
    expect(result.exhibits.find((e) => e.id === "local_market")!.note).not.toContain(SISTER_CHARTERS_NOTE);
  });
});
