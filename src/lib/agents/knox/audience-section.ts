/**
 * Knox v179 (backlog dry run 10, Midwest Members FCU text 40777, lines 338-348): a section whose heading names an
 * audience by age or stage of life ("Senior Perks (60 & Over)", "Youth Accounts", "Students", "Members 65+") prices
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
const AUDIENCE_SECTION =
  /\b(?:seniors?|senior\s+citizens?|retirees?|youth|juniors?|kids?|teens?|minors?|students?|young\s+adults?)\b|\b\d{2}\s*(?:\+|&\s*(?:over|older|up)\b|and\s+(?:over|older|up|under|younger)\b)|\b(?:over|under)\s+(?:age\s+)?\d{2}\b|\bages?\s+\d{2}\b/i;
/** A row of the section: a cell, a price, or a free word. */
const SECTION_ROW = /[|$]|\b(?:free|none|no\s+charge|n\/c)\b/i;
const NOTE = /^\W*\(|\b(?:exempt(?:ed|ion)?|not\s+applicable|no\s+(?:fee|charge)s?|waived?|excepts?|except(?:ed|ion)?|excluded?)\b/i;
const SENTENCE = /[.!?;:]\s*$|[.!?;]\s+[A-Z]/;
const MAX_WALK = 25;
const MAX_TITLE_WORDS = 8;

const squash = (line: string) => line.replace(/\s+/g, " ").trim();

export function audienceSectionHeading(text: string, excerpt: string): string | null {
  const own = squash(excerpt ?? "");
  if (own.length < 6) return null;
  const lines = text.split(/\n+/).map(squash).filter(Boolean);
  const found = lines.flatMap((line, index) => (line.includes(own) ? [index] : []));
  if (found.length !== 1) return null;
  for (let index = found[0] - 1; index >= Math.max(0, found[0] - MAX_WALK); index -= 1) {
    const line = lines[index];
    // A row, or a note on the rows ("(Youth Accounts exempt from fee)", "No fee for senior citizens (62+)", "(Not
    // applicable if Under 18 or Over 65)"): an exemption is no section of its own.
    if (SECTION_ROW.test(line) || NOTE.test(line)) continue;
    if (SENTENCE.test(line) || line.split(" ").length > MAX_TITLE_WORDS) return null;
    return AUDIENCE_SECTION.test(line) ? line : null;
  }
  return null;
}

