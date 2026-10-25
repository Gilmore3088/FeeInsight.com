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
 * What one "effective" at `at` in `text` says: its date, "immediately", null when no date follows,
 * or "skip" when the sentence dates something other than this schedule.
 */
function editionAt(text: string, at: number): string | null {
  if (NOT_THE_EDITION.test(text.slice(Math.max(0, at - 60), at + 60))) return SKIP;
  const before = sentenceBefore(text, at);
  if (ANOTHER_DOCUMENT.test(before)) return SKIP;
  if (ANNOUNCED_ELSEWHERE.test(before) && !THIS_SCHEDULE.test(before)) return SKIP;
  const after = text.slice(at + "effective".length);
  if (/^\s*immediately\b/i.test(after)) return IMMEDIATELY;
  const date = dateAfterEffective(after);
  if (date && NOT_ABOUT_FEES.test(sentenceAfter(after))) return SKIP;
  return date;
}
const SKIP = "skip";
const IMMEDIATELY = "immediately";

/**
 * The edition a schedule's heading states, YYYY-MM-DD; null when none. It is the first "effective"
 * there that dates this schedule: a later "changes effective December 1, 2026" after "Effective
 * March 1, 2024" is a change the schedule announces, not its edition, and "effective immediately"
 * means it is in force now. A change notice headed "Changes effective December 1, 2026" is dated
 * by that heading. Mentions that date another document or only marked fees are skipped.
 *
 * With `lateHeading` (T1, `EDITION_LATE_HEADING_LIVE`), a heading that states no edition is followed
 * by the schedule's own title or edition line further down (`lateEdition`): a web page's first
 * `EDITION_HEAD_CHARS` characters are often its menu.
 */
export function editionStarts(text: string | null | undefined, lateHeading = EDITION_LATE_HEADING_LIVE): string | null {
  if (!text) return null;
  const head = text.slice(0, EDITION_HEAD_CHARS);
  for (const m of head.matchAll(/effective/gi)) {
    const found = editionAt(head, m.index ?? 0);
    if (found === IMMEDIATELY) return null;
    if (found && found !== SKIP) return found;
  }
  return lateHeading ? lateEdition(text) : null;
}

/**
 * How far into a stored text `lateEdition` reads. On prod (Oct 25, read-only) the deepest late
 * edition line found sat at character 5,832 (doc 36178).
 */
export const EDITION_SCAN_CHARS = 8000;

/**
 * T1 (Hamilton V5 plan, current-schedule checks): read a schedule's own edition line past the menu.
 * On since James chose "Turn it on" (Oct 25, 2026) after the dry run held one fee (finding
 * 2026-10-25-edition-line-past-the-menu). Set it false to go back to the heading alone: Darwin's
 * edition re-check then reports what it would hold (`late_heading_would_hold`) and restores the
 * fees held only on that account, and Hamilton's publish hold reads the heading only.
 */
export const EDITION_LATE_HEADING_LIVE = true;

/**
 * A title names the whole fee schedule. A bare "schedule" is any schedule ("Dividend Rate Schedule",
 * "Holiday Schedule"), and "<X> Fees" is one section or one fee's notice ("Overdraft Fees",
 * "ATM Fees"), so neither dates the page.
 */
const WHOLE_SCHEDULE =
  /\b(?:fee schedule|schedule of (?:fees|charges|service charges)|fees (?:and|&) charges|service charges|fee disclosures?)\b/i;
/**
 * An edition line that names the schedule itself before "effective": nothing but the schedule's
 * name, optionally with its audience ("Fees Effective 1/1/2027", doc 38132; "Consumer Schedule of
 * Fees - Effective …"). "Some fees", "Wire transfer fees" or a table header with other columns
 * date something narrower.
 */
const SCHEDULE_NAME_ONLY =
  /^\s*(?:(?:consumer|business|personal|commercial|retail|deposit account|account)\s+)?(?:fee schedule|schedule of (?:fees|charges|service charges)(?: and services)?|fees(?: (?:and|&) charges)?|service charges)\s*[-–:|]?\s*$/i;
/** A price on the line makes it a fee line ("Account Research - Effective 11/1/26 | $25.00 per hour"). */
const PRICED = /\$\s?\d/;
/** A table of contents entry dates a section, not the document ("Schedule of Fees and Services Effective 11.01.2026 ……44"). */
const CONTENTS_LEADER = /\.{3,}|…/;
/**
 * Words that announce an edition the page links to or previews rather than one it is: "New Fee
 * Schedule effective November 1, 2026." above a "Fee - Current" table (BayPort, doc 37226),
 * "2027 Updated Fee Schedule" in a newsletter (Wyrope, doc 36403), "Important Changes Effective …".
 */
const ANNOUNCES =
  /\b(?:new|updat\w*|upcoming|coming|soon|chang\w*|revis\w*|amend\w*|adjust\w*|waiv\w*|eliminat\w*|no more|no longer|increas\w*|decreas\w*|reduc\w*|lower\w*|propos\w*|pending|future|next year'?s?|notices?|alerts?|attention|important|press|news|pdf|download|link)\b/i;
/**
 * What may follow the date on an edition line: nothing, closing punctuation, or a footnote mark
 * ("Fees Effective 1/1/2027 * Fee will be assessed …", doc 38132). A line that goes on is a
 * sentence or a link about the schedule ("… effective January 1, 2027 are listed on our website",
 * "… Effective January 1, 2027 (PDF)"), not its edition line.
 */
const ENDS_AT_DATE = /^\s*(?:[*†‡]|[.,;)\]]*\s*$)/;
/**
 * A page that says its prices are the current ones is in effect whatever else it dates: MCCU (doc
 * 38397) links its December 1, 2026 schedule above "Current Consumer Fees are listed below and in
 * effect through November 30, 2026"; BayPort's table header is "Fee - Current".
 */
const CURRENT_PRICES =
  /\bfees?\s*[-–:|]\s*current\b|\bcurrent\s+(?:consumer\s+|business\s+|personal\s+)?(?:fees?|fee schedule|schedule of fees|prices?)\b|\bfees?\s+today\b|\bcurrent schedule\b|\b(?:in effect|effective|appl(?:y|ies)|valid)\s+(?:through|thru|until|now)\b|\bremains?\s+(?:in effect|valid)\b/i;
const TITLE_MAX_CHARS = 80;

/**
 * Pure: the edition a schedule states on its own title or edition line after its first
 * `EDITION_HEAD_CHARS` characters, up to `EDITION_SCAN_CHARS`; null when none or unclear. A line
 * counts when it has "effective <date>", no price and no table-of-contents leader, and either names
 * the schedule before "effective" ("Fees Effective 1/1/2027", doc 38132) or is only the edition
 * right under a short schedule title ("FEE SCHEDULE" / "Effective January 1st, 2027", doc 36178;
 * at most one blank line between). The heading's filters apply (another document, marked fees,
 * privacy, branch hours) and announcement words skip a line. Null when the page calls its prices
 * current, or when its edition lines disagree: a page that dates two editions is not judged here.
 */
export function lateEdition(text: string | null | undefined): string | null {
  if (!text || text.length <= EDITION_HEAD_CHARS) return null;
  const window = text.slice(0, EDITION_SCAN_CHARS);
  if (CURRENT_PRICES.test(window)) return null;
  const lines = window.slice(EDITION_HEAD_CHARS).split("\n");
  const dates = new Set<string>();
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!/effective/i.test(line) || PRICED.test(line) || CONTENTS_LEADER.test(line)) continue;
    let above = i - 1;
    if (above >= 0 && lines[above].trim() === "") above -= 1;
    const title = above >= 0 ? lines[above].trim() : "";
    // A notice or announcement title above makes the line part of it ("Notice to Members").
    if (ANNOUNCES.test(title)) continue;
    const shortHeading = title.length > 0 && title.length <= TITLE_MAX_CHARS && !PRICED.test(title);
    const underTitle = shortHeading && WHOLE_SCHEDULE.test(title);
    // Under another heading ("Overdraft Fees", "IRA Fees", "Checking"), "Fees Effective …" dates
    // that section. Doc 38132's line sits under a priced row, not a heading, and still counts.
    const underOtherHeading = shortHeading && !underTitle;
    for (const m of line.matchAll(/effective/gi)) {
      const at = m.index ?? 0;
      const before = line.slice(0, at);
      if (ANNOUNCES.test(before)) continue;
      // "Business Fee Schedule - Effective …" names itself; a bare "Fees" or "Service Charges" needs no other heading above it.
      const named = SCHEDULE_NAME_ONLY.test(before) && (/\bfee schedule\b|\bschedule of\b/i.test(before) || !underOtherHeading);
      if (!named && !(underTitle && before.trim() === "")) continue;
      const after = line.slice(at + "effective".length);
      // "Effective through December 31, 2026" ends an edition; it does not start one.
      if (/^\s*(?:through|thru|until|till)\b/i.test(after)) continue;
      const dated = DATE_AFTER_EFFECTIVE.exec(after);
      if (dated && !ENDS_AT_DATE.test(after.slice(dated[0].length))) continue;
      const found = editionAt(line, at);
      if (found === IMMEDIATELY) return null;
      if (found && found !== SKIP) dates.add(found);
    }
  }
  return dates.size === 1 ? [...dates][0] : null;
}

/**
 * SQL: the part of a stored text column an edition reader needs. The heading alone, unless the rest
 * of the window has an "effective" dated in `today`'s year or the next two; only those texts can have
 * a late edition line that holds or restores a fee, so only they carry `EDITION_SCAN_CHARS`
 * characters, and `lateEdition` decides. An older edition whose only edition line is late and dated
before this year is cut to its heading, so `editionTakesOver` misses that retirement (it never
takes a fee down wrongly). The prefilter is only the date: adding the fee word before
 * it cost about 4 s more on prod (Oct 25) for half the bytes (982 of 9,133 documents, 6.3 MB, against
 * 493 and 3.0 MB). `column` is a trusted column name, never user text.
 */
export function editionWindowSql(column: string, today: string): string {
  const year = Number(today.slice(0, 4));
  const years = [year, year + 1, year + 2];
  const dated = `effective[^\\n$]{0,40}(?:${years.join("|")}|[/.-](?:${years.map((y) => String(y).slice(2)).join("|")})\\M)`;
  return `CASE WHEN substr(${column}, ${EDITION_HEAD_CHARS + 1}, ${EDITION_SCAN_CHARS - EDITION_HEAD_CHARS}) ~* '${dated}' THEN left(${column}, ${EDITION_SCAN_CHARS}) ELSE left(${column}, ${EDITION_HEAD_CHARS}) END`;
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
export function notYetEffective(text: string | null | undefined, today: string, lateHeading = EDITION_LATE_HEADING_LIVE): string | null {
  const starts = editionStarts(text, lateHeading);
  return starts != null && starts > today ? starts : null;
}

/** The audience an edition's address names: "ScheduleofFeesPersonal-2024-1.pdf" names its audience once its words are split. */
export function editionAudience(url: string): ScheduleAudience {
  return scheduleAudience(url.replace(/([a-z])([A-Z])/g, "$1-$2"));
}

/**
 * On its effective date an announced edition takes over: the older edition's line of the same fee
 * comes down. True when `newer` is a later edition than `older` for the same audience, both headings
 * state their edition, the newer one was first read before it took effect (`newerFirstRead`, so it
 * is an edition announced ahead, the #1915 case) and it is in effect by `today`. Two copies of one
 * page, or two undated schedules, are left to the page-copy collapse and the same-page supersede.
 * An older edition left live beside one first read after it took effect, or beside one whose
 * heading states no "Effective" date, is Darwin's dated-edition rule's (`darwin/dated-edition.ts`,
 * #1945): it dates each document by the date its own text states and pairs only two documents that
 * are one schedule, since on prod (Oct 20) a wider pairing here also paired one bank's schedules for
 * two products (PNC).
 */
export function editionTakesOver(input: {
  olderUrl: string | null | undefined;
  newerUrl: string | null | undefined;
  olderText: string | null | undefined;
  newerText: string | null | undefined;
  /** The day the newer document was first read, YYYY-MM-DD. */
  newerFirstRead: string | null | undefined;
  today: string;
  /** Read an edition line past the menu too (`lateEdition`); defaults to `EDITION_LATE_HEADING_LIVE`. */
  lateHeading?: boolean;
}): boolean {
  if (!input.olderUrl || !input.newerUrl || !input.newerFirstRead) return false;
  if (editionAudience(input.olderUrl) !== editionAudience(input.newerUrl)) return false;
  const late = input.lateHeading ?? EDITION_LATE_HEADING_LIVE;
  const older = editionStarts(input.olderText, late);
  const newer = editionStarts(input.newerText, late);
  return older != null && newer != null && older < newer && input.newerFirstRead < newer && newer <= input.today;
}
