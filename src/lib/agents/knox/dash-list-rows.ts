import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { inPriceFirstListRun, nameAfterPrice, SECTION_HEADING } from "@/lib/agents/knox/layout";
import { classifyFeeText, type ExtractedFeeCandidate } from "@/lib/agents/knox/rules";

/**
 * v148 (#1092): a price-first list whose lines set the price apart from the fee's name with a dash
 * ("$25.00 - NSF Check/ACH/ATM item" / "$20.00 - Stop Payment (single check)", Crow Wing Power CU,
 * State key 10272). With the dash, no reader saw a name after the price, so each price went to the
 * name on the line above and every fee in the list took the next fee's price ("Stop Payment (single
 * check)" at the range's $35).
 *
 * Such a line says, in another order, what a label row says ("NSF Check/ACH/ATM item | $25.00"), so
 * Knox reads it as that row and every reader settles it as it settles the row: the name, category,
 * frequency, audience and heading rules are base's own for that row. The row form, not the plain
 * price-first line ("$20.00 Account Reconciliation (per hour)"), because base reads a name's own unit
 * from a label row ("Account Reconciliation (per hour) | $20.00" is hourly) but not after a leading
 * price (flat), and its price qualifier takes a name's first word as the unit on a price-first line
 * ("$35.00 Daily Overdraft Fee" is also read as "Overdraft Fee", daily).
 *
 * A line is a dash list line only when all of these hold:
 * - its first price opens the line, after at most a list bullet ("-", "•") or an invisible character;
 * - a dash with a space on each side follows that price, then a capital letter;
 * - the words after the dash are a name by base's own test (`nameAfterPrice`): not a condition or
 *   sentence ("$10.00 - If both keys are lost, ..." stays the price of "Replace Lost Key" above it),
 *   a period alone ("$3 - Monthly"), a range ("$5 - $15"), a count ("$5 - 10 Copies") or a lowercase
 *   clause ("$5 - for first occurrence"), and hold no other cell, price or rate.
 *
 * A run of them is read as rows only when all of these hold, and is otherwise read as stored:
 * - without the dashes the lines are a price-first list by base's own run test (`inPriceFirstListRun`,
 *   v94): two such lines or more that no bare price closes. A lone dash line keeps base's reading;
 * - the line above the run cannot own its first price: it is priced itself, a section title ("Checking
 *   Fees") or names no fee ("Mortgage"). Under a fee's name ("Overdraft Fee" / "$30.00 - Stop
 *   Payment" / ...) the first price may be that name's, so the run keeps base's stacked reading;
 * - every fee read from the run's rows traces to the stored text by the shared check, as Darwin will
 *   check it; a run with a read that does not trace is read as stored;
 * - no fee base reads from any other line is lost. Otherwise the whole text is read as stored.
 */
const PRICE_DASH_NAME = /^\s*(?:[-–—•●▪*]\s+)?[​-‍⁠﻿]*(\$\s?\d[\d,]*(?:\.\d{1,2})?)\s+[-–—]\s+(?=[A-Z])(.*)$/;
const INVISIBLE = /[​-‍⁠﻿]/g;
/** Each retry drops at least one run, so the loop ends on its own; the bound is only a backstop. */
const MAX_RUN_RETRIES = 20;

interface DashLine {
  /** The line's index in the stored text. */
  index: number;
  price: string;
  name: string;
  /** The label row Knox reads in its place. */
  row: string;
  /** The stored line, spaces collapsed. */
  stored: string;
}

type DashRun = DashLine[];

const collapse = (value: string): string => value.replace(INVISIBLE, "").replace(/\s+/g, " ").trim();

function dashLine(line: string, index: number): DashLine | null {
  const match = line.match(PRICE_DASH_NAME);
  if (!match) return null;
  const price = match[1].replace(/\s+/g, "");
  const name = match[2].trim();
  if (/[|$]|\d\s*%/.test(name) || nameAfterPrice(name) == null) return null;
  return { index, price, name, row: `${name} | ${price}`, stored: collapse(line) };
}

/** True when the unpriced line above a run cannot be the name that owns the run's first price. */
function opensRows(line: string | undefined): boolean {
  if (line == null) return true;
  const title = collapse(line).replace(/:$/, "");
  return line.includes("$") || SECTION_HEADING.test(title) || classifyFeeText(title) == null;
}

/** The runs of dash list lines Knox may read as label rows, in reading order. */
export function dashListRuns(text: string): DashRun[] {
  if (!text.includes("$")) return [];
  const lines = text.split("\n");
  // Base's run test reads the lines as the price windows do: blank lines dropped, spaces collapsed.
  const filled = lines.map((line, index) => (line.trim() ? index : -1)).filter((index) => index >= 0);
  const dashes = filled.map((index) => dashLine(lines[index], index));
  if (dashes.every((dash) => dash == null)) return [];
  const plain = filled.map((index, at) => {
    const dash = dashes[at];
    return dash ? `${dash.price} ${dash.name}` : lines[index].replace(/\s+/g, " ").trim();
  });
  const runs: DashRun[] = [];
  let current: DashRun = [];
  let above: string | undefined;
  const close = () => {
    if (current.length > 0 && opensRows(above)) runs.push(current);
    current = [];
  };
  filled.forEach((index, at) => {
    const dash = dashes[at];
    if (dash && inPriceFirstListRun(plain, at)) {
      if (current.length === 0) above = at > 0 ? lines[filled[at - 1]] : undefined;
      current.push(dash);
    } else {
      close();
    }
  });
  close();
  return runs;
}

/** The text with each run's lines replaced by the label rows they list. */
export function withDashListRows(text: string, runs: readonly DashRun[] = dashListRuns(text)): string {
  if (runs.length === 0) return text;
  const lines = text.split("\n");
  for (const run of runs) for (const line of run) lines[line.index] = line.row;
  return lines.join("\n");
}

function fromRun(candidate: ExtractedFeeCandidate, run: DashRun): boolean {
  const excerpt = collapse(candidate.excerpt);
  return run.some((line) => excerpt.includes(collapse(line.row)));
}

/** The shortest excerpt that can stand for a line: a bare price ("$20.00") is on many lines. */
const MIN_EXCERPT_CHARS = 8;

/** A base read that took any of its words or its price from a run's lines. */
function touchesRuns(candidate: ExtractedFeeCandidate, runs: readonly DashRun[]): boolean {
  const excerpt = collapse(candidate.excerpt);
  return runs.some((run) =>
    run.some((line) => excerpt.includes(collapse(line.name)) || excerpt.includes(line.stored) || (excerpt.length >= MIN_EXCERPT_CHARS && line.stored.includes(excerpt))),
  );
}

const sameRead = (a: ExtractedFeeCandidate, b: ExtractedFeeCandidate): boolean =>
  a.feeName === b.feeName && a.amount === b.amount && a.canonicalHint === b.canonicalHint && (a.frequency ?? null) === (b.frequency ?? null);

function tracesInStoredText(stored: string, candidate: ExtractedFeeCandidate): boolean {
  const result = checkFeeAgainstSource(stored, candidate.feeName, candidate.amount, ".", candidate.canonicalHint);
  return result.ok || result.reason === "tiered_fee";
}

/**
 * Reads `stored` with `read`, its dash list runs as label rows where every rule above holds, and as
 * stored otherwise. `read` is one full Knox read of a text.
 */
export function readDashListsAsRows<R extends { candidates: ExtractedFeeCandidate[] }>(stored: string, read: (text: string) => R): R {
  let runs = dashListRuns(stored);
  if (runs.length === 0) return read(stored);
  const base = read(stored);
  for (let retry = 0; runs.length > 0 && retry < MAX_RUN_RETRIES; retry += 1) {
    const head = read(withDashListRows(stored, runs));
    const untraced = runs.filter((run) => head.candidates.some((candidate) => fromRun(candidate, run) && !tracesInStoredText(stored, candidate)));
    if (untraced.length > 0) {
      runs = runs.filter((run) => !untraced.includes(run));
      continue;
    }
    const kept = base.candidates.every((prior) => touchesRuns(prior, runs) || head.candidates.some((candidate) => sameRead(candidate, prior)));
    return kept ? head : base;
  }
  return base;
}
