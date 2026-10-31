/**
 * Counts in an answer (#975): "42 banks", "12 of your peers", "3 competitors", "1,204
 * institutions", "17 fee complaints", "twelve branches". The figure check (figure-check.ts) traces
 * them as it traces dollars and percentages, so an invented count holds or is cut by the same path.
 *
 * What is a count: a number in digits or a cardinal in words directly before a group noun, with at
 * most one describing word from a fixed list (spelled-figures.ts's group adjectives, plus a few for
 * complaints and branches: "fee complaints", "physical branches"), or a number in digits before "of"
 * and that group ("12 of your peers", "3 of the local banks"). The nouns are institutions and what
 * they own or receive: banks, credit unions, institutions, peers, competitors, lenders, filers,
 * thrifts, branches, offices and complaints, singular or plural. People ("members", "customers") are
 * not counts here: a scaled membership ("2 million members") is a size, not a group the tools list.
 *
 * Never counts: a year ("2025 banks"), a date ("Oct 12 banks"), a rank or position ("top 5 banks",
 * "the largest 10 banks", "No. 3 bank"), a rate's denominator ("per 100 branches"), an id ("cert
 * 12345"), a range ("10-15 banks", whose ends are a band, not a count), a decimal, a figure inside a
 * citation in brackets or a code span, a number another figure already reads ("1 in 4 peers" is a
 * share), and a threshold a rule states ("a local median needs at least five competitors", "at
 * least 5 local competitors, or 10 peers for any other group"): a rule's number is not a count of
 * the evidence. List numbering ("1. Banks ...") never sits directly before a noun with only a space.
 *
 * What a count traces to (`countEvidence`):
 * - a whole number in the evidence that is not an id, year, date or rank, and not a dollar or rate
 *   field or a fee price under a fee category ("overdraft": 35, anything inside `fees`, `your_fees`,
 *   `counted_with` or `counted_as`); a generic `total`, `rows`, `matches` or `results` counts when
 *   it sits beside a list of rows, or carries no unit and does not sit under a dollar or rate key;
 * - the sum or difference of two counts in the same record ("bank_count" 12 and "cu_count" 8 stated
 *   as "20 institutions"), never of counts from different records;
 * - a count a tool's own text states ("Contacts at 12 banks reported ...");
 * - the length of any array the tools returned, and, for a count no larger than the rows of
 *   institutions, branches or complaints a tool returned, those rows: an answer that counts the rows
 *   it was given ("3 competitors charge more") states a number the evidence holds only as rows, and
 *   the check cannot evaluate which rows the answer filtered on.
 *
 * A hedge sets the count's direction: "more than", "over", "at least", "upwards of" are a floor (the
 * evidence holds a count at or above it: "more than 1,000 institutions" against 3,912); "under",
 * "fewer than", "less than", "at most", "up to", "nearly", "almost" a ceiling within two units of its
 * last place ("nearly 300 branches" covers 100 to 300); "about", "around", "roughly" one unit either
 * way ("about 1,200 banks" covers 1,100 to 1,300). An unhedged count is exact.
 */

import { CANONICAL_KEY_MAP, DISPLAY_NAMES } from "@/lib/fee-taxonomy";
import { CARDINAL, DETERMINER, GROUP_ADJECTIVE, parseCardinal } from "./spelled-figures";

export type CountClass = "institution" | "branch" | "complaint";
export type CountBound = "floor" | "ceiling";

export interface CountFigure {
  /** The number and its group: "42 banks", "12 of your peers". */
  raw: string;
  /** The number as stated. */
  value: number;
  /** An exact or "about" count: how far the evidence may sit from `value`. A ceiling: how far below it. */
  tolerance: number;
  index: number;
  countOf: CountClass;
  /** A floor ("more than 40") or a ceiling ("fewer than 40"); absent for an exact or "about" count. */
  bound?: CountBound;
}

const NOUN = String.raw`(?:banks?|credit[\s-]+unions?|institutions?|peers?|competitors?|lenders?|filers?|CUs|thrifts?|branch(?:es)?|offices?|complaints?)`;
const PLURAL_NOUN = String.raw`(?:banks|credit[\s-]+unions|institutions|peers|competitors|lenders|filers|CUs|thrifts|branches|offices|complaints)`;
/** The one describing word a count may take: a group adjective, or one that names a kind of complaint or branch. */
const COUNT_ADJECTIVE = String.raw`(?:${GROUP_ADJECTIVE}|fee|fee-related|CFPB|consumer|overdraft|in-market|in-state|out-of-state|active|insured|physical|open|retail|full-service|competing|reporting|eligible|chartered|bank|credit[\s-]+union)`;
const DIGITS = String.raw`(?<![\w$.,#/:'’–—-])(\d{1,3}(?:,\d{3})+|\d+)(?![.,]\d|[%\w])`;
const AFTER = String.raw`[\s-]+(?:${COUNT_ADJECTIVE}[\s-]+)?(${NOUN})\b`;
const DIGIT_COUNT = new RegExp(String.raw`${DIGITS}${AFTER}`, "gi");
const DIGIT_OF_COUNT = new RegExp(String.raw`${DIGITS}\s+of\s+(?:${DETERMINER}\s+)?(?:${COUNT_ADJECTIVE}\s+)?(${PLURAL_NOUN})\b`, "gi");
const WORD_COUNT = new RegExp(String.raw`(${CARDINAL})${AFTER}`, "gi");

const YEAR = /^(?:19|20)\d{2}$/;
/** A rank, position, step, date, rate denominator or id before the number. */
const NOT_A_COUNT_BEFORE = new RegExp(String.raw`(?:\b(?:top|bottom|rank|ranks|ranked|ranking|no\.?|number|step|steps|page|pages|item|items|day|days|week|month|quarter|q|fy|per|every|each|largest|biggest|smallest|first|last|next|leading|id|cert|rssd|charter|fips|zip|routing|`
  + String.raw`jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\.?|#)\s*$`, "i");
/** A range's second end ("10 to 15 banks", "10 or 12 peers", "10—15 banks"): the band is not a count. */
const RANGE_BEFORE = /(?:\d|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundred|dozen))\s*(?:to|or|and|through|-|–|—)\s*$/i;
const HEDGE_BEFORE = /(?:\b(about|around|roughly|approximately|an\s+estimated|some|nearly|almost|close\s+to|just\s+under|under|less\s+than|fewer\s+than|at\s+most|up\s+to|no\s+more\s+than|just\s+over|over|more\s+than|at\s+least|upwards\s+of|a\s+minimum\s+of|minimum\s+of)|(~))\s*$/i;
const ABOUT = new Set(["about", "around", "roughly", "approximately", "an estimated", "some", "~"]);
const FLOOR = new Set(["more than", "over", "just over", "at least", "upwards of", "a minimum of", "minimum of"]);
/** A word that makes a sentence a rule ("needs", "requires", "minimum") rather than a statement about the evidence. */
const RULE_WORD = /\b(?:needs?|needed|requires?|required|requiring|minimum|threshold|must|too\s+few|not\s+enough|enough\s+to|only\s+(?:at|with|when|if))\b/i;
/** A threshold word before the count in its clause, or "or more"/"or fewer" after it. */
const THRESHOLD_BEFORE = /\b(?:at\s+least|fewer\s+than|less\s+than|more\s+than|at\s+most|minimum\s+of|under|over|below|above)\b/i;
const THRESHOLD_AFTER = /^\s*(?:or\s+(?:more|fewer|less|above|below)\b)/i;

const countClass = (noun: string): CountClass =>
  /^complaint/i.test(noun) ? "complaint" : /^(?:branch|office)/i.test(noun) ? "branch" : "institution";

/** One unit of a count's last stated place: 1,200 -> 100, 40 -> 10, 42 -> 1. */
function lastPlace(value: number): number {
  let place = 1;
  while (value >= place * 10 && value % (place * 10) === 0) place *= 10;
  return place;
}

function hedged(value: number, before: string): Pick<CountFigure, "tolerance" | "bound"> {
  const match = HEDGE_BEFORE.exec(before);
  if (!match) return { tolerance: 0.5 };
  const hedge = (match[1] ?? match[2]).toLowerCase().replace(/\s+/g, " ");
  const unit = lastPlace(value);
  if (ABOUT.has(hedge)) return { tolerance: unit + 1e-9 };
  if (FLOOR.has(hedge)) return { tolerance: 0, bound: "floor" };
  return { tolerance: 2 * unit + 1e-9, bound: "ceiling" };
}

/** Inside a citation in square brackets or a code span on the same line. */
function inCitation(text: string, index: number): boolean {
  const line = text.slice(text.lastIndexOf("\n", index - 1) + 1, index);
  const open = line.lastIndexOf("[");
  if (open >= 0 && line.indexOf("]", open) < 0) return true;
  return (line.match(/`/g)?.length ?? 0) % 2 === 1;
}

/** The clause around a position: from the last sentence or clause break before it to the next one after. */
function clauseAround(text: string, start: number, end: number): { before: string; after: string; whole: string } {
  const from = Math.max(...[".", "!", "?", ";", "\n"].map((mark) => text.lastIndexOf(mark, start - 1))) + 1;
  const stops = [".", "!", "?", ";", "\n"].map((mark) => text.indexOf(mark, end)).filter((i) => i >= 0);
  const to = stops.length ? Math.min(...stops) : text.length;
  return { before: text.slice(from, start), after: text.slice(end, to), whole: text.slice(from, to) };
}

/** A count a rule states as its threshold: "needs at least five competitors", "at least 5 local competitors, or 10 peers". */
function ruleThreshold(plain: string, start: number, end: number): boolean {
  const clause = clauseAround(plain, start, end);
  if (!RULE_WORD.test(clause.whole)) return false;
  return THRESHOLD_BEFORE.test(clause.before) || THRESHOLD_AFTER.test(clause.after);
}

/**
 * The counts a text states. `text` is the original text (for citations and code spans), `plain`
 * the same text with markdown emphasis blanked (every index still points into `text`), and `skip`
 * the spans another figure already reads.
 */
export function extractCountFigures(text: string, plain: string = text, skip: ReadonlyArray<{ start: number; end: number }> = []): CountFigure[] {
  const out: CountFigure[] = [];
  const overlaps = (start: number, end: number) => [...skip, ...out.map((f) => ({ start: f.index, end: f.index + f.raw.length }))]
    .some((span) => start < span.end && end > span.start);
  const read = (pattern: RegExp, digits: boolean) => {
    for (const match of plain.matchAll(pattern)) {
      const index = match.index ?? 0;
      const number = match[1];
      const value = digits ? Number(number.replace(/,/g, "")) : parseCardinal(number)?.value;
      if (value === undefined || !Number.isFinite(value)) continue;
      if (digits && !number.includes(",") && YEAR.test(number)) continue;
      const before = plain.slice(Math.max(0, index - 40), index);
      if (NOT_A_COUNT_BEFORE.test(before) || RANGE_BEFORE.test(before) || inCitation(text, index)) continue;
      const raw = match[0].trimEnd();
      if (overlaps(index, index + raw.length)) continue;
      // A singular noun after a number above one is a noun before a noun ("two branch records", "3 bank fees"): not a count of it.
      if (value !== 1 && !/s$/i.test(match[2])) continue;
      if (ruleThreshold(plain, index, index + raw.length)) continue;
      out.push({ raw: text.slice(index, index + raw.length), value, ...hedged(value, before), index, countOf: countClass(match[2]) });
    }
  };
  read(DIGIT_OF_COUNT, true);
  read(DIGIT_COUNT, true);
  read(WORD_COUNT, false);
  return out.sort((a, b) => a.index - b.index);
}

/** Keys whose numbers are never counts: ids, dates, ranks, codes, request limits. */
const NOT_COUNT_KEY = /(^|_)(id|ids|year|years|quarter|month|day|date|district|rank|version|step|limit|offset|page|page_size|top_n|fips|cert|cert_number|rssd|zip|code|charter|number_of_pages)$/i;
/** Keys that name a count, whatever else they say ("total_complaints", "institution_count", "n"). */
const COUNT_KEY = /count|counted|(^|_)n$|^n_|(^|_)num(_|$)|number_of|institutions|banks|credit_unions|cus|peers|competitors|lenders|filers|branches|offices|locations|complaints|sample|observations|(^|_)size$/i;
/** Generic keys that are a count where they sit beside rows, or carry no unit outside a dollar or rate field. */
const GENERIC_COUNT_KEY = /^(?:total|total_results|rows|row_total|matches|results|hits)$/i;
/** Dollar and rate fields (figure-check.ts's MONEY_KEY and RATE_KEY): a fee of $42 is not 42 banks. */
const MONEY_OR_RATE_KEY = /amount|median|mean|avg|average|p\d\d|min|max|fee|price|cost|charge|income|revenue|deposit|asset|delta|cap|total|value|pct|percent|ratio|rate|share|roa|roe|margin|yield|change|growth/i;
/** Objects that hold fee prices (or the charters a fee is counted with), never counts. */
const FEE_OBJECT_KEY = /^(?:fees|your_fees|counted_with|counted_as)$/i;
/** Every fee category slug, read once on first use (so a module that mocks the taxonomy can still import this one). */
let feeCategories: Set<string> | null = null;
const isFeeCategory = (key: string) => (feeCategories ??= new Set([...Object.keys(DISPLAY_NAMES ?? {}), ...Object.keys(CANONICAL_KEY_MAP ?? {}), ...Object.values(CANONICAL_KEY_MAP ?? {})].map((k) => k.toLowerCase()))).has(key.toLowerCase());
const COUNT_UNIT = /^(?:count|counts|number|persons|institutions?|banks?|branches|offices|complaints?|filers?)\b/i;
const COUNT_METRIC = /count|number of|institutions|banks|branches|complaints|filers|peers|competitors/i;
/**
 * Rows of a kind: an array under a key that names the kind ("competitors", "branches"), or of
 * objects carrying a key that identifies one ("institution_id", "branch_name", "complaint_id"). A
 * search result's `{ id, name }` rows are institutions when they carry an institution's own field
 * (state, city, charter, asset size, district). A row of a fee category that carries a count of
 * banks ("bank_count") is not a row of banks.
 */
const ROWS_KEY: Record<CountClass, RegExp> = {
  complaint: /complaints$/i,
  branch: /(?:branches|offices|locations)$/i,
  institution: /(?:institutions|peers|competitors|banks|credit_unions|lenders|filers)$/i,
};
const ROW_IDENTITY: Record<CountClass, RegExp> = {
  complaint: /^(?:complaint_id|date_received)$/i,
  branch: /^(?:branch_id|branch_name|branch_number|uninumbr)$/i,
  institution: /^(?:institution_id|institution_name|cert|cert_number|rssd|rssd_id|charter_number|cu_number|bank_name|competitor_name|peer_name)$/i,
};
const INSTITUTION_FIELD = /^(?:state|state_code|city|charter_type|charter|asset_size|asset_tier|asset_size_tier|fed_district|district)$/i;
const isInstitutionSearchRow = (keys: readonly string[]) => keys.includes("id") && keys.includes("name") && keys.some((k) => INSTITUTION_FIELD.test(k));
const MAX_COUNT_NUMBERS = 5000;
const MAX_TEXT = 500_000;

export interface CountEvidence {
  /** Whole numbers a count may restate exactly. */
  exact: Set<number>;
  /** The most rows of each kind any one tool array returned. */
  rows: Record<CountClass, number>;
}

const plainObject = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value);
const wholeNumber = (value: unknown): number | null => {
  if (typeof value === "number") return Number.isInteger(value) && value >= 0 ? value : null;
  if (typeof value === "string" && /^(?:\d{1,3}(?:,\d{3})+|\d+)$/.test(value.trim())) return Number(value.trim().replace(/,/g, ""));
  return null;
};

interface Place {
  /** The record's unit or metric names a count, and this is its value field. */
  countRecord: boolean;
  /** The record holds an array beside this number (a list of rows). */
  besideRows: boolean;
  /** The record carries a unit (a dollar or other measure). */
  hasUnit: boolean;
  /** The key the record sits under is a dollar or rate key. */
  underMoney: boolean;
}
const TOP: Place = { countRecord: false, besideRows: false, hasUnit: false, underMoney: false };

/** What the evidence lets a count restate: see the module comment. */
export function countEvidence(data: unknown): CountEvidence {
  const exact = new Set<number>();
  const rows: Record<CountClass, number> = { institution: 0, branch: 0, complaint: 0 };
  let seen = 0;
  let textRead = 0;
  /** The count a number is, or null; `named` when its key or record says it is a count. */
  const asCount = (number: number, key: string, place: Place): { named: boolean } | null => {
    if (NOT_COUNT_KEY.test(key) || isFeeCategory(key)) return null;
    if (COUNT_KEY.test(key) || place.countRecord) return { named: true };
    if (GENERIC_COUNT_KEY.test(key)) return place.besideRows || (!place.hasUnit && !place.underMoney) ? { named: true } : null;
    return MONEY_OR_RATE_KEY.test(key) ? null : { named: false };
  };
  const visit = (value: unknown, key: string, place: Place, depth: number, fromArray = false) => {
    if (seen >= MAX_COUNT_NUMBERS || depth > 12) return;
    const number = wholeNumber(value);
    if (number !== null) {
      if (asCount(number, key, place)) { seen += 1; exact.add(number); }
      return;
    }
    if (typeof value === "string") {
      const text = value.trim();
      if (text.length <= 1_000_000 && (text.startsWith("{") || text.startsWith("["))) {
        try { visit(JSON.parse(text), key, place, depth + 1); return; } catch { /* Not JSON: read it as text. */ }
      }
      // A count a tool's own text states ("Contacts at 12 banks reported ...").
      if (textRead < MAX_TEXT && /\d|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|twelve|dozen)\b/i.test(text)) {
        const slice = text.slice(0, MAX_TEXT - textRead);
        textRead += slice.length;
        for (const count of extractCountFigures(slice)) if (!count.bound) exact.add(count.value);
      }
      return;
    }
    if (Array.isArray(value)) {
      if (value.length > 0) exact.add(value.length);
      const objects = value.filter(plainObject);
      if (objects.length > 0) {
        const rowKeys = Object.keys(objects[0]);
        for (const cls of Object.keys(ROWS_KEY) as CountClass[]) {
          const identified = rowKeys.some((k) => ROW_IDENTITY[cls].test(k)) || (cls === "institution" && isInstitutionSearchRow(rowKeys));
          if (ROWS_KEY[cls].test(key) || identified) rows[cls] = Math.max(rows[cls], objects.length);
        }
      }
      for (const item of value) visit(item, key, place, depth + 1, true);
      return;
    }
    if (plainObject(value)) {
      // Fee prices: an object of fees, or one keyed by fee categories, holds no counts.
      if (!fromArray && FEE_OBJECT_KEY.test(key)) return;
      const unit = value.unit ?? value.units;
      const label = [value.metric, value.measure, value.label, value.series_key].filter((v) => typeof v === "string").join(" ");
      const ownCount = (typeof unit === "string" && COUNT_UNIT.test(unit.trim())) || COUNT_METRIC.test(label);
      const entries = Object.entries(value);
      const besideRows = entries.some(([, child]) => Array.isArray(child) && child.length > 0);
      const childPlace = (childKey: string): Place => ({
        countRecord: ownCount && /^(?:value|values|count|n)$/i.test(childKey),
        besideRows,
        hasUnit: unit !== undefined && !ownCount,
        underMoney: MONEY_OR_RATE_KEY.test(key) && !COUNT_KEY.test(key),
      });
      // Sums and differences only of the counts one record names side by side.
      const siblings: number[] = [];
      for (const [childKey, child] of entries) {
        const number = wholeNumber(child);
        if (number !== null && asCount(number, childKey, childPlace(childKey))?.named) siblings.push(number);
        visit(child, childKey, childPlace(childKey), depth + 1);
      }
      for (let i = 0; i < siblings.length && i < 50; i++) {
        for (let j = i + 1; j < siblings.length && j < 50; j++) {
          exact.add(siblings[i] + siblings[j]);
          exact.add(Math.abs(siblings[i] - siblings[j]));
        }
      }
    }
  };
  visit(data, "", TOP, 0);
  return { exact, rows };
}

/** Whole numbers the reader's question states ("my 12 peers", "the 40 banks in my state"): a count may restate them. */
export function questionCountValues(question: string): number[] {
  return [...question.matchAll(/(?<![\w.,])(\d{1,3}(?:,\d{3})+|\d+)(?![.,]\d)/g)].map((m) => Number(m[1].replace(/,/g, "")))
    .concat(extractCountFigures(question).map((f) => f.value));
}

/** Whether a count the evidence holds (`held`) supports the stated count. */
function supports(figure: Pick<CountFigure, "value" | "tolerance" | "bound">, held: number): boolean {
  if (figure.bound === "floor") return held >= figure.value;
  if (figure.bound === "ceiling") return held <= figure.value && held >= figure.value - figure.tolerance;
  return Math.abs(figure.value - held) <= figure.tolerance;
}

/** Whether the evidence supports a count. */
export function countTraces(figure: Pick<CountFigure, "value" | "tolerance" | "countOf" | "bound">, evidence: CountEvidence, asked: readonly number[] = []): boolean {
  if (asked.some((value) => supports(figure, value))) return true;
  for (const value of evidence.exact) if (supports(figure, value)) return true;
  // A count of the rows a tool returned, or of some of them: some number of those rows fits the count.
  const rows = evidence.rows[figure.countOf];
  if (rows === 0) return false;
  const lowest = figure.bound === "floor" ? figure.value : figure.bound === "ceiling" ? figure.value - figure.tolerance : figure.value - figure.tolerance;
  return Math.max(0, lowest) <= rows;
}
