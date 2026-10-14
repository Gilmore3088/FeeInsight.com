import { feePageKey } from "@/lib/agents/hamilton/page-key";

/**
 * Whether two fee schedules are the same schedule, so a price that differs between them can be
 * a change rather than a second fee line. Shared by the change rule (`confirmFeeChange`), the
 * change log's like-for-like flag and the pairing pass.
 *
 * On prod (Oct 7-9, 2026) all 13 movements held by the change rule paired two different URLs.
 * Eleven were not changes: a business schedule against the consumer one (Hoosier Hills, Directions,
 * MutualOne, McClain, FFL), a changes notice read in its "fee through July 31" column (Jeanne
 * D'Arc), or two schedules with the same effective date (Tyndall). Two were real: UMassFive moved
 * its business fee page and published a 2026 edition ($30 to $40 levy, $20 to $25 wire). So:
 *   - same page (`feePageKey`, which ignores dates and version words in the URL): same schedule;
 *   - otherwise only a newer dated edition for the same audience: both URLs name the same
 *     audience (business, or consumer, or neither) and the new text's effective date is later
 *     than the old text's. Two undated or equally dated schedules on two pages stay two lines.
 */

export type ScheduleAudience = "business" | "consumer" | null;

const BUSINESS = /\b(?:business|commercial|corporate|treasury)\b/;
const CONSUMER = /\b(?:consumer|personal|retail|individual)\b/;

/** The audience a schedule's URL names, or null when it names none. */
export function scheduleAudience(url: string | null | undefined): ScheduleAudience {
  if (!url) return null;
  let path: string;
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    path = url;
  }
  // "RET" is a retail flyer's prefix (FFL-24-101-RET-Fee-Schedule).
  const words = ` ${path.toLowerCase().replace(/[^a-z]+/g, " ")} `.replace(/ ret /g, " retail ");
  if (BUSINESS.test(words)) return "business";
  if (CONSUMER.test(words)) return "consumer";
  return null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

function isoDate(year: number, month: number, day: number): string | null {
  if (year < 100) year += 2000;
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/**
 * The latest effective date a schedule states ("Effective Date: April 10, 2026", "Fees Effective
 * September 1, 2023", "Effective as of 8/1/2026"), as YYYY-MM-DD; null when it states none.
 */
export function effectiveDate(text: string | null | undefined): string | null {
  if (!text) return null;
  const dates: string[] = [];
  const effective = /effective[^.\n]{0,24}?(?:([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})|(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4}))/gi;
  for (const m of text.matchAll(effective)) {
    if (m[1]) {
      const month = MONTHS.indexOf(m[1].slice(0, 3).toLowerCase()) + 1;
      const d = month > 0 ? isoDate(Number(m[3]), month, Number(m[2])) : null;
      if (d) dates.push(d);
    } else {
      const d = isoDate(Number(m[6]), Number(m[4]), Number(m[5]));
      if (d) dates.push(d);
    }
  }
  return dates.length > 0 ? dates.sort().at(-1)! : null;
}

export type ScheduleMatch = "same_page" | "new_edition";

/** Same page, or a newer dated edition of the same audience's schedule; null for two schedules. */
export function sameSchedule(input: {
  oldUrl: string | null | undefined;
  newUrl: string | null | undefined;
  oldText: string | null | undefined;
  newText: string | null | undefined;
}): ScheduleMatch | null {
  const oldPage = feePageKey(input.oldUrl);
  if (oldPage != null && oldPage === feePageKey(input.newUrl)) return "same_page";
  if (!input.oldUrl || !input.newUrl) return null;
  if (scheduleAudience(input.oldUrl) !== scheduleAudience(input.newUrl)) return null;
  const before = effectiveDate(input.oldText);
  const after = effectiveDate(input.newText);
  return before && after && after > before ? "new_edition" : null;
}

/** True when the two URLs may be one schedule: same page, or the same audience on another page (texts decide). */
export function mayBeSameSchedule(oldUrl: string | null | undefined, newUrl: string | null | undefined): boolean | null {
  const oldPage = feePageKey(oldUrl);
  if (oldPage != null && oldPage === feePageKey(newUrl)) return true;
  if (!oldUrl || !newUrl) return false;
  return scheduleAudience(oldUrl) === scheduleAudience(newUrl) ? null : false;
}
