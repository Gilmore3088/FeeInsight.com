/**
 * Knox's audience suggestion from the fee's context (#1059): the document's address and title,
 * the section heading above the fee's own line, or a general schedule with no business wording.
 * Pure; no model call. Knox suggests, Darwin decides (DECISIONS, 2026-10-12 and 2026-10-13): this
 * returns evidence for Darwin, never a published label on its own.
 */

export type ContextAudience = "consumer" | "business" | "both";
export type AudienceSource =
  | "fee_name"
  | "document_url"
  | "document_title"
  | "section_heading"
  | "default_general_schedule"
  | "mixed_schedule_unqualified";

export interface AudienceSuggestion {
  audience: ContextAudience;
  source: AudienceSource;
  /** The words that decided it: the address, the title line or the heading. */
  evidence: string;
}

const BUSINESS_WORDS = /\b(?:business(?:es)?|commercial|corporate|treasury management|merchant services)\b/i;
const CONSUMER_WORDS = /\b(?:personal|consumer|individuals?)\b/i;
/** "Personal and business", "consumer or commercial": both audiences, so no single suggestion. */
const BOTH_WORDS = /\b(?:personal|consumer)\b[^.\n]{0,20}\b(?:and|or|&|\/)\s*(?:small\s+)?(?:business|commercial)\b|\b(?:business|commercial)\b[^.\n]{0,20}\b(?:and|or|&|\/)\s*(?:personal|consumer)\b/i;
/** A heading is a short line with no price: a section title, not a fee row. */
const MAX_HEADING_CHARS = 80;
/** How far above the fee's line a heading is looked for. */
const HEADING_LOOKBACK_LINES = 60;
const TITLE_CHARS = 300;

/**
 * Words that name a product or a time, not who the fee is for: a corporate (official) check or
 * draft, a personal check, a business day, "close of business", a vendor's "Business Systems".
 */
const NOT_AN_AUDIENCE = /\bcorporate\s+(?:checks?|drafts?|bonds?|securities|and municipal)\b|\bpersonal\s+(?:checks?|identification|information)\b|\bbusiness\s+(?:days?|hours?|systems)\b|\b(?:close of|regular|normal|legitimate|conduct(?:ing)?|doing)\s+business\b|\bcredit union business only\b|\bnon-?(?:commercial|business|personal|consumer)\b|\b(?:commercial|business|consumer|personal)(?:\s+(?:state|national|federal|savings|community|county|city|first))*\s+(?:bank|savings bank|credit union|trust company|savings and loan)\b/gi;
const neutral = (text: string) => text.replace(NOT_AN_AUDIENCE, " ");

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
/** A title names the schedule itself ("Consumer Fee Schedule", "Business Schedule of Fees"). */
const SCHEDULE_TITLE = /\b(?:fee schedule|schedule of (?:fees|charges)|fees and charges|service charges?|fee disclosure)\b/i;

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
  for (const name of stripped && stripped !== full ? [full, stripped] : [full]) {
    if (!name) continue;
    let nameOnly = -1;
    for (let index = 0; index < lines.length; index += 1) {
      if (!` ${squash(lines[index])} `.includes(` ${name} `)) continue;
      // The next line's price counts only when the name line has none of its own, so a fee never
      // takes the price of the row below it (review of cfe0873d).
      if (price == null || price.test(lines[index]) || (!PRICED.test(lines[index]) && price.test(nextLine(lines, index) ?? ""))) return index;
      if (nameOnly < 0) nameOnly = index;
    }
    if (nameOnly >= 0) return nameOnly;
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
 * A fee's price line: a price followed by nothing, a parenthesis, a slash, an asterisk, a dash or
 * a rate word ("$10.00", "$10.00 per month if balance below $500", "$5.00*", "Free"). A price
 * followed by any other word ("$100 minimum opening deposit") is a description under a heading
 * (reviews of cfe0873d and 62b31599).
 */
const BARE_PRICE = /^\s*(?:\$\s*\d[\d,]*(?:\.\d{2})?|\d[\d,]*\.\d{2}|free|no charge|n\/c)\s*\*?\s*(?:$|\(|\/|[-–]|(?:per|each|a|an|plus|monthly)\b)/i;

/** A fee name whose price sits on the next line ("Personal Account Research" / "$25.00") heads nothing. */
function namesAFee(lines: string[], index: number): boolean {
  return BARE_PRICE.test(nextLine(lines, index) ?? "");
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
): { audience: ContextAudience; heading: string } | { columns: string } | null {
  for (let index = feeIndex - 1; index >= 0 && index >= feeIndex - HEADING_LOOKBACK_LINES; index -= 1) {
    const line = lines[index];
    const trimmed = line.trim();
    if (trimmed.includes("|") && trimmed.length <= MAX_COLUMN_HEADER_CHARS && !PRICED.test(trimmed)) {
      const cells = trimmed.split("|").map((cell) => audienceOf(cell)).filter(Boolean);
      if (new Set(cells).size > 1) return { columns: trimmed };
      continue;
    }
    if (!isHeading(line) || trimmed.startsWith("(") || namesAFee(lines, index)) continue;
    if (ALL_ACCOUNTS.test(line)) return { audience: "both", heading: trimmed };
    if (!SECTION_HEADING.test(line)) continue;
    const audience = audienceOf(line);
    if (audience) return { audience, heading: trimmed };
  }
  return null;
}

export function suggestAudience(input: {
  documentUrl: string | null;
  text: string | null;
  feeName: string;
  amount: number | null;
}): AudienceSuggestion | null {
  // The fee's own name wins ("Returned Deposit Items (Commercial Accounts Only)").
  const fromName = audienceOf(input.feeName);
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
  // The section heading above the fee's own line is nearer evidence than the page's title.
  if (feeIndex >= 0) {
    const section = sectionHeadingAudience(lines, feeIndex);
    // A fee in one of two audience columns stays unknown: the text does not say which column.
    if (section && "columns" in section) return null;
    // "All accounts" in a schedule that prices nothing for businesses is the consumer schedule.
    if (section && !(section.audience === "both" && businessLine < 0)) {
      return { audience: section.audience, source: "section_heading", evidence: section.heading };
    }
  }
  const title = scheduleTitle(lines);
  if (title) return { audience: title.audience, source: "document_title", evidence: title.line };
  // A general schedule with no business fees is the consumer schedule (#1059 step 4).
  if (businessLine < 0) return { audience: "consumer", source: "default_general_schedule", evidence: "no business fees in the document" };
  // In a schedule that also prices business items, a fee whose own line is not found cannot be
  // shown to be unlimited, so it stays unknown.
  if (feeIndex < 0) return null;
  // Its line found, with nothing that limits it to one audience (its name, a section above
  // it), the fee is listed for every account.
  return { audience: "both", source: "mixed_schedule_unqualified", evidence: lines[businessLine].trim().slice(0, 200) };
}

/**
 * The schedule's own title in its first TITLE_CHARS characters ("Consumer Fee Schedule"). A fee
 * row whose price is on the next line ("Business Checking Monthly Service Charge" / "$10.00") is no
 * title, and two titles naming different audiences (a plain-text menu listing "Personal Fee
 * Schedule" and "Business Fee Schedule") name neither.
 */
function scheduleTitle(lines: string[]): { audience: ContextAudience; line: string } | null {
  const found: Array<{ audience: ContextAudience; line: string }> = [];
  let chars = 0;
  for (let index = 0; index < lines.length && chars < TITLE_CHARS; index += 1) {
    chars += lines[index].length + 1;
    const line = lines[index];
    if (!isHeading(line) || namesAFee(lines, index) || !SCHEDULE_TITLE.test(line)) continue;
    const audience = audienceOf(line);
    if (audience) found.push({ audience, line: line.trim() });
  }
  if (found.length === 0 || new Set(found.map((title) => title.audience)).size > 1) return null;
  return found[0];
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
    // Only a business section heading owns the prices under it, not a lone menu word ("Business").
    if (!isHeading(line, true) || !SECTION_HEADING.test(neutral(line))) continue;
    for (let below = index + 1; below < Math.min(lines.length, index + 1 + SECTION_REACH_LINES); below += 1) {
      // The next heading that names an audience ends this one ("Business Banking" then "Personal Banking").
      if (isHeading(lines[below]) && audienceOf(lines[below])) break;
      if (PRICED.test(lines[below]) && !NOT_A_SECTION.test(lines[below])) return below;
    }
  }
  return -1;
}

/** Whether the document prices anything for businesses. */
export function hasBusinessFees(lines: string[]): boolean {
  return businessFeeLine(lines) >= 0;
}
