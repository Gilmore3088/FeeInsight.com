/**
 * FIXTURE DATA for State Index template tests and local layout checks.
 * Every number here is invented. It is not live data and must never be published.
 * The state is named "Fixture State" so a rendered sample cannot pass for a real report.
 */
import type { IndexEntry, StateFeeIndexes } from "@/lib/data-store";
import { buildStateReportData, type StateReportData } from "@/lib/research-report/state-report-data";

function entry(fee_category: string, median: number | null, n: number, o: Partial<IndexEntry> = {}): IndexEntry {
  return {
    fee_category,
    fee_family: null,
    median_amount: median,
    p25_amount: median == null ? null : Math.round(median * 0.8 * 100) / 100,
    p75_amount: median == null ? null : Math.round(median * 1.15 * 100) / 100,
    min_amount: null,
    max_amount: null,
    institution_count: n,
    observation_count: n,
    approved_count: n,
    bank_count: Math.ceil(n * 0.6),
    cu_count: Math.floor(n * 0.4),
    maturity_tier: n >= 10 ? "strong" : "provisional",
    last_updated: null,
    ...o,
  };
}

/** [category, state median, state institutions, national median] — all invented. */
const ROWS: Array<[string, number, number, number]> = [
  ["overdraft", 32, 140, 30],
  ["nsf", 30, 120, 29],
  ["monthly_maintenance", 8, 110, 10],
  ["atm_non_network", 3, 100, 3],
  ["wire_domestic_outgoing", 28, 90, 25],
  ["wire_intl_outgoing", 45, 70, 45.2],
  ["stop_payment", 32, 80, 30],
  ["cashiers_check", 8, 60, 10],
  ["card_replacement", 6, 40, 5],
  ["paper_statement", 3, 8, 3.5],
];

export const FIXTURE_STATE_INDEXES: StateFeeIndexes = {
  all: ROWS.map(([c, m, n]) => entry(c, m, n)),
  bank: ROWS.map(([c, m, n]) => entry(c, m * 1.1, Math.ceil(n * 0.6))),
  credit_union: ROWS.map(([c, m, n]) => entry(c, m * 0.85, Math.floor(n * 0.4))),
  verified_institutions: 150,
  verified_bank_institutions: 90,
  verified_cu_institutions: 60,
  verified_fees: 1800,
};

export const FIXTURE_NATIONAL_INDEX: IndexEntry[] = ROWS.map(([c, , , nat]) => entry(c, nat, 1500));

export const FIXTURE_STATE_REPORT: StateReportData = buildStateReportData({
  stateCode: "ZZ",
  stateName: "Fixture State",
  district: 11,
  asOf: "FIXTURE DATE",
  stats: { institution_count: 400, bank_count: 250, cu_count: 150 },
  indexes: FIXTURE_STATE_INDEXES,
  national: FIXTURE_NATIONAL_INDEX,
});

/** A state with institutions monitored but no verified fees: every section must say so. */
export const FIXTURE_EMPTY_STATE_REPORT: StateReportData = buildStateReportData({
  stateCode: "ZZ",
  stateName: "Fixture State",
  district: null,
  asOf: null,
  stats: { institution_count: 40, bank_count: 25, cu_count: 15 },
  indexes: {
    all: [],
    bank: [],
    credit_union: [],
    verified_institutions: 0,
    verified_bank_institutions: 0,
    verified_cu_institutions: 0,
    verified_fees: 0,
  },
  national: FIXTURE_NATIONAL_INDEX,
});
