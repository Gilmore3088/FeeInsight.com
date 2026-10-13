/**
 * Knox's audience suggestion from the fee's context (#1059): the document's address and title,
 * the section heading above the fee's own line, or a general schedule with no business wording.
 * Pure; no model call. Knox suggests, Darwin decides (DECISIONS, 2026-10-12 and 2026-10-13): this
 * returns evidence for Darwin, never a published label on its own.
 */

export type ContextAudience = "consumer" | "business";
export type AudienceSource = "fee_name" | "document_url" | "document_title" | "section_heading" | "default_general_schedule";

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

function audienceOf(text: string): ContextAudience | null {
  if (BOTH_WORDS.test(text)) return null;
  const business = BUSINESS_WORDS.test(text);
  const consumer = CONSUMER_WORDS.test(text);
  if (business && !consumer) return "business";
  if (consumer && !business) return "consumer";
  return null;
}

/** Menu items, links, sign-in prompts, bank names and "business days" name no audience. */
const NOT_A_SECTION = /\[|\]\(|https?:|www\.|sign[ -]?in|log[ -]?in|enroll|apply now|business (?:days?|hours?)|bank of|credit union|federal savings|\bN\.?A\.?\b/i;
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

function isHeading(line: string): boolean {
  const trimmed = line.trim();
  return (
    trimmed.length > 0 &&
    trimmed.length <= MAX_HEADING_CHARS &&
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
  if (!hasBusinessFees(lines)) return { audience: "consumer", source: "default_general_schedule", evidence: "no business fees in the document" };
  return null;
}

const PRICED = /\$\s*\d|\b\d+\.\d{2}\b/;
/** Lines under a heading that still belong to it. */
const SECTION_REACH_LINES = 15;

/** Whether the document prices anything for businesses. */
export function hasBusinessFees(lines: string[]): boolean {
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (NOT_A_SECTION.test(line) || !BUSINESS_WORDS.test(line)) continue;
    if (PRICED.test(line)) return true;
    if (!isHeading(line)) continue;
    for (let below = index + 1; below < Math.min(lines.length, index + 1 + SECTION_REACH_LINES); below += 1) {
      // The next heading that names an audience ends this one ("Business Banking" then "Personal Banking").
      if (isHeading(lines[below]) && audienceOf(lines[below])) break;
      if (PRICED.test(lines[below]) && !NOT_A_SECTION.test(lines[below])) return true;
    }
  }
  return false;
}
