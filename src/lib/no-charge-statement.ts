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
 * almost nothing, because who a sentence speaks for sits in the prose and headings around it. This
 * version reads the sentence's surroundings instead, and refuses on any sign of a narrower scope:
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
 * 3. Scope (`scopeWordIn`): no product, account, audience, tier or service word in the sentence, the
 *    rest of its paragraph (before and after it), or any heading in the 40 lines above it ("Bill Pay
 *    Services", "Business Checking", "HSBC Premier", "Assure Checking", "for Business accounts").
 * 4. Document (`documentPricesNsf`): no line of the document names NSF, a returned item or a bounced
 *    check with a price above $0 on it or on the next two non-empty lines. A priced line and a "we do
 *    not charge" sentence on one page are two products' terms, never the bank's $0.
 *
 * The institution-wide check (another document of the bank prices NSF) is Knox's extract step's, which
 * holds such a read for review (`knox_no_charge_conflict`) rather than send it to Darwin.
 *
 * Only NSF: overdraft and overdraft transfer "no fee" sentences on prod (Oct 27) are mostly scoped to
 * one transaction type, a threshold or an account, and Darwin's $0 overdraft work (#1882) owns those.
 */

/** The switch, off: on, Knox reads these sentences as NSF $0 and the source check accepts them. */
export const NO_CHARGE_SENTENCE_READ_LIVE = false;

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
 * bank's own price: "Bill Pay Services", "Business accounts", "HSBC Premier", "student", a card
 * program or a loan. A capitalised name before "Checking", "Savings", "Account" or "Banking" ("Easy
 * Checking", "Assure Checking Accounts") is a named product too. "BankOn" names a certified account;
 * "Bank on the go" does not.
 */
const SCOPE_WORDS = /\b(?:business(?:es)?|commercial|corporate|bill\s*pay(?:ments?)?|premier|preferred|private\s+(?:bank|client)|elite|platinum|signature|student|youth|teen|minor|senior|second\s+chance|basic\s+banking|safe\s*balance|clear\s+access|prepaid|payroll|gift\s+card|loans?|mortgage|heloc|line\s+of\s+credit|credit\s+card|treasury|cash\s+management|sweep|trust|ira|health\s+savings|hsa)\b/i;
const BANK_ON = /\bBank ?On\b/;
const NAMED_PRODUCT = /\b(?!(?:The|Your|Our|This|That|These|Each|Any|All|An?|My|Every|Consumer|Personal|Deposit|Checking|Savings|Individual|Joint)\b)[A-Z][A-Za-z0-9®™&'’.-]+[ \t]+(?:Checking|Savings|Accounts?|Banking)\b/;

/** True when the text names a narrower scope than the bank's own price. */
export function scopeWordIn(text: string): boolean {
  return SCOPE_WORDS.test(text) || BANK_ON.test(text) || NAMED_PRODUCT.test(text);
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

/** The first sentence after the statement in its paragraph: the rest of its last line, then up to two lines. */
function sentenceAfter(lines: readonly string[], lastLine: number, tail: string): string {
  const parts = [tail.trim()];
  for (let j = lastLine + 1; j < lines.length && j - lastLine <= 2; j += 1) {
    if (!lines[j].trim() || isHeading(lines, j)) break;
    parts.push(lines[j].trim());
  }
  return parts.filter(Boolean).join(" ").split(SENTENCE_SPLIT)[0] ?? "";
}

/** Every heading in the 40 lines above the paragraph's first line. */
function headingsAbove(lines: readonly string[], top: number): string[] {
  const headings: string[] = [];
  for (let j = top - 1; j >= 0 && top - j <= SCOPE_REACH_LINES; j -= 1) if (isHeading(lines, j)) headings.push(lines[j].trim());
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

const PRICED_NSF = /\b(?:nsf|non[\s-]?sufficient|insufficient\s+funds?|returned[\s-]+(?:items?|checks?)|bounced?\s+checks?)\b/i;
const DOLLARS = /\$\s*(\d[\d,]*(?:\.\d{1,2})?)/g;
const DECIMAL_PRICE = /\b(\d{1,3}\.\d{2})\b/g;
const TRAILING_FIGURE = /(?:^|[\s:).])(\d{1,3})\s*$/;
const FEE_WORD = /\b(?:fees?|charges?)\b/i;
/** A short label line, a table row's name cell flattened onto its own line ("NSF Fee", "Returned Item"). */
const LABEL_MAX_LENGTH = 60;
const PRICE_REACH_LINES = 2;
/** A line that opens with its price ("$35.00", "35.00 per item"). */
const PRICE_FIRST = /^\s*(?:\$\s*\d|\d{1,3}\.\d{2}\b)/;

function positive(values: Iterable<RegExpMatchArray>): boolean {
  return [...values].some((match) => Number(match[1].replace(/,/g, "")) > 0);
}

/**
 * True when the line prints a price above $0: a dollar figure or a decimal price anywhere, or a bare
 * figure at its end when the line is a short row or names a fee ("Paid or returned item (NSF) 35").
 * A table of contents' page number ("Overdraft and Returned Items ........ 22") names no fee and is long.
 */
function printsPrice(line: string): boolean {
  if (positive(line.matchAll(DOLLARS)) || positive(line.matchAll(DECIMAL_PRICE))) return true;
  const figure = TRAILING_FIGURE.exec(line.trim());
  return figure != null && Number(figure[1]) > 0 && (line.trim().length <= LABEL_MAX_LENGTH || FEE_WORD.test(line));
}

/**
 * True when some line names NSF, a returned item or a bounced check with a price above $0: on the line
 * itself ("NSF Fee $35.00", "Overdraft/NSF fee ..... $35", "Paid or returned item (NSF) 35"), or, for a
 * short label that ends no sentence ("NSF Fee", "Returned Item"), on one of the next two non-empty lines
 * that opens with its price ("$35.00 per item"). Read whether or not any reader reads it. A sentence's
 * next line, a heading's first row naming another fee, or a page number is not that line's price.
 */
export function documentPricesNsf(lines: readonly string[]): boolean {
  return lines.some((line, index) => {
    if (!PRICED_NSF.test(line)) return false;
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
export type NoChargeRefusal = "continues_line_above" | "scope" | "document_prices_nsf";

export interface NoChargeNsfReading {
  statements: NoChargeNsfStatement[];
  refused: Array<{ sentence: string; line: number; reason: NoChargeRefusal }>;
}

/**
 * Every NSF no-charge sentence in a document, with the ones its surroundings refuse. Only `statements`
 * may stand as the fee's $0; the caller still checks the institution's other documents.
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
      // and every heading in the 40 lines above, each read on its own.
      const paragraph = paragraphAbove(lines, index);
      const leadIn = [...paragraph.before, prefix].join(" ").split(SENTENCE_SPLIT).filter(Boolean).slice(-LEAD_IN_SENTENCES);
      const after = sentenceAfter(lines, whole.lastLine, whole.tail);
      if ([...leadIn, sentence, after, ...headingsAbove(lines, paragraph.top)].some(scopeWordIn)) {
        refused.push({ sentence, line: index, reason: "scope" });
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
 * witness for a $0 with no free word. Only for `nsf`, and only while the switch is on (`live`).
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
