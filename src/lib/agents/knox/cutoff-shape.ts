import { PRONOUN_WORDS, SENTENCE_END_WORDS, endsIn, trailingRange, wordsIn } from "@/lib/fee-name-fragments";

/**
 * The cut-off name shapes (`isCutoffName`, publish's `cutoff_name` hold), the regexes they are
 * built from, and the rename bar that never drops a condition (`dropsCondition`). Moved out of
 * `name-retidy.ts` unchanged (Knox v104) so Knox's read path can ask whether a name it just read
 * would be held for its shape, and cut it without dropping a condition, without importing the
 * live re-tidy module, which imports Knox's specialists back. `name-retidy.ts` re-exports both.
 */
/** A column header glued to the front of the name ("Fee Wire Transfer In", "Charge Stop Payment Fee"). */
export const LEADING_HEADER = /^(?:Fees?|Charge)\s+(?=[A-Z])(?!(?:Backs?|Off|Cards?|Schedule|Type|Description|Structure|Amount|Name|Above|Below|Per|Each|For|To|Of|If|When)\b)/;
/** A header cell cut to its first letters, or a header word, left after the name ("... | F", "... | Fee"). */
export const TRAILING_HEADER_CELL = /\s*\|\s*(?:[A-Za-z]{1,2}|fees?|charges?|amount|cost|price)\s*$/i;
/** The start of a range or unit left dangling after the name ("Late Fee | Up to", "NSF fee (ACH, ATM, or check) - per"). */
export const TRAILING_RANGE = trailingRange(String.raw`up\s+to|per|each`);
/**
 * A sentence that ends at its own price: "Our overdraft fee of", "Avoid the monthly service charge
 * of"; group 1 is the fee's name. `leads` are the words the name never opens on. Shared by Knox's
 * cut-off repair (`FEE_OF_SENTENCE`) and Darwin's live tail name (`FEE_OF_SENTENCE_TAIL`, #1499).
 * The "for ..." clause is greedy (it was lazy until #1499): the match is anchored at the end, so
 * group 1 is the same either way, and Postgres reads a regex that mixes greedy and lazy
 * quantifiers differently from JS (the count SQL runs the tail there).
 */
export const feeOfSentence = (leads: string, word = String.raw`[A-Za-z'’\-]+`) =>
  new RegExp(
    String.raw`\b(?:a|an|the|our|your|this)\s+(?:(?:normal|standard|regular|usual|individual|applicable|current)\s+)?((?!(?:${leads})\b)(?:(?!(?:a|an|the|for|of|to)\b)${word}\s+){1,4}(?:fees?|charges?))(?:\s+for\s+[A-Za-z\s\-]{1,40})?\s+(?:of|is|are|will be)\s*$`,
    "i",
  );
export const FEE_OF_SENTENCE = feeOfSentence("minimum|maximum|additional|same|following");
/** The condition that follows a name on its line ("Service Charge if balance falls below"). */
export const CONDITION_TAIL = /\s+(?:(?:is|are)\s+)?(?:waived\s+)?(?:if|when|unless|otherwise|charged\s+(?:if|when))\b.*$/i;
export const PRONOUN = wordsIn(PRONOUN_WORDS);
/** A verb that makes the words a sentence ("Checking accounts are considered dormant"). */
export const SENTENCE_VERB = /\b(?:is|are|was|were|be|been|considered|incurs?|applies|apply|impose|assessed|excluding|including|includes?|do(?:es)?\s+not)\b/i;
export const SENTENCE_END = endsIn(SENTENCE_END_WORDS);
/** True when the name carries one of the v6 cut-off shapes, repaired or not (release review holds it). */
export function isCutoffName(name: string): boolean {
  const current = name.replace(/\s+/g, " ").trim();
  return (
    /^\+/.test(current) ||
    LEADING_HEADER.test(current) ||
    TRAILING_HEADER_CELL.test(current) ||
    TRAILING_RANGE.test(current) ||
    SENTENCE_END.test(current) ||
    CONDITION_TAIL.test(current) ||
    PRONOUN.test(current) ||
    SENTENCE_VERB.test(current) ||
    FEE_OF_SENTENCE.test(current)
  );
}

/**
 * v15: a rename never drops a condition. The words the old name had and the new one lacks are
 * checked for what limits when or how the fee applies: a figure ("after 1st one", "24 months",
 * "<$500"), an account it is limited to ("Savings Account", "Value Checking Accounts Only"), a
 * period or basis ("per quarter", "per hour"), dormancy or a balance, or whose ATM it is ("ATMs
 * we do not own"). v14's pass reached 98 names and about 72 of its trims cut one of these
 * ("ATM Fee - Cash withdrawal at ATMs we do not own or operate" became "ATM Fee"). A dropped
 * footnote number alone ("(1)", "Fee1") is not a condition.
 */
const CONDITION_WORD =
  /^(?:\d[\d,.]*(?:st|nd|rd|th|s)?|first|second|third|one|two|three|four|five|six|twelve|after|only|minimum|mininum|min|maximum|max|excludes?|excluding|except|unless|if|dormant|dormancy|inactive|inactivity|balances?|savings|checking|mma|mmda|share|club|certificates?|per|monthly|quarterly|annually|annual|yearly|daily|multiple|consumers?|business|commercial|[$<>%])$/;
const CONDITION_PHRASE = /\b(?:do not|don['’]t|not) own\b|\bother (?:banks?|institutions?|financial)\b|\bno (?:customer[- ]initiated )?activity\b/i;
function nameWords(name: string): string[] {
  return name.toLowerCase().match(/[a-z0-9’']+|[$<>%]/g) ?? [];
}
const ACCOUNT_WORD_CONDITION = /^(?:savings|checking|mma|mmda|share|club|certificates?|business|commercial|consumers?)$/;
const NAME_SEGMENT = /[()]|\s[-–—]\s|[:;|]\s?/;
const LEADING_HEADING_CELL = /^(.*?)\s*[:|]\s*$/;
/** Fees an account heading limits: their heading names which account they apply to. */
const ACCOUNT_BOUND_KEYS = new Set(["monthly_maintenance", "minimum_balance", "dormant_account", "paper_statement"]);
export function dropsCondition(oldName: string, newName: string, canonicalKey?: string): boolean {
  oldName = oldName.replace(/\b24\s*\/\s*7\b/g, " ");
  const kept = new Set(nameWords(newName));
  // How to waive or avoid the fee, or qualify for no fee, is advice, not a condition (v8 cuts it off).
  const advice = new Set(
    oldName
      .split(NAME_SEGMENT)
      .filter((segment) => /\b(?:waiv|avoid|qualif)|\bfollowing\b/i.test(segment))
      .flatMap((segment) => nameWords(segment)),
  );
  // An account heading cell read onto the front of another fee's name ("PERSONAL CHECKING
  // ACCOUNT FEES | Skip-a-Pay") is that section's name, so its account words may go.
  const at = oldName.toLowerCase().lastIndexOf(newName.trim().toLowerCase());
  const heading =
    at > 0 && !(canonicalKey && ACCOUNT_BOUND_KEYS.has(canonicalKey)) && LEADING_HEADING_CELL.test(oldName.slice(0, at)) ? new Set(nameWords(oldName.slice(0, at))) : new Set<string>();
  // Another row's cells joined on with "|" are not this fee's words ("per item | Stop payment ACH").
  const cells = oldName.split("|");
  const ownCell = cells.length > 1 ? cells.find((cell) => cell.toLowerCase().includes(newName.trim().toLowerCase())) : undefined;
  if (ownCell !== undefined) oldName = ownCell;
  const dropped = nameWords(oldName).filter(
    (word) => !kept.has(word) && !advice.has(word) && !(heading.has(word) && ACCOUNT_WORD_CONDITION.test(word)),
  );
  if (dropped.length === 0 || dropped.every((word) => /^\d{1,2}$/.test(word))) return false;
  return dropped.some((word) => CONDITION_WORD.test(word)) || (CONDITION_PHRASE.test(oldName) && !CONDITION_PHRASE.test(newName));
}
