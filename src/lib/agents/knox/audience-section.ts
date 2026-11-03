import { ocrComparable } from "@/lib/agents/knox/ocr-leader-noise";

/**
 * Knox v179 (backlog dry run 10, Midwest Members FCU text 40777, lines 338-348): a section whose heading names an
 * audience by age or stage of life ("Senior Perks (60 & Over)", "Members 65+", "Youth") prices
 * its rows for that audience only. Midwest Members prints "Fax Service | $1 per page" in its general schedule
 * and, under "Senior Perks (60 & Over)", "Fax Service | FREE": read with no product, the seniors' $0 was the same
 * line as the bank's live $1 (#162230), and Hamilton's publish replaced the $1 with it as a newer price of the
 * same fee.
 *
 * `audienceSectionHeading`: the heading of the section a row sits in, when that heading names such an audience.
 * Walking up from the row's own line, every priced or free row is skipped ("Copy of a Check | FREE"); the first
 * plain title line (eight words or fewer, no price, no sentence) is the section's heading, and it is returned
 * only when it names an audience (`AUDIENCE_SECTION`). Any other title, or a sentence, ends the walk with no
 * section. The heading becomes the read's product (`withLineupFromText`), so `sameProduct` keeps it apart from
 * the general price and it never replaces it. Pure.
 */
/**
 * An audience named by age or stage of life. An age is a two-digit figure with age words: "60 & Over", "65+", "62 and
 * older", "Over age 65", "Ages 18", "18 years and under" ("55 Year Old", "Over 10,000", "Over 12 Months", "over 30
 * branches" are no age: an account's or a quantity's name).
 * "Student" and "Kids" are left out: they title accounts ("Student Checking", "Kids Club") as often as audiences.
 */
const AUDIENCE_SECTION = new RegExp(
  [
    String.raw`\b(?:seniors?|senior\s+citizens?|retirees?|youth|juniors?|teens?|minors?|young\s+adults?)\b`,
    String.raw`\b\d{2}(?![\d,.])\s*(?:\+|&\s*(?:over|older|up)\b|(?:(?:years?|yrs\.?)\s+(?:of\s+age\s+|old\s+)?)?(?:and|or)\s+(?:over|older|up|under|younger)\b)`,
    String.raw`\b(?:over|under)\s+(?:the\s+)?age\s+(?:of\s+)?\d{2}(?![\d,.])`,
    String.raw`\b(?:over|under)\s+\d{2}(?![\d,.])\s*(?:years?|yrs\.?)\b`,
    String.raw`\bages?\s+\d{2}(?![\d,.])`,
  ].join("|"),
  "i",
);
/**
 * A title that names an account, a service or a quantity, not an audience's section: "Youth Savings Account", "Senior
 * Checking", "Student Loans Available", "Visit one of over 30 branches", "Coin Counting Over 50 Rolls".
 */
const NOT_A_SECTION =
  /\b(?:checking|savings|accounts?|club|certificates?|CDs?|IRAs?|money\s+market|loans?|cards?|branch(?:es)?|ATMs?|months?|rolls?|wires?|transfers?|days?)\b/i;
/** A row's value: a price, a figure, or a free word in its own cell or at the line's end ("Copy of a Check | FREE"). */
const PRICE_OR_FIGURE = /[$\d]/;
const VALUE_CELL = /(?:^|\|)\s*(?:free|none|no\s+charge|n\/c|waived|included)\s*(?:\||$)/i;
const VALUE_AT_END = /\b(?:free|none|no\s+charge|n\/c)\s*$/i;
/** A note on the rows ("(Youth Accounts exempt from fee)", "No fee for senior citizens (62+)"): no section of its own. */
const NOTE = /^\W*[(*†‡]|\b(?:exempt(?:ed|ion)?|not\s+applicable|no\s+(?:fee|charge)s?|excepts?|except(?:ed|ion)?|excluded?)\b/i;
/** A waiver or free note that names an audience ("Fees waived for seniors 65+") is a note on the rows, not a title. */
const FREE_OR_WAIVED = /\b(?:free|waived?)\b/i;
/** A sentence, or a sentence's first line that runs on ("Customers 22 years old or younger are"). */
const SENTENCE = /[.!?;:]\s*$|[.!?;]\s+[A-Z]/;
const RUNS_ON = /\b(?:are|is|will|may|must|can|the|a|an|of|or|and|to)\s*$/i;
const MAX_WALK = 25;
const MAX_TITLE_WORDS = 8;

/** Line and text compared with OCR leader noise blanked in both (`ocrComparable`, review of #2979). */
const squash = (line: string) => ocrComparable(line);

/** How many lines of `text` hold the row's own line `excerpt`: the heading is read only when exactly one does. */
export function audienceRowLineCount(text: string, excerpt: string): number {
  const own = squash(excerpt ?? "");
  if (own.length < 6) return 0;
  return text.split(/\n+/).map(squash).filter((line) => line.includes(own)).length;
}

/** The audience section heading over the row whose own line is `excerpt`, or null. Shared with Darwin's live re-check. */
export function audienceSectionHeading(text: string, excerpt: string): string | null {
  const own = squash(excerpt ?? "");
  if (own.length < 6) return null;
  const lines = text.split(/\n+/).map(squash).filter(Boolean);
  const found = lines.flatMap((line, index) => (line.includes(own) ? [index] : []));
  if (found.length !== 1) return null;
  for (let index = found[0] - 1; index >= Math.max(0, found[0] - MAX_WALK); index -= 1) {
    const line = lines[index];
    // A table's header row ("General Services | Fee", "| Service | Amount |"), with no price or value of its own,
    // starts another table: the section ends (review of #2977).
    if (line.includes("|")) {
      if (PRICE_OR_FIGURE.test(line) || VALUE_CELL.test(line)) continue;
      return null;
    }
    // A row priced in the line ("Fax Service $1", "Copy of a Check FREE").
    if (line.includes("$") || VALUE_AT_END.test(line)) continue;
    // A note on the rows ("(Youth Accounts exempt from fee)", "No fee for senior citizens (62+)", "(Not applicable if
    // Under 18 or Over 65)", "Fees waived for seniors 65+"): an exemption is no section of its own. A heading that
    // says free or waived without an audience ("Free Services", "Fees Waived for All Members") is a title and ends
    // the walk below.
    if (NOTE.test(line) || (FREE_OR_WAIVED.test(line) && AUDIENCE_SECTION.test(line))) continue;
    if (SENTENCE.test(line) || RUNS_ON.test(line) || line.split(" ").length > MAX_TITLE_WORDS) return null;
    return AUDIENCE_SECTION.test(line) && !NOT_A_SECTION.test(line) ? line : null;
  }
  return null;
}

