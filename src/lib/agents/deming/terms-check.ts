import { INHERENTLY_PERIODIC_KEYS } from "@/lib/fee-frequency";
import { normalizedUnitFrequency } from "@/lib/fee-unit";
import type { SourceLineTerms } from "@/lib/custom-report/source-line-terms";

/**
 * Deming's terms check (fresh audit v10, pipeline quality plan step 2, #2248): does the published
 * fee carry the unit, period, condition, tier and audience its own source line prints beside the
 * price? A person reading "$25" where the bank prints "$25.00 per hour" scores the fee wrong
 * (James's W43 live check: 188 of 192 wrong-amount rows); the number check alone scored it right.
 *
 * The published fee carries a term in its name ("Research (per hour)", "Safe Deposit Box 3X5") or
 * its stored frequency (`hourly`, `annual`). A `frequency` of `undefined` means the caller does not
 * know the stored frequency (the frozen W43 replay keeps only name, amount and category): the
 * period is then not scored, never assumed lost or carried. `null` means the fee shows none.
 *
 * Audit side only: a terms miss is a measured miss in the accuracy series and a candidate audit
 * case; it publishes, holds and takes down nothing. Pure, deterministic, no model calls.
 */

export const TERMS_CHECK = "deming.terms_lost";

export interface PublishedTerms {
  fee_name: string;
  canonical_fee_key: string;
  /** The stored frequency; `undefined` when not known to the caller. */
  frequency?: string | null;
}

const UNIT_WORDS: Record<NonNullable<SourceLineTerms["unit"]>, RegExp> = {
  hourly: /\bhours?\b|\bhrs?\b|\bhourly\b/i,
  per_half_hour: /\bhalf\b|1\/2|½|\b30\s*min/i,
  per_quarter_hour: /\bquarter\b|1\/4|\b15\s*min/i,
  per_minute: /\bminutes?\b|\bmins?\b/i,
  per_page: /\bpages?\b|\bsheets?\b/i,
  per_amount: /\bper\s*\$|\/\s*\$|\$\s?\d[\d,]*(?:\.\d{2})?\s*(?:cashed|or (?:fraction|portion))|%/i,
  per_bundle: /\d|\b(?:pack|book|box|pad|set)\b/i,
};
/** A minimum stated in the name ("Research fee (1/2-hour minimum charge)") names no charging basis. */
const NAMED_MINIMUM = /(?:\d+(?:\/\d+)?|one|half|a)[\s-]*(?:hours?|hrs?|minutes?|mins?|pages?)\s*min(?:imum|\.)?\b/gi;
const PERIOD_WORDS: Record<NonNullable<SourceLineTerms["period"]>, RegExp> = {
  monthly: /\bmonth(?:ly|s)?\b|\bmo\b|\bmthly\b/i,
  annual: /\bannual(?:ly)?\b|\byear(?:ly|s)?\b|\byr\b/i,
  quarterly: /\bquarter(?:ly)?\b|\bqtr\b/i,
  daily: /\bdaily\b|\bdays?\b/i,
};
const PERIOD_FREQUENCIES: Record<NonNullable<SourceLineTerms["period"]>, string> = { monthly: "monthly", annual: "annual", quarterly: "quarterly", daily: "daily" };
const CONDITION_WORDS: Record<SourceLineTerms["conditions"][number], RegExp> = {
  plus_extra: /\bplus\b|\+|\btax\b/i,
  balance_condition: /\bbalance\b|\$\s?\d|\bwaive|\bminimum\b|\bbelow\b|\bunder\b/i,
  // "Excessive Withdrawal" says an allowance exists, not how many are free: only the count carries it.
  allowance: /\d|\b(?:one|two|three|four|five|six|seven|eight|nine|ten)\b/i,
  greater_of: /\bgreater\b|\bhigher\b|\bcost\b|\bwhichever\b/i,
};
const TIER_WORDS: Record<Exclude<SourceLineTerms["tier"], null | "size_band" | "balance_band">, RegExp> = {
  first_then: /\bfirst\b|\bthen\b|\badditional\b|\bsubsequent\b|\b\d+(?:st|nd|rd|th)\b|\beach add/i,
  additional: /\badditional\b|\bextra\b|\bsurcharge\b|\bovernight\b/i,
};
const AUDIENCE_WORDS: Record<NonNullable<SourceLineTerms["audience"]>, RegExp> = {
  age: /\bages?\b|\d+\s*(?:-|–|to|\+)\s*\d*|\bseniors?\b|\byouth\b|\bminors?\b|\bstudents?\b/i,
  non_member: /\bnon[-\s]?(?:members?|customers?|depositors?)\b/i,
  members_only: /\bmembers?\b|\bcustomers?\b/i,
  business: /\bbusiness\b|\bcommercial\b/i,
  student: /\bstudents?\b|\byouth\b/i,
};

const compactSize = (value: string) => value.toLowerCase().replace(/[×]/g, "x").replace(/[^0-9x.]/g, "");

/**
 * The first term the source line prints that the published fee does not carry, as
 * `<kind>_lost:<term>` ("unit_lost:hourly", "tier_lost:size_band"), or null when every printed term
 * is carried (or the line prints none).
 */
export function lostTerm(fee: PublishedTerms, terms: SourceLineTerms | null | undefined): string | null {
  if (!terms) return null;
  const name = fee.fee_name ?? "";
  const frequency = normalizedUnitFrequency(fee.frequency ?? null);
  if (terms.unit && frequency !== terms.unit && !UNIT_WORDS[terms.unit].test(name.replace(NAMED_MINIMUM, " "))) return `unit_lost:${terms.unit}`;
  // The shared check already found the name does not name its band (`tiered_fee`).
  if (terms.tier === "balance_band") return "tier_lost:balance_band";
  if (terms.tier === "size_band") {
    if (terms.band && !compactSize(name).includes(compactSize(terms.band))) return "tier_lost:size_band";
  } else if (terms.tier && !TIER_WORDS[terms.tier].test(name)) return `tier_lost:${terms.tier}`;
  for (const condition of terms.conditions) if (!CONDITION_WORDS[condition].test(name)) return `condition_lost:${condition}`;
  if (terms.audience && !AUDIENCE_WORDS[terms.audience].test(name)) return `audience_lost:${terms.audience}`;
  if (terms.period && fee.frequency !== undefined) {
    const carried = frequency === PERIOD_FREQUENCIES[terms.period] || PERIOD_WORDS[terms.period].test(name)
      || (terms.period === "monthly" && INHERENTLY_PERIODIC_KEYS.has(fee.canonical_fee_key));
    if (!carried) return `period_lost:${terms.period}`;
  }
  return null;
}
