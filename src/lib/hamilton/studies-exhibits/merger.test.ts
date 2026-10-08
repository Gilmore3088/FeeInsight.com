import { describe, expect, it } from "vitest";
import {
  buildMergerScreen,
  countyName,
  feeChart,
  feeRows,
  footprintMap,
  hhiChart,
  marketFinding,
  moneyK,
  niceTicks,
  profileChart,
  quarterLines,
  responsive,
  shareBars,
  shortBankName,
  trailingFour,
} from "./merger";
import { quarterlyFromYtd, type CountyMarket, type MergerScreenData, type QuarterRecord } from "@/lib/data-store/merger-screen";

// Lancaster County, PA (42071), FDIC Summary of Deposits June 30, 2026, thousands of dollars.
const LANCASTER: CountyMarket = {
  fips: "42071",
  holders: (
    [
      [71, "Fulton Bank, National Association", 5544923],
      [9, "Truist Bank", 3012146],
      [8, "PNC Bank, National Association", 1711452],
      [548, "The Ephrata National Bank", 1686987],
      [671, "Bank of Bird-in-Hand", 1455375],
      [4, "Wells Fargo Bank, National Association", 1034525],
      [21, "Manufacturers and Traders Trust Company", 670609],
      [120, "Northwest Bank", 567978],
      [185, "Univest  Bank and Trust Co.", 515250],
      [51, "First National Bank of Pennsylvania", 499187],
      [161, "S&T Bank", 404903],
      [270, "Orrstown Bank", 402954],
      [18, "Citizens Bank, National Association", 346075],
      [31, "Santander Bank, N.A.", 226604],
      [244, "Mid Penn Bank", 201977],
      [510, "Wayne Bank", 133889],
      [1063, "Jonestown Bank and Trust Company, of Jonestown, Pennsylvania", 117432],
      [200, "Burke & Herbert Bank & Trust Company", 105141],
      [416, "First Citizens Community Bank", 61332],
      [393, "ACNB Bank", 50697],
      [1, "JPMorgan Chase Bank, National Association", 38406],
      [142, "First Commonwealth Bank", 37957],
      [285, "Peoples Security Bank and Trust Company", 35228],
      [476, "Citizens & Northern Bank", 13195],
      [171, "Woodforest National Bank", 2185],
    ] as const
  ).map(([id, name, dep]) => ({ institutionId: id, key: `i${id}`, name, depositsK: dep, branches: 1 })),
};

const NAMES: [string, string] = ["Orrstown Bank", "The Ephrata National Bank"];

function q(date: string, o: Partial<QuarterRecord>): QuarterRecord {
  return { date, source: "fdic", assets: null, deposits: null, loans: null, serviceCharges: null, netIncome: null, roa: null, efficiency: null, nim: null, tier1: null, uninsured: null, ...o };
}

// Call report quarters (thousands) for the two banks, from FDIC rows.
const ORRSTOWN: QuarterRecord[] = [
  q("2024-06-30", { assets: 3198146, netIncome: 9486 }),
  q("2024-09-30", { assets: 5470313, netIncome: -4403 }),
  q("2025-09-30", { assets: 5470010, netIncome: 23777, serviceCharges: 2069 }),
  q("2025-12-31", { assets: 5541962, netIncome: 22636, serviceCharges: 2174 }),
  q("2026-03-31", { assets: 5576514, netIncome: 23279, serviceCharges: 2077 }),
  q("2026-06-30", { assets: 5611609, deposits: 4624164, loans: 4070038, netIncome: 23811, serviceCharges: 2124, roa: 1.7, efficiency: 53.51, nim: 4.03, tier1: 12.11, uninsured: 1347652 }),
];
const EPHRATA: QuarterRecord[] = [
  q("2024-06-30", { assets: 2021574, netIncome: 4757 }),
  q("2024-09-30", { assets: 2090548, netIncome: 3606 }),
  q("2025-09-30", { assets: 2221119, netIncome: 6682, serviceCharges: 1349 }),
  q("2025-12-31", { assets: 2256965, netIncome: 6258, serviceCharges: 1099 }),
  q("2026-03-31", { assets: 2423035, netIncome: 5346, serviceCharges: 674 }),
  q("2026-06-30", { assets: 2389971, deposits: 2023520, loans: 1655054, netIncome: 6599, serviceCharges: 712, roa: 1.1, efficiency: 69.64, nim: 3.85, tier1: 13.24, uninsured: 243946 }),
];

function screenData(over: Partial<MergerScreenData> = {}): MergerScreenData {
  return {
    banks: [
      { id: 270, name: NAMES[0], city: "Shippensburg", stateCode: "PA", charterType: "bank" },
      { id: 548, name: NAMES[1], city: "Ephrata", stateCode: "PA", charterType: "bank" },
    ],
    sodYear: 2026,
    branches: [
      { bank: 0, name: "Camp Hill Branch", city: "Camp Hill", fips: "42041", lat: 40.2377, lon: -76.9523, depositsK: 371096 },
      { bank: 0, name: "Manheim Pike Branch", city: "Lancaster", fips: "42071", lat: 40.0822, lon: -76.3395, depositsK: 140766 },
      { bank: 0, name: "Cockeysville Branch", city: "Cockeysville", fips: "24005", lat: 39.4711, lon: -76.6384, depositsK: 219775 },
      { bank: 1, name: "The Ephrata National Bank", city: "Ephrata", fips: "42071", lat: 40.178, lon: -76.177, depositsK: 409334 },
      { bank: 1, name: "Cecil Bank Branch", city: "Elkton", fips: "24015", lat: 39.609, lon: -75.8306, depositsK: 86325 },
    ],
    markets: [LANCASTER],
    financials: [ORRSTOWN, EPHRATA],
    fees: [
      { nsf: [0, 0], overdraft: [38], safe_deposit_box: [25, 65, 160], early_closure: [25], wire_domestic_outgoing: [30] },
      { nsf: [37], overdraft: [12, 37], safe_deposit_box: [25, 300], early_closure: [25], late_payment: [10] },
    ],
    ...over,
  };
}

describe("formatting", () => {
  it("writes thousands as dollars with a true minus sign", () => {
    expect(moneyK(5611609)).toBe("$5.6B");
    expect(moneyK(23811)).toBe("$23.8M");
    expect(moneyK(-4403)).toBe("−$4.4M");
    expect(moneyK(-10000)).toBe("−$10M");
    expect(moneyK(0)).toBe("$0");
  });

  it("extends the axis below zero for a loss", () => {
    expect(niceTicks(-4403, 23811)).toEqual([-10000, 0, 10000, 20000, 30000]);
    expect(niceTicks(0, 5611609)).toEqual([0, 2000000, 4000000, 6000000]);
  });

  it("shortens bank names for titles", () => {
    expect(shortBankName("Orrstown Bank")).toBe("Orrstown");
    expect(shortBankName("The Ephrata National Bank")).toBe("Ephrata");
    expect(shortBankName("Fulton Bank, National Association")).toBe("Fulton");
    expect(shortBankName("Mid Penn Bank")).toBe("Mid Penn");
    expect(shortBankName("First National Bank of Pennsylvania")).toBe("First National Bank of Pennsylvania");
    expect(shortBankName("Bank of Bird-in-Hand")).toBe("Bank of Bird-in-Hand");
  });

  it("names counties from the atlas", () => {
    expect(countyName("42071")).toBe("Lancaster County");
    expect(countyName("24510")).toBe("Baltimore city");
    expect(countyName("22071")).toBe("Orleans Parish");
  });
});

describe("market concentration", () => {
  it("matches the HHI before and after combining, and ranks the combined bank", () => {
    const f = marketFinding(LANCASTER, [270, 548], NAMES, 2026)!;
    expect(f.pre).toBe(1422);
    expect(f.post).toBe(1460);
    expect(f.combinedRank).toBe(3);
    expect(f.ahead).toEqual(["Fulton", "Truist"]);
    expect(f.combinedShare).toBeCloseTo(11.1, 1);
    expect(f.rows.find((r) => r.combined)?.name).toBe("Orrstown + Ephrata");
  });
});

describe("fees", () => {
  it("compares only fees both publish, overdraft at its highest tier, largest gap first", () => {
    const rows = feeRows(screenData().fees);
    expect(rows.map((r) => r.category)).toEqual(["safe_deposit_box", "nsf", "overdraft", "early_closure"]);
    expect(rows.find((r) => r.category === "overdraft")!.values).toEqual([38, 37]);
    expect(rows.find((r) => r.category === "safe_deposit_box")!.values).toEqual([65, 162.5]);
    expect(rows.find((r) => r.category === "safe_deposit_box")!.several).toEqual([true, true]);
  });
});

describe("trailing four quarters", () => {
  it("sums four consecutive quarters and refuses a gap", () => {
    expect(trailingFour(ORRSTOWN, "2026-06-30", (r) => r.netIncome)).toBe(93503);
    expect(trailingFour(ORRSTOWN, "2025-12-31", (r) => r.netIncome)).toBeNull();
  });

  it("splits NCUA year-to-date income into quarters", () => {
    const ytd = [
      q("2025-03-31", { netIncome: 100, serviceCharges: 10 }),
      q("2025-06-30", { netIncome: 250, serviceCharges: 25 }),
      q("2025-12-31", { netIncome: 500, serviceCharges: 50 }),
    ].map((r) => ({ ...r, source: "ncua" }));
    const out = quarterlyFromYtd(ytd);
    expect(out.map((r) => r.netIncome)).toEqual([100, 150, null]);
    expect(out.map((r) => r.serviceCharges)).toEqual([10, 15, null]);
  });
});

describe("charts", () => {
  it("draws every chart at both widths", () => {
    const html = responsive((size) => footprintMap({ names: NAMES, branches: screenData().branches, overlap: ["42071"] }, size))!;
    expect(html).toContain('class="sc-wide"');
    expect(html).toContain('class="sc-narrow"');
    expect(html).toContain('viewBox="0 0 960 ');
    expect(html).toContain('viewBox="0 0 400 ');
    expect(html).toContain("Lancaster County");
  });

  it("labels a loss quarter below zero", () => {
    const svg = quarterLines(
      [ORRSTOWN.map((r) => ({ date: r.date, value: r.netIncome! })), EPHRATA.map((r) => ({ date: r.date, value: r.netIncome! }))],
      NAMES,
      { format: moneyK, label: "Net income", note: { date: "2024-09-30", value: -4403, lines: ["Q3 2024: Orrstown −$4.4M"], below: true } },
    )!;
    expect(svg).toContain(">−$10M<");
    expect(svg).toContain("Q3 2024: Orrstown −$4.4M");
  });

  it("returns nothing when there is nothing to draw", () => {
    expect(profileChart([], NAMES)).toBeNull();
    expect(feeChart([], NAMES)).toBeNull();
    expect(shareBars([])).toBeNull();
    expect(hhiChart([])).toBeNull();
    expect(footprintMap({ names: NAMES, branches: [], overlap: [] })).toBeNull();
  });

  it("escapes names in chart text", () => {
    const svg = shareBars([{ name: "A <b> & Co", share: 10, combined: false }])!;
    expect(svg).toContain("A &lt;b&gt; &amp; Co");
  });
});

describe("buildMergerScreen", () => {
  it("states each finding from the data", () => {
    const s = buildMergerScreen(screenData());
    const titles = Object.fromEntries(s.exhibits.map((e) => [e.key, e.title]));
    expect(titles.footprint).toBe("The branch networks touch in one county");
    expect(titles.profile).toBe("Orrstown earns more on its assets at a lower cost; Ephrata holds more capital");
    expect(titles.earnings).toBe("Both banks have grown quarterly earnings since 2024");
    expect(titles.competition).toBe("In Lancaster County the combined bank would rank third, behind Fulton and Truist");
    expect(titles.fees).toBe("The two fee schedules differ most on safe deposit box, NSF / returned item and overdraft (OD)");
    expect(s.heroes.map((h) => `${h.figure}${h.unit ?? ""}`)).toEqual(["$8.0B", "$6.65B", "$118M", "1,460"]);
    expect(s.deck).toContain("Their footprints meet only in Lancaster County, where the combined bank would rank third, behind Fulton and Truist.");
  });

  it("says so in plain words when data is missing", () => {
    const s = buildMergerScreen(
      screenData({ fees: [{ nsf: [30] }, {}], markets: [], branches: screenData().branches.filter((b) => b.fips !== "42071"), financials: [ORRSTOWN, []] }),
    );
    const byKey = Object.fromEntries(s.exhibits.map((e) => [e.key, e]));
    expect(byKey.footprint.title).toBe("The branch networks do not share a county");
    expect(byKey.competition.notice).toBe("The two banks have no branches in the same county, so no local market changes hands.");
    expect(byKey.fees.title).toBe("Ephrata has no published fees in the index yet");
    expect(byKey.fees.panels).toHaveLength(0);
    expect(byKey.profile.notice).toContain("not on file");
    expect(s.heroes.some((h) => h.label.startsWith("Combined net income"))).toBe(false);
  });

  it("uses no em-dashes or price-direction words in its text", () => {
    const s = buildMergerScreen(screenData());
    const text = JSON.stringify(s);
    expect(text).not.toContain("—");
    expect(text).not.toMatch(/cheap|pric(ier|iest)/i);
  });
});
