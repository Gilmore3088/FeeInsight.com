/**
 * Everyday fees people ask about first. Flat-dollar categories only: foreign transaction
 * fees are usually a percentage, so a dollar median would mislead.
 */
export const BENCHMARK_KEYS = [
  "overdraft",
  "nsf",
  "monthly_maintenance",
  "atm_non_network",
  "wire_domestic_outgoing",
  "wire_intl_outgoing",
  "stop_payment",
  "cashiers_check",
] as const;
