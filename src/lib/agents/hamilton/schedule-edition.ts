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

/**
 * How far into a schedule's text its own edition line is read. A schedule states its edition in
 * its heading ("AVIDIA BANK\nSCHEDULE OF FEES – CONSUMER ACCOUNTS\nEffective December 1, 2026");
 * a date further down is a change it announces for one line ("will be effective on August 1"),
 * which Knox reads with the line, not the whole document.
 */
export const EDITION_HEAD_CHARS = 400;

/**
 * An "effective" sentence that dates something other than the schedule: a privacy policy in a
 * page's banner (South Story's "The effective date is November 1, 2026"), or only the fees a
 * schedule marks ("Highlighted fees will be effective February 1, 2027": the rest are current).
 */
const NOT_THE_EDITION = /\b(?:privacy|policy|policies|terms of use|highlighted|marked|indicated|shaded|bolded)\b/i;

/**
 * Words before "effective", in the same sentence, that make its date another document's: a banner
 * linking to the next schedule (Materion's "Click Here to Review our updated Fee Schedule which will
 * be effective 11/1/2026", docs 16785 and 29942), or the edition this one replaces ("Supersedes the
 * schedule effective March 2024"). "This schedule will be effective …" is the schedule's own date.
 */
const ANOTHER_DOCUMENT =
  /\b(?:click|review|see|view|visit|download|refer to|supersed\w*|replac\w*|previous(?:ly)?|prior|formerly)\b/i;
const ANNOUNCED_ELSEWHERE = /\bwill\s+(?:be(?:come)?|take)\s*$/i;
const THIS_SCHEDULE = /\bth(?:is|ese)\b/i;

/**
 * Words in the rest of the sentence that make the date a branch's or office's, not a schedule's
 * (Land of Lincoln's banner "Effective November 14th, 2026, the LLCU Branch … will have reduced
 * drive-up hours", docs 34818 and 34819).
 */
const NOT_ABOUT_FEES = /\b(?:branch(?:es)?|lobby|drive-?(?:up|thru|through)|hours|closed|closing|holiday|relocat\w*)\b/i;

const MONTH = "\\b(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\\.?";

/**
 * The date right after one "effective": "March 1, 2024", "Dec 1 2026", "1 December 2026",
 * "2026-12-01", "12/1/2026" or "December 2026" (its first day). The words between ("Date:", "as of",
 * "on") stop at a digit or a sentence end, so a later sentence's date is never read for this one.
 */
const DATE_AFTER_EFFECTIVE = new RegExp(
  "^[^\\n\\d.;]{0,24}?(?:" +
    `${MONTH}\\s+(\\d{1,2})(?:st|nd|rd|th)?,?\\s+(\\d{4})` +
    `|(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH},?\\s+(\\d{4})` +
    "|(\\d{4})-(\\d{1,2})-(\\d{1,2})" +
    "|(\\d{1,2})[/.-](\\d{1,2})[/.-](\\d{2,4})" +
    `|${MONTH},?\\s+(\\d{4})` +
    ")",
  "i",
);

function monthNumber(name: string): number {
  return MONTHS.indexOf(name.slice(0, 3).toLowerCase()) + 1;
}

/** The date following one "effective" (`after` is the text after the word); null when none. */
function dateAfterEffective(after: string): string | null {
  const m = DATE_AFTER_EFFECTIVE.exec(after);
  if (!m) return null;
  if (m[1]) return isoDate(Number(m[3]), monthNumber(m[1]), Number(m[2]));
  if (m[5]) return isoDate(Number(m[6]), monthNumber(m[5]), Number(m[4]));
  if (m[7]) return isoDate(Number(m[7]), Number(m[8]), Number(m[9]));
  if (m[10]) return isoDate(Number(m[12]), Number(m[10]), Number(m[11]));
  return isoDate(Number(m[14]), monthNumber(m[13]), 1);
}

/** The sentence's words before position `at`: back to the last line break or sentence end. */
function sentenceBefore(head: string, at: number): string {
  const before = head.slice(0, at);
  const breakAt = Math.max(before.lastIndexOf("\n"), before.search(/\.\s[^.]*$/));
  return before.slice(breakAt + 1);
}

/** The sentence's words after "effective": up to the next line break or sentence end. */
function sentenceAfter(after: string): string {
  const end = after.search(/\n|\.\s/);
  return end < 0 ? after : after.slice(0, end);
}

/**
 * The edition a schedule's heading states, YYYY-MM-DD; null when none. It is the first "effective"
 * there that dates this schedule: a later "changes effective December 1, 2026" after "Effective
 * March 1, 2024" is a change the schedule announces, not its edition, and "effective immediately"
 * means it is in force now. A change notice headed "Changes effective December 1, 2026" is dated
 * by that heading. Mentions that date another document or only marked fees are skipped.
 */
export function editionStarts(text: string | null | undefined): string | null {
  if (!text) return null;
  const head = text.slice(0, EDITION_HEAD_CHARS);
  for (const m of head.matchAll(/effective/gi)) {
    const at = m.index ?? 0;
    if (NOT_THE_EDITION.test(head.slice(Math.max(0, at - 60), at + 60))) continue;
    const before = sentenceBefore(head, at);
    if (ANOTHER_DOCUMENT.test(before)) continue;
    if (ANNOUNCED_ELSEWHERE.test(before) && !THIS_SCHEDULE.test(before)) continue;
    const after = head.slice(at + m[0].length);
    if (/^\s*immediately\b/i.test(after)) return null;
    const date = dateAfterEffective(after);
    if (date && NOT_ABOUT_FEES.test(sentenceAfter(after))) continue;
    if (date) return date;
  }
  return null;
}

/** The calendar day of `now` in UTC, YYYY-MM-DD. */
export function isoDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * The date a schedule takes effect when that is after `today` (#1915: Avidia's December 1, 2026
 * schedule went live beside its March 2024 one in October); null for a schedule in effect or one
 * whose heading states no edition. Its prices are not charged yet, so its rows stay out of the live
 * catalog until that day, when this returns null and they publish.
 */
export function notYetEffective(text: string | null | undefined, today: string): string | null {
  const starts = editionStarts(text);
  return starts != null && starts > today ? starts : null;
}

/**
 * On its effective date an announced edition takes over: the older edition's line of the same fee
 * comes down. True when `newer` is a later edition than `older` for the same audience, both headings
 * state their edition, the newer one was first read before it took effect (`newerFirstRead`, so it
 * is an edition announced ahead, the #1915 case) and it is in effect by `today`. Two copies of one
 * page, or two undated schedules, are left to the page-copy collapse and the same-page supersede.
 * An older edition left live beside one first read after it took effect is #1911's, not this rule's:
 * on prod (Oct 20) that wider pairing also paired one bank's schedules for two products (PNC).
 */
export function editionTakesOver(input: {
  olderUrl: string | null | undefined;
  newerUrl: string | null | undefined;
  olderText: string | null | undefined;
  newerText: string | null | undefined;
  /** The day the newer document was first read, YYYY-MM-DD. */
  newerFirstRead: string | null | undefined;
  today: string;
}): boolean {
  if (!input.olderUrl || !input.newerUrl || !input.newerFirstRead) return false;
  // "ScheduleofFeesPersonal-2024-1.pdf" names its audience once its words are split.
  const audience = (url: string) => scheduleAudience(url.replace(/([a-z])([A-Z])/g, "$1-$2"));
  if (audience(input.olderUrl) !== audience(input.newerUrl)) return false;
  const older = editionStarts(input.olderText);
  const newer = editionStarts(input.newerText);
  return older != null && newer != null && older < newer && input.newerFirstRead < newer && newer <= input.today;
}
