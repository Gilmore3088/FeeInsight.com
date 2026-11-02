import { checkFeeAgainstSource } from "@/lib/custom-report/source-check";
import { inPriceFirstListRun, nameAfterPrice, SECTION_HEADING, tidyFeeName } from "@/lib/agents/knox/layout";
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
const PRICE_DASH_NAME = /^\s*(?:[-–—•●▪*]\s+)?[\u200b-\u200d\u2060\ufeff]*(\$\s?\d[\d,]*(?:\.\d{1,2})?)\s+[-–—]\s+(?=[A-Z])(.*)$/;
const INVISIBLE = /[\u200b-\u200d\u2060\ufeff]/g;
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

export function tracesInStoredText(stored: string, candidate: ExtractedFeeCandidate): boolean {
  const result = checkFeeAgainstSource(stored, candidate.feeName, candidate.amount, ".", candidate.canonicalHint);
  return result.ok || result.reason === "tiered_fee";
}

/**
 * Off switch for the full rewrite (#2834 review). Off (the default, every live path), the run's rows only
 * add reads: base's whole reading is kept exactly as it is, and a read from a rewritten row is added
 * only when base reads nothing from that run (no name or price of its lines, `touchesRuns`), the read
 * traces to the stored text, base reads no fee of the same name in the document at any price (names
 * compared tidied, letters and digits only), and base reads no fee of the same category at the same
 * price. Otherwise an added read could put a second price beside a fee base already reads, which live
 * Hamilton publishes as an additional line under the same name (`decidePriorFee`). State key 10272 reads
 * exactly as on main: main reads from both its runs (the wrong $35 single check, and the card replacement
 * priced from the next section's first line), so they add nothing.
 * On, a run's rows replace base's reads of its lines (10272's single check at its own $20). That rejects
 * and reprices reads that publish today, so before it is switched on James runs the read-only dry run on
 * #1092, and a Darwin live re-check that retires the replaced live rows ships with its count. The shadow
 * lab's `dash-list-rows` experiment passes `full: true`.
 */
export const DASH_LIST_ROWS_LIVE = false;

/** The run's lines as printed, for the evidence: a read from a row keeps the bank's own words. */
function withPrintedExcerpts(candidates: ExtractedFeeCandidate[], runs: readonly DashRun[]): ExtractedFeeCandidate[] {
  return candidates.map((candidate) => {
    const line = runs.flatMap((run) => run).find((dash) => collapse(candidate.excerpt) === collapse(dash.row));
    return line ? { ...candidate, excerpt: line.stored } : candidate;
  });
}

/**
 * A fee name as a comparison key: tidied as readers tidy it, then letters and digits only, so the
 * stacked reader's "Stop Payment: \u200d" at a section break, "Stop Payment -" and "STOP PAYMENT" are
 * all the "Stop Payment" an added read names (review of bbd4388).
 */
export const nameKey = (name: string): string => tidyFeeName(collapse(name)).toLowerCase().replace(/[^a-z0-9]+/g, "");

/**
 * Admit-only: base's reading, plus the row reads from runs base reads nothing from, that name a fee base
 * does not read and take no category and price base reads. A run any base read took a name or price from
 * (`touchesRuns`) adds nothing: base already gave one of its lines a reading, and an added read could
 * put a second price beside it.
 */
function withAddedRowReads<R extends { candidates: ExtractedFeeCandidate[] }>(base: R, head: R, runs: readonly DashRun[], stored: string): R {
  const names = new Set(base.candidates.map((candidate) => nameKey(candidate.feeName)));
  const priced = new Set(base.candidates.map((candidate) => `${candidate.canonicalHint}:${candidate.amount}`));
  const untouched = runs.filter((run) => !base.candidates.some((prior) => touchesRuns(prior, [run])));
  const added = head.candidates.filter((candidate) =>
    untouched.some((run) => fromRun(candidate, run)) &&
    !names.has(nameKey(candidate.feeName)) &&
    !priced.has(`${candidate.canonicalHint}:${candidate.amount}`) &&
    tracesInStoredText(stored, candidate),
  );
  return added.length === 0 ? base : { ...base, candidates: [...base.candidates, ...withPrintedExcerpts(added, runs)] };
}

/**
 * Reads `stored` with `read`, its dash list runs as label rows where every rule above holds, and as
 * stored otherwise. `read` is one full Knox read of a text. With `full` off (`DASH_LIST_ROWS_LIVE`),
 * base's reading is kept whole and the rows only add reads (`withAddedRowReads`).
 */
export function readDashListsAsRows<R extends { candidates: ExtractedFeeCandidate[] }>(
  stored: string,
  read: (text: string) => R,
  options: { full?: boolean } = {},
): R {
  const full = options.full ?? DASH_LIST_ROWS_LIVE;
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
    if (!full) return withAddedRowReads(base, head, runs, stored);
    const kept = base.candidates.every((prior) => touchesRuns(prior, runs) || head.candidates.some((candidate) => sameRead(candidate, prior)));
    return kept ? { ...head, candidates: withPrintedExcerpts(head.candidates, runs) } : base;
  }
  return base;
}
