/**
 * How often a fee is charged, read from the words right after its own price on its schedule
 * line. Shared by Darwin's release review (a stated frequency that contradicts the line), Knox
 * (writing frequency at extraction) and Hamilton's frequency fill (a blank frequency on a live
 * fee). Only wording that points one way counts; anything else stays unknown.
 */

export const PER_ITEM_WORDING = /\b(each|per (item|check|transaction|occurrence|request|copy|page|withdrawal|debit|deposit)|\/\s?(item|check|transaction))(?![a-z])/i;
export const PERIODIC_WORDING = /\b(per (month|year|quarter)|monthly|annual(ly)?|quarterly|\/\s?(mo|month|yr|year)\b|a month|a year)/i;

// "/MO" after a word is a money order ("per check/MO"), not a month.
const MONTHLY_WORDING = /\b(per (calendar month|month|mo|statement cycle|statement period|cycle)|monthly|a month)(?![a-z])|(?<![a-z])\/\s?mo(?![a-z])|\/\s?month(?![a-z])/i;
const ANNUAL_WORDING = /\b(per year|annual(ly)?|yearly|a year)(?![a-z])|\/\s?(yr|year)(?![a-z])/i;
const QUARTERLY_WORDING = /\b(per quarter|quarterly)(?![a-z])|\/\s?(qtr|quarter)(?![a-z])/i;
// v4: a fee charged per day ("$5.00 per business day" on a continuous overdraft) is daily.
// A bare "daily" is often a limit ("this $33 fee can be charged daily"), so only "per day" counts.
const DAILY_WORDING = /\bper (business |calendar )?day\b/i;
const ONE_TIME_WORDING = /\bone[- ]time\b/i;
/**
 * Wording that makes the price something other than a flat charge per event or period. v6: a
 * maximum caps a per-item fee ("$2.00 per page up to a maximum of $5.00"); it is not a basis.
 */
const OTHER_BASIS = /(\bper (hour|dollar|hundred|thousand)\b|\bper\s*\$|\bhourly\b|\bper\s+\d|\bminimum\b)/i;
/**
 * An allowance is not the fee's period: "Cashier Checks (1 free per month) | $2.00" and "$1.00
 * ... after five (5) per month" are charged per item once the free ones are used.
 */
// v5: a count beyond the allowance ("Debit Card Replacement (More than 2 per year) | $5").
const ALLOWANCE = /\b(free|after|first|more than|over|in excess of|beyond|exceeding)\b[^|$]{0,40}?\b(per|in a|a|each) (month|statement cycle|cycle|year)\b/gi;

/**
 * v8: a rate basis in the fee's own name ("Account Balancing (per hour) / $35.00 Each") makes the
 * "Each" after the price a per-hour charge, not a flat one. Only rate words count: a name that
 * mentions a minimum balance still takes its period.
 */
const NAME_BASIS = /\bper (hour|dollar|hundred|thousand)\b|\bper\s*\$|\bhourly\b|\/\s?(hr|hour)(?![a-z])/i;

function withoutAllowance(text: string): string {
  return text.replace(ALLOWANCE, " ");
}
/** Per-event wording beyond the shared set, for filling a blank frequency. */
// v3: "ea." / "/ea", "per order", "per draft", "per signature", "per payment", "/card" and
// "/occurrence" (about 700 live fees left blank, Oct 9).
// v4: "per loan", "per notice", "per levy", "per stop payment", "per file", "/sheet", "/key"
// and other per-event nouns, and "occurance"/"occurence" misspelt (Oct 9). "Per statement"
// stays unknown: a paper-statement fee charged per statement is a monthly charge.
const MORE_PER_ITEM = /\bper (presentment|transfer|wire|card|key|inquiry|document|piece|sheet|occasion|money order|notary|order|draft|signature|payment|loan|notice|garnishment|levy|submission|incident|instance|application|stop( payment)?|overdraft|returned item|return|advance|verification|replacement|file|skip|reload|event|bag|stamp|occurr?[ae]nce)(?![a-z])|\/\s?(item|check|transaction|each|ea|copy|page|request|transfer|wire|card|occurrence|loan|key|sheet|withdrawal|document|draft|order|box|money order|inquiry)(?![a-z])|^\s*ea\b/i;
/** A cell after the price ("| $6.00 | Per Item") is read when it is this short. */
const NEXT_CELL_MAX = 25;
const PRICE = /\$\s?(\d[\d,]*(?:\.\d+)?|\.\d+)/g;

export type FilledFrequency = "per_item" | "one_time" | "monthly" | "annual" | "quarterly" | "daily";

/** The words right after the fee's own price on its line ("$5.00 each after 6"), else the whole line. */
export function wordsAfterPrice(sourceLine: string, amount: number | null): string {
  return priceWords(sourceLine, amount, false)[0] ?? sourceLine;
}

/**
 * The words after the price that equals `amount`, up to the next cell. With `nextCell`, an
 * empty rest of cell reads the next short cell instead ("Overdraft | $6.00 | Per Day"). Null
 * when the line does not print that price.
 */
function priceWords(sourceLine: string, amount: number | null, nextCell: boolean): string[] {
  const found: string[] = [];
  if (amount == null) return found;
  for (const match of sourceLine.matchAll(PRICE)) {
    if (Math.abs(Number(match[1].replace(/,/g, "")) - amount) >= 0.005) continue;
    const start = (match.index ?? 0) + match[0].length;
    const cells = sourceLine.slice(start, start + 60).split(/[|;]/);
    if (!nextCell) {
      found.push(cells[0].slice(0, 40));
      continue;
    }
    // Words after the price stop at the next price, and a label ending in a colon is the next
    // price's ("$8.00 Per check: $0.20").
    const own = cells[0].split(/\$\s?\.?\d/)[0];
    // v6: words before that label are still the fee's own ("$1.00/page Business: $3.00/page").
    if (own !== cells[0] && own.trim().endsWith(":")) found.push(own.replace(/[A-Za-z]+:\s*$/, ""));
    else if (own.trim() === "" && own === cells[0] && cells.length > 1 && cells[1].trim().length <= NEXT_CELL_MAX && !/\$\s?\.?\d/.test(cells[1])) found.push(cells[1]);
    else found.push(own.slice(0, 40));
  }
  return found;
}

/**
 * The frequency the line states for the fee's own price, or null when it states none, states
 * more than one, or prices the fee by something else (per day, per hour, per $100, a minimum).
 * The line must print the fee's price: a frequency is never borrowed from a neighbouring fee.
 */
export function frequencyFromLine(sourceLine: string | null | undefined, amount: number | null): FilledFrequency | null {
  if (!sourceLine) return null;
  const read = priceWords(sourceLine, amount, true).map((words) => periodWords(withoutAllowance(words))!);
  if (read.length === 0) return null;
  // v4: the same price printed twice with different words ("Returned Item: | $6.00 per
  // presentment | Replace Lost Card: | $6.00") does not say which is the fee's own.
  const readings = new Set(read.map((words) => (OTHER_BASIS.test(words) ? null : statedFrequency(words))));
  if (readings.size > 1) return null;
  const words = read[0];
  if (OTHER_BASIS.test(words)) return null;
  if (namedBasis(sourceLine, amount)) return null;
  const after = statedFrequency(words);
  if (after !== "none") return after;
  // Nothing after the price: the fee's own name may carry it ("Lost Key (each) | $15.00",
  // "Inactive Fee (Quarterly) | $10.00"), read from the start of its row to the price.
  const name = nameWords(sourceLine, amount);
  const before = name == null ? null : periodWords(withoutAllowance(name));
  if (before == null || OTHER_BASIS.test(before)) return null;
  const named = statedFrequency(before);
  return named === "none" ? null : named;
}

/** True when the fee's own name, before its price, states a rate basis such as per hour. */
export function namedBasis(sourceLine: string | null | undefined, amount: number | null): boolean {
  if (!sourceLine) return false;
  const name = nameWords(sourceLine, amount);
  return name != null && NAME_BASIS.test(name);
}

/** "each month" is a period, not an item: "a $15.00 service charge will be imposed each month". */
function periodWords(words: string | null): string | null {
  return words
    ?.replace(/\b(each|every) (monthly )?(statement cycle|cycle|month)\b/gi, " monthly ")
    .replace(/\b(each|every) year\b/gi, " annual ")
    .replace(/\b(each|every) quarter\b/gi, " quarterly ")
    .replace(/\b(each|every) (business )?day\b/gi, " per day ") ?? null;
}

/** One frequency, "none" when the words state none, null when they state several. */
function statedFrequency(words: string): FilledFrequency | "none" | null {
  const found: FilledFrequency[] = [];
  if (PER_ITEM_WORDING.test(words) || MORE_PER_ITEM.test(words)) found.push("per_item");
  if (ONE_TIME_WORDING.test(words)) found.push("one_time");
  if (MONTHLY_WORDING.test(words)) found.push("monthly");
  if (ANNUAL_WORDING.test(words)) found.push("annual");
  if (QUARTERLY_WORDING.test(words)) found.push("quarterly");
  if (DAILY_WORDING.test(words)) found.push("daily");
  if (found.length === 0) return "none";
  return found.length === 1 ? found[0] : null;
}

/**
 * The fee's own name before its price: the last cell between the previous price (or the line's
 * start) and it. "(Per month some exclusions apply) | Cashier's Check (Per item) .... $5.00"
 * reads "Cashier's Check (Per item)", not the note above it.
 */
function nameWords(sourceLine: string, amount: number | null): string | null {
  const region = ownRegion(sourceLine, amount);
  if (region == null) return null;
  const cells = region.before.split("|").map((cell) => cell.trim()).filter(Boolean);
  return cells.length > 0 ? cells[cells.length - 1] : "";
}

/** The text from the previous price to the fee's own price, and the price's position. */
function ownRegion(sourceLine: string, amount: number | null): { before: string; hasPrevious: boolean } | null {
  if (amount == null) return null;
  let previousEnd = 0;
  for (const match of sourceLine.matchAll(PRICE)) {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (Math.abs(Number(match[1].replace(/,/g, "")) - amount) < 0.005) return { before: sourceLine.slice(previousEnd, start), hasPrevious: previousEnd > 0 };
    previousEnd = end;
  }
  return null;
}

const STATED_WORDING: Record<string, RegExp> = {
  monthly: /\b(per (calendar month|month|statement cycle|statement period|cycle)|monthly|(each|every) month|a month)(?![a-z])|(?<![a-z])\/\s?mo\b|\/\s?month\b/i,
  annual: /\b(per year|annual(ly)?|yearly|(each|every) year|a year)(?![a-z])|\/\s?(yr|year)\b/i,
  quarterly: /\b(per quarter|quarterly)(?![a-z])/i,
  daily: /\b(per day|daily(?! (average |collected |ledger )?balance))(?![a-z])/i,
};
/** Words that read as a period but are not one: "minimum daily balance" is a balance. */
const MISREAD_PERIOD: Record<string, RegExp> = { daily: /\bdaily (average |collected |ledger )?balance\b/i };
/** A price that is a balance or limit in a name ("Below $1,000.00", "under $25)"), not a fee. */
const THRESHOLD_PRICE = /(below|under|less than|<|over|above|balances? of|balance|minimum|min\.?)\s*$/i;

function feePrices(cell: string): number[] {
  return [...cell.matchAll(PRICE)]
    .filter((match) => !THRESHOLD_PRICE.test(cell.slice(0, match.index ?? 0)))
    .map((match) => Number(match[1].replace(/,/g, "")));
}

/**
 * True when a stated period (monthly, annual, quarterly, daily) was read from another fee's row
 * on the same line: its wording is not in the fee's own row but is in a cell that prints
 * another fee's price. "Missing/Bad Address - per year .... $10.00 | Reverse Stop Payment
 * Request .... $20.00" gave the $20 fee "annual". The fee's own row runs from the cell after
 * the last other priced cell (a bare price cell always takes the name cell before it) through
 * its own price's cell and a short cell after it, so a heading ("Monthly Service Fees |
 * Checking | $5.00") or a balance in its own name ("Dormant Account Fee (Per Month) ... Below
 * $1,000.00 | $20.00") counts as its own. A period the line states only as a balance ("minimum
 * daily balance") is a misread too.
 */
export function borrowedFrequency(sourceLine: string | null | undefined, amount: number | null, stated: string | null | undefined): boolean {
  const wording = stated ? STATED_WORDING[stated] : undefined;
  if (!sourceLine || !wording || amount == null) return false;
  sourceLine = withoutAllowance(sourceLine);
  // "If a minimum daily balance of $2,500 is not maintained. | Returned Deposit | $25.00" gave
  // the returned-deposit fee "daily".
  if (!wording.test(sourceLine)) return MISREAD_PERIOD[stated!]?.test(sourceLine) ?? false;
  const cells = sourceLine.split("|");
  const priced = cells.map((cell) => feePrices(cell).length > 0);
  const own = cells
    .map((cell, index) => (feePrices(cell).some((price) => Math.abs(price - amount) < 0.005) ? index : -1))
    .filter((index) => index >= 0);
  if (own.length === 0) return false;
  const ownCells = new Set<number>();
  for (const cell of own) {
    let first = cell;
    if (first > 0 && !/[A-Za-z]/.test(cells[cell].split(PRICE_START)[0])) first -= 1;
    while (first > 0 && !priced[first - 1]) first -= 1;
    let last = cell;
    if (last + 1 < cells.length && !priced[last + 1] && cells[last + 1].trim().length <= NEXT_CELL_MAX) last += 1;
    for (let index = first; index <= last; index += 1) ownCells.add(index);
  }
  if ([...ownCells].some((index) => wording.test(cells[index]))) return false;
  return cells.some((cell, index) => !ownCells.has(index) && priced[index] && wording.test(cell));
}
const PRICE_START = /\$\s?\.?\d/;

/**
 * Categories charged per period or per day. A per-item reading of one of these is a
 * neighbour's wording ("Monthly maintenance fee: $8.00 Per check: $0.20"), never its own.
 */
export const PERIOD_FEE_KEYS: ReadonlySet<string> = new Set([
  "monthly_maintenance", "minimum_balance", "dormant_account", "safe_deposit_box", "continuous_od", "paper_statement",
]);

/**
 * The frequency a fee should carry: what its own row states, else a stated frequency that was not
 * read from another fee's row. A per-item reading never replaces a period on a period category.
 */
export function settledFrequency(
  sourceLine: string | null | undefined,
  amount: number | null,
  stated: string | null | undefined,
  canonicalKey: string | null | undefined,
): string | null {
  // v8: a fee charged per hour has no flat frequency, whatever was stated.
  if (namedBasis(sourceLine, amount)) return null;
  const own = frequencyFromLine(sourceLine, amount);
  const periodCategory = canonicalKey != null && PERIOD_FEE_KEYS.has(canonicalKey);
  const ownUsable = own && !(frequencyFamily(own) === "per_item" && periodCategory) ? own : null;
  if (ownUsable && frequencyFamily(ownUsable) !== frequencyFamily(stated)) return ownUsable;
  if (!stated) return ownUsable;
  // A period category keeps its stated period ("Safe Deposit Box rental annual fee ... | 3X5=$20.00"
  // names the period beside a note's price); only a misread "daily" is dropped there.
  const periodKey = periodCategory && stated !== "daily";
  // v4: a period the line never states, on a fee charged per event, came from somewhere else
  // ("Money Orders .... $3.00" read "monthly"; Darwin's 211-row eval, Oct 9).
  const wording = STATED_WORDING[stated];
  if (!periodCategory && wording && sourceLine && !wording.test(withoutAllowance(sourceLine))) return ownUsable;
  return periodKey || !borrowedFrequency(sourceLine, amount, stated) ? stated : ownUsable;
}

/** How often a fee is charged, with per-event words folded together. */
export function frequencyFamily(frequency: string | null | undefined): string | null {
  if (!frequency) return null;
  return ["per_item", "per_transaction", "per_occurrence", "one_time"].includes(frequency) ? "per_item" : frequency;
}
