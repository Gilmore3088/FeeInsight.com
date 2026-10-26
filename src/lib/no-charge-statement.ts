/**
 * #2040: a plain sentence saying the bank does not charge a named fee ("We do not charge a returned
 * item/non-sufficient funds (NSF) fee for items returned unpaid.", Wells Fargo doc 33356) states that
 * fee's price: $0. Knox read a "No Fee" table cell as the fee's $0 (`zero`), but dropped the sentence,
 * so the bank's NSF showed "Not published". Shared by Knox's rules (the read, v124) and the shared
 * source check (`checkFeeAgainstSource`, so Knox's self-check and Darwin trace the $0 to the sentence).
 * Pure: no database and no agent imports.
 *
 * Only a whole sentence of one grammar counts, so a waiver, a cap or a band is never read as $0:
 *
 *   <subject> <present negation> <charge verb> [you] [a|an|any] <the fee> [<allowed tail>].
 *
 * - subject: "We", "The bank", "The credit union". A sentence that opens with anything else ("In
 *   that case, we ...", "However, ...", "If this occurs ...", a product name such as "TD Essential
 *   Banking will not charge any overdraft fees") is a consequence of another sentence or one
 *   account's terms, not the bank's price.
 * - negation: "do not", "don't", "does not", "doesn't", "never", optionally "currently". Not "will
 *   not"/"won't": on these pages it states what happens in the scenario just described ("If we
 *   decline the transaction, ... We will not charge you an overdraft fee"). Not "no longer": prod
 *   holds no such unconditional sentence (Oct 26), and the read cannot see whether the copy it reads
 *   is the page's current one or when the change took effect.
 * - the fee is named explicitly, in one of three categories only (below), and the sentence ends
 *   right after it or after a tail that only restates what the fee is ("for items returned unpaid").
 *   Any other words ("if ...", "when ...", "on transactions under $5", "for the first ...", "more
 *   than 3 per day", "for one-time debit card or ATM transactions", "on Assure Checking accounts",
 *   a colon that opens a list of conditions) mean no read. An NSF name must carry an NSF word ("NSF",
 *   "non-sufficient funds", "insufficient funds"): "returned item" or "returned checks" alone is as
 *   often a returned deposited item.
 *
 * And the document must agree (`noChargeStatementsInText`, review of #2710):
 * - the heading right above the sentence (the nearest non-empty line, or the line's own first sentence
 *   when the statement is its second) is wholly a fee-topic heading of its category ("Overdraft Fees",
 *   "Nonsufficient Funds (NSF) Fees", "Overdraft Services", "Overdraft Transfer Fees"). Anything else,
 *   a product, account, service or brand word anywhere in it ("Bill Pay Service", "SafeBalance
 *   Banking", "Overdraft Protection for SafeBalance"), prose, or no heading at all, refuses it: which
 *   account a sentence speaks for cannot be read reliably otherwise, and accuracy beats recall;
 * - no line of the document names the fee's category with a price above $0 on it or on the next two
 *   non-empty lines, whether or not any reader reads it ("NSF Fee $35.00", "Paid or returned item
 *   (NSF) 35", "Overdraft Fee" / "$35"): a priced line and a "we do not charge" sentence on one page are
 *   two products' terms, never the bank's $0.
 *
 * Categories (`NO_CHARGE_CATEGORIES`): `nsf`, `overdraft` and `od_protection_transfer`. These are the
 * fees banks announce in prose that they have dropped (NSF since 2022, overdraft at a few banks,
 * overdraft protection transfers on overdraft pages), and the three the issue names. Other "we do not
 * charge for ..." sentences are mostly Reg E boilerplate ("we do not charge for electronic fund
 * transfers") whose object is not one fee, so they stay unread. A sentence naming both overdraft and
 * NSF ("overdraft or NSF fees") is not read: one name would file two categories, and prod (Oct 26) has
 * no such sentence without a condition.
 */

export const NO_CHARGE_CATEGORIES = ["nsf", "overdraft", "od_protection_transfer"] as const;
export type NoChargeCategory = (typeof NO_CHARGE_CATEGORIES)[number];

export interface NoChargeStatement {
  canonicalKey: NoChargeCategory;
  /** The fee's name as the sentence prints it ("Returned item/non-sufficient funds (NSF) fee"). */
  feeName: string;
  /** The whole sentence, as printed. */
  sentence: string;
  /** True when the sentence prints the fee's name itself ("a returned item/NSF fee"), not only what it is for. */
  namePrinted: boolean;
}

const SUBJECT = String.raw`(?:we|the\s+bank|the\s+credit\s+union)`;
const NEGATION = String.raw`(?:currently\s+)?(?:do\s+not|don['’]t|does\s+not|doesn['’]t|never)(?:\s+currently)?`;
const VERB = String.raw`(?:charge|assess|impose)`;
const OPENING = String.raw`^${SUBJECT}\s+${NEGATION}\s+${VERB}(?:\s+(?:you|members|customers))?`;
const ARTICLE = String.raw`(?:\s+(?:an?|any))?`;
const FEE_NOUN = String.raw`(?:fees?|charges?)`;
// The sentence must end on its own line: a line that stops mid-sentence ("We do not currently charge a
// Nonsufficient Funds (NSF) Fee" / "for returning an item unpaid.", Monet Bank) may go on to a condition.
const ENDING = String.raw`\s*[.!]$`;

// An NSF word: "returned item", "NSF", "non-sufficient funds", "insufficient funds", each with an
// optional "(NSF)" after it, joined by "/", "or", "and" or a space ("returned item/non-sufficient
// funds (NSF)", "NSF returned item"). The name must carry one of the last three (`NSF_CORE`).
const NSF_WORD = String.raw`(?:returned[\s-]+items?|nsf|non[\s-]?sufficient[\s-]+funds|insufficient[\s-]+funds)(?:\s*\(nsf\))?`;
const NSF_NAME = String.raw`${NSF_WORD}(?:(?:\s*\/\s*|\s+or\s+|\s+and\s+|\s+)${NSF_WORD})*\s+(?:items?\s+)?${FEE_NOUN}`;
const NSF_CORE = /\b(?:nsf|non[\s-]?sufficient|insufficient)\b/i;
// What an NSF fee is charged for, restated: "for items returned unpaid", "for items we return unpaid",
// "for returned items".
const NSF_TAIL = String.raw`(?:\s+(?:for|on)\s+(?:items|checks|payments|transactions)\s+(?:that\s+are\s+returned|we\s+return|returned)(?:\s+unpaid)?|\s+for\s+returned\s+(?:items|checks|payments|transactions))?`;
const OD_NAME = String.raw`(?:overdraft|od)(?:\s+(?:paid\s+)?items?)?\s+${FEE_NOUN}`;
const ODT_NAME = String.raw`overdraft\s+(?:protection\s+)?transfer\s+${FEE_NOUN}`;

interface Shape {
  key: NoChargeCategory;
  pattern: RegExp;
  /** The fee's name when the sentence names only what it is for; null when it prints the fee's name. */
  name: string | null;
}

// A fee + "for" + what it is for ("a fee for an NSF return", "a transfer fee for overdraft protection
// transfers", "for overdraft protection transfers").
const FOR_FEE = String.raw`(?:\s+(?:an?|any)\s+(?:transfer\s+)?(?:fee|charge)|\s+(?:transfer\s+)?(?:fees|charges))?\s+for\s+(?:using\s+)?(?:an?\s+|any\s+|our\s+|the\s+)?`;

const SHAPES: Shape[] = [
  { key: "od_protection_transfer", pattern: new RegExp(`${OPENING}${ARTICLE}\\s+(?<name>${ODT_NAME})${ENDING}`, "i"), name: null },
  { key: "nsf", pattern: new RegExp(`${OPENING}${ARTICLE}\\s+(?<name>${NSF_NAME})${NSF_TAIL}${ENDING}`, "i"), name: null },
  { key: "overdraft", pattern: new RegExp(`${OPENING}${ARTICLE}\\s+(?<name>${OD_NAME})${ENDING}`, "i"), name: null },
  {
    key: "od_protection_transfer",
    pattern: new RegExp(`${OPENING}${FOR_FEE}(?<name>overdraft\\s+(?:protection\\s+)?transfers?)(?:\\s+service)?${ENDING}`, "i"),
    name: "Overdraft transfer fee",
  },
  {
    key: "nsf",
    pattern: new RegExp(`${OPENING}${FOR_FEE}(?<name>(?:nsf|non[\\s-]?sufficient[\\s-]+funds|insufficient[\\s-]+funds)\\s+(?:returns?|items?|checks?))${ENDING}`, "i"),
    name: "NSF fee",
  },
  {
    key: "overdraft",
    pattern: new RegExp(`${OPENING}${FOR_FEE}(?<name>overdrafts|overdraft\\s+(?:items|transactions))${ENDING}`, "i"),
    name: "Overdraft fee",
  },
];

function tidyName(printed: string, key: NoChargeCategory, fixed: string | null): string {
  const words = printed.replace(/\s+/g, " ").trim();
  if (fixed) {
    // "an NSF return" → "NSF return fee"; "NSF items" → "NSF item fee".
    if (key === "nsf") return capitalise(`${words.replace(/\b(return|item|check)s$/i, "$1")} fee`);
    return fixed;
  }
  return capitalise(words.replace(/\b(fee|charge)s$/i, "$1"));
}

function capitalise(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** One sentence's statement, or null when the sentence is not exactly one of the shapes. */
export function noChargeStatement(sentence: string): NoChargeStatement | null {
  const text = sentence.replace(/^[\s•·▪◦‣*–—-]+/, "").replace(/\s+/g, " ").trim();
  // A figure anywhere is a band, a cap or a count; never an unconditional $0.
  if (!text || text.length > 200 || /\d|\$/.test(text)) return null;
  for (const shape of SHAPES) {
    const match = shape.pattern.exec(text);
    if (!match) continue;
    const printed = match.groups?.name ?? "";
    if (shape.key === "nsf" && !NSF_CORE.test(printed)) return null;
    return { canonicalKey: shape.key, feeName: tidyName(printed, shape.key, shape.name), sentence: text, namePrinted: shape.name === null };
  }
  return null;
}

const SENTENCE_END = /(?<=[.!?])\s+/;

/**
 * Every statement on one line of prose, read by the sentence alone: the line is cut at sentence ends
 * ("." "!" "?" and a space). A colon or a semicolon does not end a sentence, so "We do not charge an
 * overdraft item fee: ..." (a list of conditions follows) is never read. A table row is never read: its
 * label cell says whose terms the sentence states ("BILL PAY SERVICES NSF | We do not charge a fee when
 * we return an item unpaid ...", Fidelity Bank doc 23446, whose account NSF is $35 two rows up).
 * Callers that read a document use `noChargeStatementsInText`, which also reads its headings and prices.
 */
export function noChargeStatementsIn(line: string): NoChargeStatement[] {
  if (line.includes("|") || !/\b(?:do|does|don['’]t|doesn['’]t|never)\b/i.test(line)) return [];
  return line.split(SENTENCE_END).map(noChargeStatement).filter((statement): statement is NoChargeStatement => statement != null);
}

// The heading right above the sentence must be wholly one of these, for the sentence's category
// (review of #2710: a product, account, service or brand word anywhere in it refuses the sentence, and
// there is no general-heading or no-heading fall-through). Bullets, "#" and a trailing "." or ":" are
// ignored.
const NSF_TOPIC = String.raw`(?:nsf|(?:non[\s-]?sufficient|insufficient)\s+funds?(?:\s*\(nsf\))?)`;
const OD_TOPIC = String.raw`overdrafts?`;
const JOIN_TOPIC = String.raw`\s*(?:and|&|\/|or)\s*`;
const FEE_WORDS = String.raw`(?:\s+(?:fees?|charges?))?`;
const ALLOWED_HEADINGS: Record<NoChargeCategory, RegExp> = {
  nsf: new RegExp(String.raw`^(?:${NSF_TOPIC}(?:\s+(?:items?|returns?))?${FEE_WORDS}|${OD_TOPIC}${JOIN_TOPIC}${NSF_TOPIC}${FEE_WORDS}|${NSF_TOPIC}${JOIN_TOPIC}${OD_TOPIC}${FEE_WORDS}|overdraft\s+services)$`, "i"),
  overdraft: new RegExp(String.raw`^(?:${OD_TOPIC}${FEE_WORDS}|${OD_TOPIC}${JOIN_TOPIC}${NSF_TOPIC}${FEE_WORDS}|${NSF_TOPIC}${JOIN_TOPIC}${OD_TOPIC}${FEE_WORDS}|overdraft\s+services)$`, "i"),
  od_protection_transfer: new RegExp(String.raw`^(?:overdraft\s+(?:protection\s+)?transfers?${FEE_WORDS}|overdraft\s+protection${FEE_WORDS})$`, "i"),
};

/** True when the heading is wholly an allowed fee-topic heading of the category. */
export function topicHeading(heading: string, key: NoChargeCategory): boolean {
  const text = heading.replace(/^[#\s•·▪◦‣*–—-]+/, "").replace(/[.:\s]+$/, "").replace(/\s+/g, " ").trim();
  return text.length > 0 && ALLOWED_HEADINGS[key].test(text);
}

/**
 * The heading the sentence stands under: the nearest non-empty line above when the sentence opens its
 * line, the line's own first sentence when the statement is its second ("Nonsufficient Funds (NSF) Fees.
 * We do not currently charge NSF fees."), and none when more prose stands between them.
 */
function headingOver(lines: readonly string[], index: number, sentences: readonly string[], at: number): string | null {
  if (at === 1) return sentences[0];
  if (at > 1) return null;
  for (let j = index - 1; j >= 0; j -= 1) if (lines[j].trim()) return lines[j];
  return null;
}

// A line names the category by these (an overdraft price is not an NSF price).
const PRICED_TOPIC: Record<NoChargeCategory, RegExp> = {
  nsf: /\b(?:nsf|non[\s-]?sufficient|insufficient\s+funds?|returned[\s-]+(?:items?|checks?)|bounced?\s+checks?)\b/i,
  overdraft: /\b(?:overdrafts?|od|o\/d|courtesy\s+pay|bounce\s+protection|paid\s+items?)\b/i,
  od_protection_transfer: /\b(?:overdraft|od)\s+(?:protection\s+)?transfers?\b|\btransfers?\b[^.$]{0,40}\boverdraft\b|\boverdraft\b[^.$]{0,40}\btransfers?\b/i,
};
const DOLLARS = /\$\s*(\d[\d,]*(?:\.\d{1,2})?)/g;
const DECIMAL_PRICE = /\b(\d{1,3}\.\d{2})\b/g;
const TRAILING_FIGURE = /(?:^|[\s:)])(\d{1,3})\s*$/;
const LEADING_FIGURE = /^\s*(\d{1,3})(?:\s|$)/;
/** A price printed for a name on its own line or on one of this many non-empty lines below it. */
const PRICE_REACH_LINES = 2;

/** True when the line prints a figure above $0 that can be a price ("$35", "35.00", a lone "35"). */
function printsPrice(line: string): boolean {
  const values = [...line.matchAll(DOLLARS), ...line.matchAll(DECIMAL_PRICE)].map((match) => Number(match[1].replace(/,/g, "")));
  for (const figure of [TRAILING_FIGURE.exec(line), LEADING_FIGURE.exec(line)]) if (figure) values.push(Number(figure[1]));
  return values.some((value) => value > 0);
}

/**
 * True when some line of the document names the category with a price above $0 on it or on one of the
 * next two non-empty lines ("Overdraft Fee" / "$35"), read by any reader or not.
 */
export function documentPricesCategory(lines: readonly string[], key: NoChargeCategory): boolean {
  return lines.some((line, index) => {
    if (!PRICED_TOPIC[key].test(line)) return false;
    if (printsPrice(line)) return true;
    let seen = 0;
    for (let j = index + 1; j < lines.length && seen < PRICE_REACH_LINES; j += 1) {
      if (!lines[j].trim()) continue;
      seen += 1;
      if (printsPrice(lines[j])) return true;
    }
    return false;
  });
}

/**
 * Every statement in a document that the document lets stand as the fee's $0: the sentence's own
 * grammar (`noChargeStatementsIn`), right under a heading that is wholly the fee's topic
 * (`topicHeading`), and no line that prices the category (`documentPricesCategory`).
 */
export function noChargeStatementsInText(text: string): NoChargeStatement[] {
  const lines = text.split("\n");
  const statements: NoChargeStatement[] = [];
  const priced = new Map<NoChargeCategory, boolean>();
  lines.forEach((line, index) => {
    if (line.includes("|") || !/\b(?:do|does|don['’]t|doesn['’]t|never)\b/i.test(line)) return;
    const sentences = line.split(SENTENCE_END);
    sentences.forEach((sentence, at) => {
      const statement = noChargeStatement(sentence);
      if (!statement) return;
      const heading = headingOver(lines, index, sentences, at);
      if (heading == null || !topicHeading(heading, statement.canonicalKey)) return;
      if (!priced.has(statement.canonicalKey)) priced.set(statement.canonicalKey, documentPricesCategory(lines, statement.canonicalKey));
      if (priced.get(statement.canonicalKey)) return;
      statements.push(statement);
    });
  });
  return statements;
}

/**
 * The statement that makes this exact fee name, in this category, $0 in the document, or null. The
 * shared source check's witness for a $0 with no free word; a fee with no category has none.
 */
export function noChargeWitness(text: string, feeName: string, canonicalFeeKey: string | null | undefined): NoChargeStatement | null {
  const name = comparableName(feeName);
  if (!name || !canonicalFeeKey) return null;
  return noChargeStatementsInText(text).find((statement) =>
    comparableName(statement.feeName) === name && canonicalFeeKey === statement.canonicalKey) ?? null;
}

function comparableName(name: string): string {
  return name.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
}
