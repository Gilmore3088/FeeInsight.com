/**
 * #1092: the section path of every line of a stored text, read from the text itself. Rosetta keeps
 * no heading levels (`html-dom.ts` writes h1-h6 as plain blocks, PDF font sizes are not stored), so
 * the structure is rebuilt here, deterministically: which lines are headings, how high each ranks,
 * and which headings a line sits under. Pure, no model call. The audience (`knox/audience-context.ts`)
 * and retired-section (`custom-report/discontinued-rows.ts`) reads use it behind `SECTION_PATH_LIVE`.
 *
 * A line is one of:
 *  - a heading: short, no price, not a sentence, a footnote, a bullet or a menu item;
 *  - a column line: " | " cells that are all heading-like, none priced ("General Business Service
 *    Fees | Business Checking Account Fees"); a table's own title row ("Business Checking | Fee Amount
 *    | Alert Me", "Card Services | Fee") heads its table under its first cell;
 *  - a header row of column labels only ("Service | Fee", "Item | Amount", "Alert Me");
 *  - a date line ("Effective April 1, 2026"), a parenthetical note, a priced row, or prose.
 * Blank lines never end a section (web pages are stored with a blank line between every line).
 *
 * Ranks, highest first:
 *  3 - a schedule's own title ("Fee Schedule", "Miscellaneous Services Pricing Guide:"), a heading
 *      over a date line ("Business Account(s)" / "Effective April 1, 2026"), or a heading whose next
 *      lines say what follows applies to ("Business Customers" / "The following fees apply to
 *      business customers only", "Previously Offered Products" / "... previously offered and no
 *      longer available to open");
 *  2 - any other heading or column line;
 *  1 - a heading ending in a colon ("Grandfathered Checking Account Types:") or a table's title row.
 * A heading closes every open heading of its own rank or lower, so equal ranks are siblings and a
 * lower rank nests under the heading above it. Where a page's styles do not show a level, sibling
 * headings close each other: the path errs toward too short, never toward a heading it is not under.
 *
 * Menus: three or more headings in a row with nothing between are a menu or contents list, and only
 * the last one heads what follows; a heading repeated within four lines (an accordion's title) is
 * read once. A heading-like name over a price-first line ("RDC Monthly Fee" / "$40.00") is a row.
 */

export const SECTION_PATH_LIVE: boolean = false;

let sectionPathOn = SECTION_PATH_LIVE;

/** Whether the section-path reads are on: `SECTION_PATH_LIVE`, unless `withSectionPath` holds them. */
export function sectionPathLive(): boolean {
  return sectionPathOn;
}

/** Runs `read` with the section-path reads on or off (the lab, the switch gate, the dry run). Synchronous reads only. */
export function withSectionPath<T>(on: boolean, read: () => T): T {
  const before = sectionPathOn;
  sectionPathOn = on;
  try {
    return read();
  } finally {
    sectionPathOn = before;
  }
}

export type LineKind = "blank" | "heading" | "columns" | "titled_header" | "header" | "date" | "note" | "row" | "prose" | "menu";

export interface SectionHeading {
  /** The line's index in the text. */
  index: number;
  /** The heading's words: a title row's first cell, with a parenthetical note under it appended. */
  text: string;
  /** Every cell of a column line or title row. */
  cells: readonly string[];
  kind: "heading" | "columns" | "titled_header";
  rank: 1 | 2 | 3;
  /** The sentence under the heading that says what the section applies to, when there is one. */
  scope: string | null;
}

export interface SectionMap {
  kinds: readonly LineKind[];
  /** The headings the line sits under, outermost first. A heading's own path ends with itself. */
  pathAt(index: number): readonly SectionHeading[];
}

const MONEY = /\$\s*\.?\d|\d\s*¢|(?<![\d.,])\d{1,3}(?:,\d{3})*\.\d{2}(?!\d)|\d(?:\.\d+)?\s*%/;
const FREE_WORD = /^(?:free|no charge|no fee|n\/c|none|waived|no cost)\b/i;
/** A value cell that prices with words: "10 free/yr", "5 Free/mo", "Free to members". */
const FREE_IN_CELL = /\b(?:free|no charge|n\/c|waived)\b/i;
/** A name priced free at its end: "Business eDeposit No fee", "Online Inquiries & Transactions No Cost". */
const FREE_AT_END = /\S\s+(?:no fee|no charge|no cost|free|n\/c|waived)\s*$/i;
const VALUE_CELL =/\d|^(?:yes|no|n\/a|unlimited|included|varies|optional|available)$/i;
/** A free word after dot leaders or a wide gap: "Notary Services ....... FREE". */
const FREE_AFTER_GAP = /(?:\.{3,}|\s{3,})\s*(?:free|no charge|no fee|n\/c|none|waived)\b/i;
/** A line that opens with its price: the second line of a stacked name/price row. */
const PRICE_FIRST = /^\s*[-–:•*~]?\s*(?:\$\s*\.?\d|\d+(?:\.\d{2})?\s*(?:¢|%)|(?:free|no charge|no fee|n\/c|waived)\s*(?:$|[.,;:(*\-–]|of charge|per\b|each\b|to\b|for\b|with\b))/i;
const MONTH = String.raw`(?:jan|feb|mar|apr|may|jun|jul|aug|sep|sept|oct|nov|dec)[a-z]*\.?`;
const DATE = String.raw`(?:\d{1,2}[/.\-]\d{1,2}[/.\-]\d{2,4}|${MONTH}\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}|${MONTH}\s+\d{4})`;
const DATE_LINE = new RegExp(
  String.raw`^\W*(?:(?:fees?|rates?|schedule)\s+)?(?:effective|eff\.?|as of|revised|date revised|updated|current as of)(?:\s+date)?\s*(?:as of)?\s*[:\-–]?\s*(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day,?\s+)?${DATE}\.?\s*$`,
  "i",
);
const SCHEDULE_TITLE = /\b(?:fee schedule|schedule of (?:fees|charges|service charges)|fees (?:and|&) (?:service )?charges|pricing guide|fee disclosure)\b/i;
/** A sentence that says what follows applies to: an audience, every account, or retired accounts. */
const SCOPE =
  /\b(?:the\s+)?following\s+(?:fees?|charges?|services?|items?|prices?)\b[^.]{0,80}?\b(?:apply|applies|are\s+charged|will\s+be\s+(?:assessed|charged))\s+(?:only\s+)?(?:to|for|on)\b|\bpreviously offered\b[^.]{0,80}\bno longer\b|\bno longer (?:available|offered) to (?:open|new)\b/i;
/** Column labels: a row of only these is a table's header, not a heading. */
const GENERIC_LABEL =
  /^(?:fees?|fee amount|amounts?|items?|services?|description|type|rates?|charges?|price|cost|alert me|account type|features?|apy\W*|apr\W*|details|frequency|notes?|name|minimum|balance)$/i;
const FOOTNOTE = /^\s*(?:\d{1,2}[.)]\s|\(\d{1,2}\)\s|[*†‡§¹²³⁴⁵⁶⁷⁸⁹]|\d{1,2}\s+[A-Z][a-z])/;
const BULLET = /^[•▪●◦·\-–*]\s/;
const MAX_HEADING_CHARS = 90;
const MAX_HEADING_WORDS = 12;
const MENU_RUN = 3;
const REPEAT_REACH = 4;
const SCOPE_REACH = 2;
const PROSE_BREAK = 4;

const cellsOf = (line: string) => line.split("|").map((cell) => cell.trim()).filter(Boolean);
const words = (text: string) => text.split(/\s+/).filter(Boolean).length;

function headingLike(text: string): boolean {
  return (
    text.length > 0 &&
    text.length <= MAX_HEADING_CHARS &&
    words(text) <= MAX_HEADING_WORDS &&
    /[A-Za-z]{2}/.test(text) &&
    !/^[a-z]/.test(text) &&
    !MONEY.test(text) &&
    !FREE_AFTER_GAP.test(text) &&
    !/[.;!]\s*$/.test(text) &&
    !FOOTNOTE.test(text) &&
    !BULLET.test(text) &&
    !/https?:|www\./i.test(text)
  );
}

function classify(raw: string): LineKind {
  const text = raw.trim();
  if (!text) return "blank";
  if (DATE_LINE.test(text)) return "date";
  if (MONEY.test(text) || FREE_AFTER_GAP.test(text) || FREE_AT_END.test(text)) return "row";
  if (text.includes("|")) {
    const cells = cellsOf(text);
    // "Interest credited monthly | Yes | Yes", "ATM rebates | 4 per month | Unlimited": a feature row.
    if (cells.slice(1).some((cell) => FREE_WORD.test(cell) || FREE_IN_CELL.test(cell) || VALUE_CELL.test(cell))) return "row";
    if (cells.length > 0 && cells.every((cell) => GENERIC_LABEL.test(cell))) return "header";
    if (cells.length > 1 && !GENERIC_LABEL.test(cells[0]) && cells.slice(1).every((cell) => GENERIC_LABEL.test(cell)) && headingLike(cells[0])) return "titled_header";
    if (cells.length > 1 && cells.every(headingLike)) return "columns";
    return "prose";
  }
  if (GENERIC_LABEL.test(text)) return "header";
  if (/^\(.*\)$/.test(text) && text.length <= MAX_HEADING_CHARS) return "note";
  return headingLike(text) ? "heading" : "prose";
}

const squash = (text: string) => text.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/** The next `count` non-blank line indexes after `index`. */
function nextLines(kinds: readonly LineKind[], index: number, count: number): number[] {
  const out: number[] = [];
  for (let at = index + 1; at < kinds.length && out.length < count; at += 1) if (kinds[at] !== "blank") out.push(at);
  return out;
}

/** Stacked rows, accordion repeats and menus are not headings. */
function settleKinds(lines: readonly string[], kinds: LineKind[]): void {
  for (let index = 0; index < kinds.length; index += 1) {
    if (kinds[index] !== "heading") continue;
    const [next] = nextLines(kinds, index, 1);
    if (next != null && kinds[next] === "row" && PRICE_FIRST.test(lines[next])) kinds[index] = "row";
  }
  const seen: Array<{ index: number; key: string }> = [];
  for (let index = 0; index < kinds.length; index += 1) {
    if (kinds[index] === "blank") continue;
    if (kinds[index] === "heading") {
      const key = squash(lines[index]);
      if (seen.slice(-REPEAT_REACH).some((earlier) => earlier.key === key)) kinds[index] = "menu";
    }
    seen.push({ index, key: kinds[index] === "heading" || kinds[index] === "menu" ? squash(lines[index]) : "" });
  }
  let run: number[] = [];
  const closeRun = () => {
    if (run.length >= MENU_RUN) for (const at of run.slice(0, -1)) kinds[at] = "menu";
    run = [];
  };
  for (let index = 0; index < kinds.length; index += 1) {
    const kind = kinds[index];
    if (kind === "blank" || kind === "menu") continue;
    if (kind === "heading") run.push(index);
    else closeRun();
  }
  closeRun();
}

function headingAt(lines: readonly string[], kinds: readonly LineKind[], index: number): SectionHeading {
  const kind = kinds[index] as SectionHeading["kind"];
  const text = lines[index].trim();
  const cells = kind === "heading" ? [text] : cellsOf(text);
  const after = nextLines(kinds, index, SCOPE_REACH);
  const note = after.find((at) => kinds[at] === "note" && at === after[0]);
  const title = kind === "titled_header" ? cells[0] : text;
  const scopeLine = after.map((at) => lines[at].trim()).find((line, at) => (kinds[after[at]] === "prose" || kinds[after[at]] === "note") && SCOPE.test(line));
  const scope = scopeLine ?? (kind === "heading" && SCOPE.test(text) ? text : null);
  const dated = after.length > 0 && kinds[after[0]] === "date";
  const rank: SectionHeading["rank"] =
    scope != null || dated || (kind !== "titled_header" && SCHEDULE_TITLE.test(title)) ? 3 : kind === "titled_header" || /:\s*$/.test(text) ? 1 : 2;
  return { index, text: note != null ? `${title} ${lines[note].trim()}` : title, cells, kind, rank, scope };
}

/**
 * A heading styled visibly below most section headings: a column line or one set in capitals
 * ("ACCOUNT ASSISTANCE | WIRE TRANSFERS", "NIGHT DEPOSIT"). Ranks alone cannot tell a sub-heading
 * from the next sibling section when both are Title Case ("Business Checking" then "Other Fees:"), so
 * a heading decides for the rows under a sub-heading only through these (review of 863cebf).
 */
export function visiblySubordinate(heading: SectionHeading, outer: SectionHeading): boolean {
  if (heading.kind === "columns") return true;
  return capitals(heading.text) && !capitals(outer.text);
}

function capitals(text: string): boolean {
  const letters = text.replace(/[^A-Za-z]/g, "");
  return letters.length >= 3 && letters.replace(/[^A-Z]/g, "").length / letters.length >= 0.8;
}

let lastMap: { text: string; map: SectionMap } | null = null;

/** The section map of a stored text: every line's kind and the headings it sits under. */
export function sectionMap(text: string): SectionMap {
  // Each fee of a document asks for the same text's map in turn: keep the last one.
  if (lastMap?.text === text) return lastMap.map;
  const map = buildSectionMap(text);
  lastMap = { text, map };
  return map;
}

/**
 * The line a two-column row sets two fees on ("Garnishments | $100.00 | Domestic Outgoing | $35.00",
 * "Check Cashing ... $10.00 | Share Draft ... $5.00"): a heading above it may head either column.
 */
export function twoColumnRow(line: string): boolean {
  return cellsOf(line).filter((cell) => /[A-Za-z]{3}/.test(cell.replace(MONEY, "")) && MONEY.test(cell)).length >= 2
    || /[A-Za-z]{3}[^|]*\|\s*\$?[\d.,]+[^|]*\|\s*[A-Za-z]{3}[^|]*\|\s*\$?\d/.test(line);
}

function buildSectionMap(text: string): SectionMap {
  const lines = text.split("\n");
  const kinds = lines.map(classify);
  settleKinds(lines, kinds);
  const paths: Array<readonly SectionHeading[]> = new Array(lines.length);
  let stack: SectionHeading[] = [];
  let prose = 0;
  for (let index = 0; index < lines.length; index += 1) {
    const kind = kinds[index];
    if (kind !== "blank") prose = kind === "prose" ? prose + 1 : 0;
    // A run of paragraphs is not a table: the sections above it end (a deposit agreement's columns
    // read across, terms and conditions between schedules).
    if (prose >= PROSE_BREAK) stack = [];
    if (kind === "heading" || kind === "columns" || kind === "titled_header") {
      const heading = headingAt(lines, kinds, index);
      const kept = [...stack];
      while (kept.length > 0 && kept[kept.length - 1].rank <= heading.rank) kept.pop();
      stack = [...kept, heading];
    }
    paths[index] = stack;
  }
  return { kinds, pathAt: (index) => paths[index] ?? [] };
}
