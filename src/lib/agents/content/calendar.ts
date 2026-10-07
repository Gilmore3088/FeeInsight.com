/**
 * The content calendar's monthly themes (plan: "Content plan: first 3 months", Oct 7 2026).
 * W1 market spread picks its fee from the month's theme; months not listed fall back to
 * every featured fee.
 */

/** Fees worth a post: ones a pricing committee compares, in comparable dollar amounts. */
export const FEATURED_FEES: readonly string[] = [
  "overdraft",
  "nsf",
  "monthly_maintenance",
  "stop_payment",
  "wire_domestic_outgoing",
  "wire_intl_outgoing",
  "wire_domestic_incoming",
  "cashiers_check",
  "atm_non_network",
  "paper_statement",
  "card_replacement",
  "od_protection_transfer",
];

export const MONTH_THEMES: Record<string, { theme: string; fees: string[] }> = {
  "2026-10": { theme: "Overdraft (dry run)", fees: ["overdraft", "nsf"] },
  "2026-11": { theme: "Overdraft and NSF", fees: ["overdraft", "nsf", "od_protection_transfer"] },
  "2026-12": { theme: "Account fees", fees: ["monthly_maintenance", "paper_statement", "card_replacement", "atm_non_network"] },
  "2027-01": {
    theme: "The year ahead",
    fees: ["wire_domestic_outgoing", "wire_intl_outgoing", "wire_domestic_incoming", "cashiers_check", "stop_payment"],
  },
};

/** "YYYY-MM" in UTC. */
export function monthKey(now: Date): string {
  return now.toISOString().slice(0, 7);
}

export function themeFees(now: Date): string[] {
  return MONTH_THEMES[monthKey(now)]?.fees ?? [...FEATURED_FEES];
}
