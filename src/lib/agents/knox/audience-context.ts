/**
 * Knox's audience suggestion from the fee's context (#1059): the document's address and title,
 * a heading for all accounts, or a general schedule with no business wording. A heading naming
 * one audience still blocks the defaults below it, but no longer decides on its own where the
 * schedule also prices business items.
 * Pure; no model call. Knox suggests, Darwin decides (DECISIONS, 2026-10-12 and 2026-10-13): this
 * returns evidence for Darwin, never a published label on its own.
 */

export type ContextAudience = "consumer" | "business" | "both";
export type AudienceSource =
  | "fee_name"
  | "fee_price_cell"
  | "document_url"
  | "document_title"
  | "section_heading"
  | "schedule_section_title"
  | "default_general_schedule"
  | "mixed_schedule_unqualified";

export interface AudienceSuggestion {
  audience: ContextAudience;
  source: AudienceSource;
  /** The words that decided it: the address, the title line or the heading. */
  evidence: string;
}

/**
 * "Agribusiness" (a farm account page, minnstarbank.com/agribusiness/ag-savings, #1059 gate (a)) is
 * business too: `\bbusiness` never matched inside it, so its fees took the consumer default.
 */
const BUSINESS_WORDS = /\b(?:business(?:es)?|agri-?business(?:es)?|commercial|corporate|treasury management|merchant services)\b/i;
const CONSUMER_WORDS = /\b(?:personal|consumer|individuals?)\b/i;
/** "Personal and business", "consumer or commercial", "Personal & Small Business": both audiences, so no single suggestion. */
const BOTH_WORDS = /\b(?:personal|consumer)\b[^.\n]{0,20}(?:\band\b|\bor\b|&|\/)\s*(?:small\s+)?(?:business|commercial)\b|\b(?:business|commercial)\b[^.\n]{0,20}(?:\band\b|\bor\b|&|\/)\s*(?:personal|consumer)\b/i;
/** A heading is a short line with no price: a section title, not a fee row. */
const MAX_HEADING_CHARS = 80;
/** How far above the fee's line a heading is looked for. */
const HEADING_LOOKBACK_LINES = 60;
const TITLE_CHARS = 300;

/**
 * Words that name a product or a time, not who the fee is for: a corporate (official) check or
 * draft in any spelling a credit union prints ("Corporate/Cashiers Check Fee", "Corporate Bank
 * Check", "Corporate -Bank/Teller Check", "Corporate Share Draft", "on-us or Corporate", the
 * Corporate One correspondent; #1059 spot check, 86052 and 37392), a "Corporate Treasurer's
 * Check", a bare "Corporate Money Order" and the en-dash form ("Corporate – Bank Check"), while a
 * corporate account or checking name still reads as business: "Corporate Checking Monthly Fee",
 * "Corporate Share Draft Account", "Member/Corporate Account Fee" (a reversed join counts only
 * next to a check or draft: "Member/Corporate Check", "Check Copy – Personal or Corporate",
 * "Check (Personal/Corporate) Duplicate"), "Corporate One Card" and "Corporate one-time setup fee"
 * (review of #1382); a personal check, a business day, "close of business", a vendor's "Business Systems",
 * "non-business" or "non commercial" (a URL path's hyphens become spaces) with any slash before it,
 * and "non-personal checks" or "non-consumer information" (products, as main read them).
 * Also products, not audiences (#1626): a personal money order, draft or share draft (not a
 * "Personal Draft Account"), a "personal appearance" in a subpoena, the personal checks a counter
 * check page holds ("Counter Check: A blank page of 3 personal"), and corporate ACH next to checks
 * ("Stop Payment for checks and Corporate ACH"), a list of check kinds ("Personal, Cashier's or Bill
 * Pay checks"), and a business day cut off at the end of a clause ("as of the last business:").
 */
const NOT_AN_AUDIENCE = /(?:\/\s*)?\bnon[- ]?(?:personal|consumer)\s+(?:checks?|identification|information|data)\b|\bcorporate(?:(?:\s*[/&\-–—]\s*|\s+(?:or|and)\s+)(?:cashier[’']?s?|official|teller[’']?s?|treasurer[’']?s?|bank|member|personal|money\s+orders?))*\s+(?:(?:bank|official|teller|cashier[’']?s?|treasurer[’']?s?|share)\s+)?(?:checks?|drafts?)\b(?!\s+accounts?\b)|\bcorporate\s+money\s+orders?\b(?!\s+accounts?\b)|\bcorporate\s+(?:bonds?|securities|and municipal|one\b(?![-‐–’'])(?!\s+cards?\b)|stop\s+payments?\b)|\b(?:on[- ]us|teller[’']?s?|cashier[’']?s?|treasurer[’']?s?|official)\s*(?:[/&]|\bor\b|\band\b)\s*corporate\b(?:\s+(?:checks?|drafts?)\b)?|\b(?:personal|member)\s*(?:[/&]|\bor\b|\band\b)\s*corporate\s+(?:(?:share\s+)?(?:checks?|drafts?))\b(?!\s+accounts?\b)|(?<=\b(?:checks?|drafts?)\b[^|\n$]{0,15})\b(?:personal|member)\s*(?:[/&]|\bor\b|\band\b)\s*corporate\b|\bpersonal\s+(?:(?:checks?|identification|information|appearances?)\b|(?:share\s+)?drafts?\b(?!\s+accounts?\b)|money\s+orders?\b(?!\s+accounts?\b))|(?<=\bcounter\s+checks?\b[^|\n]{0,40})\bpersonal\b|\bpersonal(?=(?:\s*(?:,|\/|\bor\b|\band\b)\s*(?!(?:small\s+)?(?:business|commercial|corporate)\b)[\w’']+(?:\s+(?!(?:business|commercial|corporate)\b)[\w’']+)?){1,3}\s+checks?\b)|\b(?:last|next|same|following|previous|prior|each|every|one|two|three|four|five|ten)\s+business\b(?=\s*(?:[:;,.)]|$))|(?<=\bchecks?\b[^|\n]{0,20})\bcorporate\s+ach\b|\bbusiness\s+(?:days?|hours?|systems)\b|\b(?:close of|regular|normal|legitimate|conduct(?:ing)?|doing)\s+business\b|\bcredit union business(?: only)?\b(?!\s+(?:accounts?|checking|savings|banking|membership|visa|services|loans?|cards?|mobile|online)\b)|\bsmall business saturday\b|(?:\/\s*)?\bnon[- ]?(?:commercial|business)\b|\b(?:commercial|business|consumer|personal)(?:\s+(?:state|national|federal|savings|community|county|city|first))*\s+(?:bank|savings bank|credit union|trust company|savings and loan)\b/gi;
/**
 * "Non-Personal Accounts" and "Non-Consumer" are a bank's words for business accounts: read as
 * "business", with any slash before them ("Business/Non-Personal Accounts" stays a heading).
 * Stripping them as no audience let such fees take the consumer default (#1059 holdout 5).
 * "Non-personal checks", "identification", "information" and "data" are products, not accounts
 * (check cashing for a consumer), so they stay no audience (review of d31c9248).
 */
const NON_PERSONAL = /(?:\/\s*)?\bnon[- ]?(?:personal|consumer)\b(?!\s+(?:checks?|identification|information|data)\b)/gi;
/**
 * Prose that names no audience (#1059 unknown review, 2026-10-16): a change notice's sign-off ("We
 * appreciate your continued business", "thank you for your business"; Merchants Commercial 16221),
 * a "business days" wrapped after its number ("after 2 business" / "days"; document 24481) and "each
 * individual check" (a check, not a person). "Your business account" still reads as business.
 */
const NOT_AN_AUDIENCE_PROSE =
  /\b(?:your|continued|appreciate|thank you for)\s+(?:continued\s+)?business\b(?!\s+(?:accounts?|checking|savings|banking|customers?|clients?|members?|loans?|cards?|debit|credit|online|deposits?|money market|services|products|fees?)\b)|\b\d+\s+business\s*$|\bindividual\s+checks?\b/gim;
const neutral = (text: string) =>
  text.replace(NON_PERSONAL, " business").replace(NOT_AN_AUDIENCE, " ").replace(NOT_AN_AUDIENCE_PROSE, " ");

function audienceOf(raw: string): ContextAudience | null {
  const text = neutral(raw);
  if (BOTH_WORDS.test(text)) return null;
  const business = BUSINESS_WORDS.test(text);
  const consumer = CONSUMER_WORDS.test(text);
  if (business && !consumer) return "business";
  if (consumer && !business) return "consumer";
  return null;
}

/** Menu items, links, sign-in prompts, bank names and "business days" name no audience. */
const NOT_A_SECTION = /\[|\]\(|https?:|www\.|sign[ -]?in|log[ -]?in|enroll|apply now|business (?:days?|hours?)|\bN\.?A\.?\b|\bmenu\b/i;
/**
 * A section heading names an audience with what the section holds ("Consumer Fees", "BUSINESS
 * ACCOUNTS", "Personal Checking", "Fees for Business Customers"), not a lone word from a menu.
 */
const SECTION_HEADING = new RegExp(
  String.raw`\b(?:personal|consumer|individual|business|commercial)\s+(?:(?:deposit|checking|savings|banking|account|share|fee)s?\s+)?(?:accounts?|banking|checking|savings|fees?|fee schedule|services|products|deposit accounts|share accounts|members?|customers?)\b|\bfor\s+(?:personal|consumer|business|commercial)\s+(?:accounts?|customers?|members?|clients?)\b`,
  "i",
);
/** A title naming a schedule, never a fee row: no "service charge" (#1687). */
const SECTION_SCHEDULE_TITLE = /\b(?:fee schedule|schedule of (?:fees|charges)|fees and charges|fee disclosure)\b/i;
/** A title names the schedule itself ("Consumer Fee Schedule", "Business Schedule of Fees"). */
const SCHEDULE_TITLE = /\b(?:fee schedule|schedule of (?:fees|charges)|fees and charges|service charges?|fee disclosure)\b/i;
/**
 * A heading for fees every account pays ("Other Service Fees", "OTHER SERVICES", "Miscellaneous
 * Fees", "General Fees", "Additional Services", "Common Fee Schedule"). With a schedule's own title
 * that names no audience, it ends the climb for a heading (#1059 unknown review, F1B).
 */
const NEUTRAL_SECTION = /^\s*(?:other|miscellaneous|general|additional|common)\b/i;
/** A bullet ("• Basic Business Checking", "- Free incoming wires") lists an item, never a heading (F5). */
const BULLET = /^[•▪●◦*-]\s/;

/**
 * A short line with no price. A table row ("Xplore Spend Account* | Xplore Business Savings")
 * holds columns, not a section, so it never heads a fee; `columns` lets a column header still show
 * that the document has a business column.
 */
function isHeading(line: string, columns = false): boolean {
  const trimmed = line.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= (columns ? MAX_FEE_ROW_CHARS : MAX_HEADING_CHARS) &&
    // A sentence ("For business accounts, see the Business Fee Schedule.", "Not for business
    // accounts.") points elsewhere; it heads nothing (review of 153ca285).
    !isSentence(trimmed) &&
    (columns || !trimmed.includes("|")) &&
    !/\$\s*\d/.test(trimmed) &&
    !/\d+\.\d{2}\b/.test(trimmed) &&
    !NOT_A_SECTION.test(trimmed)
  );
}

const squash = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The index of the fee's own line: the first line naming it (its first words) at its price. */
export function feeLineIndex(lines: string[], feeName: string, amount: number | null): number {
  const full = squash(feeName).split(" ").slice(0, 4).join(" ");
  // "Stop Payment Fee" is printed "Stop Payment $30": a trailing fee word is tried off only when
  // the full name finds no line, and names match as whole words (never "nsf" in "transfer").
  const stripped = squash(feeName).replace(/(?: (?:service )?(?:fees?|charges?))+$/, "").split(" ").slice(0, 4).join(" ");
  const price = amount == null ? null : priceToken(amount);
  const names = [full, stripped].filter((name, index, all) => name && all.indexOf(name) === index);
  const named = (index: number) => names.find((name) => ` ${squash(lines[index])} `.includes(` ${name} `));
  // A line at the fee's price, under either name, beats a line that only names it ("Stop payment
  // fee waived for Premier Business Checking"; review of 8dd7af67). The next line's price counts
  // only when the name line has none of its own, so a fee never takes the row below's price.
  const priced = (index: number) =>
    price == null || price.test(lines[index]) || (!PRICED.test(lines[index]) && price.test(nextLine(lines, index) ?? ""));
  for (const name of names) {
    for (let index = 0; index < lines.length; index += 1) {
      if (` ${squash(lines[index])} `.includes(` ${name} `) && priced(index)) return index;
    }
  }
  for (let index = 0; index < lines.length; index += 1) if (named(index)) return index;
  return groupRowIndex(lines, feeName, priced, price != null);
}

/** How far below its group heading a row is looked for. */
const GROUP_ROW_REACH_LINES = 8;

/**
 * A name Knox built from a group heading and its row ("Wire Transfers: Incoming", printed as
 * "Wire Transfers" over "Incoming | $10.00") is found as the row at its price within a few lines
 * under the heading. Only with a price, and only for a row of at least one real word, so a bare
 * "Fees" or "1" never matches (#1059 gate (a): about 15% of the dry run's unknowns were such
 * names whose line was not found).
 */
function groupRowIndex(lines: string[], feeName: string, priced: (index: number) => boolean, hasPrice: boolean): number {
  const cut = feeName.lastIndexOf(":");
  if (!hasPrice || cut <= 0) return -1;
  const head = squash(feeName.slice(0, cut)).split(" ").slice(0, 4).join(" ");
  const row = squash(feeName.slice(cut + 1)).split(" ").slice(0, 4).join(" ");
  if (!head || !row || !/[a-z]{4,}/.test(row)) return -1;
  for (let index = 0; index < lines.length; index += 1) {
    if (!` ${squash(lines[index])} `.includes(` ${head} `)) continue;
    for (let below = index; below < Math.min(lines.length, index + GROUP_ROW_REACH_LINES); below += 1) {
      if (` ${squash(lines[below])} `.includes(` ${row} `) && priced(below)) return below;
      // The next group's heading ("Collection Items" under "Wire Transfers") ends this group; a row
      // label whose price is on the line below ("Incoming" / "$10.00") does not.
      if (below > index && isHeading(lines[below]) && !overAPrice(lines, below)) break;
    }
  }
  return -1;
}

/**
 * The fee's price as a whole token: "$5", "$ 5.00" or "5.00", never the 5 inside "$35" or the 0
 * inside "$10" (review of 88e9dc21), nor a bare page number on a contents line ("........ 5").
 */
function priceToken(amount: number): RegExp {
  const whole = Number.isInteger(amount);
  const [units, fraction] = amount.toFixed(2).split(".");
  // Thousands may be written with a separator ("$1,000").
  const grouped = units.replace(/\B(?=(\d{3})+(?!\d))/g, ",").replace(/,/g, ",?");
  const digits = whole ? grouped : `${grouped}\\.${fraction}`;
  const cents = whole ? `${digits}(?:\\.00)?` : digits;
  return new RegExp(String.raw`(?<![\d.,])\$\s*${cents}(?![\d.,]*\d)|(?<![\d.,$])${whole ? `${digits}\\.00` : digits}(?![\d])`);
}

/** The next non-empty line within two lines, or null. */
function nextLine(lines: string[], index: number): string | null {
  for (let below = index + 1; below < Math.min(lines.length, index + 3); below += 1) {
    if (lines[below].trim()) return lines[below];
  }
  return null;
}

/**
 * A line that starts with a price ("$10.00", "$15.00 monthly maintenance", "25.00 per item", "Free",
 * "Waived", "Monthly $10.00").
 */
const STARTS_WITH_PRICE = /^\s*(?:(?:monthly|per\s+(?:month|item)|each)\s*:?\s*)?(?:\$\s*\d|\d[\d,]*\.\d{2}\b|(?:free|no charge|n\/c|waived|none|n\/a)\b)/i;
/**
 * A line written as a sentence: end punctuation, or a word that points elsewhere, excludes or
 * links a clause ("see", "refer", "disclosed separately", "not", "are", "have"). One trailing
 * period or colon on a line set like a heading is the heading's own punctuation (reviews of
 * bac3d3db and 33d74156).
 */
const SENTENCE = /[.!?;:]\s*$|\b(?:see|refer|please|request|disclosed|separate(?:ly)?|not|contact|ask|call|visit|are|is|have|has)\b/i;
/** Set like a heading: all capitals, or every word of four or more letters capitalized. */
function headingCase(line: string): boolean {
  const words = line.match(/[A-Za-z]{4,}/g) ?? [];
  return !/[a-z]/.test(line) || (words.length > 0 && words.every((word) => /^[A-Z]/.test(word)));
}
/** A line that points elsewhere or excludes ("see", "listed in our Business Fee Schedule", "their own fee schedule", "Not for business accounts."). */
const POINTER = /\b(?:see|refer|please|request|listed|available|disclosed|separate(?:ly)?|contact|ask|call|visit|own|different|elsewhere|not)\b/i;
/** Words that point down to the fees that follow ("The fees listed below apply to business accounts."). */
const POINTS_DOWN = /\b(?:below|following|only|these|this section)\b/i;
function isPointer(line: string): boolean {
  // A line that points down introduces the section under it, whatever else it says (review of f125b445).
  return POINTER.test(line) && !POINTS_DOWN.test(line);
}
function isSentence(line: string): boolean {
  const trimmed = line.trim();
  // A line ending in a colon introduces what follows ("Business accounts:", "BUSINESS ACCOUNTS ARE
  // SUBJECT TO THE FOLLOWING FEES:") unless it points elsewhere (review of a5bc3ec1).
  if (/:\s*$/.test(trimmed) && !isPointer(trimmed)) return false;
  // A heading's own trailing period ("BUSINESS ACCOUNTS.") is dropped; a prose line keeps its
  // period and stays a sentence (review of 33d74156).
  return SENTENCE.test(headingCase(trimmed) ? trimmed.replace(/[.:]\s*$/, "") : trimmed);
}
/** Whether the line sits directly above a line that starts with a price. */
function overAPrice(lines: string[], index: number): boolean {
  return STARTS_WITH_PRICE.test(nextLine(lines, index) ?? "");
}

/** A heading that lists its fees for every account ("Other Service Fees (apply to all accounts)"). */
const ALL_ACCOUNTS = /\b(?:apply|applies)\s+to\s+all\s+accounts\b|\ball\s+accounts\b/i;

/**
 * The nearest heading above the fee's line that names one audience. Two outcomes end the search
 * without one: a heading for all accounts (the fee is for both), and a column header whose cells
 * name different audiences ("CONSUMER CHECKING ACCOUNTS | BUSINESS ACCOUNTS"), since the fee sits
 * in one column and the text does not say which (`columns`). A parenthetical line ("(Personal
 * Accounts)") qualifies the one fee it sits in, not the fees below it.
 */
export function sectionHeadingAudience(
  lines: string[],
  feeIndex: number,
): { audience: ContextAudience; heading: string } | { columns: string } | { ambiguous: string; sentence?: ContextAudience; sentenceIndex?: number } | null {
  let sentenceAudience: ContextAudience | null = null;
  let sentenceIndex = -1;
  let sentenceMayHead = false;
  for (let index = feeIndex - 1; index >= 0 && index >= feeIndex - HEADING_LOOKBACK_LINES; index -= 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed.includes("|") && trimmed.length <= MAX_COLUMN_HEADER_CHARS && !PRICED.test(trimmed)) {
      const cells = trimmed.split("|").map((cell) => audienceOf(cell)).filter(Boolean);
      if (new Set(cells).size > 1) return { columns: trimmed };
      continue;
    }
    // A sentence that names an audience ("Business Accounts (not including non-profits)", "For
    // business accounts, see the Business Fee Schedule.") may head a section or point elsewhere.
    // The search goes on, but a heading further up that names another audience leaves the fee
    // unknown rather than take either (review of bac3d3db).
    if (trimmed.length <= MAX_FEE_ROW_CHARS && !PRICED.test(trimmed) && isSentence(trimmed)) {
      const named = audienceOf(line);
      if (named) {
        if (!sentenceAudience) {
          sentenceAudience = named;
          sentenceIndex = index;
        }
        // A sentence that does not point elsewhere may head the fees below it.
        if (!isPointer(trimmed)) sentenceMayHead = true;
      }
      continue;
    }
    if (!isHeading(line) || trimmed.startsWith("(") || BULLET.test(trimmed)) continue;
    // Any line that names an audience directly above a price line could head a section ("Business
    // Fees" / "$35.00 Stop Payment") or be a fee priced below it ("Business Checking Maintenance" /
    // "$10.00"): the fee below stays unknown rather than take a guessed audience, and the search
    // never climbs past it to a heading further up (review of 24ad1339). A fee row that names no
    // audience is skipped.
    if (overAPrice(lines, index)) {
      if (audienceOf(line)) return { ambiguous: trimmed };
      continue;
    }
    if (ALL_ACCOUNTS.test(line)) return sentenceAudience ? { ambiguous: trimmed } : { audience: "both", heading: trimmed };
    // A heading-case section for every account ("OTHER SERVICES", "Other Service Fees") or the
    // schedule's own title ("Common Fee Schedule", "FEE SCHEDULE") that names no audience heads the
    // fee: the climb stops there and never reaches a menu link, a perk list or a sign-off further up
    // (#1059 unknown review, F1B). Only these: stopping at any line with a fee word took 4 correct
    // consumer labels off doc 22705 (F1A, rejected).
    if (headingCase(trimmed) && (SCHEDULE_TITLE.test(line) || NEUTRAL_SECTION.test(trimmed)) && !audienceOf(line)) {
      return sentenceAudience && sentenceMayHead ? { ambiguous: trimmed } : null;
    }
    if (!SECTION_HEADING.test(line)) continue;
    const audience = audienceOf(line);
    if (!audience) continue;
    if (sentenceAudience && sentenceAudience !== audience) return { ambiguous: trimmed };
    return { audience, heading: trimmed };
  }
  // An audience sentence that may head the fee ("Business accounts.", "What Business Accounts Are
  // Charged") and no heading above to settle it: unknown, never the consumer default.
  return sentenceMayHead && sentenceAudience ? { ambiguous: sentenceAudience, sentence: sentenceAudience, sentenceIndex } : null;
}

/**
 * An exception clause in a fee name ("(Not applicable when accessing eStatements through Consumer
 * eBanking)", "(personal are free on Netbranch)", "(retail customers free)") names the audience the
 * fee leaves out or waives, not the one it is for (#1626).
 */
const NAME_EXCEPTION = /\((?:[^()]*?\b)?(?:not\s+applicable|not\s+charged|does\s+not\s+apply|except(?:ing)?|excluding|excluded|exempt|waived|(?:are|is)\s+free|free\s+(?:on|with|for|through|via)|free(?=\s*\)))\b[^()]*\)/gi;
/** An exception that leaves business out ("(Business accounts excluded)"): the fee is consumer. */
const BUSINESS_EXCLUDED = /\((?:[^()]*?\b)?(?:(?:business|commercial)\s+accounts?\s+(?:are\s+)?(?:excluded|exempt)|(?:not\s+(?:for|applicable\s+to)|excluding|except(?:ing)?)\s+(?:business|commercial)\s+accounts?)\b[^()]*\)/i;
/** A credit union's member side beside business ("Member or Business", "Regular Member Accounts and Business Accounts"). */
const MEMBER_AND_BUSINESS = /\bmembers?\b[^.\n]{0,20}(?:\band\b|\bor\b|&|\/)\s*(?:small\s+)?(?:business|commercial)\b|\b(?:business|commercial)\b[^.\n]{0,20}(?:\band\b|\bor\b|&|\/)\s*members?\b/i;
const PERSONAL_BUSINESS = /\b(?:personal|consumer)\s+(?=business\b)/gi;
const PRODUCT_NOUN = /\b(card|account|checking|savings|share|check|draft)s?\b/gi;
/** "Retail customers" is a bank's consumer side: "Retail and Commercial Customers" is both. */
const RETAIL = /\bretail(?=\s+(?:(?:and|or|&|\/)\s+(?:small\s+)?(?:business|commercial)\s+)?(?:customers?|accounts?|clients?|members?)\b)/gi;
const nounsOf = (part: string) => [...part.matchAll(PRODUCT_NOUN)].map((match) => match[1].toLowerCase());
const headNoun = (part: string) => nounsOf(part).at(-1) ?? null;

/**
 * A name that lists a business product beside the same product with no business word ("ATM/VISA
 * Debit Card/VISA Business Debit Card replacement"): the fee is for both. Only the same product
 * counts, so "Business Checking, Savings and Money Market Accounts" stays business. A listed
 * product is a short name split at a slash, "&", "and" or "or", never at a comma, so a clause
 * ("On commercial accounts, if your account balance remains overdrawn") lists nothing.
 * The business word carries over to every product after it ("Business Checking or Premium
 * Checking", "Business Debit Card Replacement / Card Replacement Rush" stay business), so only a
 * plain product before the first business one counts, and only a short one naming that one
 * product ("Star Rewards Savings/Business Savings"; review of #1628).
 */
const MAX_LISTED_PRODUCT_CHARS = 40;
function listsBothSides(name: string): boolean {
  const parts = name.split(/\s*(?:[/&]|\band\b|\bor\b)\s*/i).map((part) => part.trim()).filter(Boolean);
  const first = parts.findIndex((part) => BUSINESS_WORDS.test(part));
  if (first <= 0) return false;
  const nouns = new Set(parts.slice(first).filter((part) => BUSINESS_WORDS.test(part)).map(headNoun).filter(Boolean));
  return parts.slice(0, first).some((part) => {
    const own = nounsOf(part);
    return part.length <= MAX_LISTED_PRODUCT_CHARS && own.length === 1 && nouns.has(own[0]);
  });
}

/**
 * The audience the fee's own name states. A name that lists both sides ("Personal and Business",
 * "Member or Business", a consumer and a business card) is for both (#1626); before, it decided
 * nothing and the fee took its schedule's audience.
 */
export function nameAudience(feeName: string): ContextAudience | null {
  // "Personal Business Share Draft" is a business product, not a personal one beside it.
  const name = feeName.replace(NAME_EXCEPTION, " ").replace(PERSONAL_BUSINESS, "").replace(RETAIL, "consumer");
  const text = neutral(name);
  if (BOTH_WORDS.test(text) || MEMBER_AND_BUSINESS.test(text) || listsBothSides(text)) return "both";
  const audience = audienceOf(name);
  return audience ?? (BUSINESS_EXCLUDED.test(feeName) ? "consumer" : null);
}

export function suggestAudience(input: {
  documentUrl: string | null;
  text: string | null;
  feeName: string;
  amount: number | null;
}): AudienceSuggestion | null {
  // The fee's own name wins ("Returned Deposit Items (Commercial Accounts Only)").
  const fromName = nameAudience(input.feeName);
  if (fromName) return { audience: fromName, source: "fee_name", evidence: input.feeName };
  const path = (() => {
    try {
      return input.documentUrl ? decodeURIComponent(new URL(input.documentUrl).pathname).replace(/[-_/.]+/g, " ") : "";
    } catch {
      return "";
    }
  })();
  const fromUrl = path ? audienceOf(path) : null;
  if (fromUrl) return { audience: fromUrl, source: "document_url", evidence: input.documentUrl ?? "" };
  const text = input.text ?? "";
  if (!text) return null;
  const lines = text.split("\n");
  // A menu link ("Business Banking") is not business fees: only a business heading with priced
  // lines under it, or a priced line that names business, is.
  const businessLine = businessFeeLine(lines);
  const feeIndex = feeLineIndex(lines, input.feeName, input.amount);
  if (feeIndex >= 0) {
    const cell = priceCellAudience(lines, feeIndex, input.amount);
    if (cell) return { audience: cell, source: "fee_price_cell", evidence: lines[feeIndex].trim().slice(0, 200) };
    // A schedule's own title above the fee ("PERSONAL SCHEDULE OF FEES", "Consumer Deposit Account"
    // over "Fee Schedule"), with nothing between that names another audience, is the schedule the
    // fee is in, even where a later part of the document prices business items (#1687: Kaw Valley
    // 53479 and F&M 143832 were `both`).
    const titled = scheduleSectionTitle(lines, feeIndex);
    if (titled) {
      // The document's own title, at its top, keeps that name.
      const atTop = lines.slice(0, titled.index).join("\n").length < TITLE_CHARS;
      return { audience: titled.audience, source: atTop ? "document_title" : "schedule_section_title", evidence: titled.title };
    }
    const section = sectionHeadingAudience(lines, feeIndex);
    // A fee in one of two audience columns stays unknown: the text does not say which column.
    // So does one under an unclear section, except a consumer sentence with no heading above it
    // in a schedule that prices nothing for businesses: it takes the consumer default below,
    // which it would get with no sentence at all (#1059 gate (a)).
    // Not when a heading between the sentence and the fee names business ("Commercial Clients",
    // "Small Business", a bare "Business", "For Business Owners"): its section may hold the fee
    // (review of #1445). A business heading below the fee heads other fees, not this one: a footer
    // "Business Credit Cards:" or a report's "Small Business Loans" leaves the sentence standing
    // (review of #1453).
    const consumerSentenceOnly =
      section && "sentence" in section && section.sentence === "consumer" && businessLine < 0 &&
      !businessHeadingBetween(lines, section.sentenceIndex ?? 0, feeIndex);
    if (section && ("columns" in section || "ambiguous" in section) && !consumerSentenceOnly) return null;
    const heading = section && "audience" in section ? section : null;
    // A heading for all accounts in a schedule that also prices business items lists the fee for
    // both. With nothing priced for businesses, it is the consumer schedule (the default below).
    if (heading && heading.audience === "both" && businessLine >= 0) {
      return { audience: "both", source: "section_heading", evidence: heading.heading };
    }
    // A personal heading in a schedule that prices nothing for businesses stands, before any
    // title: a menu line "Business Fee Schedule" is no reason to call it business (review of
    // 7c4f3b25).
    if (heading && heading.audience === "consumer" && businessLine < 0) {
      return { audience: "consumer", source: "section_heading", evidence: heading.heading };
    }
    // A heading that names one audience does not decide on its own in a schedule that also prices
    // business items. On unseen schedules it agreed with a blind reading on 14 of 36 fees, and 10
    // went to the other audience: a distant "Business Checking" heading or column on a web page,
    // or a two-column PDF read line by line, claims fees listed for every account (#1059 holdout,
    // Oct 14). The fee stays unknown until a heading can be tied to its section.
    // A business schedule's title over a business heading ("BUSINESS FEE SCHEDULE" over "Business
    // Accounts") settles it. A personal title does not: in a schedule that also prices business
    // items it is a section heading near the top ("PERSONAL CHECKING SERVICE CHARGE").
    // A business heading never falls through to the consumer default, even when the schedule's
    // business prices sit too far below it to count as business fees.
    if (heading && (businessLine >= 0 || heading.audience === "business")) {
      const title = scheduleTitle(lines);
      return heading.audience === "business" && title && "audience" in title && title.audience === "business"
        ? { audience: "business", source: "document_title", evidence: title.line }
        : null;
    }
  }
  const title = scheduleTitle(lines);
  // A title over a price line could be the schedule's title or a fee row: no guess.
  if (title && "ambiguous" in title) return null;
  if (title) return { audience: title.audience, source: "document_title", evidence: title.line };
  // A general schedule with no business fees is the consumer schedule (#1059 step 4).
  // A business schedule's own wording near the top, even inside one long flattened line, or run
  // together in the address ("ccufl_businessfeeschedule.pdf"), rules out the consumer default
  // (#1059 holdout 5).
  if (businessLine < 0 && businessScheduleWording(text, path)) return null;
  if (businessLine < 0) return { audience: "consumer", source: "default_general_schedule", evidence: "no business fees in the document" };
  // In a schedule that also prices business items, a fee whose own line is not found cannot be
  // shown to be unlimited, so it stays unknown.
  if (feeIndex < 0) return null;
  // Its line found, with nothing that limits it to one audience (its name, a section above
  // it), the fee is listed for every account.
  return { audience: "both", source: "mixed_schedule_unqualified", evidence: lines[businessLine].trim().slice(0, 200) };
}

const CELL_AUDIENCE = /^\s*(personal|consumer|business|commercial)\b/i;
const OTHER_CELL = /^\s*\|?\s*\$\s*\d[\d,]*(?:\.\d{2})?\s+(personal|consumer|business|commercial)\b/i;
const cellAudience = (word: string): ContextAudience => (/^(?:personal|consumer)$/i.test(word) ? "consumer" : "business");

/**
 * Two prices in the fee's own cell, each with its audience ("$2.00 personal / $5.00 business", or
 * "| $2.00 personal" over "| $5.00 business"): the fee's price names its audience (True Sky fee
 * 43451, #1059 unknown review). Only when the other price names the other audience, so a lone
 * "$10.00 business" note decides nothing.
 */
function priceCellAudience(lines: string[], feeIndex: number, amount: number | null): ContextAudience | null {
  if (amount == null) return null;
  const line = lines[feeIndex];
  const match = priceToken(amount).exec(line);
  if (!match) return null;
  const after = line.slice(match.index + match[0].length);
  const own = CELL_AUDIENCE.exec(after);
  if (!own) return null;
  const rest = after.slice(own[0].length).replace(/^\s*[/|,;]\s*/, "");
  const other = OTHER_CELL.exec(rest) ?? OTHER_CELL.exec(nextLine(lines, feeIndex) ?? "");
  if (!other) return null;
  const audience = cellAudience(own[1]);
  return cellAudience(other[1]) !== audience ? audience : null;
}

/**
 * The schedule's own title in its first TITLE_CHARS characters ("Consumer Fee Schedule"). A fee
 * row whose price is on the next line ("Business Checking Monthly Service Charge" / "$10.00") is no
 * title, and two titles naming different audiences (a plain-text menu listing "Personal Fee
 * Schedule" and "Business Fee Schedule") name neither.
 */
function scheduleTitle(lines: string[]): { audience: ContextAudience; line: string } | { ambiguous: string } | null {
  const found: Array<{ audience: ContextAudience; line: string }> = [];
  let chars = 0;
  for (let index = 0; index < lines.length && chars < TITLE_CHARS; index += 1) {
    chars += lines[index].length + 1;
    const line = lines[index];
    if (!isHeading(line) || !SCHEDULE_TITLE.test(line)) continue;
    // A title set on two lines ("Consumer Deposit Account" over "Fee Schedule") reads as one (#1687).
    const joined = audienceOf(line) ? null : twoLineTitle(lines, index);
    const title = joined && audienceScheduleTitle(joined) ? joined : audienceOf(line) ? line.trim() : null;
    const audience = title ? audienceOf(title) : null;
    if (!title || !audience) continue;
    if (overAPrice(lines, index)) return { ambiguous: line.trim() };
    found.push({ audience, line: title });
  }
  if (found.length === 0 || new Set(found.map((title) => title.audience)).size > 1) return null;
  return found[0];
}

/**
 * A heading-case schedule title naming no audience ("Fee Schedule") under a heading-case line that
 * names one and no schedule ("Consumer Deposit Account"): the two lines of one title, joined.
 */
function twoLineTitle(lines: string[], index: number): string | null {
  const line = lines[index].trim();
  const above = (lines[index - 1] ?? "").trim();
  if (!above || !headingCase(line) || !headingCase(above) || !isHeading(above) || SCHEDULE_TITLE.test(above)) return null;
  return audienceOf(above) ? `${above} ${line}` : null;
}

/** A schedule title at this line, on one line or two, set like a title (heading case, no price). */
function titleAt(lines: string[], index: number): string | null {
  const line = lines[index];
  // "Service charge" names a fee row as often as a schedule, so it is no title here; nor is a
  // line over a price ("Business Checking Monthly Service Charge" / "$10.00").
  if (!isHeading(line) || !SECTION_SCHEDULE_TITLE.test(line) || !headingCase(line.trim()) || overAPrice(lines, index)) return null;
  const title = audienceOf(line) ? line.trim() : twoLineTitle(lines, index) ?? line.trim();
  return !audienceOf(title) || audienceScheduleTitle(title) ? title : null;
}

/** Words that may sit between the audience and the schedule ("Consumer Deposit Account Fee Schedule"). */
const TITLE_FILLER = String.raw`(?:(?:banking|bank|accounts?|deposits?|services?|checking|savings|share|membership|additional|products?|account analysis|&|and)\s+)*`;
const AUDIENCE_TITLE_WORD = String.raw`(?:personal|consumer|individual|business(?:es)?|commercial)`;
const SCHEDULE_WORDS = String.raw`(?:fee schedule|schedule of (?:fees|charges)|fees and charges|fee disclosure)`;
/**
 * A title that is the audience's whole schedule: the audience, then only words for accounts or
 * banking, then the schedule ("PERSONAL SCHEDULE OF FEES", "Commercial Account FEE SCHEDULE",
 * "Northwest Personal Additional Account Fee Schedule"), or the schedule, then the audience ("SCHEDULE
 * OF FEES - BUSINESS", "Schedule of Fees for Businesses"). A product's schedule ("Business Remote
 * Deposit Capture Fee Schedule"), a joined audience ("General and Business Membership Fee
 * Schedule", "and/or Business"), a menu ("Business Rates & Fees · Fee Schedule") or a line that
 * starts mid-sentence ("of Fees and/or ...") is not.
 */
const AUDIENCE_FIRST_TITLE = new RegExp(String.raw`(?<!(?:\band|\bor|&|\/)\s*)\b${AUDIENCE_TITLE_WORD}\s+${TITLE_FILLER}${SCHEDULE_WORDS}\b`, "i");
const SCHEDULE_FIRST_TITLE = new RegExp(String.raw`\b${SCHEDULE_WORDS}\s*(?:[-–—:]|\bfor\b)\s*${AUDIENCE_TITLE_WORD}(?:\s+(?:accounts?|banking|customers|members))?\s*$`, "i");
function audienceScheduleTitle(title: string): boolean {
  if (/^[a-z]/.test(title) || /[·•]/.test(title)) return false;
  return AUDIENCE_FIRST_TITLE.test(title) || SCHEDULE_FIRST_TITLE.test(title);
}

/** The audiences a line names: both for a two-sided or all-accounts line. */
function audiencesNamed(line: string): ContextAudience[] {
  const text = neutral(line);
  if (BOTH_WORDS.test(text) || MEMBER_AND_BUSINESS.test(text) || ALL_ACCOUNTS.test(text)) return ["both"];
  const named: ContextAudience[] = [];
  if (BUSINESS_WORDS.test(text)) named.push("business");
  if (CONSUMER_WORDS.test(text)) named.push("consumer");
  return named;
}

/**
 * The nearest schedule title above the fee's line that names one audience ("PERSONAL SCHEDULE OF
 * FEES", "Consumer Deposit Account" / "Fee Schedule"), when the fee's line and every line between
 * name no other audience (#1687). A title naming no audience ends the search: the fee is in another
 * schedule. So do two titles for different audiences one over the other: a menu or a contents list.
 */
export function scheduleSectionTitle(lines: string[], feeIndex: number): { audience: "consumer" | "business"; title: string; index: number } | null {
  const seen = new Set<ContextAudience>(audiencesNamed(lines[feeIndex] ?? ""));
  for (let index = feeIndex - 1; index >= 0 && index >= feeIndex - HEADING_LOOKBACK_LINES; index -= 1) {
    const title = titleAt(lines, index);
    if (title) {
      const audience = audienceOf(title);
      if (audience !== "consumer" && audience !== "business") return null;
      if ([...seen].some((named) => named !== audience)) return null;
      const top = index - (title === lines[index].trim() ? 0 : 1);
      for (let above = top - 1; above >= Math.max(0, top - 2); above -= 1) {
        const other = titleAt(lines, above);
        if (other && audienceOf(other) !== audience) return null;
      }
      return { audience, title, index: top };
    }
    for (const named of audiencesNamed(lines[index])) seen.add(named);
  }
  return null;
}

const PRICED = /\$\s*\d|\b\d+\.\d{2}\b/;
/** A priced fee row is short; a longer priced line is prose ("...built for the business economy, $250"). */
const MAX_FEE_ROW_CHARS = 160;
/** A column header row can be long ("CONSUMER CHECKING ACCOUNTS | ... | BUSINESS ACCOUNTS"). */
const MAX_COLUMN_HEADER_CHARS = 400;
/** Lines under a heading that still belong to it. */
const SECTION_REACH_LINES = 15;

/** The first line that prices something for businesses, or -1. */
export function businessFeeLine(lines: string[]): number {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (NOT_A_SECTION.test(line) || !BUSINESS_WORDS.test(neutral(line))) continue;
    if (PRICED.test(line) && line.trim().length <= MAX_FEE_ROW_CHARS) return index;
    // A long line (a paragraph, or a PDF flattened to one line) prices business items in one of
    // its clauses: "... For business accounts, a $15 monthly service fee applies. ..." (review of #1445).
    if (PRICED.test(line) && line.trim().length > MAX_FEE_ROW_CHARS && businessPriceClause(line)) return index;
    // A short business heading directly over a price ("Commercial Clients" / "Account
    // analysis | $25"): a section, though SECTION_HEADING does not name it. A menu word over more
    // menu words ("Business" / "Checking") is not (review of #1445).
    if (isHeading(line, true) && businessWordHeading(line)) {
      const next = nextLine(lines, index);
      if (next != null && businessHeadingRow(next)) return lines.indexOf(next, index + 1);
    }
    // Only a business section heading owns the prices under it, not a lone menu word ("Business").
    if (!isHeading(line, true) || !(SECTION_HEADING.test(neutral(line)) || SCHEDULE_TITLE.test(neutral(line)))) continue;
    for (let below = index + 1; below < Math.min(lines.length, index + 1 + SECTION_REACH_LINES); below += 1) {
      // The next heading that names an audience ends this one ("Business Banking" then "Personal Banking").
      if (isHeading(lines[below]) && audienceOf(lines[below])) break;
      if (PRICED.test(lines[below]) && !NOT_A_SECTION.test(lines[below])) return below;
    }
  }
  return -1;
}

/**
 * The line under a short business heading that makes it a section: a fee row, priced as a fee
 * ("Temporary Checks (4 checks) | $2.00", "$10.00/Month", "Monthly service charge $5"), not a
 * promotion under a menu word ("Business Forms" / "Refer a Friend and Earn Up to $500").
 */
const TABLE_ROW_PRICE = /\|\s*\$?\s*\d/;
function businessHeadingRow(line: string): boolean {
  const trimmed = line.trim();
  return (
    PRICED.test(trimmed) &&
    trimmed.length <= MAX_FEE_ROW_CHARS &&
    !NOT_A_SECTION.test(trimmed) &&
    (FEE_CLAUSE.test(trimmed) || STARTS_WITH_PRICE.test(trimmed) || TABLE_ROW_PRICE.test(trimmed))
  );
}

/** A short line that names business and little else: "Commercial Clients", "Small Business", "COMMERCIAL". */
const BUSINESS_HEADING_MAX_WORDS = 6;
function businessWordHeading(line: string): boolean {
  const trimmed = line.trim();
  return BUSINESS_WORDS.test(neutral(trimmed)) && trimmed.split(/\s+/).length <= BUSINESS_HEADING_MAX_WORDS && !NOT_A_SECTION.test(trimmed);
}

/**
 * Whether a heading after `from` and above the fee's line `to` names business (any wording), so the
 * sentence at `from` does not head the fee's section.
 */
function businessHeadingBetween(lines: string[], from: number, to: number): boolean {
  for (let index = from + 1; index < Math.min(lines.length, to); index += 1) {
    if (isHeading(lines[index]) && businessWordHeading(lines[index])) return true;
  }
  return false;
}

/** A fee word in a clause: what makes a priced clause a fee, not "built for the business economy, $250". */
const FEE_CLAUSE = /\b(?:fees?|charges?|service charge|per (?:item|month|check)|each|monthly)\b/i;
/** One clause of a long line that names business, a price and a fee word. */
function businessPriceClause(line: string): boolean {
  return line
    .split(/(?<=[.;!?])\s+|\s+\|\s+/)
    .some((clause) => clause.length <= MAX_FEE_ROW_CHARS && PRICED.test(clause) && FEE_CLAUSE.test(clause) && BUSINESS_WORDS.test(neutral(clause)));
}

/** Whether the document prices anything for businesses. */
export function hasBusinessFees(lines: string[]): boolean {
  return businessFeeLine(lines) >= 0;
}

/** Business or commercial schedule wording in the text's first characters or the address. */
const BUSINESS_SCHEDULE_TEXT = /\b(?:business|commercial)\s+(?:(?:banking|deposit)\s+)?(?:fee schedule|schedule of (?:fees|charges)|fees and charges|service (?:charges|fees)|banking accounts|accounts? fee schedule)\b/i;
const BUSINESS_SCHEDULE_PATH = /(?:business|commercial)\s*(?:fee|fees|schedule|service|banking)/i;
function businessScheduleWording(text: string, path: string): boolean {
  // A line that points elsewhere ("For business accounts, see the Business Fee Schedule.") names
  // another document, not this one.
  const top = text.slice(0, TITLE_CHARS).split("\n").filter((line) => !isPointer(line));
  return top.some((line) => BUSINESS_SCHEDULE_TEXT.test(neutral(line))) || BUSINESS_SCHEDULE_PATH.test(neutral(path));
}
