import { describe, expect, it } from "vitest";
import type { ExtractedFee } from "@/lib/data-store/types";
import type { IndexEntry } from "@/lib/data-store/fee-index";
import type { CityMarket, CityMarketInstitution } from "@/lib/data-store/city-market";
import type { Guide } from "@/lib/guides/types";
import { accountPricesText } from "@/lib/fee-representative";
import {
  avoidGuideHref,
  buildAlternatives,
  buildCheckRows,
  checkFinding,
  marketBand,
  parseCheckId,
  rowPriceText,
  stateGroupLabel,
} from "./check-data";

const fee = (overrides: Partial<ExtractedFee>): ExtractedFee =>
  ({
    id: 1,
    institution_id: 323,
    institution_name: "Test Bank",
    fee_name: "Fee",
    fee_audience: "consumer",
    fee_category: null,
    amount: 10,
    frequency: null,
    conditions: null,
    extraction_confidence: 1,
    review_status: "approved",
    validation_flags: null,
    source_url: "https://bank.example/fees.pdf",
    ...overrides,
  }) as ExtractedFee;

const entry = (category: string, median: number, overrides: Partial<IndexEntry> = {}): IndexEntry => ({
  fee_category: category,
  fee_family: null,
  median_amount: median,
  p25_amount: median * 0.8,
  p75_amount: median * 1.2,
  min_amount: 0,
  max_amount: median * 2,
  institution_count: 40,
  observation_count: 40,
  approved_count: 40,
  bank_count: 30,
  cu_count: 10,
  maturity_tier: "strong",
  last_updated: null,
  ...overrides,
});

describe("marketBand", () => {
  it("drops a market with too few institutions or a missing bound", () => {
    expect(marketBand(entry("nsf", 30, { maturity_tier: "insufficient" }))).toBeNull();
    expect(marketBand(entry("nsf", 30, { p25_amount: null }))).toBeNull();
    expect(marketBand(undefined)).toBeNull();
    expect(marketBand(entry("nsf", 30))).toEqual({ min: 0, p25: 24, median: 30, p75: 36, max: 60, institutions: 40 });
  });
});

describe("buildCheckRows", () => {
  const fees = [
    fee({ id: 1, fee_category: "overdraft", fee_name: "Overdraft Item Paid", amount: 35 }),
    fee({ id: 2, fee_category: "nsf", fee_name: "NSF Item Returned", amount: 30 }),
    fee({ id: 3, fee_category: "stop_payment", fee_name: "Stop Payment", amount: 25 }),
  ];

  it("keeps rows with a state or national median, in headline order, with both bands", () => {
    const rows = buildCheckRows({
      verifiedFees: fees,
      nationalIndex: [entry("overdraft", 30), entry("nsf", 28)],
      stateIndex: [entry("overdraft", 32)],
      fallbackSourceUrl: null,
    });
    expect(rows.map((row) => row.category)).toEqual(["overdraft", "nsf"]);
    expect(rows[0].state?.median).toBe(32);
    expect(rows[0].nation?.median).toBe(30);
    expect(rows[1].state).toBeNull();
    expect(rows[0].sourceUrl).toBe("https://bank.example/fees.pdf");
  });

  it("names the state group only when a row has a state band", () => {
    const rows = buildCheckRows({ verifiedFees: fees, nationalIndex: [entry("nsf", 28)], stateIndex: [], fallbackSourceUrl: null });
    expect(stateGroupLabel(rows, "Florida")).toBeNull();
    const withState = buildCheckRows({ verifiedFees: fees, nationalIndex: [], stateIndex: [entry("nsf", 28)], fallbackSourceUrl: null });
    expect(stateGroupLabel(withState, "Florida")).toBe("Florida banks and credit unions");
  });
});

describe("several prices for one fee (the shared rule)", () => {
  // Capital City Bank's two monthly maintenance prices, as its schedule names them.
  const monthly = [
    fee({ id: 10, fee_category: "monthly_maintenance", fee_name: "Carefree Checking Monthly service charge", amount: 7.95, frequency: "monthly" }),
    fee({ id: 11, fee_category: "monthly_maintenance", fee_name: "Monthly service charge (Everyday Checking)", amount: 8.95, frequency: "monthly" }),
  ];
  const [row] = buildCheckRows({
    verifiedFees: monthly,
    nationalIndex: [entry("monthly_maintenance", 7)],
    stateIndex: [entry("monthly_maintenance", 7)],
    fallbackSourceUrl: null,
  });

  it("shows the range, never the computed value, and labels the compared value", () => {
    expect(rowPriceText(row)).toBe("$7.95 to $8.95, depending on account");
    expect(row.value).toBeCloseTo(8.45);
    expect(row.comparedAt).toBe("Compared at $8.45, the middle of its prices");
    expect(row.prices).toEqual([
      { account: "Carefree Checking", amount: 7.95 },
      { account: "Everyday Checking", amount: 8.95 },
    ]);
    expect(accountPricesText(row.prices, row.amounts)).toBe("Carefree Checking $7.95 \u00b7 Everyday Checking $8.95");
  });

  it("leads the finding with the range and the compared value", () => {
    expect(checkFinding([row], "Capital City Bank", "Florida")).toBe(
      "Capital City Bank's monthly maintenance fee runs $7.95 to $8.95, depending on account. Compared at $8.45, the middle of its prices, it sits $1.45 above the $7 Florida median (40 institutions).",
    );
  });

  it("labels overdraft at its highest price", () => {
    const [od] = buildCheckRows({
      verifiedFees: [
        fee({ id: 20, fee_category: "overdraft", fee_name: "Overdraft Item Fee", amount: 25 }),
        fee({ id: 21, fee_category: "overdraft", fee_name: "Overdraft Item Fee tier 2", amount: 35 }),
      ],
      nationalIndex: [entry("overdraft", 30)],
      stateIndex: [],
      fallbackSourceUrl: null,
    });
    expect(od.comparedAt).toBe("Compared at $35, its standard fee, the highest of its prices");
  });

  it("names no compared value for one price", () => {
    const [one] = buildCheckRows({ verifiedFees: [monthly[0]], nationalIndex: [entry("monthly_maintenance", 7)], stateIndex: [], fallbackSourceUrl: null });
    expect(one.comparedAt).toBeNull();
    expect(rowPriceText(one)).toBe("$7.95");
  });
});

describe("checkFinding without a fee above the median", () => {
  it("counts below and about the same", () => {
    const rows = buildCheckRows({
      verifiedFees: [
        fee({ id: 1, fee_category: "overdraft", fee_name: "Overdraft Item Paid", amount: 25 }),
        fee({ id: 2, fee_category: "nsf", fee_name: "NSF Item Returned", amount: 28 }),
      ],
      nationalIndex: [entry("overdraft", 30), entry("nsf", 28)],
      stateIndex: [],
      fallbackSourceUrl: null,
    });
    expect(checkFinding(rows, "Test Bank", "Florida")).toBe("Below the U.S. median on 1 of 2 compared fees and about the same on 1.");
  });
});

describe("avoidGuideHref", () => {
  const guide = (slug: string, primaryCategory: string, ids: string[]) =>
    ({ slug, primaryCategory, relatedCategories: [], sections: ids.map((id) => ({ id, heading: id, blocks: [] })) }) as unknown as Guide;
  it("links the fee's guide at its section on avoiding the fee", () => {
    const guides = [guide("atm-fees", "atm_non_network", ["start-here", "find-cash"]), guide("wire-transfer-fees", "wire_domestic_outgoing", ["what-it-is"])];
    expect(avoidGuideHref("atm_non_network", guides)).toBe("/guides/atm-fees#find-cash");
    expect(avoidGuideHref("wire_domestic_outgoing", guides)).toBe("/guides/wire-transfer-fees");
    expect(avoidGuideHref("stop_payment", guides)).toBeNull();
  });
});

describe("buildAlternatives", () => {
  const inst = (id: number, name: string, amount: number | null, account = "Basic Checking"): CityMarketInstitution =>
    ({
      id,
      name,
      charter: "bank",
      hq_city: null,
      hq_state: "FL",
      branches: 1,
      deposits: null,
      schedule: "published",
      fees:
        amount === null
          ? {}
          : { monthly_maintenance: { amount, fee_name: "Monthly fee", account, conditions: [], source_line: null, source_url: null, read_on: null } },
    }) as CityMarketInstitution;
  const market = {
    institutions: [
      inst(323, "Capital City Bank", 7.95),
      inst(1, "Cheaper Bank", 0),
      inst(2, "Same Bank", 7.95),
      inst(3, "No Fee Listed", null),
      inst(4, "Savings Only Bank", 2, "Statement Savings"),
    ],
  } as unknown as CityMarket;
  const ownFees = [
    fee({ id: 10, fee_category: "monthly_maintenance", fee_name: "Carefree Checking Monthly service charge", amount: 7.95, frequency: "monthly" }),
    fee({ id: 11, fee_category: "monthly_maintenance", fee_name: "Monthly service charge (Everyday Checking)", amount: 8.95, frequency: "monthly" }),
    fee({ id: 12, fee_category: "monthly_maintenance", fee_name: "Statement Savings monthly fee", amount: 3, frequency: "monthly" }),
  ];
  const rows = buildCheckRows({ verifiedFees: ownFees, nationalIndex: [entry("monthly_maintenance", 7)], stateIndex: [], fallbackSourceUrl: null });

  it("compares checking with checking, below its lowest checking price, itself left out", () => {
    const [list] = buildAlternatives(market, 323, rows, ownFees);
    expect(list.category).toBe("monthly_maintenance");
    expect(list.floor).toBe(7.95);
    expect(list.floorAccount).toBe("Carefree Checking");
    expect(list.publishing).toBe(2);
    expect(list.lower.map((alt) => alt.name)).toEqual(["Cheaper Bank"]);
    expect(list.lower[0].account).toBe("Basic Checking");
  });

  it("returns nothing without a market", () => {
    expect(buildAlternatives(null, 323, rows, ownFees)).toEqual([]);
  });
});

describe("parseCheckId", () => {
  it("accepts a positive integer only", () => {
    expect(parseCheckId("323")).toBe(323);
    expect(parseCheckId("0")).toBeNull();
    expect(parseCheckId("12abc")).toBeNull();
    expect(parseCheckId(undefined)).toBeNull();
  });
});
