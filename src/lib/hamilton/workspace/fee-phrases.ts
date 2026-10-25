/**
 * The words a reader uses for each fee: the Ask bar's synonyms (courtesy pay, outgoing wire, monthly
 * service fee) and the taxonomy display name and its parts. Shared by the Ask bar (ask.ts) and the
 * output gate's peer-minimum rule (output-gate.ts), so both read a fee name the same way.
 */
import { DISPLAY_NAMES } from "@/lib/fee-taxonomy";
import { RESEARCH_SPLIT_LIVE } from "@/lib/fee-fold";

/** Words people use for a fee that its display name does not carry. Longest phrase wins. */
const FEE_SYNONYMS: Record<string, string[]> = {
  overdraft: ["overdraft", "overdrafts", "od fee", "od fees", "courtesy pay", "bounce protection", "paid item"],
  nsf: ["nsf", "non-sufficient funds", "nonsufficient funds", "insufficient funds", "returned item", "bounced check"],
  continuous_od: ["continuous overdraft", "extended overdraft", "sustained overdraft", "daily overdraft"],
  od_protection_transfer: ["overdraft protection transfer", "overdraft transfer", "od transfer", "od protection"],
  monthly_maintenance: ["monthly maintenance", "maintenance fee", "monthly service fee", "monthly fee"],
  atm_non_network: ["atm fee", "atm", "out-of-network atm", "foreign atm", "non-network atm"],
  wire_domestic_outgoing: ["wire", "wire fee", "outgoing wire", "domestic wire"],
  wire_domestic_incoming: ["incoming wire"],
  wire_intl_outgoing: ["international wire", "foreign wire"],
  stop_payment: ["stop payment"],
  card_foreign_txn: ["foreign transaction", "international atm", "atm abroad"],
  cashiers_check: ["cashier's check", "cashiers check", "official check"],
  paper_statement: ["paper statement"],
};

// Excess withdrawals and returned mail (#1398) get their own phrases only once the research split
// is on; until then Ask reads these questions exactly as before.
if (RESEARCH_SPLIT_LIVE) for (const [category, phrases] of [
  ["excess_withdrawal", ["excess withdrawal", "excess withdrawals", "excessive withdrawal", "excessive withdrawals", "excess transaction", "excess transactions"]],
  ["returned_mail", ["returned mail", "returned statement", "bad address"]],
] as const) {
  FEE_SYNONYMS[category] = [...(FEE_SYNONYMS[category] ?? []), ...phrases];
}

/** One category's phrases, lower case: its synonyms, its display name, and each part of the display name. */
export function feePhrases(category: string): string[] {
  const display = (DISPLAY_NAMES[category] ?? "").toLowerCase();
  const fromDisplay = display
    .replace(/\(([^)]*)\)/g, "/$1")
    .split("/")
    .map((p) => p.trim())
    .filter((p) => p.length >= 4);
  return [...new Set([...(FEE_SYNONYMS[category] ?? []), display.replace(/\s*\([^)]*\)/g, "").trim(), ...fromDisplay].filter(Boolean))];
}

/** Every category's phrases, longest first. */
export const FEE_PHRASES: ReadonlyArray<{ category: string; phrase: string }> = Object.keys(DISPLAY_NAMES)
  .flatMap((category) => feePhrases(category).map((phrase) => ({ category, phrase })))
  .sort((a, b) => b.phrase.length - a.phrase.length);
