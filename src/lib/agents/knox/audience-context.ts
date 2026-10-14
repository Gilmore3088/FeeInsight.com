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
/**
 * How far above the fee's line a heading is looked for. Lines, blank ones included: counting only
 * lines with text reached a "Business Services" heading far up a web page and called its NSF and
 * Courtesy Pay fees business (#1059 holdout, Oct 14), so a fee under a distant heading stays
 * unqualified instead.
 */
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
  return -1;
}

const FIRST_PRICE = /\$\s*\d[\d,]*(?:\.\d{2})?|\b\d[\d,]*\.\d{2}\b/;

/**
 * A fee row's label and its first price: the text before the line's first price and that price,
 * or the whole line and the first price on the next line. Null for a sentence or a long line.
 */
function feeRow(lines: string[], index: number): { label: string; price: string } | null {
  const line = lines[index].trim();
  if (line.length > MAX_FEE_ROW_CHARS || isSentence(line)) return null;
  const own = FIRST_PRICE.exec(line);
  if (own) return { label: squash(line.slice(0, own.index)), price: own[0] };
  const below = FIRST_PRICE.exec(nextLine(lines, index) ?? "");
  return below && below.index === 0 ? { label: squash(line), price: below[0] } : null;
}

/**
 * Other lines that list the fee's own row again: the same label, with the fee's price first. A
 * schedule with a personal and a business section can list one fee at one price in both. A line
 * whose label runs on ("Incoming Wire Transfer - International $15"), whose first price is another
 * fee's ("Stop Payment $25   Wire Transfer $30"), or that is a sentence ("Stop payment fees ($30)
 * waived for ...") is another row (review of d97858de).
 */
export function sameFeeRows(lines: string[], feeIndex: number, amount: number | null): number[] {
  if (amount == null) return [];
  const own = feeRow(lines, feeIndex);
  if (!own || !own.label) return [];
  const price = priceToken(amount);
  if (!price.test(own.price)) return [];
  const found: number[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (index === feeIndex || !squash(lines[index]).startsWith(own.label)) continue;
    const row = feeRow(lines, index);
    if (row && row.label === own.label && price.test(row.price)) found.push(index);
  }
  return found;
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
): { audience: ContextAudience; heading: string } | { columns: string } | { ambiguous: string } | null {
  let sentenceAudience: ContextAudience | null = null;
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
        sentenceAudience ??= named;
        // A sentence that does not point elsewhere may head the fees below it.
        if (!isPointer(trimmed)) sentenceMayHead = true;
      }
      continue;
    }
    if (!isHeading(line) || trimmed.startsWith("(")) continue;
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
    if (!SECTION_HEADING.test(line)) continue;
    const audience = audienceOf(line);
    if (!audience) continue;
    if (sentenceAudience && sentenceAudience !== audience) return { ambiguous: trimmed };
    return { audience, heading: trimmed };
  }
  // An audience sentence that may head the fee ("Business accounts.", "What Business Accounts Are
  // Charged") and no heading above to settle it: unknown, never the consumer default.
  return sentenceMayHead && sentenceAudience ? { ambiguous: sentenceAudience } : null;
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
    if (section && ("columns" in section || "ambiguous" in section)) return null;
    // "All accounts" in a schedule that prices nothing for businesses is the consumer schedule.
    if (section && !(section.audience === "both" && businessLine < 0)) {
      // The same fee at the same price under a personal and a business heading is listed for
      // both ("NSF $32" in Personal Checking Fees and again in Business Accounts Fees).
      if (section.audience !== "both") {
        for (const other of sameFeeRows(lines, feeIndex, input.amount)) {
          const there = sectionHeadingAudience(lines, other);
          if (there && "audience" in there && there.audience !== "both" && there.audience !== section.audience) {
            return { audience: "both", source: "section_heading", evidence: `${section.heading} / ${there.heading}` };
          }
        }
      }
      return { audience: section.audience, source: "section_heading", evidence: section.heading };
    }
  }
  const title = scheduleTitle(lines);
  // A title over a price line could be the schedule's title or a fee row: no guess.
  if (title && "ambiguous" in title) return null;
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
function scheduleTitle(lines: string[]): { audience: ContextAudience; line: string } | { ambiguous: string } | null {
  const found: Array<{ audience: ContextAudience; line: string }> = [];
  let chars = 0;
  for (let index = 0; index < lines.length && chars < TITLE_CHARS; index += 1) {
    chars += lines[index].length + 1;
    const line = lines[index];
    if (!isHeading(line) || !SCHEDULE_TITLE.test(line)) continue;
    const audience = audienceOf(line);
    if (!audience) continue;
    if (overAPrice(lines, index)) return { ambiguous: line.trim() };
    found.push({ audience, line: line.trim() });
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
    if (!isHeading(line, true) || !(SECTION_HEADING.test(neutral(line)) || SCHEDULE_TITLE.test(neutral(line)))) continue;
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
