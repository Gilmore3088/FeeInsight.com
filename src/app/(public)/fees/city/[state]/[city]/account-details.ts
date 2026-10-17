/**
 * What the city table says about the account behind a fee. A schedule line cut mid-sentence
 * ("Truist will charge you an Overdraft Fee, if applicable, of") is not an account condition,
 * so only text that reads as a condition is shown; the verbatim line goes in "Source wording".
 * Pure, with no server imports: the client table uses it.
 */

/**
 * Shown when no account has been identified for the fee yet. Not "not stated": the schedule may
 * name the account where our reading has not picked it up.
 */
export const ACCOUNT_NOT_IDENTIFIED = "Account not named on the schedule";

/** Words a sentence cannot end on: the line was cut before its point. */
const DANGLING_END =
  /(?:\b(?:of|is|are|be|to|for|the|a|an|and|or|at|by|per|if|with|from|in|on|as|than|will|you|your|our|we|each|any)|[,;:(\-–—&/])\s*[.:]?\s*$/i;

/** Words that only say what kind of fee it is; a text made mostly of these restates the fee. */
const FEE_WORDS = new Set([
  "fee", "fees", "charge", "charges", "charged", "item", "items", "per", "each", "the", "and", "for", "you", "your",
  "will", "may", "applicable", "apply", "applies", "assessed", "amount", "service", "account", "transaction",
]);

function words(text: string): string[] {
  return (text.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((w) => w !== "inc");
}

/** A line cut before its point, ending on "of", "is", a colon or a comma. */
export function isFragment(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  return DANGLING_END.test(t);
}

/** True when nearly every word of the text is the fee's own name or a generic fee word. */
export function restatesFee(text: string, feeName: string, label: string): boolean {
  const own = new Set([...words(feeName), ...words(label)]);
  const list = words(text);
  if (list.length === 0) return true;
  const restated = list.filter((w) => own.has(w) || FEE_WORDS.has(w)).length;
  return restated / list.length >= 0.7;
}

/** Condition texts worth showing: no fragments, no restatements of the fee, no duplicates. */
export function meaningfulConditions(conditions: string[], feeName: string, label: string): string[] {
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const raw of conditions) {
    const text = raw.replace(/\s+/g, " ").trim();
    const key = text.toLowerCase();
    if (!text || seen.has(key) || isFragment(text) || restatesFee(text, feeName, label)) continue;
    seen.add(key);
    kept.push(text);
  }
  return kept;
}

/** The fee's own name when it reads as a name; null for a cut sentence, so the page shows the fee type instead. */
export function readableFeeName(feeName: string): string | null {
  const name = feeName.replace(/\s+/g, " ").trim();
  if (!name || name.length > 60 || isFragment(name) || /^\d+\s/.test(name)) return null;
  return name;
}
