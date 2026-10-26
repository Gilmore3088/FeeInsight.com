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
 *   a colon that opens a list of conditions) mean no read.
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
// funds (NSF)", "NSF returned item").
const NSF_WORD = String.raw`(?:returned[\s-]+items?|nsf|non[\s-]?sufficient[\s-]+funds|insufficient[\s-]+funds)(?:\s*\(nsf\))?`;
const NSF_NAME = String.raw`${NSF_WORD}(?:(?:\s*\/\s*|\s+or\s+|\s+and\s+|\s+)${NSF_WORD})*\s+(?:items?\s+)?${FEE_NOUN}`;
// What an NSF fee is charged for, restated: "for items returned unpaid", "for items we return unpaid",
// "for returned items".
const NSF_TAIL = String.raw`(?:\s+(?:for|on)\s+(?:items|checks|payments|transactions)\s+(?:that\s+are\s+returned|we\s+return|returned)(?:\s+unpaid)?|\s+for\s+returned\s+(?:items|checks|payments|transactions))?`;
const OD_NAME = String.raw`(?:overdraft|od)(?:\s+(?:paid\s+)?items?)?\s+${FEE_NOUN}`;
const ODT_NAME = String.raw`overdraft\s+(?:protection\s+)?transfer\s+${FEE_NOUN}`;

interface Shape {
  key: NoChargeCategory;
  pattern: RegExp;
  /** The fee's name: the named group when the sentence prints one, else this fixed name. */
  name: string | null;
}

// A fee + "for" + what it is for ("a fee for an NSF return", "a transfer fee for overdraft protection
// transfers", "for overdraft protection transfers", "fees for returned items or declined transactions").
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
    pattern: new RegExp(`${OPENING}${FOR_FEE}(?:(?<name>(?:nsf|non[\\s-]?sufficient[\\s-]+funds|insufficient[\\s-]+funds)\\s+(?:returns?|items?|checks?))|declined\\s+or\\s+returned\\s+(?:items|transactions)|returned\\s+(?:items|checks)(?:\\s+or\\s+declined\\s+transactions)?)${ENDING}`, "i"),
    name: "Returned item fee",
  },
  {
    key: "overdraft",
    pattern: new RegExp(`${OPENING}${FOR_FEE}(?<name>overdrafts|overdraft\\s+(?:items|transactions))${ENDING}`, "i"),
    name: "Overdraft fee",
  },
];

function tidyName(printed: string, key: NoChargeCategory, fixed: string | null): string {
  const words = printed.replace(/\s+/g, " ").trim();
  if (fixed && !/\b(?:fees?|charges?)$/i.test(words)) {
    // "an NSF return" → "NSF return fee"; "insufficient funds" → "Insufficient funds fee".
    const own = words.replace(/^(?:an?|any|our|the)\s+/i, "");
    if (key === "nsf" && /\b(?:nsf|sufficient)\b/i.test(own)) return capitalise(`${own} fee`);
    return fixed;
  }
  if (!fixed && !/\b(?:fees?|charges?)$/i.test(words)) return capitalise(`${words} fee`);
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
    return { canonicalKey: shape.key, feeName: tidyName(printed || (shape.name ?? ""), shape.key, shape.name), sentence: text,
      namePrinted: shape.name === null };
  }
  return null;
}

/**
 * Every statement on one line of prose: the line is cut at sentence ends ("." "!" "?" and a space). A
 * colon or a semicolon does not end a sentence, so "We do not charge an overdraft item fee: ..." (a
 * list of conditions follows) is never read. A table row is never read: its label cell says whose
 * terms the sentence states ("BILL PAY SERVICES NSF | We do not charge a fee when we return an item
 * unpaid ...", Fidelity Bank doc 23446, whose account NSF is $35 two rows up).
 */
export function noChargeStatementsIn(line: string): NoChargeStatement[] {
  if (line.includes("|") || !/\b(?:do|does|don['’]t|doesn['’]t|never)\b/i.test(line)) return [];
  const statements: NoChargeStatement[] = [];
  for (const sentence of line.split(/(?<=[.!?])\s+/)) {
    const statement = noChargeStatement(sentence);
    if (statement) statements.push(statement);
  }
  return statements;
}

/** True when the line states, in one such sentence, that this exact fee name costs nothing. */
export function statesNoChargeFor(line: string, feeName: string): boolean {
  const name = comparableName(feeName);
  return name.length > 0 && noChargeStatementsIn(line).some((statement) => comparableName(statement.feeName) === name);
}

function comparableName(name: string): string {
  return name.toLowerCase().replace(/[’]/g, "'").replace(/\s+/g, " ").trim();
}
