import type { sql } from "@/lib/data-store/connection";
import { EDITION_SCAN_CHARS, editionStarts, effectiveDate } from "@/lib/agents/hamilton/schedule-edition";

type SqlTag = typeof sql;

/**
 * A schedule's own date, kept apart from when it was read (#1878).
 *
 * A fetch date says when Magellan last asked for a page, not how old the schedule is: a fee PDF
 * named "...-2022.pdf" fetched yesterday still prices 2022. Public pages only showed the read
 * date, which made an old schedule look current. This pass reads the date the document states
 * from its stored text (`agent_source_texts`), records it on the document
 * (`source_documents.stated_date`, `stated_date_basis`, `stated_date_version`; migration
 * 20270110000077) and marks a schedule dated more than `STALE_STATED_MONTHS` ago for the
 * freshness search (`discovery.ts`, `selectStaleCandidates`), which looks for a newer schedule
 * and replaces the bank's link only when a different page passes the fee-page check and does not
 * state an earlier or equal date, nor leave out a date the old text states (`statedDateReplaces`).
 *
 * Deterministic, no provider. The date is the latest one the opening `STATED_DATE_SCAN_CHARS`
 * characters state:
 *   - `effective_statement`: an "Effective ..." date, read by Hamilton's own readers in
 *     `hamilton/schedule-edition.ts`, so there is one rule: the latest `effectiveDate()` anywhere in
 *     the window, or the edition `editionStarts()` reads (the heading, then the schedule's own
 *     edition line past a web page's menu, #2573/#2605), whichever is later; the words around that
 *     "effective" are kept as evidence. An "effective" that dates rates ("Rates effective
 *     September 1, 2024", "Dividend rates are effective ...") is not the schedule's date and is
 *     masked before Hamilton's readers see it (#2615 review: riegelfcu.org, docs 2797/14512/27687);
 *   - `printed_date`: a "Revised ...", "Rev. ..." or "Updated ..." date printed on it, or a line
 *     saying when it was current ("As of January 1, 2026" heading a schedule, "FEES CURRENT AS OF:
 *     August 3, 2026", "accurate as of October 12, 2026", "Disclosure Date: 10/01/2026"). A
 *     currency line dates the whole document as printed, so "Interest Rates ... are current as of
 *     02/27/2026" counts too (doc 32498): the document was reissued with its fees on that day;
 *   - `url_year`: only when the text states no date at all, the latest year 2000-2029 its address
 *     names (only the year is known, stored as 1 January; it counts as old only once the whole year
 *     is). An upload folder's year ("/uploads/2017/08/feeschedule.pdf") is when a file at that
 *     address was first put up, not the schedule's date (doc 2282 says "As of January 1, 2026");
 *   - `none`: nothing found (the date stays null). A text whose only date is a rate's effective
 *     date is `none` too: it states a date, so the address is not read, but not the schedule's.
 * The latest date wins, so a schedule that announces a later change or prints a later revision
 * counts as newer: the rule can call a schedule current that is old, never the reverse.
 *
 * The freshness search uses the same reader on the page it would put in place of an old one: a
 * page that states a date replaces the link only when it is later; an undated page is refused only
 * when the old document's text states a date (`statedDateReplaces`).
 *
 * Before the migration is applied the columns do not exist: `statedDateColumnsReady` is false, the
 * pass reads and writes nothing (`schema_ready: false` in the step detail) and the freshness search
 * leaves out its stated-date arm, so either can merge and run first.
 */
/**
 * v2 (Nov 2, 2026 audit): the reader `readStatedDateV2` (below). On prod, 3,537 of the 6,597 current
 * copies behind live fees had no date; a 250-document sample of them found the schedule's own date
 * past the first 8,000 characters (a menu-heavy page's "Fee Schedule: Effective 2/1/2026"), in a
 * footer stamp ("Rev. 06/2021", "M619 01.2026 ©DCU", "03/01/2025 Member FDIC"), as a month and year
 * ("Effective July, 2024", "Effective 11/2026"), misspelt ("Efective March 6, 2024"), or in a
 * heading ("Approved February 22, 2022", "Schedule of Fees revised as of May 1, 2026").
 *
 * A stated date feeds Darwin's dated-edition takeover (live), which retires an older edition's fee
 * lines, so the v2 reader writes nothing until `STATED_DATE_BACKFILL_LIVE` is on: until then the
 * pass dates new documents with v1, as before, and reads a rotating batch of v1 documents with v2
 * as a dry run (`backfill` in the step detail: what it would newly date or change, with samples).
 * On, the pass writes `STATED_DATE_READER_VERSION`, and its selector (version below it) re-reads
 * every v1 document, live-fee documents first, `STATED_DATES_PER_STEP` a discover step: the
 * backfill. Consumers read any version from `STATED_DATE_FIRST_VERSION`, so a document not yet
 * re-read keeps its v1 date.
 */
export const STATED_DATE_BACKFILL_LIVE = false;
/** The newest reader. */
export const STATED_DATE_READER_VERSION = 2;
/** The oldest version a reader of the columns accepts: every version since dates the same way, only better. */
export const STATED_DATE_FIRST_VERSION = 1;
/** The version the pass writes now, and below which it re-reads a document. */
export const STATED_DATE_VERSION = STATED_DATE_BACKFILL_LIVE ? STATED_DATE_READER_VERSION : 1;
/** How much of each stored text v2 reads for a schedule-named or footer date past the opening. */
export const STATED_DATE_DEEP_CHARS = 60_000;
/** v2 refuses a date more than this many days after today: a promotion's end or a loan's maturity, not the schedule's edition. */
export const STATED_DATE_FUTURE_DAYS = 60;
/** v1 documents the dry run reads with v2 per discover step while the backfill is off. */
export const STATED_DATE_BACKFILL_SHADOW_PER_STEP = 100;
/** The dry-run backfill reads its batch on one discover step in this many (by step id), not every step. */
export const STATED_DATE_BACKFILL_SHADOW_EVERY = 6;
/** How much of each stored text is read for its date: as far as Hamilton reads an edition line. */
export const STATED_DATE_SCAN_CHARS = EDITION_SCAN_CHARS;
/** A schedule dated longer ago than this is sent to the freshness search. */
export const STALE_STATED_MONTHS = 24;
/** Documents dated per discover step. */
export const STATED_DATES_PER_STEP = 200;
export const STATED_DATE_EVENT = "magellan.stated_dates";

export type StatedDateBasis = "effective_statement" | "printed_date" | "url_year" | "none";

export interface StatedDate {
  /** YYYY-MM-DD, or null when the document states none. */
  date: string | null;
  basis: StatedDateBasis;
  /** The words the date was read from ("Effective January 1, 2022"), or the address's year. */
  evidence: string | null;
}

const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];

/** A real calendar day as YYYY-MM-DD (a two-digit year is 20xx), or null. */
export function calendarDate(year: number, month: number, day: number): string | null {
  if (year < 100) year += 2000;
  if (!Number.isInteger(year) || !Number.isInteger(month) || !Number.isInteger(day)) return null;
  if (year < 1990 || year > 2100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
  const at = new Date(Date.UTC(year, month - 1, day));
  if (at.getUTCMonth() !== month - 1) return null; // "February 31"
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function monthOf(word: string | undefined): number {
  return word ? MONTHS.indexOf(word.slice(0, 3).toLowerCase()) + 1 : 0;
}

/** "Revised 03/2021", "Rev. 1/15/2022", "Updated: January 2023", "Last updated March 3, 2024". */
const PRINTED =
  /\b(?:revised|rev\.|updated)\s*(?:on|date)?\s*:?\s*(?:([a-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})|(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})|(\d{1,2})[/.-](\d{4})|([a-z]{3,9})\.?,?\s+(\d{4}))(?!\d)/gi;

/**
 * A line saying when the document was current: "As of January 1, 2026" at the start of a line, or
 * "current / accurate / correct / valid / updated as of ...", or "Disclosure Date: ...". A bare
 * "as of" inside a sentence ("accounts opened as of May 1, 2015") dates something else.
 */
const CURRENCY = /(?:^[ \t>*•|-]*|\b(?:current|currently|accurate|correct|valid|updated|true)\s+)as\s+of\b\s*:?|\b(?:disclosure date|date of (?:this )?disclosure)\b\s*:?/gim;
/**
 * The date after a currency phrase. The words between carry no digit and no sentence end and may
 * cross one line break: a two-column PDF prints "is current as of" / "Schedule of Fees | September
 * 17, 2026." (doc 2307).
 */
const MONTH_NAME = "(jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)";
const CURRENCY_DATE = new RegExp(
  String.raw`^(?:[^\d.;\n]{0,30}\n)?[^\d.;\n]{0,30}?(?:` +
    String.raw`\b${MONTH_NAME}\.?\s+(\d{1,2})\s?(?:st|nd|rd|th)?,?\s+(\d{4})` +
    String.raw`|(\d{4})-(\d{1,2})-(\d{1,2})` +
    String.raw`|(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})` +
    String.raw`|(\d{1,2})[/.-](\d{4})` +
    String.raw`|\b${MONTH_NAME}\.?,?\s+(\d{4})` +
    String.raw`)(?!\d)`,
  "i",
);

function currencyDates(head: string, skipRateLines = false): Found[] {
  const found: Found[] = [];
  for (const m of head.matchAll(CURRENCY)) {
    const start = m.index ?? 0;
    const end = start + m[0].length;
    const d = CURRENCY_DATE.exec(head.slice(end, end + 80));
    if (!d) continue;
    // "As of April 1, 2014, new Silver accounts ..." opens a sentence about one product (doc 31175),
    // not a heading: a line-start "As of" counts only when its date ends the clause.
    const lineStart = !/\S\s+as\s+of/i.test(m[0]) && !/disclosure/i.test(m[0]);
    if (lineStart && /^,\s*[a-z]/i.test(head.slice(end + d[0].length))) continue;
    if (skipRateLines && rateOnlySentence(head, start, end + d[0].length)) continue;
    let date: string | null = null;
    if (d[1]) date = calendarDate(Number(d[3]), monthOf(d[1]), Number(d[2]));
    else if (d[4]) date = calendarDate(Number(d[4]), Number(d[5]), Number(d[6]));
    else if (d[7]) date = calendarDate(Number(d[9]), Number(d[7]), Number(d[8]));
    else if (d[10]) date = calendarDate(Number(d[11]), Number(d[10]), 1);
    else if (d[12]) date = calendarDate(Number(d[13]), monthOf(d[12]), 1);
    if (date) found.push({ date, evidence: evidenceOf(head.slice(start, end + d[0].length)) });
  }
  return found;
}

/** Words that make an "effective" a rate's date: rates, APYs, dividends, interest, yields. */
const RATE_WORDS = /\b(?:rates?|apys?|apr|annual percentage (?:yields?|rates?)|dividends?|interest|yields?)\b/i;
/** Words that keep it the schedule's: "Fees and rates effective ...". */
const FEE_WORDS = /\b(?:fees?|charges?|schedule|services?)\b/i;
const RATE_MASK = "_".repeat("effective".length);

/** The sentence around `head[start, end)`: from the last sentence end on its line to the next one after it. */
function sentenceAround(head: string, start: number, end: number): string {
  const lineStart = head.lastIndexOf("\n", start - 1) + 1;
  const before = head.slice(lineStart, start).split(/[.;!?]\s/).at(-1) ?? "";
  const restEnd = head.slice(end).search(/\n|[.;!?](?:\s|$)/);
  return `${before}${head.slice(start, restEnd < 0 ? head.length : end + restEnd)}`;
}

/**
 * True when the sentence around a dated line names rates (rates, APY, dividends, interest, yields)
 * and not fees or a schedule: "Rates current as of October 24, 2026", "Interest Rates and Annual
 * Percentage Yields are current as of 02/27/2026". A page that stamps today's date on its rate
 * table says when the rates were set, not that its fees are new (#2615 review).
 */
function rateOnlySentence(head: string, start: number, end: number): boolean {
  const sentence = sentenceAround(head, start, end);
  return RATE_WORDS.test(sentence) && !FEE_WORDS.test(sentence);
}

/**
 * The text with each "effective" that dates rates blanked out (same length, so Hamilton's readers
 * see the same positions), and whether any of those blanked ones carried a date. A rate's
 * "effective" is one whose sentence names rates before it, or starts with it and names rates, and
 * names no fees or schedule (#2615 review: "Rates effective September 1, 2024" over "FEES CURRENT AS
 * OF: August 3, 2026"). `strict` masks any "effective" whose sentence names rates and no fees, for
 * the page the freshness search found (`statedDateReplaces`). Hamilton's own `effectiveDate()` is
 * shared with Darwin and is left as is.
 */
export function maskRateEffective(head: string, strict = false): { masked: string; rateDated: boolean } {
  let rateDated = false;
  const masked = head.replace(/effective/gi, (word: string, at: number) => {
    const lineStart = head.lastIndexOf("\n", at - 1) + 1;
    const before = head.slice(lineStart, at).split(/[.;!?]\s/).at(-1) ?? "";
    const restEnd = head.slice(at).search(/\n|[.;!?]\s/);
    const sentence = `${before}${head.slice(at, restEnd < 0 ? head.length : at + restEnd)}`;
    // Strict (a page found to replace a link): any rate sentence without fee words, wherever it names rates.
    const aboutRates = strict || before.trim() === "" ? RATE_WORDS.test(sentence) : RATE_WORDS.test(before);
    if (!aboutRates || FEE_WORDS.test(sentence)) return word;
    if (effectiveDate(head.slice(at, at + 60))) rateDated = true;
    return RATE_MASK;
  });
  return { masked, rateDated };
}

/** A year in the address ("/2022-fee-schedule.pdf", "/uploads/2021/05/"), as the freshness search reads it. */
const URL_YEAR = /(?:^|[^0-9])(20[0-2][0-9])(?=[^0-9]|$)/g;

interface Found {
  date: string;
  evidence: string;
}

function evidenceOf(match: string): string {
  return match.replace(/\s+/g, " ").trim().slice(0, 120);
}

/** A YYYY-MM-DD string that is a real calendar day ("2023-02-31" is not). */
function realDay(iso: string | null): string | null {
  if (!iso) return null;
  const [year, month, day] = iso.split("-").map(Number);
  return calendarDate(year, month, day) === iso ? iso : null;
}

/** The words of the first "effective" in `head` that dates `date` (it was read by Hamilton's readers). */
function effectiveEvidence(head: string, date: string): string {
  for (const m of head.matchAll(/effective/gi)) {
    const words = head.slice(m.index ?? 0, (m.index ?? 0) + 80).split(/\n|\.\s/)[0];
    if (effectiveDate(words) === date || editionStarts(words, false) === date) return evidenceOf(words);
  }
  return `Effective ${date}`;
}

/** The latest "Effective ..." date, by Hamilton's `effectiveDate()` and `editionStarts()`; null when none. */
function effectiveStatement(head: string): Found | null {
  const dates = [effectiveDate(head), editionStarts(head)].map(realDay).filter((d): d is string => d != null);
  if (dates.length === 0) return null;
  const date = dates.sort().at(-1)!;
  return { date, evidence: effectiveEvidence(head, date) };
}

function printedDates(head: string, skipRateLines = false): Found[] {
  const found: Found[] = [];
  for (const m of head.matchAll(PRINTED)) {
    if (skipRateLines && rateOnlySentence(head, m.index ?? 0, (m.index ?? 0) + m[0].length)) continue;
    let date: string | null = null;
    if (m[1]) date = calendarDate(Number(m[3]), monthOf(m[1]), Number(m[2]));
    else if (m[4]) date = calendarDate(Number(m[6]), Number(m[4]), Number(m[5]));
    else if (m[7]) date = calendarDate(Number(m[8]), Number(m[7]), 1);
    else if (m[9]) date = calendarDate(Number(m[10]), monthOf(m[9]), 1);
    if (date) found.push({ date, evidence: evidenceOf(m[0]) });
  }
  return found;
}

/** The latest year 2000-2029 the address names, up to `thisYear`; null when none. */
export function urlYear(url: string | null | undefined, thisYear: number): number | null {
  if (!url) return null;
  let address = url;
  try {
    address = decodeURIComponent(url);
  } catch {
    // keep the raw address
  }
  const years = [...address.matchAll(URL_YEAR)].map((m) => Number(m[1])).filter((year) => year <= thisYear);
  return years.length > 0 ? Math.max(...years) : null;
}

function latest(found: Found[]): Found | null {
  return found.reduce<Found | null>((best, item) => (best == null || item.date > best.date ? item : best), null);
}

/**
 * The date a document states (see the file comment). Pure. `skipRateLines` (the page the freshness
 * search found, `statedDateReplaces`) leaves out every dated line whose sentence names rates and
 * not fees or a schedule: a revised, current-as-of or effective line about rates. The stored
 * documents are read without it: doc 32498's only date is "Interest Rates and Annual Percentage
 * Yields are current as of 02/27/2026", printed under its fee table, and the fee table's own
 * "Fees/Rate Chart | updated 06/2024" would call it old.
 */
export function readStatedDate(
  text: string | null | undefined,
  url: string | null | undefined,
  now = new Date(),
  options: { skipRateLines?: boolean } = {},
): StatedDate {
  const skip = options.skipRateLines === true;
  const { masked: head, rateDated } = maskRateEffective((text ?? "").slice(0, STATED_DATE_SCAN_CHARS), skip);
  const effective = effectiveStatement(head);
  const printed = latest([...printedDates(head, skip), ...currencyDates(head, skip)]);
  if (effective && (!printed || effective.date >= printed.date)) {
    return { date: effective.date, basis: "effective_statement", evidence: effective.evidence };
  }
  if (printed) return { date: printed.date, basis: "printed_date", evidence: printed.evidence };
  // A text that states a date (here only a rate's) is never dated by its address.
  const year = rateDated ? null : urlYear(url, now.getUTCFullYear());
  if (year != null) return { date: `${year}-01-01`, basis: "url_year", evidence: String(year) };
  return { date: null, basis: "none", evidence: null };
}

// ---------------------------------------------------------------------------------------------
// v2 reader (STATED_DATE_READER_VERSION). Every phrasing below is one found on prod (Nov 2 audit,
// 250 current copies behind live fees that v1 left undated); doc ids are in the tests.
// ---------------------------------------------------------------------------------------------

/** A broken ligature or a typo of "effective": "Eff ective: 5/1/2024" (doc 2671), "Efective March 6, 2024" (doc 22719). */
const EFFECTIVE_SPELLINGS = /\be(?:ff ?|f)ective\b/gi;

/** Month and year only: "Effective July, 2024" (doc 25625), "Effective: December, 2022" (15900), "Effective 11/2026" (13446), "effective as of March 2025" (33648). */
const EFFECTIVE_MONTH_YEAR = new RegExp(
  String.raw`^effective(?:\s+date)?(?:\s+as\s+of)?\s*:?\s*(?:\b${MONTH_NAME}\.?,?\s+(\d{4})|(\d{1,2})[/.](\d{4}))(?![\d/.]\d)`,
  "i",
);

/**
 * v2's printed-date words: v1's "revised", "rev." and "updated", plus "rev" without its period
 * ("rev 05.01.2023", doc 22705), "reviewed" ("Reviewed: February 1, 2019", doc 40185), "revision
 * date", "last updated", "revised as of" ("Schedule of Fees revised as of May 1, 2026", doc 37216)
 * and a two-digit year ("Revised 1/15/22"). Only real month names count.
 */
const PRINTED_V2 = new RegExp(
  String.raw`(?<![a-z])(?:last\s+)?(?:revised|rev\b\.?|reviewed|revision(?:\s+date)?|updated)\s*(?:on|date|as\s+of)?\s*:?\s*(?:` +
    String.raw`\b${MONTH_NAME}\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})` +
    String.raw`|(\d{1,2})[/.-](\d{1,2})[/.-](\d{4}|\d{2})` +
    String.raw`|(\d{1,2})[/.-](\d{4})` +
    String.raw`|\b${MONTH_NAME}\.?,?\s+(\d{4})` +
    String.raw`)(?![\d/])`,
  "gi",
);

/** The whole schedule named: "Fee Schedule", "Schedule of Fees", "Fees and Charges", "Fee Disclosure". */
const SCHEDULE_NAME =
  /\b(?:fee schedule|schedule of (?:fees|charges|service charges)|fees? (?:and|&) charges|fee disclosures?|service charges|summary of fees|(?:fee|charge)s? (?:list|summary))\b/i;
/** A line about another document, a rate or a loan: its date is not the fee schedule's. */
const OTHER_DOCUMENT = /\b(?:privacy|policy|model|agreement|terms|rates?|apys?|apr|dividends?|loans?|promotion|offer)\b/i;

/**
 * A line past the opening whose date is the schedule's: it names the whole schedule, or opens with
 * "Fees" ("Fees effective as of: Feb 1, 2023", doc 41210), and names no other document, rate or
 * loan. A line naming one fee ("Wire transfer fee effective January 1, 2027 will increase") dates
 * that fee's change, not the schedule (#2904 review).
 */
function scheduleDatesLine(line: string): boolean {
  return (SCHEDULE_NAME.test(line) || /^\W*(?:all\s+)?fees\b/i.test(line)) && !OTHER_DOCUMENT.test(line);
}

/** A footer or form mark near a bare stamp: "Member FDIC", "Insured by NCUA", "©DCU", "Page 1 of 5", a web address. */
const FOOTER_MARK = /\b(?:fdic|ncua|equal housing|page \d+ of \d+)\b|©|\bwww\.|\.(?:com|org|coop|bank)\b/i;
/** A copyright line: its dates say when a site or form was copyrighted, not the schedule's edition ("Copyright 2024 | 10/2024 | Member FDIC", #2904 review). */
const COPYRIGHT = /\bcopyright\b|©\s*\d{4}|\(c\)\s*\d{4}/i;
/** Words that make a lone date a post's or an event's ("Latest News" / "October 15, 2026", #2904 review). */
const NEWS_WORDS = /\b(?:news|posted|posts?|blog|articles?|press|announce(?:s|d|ment)?|events?|holidays?|closed|webinar|story)\b/i;
/** A form code or version mark before a stamp: "M619", "v", "Rev.". */
const STAMP_PREFIX = String.raw`(?:(?:v|rev)\.?\s*|[a-z]{1,6}-?\d{1,5}[a-z]?\s+)?`;
const STAMP_SUFFIX = String.raw`(?:\s*©.*|\s+(?:member fdic|equal housing|federally insured|insured by ncua).*)?`;
/** A bare month/year stamp: "07/2025", "7/2022", "M619 01.2026 ©DCU". */
const STAMP_MONTH_YEAR = new RegExp(String.raw`^${STAMP_PREFIX}(\d{1,2})[/.](20[0-2]\d)${STAMP_SUFFIX}$`, "i");
/** A full-date stamp in a footer cell: "03/01/2025 Member FDIC" (doc 12804), "v 09/01/26" beside "Page 1 of 5" (doc 20863). */
const STAMP_FULL_DATE = new RegExp(String.raw`^${STAMP_PREFIX}(\d{1,2})[/.](\d{1,2})[/.](20[0-2]\d|[0-2]\d)${STAMP_SUFFIX}$`, "i");

/** How far into the text a heading's date is read. */
const HEADING_CHARS = 400;
const HEADING_DATE = new RegExp(
  String.raw`^\W*(?:(?:board\s+)?approved\s*:?\s*|dated?\s*:?\s*)?(?:` +
    String.raw`${MONTH_NAME}\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})` +
    String.raw`|${MONTH_NAME}\.?,?\s+(\d{4})` +
    String.raw`|(\d{1,2})/(\d{1,2})/(\d{4})` +
    String.raw`)\W*$`,
  "i",
);
/** A title that names the schedule with its date: "Schedule of Fees for Consumer Accounts & Services (October 1, 2026)" (doc 20113). */
const TITLE_WITH_DATE = new RegExp(
  String.raw`\b(?:fee schedule|schedule of (?:fees|charges|service charges)|fees (?:and|&) charges)\b[^\n]*?[(\-–—]\s*${MONTH_NAME}\.?\s+(\d{1,2}),?\s+(\d{4})\s*\)?\s*$`,
  "i",
);

/** "as of <date>" inside a sentence about the fees: "The following fees and charges are applicable to your account(s), services and/or transactions, as of 07.01.2025." (docs 16837, 35404). */
const SENTENCE_AS_OF = new RegExp(
  String.raw`\bas\s+of\s*:?\s*(?:${MONTH_NAME}\.?\s+(\d{1,2}),?\s+(\d{4})|(\d{1,2})[/.](\d{1,2})[/.](\d{4}))(?!\d)`,
  "gi",
);
/** Words that make an "as of" date another event's: an account opened, a balance, a start. */
const OTHER_EVENT = /\b(?:opened|open|opening|new|after|before|prior|balances?|closed|enrolled|starting|starts)\b/i;
const FEES_NAMED = /\b(?:fees?|charges)\b/i;

function addDays(now: Date, days: number): string {
  return new Date(now.getTime() + days * 86_400_000).toISOString().slice(0, 10);
}

/** The line around `at`, where it starts, and up to `before` lines above it. */
function lineAt(text: string, at: number, before = 0): { line: string; start: number; above: string } {
  const start = text.lastIndexOf("\n", at - 1) + 1;
  const endAt = text.indexOf("\n", at);
  const line = text.slice(start, endAt < 0 ? text.length : endAt);
  let aboveStart = start;
  for (let i = 0; i < before && aboveStart > 0; i += 1) aboveStart = text.lastIndexOf("\n", aboveStart - 2) + 1;
  return { line, start, above: text.slice(aboveStart, start) };
}

function dateOfPrinted(m: RegExpMatchArray): string | null {
  if (m[1]) return calendarDate(Number(m[3]), monthOf(m[1]), Number(m[2]));
  if (m[4]) return calendarDate(Number(m[6]), Number(m[4]), Number(m[5]));
  if (m[7]) return calendarDate(Number(m[8]), Number(m[7]), 1);
  if (m[9]) return calendarDate(Number(m[10]), monthOf(m[9]), 1);
  return null;
}

/**
 * Every "effective" date in `text` from `from` on (rate ones are already masked), each occurrence
 * read on its own line. `scheduleOnly` (past the opening): only a line that dates the schedule
 * (`scheduleDatesLine`), or a short "Effective ..." line just under one that names it ("Fee
 * Schedule" / "Effective as of: June 1, 2023", doc 40097).
 */
function effectiveDatesV2(text: string, from: number, scheduleOnly: boolean): Found[] {
  const found: Found[] = [];
  for (const m of text.matchAll(/effective/gi)) {
    const at = m.index ?? 0;
    if (at < from) continue;
    if (scheduleOnly) {
      const { line, start, above } = lineAt(text, at, 2);
      const own = scheduleDatesLine(line);
      const under = /^\W*$/.test(text.slice(start, at)) && line.trim().length <= 60 && SCHEDULE_NAME.test(above) && !OTHER_DOCUMENT.test(above);
      if (!own && !under) continue;
    }
    const words = text.slice(at, at + 80).split("\n")[0];
    const full = realDay(effectiveDate(words));
    if (full) {
      found.push({ date: full, evidence: evidenceOf(words.split(/\.\s/)[0]) });
      continue;
    }
    const my = EFFECTIVE_MONTH_YEAR.exec(words);
    if (my) {
      const date = my[1] ? calendarDate(Number(my[2]), monthOf(my[1]), 1) : calendarDate(Number(my[4]), Number(my[3]), 1);
      if (date) found.push({ date, evidence: evidenceOf(my[0]) });
    }
  }
  return found;
}

/** Printed "Revised / Rev / Updated / Reviewed" dates; from `from` on, only on a fee line or a short stamp line. */
function printedDatesV2(text: string, skipRateLines: boolean, from: number): Found[] {
  const found: Found[] = [];
  for (const m of text.matchAll(PRINTED_V2)) {
    const at = m.index ?? 0;
    if (skipRateLines && rateOnlySentence(text, at, at + m[0].length)) continue;
    if (at >= from) {
      const { line } = lineAt(text, at);
      const stamp = line.trim().length <= 48 && !OTHER_DOCUMENT.test(line);
      const feeLine = scheduleDatesLine(line);
      if (!stamp && !feeLine) continue;
    }
    const date = dateOfPrinted(m);
    if (date) found.push({ date, evidence: evidenceOf(m[0]) });
  }
  return found;
}

/**
 * Footer and form stamps anywhere: a cell that is only a month and year with a footer mark
 * (`FOOTER_MARK`) on its line or the three above, or only a full date with a mark on its own line.
 * A bare full date is a post's or an event's as often as a form's ("10/15/26" in a news list).
 */
function footerStamps(text: string): Found[] {
  const found: Found[] = [];
  const lines = text.split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (line.length > 160 || !/\d[/.]\d/.test(line) || /privacy|model/i.test(line) || COPYRIGHT.test(line)) continue;
    const near = lines.slice(Math.max(0, i - 3), i).filter((above) => !COPYRIGHT.test(above)).join("\n");
    for (const cell of line.split("|").map((c) => c.trim())) {
      const my = STAMP_MONTH_YEAR.exec(cell);
      if (my) {
        const date = FOOTER_MARK.test(line) || FOOTER_MARK.test(near) ? calendarDate(Number(my[2]), Number(my[1]), 1) : null;
        if (date) found.push({ date, evidence: evidenceOf(line) });
        continue;
      }
      const full = STAMP_FULL_DATE.exec(cell);
      if (full && FOOTER_MARK.test(line)) {
        const date = calendarDate(Number(full[3]), Number(full[1]), Number(full[2]));
        if (date) found.push({ date, evidence: evidenceOf(line) });
      }
    }
  }
  return found;
}

/** A date the opening lines print alone ("July 2025" under the letterhead, "Approved February 22, 2022") or in the schedule's title. */
function headingDates(text: string): Found[] {
  const found: Found[] = [];
  const alone: Found[] = [];
  const lines = text.slice(0, HEADING_CHARS).split("\n");
  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    // A lone date heads the schedule only beside its name (its own line or two either side) and
    // not beside news words: "Latest News" / "October 15, 2026" is a post's date (#2904 review).
    const around = lines.slice(Math.max(0, i - 2), i + 3).join("\n");
    const besideSchedule = SCHEDULE_NAME.test(around) && !NEWS_WORDS.test(around);
    for (const cell of line.split("|").map((c) => c.trim())) {
      const h = besideSchedule ? HEADING_DATE.exec(cell) : null;
      if (!h) continue;
      let date: string | null = null;
      if (h[1]) date = calendarDate(Number(h[3]), monthOf(h[1]), Number(h[2]));
      else if (h[4]) date = calendarDate(Number(h[5]), monthOf(h[4]), 1);
      else if (h[6]) date = calendarDate(Number(h[8]), Number(h[6]), Number(h[7]));
      if (date) alone.push({ date, evidence: evidenceOf(cell) });
    }
    const t = TITLE_WITH_DATE.exec(line);
    if (t) {
      const date = calendarDate(Number(t[3]), monthOf(t[1]), Number(t[2]));
      if (date) found.push({ date, evidence: evidenceOf(line) });
    }
  }
  // Two lone dates in the opening are a list (holidays, posts), not the schedule's date.
  if (new Set(alone.map((f) => f.date)).size === 1) found.push(alone[0]);
  return found;
}

/** "as of <date>" ending a sentence that names the fees and no rate, account opening, balance or start. */
function feeSentenceAsOf(head: string): Found[] {
  const found: Found[] = [];
  for (const m of head.matchAll(SENTENCE_AS_OF)) {
    const at = m.index ?? 0;
    // The date ends its sentence: the fees are as of it, not something after it.
    if (!/^[ \t]*[.;]?[ \t]*(?:\n|$)/.test(head.slice(at + m[0].length))) continue;
    const sentence = sentenceAround(head, at, at + m[0].length);
    if (!FEES_NAMED.test(sentence) || RATE_WORDS.test(sentence) || OTHER_EVENT.test(sentence)) continue;
    const date = m[1] ? calendarDate(Number(m[3]), monthOf(m[1]), Number(m[2])) : calendarDate(Number(m[6]), Number(m[4]), Number(m[5]));
    if (date) found.push({ date, evidence: evidenceOf(sentence.slice(Math.max(0, sentence.length - 120))) });
  }
  return found;
}

/**
 * v2 (`STATED_DATE_READER_VERSION`): v1's rules, plus
 *   - "effective" misspelt or broken ("Efective", "Eff ective"), and an effective month and year;
 *   - past the opening `STATED_DATE_SCAN_CHARS`, up to `STATED_DATE_DEEP_CHARS`: an "Effective"
 *     or printed date on a line that names the fee schedule or its fees (not a privacy policy,
 *     agreement, rate or loan line), or on a short stamp line ("Rev. 06/2021");
 *   - footer and form stamps beside a footer mark (`footerStamps`);
 *   - a date the first `HEADING_CHARS` characters print alone or in the schedule's title;
 *   - "as of <date>" in a sentence about the fees (not rates, an account opened, a balance);
 *   - no date more than `STATED_DATE_FUTURE_DAYS` after `now` (a promotion's end, a maturity);
 *     a year before 1990 is never a date (`calendarDate`: "since 1902").
 * The latest date still wins; an effective date is `effective_statement`, the others
 * `printed_date`. Pure.
 */
export function readStatedDateV2(
  text: string | null | undefined,
  url: string | null | undefined,
  now = new Date(),
  options: { skipRateLines?: boolean } = {},
): StatedDate {
  const skip = options.skipRateLines === true;
  const raw = (text ?? "").slice(0, STATED_DATE_DEEP_CHARS).replace(EFFECTIVE_SPELLINGS, (word: string) => `${word[0]}ffective`);
  const { masked, rateDated } = maskRateEffective(raw, skip);
  const head = masked.slice(0, STATED_DATE_SCAN_CHARS);
  const horizon = addDays(now, STATED_DATE_FUTURE_DAYS);
  const inRange = (found: Found[]) => found.filter((f) => f.date <= horizon);

  const edition = realDay(editionStarts(head));
  const effective = latest(inRange([
    ...effectiveDatesV2(head, 0, false),
    ...effectiveDatesV2(masked, STATED_DATE_SCAN_CHARS, true),
    ...(edition ? [{ date: edition, evidence: effectiveEvidence(head, edition) }] : []),
  ]));
  const printed = latest(inRange([
    ...printedDatesV2(masked, skip, STATED_DATE_SCAN_CHARS),
    ...currencyDates(head, skip),
    ...feeSentenceAsOf(head),
    ...headingDates(masked),
    ...footerStamps(masked),
  ]));
  if (effective && (!printed || effective.date >= printed.date)) {
    return { date: effective.date, basis: "effective_statement", evidence: effective.evidence };
  }
  if (printed) return { date: printed.date, basis: "printed_date", evidence: printed.evidence };
  const year = rateDated ? null : urlYear(url, now.getUTCFullYear());
  if (year != null) return { date: `${year}-01-01`, basis: "url_year", evidence: String(year) };
  return { date: null, basis: "none", evidence: null };
}

/** The reader the pass and the freshness search use now: v2 once `STATED_DATE_BACKFILL_LIVE` is on, else v1. */
export function readCurrentStatedDate(
  text: string | null | undefined,
  url: string | null | undefined,
  now = new Date(),
  options: { skipRateLines?: boolean } = {},
): StatedDate {
  return STATED_DATE_BACKFILL_LIVE ? readStatedDateV2(text, url, now, options) : readStatedDate(text, url, now, options);
}

/**
 * What an old link was dated by when the freshness search was sent to it: its document's stated
 * date (a `StatedDateBasis`), or, when none is known, the year the older freshness arm read (an
 * "Effective" year in its text, `effective_year`, or its address's year, `url_year`).
 */
export type FreshnessBasis = StatedDateBasis | "effective_year";

/** The last day a date can stand for: a year alone (from an address or an effective year) counts to 31 December. */
function lastDayOf(stated: { date: string | null; basis: string | null }): string | null {
  if (!stated.date) return null;
  return stated.basis === "url_year" || stated.basis === "effective_year" ? `${stated.date.slice(0, 4)}-12-31` : stated.date;
}

/** Bases of a date the old document's own text states: only these refuse an undated page found to replace it. */
export const TEXT_STATED_BASES: ReadonlySet<string> = new Set<StatedDateBasis>(["effective_statement", "printed_date"]);

export interface StatedDateReplacement {
  /** True when the candidate page states a later date, or states none and the old date is not text-stated. */
  replaces: boolean;
  old_date: string;
  old_basis: string | null;
  candidate_url: string | null;
  candidate_date: string | null;
  candidate_basis: StatedDateBasis;
  candidate_evidence: string | null;
  reason: string;
}

/**
 * Whether a page the freshness search found may replace a link the search was sent to for its age
 * (#2615 review). The old date is the document's stated date when one is known, else the year the
 * older arm read, counted to 31 December.
 *   - A page that states a date replaces the link only when that date is later than the old one,
 *     whatever the old date came from.
 *   - A page that states no date is refused only when the old document's own text states one
 *     (`effective_statement` or `printed_date`, `TEXT_STATED_BASES`): a dated schedule is not given
 *     up for an undated page (institution 6072). When the old date is only a year from the address
 *     (`url_year`) or the older arm's `effective_year`, nothing says the old page states a date the
 *     new one lacks, so an undated page replaces the link as it did before the guard (#2615 review:
 *     32 of the 62 age-triggered freshness v2 replacements with stored text state no date).
 * The candidate's address year is never read (it says when a file was put up, not what it
 * prices), nor a dated line about rates ("Rates current as of October 24, 2026": `skipRateLines`).
 * Pure.
 */
export function statedDateReplaces(input: {
  oldDate: string;
  oldBasis: string | null;
  candidateUrl: string | null;
  candidateText: string | null | undefined;
  now?: Date;
}): StatedDateReplacement {
  const oldLast = lastDayOf({ date: input.oldDate.slice(0, 10), basis: input.oldBasis })!;
  const candidate = readCurrentStatedDate(input.candidateText, null, input.now, { skipRateLines: true });
  const base = {
    old_date: input.oldDate.slice(0, 10),
    old_basis: input.oldBasis,
    candidate_url: input.candidateUrl,
    candidate_date: candidate.date,
    candidate_basis: candidate.basis,
    candidate_evidence: candidate.evidence,
  };
  if (!candidate.date) {
    if (TEXT_STATED_BASES.has(input.oldBasis ?? "")) {
      return { ...base, replaces: false, reason: `kept the link: the page found states no date, so it is not known to be newer than ${base.old_date}, which the old document states` };
    }
    return { ...base, replaces: true, reason: `the page found states no date and the old date ${base.old_date} (${input.oldBasis ?? "unknown"}) is not one the old document states` };
  }
  if (candidate.date <= oldLast) {
    return { ...base, replaces: false, reason: `kept the link: the page found is dated ${candidate.date}, not later than ${base.old_date}` };
  }
  return { ...base, replaces: true, reason: `the page found is dated ${candidate.date}, later than ${base.old_date}` };
}

/** The day `STALE_STATED_MONTHS` before `now` (UTC), YYYY-MM-DD: a schedule dated before it is old. */
export function staleBefore(now = new Date()): string {
  const at = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - STALE_STATED_MONTHS, now.getUTCDate()));
  return at.toISOString().slice(0, 10);
}

/** True when the stated date is more than `STALE_STATED_MONTHS` old; a year from the address counts from its last day. */
export function isStaleStatedDate(stated: Pick<StatedDate, "date" | "basis">, now = new Date()): boolean {
  const last = lastDayOf(stated);
  return last != null && last < staleBefore(now);
}

/**
 * The same rule in SQL, for a `source_documents` row aliased `stated_doc`. Only for use once
 * `statedDateColumnsReady` is true.
 */
export function statedDateStaleSql(db: SqlTag, now = new Date()) {
  return db`(
    stated_doc.stated_date_version >= ${STATED_DATE_FIRST_VERSION}
    AND stated_doc.stated_date IS NOT NULL
    AND ${statedDateLastDaySql(db)} < ${staleBefore(now)}::date
  )`;
}

/** The last day the stated date of a `source_documents` row aliased `stated_doc` stands for (an address year counts to 31 December). */
export function statedDateLastDaySql(db: SqlTag) {
  return db`(CASE WHEN stated_doc.stated_date_basis = 'url_year'
                  THEN make_date(extract(year FROM stated_doc.stated_date)::int, 12, 31)
                  ELSE stated_doc.stated_date END)`;
}

const readyCache = new WeakMap<object, true>();

/** True once migration 20270110000077's three columns exist. Only a positive answer is cached. */
export async function statedDateColumnsReady(db: SqlTag): Promise<boolean> {
  if (readyCache.get(db)) return true;
  try {
    const [row] = await db<Array<{ ready: boolean }>>`
      SELECT COUNT(*) = 3 AS ready
        FROM information_schema.columns
       WHERE table_schema = 'public'
         AND table_name = 'source_documents'
         AND column_name IN ('stated_date', 'stated_date_basis', 'stated_date_version')
    `;
    const ready = row?.ready === true;
    if (ready) readyCache.set(db, true);
    return ready;
  } catch {
    return false;
  }
}

interface DocumentRow {
  id: number | string;
  institution_id: number | string;
  document_url: string | null;
  head: string | null;
  /** What the row holds now (null when never dated). */
  prior_version?: number | string | null;
  prior_date?: string | Date | null;
  prior_basis?: string | null;
}

/**
 * Live fees per picked document, from published_fee_catalog, for those documents only (the bank
 * filter lets the view use its institution index). Nothing is read when nothing was picked.
 */
async function countLiveFees(db: SqlTag, rows: DocumentRow[]): Promise<Map<number, number>> {
  const counts = new Map<number, number>();
  if (rows.length === 0) return counts;
  const ids = rows.map((row) => Number(row.id));
  const institutions = [...new Set(rows.map((row) => Number(row.institution_id)))];
  const live = await db<Array<{ id: number | string; live_fees: number | string }>>`
    -- magellan stated-date live fees
    SELECT c.source_document_id AS id, COUNT(*) AS live_fees
      FROM published_fee_catalog c
     WHERE c.institution_id = ANY(${institutions}::bigint[])
       AND c.source_document_id = ANY(${ids}::bigint[])
     GROUP BY c.source_document_id
  `;
  for (const row of live) counts.set(Number(row.id), Number(row.live_fees) || 0);
  return counts;
}

export interface StatedDateSample {
  source_document_id: number;
  institution_id: number;
  document_url: string | null;
  stated_date: string | null;
  basis: StatedDateBasis;
  evidence: string | null;
  live_fees: number;
}

/** One v1 document read again with v2: the date it holds and the one v2 reads, with v2's words. */
export interface StatedDateBackfillSample extends StatedDateSample {
  prior_date: string | null;
  prior_basis: string | null;
}

/**
 * The backfill of v1 documents with the v2 reader. Off (`STATED_DATE_BACKFILL_LIVE`), a rotating
 * batch of v1 current copies and live-fee documents is read with v2 and nothing is written; on,
 * it counts the v1 rows the pass itself re-read and wrote.
 */
export interface StatedDateBackfillResult {
  live: boolean;
  reader_version: number;
  /** v1 documents read with v2 this step. */
  read: number;
  /** v1 had no date, v2 reads one. */
  newly_dated: number;
  /** v1 had a date, v2 reads another (later, or a footer or deep line v1 never saw). */
  changed: number;
  /** v2 reads the date v1 holds. */
  unchanged: number;
  /** v1 had a date, v2 reads none (a v1 date past the horizon). */
  lost: number;
  /** Live fees on the documents newly dated or changed. */
  live_fees_touched: number;
  by_basis: Record<StatedDateBasis, number>;
  /** Up to 20 newly dated or changed documents, with the words v2 read. */
  samples: StatedDateBackfillSample[];
}

export interface StatedDatePassResult {
  schema_ready: boolean;
  version: number;
  dry_run: boolean;
  /** Documents read this step. */
  read: number;
  /** Of those, how many state a date (any basis). */
  dated: number;
  by_basis: Record<StatedDateBasis, number>;
  /** Read this step and dated more than STALE_STATED_MONTHS ago. */
  stale: number;
  /** Live fees on those stale documents. */
  stale_live_fees: number;
  /** The day before which a schedule counts as old. */
  stale_before: string;
  /** Up to 10 stale documents with the words their date was read from. */
  stale_samples: StatedDateSample[];
  /** New documents (never dated) this step that v2 would date differently from v1, while the backfill is off. */
  v2_would_differ: number;
  backfill: StatedDateBackfillResult;
}

function emptyBackfill(): StatedDateBackfillResult {
  return {
    live: STATED_DATE_BACKFILL_LIVE,
    reader_version: STATED_DATE_READER_VERSION,
    read: 0,
    newly_dated: 0,
    changed: 0,
    unchanged: 0,
    lost: 0,
    live_fees_touched: 0,
    by_basis: { effective_statement: 0, printed_date: 0, url_year: 0, none: 0 },
    samples: [],
  };
}

function emptyResult(schemaReady: boolean, dryRun: boolean, now: Date): StatedDatePassResult {
  return {
    schema_ready: schemaReady,
    version: STATED_DATE_VERSION,
    dry_run: dryRun,
    read: 0,
    dated: 0,
    by_basis: { effective_statement: 0, printed_date: 0, url_year: 0, none: 0 },
    stale: 0,
    stale_live_fees: 0,
    stale_before: staleBefore(now),
    stale_samples: [],
    v2_would_differ: 0,
    backfill: emptyBackfill(),
  };
}

function priorDay(value: string | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value.toISOString().slice(0, 10);
  return String(value).slice(0, 10) || null;
}

/** Adds one v1 document read with v2 to the backfill counts. Pure. */
export function countBackfill(backfill: StatedDateBackfillResult, row: DocumentRow, v2: StatedDate, liveFees: number): void {
  const prior = priorDay(row.prior_date);
  backfill.read += 1;
  backfill.by_basis[v2.basis] += 1;
  let touched = false;
  if (prior == null && v2.date != null) {
    backfill.newly_dated += 1;
    touched = true;
  } else if (prior != null && v2.date == null) {
    backfill.lost += 1;
  } else if (prior !== v2.date || (row.prior_basis ?? null) !== v2.basis) {
    if (prior === v2.date) backfill.unchanged += 1;
    else {
      backfill.changed += 1;
      touched = true;
    }
  } else {
    backfill.unchanged += 1;
  }
  if (!touched) return;
  backfill.live_fees_touched += liveFees;
  if (backfill.samples.length < 20) {
    backfill.samples.push({
      source_document_id: Number(row.id),
      institution_id: Number(row.institution_id),
      document_url: row.document_url,
      stated_date: v2.date,
      basis: v2.basis,
      evidence: v2.evidence,
      live_fees: liveFees,
      prior_date: prior,
      prior_basis: row.prior_basis ?? null,
    });
  }
}

/**
 * The documents to date: not yet dated at `STATED_DATE_VERSION`, documents live fees cite first,
 * then the other current copies, newest first; each with its newest completed text, `chars` long.
 */
function selectDocuments(db: SqlTag, options: { limit: number; chars: number }) {
  // The documents are picked first, from the cheap tier tables, and only the picked ones are read
  // or counted (#2615 review): a published_fee_catalog group-by over every live fee took 1-8 s on
  // prod each discover step, and reading the text of every eligible document before the LIMIT ~5 s.
  // "Cited" here is a live published record read from the document (the catalog's own lineage,
  // published -> verified -> raw), looked up only for the banks that have a document still to date:
  // ~0.1 s for ~500 such documents on prod, ~0.9 s while all ~25,000 are.
  return db<DocumentRow[]>`
    -- magellan stated dates
    WITH undated AS MATERIALIZED (
      SELECT doc.id, doc.institution_id, doc.document_url,
             doc.stated_date_version AS prior_version, doc.stated_date AS prior_date, doc.stated_date_basis AS prior_basis,
             (doc.status = 'success' AND doc.duplicate_of_id IS NULL AND doc.superseded_by_id IS NULL) AS current_copy
        FROM source_documents doc
       WHERE (doc.stated_date_version IS NULL OR doc.stated_date_version < ${STATED_DATE_VERSION})
         AND EXISTS (
           SELECT 1 FROM agent_source_texts t
            WHERE t.source_document_id = doc.id
              AND t.status = 'completed'
         )
    ),
    cited AS MATERIALIZED (
      SELECT DISTINCT fr.source_document_id AS id
        FROM published_fee_records fp
        JOIN verified_fee_observations fv ON fv.fee_verified_id = fp.lineage_ref
        JOIN raw_fee_observations fr ON fr.fee_raw_id = fv.fee_raw_id
       WHERE fp.institution_id IN (SELECT institution_id FROM undated)
         AND fp.rolled_back_at IS NULL
         AND fp.quarantined_at IS NULL
         AND fr.source_document_id IN (SELECT id FROM undated)
    ),
    picked AS (
      SELECT undated.id, undated.institution_id, undated.document_url,
             undated.prior_version, undated.prior_date, undated.prior_basis, (cited.id IS NOT NULL) AS cited
        FROM undated
        LEFT JOIN cited ON cited.id = undated.id
       WHERE cited.id IS NOT NULL OR undated.current_copy
       ORDER BY (cited.id IS NOT NULL) DESC, undated.id DESC
       LIMIT ${options.limit}
    )
    SELECT ${"pick"}::text AS pick_mode, picked.id, picked.institution_id, picked.document_url,
           picked.prior_version, to_char(picked.prior_date, 'YYYY-MM-DD') AS prior_date, picked.prior_basis, txt.head
      FROM picked
      JOIN LATERAL (
        SELECT left(t.normalized_text, ${options.chars}) AS head
          FROM agent_source_texts t
         WHERE t.source_document_id = picked.id
           AND t.status = 'completed'
         ORDER BY t.id DESC
         LIMIT 1
      ) txt ON TRUE
     ORDER BY picked.cited DESC, picked.id DESC
  `;
}

/** Where in the id range the dry-run batch of step `slot` starts, as a share of the highest id (golden-ratio steps, so batches spread). */
export function shadowStart(slot: number): number {
  const share = (Math.abs(Math.floor(slot)) * 0.6180339887498949) % 1;
  return Math.floor(share * 1000) / 1000;
}

/**
 * The dry-run backfill's batch while it is off: current copies dated by v1, `limit` of them from
 * the id `shadowStart(slot)` of the way up, read by the primary key, so it never scans every
 * document or groups the fee tables (#2904 review: the first version cost ~1.1 s and ~391k buffer
 * hits a step; this one ~60 ms and ~940 buffers on prod, Nov 2). Live-fee documents are not
 * picked first: the batch is a sample of current copies, and their live fees are counted after.
 */
function selectShadowDocuments(db: SqlTag, options: { limit: number; chars: number; slot: number }) {
  return db<DocumentRow[]>`
    -- magellan stated dates
    SELECT ${"shadow"}::text AS pick_mode, doc.id, doc.institution_id, doc.document_url,
           doc.stated_date_version AS prior_version, to_char(doc.stated_date, 'YYYY-MM-DD') AS prior_date,
           doc.stated_date_basis AS prior_basis, txt.head
      FROM source_documents doc
      JOIN LATERAL (
        SELECT left(t.normalized_text, ${options.chars}) AS head
          FROM agent_source_texts t
         WHERE t.source_document_id = doc.id
           AND t.status = 'completed'
         ORDER BY t.id DESC
         LIMIT 1
      ) txt ON TRUE
     WHERE doc.id >= (SELECT (MAX(s.id) * ${shadowStart(options.slot)}::numeric)::bigint FROM source_documents s)
       AND doc.stated_date_version >= ${STATED_DATE_FIRST_VERSION}
       AND doc.stated_date_version < ${STATED_DATE_READER_VERSION}
       AND doc.status = 'success'
       AND doc.duplicate_of_id IS NULL
       AND doc.superseded_by_id IS NULL
     ORDER BY doc.id
     LIMIT ${options.limit}
  `;
}

/**
 * Dates up to `limit` documents not yet dated at this version: documents live fees cite first,
 * then the other current copies, newest first. Each is read from its newest completed text. A dry
 * run reads and reports but writes nothing. One `magellan.stated_dates` run event records the
 * counts and the stale samples with their evidence. The freshness search picks up the stale ones.
 *
 * The v2 backfill (`STATED_DATE_BACKFILL_LIVE`): on, this pick re-reads every v1 document with v2
 * and writes it (`backfill` counts the v1 rows among them); off, the pass writes v1 as before,
 * counts the new documents v2 would date differently (`v2_would_differ`) and reads up to
 * `STATED_DATE_BACKFILL_SHADOW_PER_STEP` v1 current copies with v2, on one step in `STATED_DATE_BACKFILL_SHADOW_EVERY`, without writing (`backfill`, with up
 * to 20 samples of the date each holds against the one v2 reads and its words).
 */
export async function runStatedDatePass(
  db: SqlTag,
  options: { runId: number; stepId?: number | null; dryRun?: boolean; limit?: number; shadowLimit?: number; shadowEvery?: number; now?: Date },
): Promise<StatedDatePassResult> {
  const now = options.now ?? new Date();
  const dryRun = options.dryRun === true;
  if (!(await statedDateColumnsReady(db))) return emptyResult(false, dryRun, now);
  const limit = Math.max(0, Math.floor(options.limit ?? STATED_DATES_PER_STEP));
  // The dry-run backfill runs on every STATED_DATE_BACKFILL_SHADOW_EVERY-th step only (by step id).
  const slot = options.stepId ?? options.runId;
  const every = Math.max(1, Math.floor(options.shadowEvery ?? STATED_DATE_BACKFILL_SHADOW_EVERY));
  const shadowTurn = slot % every === 0;
  const shadowLimit = STATED_DATE_BACKFILL_LIVE || !shadowTurn ? 0 : Math.max(0, Math.floor(options.shadowLimit ?? STATED_DATE_BACKFILL_SHADOW_PER_STEP));
  const result = emptyResult(true, dryRun, now);
  if (limit === 0 && shadowLimit === 0) return result;

  // v1 reads the opening only; v2 reads past it, so its text is fetched longer (the shadow always,
  // the pick once the backfill is on). v2 runs on the pick's rows too, to count what it would change.
  const rows = limit > 0 ? await selectDocuments(db, { limit, chars: STATED_DATE_DEEP_CHARS }) : [];
  const shadowRows = shadowLimit > 0 ? await selectShadowDocuments(db, { limit: shadowLimit, chars: STATED_DATE_DEEP_CHARS, slot }) : [];
  const liveByDocument = await countLiveFees(db, [...rows, ...shadowRows]);

  const ids: number[] = [];
  const dates: string[] = [];
  const bases: string[] = [];
  for (const row of rows) {
    const stated = readCurrentStatedDate(row.head, row.document_url, now);
    const liveFees = liveByDocument.get(Number(row.id)) ?? 0;
    result.read += 1;
    result.by_basis[stated.basis] += 1;
    if (stated.date) result.dated += 1;
    if (STATED_DATE_BACKFILL_LIVE) {
      if (row.prior_version != null) countBackfill(result.backfill, row, stated, liveFees);
    } else {
      const v2 = readStatedDateV2(row.head, row.document_url, now);
      if (v2.date !== stated.date) result.v2_would_differ += 1;
    }
    if (isStaleStatedDate(stated, now)) {
      result.stale += 1;
      result.stale_live_fees += liveFees;
      if (result.stale_samples.length < 10) {
        result.stale_samples.push({
          source_document_id: Number(row.id),
          institution_id: Number(row.institution_id),
          document_url: row.document_url,
          stated_date: stated.date,
          basis: stated.basis,
          evidence: stated.evidence,
          live_fees: liveFees,
        });
      }
    }
    ids.push(Number(row.id));
    dates.push(stated.date ?? "");
    bases.push(stated.basis);
  }
  for (const row of shadowRows) {
    countBackfill(result.backfill, row, readStatedDateV2(row.head, row.document_url, now), liveByDocument.get(Number(row.id)) ?? 0);
  }

  if (!dryRun && ids.length > 0) {
    await db`
      UPDATE source_documents doc
         SET stated_date = NULLIF(u.stated_date, '')::date,
             stated_date_basis = u.basis,
             stated_date_version = ${STATED_DATE_VERSION}
        FROM unnest(${ids}::bigint[], ${dates}::text[], ${bases}::text[]) AS u(id, stated_date, basis)
       WHERE doc.id = u.id
    `;
  }

  if (result.read > 0 || result.backfill.read > 0) {
    const b = result.backfill;
    const backfillWords = b.read > 0
      ? ` v2 backfill ${b.live ? "wrote" : "dry run (STATED_DATE_BACKFILL_LIVE off, nothing written)"}: ${b.read} v1 documents read, ${b.newly_dated} newly dated, ${b.changed} changed, ${b.unchanged} unchanged, ${b.lost} lost (${b.live_fees_touched} live fees on those touched).`
      : "";
    await db`
      INSERT INTO agent_run_events (agent_run_id, step_id, event_type, status, message, detail)
      VALUES (
        ${options.runId}, ${options.stepId ?? null}, ${STATED_DATE_EVENT}, ${dryRun ? "skipped" : "completed"},
        ${`Magellan read the stated date of ${result.read} documents: ${result.dated} state one, ${result.stale} dated before ${result.stale_before} (${result.stale_live_fees} live fees)${dryRun ? " (dry run, nothing written)" : ""}.${backfillWords}`},
        ${JSON.stringify({ ...result, protocol: `${STATED_DATE_EVENT}.v${STATED_DATE_VERSION}` })}::jsonb
      )
    `;
  }
  return result;
}
