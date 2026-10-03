// Bank Fee Index benchmark snapshot used by the Fee Insight email program.
// Source: published_fee_catalog joined to institution_sources, pulled 2026-10-03.
// One headline amount per institution per fee (lowest non-negative published amount),
// the same conservative read the Competitive Fee Position reports use.
// Refresh before each send window; re-run the query in README.md and replace these rows.

export const SNAPSHOT = {
  asOf: "October 3, 2026",
  institutions: 1232,
  feeRecords: 4011,
  states: 53, // states + DC + territories with at least one published schedule
};

// n = institutions with that fee published. p25/median/p75 in dollars.
// le5 = share of institutions charging $5 or less; zero = share charging $0.
export const FEES = {
  overdraft: {
    label: "Overdraft (paid item)",
    all: { n: 88, p25: 9, med: 29, p75: 34, zero: 1.1, le5: 23.9 },
    bank: { n: 40, p25: 18.75, med: 30, p75: 35 },
    cu: { n: 48, p25: 5, med: 25, p75: 32.25 },
  },
  nsf: {
    label: "NSF (returned item)",
    all: { n: 173, p25: 10, med: 25, p75: 30, zero: 2.3, le5: 16.2 },
    bank: { n: 89, p25: 7.11, med: 18, p75: 30 },
    cu: { n: 84, p25: 15, med: 25, p75: 30 },
  },
  monthly_maintenance: {
    label: "Monthly maintenance",
    all: { n: 133, p25: 2, med: 5, p75: 15, zero: 13.5, le5: 51.9 },
    bank: { n: 66, p25: 2.13, med: 8, p75: 15 },
    cu: { n: 67, p25: 1, med: 5, p75: 17.5 },
  },
  stop_payment: {
    label: "Stop payment",
    all: { n: 125, p25: 15, med: 25, p75: 30, zero: 0, le5: 3.2 },
    bank: { n: 45, p25: 25, med: 30, p75: 33 },
    cu: { n: 80, p25: 15, med: 20, p75: 30 },
  },
  deposited_item_return: {
    label: "Deposited item returned",
    all: { n: 82, p25: 10, med: 15, p75: 25, zero: 1.2, le5: 14.6 },
    bank: { n: 49, p25: 9.5, med: 15, p75: 20 },
    cu: { n: 33, p25: 15, med: 20, p75: 32 },
  },
  card_replacement: {
    label: "Debit card replacement",
    all: { n: 174, p25: 7.63, med: 20, p75: 43.75, zero: 3.4, le5: 24.1 },
    bank: { n: 42, p25: 7.63, med: 10, p75: 18.75 },
    cu: { n: 132, p25: 9, med: 25, p75: 45 },
  },
  od_protection_transfer: {
    label: "Overdraft protection transfer",
    all: { n: 69, p25: 3, med: 5, p75: 10, zero: 7.2, le5: 60.9 },
    bank: { n: 37, p25: 3, med: 5, p75: 10 },
    cu: { n: 32, p25: 2, med: 5, p75: 10 },
  },
  atm_non_network: {
    label: "Out-of-network ATM",
    all: { n: 69, p25: 1, med: 2, p75: 3, zero: 13, le5: 84.1 },
    bank: { n: 36, p25: 1, med: 2, p75: 2.5 },
    cu: { n: 33, p25: 1, med: 1.5, p75: 3.99 },
  },
  cashiers_check: {
    label: "Cashier's check",
    all: { n: 68, p25: 3, med: 5, p75: 7.25, zero: 0, le5: 69.1 },
    bank: { n: 29, p25: 5, med: 7, p75: 10 },
    cu: { n: 39, p25: 2, med: 5, p75: 5 },
  },
  paper_statement: {
    label: "Paper statement",
    all: { n: 86, p25: 2, med: 3, p75: 5, zero: 1.2, le5: 94.2 },
    bank: { n: 48, p25: 2, med: 3, p75: 5 },
    cu: { n: 38, p25: 2, med: 3, p75: 5 },
  },
  wire_domestic_outgoing: {
    label: "Domestic wire, outgoing",
    all: { n: 94, p25: 15, med: 20, p75: 25, zero: 1.1, le5: 4.3 },
    bank: { n: 36, p25: 15, med: 20, p75: 25 },
    cu: { n: 58, p25: 15, med: 20, p75: 25 },
  },
  wire_domestic_incoming: {
    label: "Domestic wire, incoming",
    all: { n: 53, p25: 10, med: 10, p75: 15, zero: 5.7, le5: 15.1 },
    bank: { n: 36, p25: 10, med: 15, p75: 15 },
    cu: { n: 17, p25: 5, med: 10, p75: 10 },
  },
  wire_intl_outgoing: {
    label: "International wire, outgoing",
    all: { n: 44, p25: 30, med: 40, p75: 50, zero: 0, le5: 2.3 },
    bank: { n: 21, p25: 30, med: 40, p75: 50 },
    cu: { n: 23, p25: 32.5, med: 40, p75: 50 },
  },
};

// Order used by the cheat-sheet table (most consumer-visible first).
export const CHEAT_SHEET_ORDER = [
  "overdraft",
  "nsf",
  "monthly_maintenance",
  "stop_payment",
  "deposited_item_return",
  "card_replacement",
  "od_protection_transfer",
  "atm_non_network",
  "cashiers_check",
  "paper_statement",
  "wire_domestic_outgoing",
  "wire_domestic_incoming",
  "wire_intl_outgoing",
];
