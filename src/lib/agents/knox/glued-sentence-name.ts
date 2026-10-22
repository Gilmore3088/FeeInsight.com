import { checkFeeCategory } from "@/lib/fee-category-guard";
import { FEE_NOUN } from "@/lib/fee-name-fragments";
import { classifyFeeText, usableName } from "@/lib/agents/knox/rules";
import { dropsCondition, isCutoffName } from "@/lib/agents/knox/cutoff-shape";

/**
 * Knox v104: a read name that publish would hold as cut off (`isCutoffName`, Hamilton's
 * `cutoff_name`) only because a sentence is glued onto the fee's own words. Three cuts:
 * - another column's cell in front, joined by the name tidy with ": ", when it says nothing;
 * - the row's description after a dash, when it says nothing the name does not;
 * - a fee stated as "<what> will cost $N" ("Copy of a cancelled check will cost", live audit 4993):
 *   the subject, without a leading conjunction or determiner. Nothing of the subject is dropped.
 *
 * A dropped cell or description may hold only filler (articles, auxiliaries, "fee", "charged",
 * "imposed", ...) and the kept name's own words (`onlyFillerAndName`). Any other word keeps the name
 * as read and the fee held, as at base: an audience ("non-members", "business accounts"), a tier
 * ("fourth and subsequent", "repeat", "over"), a region, direction or speed ("international",
 * "foreign", "rush", "expedited"), a channel ("by check"), a figure, or a word not listed. The review
 * of 6dd3641 found those words published as the general fee once dropped, because the cut runs
 * before Darwin's category check, which can no longer see them; `dropsCondition`, built for
 * re-tidy's small trims, does not list them. The cut name must also name the read's own category on
 * its own, pass the category guard, no longer read as cut off, and drop no condition. A complete name
 * whose own parenthetical trips the shape ("Notary Service (excluding CU business)") is left as
 * read: its words are the fee's, and cutting them would drop the condition.
 */
const MAX_NAME_WORDS = 12;
/** The tidy joins a row's cells with ": "; the cell nearest the price is the last. */
const CELL_JOIN = ": ";
/** A row's description after its name and a dash, opening on a capital: "Overdraft Fee - An Overdraft Fee may be ...". */
const DASH_DESCRIPTION = /^(.+?)\s+[-–—]\s+([A-Z].*)$/;
/**
 * The words a dropped cell or description may hold besides the kept name's own: articles, pronouns,
 * auxiliaries, joining words, and the words that say a fee is charged. Nothing that limits whom,
 * when, how often or at what speed or place the fee applies.
 */
const FILLER_WORDS = new Set(
  (
    "a an the this that these those it its is are was were be been being will may can shall must would could should might " +
    "has have had do does of to for by on in at as with per each any all and or which there such " +
    "fee fees charge charges charged charging imposed assessed levied incurred apply applies applied item items"
  ).split(" "),
);
/** A leading conjunction left from the sentence before ("... are $30 and a cashier's check will cost"). */
const LEADING_CONJUNCTION = /^(?:and|or|but)\s+/i;
/** "<what> will cost" / "<what> costs": the price comes next. */
const COST_SENTENCE = /^(.+?)\s+(?:will\s+cost|costs?)$/i;
/** The determiner a "will cost" sentence opens on ("A copy of ...", "Each cashier check ..."). */
const SENTENCE_DETERMINER = /^(?:each|every|a|an|the)\s+(?=[a-z])/i;

function wordCount(text: string): number {
  return text.split(/\s+/).filter(Boolean).length;
}

/** True when the cut name stands as the read's fee: its category, no cut shape, no lost condition. */
function standsAsName(original: string, head: string, canonicalHint: string): boolean {
  if (!head || head === original || !usableName(head) || wordCount(head) > MAX_NAME_WORDS) return false;
  if (!FEE_NOUN.test(head) || isCutoffName(head)) return false;
  if (classifyFeeText(head) !== canonicalHint || !checkFeeCategory(canonicalHint, head).ok) return false;
  return !dropsCondition(original, head, canonicalHint);
}

const stem = (word: string) => word.replace(/['’]s$/, "").replace(/s$/, "");

/**
 * True when every word of the dropped text is filler or one of the kept name's own words ("An
 * Overdraft Fee may be charged for each item" after "Overdraft Fee"). A figure, "$" or "%" is never
 * filler. Pure.
 */
export function onlyFillerAndName(dropped: string, kept: string): boolean {
  const own = new Set((kept.toLowerCase().match(/[a-z]+(?:['’][a-z]+)?/g) ?? []).map(stem));
  const words = dropped.toLowerCase().match(/[a-z0-9$%]+(?:['’-][a-z0-9]+)*/g) ?? [];
  return words.every((word) => !/[\d$%]/.test(word) && (FILLER_WORDS.has(word) || own.has(stem(word))));
}

/** Another column's sentence cell glued in front: the name is the last cell, when the cell says nothing. */
function afterSentenceCell(name: string): string | null {
  const at = name.lastIndexOf(CELL_JOIN);
  if (at <= 0) return null;
  const cell = name.slice(0, at).trim();
  const head = name.slice(at + CELL_JOIN.length).trim();
  const wrapped = /^\([^()]*\)$/.test(cell);
  return (wrapped || isCutoffName(cell)) && onlyFillerAndName(cell, head) ? head : null;
}

/** The row's own description after a dash, when it says nothing the name does not. */
function beforeDashDescription(name: string): string | null {
  const match = name.match(DASH_DESCRIPTION);
  if (!match) return null;
  const [, head, description] = match;
  return isCutoffName(description) && onlyFillerAndName(description, head) ? head.trim() : null;
}

/** "<what> will cost": the subject, without a leading conjunction or its opening determiner. */
function costSentenceSubject(name: string): string | null {
  const subject = name.match(COST_SENTENCE)?.[1]?.replace(LEADING_CONJUNCTION, "").replace(SENTENCE_DETERMINER, "").trim();
  return subject ? subject.charAt(0).toUpperCase() + subject.slice(1) : null;
}

const CUTS = [afterSentenceCell, beforeDashDescription, costSentenceSubject] as const;

/**
 * The read's name without the sentence glued onto it, or the name as read when it is not cut off,
 * no cut stands as the fee's name, or the read has no category. Pure.
 */
export function withoutGluedSentence(name: string, canonicalHint: string | null): string {
  const current = name.replace(/\s+/g, " ").trim();
  if (!canonicalHint || !isCutoffName(current)) return name;
  for (const cut of CUTS) {
    const head = cut(current);
    if (head && standsAsName(current, head, canonicalHint)) return head;
  }
  return name;
}
