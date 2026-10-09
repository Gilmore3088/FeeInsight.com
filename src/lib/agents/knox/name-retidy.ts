import { createHash } from "node:crypto";
import type { sql } from "@/lib/data-store/connection";
import { invalidatePublicReadCache } from "@/lib/data-store/fee-cache";
import { inSavepoint } from "@/lib/agents/savepoint";
import { recordAttempt } from "@/lib/agents/learning/attempts";
import { feedbackSchemaReady, recordFeedback } from "@/lib/agents/learning/feedback";
import { repairNameShape, tidyFeeName } from "@/lib/agents/knox/layout";
import { stripFootnoteMarks, usableName } from "@/lib/agents/knox/rules";
import { traceLiveFee, type InstitutionText, type LiveFeeRow } from "@/lib/agents/hamilton/source-check";
import { checkFeeCategory } from "@/lib/fee-category-guard";
import { runFreeSpecialists } from "@/lib/agents/knox/specialists";
import { classifyFeeText } from "@/lib/agents/knox/rules";

type SqlTag = typeof sql;

/**
 * A better name for a live fee whose stored name ran on: cells joined with "|" from a table
 * row, the previous row's unit or price ("/Month | Stop Payment"), or the words that led into
 * the price ("Replacement card fee of"). Knox's `tidyFeeName` fixes new reads since v17/v29;
 * this applies the same tidy to names stored before, with a stricter bar because the name is
 * already live: the new name must still name a fee, still pass the category guard, and not end
 * on a verb ("Dormant accounts will incur"). Returns null when the name should stay as it is.
 */
const VERB_END =
  /\b(?:is|are|was|were|be|will|shall|may|can|incur|incurs|receive|receives|charges|charged|imposed|assessed|apply|applies|pay|pays|cost|costs|maintain|exceed|exceeds|lesser|greater|up|than|least|over|under|varies)$/i;
const FEE_NOUN =
  /\b(?:fees?|charges?|service|transfers?|wires?|checks?|cards?|statements?|overdrafts?|nsf|payments?|box|boxes|orders?|deposits?|withdrawals?|cop(?:y|ies)|research|address|items?|atms?|accounts?|drafts?|stop|fax|notary|photocop(?:y|ies)|printing|coins?|money|cashier'?s?|official|bill|replacement|closing|closure|inactivity|inactive|dormant|maintenance|balance|garnishments?|levy|levies|subpoenas?|returned|returns?|counter|temporary|starter|rush|express|expedited|delivery|ach|zelle|p2p|transactions?|reissue|key|drilling)\b/i;
const MAX_WORDS = 12;
/** A cell that qualifies a price ("Per quarter (inactive ...)", "each request"), not a name. */
const QUALIFIER_START = /^(?:per|each|a|an|the|\/|for|if|when|plus|includes?)\b/i;
/** A cell naming the unit a price is charged by, not the fee. */
const UNIT_TAIL =
  /^(?:(?:each|per)\b.*|monthly|month|hour|items?|checks?|cards?|account|wire|request|occurrence|transaction|key lost|\d.*)$/i;
/** A name that is the condition for a fee, not the fee ("None with e-Statement enrollment, otherwise", "To avoid a ... charge"). */
const NOT_A_NAME = /^(?:none|free|no|n\/a|(?:to\s+)?avoid)\b|\botherwise$/i;
/** Two sentences run together ("drafts and a. Garnishment"). */
const SENTENCE_BREAK = /[a-z]\.\s+[A-Z]/;
/** The unit of a price left on the front of a name: "/month service charge", "/ per item Photocopies", "/Money Order". */
const LEADING_PRICE_UNIT = /^\/\s*(?:per\s+)?(?:ea\.?|each|items?|mo\.?|month|yr\.?|year|quarter|day|hr\.?|hour|check|transaction|statement|cop(?:y|ies)|page)?(?=\s|$|[A-Z])[\s.;:,\-–—]*/;
/** A clause about when a fee applies, not its name ("Active if Bill Pay or Zelle are used monthly"). */
const CONDITION_CLAUSE = /\b(?:if|when|unless|otherwise|will be|are used|is used|for\s+\d)\b/i;

/** A column header glued to the front of the name ("Fee Wire Transfer In", "Charge Stop Payment Fee"). */
const LEADING_HEADER = /^(?:Fees?|Charge)\s+(?=[A-Z])(?!(?:Backs?|Off|Cards?|Schedule|Type|Description|Structure|Amount|Name|Above|Below|Per|Each|For|To|Of|If|When)\b)/;
/** A header cell cut to its first letters, or a header word, left after the name ("... | F", "... | Fee"). */
const TRAILING_HEADER_CELL = /\s*\|\s*(?:[A-Za-z]{1,2}|fees?|charges?|amount|cost|price)\s*$/i;
/** The start of a range or unit left dangling after the name ("Late Fee | Up to", "NSF fee (ACH, ATM, or check) - per"). */
const TRAILING_RANGE = /[\s\-–—|:,]*\b(?:up\s+to|per|each)\s*$/i;
/** A sentence that ends at its own price: "Our overdraft fee of", "Avoid the monthly service charge of". */
const FEE_OF_SENTENCE =
  /\b(?:a|an|the|our|your|this)\s+(?:(?:normal|standard|regular|usual|individual|applicable|current)\s+)?((?!(?:minimum|maximum|additional|same|following)\b)(?:(?!(?:a|an|the|for|of|to)\b)[A-Za-z'’\-]+\s+){1,4}(?:fees?|charges?))(?:\s+for\s+[A-Za-z\s\-]{1,40}?)?\s+(?:of|is|are|will be)\s*$/i;
/** The condition that follows a name on its line ("Service Charge if balance falls below"). */
const CONDITION_TAIL = /\s+(?:(?:is|are)\s+)?(?:waived\s+)?(?:if|when|unless|otherwise|charged\s+(?:if|when))\b.*$/i;
/** A unit left after a name once its condition is cut ("Service charge per month"). */
const UNIT_AFTER_NAME = /\s+(?:per|each|a)\s+(?:month|statement(?:\s+cycle)?|year|quarter|item|day|occurrence|transaction)$/i;
/** A parenthetical condition after the name ("(Dormant Account Fee assessed after 12 months of inactivity.)"). */
const CONDITION_PARENTHETICAL = /\s*\([^()]*\b(?:after|if|when|assessed|within|inactivity|no activity|unless)\b[^()]*\)\s*$/i;
const PRONOUN = /\b(?:i|we|you|my|our|your|will|would|may|must|shall)\b/i;
/** A verb that makes the words a sentence ("Checking accounts are considered dormant"). */
const SENTENCE_VERB = /\b(?:is|are|was|were|be|been|considered|incurs?|applies|apply|impose|assessed|excluding|including|includes?|do(?:es)?\s+not)\b/i;
const SENTENCE_END = /\b(?:of|to|from|for|at|is|and|or|with|by|a|an|the|per|than|below|above|up to|each)$/i;

/** True when the words still read as a sentence or a condition, not a fee's name. */
function sentenceShaped(cell: string): boolean {
  return SENTENCE_END.test(cell) || CONDITION_CLAUSE.test(cell) || PRONOUN.test(cell) || SENTENCE_VERB.test(cell) || /\.$/.test(cell);
}

/**
 * v6: the cut-off shapes the 200-fee eval's 25 wrong names and Accuracy's two (NBH "Inactive
 * fee: This account may be subject to an Inactive fee of", Zing "Charge Return Statement or
 * Dormant Account Monthly Fee (...) | F") share. Returns the repaired name, or the name as it
 * was when no shape applies. The result still goes through every v1-v5 bar.
 */
export function repairCutoffName(name: string): string {
  let repaired = name.replace(/\s+/g, " ").trim();
  // A "None ..., otherwise" or "To avoid ..." cell is the price's condition, kept for Knox to re-read (v1).
  if (repaired.split(/\s*\|\s*/).some((cell) => NOT_A_NAME.test(cell.trim()))) return repaired;
  // "+Returned Item Fee – per item returned": the bullet of a list read as part of the name.
  repaired = repaired.replace(/^\+{1,2}\s*/, "");
  repaired = repaired.replace(TRAILING_HEADER_CELL, "").trim();
  // Joined cells: a cell that is a sentence or a condition is dropped when another names a fee
  // ("Stop Payment CU Check | Charged when the CU places a stop payment ...").
  if (repaired.includes("|")) {
    const cells = repaired.split(/\s*\|\s*/).map((cell) => cell.trim()).filter(Boolean);
    const kept = cells.filter((cell) => !sentenceShaped(cell));
    if (kept.length > 0 && kept.length < cells.length && kept.some((cell) => FEE_NOUN.test(cell))) {
      repaired = kept.join(" | ");
    }
  }
  repaired = repaired.replace(TRAILING_RANGE, "").trim();
  // A sentence that ends at its own price names the fee in its last noun phrase.
  const sentence = repaired.match(FEE_OF_SENTENCE);
  if (sentence) {
    const phrase = sentence[1].trim();
    repaired = phrase === phrase.toUpperCase() ? phrase.toLowerCase().replace(/(^|\s)([a-z])/g, (_, space, letter: string) => `${space}${letter.toUpperCase()}`) : phrase;
    repaired = repaired.replace(/^[a-z]/, (letter) => letter.toUpperCase());
  }
  // The condition after the name, and the unit the condition leaves behind.
  const head = repaired.replace(CONDITION_TAIL, "").trim();
  if (head !== repaired && head.split(/\s+/).length >= 2 && FEE_NOUN.test(head) && !sentenceShaped(head)) {
    repaired = head.replace(UNIT_AFTER_NAME, "").replace(/[\s,;:\-–—(]+$/u, "").trim();
  }
  const withoutParenthetical = repaired.replace(CONDITION_PARENTHETICAL, "").trim();
  if (withoutParenthetical !== repaired && withoutParenthetical.split(/\s+/).length >= 2 && FEE_NOUN.test(withoutParenthetical)) {
    repaired = withoutParenthetical;
  }
  const headerless = repaired.replace(LEADING_HEADER, "");
  if (headerless !== repaired && FEE_NOUN.test(headerless) && !sentenceShaped(headerless)) repaired = headerless;
  repaired = repaired.replace(TRAILING_HEADER_CELL, "").replace(/[\s\-–—|:,;]+$/u, "").trim();
  if (!repaired) return name.trim();
  // A name cut from a sentence starts lowercase ("service charge if balance falls below").
  return repaired === name.trim() ? repaired : repaired.replace(/^[a-z]/, (letter) => letter.toUpperCase());
}

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

/** v7: a word that joins the name to the sentence before it ("Otherwise, a monthly service fee"); Knox v57's tidy drops it. */
const LEADING_DISCOURSE = /^\s*(?:otherwise|additionally|also|however|in addition|furthermore|further)\s*,?\s/i;
/** v7: the gap a dollar figure left in a name when it was cut out ("Cashier's Checks ( and Over)", "balance is under )"). */
const STRIPPED_AMOUNT = /\(\s|\s\)/;
/** v7: a threshold cut off the end of a name ("Classic Money Market Account (balance below"). */
const TRAILING_CUT = /\((?:[^()]*\s)?(?:below|under|than|over|exceeds?|exceeding|least|above)\s*$/i;
const AMOUNT_IN_NAME = String.raw`\$\s?\d[\d,]*(?:\.\d{1,2})?(?:\s*[-–]\s*\$\s?\d[\d,]*(?:\.\d{1,2})?)?`;

/**
 * v7: the name with the dollar figures its schedule line states put back where they were cut
 * out ("Dormant Account Fee-(No activity for 2 years and the balance is under $100)"), read
 * from the fee's own stored text. Null when the name has no such gap or the text does not hold
 * the name with figures in exactly those gaps.
 */
export function restoreStrippedAmount(name: string, texts: string[]): string | null {
  const current = name.replace(/\s+/g, " ").trim();
  const cutAtEnd = TRAILING_CUT.test(current);
  if (!STRIPPED_AMOUNT.test(current) && !cutAtEnd) return null;
  const tokens = current.split(" ").map((token) => token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const pattern = new RegExp(
    tokens.join(`(?:\\s*${AMOUNT_IN_NAME}\\s*|\\s+)`) + (cutAtEnd ? `\\s*${AMOUNT_IN_NAME}(?:\\s*\\))?` : ""),
    "i",
  );
  for (const text of texts) {
    const found = text.replace(/\s+/g, " ").match(pattern)?.[0];
    if (!found) continue;
    let restored = found.replace(/\(\s+/g, "(").replace(/\s+\)/g, ")").trim();
    if ((restored.match(/\(/g) ?? []).length > (restored.match(/\)/g) ?? []).length) restored = `${restored})`;
    const figures = (value: string) => (value.match(/\$/g) ?? []).length;
    return figures(restored) > figures(current) && !STRIPPED_AMOUNT.test(restored) ? restored : null;
  }
  return null;
}

/** v7: a "Name" column label on the front of a name ("Name Stop Payment", Maple FCU). */
const HEADER_WORD_PREFIX = /^Name:?\s+(?=[A-Z])(?!Changes?\b)/;
/**
 * v7: an account or section heading read onto the front of another fee's name ("BUSINESS
 * CHECKING ACCOUNT FEES | Skip-a-Pay", "Business Freedom Checking: Pinnacle Business Checking:
 * Safe Deposit Box Rental"). A monthly or balance fee keeps it: there the account is the name.
 */
const LEADING_ACCOUNT_HEADINGS = /^(?:[A-Z][\w/&'’ -]{0,60}?\b(?:checking|savings|money market|account fees|fees)\s*[:|]\s*)+(?=[A-Z])/i;
const ACCOUNT_NAMED_KEYS = new Set(["monthly_maintenance", "minimum_balance"]);
/**
 * v7: Hamilton's business_schedule check reads a leading "Business" or "Commercial" on a name with
 * no "|" or ":" as a business fee. A rename never drops that word from such a name, or a business
 * price would sit beside the consumer one. A heading glued on with "|" or ":" is still stripped.
 */
/** v7: a dot leader, ellipsis run or fill-in line, the twin of Knox's tidy `LEADERS`. */
const DOT_LEADER = /(?:\.\s?){3,}|…|_{3,}/;
/** v8: waiver advice read onto a fee's name ("Stop Payment (Check/ACH) Submit request ... to avoid this charge"). */
const AVOID = /\bavoid/i;
const AVOID_CELL = /\bavoid/i;
const AVOID_PARENTHETICAL = /\s*\([^()]*\bavoid[^()]*\)(?:\[\d+\]\(#[^)]*\))?/gi;
const ADVICE_START =
  /(?:\.\s+|\s+-\s+|\s+)(?=(?:Save|Submit|Use|Perform|Enroll|PLEASE|Please|Setting|Access|Choose|In order to|To avoid|Avoid)\b)/g;

/**
 * v8: the fee's name with the advice on how to avoid it cut off: a "|" cell, a parenthetical, or
 * the sentence from its imperative on ("Card Rush Order Save your card ... to avoid ..." becomes
 * "Card Rush Order"). Null when nothing names a fee once the advice is gone. Pure.
 */
export function withoutWaiverAdvice(name: string): string | null {
  if (!AVOID.test(name)) return null;
  let current = name;
  if (current.includes("|")) {
    const cells = current.split("|").map((cell) => cell.trim()).filter(Boolean);
    const kept = cells.filter((cell) => !AVOID_CELL.test(cell));
    if (kept.length === 1 && kept.length < cells.length) current = kept[0];
  }
  current = current.replace(AVOID_PARENTHETICAL, "");
  if (AVOID.test(current)) {
    for (const match of current.matchAll(ADVICE_START)) {
      const rest = current.slice((match.index ?? 0) + match[0].length);
      if (AVOID.test(rest)) {
        current = current.slice(0, match.index);
        break;
      }
    }
  }
  current = current.replace(/[\s.,;:–-]+$/, "").trim();
  if (!current || current === name.trim() || AVOID.test(current) || !FEE_NOUN.test(current) || !usableName(current)) return null;
  if (current.split(/\s+/).length > MAX_WORDS || sentenceShaped(current) || VERB_END.test(current) || /\s(?:to|of|a|the)$/i.test(current)) return null;
  return current;
}

// One rules read per document text in a step: a page often holds several advice names.
const readCache = new Map<string, ReturnType<typeof runFreeSpecialists>["candidates"]>();
function specialistCandidates(text: string) {
  let candidates = readCache.get(text);
  if (!candidates) {
    if (readCache.size >= 50) readCache.clear();
    candidates = runFreeSpecialists(text).candidates;
    readCache.set(text, candidates);
  }
  return candidates;
}

/**
 * v8: the name Knox's rules read today for the same fee: one candidate in the fee's own text
 * with the same category and amount whose name gives no advice. Null when none or several. Pure.
 */
export function reReadName(fee: Pick<LiveFeeRow, "canonical_fee_key" | "amount">, ownTexts: string[]): string | null {
  if (fee.amount == null) return null;
  const amount = Number(fee.amount);
  const names = new Set<string>();
  for (const text of ownTexts) {
    for (const candidate of specialistCandidates(text)) {
      if (candidate.canonicalHint !== fee.canonical_fee_key || Math.abs(candidate.amount - amount) >= 0.005) continue;
      if (AVOID.test(candidate.feeName) || !usableName(candidate.feeName)) continue;
      names.add(candidate.feeName.trim());
    }
  }
  return names.size === 1 ? [...names][0] : null;
}

/** v8: the advice cut off, else the re-read name; the first that keeps the fee in its category. */
function adviceFreeName(fee: LiveFeeRow, ownTexts: string[]): string | null {
  const keepsCategory = (name: string | null) =>
    name != null && (!checkFeeCategory(fee.canonical_fee_key, fee.fee_name).ok || checkFeeCategory(fee.canonical_fee_key, name).ok);
  const cut = withoutWaiverAdvice(fee.fee_name);
  if (keepsCategory(cut)) return cut;
  const reRead = reReadName(fee, ownTexts);
  return keepsCategory(reRead) ? reRead : null;
}

const BUSINESS_NAMED = /^(?:business|commercial)\b/i;
const SECTION_HEADING_ONLY = /^(?:[\w&'’-]+\s+){0,2}(?:fees|charges|services)$/i;

/** The tidy name a live fee should show, or null to keep its name. */
export function retidiedFeeName(name: string, canonicalKey: string): string | null {
  const stored = name.trim();
  // v6: cut-off shapes first, so the v1-v5 tidy reads the name the shape hid.
  const current = repairCutoffName(stored);
  if (current !== stored) {
    if (sentenceShaped(current) || NOT_A_NAME.test(current) || !FEE_NOUN.test(current) || !usableName(current)) return null;
    if (current.split(/\s+/).length > MAX_WORDS || VERB_END.test(current) || /\s\d\s/.test(current) || /[.…]{3,}/.test(current)) return null;
    if (checkFeeCategory(canonicalKey, stored).ok && !checkFeeCategory(canonicalKey, current).ok) return null;
    const tidy = fullyTidiedName(current, canonicalKey) ?? repairNameShape(stripFootnoteMarks(current));
    if (!tidy || tidy === stored) return null;
    if (checkFeeCategory(canonicalKey, stored).ok && !checkFeeCategory(canonicalKey, tidy).ok) return null;
    return tidy;
  }
  // v5: "$5/month service charge" read as "/month service charge": the price's unit stayed on
  // the front of the name. The words after it are the name when they name a fee, not a
  // condition; otherwise the name stays as it is for Knox to re-read.
  const unitless = repairNameShape(current).replace(LEADING_PRICE_UNIT, "").trim();
  const start = unitless === repairNameShape(current) ? current : unitless;
  if (start !== current && (!FEE_NOUN.test(start) || CONDITION_CLAUSE.test(start) || NOT_A_NAME.test(start) || !usableName(start))) {
    return null;
  }
  const tidy = fullyTidiedName(start, canonicalKey);
  if (tidy) return tidy;
  // v3: only a footnote number to drop; v4: or a cut-off parenthesis or a doubled word. The
  // other words stay as they were read, so the run-on limits don't apply ("Overdraft
  // Protection Transfer Fee4 (from Line of Credit ...)").
  const repaired = repairNameShape(stripFootnoteMarks(start));
  // Compared with the stored name, so untrimmed space alone is worth a rename.
  if (!repaired || repaired === name) return null;
  if (checkFeeCategory(canonicalKey, current).ok && !checkFeeCategory(canonicalKey, repaired).ok) return null;
  return repaired;
}

function fullyTidiedName(name: string, canonicalKey: string): string | null {
  const current = name.trim();
  let tidy = tidyFeeName(current);
  // Joined cells: the cell nearest the price is the fee when it names one on its own
  // ("RESEARCH | Incoming Wire Transfer Fee" is the wire fee, not research).
  if (current.includes("|")) {
    let cells = tidy.split(": ").map((cell) => cell.trim()).filter(Boolean);
    // A unit cell after the name is the price's qualifier ("Stop Payment | Item",
    // "Garnishment | each presentment", "Temporary Checks | 4 checks").
    while (cells.length > 1 && UNIT_TAIL.test(cells[cells.length - 1]) && cells[cells.length - 1].split(/\s+/).length <= 3) {
      cells = cells.slice(0, -1);
    }
    tidy = cells.join(": ");
    const last = cells[cells.length - 1] ?? "";
    if (
      cells.length > 1 &&
      last.split(/\s+/).length >= 2 &&
      !QUALIFIER_START.test(last) &&
      FEE_NOUN.test(last) &&
      checkFeeCategory(canonicalKey, last).ok
    ) {
      tidy = last;
    }
  }
  tidy = tidy.replace(/^(?:[\s\-–—•*:;,.]+|\(\d+\)\s*)+/u, "").trim();
  if (!tidy || tidy === current) return null;
  if (NOT_A_NAME.test(tidy)) return null;
  if (QUALIFIER_START.test(tidy) && !/^(?:a|an|the)\b/i.test(tidy)) return null;
  // A sentence about the customer ("I must maintain a minimum balance") is not a fee's name.
  if (/^(?:i|we|you|my|our|your)\b/i.test(tidy)) return null;
  if (tidy.includes("|") || SENTENCE_BREAK.test(tidy) || VERB_END.test(tidy) || /\b(?:prices vary|varies)\b/i.test(tidy)) return null;
  if (!FEE_NOUN.test(tidy) || tidy.split(/\s+/).length > MAX_WORDS) return null;
  if (checkFeeCategory(canonicalKey, current).ok && !checkFeeCategory(canonicalKey, tidy).ok) return null;
  return tidy;
}

/**
 * v2: a footnote number glued to the name ("Check Cashing Fee1") is messy too.
 * v3: a long name loses its footnote number even when the full tidy would leave it as is.
 * v4: a cut-off parenthesis, a doubled word and untrimmed space are messy too (Extraco:
 * "Account Research Research", "Consumer, Inactivity Fee (Notification sent at 10").
 * v6: cut-off shapes (`repairCutoffName`): a list bullet "+", a column header glued on either
 * end, a sentence ending at its own price, a condition clause or parenthetical after the name,
 * a dangling "up to" / "per". 1,100 live names carried one of these on 2026-10-09.
 * v7: Knox v57's tidy (a details or "N/A" cell after the name, a leading "Otherwise,"), and a
 * dollar figure cut out of the name put back from the fee's own text (`restoreStrippedAmount`).
 * 352 live names carried one of these or a "to avoid" fragment on 2026-10-09.
 * v8: waiver advice on the name ("... to avoid this charge") is cut off (`withoutWaiverAdvice`),
 * or a fragment takes the name Knox v60 reads for the same fee and amount (`reReadName`). 25 of
 * the 55 live "to avoid" names on 2026-10-09; the rest are $0 labels already pending takedown
 * or sentence fragments on the punch list.
 * v9: a threshold Hamilton's publish cut off a name Knox read whole ("Service charge (daily
 * balance falls below" from "... below $500)", `nameBeforeLeaders` before 2026-10-09) comes back
 * from Knox's own read of the name, which `restoreStrippedAmount` searches with the fee's text.
 * v10: heading cells glued onto the name with ":" come off when the schedule prints the fee's
 * name as its own cell at the same price ("Term of the Certificate of Penalty for funds
 * withdrawn: ATM/Visa Check Card Replacement Fee", City National Bank of Florida), and a word
 * cut at its first letters gets the rest of its cell back ("... per each transaction over t")
 * (`cellName`). Dry run on 2026-10-09: 42 of the 844 live names whose last cell is printed on
 * their page, all checked against their source line.
 */
export const NAME_RETIDY_STRATEGY = { strategy: "knox.name_retidy", version: 15 } as const;
export const NAME_RETIDY_KIND = "name_retidied";
/**
 * Institutions the scan visits first after a version change, then the rest in id order. v9:
 * the ones with a threshold publish cut off (102976, 102987/8, 101305, 101842/3, 102654/6,
 * 102568, 102644) and Maple FCU's "Name ..." rows, which v8 had not reached.
 * v10: City National Bank of Florida (76), whose glued cell names Accuracy flagged.
 * v14: Security Federal (722), and the v13 font names v13's pass had not reached (8535, 5545).
 */
export const NAME_RETIDY_FIRST_INSTITUTIONS = [
  76, 282, 640, 3604, 3923, 4715, 8465, 5499, 722, 8535, 5545,
  // v15: UAT's misses v14's pass had not reached: the shared account names (4915, 250, 8299, 1025,
  // 897) and the U+0003 names at 6283 (60527-60532).
  4915, 250, 8299, 1025, 897, 6283,
];
/** Institutions per publish step: about 760 hold a messy live name, so a few hours clears them. */
// 100 since Oct 9: 1,347 institutions were due under v6 at 40 a step, Ambler Savings (1670) 263rd.
export const NAME_RETIDY_INSTITUTION_LIMIT = 100;

export type RetidySkip = "no_better_name" | "would_not_trace" | "category_guard" | "same_name_live" | "keeps_condition";

export interface RetidyRename {
  feePublishedId: number;
  institutionId: number;
  sourceDocumentId: number | null;
  canonicalFeeKey: string;
  amount: number | null;
  oldName: string;
  newName: string;
}

export interface RetidyPlan {
  renames: RetidyRename[];
  skipped: Record<RetidySkip, number>;
}

/**
 * Pure: which live fees take their tidy name. A rename never makes a live fee easier to take
 * down: when the old name traces in the fee's own stored schedule, the new one must too
 * (the source check and the rules re-check both read `fee_name`), the category guard must
 * still accept it, and no other live fee of the bank may already carry the new name at the
 * same price and category (the duplicate collapse would close one of them).
 */
const CELL_PRICE = /(?:\s*(?:[.…_]\s*){2,}|\s+)\$\s?([\d,]+(?:\.\d{1,2})?)\s*$/u;
/** A column header read onto a monthly or balance fee's name; an account name stays. */
/** A cell that opens with its price ("$100.00", "$7.50/mo"). */
const LEAD_PRICE = /^\$\s?([\d,]+(?:\.\d{1,2})?)(?![\d,.])/u;
const GENERIC_COLUMN = /^(?:products?|services?|items?|descriptions?|fees?|charges?|names?|types?)$/i;
const CUT_WORD = /\s[a-z]{1,2}$/;

/**
 * v10: the fee's name as its schedule prints it in a table cell at the fee's price, when the
 * stored name is that cell with the row's earlier cells glued on by ":" or that cell cut short
 * mid-word. Null when no cell at the price explains the stored name.
 */
export function cellName(
  fee: Pick<LiveFeeRow, "fee_name" | "canonical_fee_key" | "amount">,
  ownTexts: string[],
  // v13: a font-repaired name may sit in the cell before its price ("X | Legal Process | $100.00").
  options: { priceInNextCell?: boolean } = {},
): string | null {
  const name = fee.fee_name.replace(/\s+/g, " ").trim();
  const glued = name.includes(": ");
  const cut = CUT_WORD.test(name);
  if ((!glued && !cut) || fee.amount == null) return null;
  for (const text of ownTexts) {
    for (const line of text.split("\n")) {
      if (!line.includes("|")) continue;
      const cells = line.split("|").map((cell) => cell.replace(/\s+/g, " ").trim()).filter(Boolean);
      for (let index = 0; index < cells.length; index += 1) {
        const ownPrice = cells[index].match(CELL_PRICE);
        const leadPrice = options.priceInNextCell && index > 0 ? cells[index].match(LEAD_PRICE) : null;
        const price = ownPrice ?? leadPrice;
        if (!price || Number(price[1].replace(/,/g, "")) !== Number(fee.amount)) continue;
        const inCell = ownPrice ? cells[index].slice(0, ownPrice.index).replace(/[\s:;,\-‐–—]+$/u, "").replace(/^[^\p{L}\p{N}(]+/u, "").trim() : "";
        const nameIndex = inCell.length === 0 && options.priceInNextCell && index > 0 ? index - 1 : index;
        const cell = nameIndex === index ? inCell : cells[nameIndex];
        if (cell.length < 3) continue;
        const headings = cells.slice(0, nameIndex).map((heading) => heading.replace(/:$/, "").trim());
        const joined = [...headings, cell].join(": ").toLowerCase();
        if (glued && headings.length > 0 && joined === name.toLowerCase()) {
          // A business heading or an account's name is part of what the fee is.
          if (headings.some((heading) => /\b(?:business|commercial)\b/i.test(heading))) return null;
          // A box size names the box only beside its "BOX" heading ("BOX: 10x10” Annual Rental").
          if (fee.canonical_fee_key === "safe_deposit_box" && !/\b(?:box|safe)/i.test(cell)) return null;
          // One word ("Replacement") names nothing without its heading.
          if (!/\S\s+\S/.test(cell)) return null;
          if (ACCOUNT_NAMED_KEYS.has(fee.canonical_fee_key) && !headings.every((heading) => GENERIC_COLUMN.test(heading))) return null;
          // The cell names the fee and no heading does: a heading that names it ("Card Replacement
          // Fee: (CARD REPLACEMENT)", "Wire transfer - outgoing domestic: FEE AMOUNT") is the name.
          if (classifyFeeText(cell) !== fee.canonical_fee_key) return null;
          if (headings.some((heading) => classifyFeeText(heading) === fee.canonical_fee_key)) return null;
          return cell;
        }
        if (cut && cell.length > name.length && cell.toLowerCase().startsWith(name.toLowerCase()) && /^[a-z]/i.test(cell.slice(name.length))) {
          return cell;
        }
      }
    }
  }
  return null;
}

/**
 * v11: a sentence name that opens with the fee's own short name and then describes it ("Out-going
 * Wire (foreign): A wire transfer that you send ...", "Inactive Account Fee (Monthly until account
 * is brought back active, closed or escheated)"). The opening words are the name when they name
 * the fee's category on their own and what follows reads as a description, not part of the name.
 */
const HEAD_AND_DESCRIPTION = /^([^:(|]{3,60}?)\s*(?::\s+|\(|\s[-–—]\s)(.+)$/u;
const HEAD_MAX_WORDS = 7;
const HEAD_NOT_NAME = /^(?:\d|(?:all|any|each|every|the|this|these|those|if|when|for|per|a|an|fee|one)\b)|\bfees[a-z]|[\u200b-\u200d\ufeff]/i;
const DATED = /\b(?:19|20)\d{2}\b|\beffective\b/i;
export function headName(fee: Pick<LiveFeeRow, "fee_name" | "canonical_fee_key">): string | null {
  const match = fee.fee_name.replace(/\s+/g, " ").trim().match(HEAD_AND_DESCRIPTION);
  if (!match) return null;
  const head = match[1].replace(/[\s:;,\-–—]+$/u, "").trim();
  const rest = match[2];
  if (head.split(" ").length > HEAD_MAX_WORDS || !/\S\s+\S/.test(head)) return null;
  if (!FEE_NOUN.test(head) || NOT_A_NAME.test(head) || sentenceShaped(head) || VERB_END.test(head) || PRONOUN.test(head)) return null;
  if (classifyFeeText(head) !== fee.canonical_fee_key) return null;
  // A head that starts a sentence ("All items returned for ..."), carries a date ("... EFFECTIVE
  // JULY 1, 2016"), or loses a business qualifier written after it is not the fee's name.
  if (HEAD_NOT_NAME.test(head) || DATED.test(head) || /\b(?:business|commercial)\b/i.test(rest)) return null;
  // A parenthesis followed by more of the name ("Overdraft Item (OD) Charge") is not a cut point.
  if (/^[^)]*\)\s*(?:fees?|charges?)\b/i.test(rest)) return null;
  // A short parenthesis with a figure is part of the name: a box size "(3x4)" or a footnote "(1)".
  if (/^[^)\s]*\d[^)]{0,12}\)/.test(rest)) return null;
  // A box size after the head ("Annual Fee: 3" x 5" box") is part of the name.
  if (/\d\s*["”]?\s*x\s*\d/i.test(rest)) return null;
  // A short parenthesis inside a longer name ("Inactive account fee for Demand Deposit (Checking)
  // Accounts, NOW Accounts") means the head is cut mid-name.
  if (/^[^)]{1,15}\)\s+[A-Z][a-z]*\b/.test(rest)) return null;
  // A network named on its own ("Texans ATM") does not name the fee.
  if (/^\S+\s+atms?$/i.test(head)) return null;
  // What follows describes the fee: a sentence, a condition, or a long qualifier, and it
  // describes this fee, not another one glued on ("Wire Transfer- Foreign (1) Accounts with no
  // ... activity ... will be charged").
  if (rest.split(" ").length < 5) return null;
  if (!(PRONOUN.test(rest) || CONDITION_CLAUSE.test(rest) || sentenceShaped(rest) || rest.split(" ").length >= 8)) return null;
  const restKey = classifyFeeText(rest);
  if (restKey && restKey !== fee.canonical_fee_key) return null;
  return head;
}

/** Control characters a name can carry from a PDF font; U+0003 is that font's space. */
const CONTROL_CHARACTER = /[\x01-\x08\x0b\x0c\x0e-\x1f]/;
/**
 * v12: the name with each U+0003 read as the space it stands for, or null. A name with any other
 * control character is left alone: in the same font U+0013-U+001C are digits, and a figure is
 * never guessed from a font's encoding.
 */
export function spacedControlName(name: string): string | null {
  if (!name.includes("\u0003")) return null;
  // The same font draws its hyphen as a combining low line ("Non\u0332Sufficient") or, in
  // another extract, as U+0372 ("Non\u0372Sufficient").
  const spaced = name.replace(/\u0003/g, " ").replace(/(?<=\w)[\u0332\u0372](?=\w)/g, "-").replace(/\s+/g, " ").trim();
  return spaced && !CONTROL_CHARACTER.test(spaced) ? spaced : null;
}

/**
 * v13: the same font writes every glyph 29 code points below its letter: U+0003 is the space,
 * U+0013-U+001C the digits ("$\u0014\u001300" is "$100"), and "HDFK" is "each". A document's
 * map is trusted only when at least two of its shifted words read, once shifted back, as words the
 * same document also prints in clear ("EDODQFH" is "balance", "&KHFN" is "Check").
 */
const FONT_SHIFT = 29;
const SHIFTED_CONTROL = /[\x01-\x08\x0b\x0c\x0e-\x1f]/g;
const SHIFTED_WORD = /^[\x24-\x5d]{3,}$/;
const FONT_MAP_MIN_WORDS = 2;

function unshifted(text: string): string {
  return text.replace(/[\x01-\x08\x0b\x0c\x0e-\x1f\x24-\x5d]/g, (glyph) => String.fromCharCode(glyph.charCodeAt(0) + FONT_SHIFT));
}

export function fontMapVerified(text: string): boolean {
  if (!/[\x01-\x08\x0b\x0c\x0e-\x1f]/.test(text)) return false;
  const clear = new Set((text.match(/[A-Za-z]*[a-z][A-Za-z]*/g) ?? []).filter((word) => word.length >= 3).map((word) => word.toLowerCase()));
  const read = new Set<string>();
  for (const token of text.split(/[\s|\x01-\x08\x0b\x0c\x0e-\x1f]+/)) {
    if (!SHIFTED_WORD.test(token)) continue;
    const word = unshifted(token);
    if (/^[A-Za-z]+$/.test(word) && clear.has(word.toLowerCase())) read.add(word.toLowerCase());
  }
  return read.size >= FONT_MAP_MIN_WORDS;
}

/** v13: a name's font codes read back as the spaces and digits they stand for. Letters stay as stored. */
export function fontDecodedName(name: string): string | null {
  if (!/[\x01-\x08\x0b\x0c\x0e-\x1f]/.test(name)) return null;
  const decoded = name
    .replace(SHIFTED_CONTROL, (glyph) => String.fromCharCode(glyph.charCodeAt(0) + FONT_SHIFT))
    .replace(/(?<=\w)[\u0332\u0372](?=\w)/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return decoded || null;
}

/** The fee's own document with its font codes read back, when its map is trusted. */
function fontDecodedText(text: string): string {
  return text.replace(SHIFTED_CONTROL, (glyph) => String.fromCharCode(glyph.charCodeAt(0) + FONT_SHIFT)).replace(/[ \t]{2,}/g, " ");
}

/**
 * v13: a PDF font's ligatures extracted as single letters: "ti" as U+019F ("Outgoing Wire –
 * DomesƟc"), "ft" as U+014C ("DraŌ"), "tt" as U+01A9 and "tf" as U+019E. No fee word is spelled
 * with these letters, so each always reads back as its pair.
 */
const LIGATURE_PAIRS: Record<string, string> = { "\u019f": "ti", "\u014c": "ft", "\u01a9": "tt", "\u019e": "tf" };
const LIGATURE = /[\u019f\u014c\u01a9\u019e]/g;
const LIGATURE_CHARACTER = /[\u019f\u014c\u01a9\u019e]/;
function readLigatures(text: string): string {
  return text.replace(LIGATURE, (letter) => LIGATURE_PAIRS[letter]);
}
export function unligatedName(name: string): string | null {
  return /[\u019f\u014c\u01a9\u019e]/.test(name) ? readLigatures(name) : null;
}

/**
 * v14: a monthly fee's account name, when two live fees at an institution share a bare name at
 * different prices ("waivable monthly fee" at $15 and at $12). Each takes the account heading
 * printed above its own price ("Premium Checking", "High Yield Checking"), as Knox names such a fee
 * when it reads the heading ("Freedom Checking Monthly fee"). All of the shared names are renamed
 * or none: every one must find its own price once on its page and a heading of its own above it.
 */
const ACCOUNT_HEADING =
  /^(?:[\w®™’'&+./-]+\s+){0,5}(?:checking|savings|money market|share draft|club|certificate|account)(?:\s+accounts?)?$/i;
/** A priced row of another monthly fee: the walk up has left this fee's block. */
const MONTHLY_FEE_WORDS = /\b(?:service charge|maintenance|monthly fee|monthly service|minimum balance|balance falls? below)\b/i;
// A page's navigation or marketing line ("Compare Checking Accounts", "Learn More about Loyalty
// Checking", "Comparison table of interest-bearing checking accounts") is not an account's heading.
const NOT_ACCOUNT_HEADING =
  /^(?:our|your|all|personal|business|what|which|find|choose|view|see)\b|\b(?:compare|comparison|table|learn|more|about|benefits?|features|details|apply|open|why|how)\b|\d|\$/i;
const ACCOUNT_WORD = /\b(?:checking|savings|money market|share draft|club|certificate|account|accounts)\b/i;
const ACCOUNT_HEADING_LINES = 12;
const MONEY_ON_LINE = /\$\s?\d/;

function sharedNameKey(name: string): string {
  return name.replace(/\s+/g, " ").trim().toLowerCase();
}

function priceOnLine(line: string, amount: number): boolean {
  const [whole, cents] = amount.toFixed(2).split(".");
  const figure = whole.replace(/\B(?=(\d{3})+$)/g, ",?");
  const price = cents === "00" ? `${figure}(?:\\.00)?` : `${figure}\\.${cents}`;
  return new RegExp(`\\$\\s?${price}(?![\\d.,]*\\d)`).test(line);
}

/** The account heading printed above this fee's own price, or null when it isn't one clear heading. */
export function accountHeading(name: string, amount: number, ownTexts: string[]): string | null {
  const key = sharedNameKey(name);
  const hits: Array<{ lines: string[]; at: number }> = [];
  for (const text of ownTexts) {
    const lines = text.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
    lines.forEach((line, at) => {
      if (line.toLowerCase().includes(key) && (priceOnLine(line, amount) || (lines[at + 1] != null && priceOnLine(lines[at + 1], amount)))) hits.push({ lines, at });
    });
  }
  if (hits.length !== 1) return null;
  const { lines, at } = hits[0];
  for (let line = at - 1; line >= Math.max(0, at - ACCOUNT_HEADING_LINES); line -= 1) {
    // Another fee of the same name above it belongs to the block before.
    if (lines[line].toLowerCase().includes(key)) return null;
    if (MONEY_ON_LINE.test(lines[line]) && MONTHLY_FEE_WORDS.test(lines[line])) return null;
    if (/^[A-Z]/.test(lines[line]) && /\S\s+\S/.test(lines[line]) && ACCOUNT_HEADING.test(lines[line]) && !NOT_ACCOUNT_HEADING.test(lines[line])) {
      return lines[line];
    }
  }
  return null;
}

function accountHeadedName(fee: LiveFeeRow, texts: InstitutionText[], liveFees: LiveFeeRow[]): string | null {
  if (!ACCOUNT_NAMED_KEYS.has(fee.canonical_fee_key) || ACCOUNT_WORD.test(fee.fee_name) || fee.amount == null) return null;
  const key = sharedNameKey(fee.fee_name);
  const shared = liveFees.filter(
    (other) => Number(other.institution_id) === Number(fee.institution_id) && sharedNameKey(other.fee_name) === key && other.amount != null,
  );
  if (new Set(shared.map((other) => Number(other.amount).toFixed(2))).size < 2) return null;
  const headings = shared.map((other) =>
    accountHeading(
      other.fee_name,
      Number(other.amount),
      texts.filter((text) => other.source_document_id != null && Number(text.source_document_id) === Number(other.source_document_id)).map((text) => text.normalized_text),
    ),
  );
  if (headings.some((heading) => heading == null) || new Set(headings.map((heading) => heading!.toLowerCase())).size !== shared.length) return null;
  const own = headings[shared.findIndex((other) => Number(other.fee_published_id) === Number(fee.fee_published_id))];
  return own ? `${own} ${fee.fee_name.replace(/\s+/g, " ").trim()}` : null;
}

/** v14: live fees whose bare monthly-fee name another live fee at the institution shares at a different price. */
export function sharedNameFeeIds(fees: LiveFeeRow[]): Set<number> {
  const amounts = new Map<string, Set<string>>();
  for (const fee of fees) {
    if (!ACCOUNT_NAMED_KEYS.has(fee.canonical_fee_key) || fee.amount == null) continue;
    const key = `${Number(fee.institution_id)}|${sharedNameKey(fee.fee_name)}`;
    amounts.set(key, (amounts.get(key) ?? new Set()).add(Number(fee.amount).toFixed(2)));
  }
  return new Set(
    fees
      .filter((fee) => ACCOUNT_NAMED_KEYS.has(fee.canonical_fee_key) && (amounts.get(`${Number(fee.institution_id)}|${sharedNameKey(fee.fee_name)}`)?.size ?? 0) > 1)
      .map((fee) => Number(fee.fee_published_id)),
  );
}

/**
 * v15: names that are another line's cell, Hamilton publish found on Oct 9 (the twins of publish's
 * `withoutNeighbourCell` and `CONDITION_ONLY_NAME`, which keep new ones from publishing).
 * - A neighbouring line's "(...):" cell glued on the front: "(Fee depends on style of check
 *   selected): Rental Late Fee (Past Due 30 Days)" is "Rental Late Fee (Past Due 30 Days)".
 * - A box size's footnote number: "3x10” 8" is box 3x10”, footnote 8.
 * - A name that is only the line's condition, "(if closed within 45 days of opening)": the fee's
 *   name is the cell before it on the same line, or the line above ("Account Closure Fee"), and
 *   must name the fee's category on its own. When the page has no such name but the parenthesis
 *   itself names the category ("$50.00* (Lost Key)"), it is the name without its brackets. Any
 *   other condition-only name is left for a person: no other rule renames it.
 */
const LEADING_PARENTHETICAL_CELL = /^\s*\([^()]*\)\s*:\s*(?=[A-Z])/;
const BOX_FOOTNOTE = /^(\s*\d+(?:\.\d+)?\s*[xX\u00d7]\s*\d+(?:\.\d+)?\s*["\u201d\u2033])\s*\d{1,2}\s*$/;
const CONDITION_ONLY_NAME = /^\s*\([^()]*\)\s*$/;
const NAME_CELL_MAX_WORDS = 8;
/** A price cell ("$5.00", "$ 25.00 per item"), and a line ending on a price word ("Drilling Fee Varies"). */
const PRICE_CELL = /^(?:\$\s?\d|\d[\d,.]*\s*(?:$|per\b|each\b))/i;
const PRICE_WORD_END = /\b(?:varies|free|n\/a|no (?:fee|charge)|none|waived)\s*$/i;

export function neighbourCellName(fee: Pick<LiveFeeRow, "fee_name" | "canonical_fee_key">): string | null {
  const box = fee.fee_name.match(BOX_FOOTNOTE);
  if (box) return fee.canonical_fee_key === "safe_deposit_box" ? box[1].trim() : null;
  if (!LEADING_PARENTHETICAL_CELL.test(fee.fee_name)) return null;
  const rest = fee.fee_name.replace(LEADING_PARENTHETICAL_CELL, "").trim();
  return rest && classifyFeeText(rest) === fee.canonical_fee_key && checkFeeCategory(fee.canonical_fee_key, rest).ok ? rest : null;
}

export function conditionOnlyName(fee: Pick<LiveFeeRow, "fee_name" | "canonical_fee_key" | "amount">, ownTexts: string[]): string | null {
  if (!CONDITION_ONLY_NAME.test(fee.fee_name) || fee.amount == null) return null;
  const condition = fee.fee_name.replace(/\s+/g, " ").trim();
  const key = condition.toLowerCase();
  const amount = Number(fee.amount);
  const found = new Map<string, string>();
  for (const text of ownTexts) {
    const lines = text.split(/\r?\n/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
    lines.forEach((line, at) => {
      const index = line.toLowerCase().indexOf(key);
      if (index < 0 || ![line, lines[at + 1], lines[at + 2]].some((next) => next != null && priceOnLine(next, amount))) return;
      // The cell before the condition on its line, or the line above when the condition opens its line.
      const cells = line.slice(0, index).split("|").map((cell) => cell.trim()).filter((cell) => cell && !PRICE_CELL.test(cell));
      const above = at > 0 && !MONEY_ON_LINE.test(lines[at - 1]) && !PRICE_WORD_END.test(lines[at - 1]) && !lines[at - 1].includes("|") ? lines[at - 1] : null;
      const cell = (line.slice(0, index).trim() ? cells.at(-1) : above)?.replace(/[\s:;,.\-–—…]+$/u, "").trim();
      if (cell) found.set(cell.toLowerCase(), cell);
    });
  }
  const [head] = found.size === 1 ? found.values() : [null];
  if (
    head &&
    /^[A-Z]/.test(head) &&
    head.split(" ").length <= NAME_CELL_MAX_WORDS &&
    !sentenceShaped(head) &&
    !PRONOUN.test(head) &&
    classifyFeeText(head) === fee.canonical_fee_key &&
    checkFeeCategory(fee.canonical_fee_key, `${head} ${condition}`).ok
  ) {
    return `${head} ${condition}`;
  }
  const inner = condition.slice(1, -1).trim();
  // A parenthesis that reads as a condition, a list or a sentence ("Per Presentment of ACH, ...",
  // "Monthly Fee. Over 55 Free") is not a name, and a name on the page that is another fee's wins.
  if (found.size > 0 || /^(?:per|including|for|if|when|only|after|before|excluding|fee shown)\b/i.test(inner) || /[,;.]\s/.test(inner)) return null;
  return classifyFeeText(inner) === fee.canonical_fee_key && checkFeeCategory(fee.canonical_fee_key, inner).ok ? inner : null;
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
  // How to waive or avoid the fee is advice, not a condition (v8 cuts it off on purpose).
  const advice = new Set(
    oldName
      .split(NAME_SEGMENT)
      .filter((segment) => /\b(?:waiv|avoid)/i.test(segment))
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

/**
 * v15: the names v14's pass trimmed past a condition get it back. Only renames logged from v14's
 * first write on are put back; earlier versions' trims were checked by UAT when they landed.
 */
export const CONDITION_RESTORE_SINCE = "2026-10-09T10:46:00Z";
const RESTORE_CUT_LENGTH = 110;
const RESTORE_BOUNDARY = /(?:\.\s|\s[-–—]\s|;\s|\)\s)/g;
/**
 * The old name as it goes back: without a dot leader or a closing full stop, and, when publish
 * cut it off mid-word ("... after your first dormancy notic"), back to its last whole clause as
 * long as that clause still holds the condition. Null when nothing of the condition survives.
 */
export function restoredName(oldName: string, trimmedName: string, canonicalKey?: string): string | null {
  const name = oldName.replace(/\s+/g, " ").replace(/(?:\s*\.){2,}\s*$/, "").replace(/\s*\.$/, "").trim();
  const cut = (oldName.length >= RESTORE_CUT_LENGTH && !/[).]\s*$/.test(oldName)) || DANGLING_WORD.test(name);
  let restored = name;
  if (cut || openParens(name) > 0) {
    const ends = [...name.matchAll(RESTORE_BOUNDARY)].map((match) => match.index! + (match[0].startsWith(")") ? 1 : 0));
    const end = ends.length > 0 ? ends[ends.length - 1] : -1;
    const clause = end > 0 ? closedParens(name.slice(0, end).replace(/[\s,;:\-–—]+$/u, "").trim()) : "";
    restored = clause.length > trimmedName.length && dropsCondition(clause, trimmedName, canonicalKey) ? clause : closedParens(withoutDanglingWords(name));
  }
  if (restored === trimmedName || !dropsCondition(restored, trimmedName, canonicalKey) || AMOUNT_GAP.test(restored)) return null;
  // The old name must open with the trimmed one, or with only its account heading before it
  // ("Premier Checking: Printed Statements"). Another row's cells ("per item | Stop payment ACH")
  // or a sentence the name was cut out of ("Please note that after 180 days ...") stay off.
  const at = restored.toLowerCase().indexOf(trimmedName.trim().toLowerCase());
  if (at === 0) return restored;
  const prefix = at > 0 ? restored.slice(0, at) : "";
  return RESTORE_HEADING.test(prefix) && ACCOUNT_WORD.test(prefix) && !/[\d$|]/.test(prefix) ? restored : null;
}

/** A dollar figure publish cut out of the old name ("if minimum balance is or less", "falls below during"). */
const AMOUNT_GAP =
  /\b(?:below|under|than|is|of|exceeds?|drops?|over|least)\s+(?:or|and|during|\))(?:\s|$)|\b(?:falls?|below|under|than|less|exceeds?|drops?|least)\s*(?:$|[.,:;)])|:\s*(?:n\/a|none)\b/i;
const RESTORE_HEADING = /^[A-Z][\w®™’'&+./ -]{0,60}?\s*:\s*$/;

/** A clause cut off after a joining word ("... is dormant if for one", "... assessed per"). */
const DANGLING_WORD = /\s(?:of|to|from|for|at|is|are|be|may|will|if|and|or|with|by|a|an|the|per|than|below|above|each|one)$/i;
function withoutDanglingWords(name: string): string {
  let current = name;
  while (DANGLING_WORD.test(current)) current = current.replace(DANGLING_WORD, "").replace(/[\s,;:\-–—]+$/u, "");
  return current;
}
function openParens(name: string): number {
  return (name.match(/\(/g) ?? []).length - (name.match(/\)/g) ?? []).length;
}
/** A parenthesis publish cut off mid-way is closed where the name now ends ("(Monthly fee" -> "(Monthly fee)"). */
function closedParens(name: string): string {
  const open = openParens(name);
  return open > 0 ? `${name}${")".repeat(open)}` : name;
}

/** The latest logged rename of a live fee: what its name was and what the retidy made it. */
export interface LoggedRename {
  oldName: string;
  newName: string;
}

function uniqueHeadName(fee: LiveFeeRow, liveFees: LiveFeeRow[]): string | null {
  const head = headName(fee);
  if (!head) return null;
  const opening = head.toLowerCase();
  const shared = liveFees.some(
    (other) =>
      Number(other.institution_id) === Number(fee.institution_id) &&
      Number(other.fee_published_id) !== Number(fee.fee_published_id) &&
      other.fee_name.replace(/\s+/g, " ").trim().toLowerCase().startsWith(opening),
  );
  return shared ? null : head;
}

/** A live fee with the name Knox read for it, before publish shaped it. */
export type RetidyFeeRow = LiveFeeRow & { raw_fee_name?: string | null };

export function planRetidy(
  fees: RetidyFeeRow[],
  texts: InstitutionText[],
  liveFees: LiveFeeRow[] = fees,
  logged: Map<number, LoggedRename> = new Map(),
): RetidyPlan {
  const skipped: Record<RetidySkip, number> = { no_better_name: 0, would_not_trace: 0, category_guard: 0, same_name_live: 0, keeps_condition: 0 };
  const renames: RetidyRename[] = [];
  const lineKey = (fee: Pick<LiveFeeRow, "institution_id" | "canonical_fee_key" | "amount">, name: string) =>
    `${Number(fee.institution_id)}|${fee.canonical_fee_key}|${fee.amount == null ? "" : Number(fee.amount).toFixed(2)}|${name.trim().toLowerCase()}`;
  const taken = new Set(liveFees.map((fee) => lineKey(fee, fee.fee_name)));
  for (const stored of fees) {
    // v15: a name v14 trimmed past its condition gets the condition back from its logged old name.
    const last = logged.get(Number(stored.fee_published_id));
    const restored =
      last && last.newName === stored.fee_name && !CONTROL_CHARACTER.test(last.oldName) && !LIGATURE_CHARACTER.test(last.oldName)
        ? restoredName(last.oldName, stored.fee_name, stored.canonical_fee_key)
        : null;
    if (restored) {
      if (taken.has(lineKey(stored, restored))) {
        skipped.same_name_live += 1;
        continue;
      }
      taken.add(lineKey(stored, restored));
      renames.push({
        feePublishedId: Number(stored.fee_published_id),
        institutionId: Number(stored.institution_id),
        sourceDocumentId: stored.source_document_id == null ? null : Number(stored.source_document_id),
        canonicalFeeKey: stored.canonical_fee_key,
        amount: stored.amount == null ? null : Number(stored.amount),
        oldName: stored.fee_name,
        newName: restored,
      });
      continue;
    }
    // v12: a PDF font that writes its space as U+0003 ("Copy\u0003of\u0003Check").
    // v13: its digits too, when the fee's own document proves the font's map.
    const storedTexts = texts.filter(
      (text) => stored.source_document_id != null && Number(text.source_document_id) === Number(stored.source_document_id),
    );
    const fontMapped = storedTexts.some((text) => fontMapVerified(text.normalized_text));
    // v13: and a font's ligature letters read as their pairs ("DomesƟc").
    const unligated = unligatedName(stored.fee_name);
    const storedName = unligated ?? stored.fee_name;
    const controlRead = spacedControlName(storedName) ?? (fontMapped ? fontDecodedName(storedName) : null);
    const spaced = controlRead ?? unligated;
    const fee = spaced ? { ...stored, fee_name: spaced } : stored;
    const readTexts = spaced
      ? texts.map((text) =>
          fontMapped && storedTexts.includes(text)
            ? { ...text, normalized_text: readLigatures(fontDecodedText(text.normalized_text)) }
            : { ...text, normalized_text: readLigatures(text.normalized_text).replace(/\u0003/g, " ").replace(/[ \t]{2,}/g, " ") },
        )
      : texts;
    const headingless = ACCOUNT_NAMED_KEYS.has(fee.canonical_fee_key) ? fee.fee_name : fee.fee_name.replace(LEADING_ACCOUNT_HEADINGS, "");
    // Knox v60's tidy drops a "Name" column label ("Name Stop Payment").
    const tidied =
      headingless === fee.fee_name ? retidiedFeeName(fee.fee_name, fee.canonical_fee_key) : retidiedFeeName(headingless, fee.canonical_fee_key) ?? headingless;
    // v7: a name whose dollar figure was cut out gets it back from the fee's own document.
    const ownTexts = readTexts
      .filter((text) => fee.source_document_id != null && Number(text.source_document_id) === Number(fee.source_document_id))
      .map((text) => text.normalized_text);
    // v8: waiver advice on the name is cut off, or the name Knox reads today replaces a fragment.
    // A name with advice in it is renamed only to an advice-free name, never tidied around it.
    // v9: Knox's own read of the name holds a threshold publish cut off.
    const restoreTexts = fee.raw_fee_name ? [...ownTexts, fee.raw_fee_name] : ownTexts;
    const advice = AVOID.test(fee.fee_name);
    const adviceFree = advice ? adviceFreeName(fee, ownTexts) : null;
    // v15: a name that is another line's cell, or only its line's condition.
    const cellRepaired = neighbourCellName(fee) ?? conditionOnlyName(fee, ownTexts);
    // v15: a trim of the name's own words keeps every condition in them, or the name stays.
    // Names read from the page (a cell, an account heading) and advice cut off are not trims.
    let keptCondition = false;
    const keep = (name: string | null): string | null => {
      if (name == null || !dropsCondition(fee.fee_name, name, fee.canonical_fee_key)) return name;
      keptCondition = true;
      return null;
    };
    const newName = advice
      ? adviceFree
      : CONDITION_ONLY_NAME.test(fee.fee_name)
        ? cellRepaired
        : cellRepaired ??
        keep(restoreStrippedAmount(tidied ?? fee.fee_name, restoreTexts)) ??
        (tidied ? restoreStrippedAmount(fee.fee_name, restoreTexts) : null) ??
        // v10: the fee's own table cell at its price.
        cellName(fee, ownTexts, { priceInNextCell: controlRead != null }) ??
        keep(tidied) ??
        // v11: the short name a sentence name opens with, unless another live fee at the
        // institution opens with it too (the words cut are what tell the two apart).
        keep(uniqueHeadName(fee, liveFees)) ??
        // v14: a bare monthly-fee name shared at different prices takes its account's name.
        accountHeadedName(fee, readTexts, liveFees) ??
        spaced;
    // v7: a joined sentence that is still a sentence once its "Otherwise," goes ("Monthly service
    // charge is only"), or a name cut down to its section heading ("SERVICE FEES"), is no better.
    // A name that starts mid-sentence ("replacement, and drilling. Min Fee") is no better either.
    if (!newName && keptCondition) {
      skipped.keeps_condition += 1;
      continue;
    }
    if (
      !newName ||
      (LEADING_DISCOURSE.test(fee.fee_name) && sentenceShaped(newName)) ||
      SECTION_HEADING_ONLY.test(newName) ||
      (BUSINESS_NAMED.test(fee.fee_name) && !/[|:]/.test(fee.fee_name) && !BUSINESS_NAMED.test(newName)) ||
      (/^[a-z]/.test(newName) && !/^[a-z]/.test(fee.fee_name))
    ) {
      skipped.no_better_name += 1;
      continue;
    }
    if (checkFeeCategory(fee.canonical_fee_key, fee.fee_name).ok && !checkFeeCategory(fee.canonical_fee_key, newName).ok) {
      skipped.category_guard += 1;
      continue;
    }
    if (taken.has(lineKey(fee, newName))) {
      skipped.same_name_live += 1;
      continue;
    }
    const before = traceLiveFee(stored, texts);
    const after = traceLiveFee({ ...fee, fee_name: newName }, readTexts);
    // A v8 name replaces words the bank wrote, so it must trace itself.
    if ((before.kind !== "untraceable" || adviceFree) && after.kind === "untraceable") {
      skipped.would_not_trace += 1;
      continue;
    }
    taken.add(lineKey(fee, newName));
    renames.push({
      feePublishedId: Number(fee.fee_published_id),
      institutionId: Number(fee.institution_id),
      sourceDocumentId: fee.source_document_id == null ? null : Number(fee.source_document_id),
      canonicalFeeKey: fee.canonical_fee_key,
      amount: fee.amount == null ? null : Number(fee.amount),
      oldName: stored.fee_name,
      newName,
    });
  }
  return { renames, skipped };
}

export interface RetidyResult extends RetidyPlan {
  dryRun: boolean;
  institutionsChecked: number;
  messyFees: number;
}

const EMPTY: RetidyResult = {
  dryRun: false,
  institutionsChecked: 0,
  messyFees: 0,
  renames: [],
  skipped: { no_better_name: 0, would_not_trace: 0, category_guard: 0, same_name_live: 0, keeps_condition: 0 },
};

/** An institution is looked at again when a newer live fee appears or the strategy changes. */
export function retidyFingerprint(maxLiveFeeId: number | string): string {
  return `v${NAME_RETIDY_STRATEGY.version}:${maxLiveFeeId}`;
}

/**
 * Institutions whose live names the retidy will tidy next: a messy name and no attempt at this
 * version for their newest live fee. `limit: null` returns every one (Bayes counts them).
 */
export function retidyDueInstitutions(
  db: SqlTag,
  { institutionId, limit }: { institutionId?: number; limit: number | null },
) {
  return db<{ institution_id: number | string; max_fee_id: number | string }[]>`
      SELECT live.institution_id, live.max_fee_id
        FROM (
          SELECT fp.institution_id, MAX(fp.fee_published_id) AS max_fee_id,
                 -- The same test as isMessyName: joined cells, a dangling lead-in word, a run-on, a
                 -- footnote number, untrimmed space, a doubled word or an unclosed parenthesis.
                 bool_or(
                   fp.fee_name LIKE '%|%'
                   OR fp.fee_name ~* '[[:space:]](of|for|at|is|to|and|or|with|by|a|an|the|from|per|each|up to|than|below)$'
                   OR fp.fee_name ~ '^[[:space:]]*\\+'
                   OR fp.fee_name ~ '^(Fees?|Charge)[[:space:]]+[A-Z]'
                   OR fp.fee_name ~* '[[:space:]](if|when|unless|otherwise)\\M'
                   OR fp.fee_name ~* '\\m(i|we|you|my|our|your|will|may|must|shall)\\M'
                   OR length(fp.fee_name) > 80
                   OR fp.fee_name ~ ${FOOTNOTE_SQL}
                   OR fp.fee_name <> btrim(fp.fee_name)
                   OR fp.fee_name ~* ${DOUBLED_WORD_SQL}
                   OR length(fp.fee_name) - length(replace(fp.fee_name, '(', ''))
                      <> length(fp.fee_name) - length(replace(fp.fee_name, ')', ''))
                   OR fp.fee_name ~ '^[[:space:]]*/'
                   OR fp.fee_name ~* '^[[:space:]]*(otherwise|additionally|also|however|in addition|furthermore|further)[[:space:]]*,?[[:space:]]'
                   OR fp.fee_name ~ '\\([[:space:]]|[[:space:]]\\)'
                   OR fp.fee_name ~ '^Name[[:space:]]+[A-Z]'
                   OR fp.fee_name ~* '^[A-Z][^:|]{0,60}(checking|savings|money market|fees)[[:space:]]*[:|][[:space:]]*[A-Z]'
                   OR fp.fee_name ~ '(\\.[[:space:]]?){3,}|…|_{3,}'
                   OR fp.fee_name ~* 'avoid'
                   OR fp.fee_name LIKE '%: %'
                   OR fp.fee_name ~ '[[:space:]][a-z]{1,2}$'
                   OR fp.fee_name ~ '[\\x01-\\x08\\x0b\\x0c\\x0e-\\x1f]'
                   OR fp.fee_name ~ '[\u019f\u014c\u01a9\u019e]'
                   OR fp.fee_name ~ '^[[:space:]]*\\([^()]*\\)[[:space:]]*(:|$)'
                   OR fp.fee_name ~ '^[[:space:]]*[0-9.]+[[:space:]]*[xX×][[:space:]]*[0-9.]+[[:space:]]*["”″][[:space:]]*[0-9]{1,2}[[:space:]]*$'
                 )
                 -- v14: the same test as sharedNameFeeIds, a monthly-fee name shared at different prices.
                 OR count(DISTINCT lower(regexp_replace(btrim(fp.fee_name), '[[:space:]]+', ' ', 'g')))
                      FILTER (WHERE fp.canonical_fee_key IN ('monthly_maintenance', 'minimum_balance') AND fp.amount IS NOT NULL)
                    < count(DISTINCT (lower(regexp_replace(btrim(fp.fee_name), '[[:space:]]+', ' ', 'g')), fp.amount))
                      FILTER (WHERE fp.canonical_fee_key IN ('monthly_maintenance', 'minimum_balance') AND fp.amount IS NOT NULL) AS messy
            FROM published_fee_records fp
           WHERE fp.rolled_back_at IS NULL
             AND (${institutionId ?? null}::bigint IS NULL OR fp.institution_id = ${institutionId ?? null}::bigint)
           GROUP BY fp.institution_id
        ) live
        -- v15: an institution with a live name still as v14's pass left it, which may have lost a
        -- condition (planRetidy decides with dropsCondition), goes first.
        LEFT JOIN LATERAL (
          SELECT true AS restore
            FROM pipeline_feedback pf
            JOIN published_fee_records rfp ON rfp.fee_published_id = pf.fee_published_id
           WHERE pf.kind = ${NAME_RETIDY_KIND}
             AND pf.check_name = ${NAME_RETIDY_STRATEGY.strategy}
             AND pf.institution_id = live.institution_id
             AND pf.updated_at >= ${CONDITION_RESTORE_SINCE}::timestamptz
             AND rfp.rolled_back_at IS NULL
             AND rfp.fee_name = pf.evidence->>'new_name'
             AND length(pf.evidence->>'old_name') > length(pf.evidence->>'new_name')
           LIMIT 1
        ) restore ON true
        -- An institution the retidy saw longest ago goes first, so a version bump carries on
        -- where the last pass stopped instead of starting again from the lowest id.
        LEFT JOIN LATERAL (
          SELECT pa.created_at AS last_retidy_at
            FROM pipeline_attempts pa
           WHERE pa.institution_id = live.institution_id
             AND pa.stage = 'publish'
             AND pa.strategy = ${NAME_RETIDY_STRATEGY.strategy}
           ORDER BY pa.created_at DESC
           LIMIT 1
        ) seen ON true
       WHERE (live.messy OR restore.restore IS TRUE)
         AND NOT EXISTS (
           SELECT 1 FROM pipeline_attempts pa
            WHERE pa.stage = 'publish'
              AND pa.strategy = ${NAME_RETIDY_STRATEGY.strategy}
              AND pa.institution_id = live.institution_id
              AND pa.input_fingerprint = 'v' || ${NAME_RETIDY_STRATEGY.version}::text || ':' || live.max_fee_id::text
         )
       ORDER BY live.institution_id = ANY(${NAME_RETIDY_FIRST_INSTITUTIONS}::bigint[]) DESC, restore.restore IS TRUE DESC,
                seen.last_retidy_at NULLS FIRST, live.institution_id
       LIMIT ${limit}
  `;
}

/** Bayes's count for this strategy: institutions due now, and institutions already tidied at this version. */
export async function countRetidyReplay(db: SqlTag): Promise<{ due: number[]; doneCurrent: number[] }> {
  const due = await retidyDueInstitutions(db, { limit: null });
  const done = await db<{ institution_id: number | string }[]>`
    SELECT DISTINCT institution_id
      FROM pipeline_attempts
     WHERE stage = 'publish'
       AND strategy = ${NAME_RETIDY_STRATEGY.strategy}
       AND input_fingerprint LIKE ${`v${NAME_RETIDY_STRATEGY.version}:%`}
  `;
  return { due: due.map((row) => Number(row.institution_id)), doneCurrent: done.map((row) => Number(row.institution_id)) };
}

/**
 * Gives live fees with run-on names their tidy name, a batch of institutions per publish
 * step. The old name is never lost: each rename is a `name_retidied` row in
 * `pipeline_feedback` holding the old and new names (dedupe key per live row), and the raw
 * and verified rows keep the name Knox read.
 */
export async function retidyLiveFeeNames(
  db: SqlTag,
  options: { runId: number; dryRun: boolean; institutionId?: number; institutionLimit?: number },
): Promise<RetidyResult> {
  const limit = options.institutionLimit ?? NAME_RETIDY_INSTITUTION_LIMIT;
  let fingerprints: Map<number, string>;
  let liveFees: RetidyFeeRow[];
  let texts: Array<InstitutionText & { institution_id: number | string }>;
  let logged: Map<number, LoggedRename>;
  try {
    if (!(await inSavepoint(db, (scope) => feedbackSchemaReady(scope)))) return { ...EMPTY, dryRun: options.dryRun };
    const due = await inSavepoint(db, (scope) => retidyDueInstitutions(scope, { institutionId: options.institutionId, limit }));
    if (due.length === 0) return { ...EMPTY, dryRun: options.dryRun };
    fingerprints = new Map(due.map((row) => [Number(row.institution_id), retidyFingerprint(row.max_fee_id)]));
    const ids = [...fingerprints.keys()];
    liveFees = await inSavepoint(db, (scope) => scope<RetidyFeeRow[]>`
      SELECT fp.fee_published_id, fp.lineage_ref, fv.fee_raw_id, fp.institution_id, fr.source, fr.source_document_id,
             fp.canonical_fee_key, fp.fee_name, fp.amount, fp.amount_kind, fp.rate_percent, fr.fee_name AS raw_fee_name
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.rolled_back_at IS NULL
         AND fp.institution_id = ANY(${ids}::bigint[])
    `);
    texts = await inSavepoint(db, (scope) => scope<Array<InstitutionText & { institution_id: number | string }>>`
      SELECT DISTINCT ON (source_document_id) institution_id, source_document_id, normalized_text
        FROM agent_source_texts
       WHERE institution_id = ANY(${ids}::bigint[])
         AND status = 'completed'
         AND normalized_text IS NOT NULL
       ORDER BY source_document_id, id DESC
    `);
    // v15: each live fee's latest rename since v14's first write, for the conditions it put back.
    const renamed = await inSavepoint(db, (scope) => scope<{ fee_published_id: number | string; old_name: string; new_name: string }[]>`
      SELECT DISTINCT ON (pf.fee_published_id) pf.fee_published_id, pf.evidence->>'old_name' AS old_name, pf.evidence->>'new_name' AS new_name
        FROM pipeline_feedback pf
       WHERE pf.kind = ${NAME_RETIDY_KIND}
         AND pf.check_name = ${NAME_RETIDY_STRATEGY.strategy}
         AND pf.institution_id = ANY(${ids}::bigint[])
         AND pf.updated_at >= ${CONDITION_RESTORE_SINCE}::timestamptz
         AND pf.evidence ? 'old_name' AND pf.evidence ? 'new_name'
       ORDER BY pf.fee_published_id, pf.updated_at DESC, pf.id DESC
    `);
    logged = new Map(renamed.map((row) => [Number(row.fee_published_id), { oldName: row.old_name, newName: row.new_name }]));
  } catch (error) {
    // A failed tidy must never block publishing.
    console.error("retidyLiveFeeNames select failed:", error);
    return { ...EMPTY, dryRun: options.dryRun };
  }

  const result: RetidyResult = { ...EMPTY, dryRun: options.dryRun, institutionsChecked: fingerprints.size, renames: [], skipped: { ...EMPTY.skipped } };
  const perInstitution = new Map<number, { messy: number; renamed: number }>();
  for (const institutionId of fingerprints.keys()) {
    const fees = liveFees.filter((fee) => Number(fee.institution_id) === institutionId);
    const shared = sharedNameFeeIds(fees);
    const messy = fees.filter(
      (fee) =>
        isMessyName(fee.fee_name) ||
        shared.has(Number(fee.fee_published_id)) ||
        logged.get(Number(fee.fee_published_id))?.newName === fee.fee_name,
    );
    const plan = planRetidy(messy, texts.filter((text) => Number(text.institution_id) === institutionId), fees, logged);
    result.messyFees += messy.length;
    result.renames.push(...plan.renames);
    for (const [key, count] of Object.entries(plan.skipped)) result.skipped[key as RetidySkip] += count;
    perInstitution.set(institutionId, { messy: messy.length, renamed: plan.renames.length });
  }
  if (options.dryRun) return result;

  try {
    await inSavepoint(db, async (scope) => {
      if (result.renames.length > 0) {
        await recordFeedback(
          scope,
          result.renames.map((rename) => ({
            aboutStage: "publish",
            aboutStrategy: NAME_RETIDY_STRATEGY.strategy,
            aboutVersion: NAME_RETIDY_STRATEGY.version,
            signal: "right",
            kind: NAME_RETIDY_KIND,
            reportedBy: "knox",
            checkName: NAME_RETIDY_STRATEGY.strategy,
            institutionId: rename.institutionId,
            sourceDocumentId: rename.sourceDocumentId,
            feePublishedId: rename.feePublishedId,
            canonicalFeeKey: rename.canonicalFeeKey,
            amount: rename.amount,
            // A rename is housekeeping, not a judgement on the read: it carries no weight in lessons.
            weight: 0,
            evidence: { old_name: rename.oldName, new_name: rename.newName },
            runId: options.runId,
            // v15: one row per rename, keyed on the name it replaced, so a second rename of the
            // same fee no longer overwrites the first one's old name.
            dedupeKey: `${NAME_RETIDY_STRATEGY.strategy}:pub:${rename.feePublishedId}:${createHash("sha1").update(rename.oldName).digest("hex").slice(0, 12)}`,
          })),
        );
        await scope`
          UPDATE published_fee_records fp
             SET fee_name = rename.new_name
            FROM unnest(
                   ${result.renames.map((rename) => rename.feePublishedId)}::bigint[],
                   ${result.renames.map((rename) => rename.oldName)}::text[],
                   ${result.renames.map((rename) => rename.newName)}::text[]
                 ) AS rename(fee_published_id, old_name, new_name)
           WHERE fp.fee_published_id = rename.fee_published_id
             AND fp.rolled_back_at IS NULL
             AND fp.fee_name = rename.old_name
        `;
      }
      for (const [institutionId, counts] of perInstitution) {
        await recordAttempt(scope, {
          institutionId,
          sourceDocumentId: null,
          stage: "publish",
          strategy: NAME_RETIDY_STRATEGY.strategy,
          version: NAME_RETIDY_STRATEGY.version,
          fingerprint: fingerprints.get(institutionId)!,
          outcome: counts.renamed > 0 ? "ok" : "unchanged",
          yieldCount: counts.renamed,
          costMicrousd: 0,
          runId: options.runId,
          foldIntoPlaybook: false,
          detail: { messy_names: counts.messy, renamed: counts.renamed },
        });
      }
      await scope`
        INSERT INTO agent_run_events (agent_run_id, event_type, status, message, detail)
        VALUES (
          ${options.runId}, ${NAME_RETIDY_STRATEGY.strategy}, 'completed',
          ${`Tidied ${result.renames.length} live fee name(s) of ${result.messyFees} run-on name(s) at ${result.institutionsChecked} institution(s); old names kept in pipeline_feedback`},
          ${JSON.stringify({
            version: NAME_RETIDY_STRATEGY.version,
            institutions_checked: result.institutionsChecked,
            messy_names: result.messyFees,
            renamed: result.renames.length,
            skipped: result.skipped,
            samples: result.renames.slice(0, 20).map((rename) => ({
              fee_published_id: rename.feePublishedId,
              canonical_fee_key: rename.canonicalFeeKey,
              old_name: rename.oldName,
              new_name: rename.newName,
            })),
          })}::jsonb
        )
      `;
    });
  } catch (error) {
    console.error("retidyLiveFeeNames write failed:", error);
    return { ...result, renames: [] };
  }
  if (result.renames.length > 0) invalidatePublicReadCache();
  return result;
}

/**
 * The live names this step looks at: joined cells, a dangling lead-in word, a run-on, a
 * footnote number, untrimmed space, a doubled word or a cut-off parenthesis.
 */
export function isMessyName(name: string): boolean {
  return (
    name.includes("|") ||
    /\s(?:of|for|at|is|to|and|or|with|by|a|an|the|from|per|each|up to|than|below)$/i.test(name) ||
    // v6: a list bullet, a glued column header, a condition clause or a sentence pronoun.
    /^\s*\+/.test(name) ||
    LEADING_HEADER.test(name.trim()) ||
    CONDITION_TAIL.test(name) ||
    PRONOUN.test(name) ||
    name.length > 80 ||
    stripFootnoteMarks(name) !== name.trim() ||
    name !== name.trim() ||
    repairNameShape(name) !== name.trim() ||
    // v5: a price's unit left on the front ("/month service charge") or a ")" cut from its "(".
    /^\s*\//.test(name) ||
    // v7: a leading "Otherwise,", a gap where a dollar figure was cut out, or a header word in front.
    LEADING_DISCOURSE.test(name) ||
    STRIPPED_AMOUNT.test(name) ||
    TRAILING_CUT.test(name) ||
    LEADING_ACCOUNT_HEADINGS.test(name) ||
    HEADER_WORD_PREFIX.test(name) ||
    // v7: a dot leader or fill-in line left on the end ("ATM Adjustment ......", Wildfire 14754).
    DOT_LEADER.test(name) ||
    // v8: advice on how to avoid the fee.
    AVOID.test(name) ||
    // v10: heading cells glued on with ":", or a last word cut at its first letters.
    name.includes(": ") ||
    CUT_WORD.test(name) ||
    // v12/v13: a font's U+0003 space or another of its codes.
    CONTROL_CHARACTER.test(name) ||
    // v13: a font's ligature letters.
    /[\u019f\u014c\u01a9\u019e]/.test(name) ||
    // v15: another line's cell, or only a condition.
    LEADING_PARENTHETICAL_CELL.test(name) ||
    BOX_FOOTNOTE.test(name) ||
    CONDITION_ONLY_NAME.test(name)
  );
}

/** Postgres twin of `stripFootnoteMarks`'s match, so the due query finds the same names. */
const FOOTNOTE_SQL = "([A-Za-z][a-z]{2}|\\))[0-9]{1,2}(,[0-9]{1,2})*(\\s*\\(|\\s*$)";
/** Postgres twin of `repairNameShape`'s doubled-word match (case-insensitive with `~*`). */
const DOUBLED_WORD_SQL = "\\m([a-z][a-z'’]{2,})\\M\\s+\\1\\M";
