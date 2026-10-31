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
 * citation in brackets or a code span, and a number another figure already reads ("1 in 4 peers" is
 * a share). List numbering ("1. Banks ...") never sits directly before a noun with only a space.
 *
 * What a count traces to (`countEvidence`): a whole number in the evidence that is not an id, year,
 * date, rank or a dollar or rate field, the sum or difference of two numbers the evidence calls
 * counts ("12 banks and 8 credit unions" stated as "20 institutions"), the length of any array the
 * tools returned, and, for a count no larger than the rows of institutions, branches or complaints
 * a tool returned, those rows: an answer that counts the rows it was given ("3 competitors charge
 * more") states a number the evidence holds only as rows, and the check cannot evaluate which rows
 * the answer filtered on. A hedge widens a count by one unit of its last stated place, in its own
 * direction: "about 1,200 banks" covers 1,100 to 1,300, "more than 40 peers" 40 to 60, "nearly 300
 * branches" 200 to 300. An unhedged count is exact.
 */

import { CARDINAL, DETERMINER, GROUP_ADJECTIVE, parseCardinal } from "./spelled-figures";

export type CountClass = "institution" | "branch" | "complaint";

export interface CountFigure {
  /** The number and its group: "42 banks", "12 of your peers". */
  raw: string;
  value: number;
  tolerance: number;
  index: number;
  countOf: CountClass;
}

const NOUN = String.raw`(?:banks?|credit[\s-]+unions?|institutions?|peers?|competitors?|lenders?|filers?|CUs|thrifts?|branch(?:es)?|offices?|complaints?)`;
const PLURAL_NOUN = String.raw`(?:banks|credit[\s-]+unions|institutions|peers|competitors|lenders|filers|CUs|thrifts|branches|offices|complaints)`;
/** The one describing word a count may take: a group adjective, or one that names a kind of complaint or branch. */
const COUNT_ADJECTIVE = String.raw`(?:${GROUP_ADJECTIVE}|fee|fee-related|CFPB|consumer|overdraft|in-market|in-state|out-of-state|active|insured|physical|open|retail|full-service|competing|reporting|eligible|chartered|bank|credit[\s-]+union)`;
const DIGITS = String.raw`(?<![\w$.,#/:'’–-])(\d{1,3}(?:,\d{3})+|\d+)(?![.,]\d|[%\w])`;
const AFTER = String.raw`[\s-]+(?:${COUNT_ADJECTIVE}[\s-]+)?(${NOUN})\b`;
const DIGIT_COUNT = new RegExp(String.raw`${DIGITS}${AFTER}`, "gi");
const DIGIT_OF_COUNT = new RegExp(String.raw`${DIGITS}\s+of\s+(?:${DETERMINER}\s+)?(?:${COUNT_ADJECTIVE}\s+)?(${PLURAL_NOUN})\b`, "gi");
const WORD_COUNT = new RegExp(String.raw`(${CARDINAL})${AFTER}`, "gi");

const YEAR = /^(?:19|20)\d{2}$/;
/** A rank, position, step, date, rate denominator or id before the number. */
const NOT_A_COUNT_BEFORE = new RegExp(String.raw`(?:\b(?:top|bottom|rank|ranks|ranked|ranking|no\.?|number|step|steps|page|pages|item|items|day|days|week|month|quarter|q|fy|per|every|each|largest|biggest|smallest|first|last|next|leading|id|cert|rssd|charter|fips|zip|routing|`
  + String.raw`jan|january|feb|february|mar|march|apr|april|may|jun|june|jul|july|aug|august|sep|sept|september|oct|october|nov|november|dec|december)\.?|#)\s*$`, "i");
/** A range's second end ("10 to 15 banks", "10 or 12 peers"): the band is not a count. */
const RANGE_BEFORE = /(?:\d|\b(?:one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|hundred|dozen))\s*(?:to|or|and|through|-|–)\s*$/i;
const HEDGE_BEFORE = /(?:\b(about|around|roughly|approximately|an\s+estimated|some|nearly|almost|close\s+to|just\s+under|under|less\s+than|fewer\s+than|just\s+over|over|more\s+than|at\s+least|upwards\s+of)|(~))\s*$/i;

const countClass = (noun: string): CountClass =>
  /^complaint/i.test(noun) ? "complaint" : /^(?:branch|office)/i.test(noun) ? "branch" : "institution";

/** One unit of a count's last stated place: 1,200 -> 100, 40 -> 10, 42 -> 1. */
function lastPlace(value: number): number {
  let place = 1;
  while (value >= place * 10 && value % (place * 10) === 0) place *= 10;
  return place;
}

function hedged(value: number, before: string): { value: number; tolerance: number } {
  const match = HEDGE_BEFORE.exec(before);
  if (!match) return { value, tolerance: 0.5 };
  const hedge = (match[1] ?? match[2]).toLowerCase().replace(/\s+/g, " ");
  const unit = lastPlace(value);
  if (["about", "around", "roughly", "approximately", "an estimated", "some", "~"].includes(hedge)) return { value, tolerance: unit + 1e-9 };
  if (["more than", "over", "just over", "at least", "upwards of"].includes(hedge)) return { value: value + unit, tolerance: unit + 1e-9 };
  return { value: value - unit, tolerance: unit + 1e-9 };
}

/** Inside a citation in square brackets or a code span on the same line. */
function inCitation(text: string, index: number): boolean {
  const line = text.slice(text.lastIndexOf("\n", index - 1) + 1, index);
  const open = line.lastIndexOf("[");
  if (open >= 0 && line.indexOf("]", open) < 0) return true;
  return (line.match(/`/g)?.length ?? 0) % 2 === 1;
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
      out.push({ raw: text.slice(index, index + raw.length), ...hedged(value, before), index, countOf: countClass(match[2]) });
    }
  };
  read(DIGIT_OF_COUNT, true);
  read(DIGIT_COUNT, true);
  read(WORD_COUNT, false);
  return out.sort((a, b) => a.index - b.index);
}

/** Keys whose numbers are never counts: ids, dates, ranks, codes, request limits. */
const NOT_COUNT_KEY = /(^|_)(id|ids|year|years|quarter|month|day|date|district|rank|version|step|limit|offset|page|top_n|fips|cert|cert_number|rssd|zip|code|charter|number_of_pages)$/i;
/** Keys that name a count, whatever else they say ("total_complaints", "institution_count", "n"). */
const COUNT_KEY = /count|counted|(^|_)n$|^n_|(^|_)num(_|$)|number_of|institutions|banks|credit_unions|cus|peers|competitors|lenders|filers|branches|offices|locations|complaints|sample|observations|(^|_)size$/i;
/** Dollar and rate fields (figure-check.ts's MONEY_KEY and RATE_KEY): a fee of $42 is not 42 banks. */
const MONEY_OR_RATE_KEY = /amount|median|mean|avg|average|p\d\d|min|max|fee|price|cost|charge|income|revenue|deposit|asset|delta|cap|total|value|pct|percent|ratio|rate|share|roa|roe|margin|yield|change|growth/i;
const COUNT_UNIT = /^(?:count|counts|number|persons|institutions?|banks?|branches|offices|complaints?|filers?)\b/i;
const COUNT_METRIC = /count|number of|institutions|banks|branches|complaints|filers|peers|competitors/i;
/**
 * Rows of a kind: an array under a key that names the kind ("competitors", "branches"), or of
 * objects carrying a key that identifies one ("institution_id", "branch_name", "complaint_id").
 * A row of a fee category that carries a count of banks ("bank_count") is not a row of banks.
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
const MAX_COUNT_NUMBERS = 5000;
const MAX_PAIRED = 300;

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

/** What the evidence lets a count restate: see the module comment. */
export function countEvidence(data: unknown): CountEvidence {
  const exact = new Set<number>();
  const strong: number[] = [];
  const rows: Record<CountClass, number> = { institution: 0, branch: 0, complaint: 0 };
  let seen = 0;
  const visit = (value: unknown, key: string, countRecord: boolean, depth: number) => {
    if (seen >= MAX_COUNT_NUMBERS || depth > 12) return;
    const number = wholeNumber(value);
    if (number !== null) {
      if (NOT_COUNT_KEY.test(key)) return;
      const named = COUNT_KEY.test(key) || countRecord;
      if (!named && MONEY_OR_RATE_KEY.test(key)) return;
      seen += 1;
      exact.add(number);
      if (named && strong.length < MAX_PAIRED) strong.push(number);
      return;
    }
    if (typeof value === "string") {
      const text = value.trim();
      if (text.length <= 1_000_000 && (text.startsWith("{") || text.startsWith("["))) {
        try { visit(JSON.parse(text), key, countRecord, depth + 1); } catch { /* Plain text is not evidence. */ }
      }
      return;
    }
    if (Array.isArray(value)) {
      if (value.length > 0) exact.add(value.length);
      const objects = value.filter(plainObject);
      if (objects.length > 0) {
        const rowKeys = Object.keys(objects[0]);
        for (const cls of Object.keys(ROWS_KEY) as CountClass[]) {
          if (ROWS_KEY[cls].test(key) || rowKeys.some((k) => ROW_IDENTITY[cls].test(k))) rows[cls] = Math.max(rows[cls], objects.length);
        }
      }
      for (const item of value) visit(item, key, countRecord, depth + 1);
      return;
    }
    if (plainObject(value)) {
      const unit = value.unit ?? value.units;
      const label = [value.metric, value.measure, value.label, value.series_key].filter((v) => typeof v === "string").join(" ");
      const ownCount = (typeof unit === "string" && COUNT_UNIT.test(unit.trim())) || COUNT_METRIC.test(label);
      for (const [childKey, child] of Object.entries(value)) visit(child, childKey, ownCount && /^(?:value|values|count|n)$/i.test(childKey), depth + 1);
    }
  };
  visit(data, "", false, 0);
  for (let i = 0; i < strong.length; i++) {
    for (let j = i + 1; j < strong.length; j++) {
      exact.add(strong[i] + strong[j]);
      exact.add(Math.abs(strong[i] - strong[j]));
    }
  }
  return { exact, rows };
}

/** Whole numbers the reader's question states ("my 12 peers", "the 40 banks in my state"): a count may restate them. */
export function questionCountValues(question: string): number[] {
  return [...question.matchAll(/(?<![\w.,])(\d{1,3}(?:,\d{3})+|\d+)(?![.,]\d)/g)].map((m) => Number(m[1].replace(/,/g, "")))
    .concat(extractCountFigures(question).map((f) => f.value));
}

/** Whether the evidence supports a count. */
export function countTraces(figure: Pick<CountFigure, "value" | "tolerance" | "countOf">, evidence: CountEvidence, asked: readonly number[] = []): boolean {
  const near = (value: number) => Math.abs(figure.value - value) <= figure.tolerance;
  if (asked.some(near)) return true;
  for (const value of evidence.exact) if (near(value)) return true;
  // A count of the rows a tool returned, or of some of them: no larger than those rows.
  const rows = evidence.rows[figure.countOf];
  return rows > 0 && figure.value - figure.tolerance <= rows;
}
