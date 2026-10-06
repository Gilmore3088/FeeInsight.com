import { describe, expect, it } from "vitest";
import { buildFeeAnswer, economicDrivers, proseFeeName } from "./answer";
import { economicBackdrop, beigeBookExcerpt } from "./economy";
import { evaluateFourRoles, sentences } from "./four-roles";
import type { FeeResearch, HamiltonAnswer, MarketLayer, PeerValue } from "./types";
import type { IndicatorSeries, StateEconomicContext } from "@/lib/data-store/economic-context";

// Fixture: an invented Tennessee credit union, for the eval only. No figure here is live data.
const peer = (id: number, amount: number): PeerValue => ({
  institutionId: id,
  institutionName: `Peer ${id}`,
  amount,
  stateCode: "TN",
  sourceDocumentIds: [id],
  documentUrls: [`https://example.org/peer-${id}.pdf`],
  publishedAt: "2026-09-20",
});

const peerAmounts = [20, 22, 25, 25, 26, 28, 28, 29, 30, 30, 30, 32, 32, 33, 35, 35];

const layer = (scope: MarketLayer["scope"], label: string, n: number, median: number | null): MarketLayer => ({
  scope,
  label,
  n,
  p25: median === null ? null : median - 4,
  median,
  p75: median === null ? null : median + 3,
  position: null,
  amounts: [],
  bands: [],
  members: [],
  asOf: "2026-09-30",
  source: { label: `Bank Fee Index, ${label}`, table: "published_fee_catalog" },
});

const series = (id: string, latest: [string, number], yearAgo: [string, number] | null): IndicatorSeries => ({
  series_id: id,
  latest: { date: latest[0], value: latest[1] },
  year_ago: yearAgo ? { date: yearAgo[0], value: yearAgo[1] } : null,
  history: [],
});

const economyContext: StateEconomicContext = {
  state_unemployment: series("TNUR", ["2026-08-01", 4.1], ["2025-08-01", 3.4]),
  state_payrolls: series("TNNA", ["2026-08-01", 3300], ["2025-08-01", 3270]),
  national_unemployment: series("UNRATE", ["2026-08-01", 3.6], ["2025-08-01", 4.2]),
  fed_funds: series("FEDFUNDS", ["2026-08-01", 3.9], ["2025-08-01", 4.6]),
  cpi_all_items: series("CUUR0000SA0", ["2026-08-01", 330], ["2025-08-01", 320]),
  cpi_bank_services: series("CUUR0000SEMC01", ["2026-08-01", 210], ["2025-08-01", 200]),
  beige_book: {
    release_date: "2026-09-03",
    source_url: "https://www.federalreserve.gov/monetarypolicy/beigebook202609.htm",
    summary: "Economic activity was flat.",
    banking: { section_name: "Banking and Finance", text: "Loan demand softened. Deposit levels were steady across the district, and credit quality held up." },
    themes: [],
  },
  regulatory: [],
};

function overdraftResearch(overrides: Partial<FeeResearch> = {}): FeeResearch {
  const peers = peerAmounts.map((a, i) => peer(i + 1, a));
  return {
    institutionId: 1,
    institutionName: "Example Valley Credit Union",
    feeCategory: "overdraft",
    displayName: "Overdraft (OD)",
    current: 32,
    peerLabel: "Credit unions, $300M to $1B in assets, Tennessee",
    peers,
    band: { p25: 25.75, median: 29.5, p75: 32, n: peers.length },
    bands: [],
    layers: [
      layer("national", "National", 1840, 29),
      layer("fed_district", "Fed district 6 (Atlanta)", 210, 30),
      layer("state", "Tennessee", 64, 30),
      layer("charter_size", "Credit unions, $300M to $1B in assets", 180, 28),
    ],
    localCompetitors: [peer(101, 35), peer(102, 25), peer(103, 30)],
    localMarket: null,
    recentChanges: [],
    revenueLine: null,
    ownRows: [
      {
        id: 9,
        feeName: "Overdraft fee",
        amount: 32,
        sourceDocumentId: 77,
        documentUrl: "https://example.org/own-schedule.pdf",
        sourceUrl: "https://example.org/fees",
        publishedAt: "2026-09-12T00:00:00Z",
        verifiedByEventId: null,
      },
    ],
    nationalIncomeSeries: [],
    institutionFinancials: {
      source: "ncua",
      label: "Fee income (NCUA 5300)",
      quarters: [
        { quarterEnd: "2026-06-30", amount: 52_300 },
        { quarterEnd: "2026-03-31", amount: 51_100 },
        { quarterEnd: "2025-12-31", amount: 50_800 },
        { quarterEnd: "2025-09-30", amount: 55_200 },
      ],
      latestTtm: 209_400,
      priorTtm: 201_000,
      yoyPct: 4.18,
      quarterEnd: "2026-06-30",
      sourceRef: { label: "NCUA 5300 call report", table: "institution_financial_records" },
      peerMedian: null,
    },
    regulation: [],
    economy: economicBackdrop(economyContext, "Tennessee", 6, "Atlanta"),
    provenance: {
      engineVersion: "1.4.0",
      generatedAt: "2026-10-06T08:00:00.000Z",
      peerGroup: { label: "Credit unions, $300M to $1B in assets, Tennessee", n: peers.length },
      dataAsOf: { fees: "2026-09-30", financials: "2026-06-30", changes: null },
      sources: [],
      assumptions: [],
      clientFacts: [],
    },
    ...overrides,
  };
}

function failuresOf(answer: HamiltonAnswer, role: string): string[] {
  return evaluateFourRoles(answer).roles.find((r) => r.role === role)?.failures ?? [];
}

describe("four-roles eval: one overdraft answer", () => {
  const answer = buildFeeAnswer(overdraftResearch());

  it("passes all four roles", () => {
    const result = evaluateFourRoles(answer);
    expect(result.roles.flatMap((r) => r.failures)).toEqual([]);
    expect(result.pass).toBe(true);
  });

  it("writer: leads with the number in one short sentence", () => {
    expect(answer.headline).toBe("Your $32 overdraft fee sits at the 75th percentile of 16 peers, whose median is $29.50.");
  });

  it("consultant: every claim carries a number, a dated source and, for markets, the peer count", () => {
    expect(answer.claims.map((c) => c.text)).toEqual([
      "Your published overdraft fee is $32.",
      "Across 16 peers (Credit unions, $300M to $1B in assets, Tennessee), the median is $29.50 and the middle half runs $25.75 to $32.",
      "The Tennessee median is $30 across 64 institutions.",
      "The national median is $29 across 1,840 institutions.",
      "Your fee income was $209 thousand over the four quarters to June 30, 2026, up 4.2% on the year before.",
    ]);
    expect(answer.claims[1].sampleSize).toBe(16);
    expect(answer.claims[0].source.url).toBe("https://example.org/own-schedule.pdf");
    expect(answer.evidenceLevel).toBe("market");
  });

  it("economist: explains with prices, rates, jobs and the Beige Book, and asks for the missing figure", () => {
    expect(answer.drivers.map((d) => d.text)).toEqual([
      "Prices for bank services rose 5.0% in the year to August 2026, faster than the 3.1% change in all consumer prices.",
      "The federal funds rate was 3.9% in August 2026, down from 4.6% a year earlier.",
      "Lower rates shrink what banks earn on deposits, so fee income carries more of the load.",
      "Tennessee unemployment was 4.1% in August 2026, against 3.6% nationally.",
      "A weaker job market than the nation's usually means more accounts running short.",
      'Per the Atlanta Fed\'s Beige Book of September 3, 2026: "Loan demand softened. Deposit levels were steady across the district, and credit quality held up."',
    ]);
    expect(answer.question).toMatchObject({ inputKind: "number", fieldKey: "fee.overdraft.annual_items" });
  });

  it("data engineer: one fee-position exhibit with the band and state and national markers", () => {
    expect(answer.exhibit).toMatchObject({
      kind: "fee_position",
      title: "Your $32 overdraft fee against 16 peers",
      own: 32,
      band: { p25: 25.75, median: 29.5, p75: 32, n: 16 },
    });
    const markers = answer.exhibit?.kind === "fee_position" ? answer.exhibit.markers.map((m) => m.label) : [];
    expect(markers).toEqual(["Peer median", "National median", "Fed district 6 (Atlanta) median", "Tennessee median", "Credit unions, $300M to $1B in assets median"]);
  });
});

describe("four-roles eval catches each kind of failure", () => {
  const good = buildFeeAnswer(overdraftResearch());

  it("consultant: a recommendation nobody asked for", () => {
    const bad = { ...good, drivers: [...good.drivers, { ...good.drivers[0], text: "You should raise your fee to $35." }] };
    expect(failuresOf(bad, "consultant").join(" ")).toContain("Recommendation not asked for");
  });

  it("consultant: a market figure without its peer count", () => {
    const bad = { ...good, claims: good.claims.map((c) => ({ ...c, sampleSize: undefined })) };
    expect(failuresOf(bad, "consultant").join(" ")).toContain("without its peer count");
  });

  it("writer: a long sentence, a pipeline term and unformatted units", () => {
    const bad = {
      ...good,
      claims: [
        ...good.claims,
        {
          text: "Darwin verified that income was $2,640,000 and grew 4.18% which is a figure that we have taken from the filings of every credit union in the state over the last year.",
          source: good.claims[0].source,
        },
      ],
    };
    const failures = failuresOf(bad, "writer").join(" | ");
    expect(failures).toContain("-word sentence");
    expect(failures).toContain("Pipeline term");
    expect(failures).toContain("not written as millions");
    expect(failures).toContain("more than one decimal");
  });

  it("data engineer: no exhibit", () => {
    expect(failuresOf({ ...good, exhibit: null }, "data_engineer")).toEqual(["No exhibit."]);
  });

  it("economist: market-only evidence and no question", () => {
    expect(failuresOf({ ...good, question: null }, "economist").join(" ")).toContain("asks no clarifying question");
    expect(failuresOf({ ...good, drivers: [] }, "economist").join(" ")).toContain("No driver");
  });
});

describe("answer edge cases", () => {
  it("asks for the current fee when the schedule has none", () => {
    const answer = buildFeeAnswer(overdraftResearch({ current: null, ownRows: [] }));
    expect(answer.headline).toBe("Your schedule shows no overdraft fee; across 16 peers the median is $29.50.");
    expect(answer.question).toMatchObject({ fieldKey: "fee.overdraft.current_amount" });
    expect(answer.exhibit?.title).toBe("The overdraft fee across 16 peers");
  });

  it("states income in words and labels the evidence when the filing has a line for the fee", () => {
    const answer = buildFeeAnswer(
      overdraftResearch({
        revenueLine: {
          annualIncome: 1_250_000,
          label: "Overdraft fee income (NCUA 5300, IS0048)",
          quarterEnd: "2026-06-30",
          source: { label: "NCUA 5300, account IS0048", table: "institution_financial_records" },
        },
      }),
    );
    expect(answer.claims.map((c) => c.text)).toContain("Your filing reports $1.3 million in overdraft income over the four quarters to June 30, 2026.");
    expect(answer.evidenceLevel).toBe("working_estimate");
    expect(answer.question).toBeNull();
    expect(evaluateFourRoles(answer).pass).toBe(true);
  });

  it("draws local competitors when asked for that view", () => {
    const answer = buildFeeAnswer(overdraftResearch(), { focus: "competitors" });
    expect(answer.exhibit).toMatchObject({ kind: "competitor_range", items: [{ amount: 25 }, { amount: 30 }, { amount: 35 }] });
  });

  it("leaves the job-market line out for fees that do not depend on short balances", () => {
    const drivers = economicDrivers(economicBackdrop(economyContext, "Tennessee", 6, "Atlanta"), "wire_domestic_outgoing");
    expect(drivers.map((d) => d.text).join(" ")).not.toContain("accounts running short");
  });

  it("names fees in plain words", () => {
    expect(proseFeeName("overdraft")).toBe("overdraft");
    expect(proseFeeName("nsf")).toBe("NSF / returned item");
  });

  it("cuts a Beige Book excerpt at a sentence end and keeps quoted text in one sentence", () => {
    expect(beigeBookExcerpt("One. Two is longer. Three.", 12)).toBe("One.");
    expect(sentences('Per the Beige Book: "Loans fell. Deposits rose." Prices rose 2.1%.')).toEqual([
      'Per the Beige Book: "Loans fell. Deposits rose."',
      "Prices rose 2.1%.",
    ]);
  });
});
