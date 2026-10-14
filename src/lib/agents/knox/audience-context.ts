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
const NOT_AN_AUDIENCE = /\bcorporate\s+(?:checks?|drafts?|bonds?|securities|and municipal)\b|\bpersonal\s+(?:checks?|identification|information)\b|\bbusiness\s+(?:days?|hours?|systems)\b|\b(?:close of|regular|normal|legitimate|conduct(?:ing)?|doing)\s+business\b|\bcredit union business only\b/gi;
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
const NOT_A_SECTION = /\[|\]\(|https?:|www\.|sign[ -]?in|log[ -]?in|enroll|apply now|business (?:days?|hours?)|bank of|credit union|federal savings|\bN\.?A\.?\b|\bmenu\b/i;
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
  const name = squash(feeName).split(" ").slice(0, 4).join(" ");
  if (!name) return -1;
  const price = amount == null ? null : amount.toFixed(2).replace(/\.00$/, "");
  let nameOnly = -1;
  for (let index = 0; index < lines.length; index += 1) {
    const line = squash(lines[index]);
    if (!line.includes(name)) continue;
    if (price == null || lines[index].includes(price) || (lines[index + 1] ?? "").includes(price)) return index;
    if (nameOnly < 0) nameOnly = index;
  }
  return nameOnly;
}

/** The nearest heading above the fee's line that names one audience. */
export function sectionHeadingAudience(lines: string[], feeIndex: number): { audience: ContextAudience; heading: string } | null {
  for (let index = feeIndex - 1; index >= 0 && index >= feeIndex - HEADING_LOOKBACK_LINES; index -= 1) {
    const line = lines[index];
    if (!isHeading(line) || !SECTION_HEADING.test(line)) continue;
    const audience = audienceOf(line);
    if (audience) return { audience, heading: line.trim() };
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
  const title = text.slice(0, TITLE_CHARS).split("\n").find((line) => isHeading(line) && SCHEDULE_TITLE.test(line) && audienceOf(line));
  const fromTitle = title ? audienceOf(title) : null;
  if (fromTitle && title) return { audience: fromTitle, source: "document_title", evidence: title.trim() };
  if (!text) return null;
  const lines = text.split("\n");
  const feeIndex = feeLineIndex(lines, input.feeName, input.amount);
  if (feeIndex >= 0) {
    const section = sectionHeadingAudience(lines, feeIndex);
    if (section) return { audience: section.audience, source: "section_heading", evidence: section.heading };
  }
  // A general schedule with no business fees is the consumer schedule (#1059 step 4). A menu link
  // ("Business Banking") is not business fees: only a business heading with priced lines under
  // it, or a priced line that names business, is.
  const businessLine = businessFeeLine(lines);
  if (businessLine < 0) return { audience: "consumer", source: "default_general_schedule", evidence: "no business fees in the document" };
  // A schedule that also prices business items, with nothing that limits this fee to one
  // audience (its name, a section above it), lists it for every account.
  return { audience: "both", source: "mixed_schedule_unqualified", evidence: lines[businessLine].trim().slice(0, 200) };
}

const PRICED = /\$\s*\d|\b\d+\.\d{2}\b/;
/** A priced fee row is short; a longer priced line is prose ("...built for the business economy, $250"). */
const MAX_FEE_ROW_CHARS = 160;
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
