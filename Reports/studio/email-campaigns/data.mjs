// National Bank Fee Index figures for the monthly Fee Pulse campaign ONLY.
// Source: fee_index_cache (the table the public National report and National Fee Index read),
// computed 2026-10-17 01:56 UTC (read for the October Pulse). One value per institution from its own
// published schedule; n = institutions with that fee.
// The automations (welcome, report, explorer) carry no figures, so they never go stale.
// Before each Pulse send, re-run and replace the rows:
//   SELECT fee_category, institution_count, p25_amount, median_amount, p75_amount
//   FROM fee_index_cache ORDER BY fee_category;

export const SNAPSHOT = {
  asOf: "October 17, 2026",
  month: "October 2026",
};

// n = institutions with that fee published. p25/median/p75 in dollars.
export const FEES = {
  overdraft: { label: "Overdraft (paid item)", all: { n: 2500, p25: 25, med: 30, p75: 33 } },
  nsf: { label: "NSF (returned item)", all: { n: 2668, p25: 25, med: 30, p75: 32 } },
  monthly_maintenance: { label: "Monthly maintenance", all: { n: 1830, p25: 5, med: 6.95, p75: 10 } },
  stop_payment: { label: "Stop payment", all: { n: 3193, p25: 22, med: 27.5, p75: 30 } },
  deposited_item_return: { label: "Deposited item returned", all: { n: 1821, p25: 9, med: 15, p75: 25 } },
  card_replacement: { label: "Debit card replacement", all: { n: 2626, p25: 5, med: 10, p75: 10 } },
  atm_non_network: { label: "Out-of-network ATM", all: { n: 1647, p25: 1, med: 1.5, p75: 2.5 } },
  cashiers_check: { label: "Cashier's check", all: { n: 2500, p25: 3, med: 5, p75: 6 } },
  wire_domestic_outgoing: { label: "Domestic wire, outgoing", all: { n: 2506, p25: 20, med: 25, p75: 25 } },
  wire_domestic_incoming: { label: "Domestic wire, incoming", all: { n: 1600, p25: 5, med: 10, p75: 15 } },
  wire_intl_outgoing: { label: "International wire, outgoing", all: { n: 1694, p25: 40, med: 50, p75: 50 } },
};
