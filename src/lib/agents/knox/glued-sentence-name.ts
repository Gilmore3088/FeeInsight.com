import { checkFeeCategory } from "@/lib/fee-category-guard";
import { FEE_NOUN } from "@/lib/fee-name-fragments";
import { classifyFeeText, usableName } from "@/lib/agents/knox/rules";
import { dropsCondition, isCutoffName } from "@/lib/agents/knox/cutoff-shape";

/**
 * Knox v104: a read name that publish would hold as cut off (`isCutoffName`, Hamilton's
 * `cutoff_name`) only because a sentence is glued onto the fee's own words. The shadow lab (Oct 22)
 * found answer-key fees read at the right category and price held this way:
 * - another column's sentence cell in front, joined by the name tidy with ": " ("(Per month some
 *   exclusions apply): Cashier’s Check (Per item)", "Company that is part of our Health Savings
 *   Program offered: Share-to-Share Overdraft Transfer Fee");
 * - the row's description after a dash ("Overdraft Fee - An Overdraft Fee may be imposed for
 *   transactions made by check");
 * - a fee stated as "<what> will cost $N" ("Copy of a cancelled check will cost").
 *
 * The cut name must name the read's own category on its own, pass the category guard, no longer
 * read as cut off, and drop no condition (`dropsCondition`, the re-tidy bar since v15): "ATM Fee -
 * Cash withdrawal at ATMs we do not own or operate" keeps its words and stays held. A complete name
 * whose own parenthetical trips the shape ("Notary Service (excluding CU business)") is left as
 * read: its words are the fee's, and cutting them would drop the condition.
 */
const MAX_NAME_WORDS = 12;
/** The tidy joins a row's cells with ": "; the cell nearest the price is the last. */
const CELL_JOIN = ": ";
/** A row's description after its name and a dash, opening on a capital: "Overdraft Fee - An Overdraft Fee may be ...". */
const DASH_DESCRIPTION = /^(.+?)\s+[-–—]\s+([A-Z].*)$/;
const MIN_DESCRIPTION_WORDS = 4;
/** The description is a sentence only with a verb ("may be imposed"); "Our Member NSF, etc" is a list. */
const DESCRIPTION_VERB = /\b(?:is|are|be|been|may|will|must|shall|can|applies|apply|imposed|charged|assessed)\b/i;
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

/** Another column's sentence cell glued in front: the name is the last cell. */
function afterSentenceCell(name: string): string | null {
  const at = name.lastIndexOf(CELL_JOIN);
  if (at <= 0) return null;
  const cell = name.slice(0, at).trim();
  const wrapped = /^\([^()]*\)$/.test(cell);
  return wrapped || isCutoffName(cell) ? name.slice(at + CELL_JOIN.length).trim() : null;
}

/** The row's own description after a dash, when it reads as a sentence. */
function beforeDashDescription(name: string): string | null {
  const match = name.match(DASH_DESCRIPTION);
  if (!match) return null;
  const [, head, description] = match;
  const sentence = wordCount(description) >= MIN_DESCRIPTION_WORDS && DESCRIPTION_VERB.test(description) && isCutoffName(description);
  return sentence ? head.trim() : null;
}

/** "<what> will cost": the subject, without its opening determiner. */
function costSentenceSubject(name: string): string | null {
  const subject = name.match(COST_SENTENCE)?.[1]?.replace(SENTENCE_DETERMINER, "").trim();
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
