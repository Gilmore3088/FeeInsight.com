/**
 * Test fixture: an invented Tennessee credit union's overdraft research. For tests only;
 * no figure here is live data.
 */

import { economicBackdrop } from "./economy";
import type { FeeResearch, MarketLayer, PeerValue } from "./types";
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

export const economyContext: StateEconomicContext = {
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

export function overdraftResearch(overrides: Partial<FeeResearch> = {}): FeeResearch {
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
