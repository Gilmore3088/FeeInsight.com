// National Bank Fee Index figures for the monthly Fee Pulse campaign ONLY.
// Source: fee_index_cache (the table the public National report and National Fee Index read),
// stats_method_version 3, computed 2026-10-06 00:41 UTC. One value per institution from its own
// published schedule; n = institutions with that fee.
// The automations (welcome, report, explorer) carry no figures, so they never go stale.
// Before each Pulse send, re-run and replace the rows:
//   SELECT fee_category, institution_count, p25_amount, median_amount, p75_amount
//   FROM fee_index_cache ORDER BY fee_category;

export const SNAPSHOT = {
  asOf: "October 6, 2026",
};

// n = institutions with that fee published. p25/median/p75 in dollars.
export const FEES = {
  overdraft: { label: "Overdraft (paid item)", all: { n: 1324, p25: 25, med: 30, p75: 32 } },
  nsf: { label: "NSF (returned item)", all: { n: 1630, p25: 25, med: 30, p75: 31.5 } },
  monthly_maintenance: { label: "Monthly maintenance", all: { n: 530, p25: 3, med: 5.5, p75: 10 } },
  stop_payment: { label: "Stop payment", all: { n: 1925, p25: 20, med: 26, p75: 30 } },
  deposited_item_return: { label: "Deposited item returned", all: { n: 891, p25: 10, med: 15, p75: 25 } },
  card_replacement: { label: "Debit card replacement", all: { n: 1352, p25: 5, med: 10, p75: 10 } },
  od_protection_transfer: { label: "Overdraft protection transfer", all: { n: 531, p25: 3, med: 5, p75: 5 } },
  atm_non_network: { label: "Out-of-network ATM", all: { n: 894, p25: 1, med: 1.83, p75: 2.5 } },
  cashiers_check: { label: "Cashier's check", all: { n: 1356, p25: 3, med: 5, p75: 5.5 } },
  paper_statement: { label: "Paper statement", all: { n: 552, p25: 2, med: 3, p75: 5 } },
  wire_domestic_outgoing: { label: "Domestic wire, outgoing", all: { n: 1223, p25: 20, med: 25, p75: 25 } },
  wire_domestic_incoming: { label: "Domestic wire, incoming", all: { n: 871, p25: 5, med: 10, p75: 15 } },
  wire_intl_outgoing: { label: "International wire, outgoing", all: { n: 437, p25: 40, med: 50, p75: 50 } },
};

// Order used by the benchmark table (most consumer-visible first).
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
