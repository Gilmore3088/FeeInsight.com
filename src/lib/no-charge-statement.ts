/**
 * #2040: a plain sentence in which the bank says it charges no NSF / returned item fee ("We do not
 * charge a returned item/non-sufficient funds (NSF) fee for items returned unpaid.") states that fee's
 * price: $0. Knox read a "No Fee" table cell as the fee's $0 (`zero`) but dropped the sentence, so the
 * bank's NSF showed "Not published". Shared by Knox (the read, rules v133) and the shared source check
 * (`checkFeeAgainstSource`, so Knox's self-check and Darwin trace the $0 to the sentence). Pure.
 *
 * Off switch: `NO_CHARGE_SENTENCE_READ_LIVE` is false, so neither Knox nor the source check acts on
 * these sentences yet; the functions below only report. Switching it on takes a Knox rules version bump
 * and a sample check of the dry-run reads (DECISIONS 2026-10-20).
 *
 * An earlier try (#2710, closed) read a sentence only under a heading wholly about the fee, which read
 * almost nothing, because who a sentence speaks for sits in the prose and headings around it. #2040's
 * note proposed the provider pass, which sees the section. This rule stays deterministic because a
 * paid read must not run while provider billing is gated (CLAUDE.md), every refusal here is a fixed,
 * testable reason Darwin can re-check on live fees, and it refuses on any sign of a narrower scope
 * rather than guess, so what it misses goes to that pass later instead of going live wrong:
 *
 * 1. Grammar (`noChargeNsfSentence`): one whole sentence, `<We | The bank | The credit union> <do not |
 *    does not | don't | doesn't> [currently] <charge | assess | impose> [you] <a/an/any> <NSF fee
 *    name> [<a tail that only restates what the fee is for>].` No figure, no condition ("if", "when",
 *    "for items $5 or less", "for the first item"), no generic "a fee for this service", no second fee
 *    ("overdraft or NSF fees"), no "will not" or "no longer". A sentence wrapped onto the next line is
 *    joined to its real end first, so a condition on the next line refuses it.
 * 2. Opening: the sentence opens its line or follows a sentence end. At the start of a line, the line
 *    above must be blank or end a sentence, so the tail of "In your Easy Checking account," never
 *    reads as a sentence of its own.
 * 3. Scope (`scopeWordIn`): no product, account, audience, tier or service word in the two sentences
 *    before it, the sentence, the one after it, the headings in the 40 lines above or the nearest
 *    section heading however far up ("Bill Pay Services", "Business Checking", "HSBC Premier", "VALUE
 *    CHECKING", "eChecking", "Young Saver", "SMB", "Relationship"). And the sentence after it must not
 *    narrow it (`narrowsStatement`: "This applies only to items under five dollars.").
 * 4. Document (`documentPricesNsf`): no line of the document names an NSF-family fee (the category
 *    guard's own NSF words, `NSF_NAME_INCLUDE`, plus dishonored and bounced items) with a price above
 *    $0. A priced line and a "we do not charge" sentence on one page are two products' terms.
 *
 * Knox adds two more: no read beside any NSF-family read on the same text, priced or held unclassified,
 * and the extract step holds the read for review (`knox_no_charge_conflict`) when the institution has a
 * charged NSF-family fee live, verified, waiting in raw reads of a current copy, in the rate catalog,
 * or read in the same run.
 *
 * Switching on needs, in the same PR: Darwin's live re-check of these $0 fees, the dry-run count on
 * current copies, a sample check, a Knox rules version bump and a source check version bump.
 *
 * Only NSF: overdraft and overdraft transfer "no fee" sentences on prod (Oct 27) are mostly scoped to
 * one transaction type, a threshold or an account, and Darwin's $0 overdraft work (#1882) owns those.
 */

import { NSF_NAME_INCLUDE } from "@/lib/fee-category-guard";

/** The switch, off: on, Knox reads these sentences as NSF $0 and the source check accepts them. */
export const NO_CHARGE_SENTENCE_READ_LIVE = false;

/** The fee types a charged price in which contradicts an NSF $0 ("NSF fee", the NSF daily cap). */
export const NSF_FAMILY_KEYS: readonly string[] = ["nsf", "nsf_daily_cap"];

export interface NoChargeNsfStatement {
  canonicalKey: "nsf";
  /** The fee's name as the sentence prints it ("Returned item/non-sufficient funds (NSF) fee"). */
  feeName: string;
  /** The whole sentence, joined across wrapped lines. */
  sentence: string;
  /** The line the sentence opens on. */
  line: number;
}

const SUBJECT = String.raw`(?:we|the\s+bank|the\s+credit\s+union)`;
const NEGATION = String.raw`(?:currently\s+)?(?:do\s+not|don['’]t|does\s+not|doesn['’]t)(?:\s+currently)?`;
const VERB = String.raw`(?:charge|assess|impose)(?:\s+you)?`;
const OPENING_SOURCE = String.raw`${SUBJECT}\s+${NEGATION}\s+${VERB}\b`;
const OPENING = new RegExp(`^${OPENING_SOURCE}`, "i");
const ARTICLE = String.raw`(?:(?:an?|any)\s+)?`;
const FEE_NOUN = String.raw`(?:fees?|charges?)`;
// "returned item", "NSF", "non-sufficient funds", "nonsufficient funds", "insufficient funds", each with
// an optional "(NSF)", joined by "/", "or", "and" or a space ("returned item/non-sufficient funds (NSF)").
const NSF_WORD = String.raw`(?:returned[\s-]+items?|nsf|non[\s-]?sufficient[\s-]+funds|insufficient[\s-]+funds)(?:\s*\(nsf\))?`;
const NSF_NAME = String.raw`${NSF_WORD}(?:(?:\s*\/\s*|\s+or\s+|\s+and\s+|\s+)${NSF_WORD})*\s+(?:items?\s+)?${FEE_NOUN}`;
/** An NSF name must carry an NSF word: "returned item fee" alone is as often a returned deposited item. */
const NSF_CORE = /\b(?:nsf|non[\s-]?sufficient|insufficient)\b/i;
// What an NSF fee is charged for, restated: "for items returned unpaid", "for items we return unpaid",
// "for returned items", "for returning an item unpaid".
const RESTATED_ITEMS = String.raw`(?:items?|checks?|payments?|transactions?)`;
const NSF_TAIL = String.raw`(?:\s+(?:for|on)\s+(?:${RESTATED_ITEMS}\s+(?:that\s+are\s+returned|we\s+return|returned)(?:\s+unpaid)?|returned\s+${RESTATED_ITEMS}|returning\s+(?:an?\s+|any\s+)?${RESTATED_ITEMS}(?:\s+unpaid)?))?`;
const ENDING = String.raw`\s*[.!]$`;

/** "<opening> a returned item/non-sufficient funds (NSF) fee [for items returned unpaid]." */
const NAMED_SHAPE = new RegExp(String.raw`^${OPENING_SOURCE}\s+${ARTICLE}(?<name>${NSF_NAME})${NSF_TAIL}${ENDING}`, "i");
/** "<opening> a fee for an NSF return." / "a fee for NSF items returned." */
const FOR_SHAPE = new RegExp(
  String.raw`^${OPENING_SOURCE}\s+(?:an?\s+|any\s+)?${FEE_NOUN}\s+for\s+(?:an?\s+|any\s+)?(?<name>(?:nsf|non[\s-]?sufficient[\s-]+funds|insufficient[\s-]+funds)(?:\s*\(nsf\))?\s+(?:returns?|items?|checks?))(?:\s+returned)?${ENDING}`,
  "i",
);

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function tidy(text: string): string {
  return text.replace(/^[\s•·▪◦‣*–—-]+/, "").replace(/\s+/g, " ").trim();
}

/** The fee's name when the sentence is exactly the grammar, else null. */
export function noChargeNsfSentence(sentence: string): string | null {
  const text = tidy(sentence);
  // A figure anywhere is a band, a cap or a count; never an unconditional $0.
  if (!text || text.length > 220 || /[\d$]/.test(text)) return null;
  const named = NAMED_SHAPE.exec(text);
  if (named?.groups?.name) {
    const printed = named.groups.name.replace(/\s+/g, " ").trim();
    return NSF_CORE.test(printed) ? capitalise(printed.replace(/\b(fee|charge)s$/i, "$1")) : null;
  }
  const forFee = FOR_SHAPE.exec(text);
  if (forFee?.groups?.name) return capitalise(`${forFee.groups.name.replace(/\s+/g, " ").trim().replace(/\b(return|item|check)s$/i, "$1")} fee`);
  return null;
}

/**
 * Words that say the sentence speaks for one product, account, audience, tier or service, not the
 * bank's own price: "Bill Pay Services", "Business accounts", "SMB", "HSBC Premier", "Relationship",
 * "student", "Young Saver", "Kids Club", "under 18", "Fresh Start", "Online-only", a card program or a
 * loan. "BankOn" names a certified account; "Bank on the go" does not.
 */
const SCOPE_WORDS = /\b(?:business(?:es)?|smb|commercial|corporate|bill\s*pay(?:ments?)?|premier|preferred|private\s+(?:bank|client)|elite|platinum|signature|relationship|student|youth|young\s+savers?|kids?(?:\s+club)?|children|teens?|minors?|under\s+(?:the\s+age\s+of\s+)?(?:18|eighteen)|seniors?|second\s+chance|fresh\s+start|basic\s+banking|safe\s*balance|clear\s+access|online[\s-]+only|prepaid|payroll|gift\s+card|loans?|mortgage|heloc|line\s+of\s+credit|credit\s+card|treasury|cash\s+management|sweep|trust|ira|health\s+savings|hsa)\b/i;
const BANK_ON = /\bBank ?On\b/;
/** Words that start a generic account phrase, not a product's name ("Your Checking Account", "PERSONAL CHECKING"). */
const GENERIC_WORDS = ["the", "your", "our", "this", "that", "these", "each", "any", "all", "a", "an", "my", "every", "consumer", "personal",
  "deposit", "checking", "savings", "individual", "joint", "other", "such", "new", "existing", "linked",
  // Words that join a heading's phrases ("FEES FOR ACCOUNTS", "CHECKING AND SAVINGS ACCOUNTS").
  "for", "of", "and", "or", "to", "on", "in", "with", "fee", "fees", "schedule", "service", "services", "charges"];
const capitalised = (word: string) => word.charAt(0).toUpperCase() + word.slice(1);
/**
 * A product's name: a capitalised word before Checking, Savings, Account or Banking ("Easy Checking",
 * "Assure Checking Accounts"), the same in capitals ("VALUE CHECKING"), or a name led by a lowercase
 * letter glued to it ("eChecking", "iSavings").
 */
const NAMED_PRODUCT = new RegExp(String.raw`\b(?!(?:${GENERIC_WORDS.map(capitalised).join("|")})\b)[A-Z][A-Za-z0-9®™&'’.-]+[ \t]+(?:Checking|Savings|Accounts?|Banking)\b`);
const NAMED_PRODUCT_CAPITALS = new RegExp(String.raw`\b(?!(?:${GENERIC_WORDS.join("|").toUpperCase()})\b)[A-Z][A-Z0-9®™&'’.-]+[ \t]+(?:CHECKING|SAVINGS|ACCOUNTS?|BANKING)\b`);
const LOWERCASE_LED_PRODUCT = /\b[a-z]{1,2}(?:Checking|Savings|Banking|Account)\b/;

/** True when the text names a narrower scope than the bank's own price. */
export function scopeWordIn(text: string): boolean {
  return SCOPE_WORDS.test(text) || BANK_ON.test(text) || NAMED_PRODUCT.test(text) || NAMED_PRODUCT_CAPITALS.test(text) || LOWERCASE_LED_PRODUCT.test(text);
}

const NUMBER_WORD = String.raw`(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|thirteen|fourteen|fifteen|sixteen|seventeen|eighteen|nineteen|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)`;
/** An amount in words: "five dollars", "twenty-five dollars", "thirty five dollars ($35)". */
const SPELLED_AMOUNT = new RegExp(String.raw`\b${NUMBER_WORD}(?:[\s-]+(?:and[\s-]+)?${NUMBER_WORD})*[\s-]+dollars?\b`, "i");
/** A word that narrows a statement: "only", "except", "does not apply", "applies to", "unless", "if". */
const NARROWING = /\b(?:only|except(?:ions?)?|excluding|does\s+not\s+apply|do\s+not\s+apply|appl(?:y|ies)\s+(?:only\s+)?to|unless|if|when|provided|limited\s+to)\b|[$\d]/i;
/** A sentence that opens by narrowing what came before ("Only applies to ...", "Except for ...", "Applies to ..."). */
const OPENS_NARROWING = /^(?:note:\s*)?(?:only|except|excluding|unless|if|applies|applicable|does\s+not\s+apply|not\s+applicable|limited)\b/i;
/** A sentence that points back at the one before it ("This applies only to ...", "That waiver ..."). */
const BACK_REFERENCE = /^(?:note:\s*)?(?:this|that|it|these|those|such|the\s+above|the\s+foregoing|the\s+waiver)\b/i;
/** A notice that the practice may change ("If we change this practice ... we will provide you with advance notice") narrows nothing. */
const CHANGE_NOTICE = /\bchange\s+(?:this|our|the)\s+(?:practice|policy)\b.*\bnotice\b/i;

/**
 * True when the sentence after the statement, in its paragraph or the next one, narrows it: a sentence
 * that opens with a narrowing word ("Only applies to ...", "Except ..."), or a narrowing word or an
 * amount, in figures or words, in a sentence that points back at it or itself names NSF ("This applies
 * only to items under five dollars."). A
 * following note about another fee ("Note: We will not charge an overdraft fee on items that are $10
 * or less") and a change-of-practice notice do not.
 */
export function narrowsStatement(sentence: string): boolean {
  if (!sentence || CHANGE_NOTICE.test(sentence)) return false;
  const text = sentence.trim();
  if (OPENS_NARROWING.test(text)) return true;
  if (!NARROWING.test(text) && !SPELLED_AMOUNT.test(text)) return false;
  return BACK_REFERENCE.test(text) || namesNsfFamily(text);
}

/** A short line that can stand as a heading: few words, no table cell, not a clause cut by a comma. */
function headingLike(line: string): boolean {
  const text = line.trim();
  if (text.length < 2 || text.length > 80 || text.includes("|") || /[,;]$/.test(text)) return false;
  return /^[A-Z0-9(#]/.test(text) && text.split(/\s+/).length <= 10;
}

const ENDS_A_SENTENCE = /[.!?:]["”’)]?$/;
/** A line that stops on one of these words is a wrapped clause ("Reserve Line of Credit to pay an item, interest is"). */
const ENDS_MID_CLAUSE = /\b(?:a|an|the|to|of|and|or|is|are|be|for|with|in|on|by|at|from|your|our|we|you|if|that|this|which|will|may|not)$/i;

/**
 * A heading line: heading-like, not a clause cut at a line end, and standing after a blank line, a
 * sentence end or another heading-like line, so a wrapped line of prose ("Account.") is not one.
 */
function isHeading(lines: readonly string[], index: number): boolean {
  const text = lines[index].trim();
  if (!headingLike(text) || ENDS_MID_CLAUSE.test(text.replace(/[.:]$/, ""))) return false;
  const above = index > 0 ? lines[index - 1].trim() : "";
  return !above || ENDS_A_SENTENCE.test(above) || headingLike(above);
}

/**
 * A section heading: a heading in capitals ("BUSINESS ACCOUNTS", "VALUE CHECKING") or numbered or
 * lettered ("3. Business Accounts", "(iii) Returned Items.", "Section 4"). It opens a section however
 * far above the sentence it is.
 */
function isSectionHeading(lines: readonly string[], index: number): boolean {
  if (!isHeading(lines, index)) return false;
  const text = lines[index].trim();
  const letters = text.replace(/[^A-Za-z]/g, "");
  return (letters.length >= 3 && letters === letters.toUpperCase()) ||
    /^(?:\d+(?:\.\d+)*\.?|[A-Z]\.|\(?[ivxlc]+\)|\(?[a-z]\)|section\b|part\b|article\b)\s*/i.test(text);
}

const SCOPE_REACH_LINES = 40;
const PARAGRAPH_REACH_LINES = 6;
/** How many sentences right before the statement, in its paragraph, are read for scope words. */
const LEAD_IN_SENTENCES = 2;
const SENTENCE_END = /[.!?]["”’)]?(?=\s|$)/g;
const SENTENCE_START = /(?:^|[.!?]["”’)]?\s+)(?=\S)/g;
const SENTENCE_SPLIT = /(?<=[.!?]["”’)]?)\s+/;

/** The paragraph's lines above line `index`: up to a blank line or a heading, at most 6. */
function paragraphAbove(lines: readonly string[], index: number): { before: string[]; top: number } {
  const before: string[] = [];
  let top = index;
  for (let j = index - 1; j >= 0 && index - j <= PARAGRAPH_REACH_LINES; j -= 1) {
    if (!lines[j].trim() || isHeading(lines, j)) break;
    before.unshift(lines[j].trim());
    top = j;
  }
  return { before, top };
}

/**
 * The first sentence after the statement: the rest of its last line, then the lines below, across a
 * blank line into the next paragraph (at most three lines), stopping at a heading that ends no sentence.
 */
function sentenceAfter(lines: readonly string[], lastLine: number, tail: string): string {
  const parts = [tail.trim()];
  for (let j = lastLine + 1, read = 0; j < lines.length && read < 3; j += 1) {
    if (!lines[j].trim()) {
      if (parts.some(Boolean)) break;
      continue;
    }
    // A short sentence standing alone ("This applies only to items under five dollars.") reads like
    // a heading; only a line that ends no sentence stops the read.
    if (isHeading(lines, j) && !/[.!?]["”’)]?$/.test(lines[j].trim())) break;
    parts.push(lines[j].trim());
    read += 1;
  }
  return parts.filter(Boolean).join(" ").split(SENTENCE_SPLIT)[0] ?? "";
}

/**
 * The headings over the paragraph: every heading in the 40 lines above its first line, the nearest
 * section heading (`isSectionHeading`) wherever it is, so a "BUSINESS ACCOUNTS" heading 60 lines up
 * still scopes the sentence under it, and the nearest heading of any kind when none is within 40
 * lines. A plain heading beyond 40 lines under a nearer one is another section's (Wells Fargo's
 * "Mobile Banking" menu, 42 lines above its overdraft FAQ).
 */
function headingsAbove(lines: readonly string[], top: number): string[] {
  const headings: string[] = [];
  let section = false;
  for (let j = top - 1; j >= 0 && !(section && top - j > SCOPE_REACH_LINES && headings.length > 0); j -= 1) {
    if (!isHeading(lines, j)) continue;
    const near = top - j <= SCOPE_REACH_LINES;
    const sectionHeading = isSectionHeading(lines, j);
    if (near || (sectionHeading && !section) || headings.length === 0) headings.push(lines[j].trim());
    if (sectionHeading) section = true;
  }
  return headings;
}

/**
 * The sentence that starts at `start` on line `index`, joined across at most two wrapped lines to its
 * end, with what follows it on its last line; null when it does not end within them or runs into a
 * table row or a blank line.
 */
function wholeSentence(lines: readonly string[], index: number, start: number): { sentence: string; lastLine: number; tail: string } | null {
  let text = lines[index].slice(start);
  let last = index;
  let lastLineStart = 0;
  for (;;) {
    SENTENCE_END.lastIndex = 0;
    const end = SENTENCE_END.exec(text);
    if (end) {
      const cut = end.index + end[0].length;
      return { sentence: text.slice(0, cut), lastLine: last, tail: text.slice(Math.max(cut, lastLineStart)) };
    }
    const next = lines[last + 1];
    if (last - index >= 2 || next == null || !next.trim() || next.includes("|")) return null;
    text = `${text} `;
    lastLineStart = text.length;
    text = `${text}${next.trim()}`;
    last += 1;
  }
}

/**
 * NSF-family words: whatever the category guard files as NSF (`NSF_NAME_INCLUDE`, read from a word's start: "Unpaid Item Fee",
 * "Item returned unpaid", "Returned ACH", "Cargo por fondos insuficientes"), plus a dishonored,
 * bounced or bounce item.
 */
const NSF_EXTRA_WORDS = /\b(?:dishonou?red|bounced?|bouncing)\b/i;
let nsfWords: RegExp | null = null;
export function namesNsfFamily(text: string): boolean {
  // The guard reads one fee name, so its words have no leading word boundary; on a whole page "nsf"
  // must not match inside "transfer". Built on first use from the guard's own pattern.
  nsfWords ??= new RegExp(String.raw`\b(?:${NSF_NAME_INCLUDE.source})`, "i");
  return nsfWords.test(text) || NSF_EXTRA_WORDS.test(text);
}

/** A fee read as Knox holds it: its category hint, price and words. */
export interface NsfFamilyReadShape {
  canonicalHint: string | null;
  amount: number | null;
  percent?: number | null;
  feeName?: string | null;
  excerpt?: string | null;
}

/**
 * True when a read charges an NSF-family fee: above $0 (or a rate) and filed in the family
 * (`NSF_FAMILY_KEYS`, "nsf_daily_cap" included), named with NSF-family words whatever its category
 * ("Overdraft/NSF fee $35"), or held unclassified with NSF-family words on its line ("Item returned
 * unpaid | $35", no category). Such a read contradicts an NSF $0 from a sentence, on the same text or
 * another of the bank's documents.
 */
export function chargesNsfFamily(read: NsfFamilyReadShape): boolean {
  if (!((read.amount ?? 0) > 0 || (read.percent ?? 0) > 0)) return false;
  if (read.canonicalHint != null && NSF_FAMILY_KEYS.includes(read.canonicalHint)) return true;
  if (namesNsfFamily(read.feeName ?? "")) return true;
  return read.canonicalHint == null && namesNsfFamily(read.excerpt ?? "");
}

const DOLLARS = /\$\s*(\d[\d,]*(?:\.\d{1,2})?)/g;
const DECIMAL_PRICE = /\b(\d{1,3}\.\d{2})\b/g;
const TRAILING_FIGURE = /(?:^|[\s:).])(\d{1,3})\s*$/;
/** A bare figure with its unit after it: "NSF fee 35 each", "25 per item", "30 dollars". */
const FIGURE_WITH_UNIT = /\b(\d{1,3})\s*(?:each\b|per\b|\/\s*(?:item|check|presentment)|a[\s-]+(?:check|item|presentment)\b|dollars?\b|usd\b)/i;
const FEE_WORD = /\b(?:fees?|charges?|cargos?)\b/i;
/** A short label line, a table row's name cell flattened onto its own line ("NSF Fee", "Returned Item"). */
const LABEL_MAX_LENGTH = 60;
const PRICE_REACH_LINES = 2;
/** A line that opens with its price ("$35.00", "35.00 per item", "35 each", "Twenty-five dollars"). */
const PRICE_FIRST = new RegExp(String.raw`^\s*(?:\$\s*\d|\d{1,3}\.\d{2}\b|\d{1,3}\s*(?:each|per|\/|dollars?)\b|${NUMBER_WORD}\b)`, "i");

function positive(values: Iterable<RegExpMatchArray>): boolean {
  return [...values].some((match) => Number(match[1].replace(/,/g, "")) > 0);
}

/**
 * True when the line prints a price above $0: a dollar figure, a decimal price, a figure with its unit
 * ("35 each") or an amount in words ("twenty-five dollars") anywhere, or a bare figure at its end when
 * the line is a short row or names a fee ("Paid or returned item (NSF) 35"). A table of contents' page
 * number ("Overdraft and Returned Items ........ 22") names no fee and is long.
 */
function printsPrice(line: string): boolean {
  if (positive(line.matchAll(DOLLARS)) || positive(line.matchAll(DECIMAL_PRICE))) return true;
  const unit = FIGURE_WITH_UNIT.exec(line);
  if ((unit && Number(unit[1]) > 0) || SPELLED_AMOUNT.test(line)) return true;
  const figure = TRAILING_FIGURE.exec(line.trim());
  return figure != null && Number(figure[1]) > 0 && (line.trim().length <= LABEL_MAX_LENGTH || FEE_WORD.test(line));
}

/**
 * True when some line names an NSF-family fee (`namesNsfFamily`) with a price above $0: on the line
 * itself ("NSF Fee $35.00", "Unpaid Item Fee $35", "Dishonored check $25", "NSF fee 35 each"), or, for
 * a short label that ends no sentence ("NSF Fee", "Returned Item"), on one of the next two non-empty
 * lines that opens with its price ("$35.00 per item"). Read whether or not any reader reads it. A
 * sentence's next line, a heading's first row naming another fee, or a page number is not that line's
 * price.
 */
export function documentPricesNsf(lines: readonly string[]): boolean {
  return lines.some((line, index) => {
    if (!namesNsfFamily(line)) return false;
    if (printsPrice(line)) return true;
    const label = line.trim();
    if (label.length > LABEL_MAX_LENGTH || ENDS_A_SENTENCE.test(label)) return false;
    let seen = 0;
    for (let j = index + 1; j < lines.length && seen < PRICE_REACH_LINES; j += 1) {
      if (!lines[j].trim()) continue;
      seen += 1;
      if (PRICE_FIRST.test(lines[j]) && printsPrice(lines[j])) return true;
    }
    return false;
  });
}

/** Why a grammar match was refused, for the dry run and tests. */
export type NoChargeRefusal = "continues_line_above" | "scope" | "narrowed_after" | "document_prices_nsf";

export interface NoChargeNsfReading {
  statements: NoChargeNsfStatement[];
  refused: Array<{ sentence: string; line: number; reason: NoChargeRefusal }>;
}

/**
 * Every NSF no-charge sentence in a document, with the ones its surroundings refuse. Only `statements`
 * may stand as the fee's $0; the caller still checks the institution's other documents and reads.
 */
export function readNoChargeNsf(text: string): NoChargeNsfReading {
  const lines = text.split("\n");
  const statements: NoChargeNsfStatement[] = [];
  const refused: NoChargeNsfReading["refused"] = [];
  let priced: boolean | null = null;
  lines.forEach((line, index) => {
    if (line.includes("|") || !/\b(?:charge|assess|impose)\b/i.test(line)) return;
    for (const match of line.matchAll(SENTENCE_START)) {
      const start = match.index + match[0].length;
      const opening = line.slice(start).replace(/^[•·▪◦‣*–—-]+\s*/, "");
      if (!OPENING.test(opening)) continue;
      const whole = wholeSentence(lines, index, start);
      if (!whole) continue;
      const feeName = noChargeNsfSentence(whole.sentence);
      if (!feeName) continue;
      const sentence = tidy(whole.sentence);
      const prefix = line.slice(0, start).trim();
      // At the start of a line, the line above must be blank, end a sentence or be a heading: the
      // tail of "In your Easy Checking account," is not a sentence of its own.
      if (!prefix && index > 0) {
        const above = lines[index - 1].trim();
        if (above && !ENDS_A_SENTENCE.test(above) && !isHeading(lines, index - 1)) {
          refused.push({ sentence, line: index, reason: "continues_line_above" });
          continue;
        }
      }
      // Scope: the two sentences before it in its paragraph, the sentence itself, the one after it,
      // the headings in the 40 lines above and the nearest section heading, each read on its own.
      const paragraph = paragraphAbove(lines, index);
      const leadIn = [...paragraph.before, prefix].join(" ").split(SENTENCE_SPLIT).filter(Boolean).slice(-LEAD_IN_SENTENCES);
      const after = sentenceAfter(lines, whole.lastLine, whole.tail);
      if ([...leadIn, sentence, after, ...headingsAbove(lines, paragraph.top)].some(scopeWordIn)) {
        refused.push({ sentence, line: index, reason: "scope" });
        continue;
      }
      if (narrowsStatement(after)) {
        refused.push({ sentence, line: index, reason: "narrowed_after" });
        continue;
      }
      priced ??= documentPricesNsf(lines);
      if (priced) {
        refused.push({ sentence, line: index, reason: "document_prices_nsf" });
        continue;
      }
      statements.push({ canonicalKey: "nsf", feeName, sentence, line: index });
    }
  });
  return { statements, refused };
}

/**
 * The statement that makes this exact fee name $0 as NSF in the document, or null: the source check's
 * witness for a $0 with no free word. Only for `nsf`, and only while the switch is on (`live`). The
 * name is pinned: Knox files the name the sentence prints, untouched by its name tidy, and Knox's name
 * re-tidy skips any rename that would no longer trace (`would_not_trace`), so a renamed fee never loses
 * its witness silently.
 */
export function noChargeNsfWitness(
  text: string,
  feeName: string,
  canonicalFeeKey: string | null | undefined,
  live: boolean = NO_CHARGE_SENTENCE_READ_LIVE,
): NoChargeNsfStatement | null {
  if (!live || canonicalFeeKey !== "nsf") return null;
  const name = feeName.toLowerCase().replace(/\s+/g, " ").trim();
  return readNoChargeNsf(text).statements.find((statement) => statement.feeName.toLowerCase() === name) ?? null;
}
