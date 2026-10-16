/**
 * Words on a fee schedule that name no account (#1100; #1566 and #1598 reviews). Shared by Knox's
 * account read (`knox/lineup.ts`, `accountProductFor`) and the account type hold
 * (`src/lib/account-type.ts`, `accountTypeOf`), so a string one refuses the other refuses too. Pure.
 *
 * - A Reg DD disclosure title: "Truth in Savings", "TRUTH IN SAVINGS ACT", "CONSUMER
 *   TRUTH-IN-SAVINGS FEE SCHEDULE", "Truth-in-Savings Disclosure".
 * - A perk inside a checking package: BaZing's "Health Savings Card", "savings card", "dental
 *   savings program".
 * - A bank's own name: "Bangor Savings Bank", "Home Savings Bank", "First Federal Savings and
 *   Loan", and the institution's name when it is known.
 */
const NOT_AN_ACCOUNT: readonly RegExp[] = [
  /\btruth[\s-]+in[\s-]+savings(?:[\s-]+(?:act|disclosures?|fee\s+schedules?|schedules?|statements?))?\b/gi,
  /\b(?:health|dental|vision|prescription|travel|shopping|dining|entertainment|identity)\s+savings\s+(?:cards?|programs?|discounts?|benefits?|network)\b/gi,
  /\bsavings\s+(?:cards?|programs?|discounts?|benefits?)\b/gi,
  /\b(?:federal\s+)?savings\s+(?:and\s+loan|&\s*loan|bank(?:s|,?\s+fsb)?|institution|association)\b/gi,
];

const escape = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&").replace(/\s+/g, "\\s+");

/** The text with every phrase that names no account set aside. */
export function withoutNonAccountWords(text: string, institutionName?: string | null): string {
  let value = text;
  const name = (institutionName ?? "").replace(/\s+/g, " ").trim();
  if (name.length >= 4) value = value.replace(new RegExp(escape(name), "gi"), " ");
  for (const pattern of NOT_AN_ACCOUNT) value = value.replace(pattern, " ");
  return value.replace(/\s+/g, " ").trim();
}

/** Whether a name carries a phrase that names no account (a product is never one of these). */
export function namesNoAccount(text: string, institutionName?: string | null): boolean {
  return withoutNonAccountWords(text, institutionName) !== text.replace(/\s+/g, " ").trim();
}
