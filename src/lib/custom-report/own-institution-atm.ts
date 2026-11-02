/**
 * Prod sample, Nov 2 (fee 16734): a fee label that opens with the institution's own abbreviation and
 * "ATM" names the institution's own machines, not another network's. Pure, no imports, so Knox's
 * category list and the category guard read the same words.
 *
 * United Nations FCU (institution 4967, unfcu.org/fees-service-charges, stored text 3232) prints
 * "UNFCU ATM fees in Nairobi" over "Cash withdrawals | UNFCU ATM fees in Nairobi $2.00 ☆", below its
 * "Excessive non-UNFCU/Co-op/Allpoint network ATM transactions" rows. Knox filed the $2 as a non-network
 * ATM fee and it went live. "At Wells Fargo ATMs" (Knox) and "at JSFCU ATM" (the guard's
 * `NAMED_OWN_ATM`, v74) were already read as the bank's own machines; a label that opens with the
 * abbreviation, with no "at" before it, was not.
 *
 * Only an all-capitals abbreviation reads as the institution: a network or card name ("CO-OP",
 * "MoneyPass", "Allpoint", "HSA ATM Withdrawal") or a plain word is never one. The label must not say
 * the machine is someone else's (non-, other, foreign, outside, except, not part of), and a label or
 * line that says the institution's own ATM is free ("No fee at any NCB ATM; $1.25 at other ATMs plus
 * surcharges", 102925; "LPCCU ATM FREE unlimited", 27436) prices the other ATMs, so it stays.
 */

/** Network, card, account and plain words that look like an abbreviation before "ATM" but are not the institution. */
const NOT_THE_INSTITUTION = String.raw`(?:ATMS?|ANY|AN|ALL|THE|OUR|OTHER|ANOTHER|FOREIGN|NON\w*|NETWORK|CO|COOP|CU|CUS|CUSO|CU24|FCU|US|USA|PLUS|STAR|NYCE|MAC|SUM|ACCEL|AFFN|TYME|SHAZAM|PULSE|CIRRUS|MAESTRO|INTERLINK|PRESTO|ALLPOINT|MONEYPASS|VISA|MC|ATH|POS|HSA|IRA|DEBIT|CARD|CARDS|CASH|BANK|SHARE|FEE|FEES|LOCAL|MOBILE|DRIVE|LOBBY|BRANCH|OFFSITE|ONSITE|REMOTE|DOMESTIC|INTL|INT|EACH|PER|NO|FREE|SURCHARG|IN|AT|OF|ON|OR|AND|TO|FOR)`;

/**
 * The abbreviation opens the label or one of its cells ("UNFCU ATM fees in Nairobi", "Cash withdrawals
 * | UNFCU ATM fees in Nairobi", "CBCU ATM Withdrawal"), matched with case. "ATM card" is the card.
 */
const OPENING_ABBREVIATION_ATM = new RegExp(
  String.raw`(?:^|\|)\s*(?!${NOT_THE_INSTITUTION}\b)([A-Z][A-Z0-9&]{1,7})\s+(?:ATM|Atm|atm)(?:['’]?[sS])?(?!\s*(?:cards?|CARDS?|Cards?)\b)(?=\s|$|[,.;:|)])`,
);

/** The label says the machine is someone else's. */
const SOMEONE_ELSES = /\b(?:non|other|another|foreign|outside|except|excluding|not|out[-\s]of[-\s]network|surcharge-?free)\b/i;

/** The label or its line says the institution's own ATM is free, so a price beside it is for other ATMs. */
const OWN_ATM_FREE = /\b(?:no[-\s]+(?:fee|charge|cost)|free|exempt|waived?)\b/i;

/**
 * The institution's abbreviation that opens `label` before "ATM", when the label names the
 * institution's own machines; null otherwise. `line` is the fee's stored line when the caller has it.
 */
export function ownInstitutionAtm(label: string, line?: string | null): string | null {
  const match = label.match(OPENING_ABBREVIATION_ATM);
  if (!match) return null;
  // An all-capitals label ("NON CO OP ATM") makes every word look like an abbreviation; one with no
  // lowercase is read only when it is the abbreviation and "ATM" and little more ("CBCU ATM").
  if (!/[a-z]/.test(label) && label.trim().split(/\s+/).length > 3) return null;
  if (SOMEONE_ELSES.test(label) || OWN_ATM_FREE.test(label)) return null;
  if (line && (OWN_ATM_FREE.test(line) || new RegExp(String.raw`\bnon[-\s]?${match[1]}\b`, "i").test(line))) return null;
  return match[1];
}
