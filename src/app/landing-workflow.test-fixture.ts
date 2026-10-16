/**
 * Test data only: a sample report in the shape `loadSampleReport` returns, for the homepage
 * workflow tests. Names are the demo institution and real competitors in its market; every
 * amount here is made up for the tests and is never shown on a page.
 */
import { quantile, type CustomReportAnalysis, type LinePosition, type NamedCompetitor, type ReportLine } from "@/lib/custom-report/analysis";
import type { MarketReport } from "@/lib/custom-report/report-data";
import type { MarketFeeLine, MarketInstitution } from "@/lib/data-store/custom-report-market";

const SUBJECT_ID = 323;
const COMPETITORS: [number, string, string, number | null][] = [
  [11, "Wells Fargo Bank, National Association", "bank", 2_400_000_000],
  [12, "Truist Bank", "bank", 1_900_000_000],
  [13, "Ameris Bank", "bank", 640_000_000],
  [14, "Regions Bank", "bank", 520_000_000],
  [15, "Hancock Whitney Bank", "bank", 310_000_000],
  [16, "Prosperity Bank", "bank", 150_000_000],
  [17, "TMH Federal Credit Union", "credit_union", null],
  [18, "FSU Credit Union", "credit_union", null],
];

/** key, label, schedule name, own amount, competitor amounts (in COMPETITORS order). */
const LINES: [string, string, string, number, number[]][] = [
  ["overdraft", "Overdraft (per item)", "Overdraft Fee (per item)", 37, [35, 34, 36, 36, 35, 33, 30, 25]],
  ["nsf", "NSF / returned item", "Returned Item Fee", 35, [35, 34, 36, 36, 35, 33, 30, 25]],
  ["stop_payment", "Stop payment", "Stop Payment", 30, [31, 35, 30, 32, 30, 25, 25, 20]],
  ["wire_domestic_outgoing", "Outgoing domestic wire", "Outgoing Domestic Wire", 25, [30, 30, 25, 25, 25, 20, 20, 15]],
  ["cashiers_check", "Cashier's check", "Cashier's Check", 10, [10, 10, 8, 10, 10, 7, 5, 5]],
  ["monthly_maintenance", "Monthly maintenance", "Monthly Maintenance Fee", 8, [10, 12, 8, 8, 10, 6, 5, 0]],
];

const READ_ON = "2026-10-08";
const url = (id: number) => `https://example.com/${id}/fee-schedule.pdf`;
const money = (v: number) => `$${v.toFixed(2)}`;

function feeLine(id: number, key: string, name: string, amount: number): MarketFeeLine {
  return {
    institution_id: id,
    line: key,
    amount,
    fee_name: name,
    source_url: url(id),
    updated_at: `${READ_ON}T12:00:00Z`,
    schedule_read_on: READ_ON,
    source_line: `${name}…… ${money(amount)}`,
  };
}

function position(own: number, p25: number, p75: number): LinePosition {
  if (own === 0) return "free";
  return own > p75 ? "above_market" : own < p25 ? "below_market" : "in_market";
}

export function sampleWorkflowReport(): MarketReport {
  const competitors: MarketInstitution[] = COMPETITORS.map(([id, name, charter, deposits]) => ({
    institution_id: id,
    institution_name: name,
    city: "TALLAHASSEE",
    state_code: "FL",
    charter_type: charter,
    market_deposits: deposits,
  }));
  const lines: ReportLine[] = LINES.map(([key, label, name, own, amounts]) => {
    const peerFigures = COMPETITORS.map(([id], i) => feeLine(id, key, name, amounts[i])).sort((a, b) => a.amount - b.amount);
    const sorted = peerFigures.map((f) => f.amount);
    const peers = {
      n: sorted.length,
      p25: quantile(sorted, 0.25),
      median: quantile(sorted, 0.5),
      p75: quantile(sorted, 0.75),
      min: sorted[0],
      max: sorted[sorted.length - 1],
    };
    const ownLine = feeLine(SUBJECT_ID, key, name, own);
    return {
      key,
      label,
      own: { amount: own, fee_name: name, source_url: ownLine.source_url, updated_at: ownLine.updated_at, schedule_read_on: READ_ON, source_line: ownLine.source_line },
      peers,
      comparable: true,
      position: position(own, peers.p25, peers.p75),
      percentile: Math.round((sorted.filter((a) => a <= own).length / sorted.length) * 100),
      chargingLess: sorted.filter((a) => a < own).length,
      peerFigures,
    };
  });
  const named: NamedCompetitor[] = competitors.map((c, i) => ({
    ...c,
    fees: Object.fromEntries(LINES.map(([key, , , , amounts]) => [key, amounts[i]])),
    sources: Object.fromEntries(LINES.map(([key, , name, , amounts]) => [key, feeLine(c.institution_id, key, name, amounts[i])])),
  }));
  const analysis: CustomReportAnalysis = {
    readiness: { ready: true, comparableLines: lines.length, ownLines: lines.length, competitorsWithData: 21, competitorsInMarket: 24, reason: null },
    lines,
    named,
    findings: ["Overdraft (per item) is above the local middle half: $37.00 against a local median of $34.50."],
  };
  return {
    data: {
      subject: { institution_id: SUBJECT_ID, institution_name: "Capital City Bank", city: "TALLAHASSEE", state_code: "FL", charter_type: "bank", market_deposits: 2_100_000_000, asset_size: 4_300_000_000 },
      market: { basis: "branch_counties", county_fips: ["12073", "12039", "12129"], places: ["TALLAHASSEE, FL"], sod_year: 2026 },
      competitors,
      lines: [...lines.flatMap((l) => l.peerFigures), ...LINES.map(([key, , name, own]) => feeLine(SUBJECT_ID, key, name, own))],
      dropped: {},
    },
    analysis,
    savedAt: null,
    sinceBought: null,
  } as MarketReport;
}
