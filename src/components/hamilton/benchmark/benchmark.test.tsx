import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import type { InstitutionPositioning } from "@/lib/hamilton/institution-position";
import type { AlertEntry, PositioningEntry, SignalEntry } from "@/lib/hamilton/home-data";
import { HamiltonBriefing, stateComparison } from "./HamiltonBriefing";
import type { ExpertStateContext } from "@/lib/hamilton/expert-context";
import type { IndicatorSeries, StateEconomicContext } from "@/lib/data-store/economic-context";
import { buildEconomyTiles, EconomyTiles, isStale } from "./EconomyTiles";
import { NationalSnapshot } from "./NationalSnapshot";
import { PositionOverview, headlineFor, positionTone } from "./PositionOverview";
import { mergeChanges, RecentChanges } from "./RecentChanges";
import { rangeDomain } from "./RangeBar";

const positioning: InstitutionPositioning = {
  institutionId: 2945,
  institutionName: "First Bank",
  benchmarkLabel: "community banks",
  benchmarkSource: "selected-institution-default",
  stateCode: "TX",
  fedDistrict: 11,
  ownFeeCount: 12,
  priority: "high",
  topGap: null,
  entries: [
    { feeCategory: "overdraft", displayName: "Overdraft", yourAmount: 35, benchmarkMedian: 28, benchmarkP25: 25, benchmarkP75: 32, benchmarkCount: 40, maturityTier: "strong", gapAmount: 7, gapPct: 25 },
    { feeCategory: "wire_domestic_outgoing", displayName: "Outgoing domestic wire", yourAmount: 20, benchmarkMedian: 25, benchmarkP25: 20, benchmarkP75: 30, benchmarkCount: 30, maturityTier: "strong", gapAmount: -5, gapPct: -20 },
    { feeCategory: "stop_payment", displayName: "Stop payment", yourAmount: 30, benchmarkMedian: 30, benchmarkP25: 25, benchmarkP75: 32, benchmarkCount: 33, maturityTier: "strong", gapAmount: 0, gapPct: 0 },
  ],
};
positioning.topGap = positioning.entries[0];

describe("PositionOverview", () => {
  it("leads with the largest gap in plain words", () => {
    expect(headlineFor(positioning)).toBe("Overdraft is 25% above the peer median: $35.00 against $28.00.");
  });

  it("counts fees above, in line with and below peers", () => {
    expect(positioning.entries.map(positionTone)).toEqual(["above", "below", "inline"]);
    const html = renderToStaticMarkup(<PositionOverview positioning={positioning} />);
    expect(html).toContain("Fees compared");
    expect(html).toContain('href="/pro/simulate?category=overdraft&amp;instId=2945"');
    expect(html).toContain("12 fees are published for this institution");
  });

  it("says plainly when there is nothing to compare", () => {
    const html = renderToStaticMarkup(
      <PositionOverview positioning={{ ...positioning, entries: [], topGap: null, ownFeeCount: 0 }} />,
    );
    expect(html).toContain("no published fees for First Bank");
  });
});

describe("RangeBar domain", () => {
  it("pads around the values and never goes below zero", () => {
    const [lo, hi] = rangeDomain([25, 28, 32, 35]);
    expect(lo).toBeLessThan(25);
    expect(lo).toBeGreaterThanOrEqual(0);
    expect(hi).toBeGreaterThan(35);
    expect(rangeDomain([0, 0])[0]).toBe(0);
  });
});

describe("NationalSnapshot", () => {
  const entry: PositioningEntry = {
    feeCategory: "monthly_maintenance", displayName: "Monthly Maintenance",
    medianAmount: 12, p25Amount: 8, p75Amount: 15, institutionCount: 42, maturityTier: "strong",
  };

  it("shows each spotlight fee with its range and keeps institution context on links", () => {
    const html = renderToStaticMarkup(<NationalSnapshot entries={[entry]} totalInstitutions={3000} selectedInstitutionId="2945" />);
    expect(html).toContain("Most charge $8.00 to $15.00");
    expect(html).toContain("3,000 institutions");
    expect(html).toContain('href="/pro/simulate?category=monthly_maintenance&amp;instId=2945"');
  });

  it("says when the index is unavailable", () => {
    expect(renderToStaticMarkup(<NationalSnapshot entries={[]} totalInstitutions={0} />)).toContain("unavailable");
  });
});

describe("RecentChanges", () => {
  const signal = (id: string, title: string): SignalEntry => ({
    id, signalType: "fee_change", severity: "low", title, body: "body", createdAt: "2026-10-01T00:00:00Z",
  });
  const alert: AlertEntry = {
    id: "a1", signalId: "s1", signalType: "fee_change", severity: "high", title: "Overdraft raised",
    body: "body", status: "active", createdAt: "2026-10-02T00:00:00Z",
  };

  it("puts alerts first and never repeats a signal an alert already covers", () => {
    const items = mergeChanges([alert], [signal("s1", "Overdraft raised"), signal("s2", "New fees published")]);
    expect(items.map((i) => i.title)).toEqual(["Overdraft raised", "New fees published"]);
    expect(items[0].isAlert).toBe(true);
  });

  it("shows at most three changes in the callout", () => {
    const signals = ["a", "b", "c", "d"].map((id) => signal(id, `Change ${id}`));
    const html = renderToStaticMarkup(<RecentChanges alerts={[]} signals={signals} selectedInstitutionId="2945" />);
    expect(html).toContain("Change c");
    expect(html).not.toContain("Change d");
  });

  it("links to Monitor with institution context", () => {
    const html = renderToStaticMarkup(<RecentChanges alerts={[]} signals={[]} selectedInstitutionId="2945" />);
    expect(html).toContain('href="/pro/monitor?instId=2945"');
  });
});

const texas: ExpertStateContext = {
  stateCode: "TX",
  stateName: "Texas",
  expertName: "Example Banker",
  expertBio: "Led an example bank.",
  regulator: "Texas Department of Banking",
  regulatorUrl: "https://www.dob.texas.gov",
  creditUnionRegulator: null,
  medians: {
    overdraft: { median: 30, p25: 25, p75: 33, count: 40 },
    stop_payment: { median: 30, p25: 25, p75: 32, count: 30 },
  },
};

const series = (id: string, latest: number, yearAgo: number, date = "2026-08-01"): IndicatorSeries => {
  const y = new Date(`${date}T00:00:00Z`);
  y.setUTCFullYear(y.getUTCFullYear() - 1);
  const yDate = y.toISOString().slice(0, 10);
  return { series_id: id, latest: { date, value: latest }, year_ago: { date: yDate, value: yearAgo }, history: [{ date: yDate, value: yearAgo }, { date, value: latest }] };
};

const economy: StateEconomicContext = {
  state_unemployment: series("TXUR", 4.1, 3.9),
  state_payrolls: series("TXNA", 14280, 14000),
  national_unemployment: series("UNRATE", 4.3, 4.1),
  fed_funds: series("FEDFUNDS", 4.33, 5.33, "2026-09-01"),
  cpi_all_items: series("CUUR0000SA0", 103, 100, "2025-12-01"),
  cpi_bank_services: series("CUUR0000SEMC01", 104, 100, "2025-12-01"),
  beige_book: {
    release_date: "August 2026",
    source_url: "https://www.federalreserve.gov/beige",
    summary: "Economic activity grew slightly.",
    banking: null,
    themes: [{ category: "lending_conditions", sentiment: "negative", summary: "Loan demand softened." }],
  },
  regulatory: [{ title: "Overdraft rule", link: "https://example.gov/rule", source: "cfpb", topic: "overdraft", published_at: "2026-04-07T00:00:00.000Z" }],
};

const briefingProps = {
  thesis: null,
  blockingPolicies: ["agent:hamilton"],
  analyzeHref: "/pro/analyze",
  positioning,
  state: texas,
  economy,
  districtName: "Dallas",
};

describe("EconomyTiles", () => {
  it("shows state jobs, bank-service prices against all prices, and the fed funds rate", () => {
    const tiles = buildEconomyTiles("Texas", economy);
    expect(tiles.map((t) => t.value)).toEqual(["4.1%", "+2.0%", "+4.0%", "4.33%"]);
    expect(tiles[2].change).toBe("vs +3.0% for all consumer prices");
    expect(tiles[0].change).toBe("+0.2 pts vs a year ago");
  });

  it("charts the state unemployment rate against the U.S. rate", () => {
    const [ur] = buildEconomyTiles("Texas", economy);
    expect(ur.lines.map((l) => l.label)).toEqual(["Texas", "United States"]);
  });

  it("labels old data as the latest published", () => {
    expect(isStale("2025-12-01", new Date(Date.UTC(2026, 9, 5)))).toBe(true);
    expect(isStale("2026-08-01", new Date(Date.UTC(2026, 9, 5)))).toBe(false);
  });

  it("never invents figures that aren't stored yet", () => {
    const empty = { ...economy, state_unemployment: null, state_payrolls: null, fed_funds: null, cpi_bank_services: null };
    expect(buildEconomyTiles("Texas", empty)).toEqual([]);
    expect(renderToStaticMarkup(<EconomyTiles stateName="Texas" economy={empty} />)).toContain("after the next data run");
  });
});

describe("HamiltonBriefing", () => {
  it("compares the institution with its state median", () => {
    const result = stateComparison(positioning, texas);
    expect(result?.line).toBe("1 of your 2 fees with a Texas median sits 10% or more above it.");
    expect(result?.biggest).toEqual({ name: "Overdraft", yours: 35, median: 30 });
  });

  it("shows state, district and regulatory context with sources and dates", () => {
    const html = renderToStaticMarkup(<HamiltonBriefing {...briefingProps} isAdmin={false} />);
    expect(html).toContain("Texas Department of Banking");
    expect(html).toContain("Dallas Fed district");
    expect(html).toContain("Beige Book, August 2026");
    expect(html).toContain("Lending: negative");
    expect(html).toContain("Overdraft &amp; NSF · Apr 7, 2026");
    expect(html).toContain("Texas unemployment");
  });

  it("never invents analysis when it is off, and tells only admins why", () => {
    const admin = renderToStaticMarkup(<HamiltonBriefing {...briefingProps} isAdmin />);
    expect(admin).toContain("analysis is paused");
    expect(admin).toContain("agent:hamilton");
    const customer = renderToStaticMarkup(<HamiltonBriefing {...briefingProps} isAdmin={false} />);
    expect(customer).not.toContain("agent:hamilton");
  });

  it("leads with the institution's largest gap from published data", () => {
    const html = renderToStaticMarkup(<HamiltonBriefing {...briefingProps} isAdmin={false} />);
    expect(html).toContain("Overdraft is 25% above the peer median");
    const chart = renderToStaticMarkup(<PositionOverview positioning={positioning} showHeadline={false} />);
    expect(chart).not.toContain("Overdraft is 25% above");
  });

  it("draws the state median on the position chart", () => {
    const html = renderToStaticMarkup(<PositionOverview positioning={positioning} state={texas} />);
    expect(html).toContain("TX median $30.00");
    expect(html).toContain("Texas median");
  });
});
