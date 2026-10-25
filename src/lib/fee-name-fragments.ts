/**
 * The fee-name fragment tests the public fee name and the agents share (#1483). Pure: no database,
 * no crypto, no agent imports, so a public page can import it. Darwin's release review and Deming's
 * fresh audit read `nameHasCutShape`; Knox's re-tidy and Darwin's live fragment re-check read
 * `liveFragmentName`; `feeDisplayName` reads both. Moved here unchanged from
 * darwin/release-review.ts and knox/name-retidy.ts.
 */

// Darwin (release review): a name cut from its line.
/**
 * A name cut from the middle of a line ("/hr incl. reproduction", "account research fee may apply)"),
 * or text that is not a name: dot leaders or a footnote mark glued on ("Replacement ………", "00/item
 * Counter Checks"), a sentence or bullet fragment ("charge for each one-time debit", "Fees: o A
 * Minimum Balance Fee", "(for each overdraft item"), or a table header kept ("Garnishment / Levy: Fee").
 */
// #1196: the cents of a price cut at its decimal point ("00 Monthly fee") or a row number cell ("13 | ...").
const NAME_FRAGMENT = /^\s*\/|^[^(]*\)\s*$|[.…]{3,}|(\.\s){3,}|^\s*\d+\s*\/|^\s*\(|^\s*[Ff]ees?:\s|\bo\s[A-Z]|:\s*[Ff]ee\s*$|^\s*0\d\s+(?![xX]\s)[A-Za-z]|^\s*\d{1,2}\s*\|/;
/** A name that starts lowercase is a sentence cut from its line, unless it is a product spelled that way. */
const SENTENCE_START = /^\s*[a-z]/;
const LOWERCASE_PRODUCT_NAME = /^\s*e-?(statement|banking|bill)/i;

/** The shapes of a name cut from its line, without the cut-off shapes the rename pass may repair. */
export function nameHasCutShape(name: string): boolean {
  if (NAME_FRAGMENT.test(name)) return true;
  return SENTENCE_START.test(name) && !LOWERCASE_PRODUCT_NAME.test(name);
}

// Knox (name re-tidy): the word lists and builders its cut-off shapes and their live twin share.
/** A fee noun: words that make a cell a fee's name. Knox's re-tidy reads it throughout. */
export const FEE_NOUN =
  /\b(?:fees?|charges?|service|transfers?|wires?|checks?|cards?|statements?|overdrafts?|nsf|payments?|box|boxes|orders?|deposits?|withdrawals?|cop(?:y|ies)|research|address|items?|atms?|accounts?|drafts?|stop|fax|notary|photocop(?:y|ies)|printing|coins?|money|cashier'?s?|official|bill|replacement|closing|closure|inactivity|inactive|dormant|maintenance|balance|garnishments?|levy|levies|subpoenas?|returned|returns?|counter|temporary|starter|rush|express|expedited|delivery|ach|zelle|p2p|transactions?|reissue|key|drilling|advances?)\b/i;
/** A name that ends in one of `words`, after any separator ("Late Fee | Up to"); shared with the live twin. */
export const trailingRange = (words: string) => new RegExp(String.raw`[\s\-–—|:,]*\b(?:${words})\s*$`, "i");
export const PRONOUN_WORDS = ["i", "we", "you", "my", "our", "your", "will", "would", "may", "must", "shall"] as const;
export const wordsIn = (words: readonly string[], flags = "i") => new RegExp(String.raw`\b(?:${words.join("|")})\b`, flags);
export const SENTENCE_END_WORDS = ["of", "to", "from", "for", "at", "is", "and", "or", "with", "by", "a", "an", "the", "per", "than", "below", "above", "up to", "each"] as const;
export const endsIn = (words: readonly string[], flags = "i") => new RegExp(String.raw`\b(?:${words.join("|")})$`, flags);

/**
 * The live twin of `isCutoffName` (#1443, #1436): the cut-off shapes narrow enough to take a
 * live fee down. `isCutoffName` matched 1,571 live fees on Oct 15 and a labelled sample of 155
 * found about half were real fees, so only the shapes the sample found to be fragments are kept:
 * - `sentence_end`: the name ends on a joining word ("... reduce your monthly fee to"). "a", "an"
 *   and "the" count only in lower case, so "N/A" never fires; "above" ("... not listed above") and
 *   "each" ("Loan Application, each") are real fees and are left out.
 * - `trailing_range`: a dangling "up to" or "per"; never "each".
 *   #1521: also a name cut before its noun, after a count and an audience word (`DANGLING_AUDIENCE`).
 * - `pronoun`: "will" or "you" (a sentence); not "my", "our", "your", "we" or "i", which name
 *   products ("my Value Checking", "Save Your Way", "i.e.").
 * - `plus`: a leading "+" with no fee noun after it; "+Returned Item Fee" is a list bullet.
 * Not kept: LEADING_HEADER, TRAILING_HEADER_CELL, CONDITION_TAIL, SENTENCE_VERB, FEE_OF_SENTENCE.
 */
export type LiveFragmentPattern = "plus" | "trailing_range" | "sentence_end" | "pronoun";
export const LIVE_TRAILING_RANGE = trailingRange(String.raw`up\s+to|per`);
export const LIVE_SENTENCE_END = endsIn(SENTENCE_END_WORDS.filter((word) => !["a", "an", "the", "above", "each"].includes(word)));
/** Case-sensitive: "N/A" ends in a capital A and never reads as a dangling article. */
export const LIVE_SENTENCE_END_ARTICLE = endsIn(["a", "an", "the"], "");
export const LIVE_PRONOUN = wordsIn(PRONOUN_WORDS.filter((word) => word === "will" || word === "you"));
/**
 * #1521: a name that stops on an audience adjective right after a preposition and a count ("of 3",
 * "after 5", "for each") has lost the noun it described: "Counter Check: A blank page of 3
 * personal" (checks, 75914), "Daily fee after 5 business" (days, 74142). A `sentence_end`: the line
 * was cut before its last word. A name whose audience is its own label ("Monthly Service Fee -
 * Business", "Small Business", "Tier 2 Business") does not match. Knox's `isCutoffName` reads it too.
 */
export const DANGLING_AUDIENCE = /\b(?:of|after|within|for|per|up to|over)\s+(?:\d+|each)\s+(?:personal|business|consumer|commercial)\s*$/i;
/**
 * #1443 switch-on prerequisites: a balanced parenthetical ("Stop Payment (per item, if you request
 * it)") qualifies the fee; a pronoun inside one is not a sentence. Only `pronoun` can sit inside one:
 * the other shapes are read at the end of the name, which a closing ")" never is.
 */
export const PARENTHETICAL = /\([^()]*\)/g;
export function withoutParentheticals(name: string): string {
  return name.replace(PARENTHETICAL, " ").replace(/\s+/g, " ").trim();
}

/** The live fragment shape a name carries, parentheticals included (the shape before #1443's exemption). */
export function liveFragmentShape(name: string | null | undefined): LiveFragmentPattern | null {
  const current = (name ?? "").replace(/\s+/g, " ").trim();
  if (!current) return null;
  if (/^\+/.test(current) && !FEE_NOUN.test(current.replace(/^\++\s*/, ""))) return "plus";
  if (LIVE_TRAILING_RANGE.test(current)) return "trailing_range";
  if (LIVE_SENTENCE_END.test(current) || LIVE_SENTENCE_END_ARTICLE.test(current) || DANGLING_AUDIENCE.test(current)) return "sentence_end";
  if (LIVE_PRONOUN.test(current)) return "pronoun";
  return null;
}

/**
 * The live fragment shape a live fee's name carries, or null (the name may stay live). #1443: a
 * pronoun only inside a parenthetical ("Stop Payment (per item, if you request it)") is no fragment.
 */
export function liveFragmentName(name: string | null | undefined): LiveFragmentPattern | null {
  const shape = liveFragmentShape(name);
  if (shape === "pronoun" && !LIVE_PRONOUN.test(withoutParentheticals((name ?? "").replace(/\s+/g, " ").trim()))) return null;
  return shape;
}
