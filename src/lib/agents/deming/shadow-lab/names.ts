/**
 * Does a published fee name match the name a reviewer expects (the live audit's name, or its
 * correction)? Deliberately simple and independent of the pipeline's own name rules, so the lab
 * does not grade Hamilton with Hamilton's checks:
 * - at least half of the expected name's distinctive words appear in the published name (plurals
 *   read as singulars; the expected name's own parenthetical or "if ..." condition is left out), and
 * - the published name does not start with a cut or condition fragment: leading punctuation, a
 *   bare count before a dash ("2 – Paper Statement Fee"), or a connector word ("if", "and", ...).
 * An expected name with no distinctive word is judged on the fragment rule alone.
 */

/** Words that name no particular fee, so sharing them says nothing about two names. */
const GENERIC_WORDS = new Set([
  "fee", "fees", "charge", "charges", "per", "each", "month", "monthly", "item", "items",
  "service", "the", "and", "for", "account", "accounts", "with", "from",
]);

const LEADING_FRAGMENT =
  /^(?:[-–—,.;:)\]/|•*]|\d+\s*[-–—]\s|(?:if|when|after|per|and|or|of|for|with|plus|than|to|by|at|unless|but|then)\b)/i;

const CONDITION_START = /\s(?:if|when|unless|except|while)\s/i;

const MIN_WORD_SHARE = 0.5;

/** A plural reads as its singular ("Cards" is "card"); short words and "-ss" endings stay. */
const singular = (word: string) => (word.length > 3 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word);

function words(name: string): string[] {
  return name.toLowerCase().match(/[a-z]{3,}/g)?.map(singular).filter((word) => !GENERIC_WORDS.has(word)) ?? [];
}

/** The expected name without its own condition: a parenthetical, or a clause from "if" or "when" on. */
function withoutCondition(name: string): string {
  return name.replace(/\([^)]*\)?/g, " ").split(CONDITION_START)[0];
}

export function isLeadingFragment(name: string): boolean {
  return LEADING_FRAGMENT.test(name.trim());
}

export function nameMatches(expected: string, published: string | null | undefined): boolean {
  const name = (published ?? "").trim();
  if (!name || isLeadingFragment(name)) return false;
  const wanted = [...new Set(words(withoutCondition(expected)))];
  if (wanted.length === 0) return true;
  const have = new Set(words(name));
  return wanted.filter((word) => have.has(word)).length / wanted.length >= MIN_WORD_SHARE;
}
