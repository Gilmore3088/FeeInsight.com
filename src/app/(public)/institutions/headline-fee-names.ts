import { HEADLINE_FEE_KEYS } from "@/lib/data-store/market-readiness";

// Server only: market-readiness reads the database, so this stays out of directory-view.ts,
// which the directory's client components import.

/**
 * The headline fees by the names a reader uses, one distinct name each, keyed by the real
 * category keys (the taxonomy's display names are written for tables: "Wire Transfer (Domestic
 * In)", "NSF / Returned Item").
 */
export const HEADLINE_FEE_NAMES: Record<(typeof HEADLINE_FEE_KEYS)[number], string> = {
  monthly_maintenance: "monthly maintenance",
  overdraft: "overdraft",
  nsf: "insufficient funds",
  atm_non_network: "out-of-network ATM",
  card_foreign_txn: "card or ATM use abroad",
  wire_domestic_outgoing: "domestic outgoing wire",
  stop_payment: "stop payment",
  wire_intl_outgoing: "international outgoing wire",
  wire_domestic_incoming: "domestic incoming wire",
  cashiers_check: "cashier's check",
  od_protection_transfer: "overdraft protection transfer",
  paper_statement: "paper statement",
  minimum_balance: "below minimum balance",
  card_replacement: "debit card replacement",
  deposited_item_return: "returned deposited item",
};

/** The headline fee names in the order the coverage count lists them, as one sentence list. */
export function headlineFeeList(): string {
  const names = HEADLINE_FEE_KEYS.map((key) => HEADLINE_FEE_NAMES[key]);
  return `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
}
