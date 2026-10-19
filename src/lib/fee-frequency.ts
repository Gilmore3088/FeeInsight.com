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
// v9: "each above 6/month" (101933, Oct 9).
const ALLOWANCE = /\b(free|after|first|more than|over|above|in excess of|beyond|exceeding)\b[^|$]{0,40}?(\b(per|in a|a|each) |\/\s?)(month|statement cycle|cycle|year)\b/gi;

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

/**
 * #1456: a fee charged by the hour ("Research Fee $25/hour", "Account reconciliation per hour",
 * "Subpoena Fee - Per Hour (Minimum One Hour Charge)", "Coin Counting (hour)"). Stored as
 * `hourly` and shown as "per hour". Only a per-hour basis counts: "24 hour", "within 48 hours",
 * "after hours", "hours of operation" and "1 hour photo" never say "per", "/", "hourly" or a bare
 * "(hour)", so they do not match.
 */
export const HOURLY_FREQUENCY = "hourly";
export const HOURLY_WORDING = /\bper\s+(?:an?\s+|each\s+|one\s+|1\s+)?(?:hour|hr)s?(?![a-z])|\bhourly(?![a-z])|\beach\s+hour(?![a-z])|\$\s?[\d.,]+\s*(?:an?|\/)\s*(?:hour|hr)s?(?![a-z])|\/\s?(?:hour|hr)s?(?![a-z])|\(\s*(?:hour|hr)s?\s*\)/i;
/**
 * A price per part of an hour ("$10 per 15 min", "per half hour", "per 1/2 hour", "per minute"):
 * not an hourly charge, so the fee keeps no hourly frequency. A minimum ("1/2 hour minimum") is not a basis.
 */
export const PARTIAL_HOUR_WORDING = /(?:\bper|\beach|\bevery|\/)\s*(?:half|1\/2|quarter|15|30|fifteen|thirty)[\s-]*(?:an?\s+)?(?:hour|hr|minutes?|mins?)(?![a-z])|\bper\s+(?:minute|min)(?![a-z])|\b(?:half|quarter)[\s-]hour(?:ly)?\s+(?:increments?|rate|charge)(?![a-z])/i;

/**
 * Categories never charged by the hour: a per-hour reading on one of these is a misread or a
 * neighbour's wording, so it is left for a person (#1456: "Monthly Fee: (per hour)" filed as
 * monthly maintenance).
 */
export const HOURLY_EXEMPT_KEYS: ReadonlySet<string> = new Set([
  "monthly_maintenance", "minimum_balance", "dormant_account", "continuous_od", "paper_statement",
  "nsf", "overdraft", "deposited_item_return",
]);

/** True when the words price the fee by the whole hour and not by a part of one. Pure. */
export function hourlyWording(words: string | null | undefined): boolean {
  if (!words) return false;
  return HOURLY_WORDING.test(words) && !PARTIAL_HOUR_WORDING.test(words);
}

/**
 * True when the fee's own row prices it by the hour: its name before its price ("Research (per
 * hour) | $25.00 Each") or the words right after its price ("Research | $25.00/hr", "$40 per hour").
 * The line must print the fee's price. A supplied fee name must occur in that price's own
 * region, even on a single-price line. Without a name, incompatible equal-price readings stay
 * unknown. Bounds are not fee prices, and explicit partial-hour units never become hourly. Pure.
 */
export function hourlyFromLine(sourceLine: string | null | undefined, amount: number | null, feeName?: string | null): boolean {
  if (!sourceLine || amount == null) return false;
  const prices = [...sourceLine.matchAll(PRICE)];
  const feePrices = prices.filter((match) => !hourlyBoundPrice(sourceLine, match));
  const readings: boolean[] = [];
  for (const match of feePrices) {
    if (Math.abs(Number(match[1].replace(/,/g, "")) - amount) >= 0.005) continue;
    const index = prices.indexOf(match);
    const previous = feePrices[feePrices.indexOf(match) - 1];
    const before = sourceLine.slice(previous ? (previous.index ?? 0) + previous[0].length : 0, match.index);
    // Several priced fees can share one flattened line. Its repeated amount is not an owner:
    // Stop Payment $30 | Research (per hour) $30 must use the requested fee's own label.
    let ownName = before.split("|").map((cell) => cell.trim()).filter(Boolean).at(-1) ?? "";
    if (feeName) {
      const start = hourlyOwnerStart(before, feeName);
      if (start == null) continue;
      ownName = before.slice(start);
    } else if (previous) {
      // The words immediately after the previous price belong to that price, not to a later
      // label in the same cell: Research $25 per hour Counter Check $2 each.
      const inherited = leadingWording(ownName, HOURLY_WORDING);
      if (inherited) ownName = ownName.slice(inherited.index + inherited[0].length);
    }
    const start = (match.index ?? 0) + match[0].length;
    const cells = sourceLine.slice(start, prices[index + 1]?.index ?? sourceLine.length).split(/[|;]/);
    const own = cells[0];
    const unitCell = own.trim() === "" && cells.length > 1 ? cells[1] : own;
    const partial = PARTIAL_HOUR_WORDING.test(ownName) || leadingWording(unitCell, PARTIAL_HOUR_WORDING) != null;
    const after = leadingWording(own, HOURLY_WORDING) != null;
    const nextCell = own.trim() === "" && cells.length > 1 && HOURLY_CELL.test(cells[1]);
    readings.push(!partial && (hourlyWording(ownName) || after || nextCell));
  }
  // Without a unique named owner, the same price on incompatible rows stays unknown.
  return readings.length > 0 && readings.every(Boolean);
}

/** A minimum/maximum is a bound, not another fee at the same amount. */
function hourlyBoundPrice(line: string, match: RegExpMatchArray): boolean {
  const before = line.slice(0, match.index ?? 0);
  const after = line.slice((match.index ?? 0) + match[0].length);
  return /\b(?:min(?:imum)?|max(?:imum)?)\.?(?:\s+(?:charge|fee))?(?:\s+of)?\s*$/i.test(before)
    || /^\s*(?:per\s+)?(?:min(?:imum)?|max(?:imum)?)(?![a-z])/i.test(after);
}

/** A printed fee label, allowing punctuation and whitespace transport changes only. */
function hourlyOwnerStart(before: string, feeName: string): number | null {
  const words = feeName.match(/[a-z0-9]+/gi);
  if (!words?.length) return null;
  const pattern = new RegExp(`(?:^|[^a-z0-9])(${words.join("[^a-z0-9]*")})(?=$|[^a-z0-9])`, "gi");
  const matches = [...before.matchAll(pattern)];
  const last = matches.at(-1);
  return last ? (last.index ?? 0) + last[0].length - last[1].length : null;
}

/** Unit wording must start the price suffix, before another fee's label. */
function leadingWording(words: string, pattern: RegExp): RegExpExecArray | null {
  const match = pattern.exec(words);
  return match && /^(?:[\s(*.,:/\-–—†‡]|per\s*|plus\s+tax\s*|charged\s+for\s*)*$/i.test(words.slice(0, match.index)) ? match : null;
}
/** A cell that is only an hour basis: "per hour", "(Hourly)", "/hr". */
const HOURLY_CELL = /^\s*\(?\s*(?:per\s+(?:hour|hr)|hourly|\/\s?(?:hour|hr))s?\s*\)?\.?\s*$/i;

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
  // v9: a cell priced "N/C" or "Free" is another fee's row too ("Monthly service fee ... N/C | ATM ... $1.00").
  const priced = cells.map((cell) => feePrices(cell).length > 0 || NO_CHARGE.test(cell));
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
const NO_CHARGE = /(^|[\s.…])(n\/c|no charge|free)\s*\*?\s*$/i;

/** A safe deposit box named by its size ("3 x 5", "10x10x21", "5 x 10” box"). */
export const BOX_SIZE_NAME = /^\W*\d{1,2}(?:\.\d)?\s*[x×]\s*\d{1,2}/i;
const ANNUAL_HEADER_MAX = 40;
const HEADER_LOOK_BACK = 12;
/** A cell that starts with a box size, fractions included ("2 ½ x 5", "3x5 ....$40"). */
const BOX_SIZE_CELL = /^\W*\d{1,2}(?:[.,]\d+)?\s*(?:[½¼¾]|\d\/\d)?\s*[x×]\s*\d/i;

/**
 * v10: the annual period a box table's column header gives its rows ("Box Size: | Annual Rental:"
 * over "3 x 5 x 21 | $25", Altra 104006). The fee's own line is found in the document text, and the
 * lines above it, up to 12, are read for the header: a short cell saying "annual", "per year" or
 * "yearly" that prints no price and is not followed by a price cell (so "Annual Fee | $10.00" is a
 * fee, not a header), on a line with no "monthly". Every priced line between the header and the fee
 * must carry a box size, so a header above another table never reaches the box rows. Only annual is read: a box
 * rent is charged by the year, and a "per month" cell near a box table is another product's ("$10
 * per month ... if account balance is less than $100"). Null when the line is not found or no such
 * header is above it. Pure.
 */
export function boxTableAnnualHeader(text: string, sourceLine: string, amount: number): "annual" | null {
  const lines = text.split(/\r?\n/);
  const target = sourceLine.replace(/\s+/g, " ").trim();
  if (!target) return null;
  const at = lines.findIndex((line) => line.replace(/\s+/g, " ").includes(target));
  if (at < 0 || !feePrices(lines[at]).some((price) => Math.abs(price - amount) < 0.005)) return null;
  for (let index = at - 1; index >= Math.max(0, at - HEADER_LOOK_BACK); index -= 1) {
    const line = lines[index];
    const cells = line.split("|").map((cell) => cell.trim());
    const priced = cells.map((cell) => PRICE_START.test(cell));
    const header = cells.some((cell, cellIndex) =>
      cell.length > 0 && cell.length <= ANNUAL_HEADER_MAX && !priced[cellIndex] && !priced[cellIndex + 1] && STATED_WORDING.annual.test(cell));
    if (header) return STATED_WORDING.monthly.test(line) ? null : "annual";
    if (priced.some(Boolean) && !cells.some((cell) => BOX_SIZE_CELL.test(cell))) return null;
  }
  return null;
}

/**
 * Categories charged per period or per day. A per-item reading of one of these is a
 * neighbour's wording ("Monthly maintenance fee: $8.00 Per check: $0.20"), never its own.
 */
export const PERIOD_FEE_KEYS: ReadonlySet<string> = new Set([
  "monthly_maintenance", "minimum_balance", "dormant_account", "safe_deposit_box", "continuous_od", "paper_statement",
]);

/**
 * Categories charged once per event, never per period (#1196): a returned or unpaid item. A period
 * on one of these is a neighbour's wording or a price split at its decimal point ("$35.00 per month
 * Nonsufficient funds" read as "00 per month Nonsufficient funds", monthly).
 */
export const PER_EVENT_FEE_KEYS: ReadonlySet<string> = new Set(["nsf"]);

/**
 * A per-event fee keeps a per-event frequency or none: a stated period is replaced by the per-item
 * reading of its own line when there is one, else cleared. Other categories pass through as they are.
 */
export function perEventFrequency(
  canonicalKey: string | null | undefined,
  frequency: string | null,
  sourceLine: string | null | undefined,
  amount: number | null,
): string | null {
  if (canonicalKey == null || !PER_EVENT_FEE_KEYS.has(canonicalKey)) return frequency;
  if (frequency == null || frequencyFamily(frequency) === "per_item") return frequency;
  const own = frequencyFromLine(sourceLine, amount);
  return own && frequencyFamily(own) === "per_item" ? own : null;
}

/**
 * The frequency a fee should carry: what its own row states, else a stated frequency that was not
 * read from another fee's row. A per-item reading never replaces a period on a period category.
 */
export function settledFrequency(
  sourceLine: string | null | undefined,
  amount: number | null,
  stated: string | null | undefined,
  canonicalKey: string | null | undefined,
  options: { hourly?: boolean } = {},
): string | null {
  // #1456: an hourly frequency comes from the fee's own words (Darwin's live hourly re-check) and
  // is never replaced by a flat reading of the same line.
  if (stated === HOURLY_FREQUENCY) return HOURLY_FREQUENCY;
  // #1456: with `hourly: true`, a fee whose own row prices it by the hour is hourly, unless its
  // category is never charged by the hour ("Monthly Fee: (per hour) | $25" is a misread a person
  // looks at). Opt-in: Knox does not read hourly at extraction yet (it rides the next Knox rules
  // bump), and the fill and Darwin's verify leave it to Darwin's switched live re-check.
  if (options.hourly === true && hourlyFromLine(sourceLine, amount) && !(canonicalKey != null && HOURLY_EXEMPT_KEYS.has(canonicalKey))) return HOURLY_FREQUENCY;
  // v8: a fee charged by a rate (per $100, per dollar, or per hour where hourly is not read above)
  // has no flat frequency, whatever was stated.
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

/** The fee categories whose stated period is re-checked against their own line (#1196, #1339). */
export const PER_EVENT_PERIOD_KEYS: ReadonlySet<string> = new Set(["nsf", "overdraft", "deposited_item_return"]);
const STATED_PERIODS: ReadonlySet<string> = new Set(["monthly", "annual", "quarterly"]);
/**
 * The stored periods the check acts on, by category. James approved monthly (#1026, Oct 13), and
 * annual and daily for NSF (#1301, Oct 14). v13 (#1339, Oct 15): James's rule that NSF, overdraft
 * and returned-item fees are charged per item, never by the month, year or day; a "max N per day"
 * is a daily cap and an "N waived per year" a waiver, neither the fee's frequency.
 */
export const CHECKED_PERIODS: Readonly<Record<string, ReadonlySet<string>>> = {
  nsf: new Set(["monthly", "annual", "daily"]),
  overdraft: new Set(["monthly", "annual", "quarterly", "daily"]),
  deposited_item_return: new Set(["monthly", "annual", "quarterly", "daily"]),
};
/** v12: a daily count or dollar cap on a per-item fee ("Max 4 per day", "max $180.00 daily", "not to exceed 5 fees charged per day"). */
// v13: a bare count per day is a cap too ("6 per day: $23.00"); a price per day ("$16 per day") is not.
const DAILY_CAP = /\b(?:max(?:imum)?(?![a-z])|limit\b|up to\b|not to exceed\b)|(?<![$\d.,]\s?)\b\d{1,2}\s+(?:(?:fees?|items?|charges?)\s+)?per\s+(?:business\s+)?day\b/i;
/** An overdraft program sold by the month ("Enhanced Overdraft Privilege Fee (per month)", "Bounce Protection / $9 Monthly Fee"). */
const OVERDRAFT_PROGRAM = /\b(relief|privilege|protection|courtesy pay|coverage|boost|advanced overdraft)\b/i;
/** An account's own charge after the price ("/ $25 Monthly Maintenance Fee"), not an overdraft or NSF fee. */
const ACCOUNT_CHARGE = /\b(maintenance|service (fee|charge))\b/i;
/** A cell after the price that is only a period ("| $30.00 | Per Month"). */
const PERIOD_CELL = /^\s*\(?\s*(per (month|year|quarter)|monthly|annual(ly)?|quarterly|yearly)\s*\)?\.?\s*$/i;
/** A waiver is not the fee's period: "$25.00 (1 waived per year.)", "$25 will be waived per statement cycle". */
// v13: "First 3 Wavied Annually" (the bank's misspelling, 140928).
const WAIVER = /\(\s*\d*\s*(?:is |are )?(?:waived?|wavied)\b[^)]*\)?|\b(?:will be |is |are )?(?:waived?|wavied)\b[^|$]*/gi;

/**
 * The period the words right after the fee's own price state ("NSF | $23.00/Month", "$30.00 |
 * Per Month"), with allowances and waivers taken off. A period only in the fee's name or another
 * cell ("Overdraft Fee 1 | $27.00 | 10x15 (per year)") is not read here.
 */
function periodAfterPrice(sourceLine: string, amount: number): { period: FilledFrequency | null; words: string } {
  const line = sourceLine.replace(WAIVER, " ");
  const readings = new Set<FilledFrequency | "none" | null>();
  let words = "";
  for (const match of line.matchAll(PRICE)) {
    if (Math.abs(Number(match[1].replace(/,/g, "")) - amount) >= 0.005) continue;
    const start = (match.index ?? 0) + match[0].length;
    const cells = line.slice(start, start + 60).split(/[|;]/);
    let own = cells[0].split(/\$\s?\.?\d/)[0];
    if (own.trim() === "" && cells.length > 1 && PERIOD_CELL.test(cells[1])) own = cells[1];
    words = `${words} ${own}`;
    // v13 (#1339): only the first three words after the price state its period ("$23.00/Month",
    // "$10 monthly fee", "| Per Month"). On a run-together line the words up to the next price
    // include the next fee's name: "Deposited Item Returned (per item) $10.00 Dormant Account Fee
    // (per month) $5.00" does not price the $10 fee monthly.
    const lead = (periodWords(withoutAllowance(own)) ?? "").trim().split(/\s+/).slice(0, 3).join(" ");
    readings.add(statedFrequency(lead));
  }
  const read = readings.size === 1 ? [...readings][0] : null;
  return { period: read != null && read !== "none" && STATED_PERIODS.has(read) ? read : null, words };
}

/**
 * The per-item frequency a corrected per-event fee takes: its own row's per-item reading, else
 * "per_item" when its own name says so (v13: "Overdraft Item/s Fee Per Item | $30.00 | Annual Rent
 * – 4 x 10 | $85.00" read the next cell's "Annual"), else none.
 */
function perItemReading(own: FilledFrequency | null, feeName: string | null | undefined): string | null {
  if (own && frequencyFamily(own) === "per_item") return own;
  const name = feeName ? withoutAllowance(feeName) : "";
  return PER_ITEM_WORDING.test(name) || MORE_PER_ITEM.test(name) ? "per_item" : null;
}

export type PerEventPeriodCheck =
  | { action: "keep"; frequency: string }
  | { action: "correct"; frequency: string | null }
  | { action: "hold"; reason: string };

/**
 * v11 (#1196): an NSF or overdraft fee stored as monthly, checked against its own schedule line.
 * v12 (#1301): an NSF fee stored as annual is checked the same way, and one stored as daily keeps
 * no period when its line states a daily cap, else is held.
 * - An overdraft program the bank prices by the period keeps it when its own row states that
 *   period and names the program ("Enhanced Overdraft Privilege Fee (per month) | $5.00").
 * - When the words right after its price state a period otherwise, the line cannot say what the fee
 *   is: an NSF fee is never charged by the month ("NSF | $23.00/Month", "$5.00/Month | Non-Sufficient
 *   Funds"), a "per item" fee is not monthly too ("OVERDRAFT PAID, PER ITEM* $30.00 MONTHLY"), and an
 *   account's maintenance fee is not an overdraft fee ("TD Overdraft Relief / $15 Monthly Maintenance
 *   Fee"). Hold it.
 * - Otherwise the period was a neighbour's wording ("Undeliverable Mail | $5.00 per month | Returned
 *   ACH | $5.00 each") or an allowance ("$25.00 (1 waived per year.)"): the fee takes its own row's
 *   per-item reading, else none.
 * Null for other categories and stored frequencies. Pure.
 */
export function perEventPeriodCheck(
  canonicalKey: string | null | undefined,
  frequency: string | null | undefined,
  sourceLine: string | null | undefined,
  amount: number | null,
  feeName: string | null | undefined,
): PerEventPeriodCheck | null {
  if (canonicalKey == null || !PER_EVENT_PERIOD_KEYS.has(canonicalKey)) return null;
  if (frequency == null || !CHECKED_PERIODS[canonicalKey]?.has(frequency)) return null;
  if (!sourceLine || amount == null) return null;
  // v12 (#1301): an NSF fee stored as daily. A line that states a daily cap prices each item, so
  // the fee takes its own row's per-item reading, else none; one that names no cap ("NSF/UCF Fee
  // $30 Per Day", "Daily NSF Fee ... $5.00") may really be charged by the day, so a person looks.
  // v13 (#1339): an overdraft or returned-item fee stored as daily is read the same way. "Courtesy Pay
  // (Max. 4 per day) | $25" is a per-item fee with a daily cap; "ACH Overdraft Fee | $5 per day" may
  // be a continuous overdraft charge filed as overdraft, so a person looks.
  const what = canonicalKey === "nsf" ? "an NSF fee" : canonicalKey === "overdraft" ? "an overdraft fee" : "a returned-item fee";
  if (frequency === "daily") {
    if (!DAILY_CAP.test(sourceLine)) return { action: "hold", reason: `${what} whose own line prices it daily with no daily cap` };
    const own = frequencyFromLine(sourceLine, amount);
    return { action: "correct", frequency: perItemReading(own, feeName) };
  }
  const after = periodAfterPrice(sourceLine, amount);
  const accountCharge = ACCOUNT_CHARGE.test(after.words);
  const name = feeName ?? "";
  if (canonicalKey === "overdraft" && !accountCharge && OVERDRAFT_PROGRAM.test(`${name} ${sourceLine}`) && !PER_ITEM_WORDING.test(name)) {
    const own = frequencyFromLine(sourceLine.replace(WAIVER, " "), amount);
    if (own != null && STATED_PERIODS.has(own)) return own === frequency ? { action: "keep", frequency } : { action: "correct", frequency: own };
  }
  if (after.period != null) {
    return { action: "hold", reason: `${what} whose own line prices it ${after.period}${accountCharge ? " as an account charge" : ""}` };
  }
  const own = frequencyFromLine(sourceLine, amount);
  // v13: a returned-item fee whose own name states a period ("Return Deposit Item-Special Handling
  // (per month) | $10.00") is another service filed as returned item; a person re-files it.
  const named = feeName ? statedFrequency(periodWords(withoutAllowance(feeName)) ?? "") : "none";
  if (canonicalKey === "deposited_item_return" && named != null && STATED_PERIODS.has(named)) {
    return { action: "hold", reason: `${what} whose own name prices it ${named}` };
  }
  return { action: "correct", frequency: perItemReading(own, feeName) };
}

/** v13: a charge per day in the fee's own words ("Daily Overdraft Fee", "$1.00/day", "each business day"). */
const OWN_DAILY = /\b(daily|per (business |calendar )?day|(each|every) (business |calendar )?day)\b|\/\s?day\b/i;
const CONTINUOUS_PERIODS: ReadonlySet<string> = new Set(["monthly", "annual", "quarterly"]);

/**
 * v13 (#1339): a continuous overdraft fee stored as monthly, annual or quarterly. One stored as
 * daily is right (charged per day the account stays overdrawn) and is never read here.
 * - The fee's own name or the words right after its price say it is charged daily ("Daily overdraft
 *   fee ... $3.00 | Online Bill Pay ... $19.95/month", "DAILY NEGATIVE BALANCE FEE | $1.00/day or Cap
 *   Monthly"): it takes daily, and the period was a neighbour's or a cap's.
 * - The words right after its price state the stored period ("A service fee of $25.00 monthly will be
 *   charged to any account overdrawn more than 30 days"): the bank charges it by that period; kept.
 * - Otherwise the period was another fee's ("Continuous Overdraft Fee 2 | $15.00 | Vault (per year)"):
 *   it is cleared.
 * Null for other categories and stored frequencies. Pure.
 */
export function continuousOverdraftPeriodCheck(
  canonicalKey: string | null | undefined,
  frequency: string | null | undefined,
  sourceLine: string | null | undefined,
  amount: number | null,
  feeName: string | null | undefined,
): PerEventPeriodCheck | null {
  if (canonicalKey !== "continuous_od" || frequency == null || !CONTINUOUS_PERIODS.has(frequency)) return null;
  if (!sourceLine || amount == null) return null;
  const after = periodAfterPrice(sourceLine, amount);
  if (OWN_DAILY.test(`${feeName ?? ""} ${after.words}`)) return { action: "correct", frequency: "daily" };
  if (after.period === frequency) return { action: "keep", frequency };
  return { action: "correct", frequency: null };
}

/** Wording that makes a blank monthly-maintenance row something other than the account's monthly fee. */
const NOT_MONTHLY_MAINTENANCE = /\bno (monthly )?(maintenance|service) (fees?|charges?)\b|quarter|annual|yearly|per year|per hour|hourly|week|\b\d+\s*months\b|opening|clos(ed|ing)|paper|check images?|\b(debits?|checks?|withdrawals?|transfers?|items?|transactions?)\b/i;
/** Month wording in the fee's own name or line ("Monthly1 account service charge", "$10.00month", "each calendar month", "for that month"). */
const OWN_MONTH = /(?<![a-z])month(ly)?(?![a-z])|\b(per|each|every) statement cycle\b|\bstatement cycle \(month\)/i;

/**
 * v13 (#1339): a live monthly-maintenance fee with no frequency takes "monthly" only when its own
 * name or line says so: a month word ("Monthly1 account service charge is $10", "a service charge of
 * $3.00 will be charged each calendar month") or a charge per statement cycle ("Service Charge per
 * statement cycle ... $10.00"). The line must print the fee's price. It stays blank when the line
 * names another basis or service (quarterly, per hour, "every four-week statement cycle", "No monthly
 * maintenance fees: Only $25", an opening or closing charge, paper statements, check images, or a
 * per-check or per-transfer charge), and when it says only "during the statement cycle", which is the
 * window a balance is measured over, not how often the fee is charged. Pure.
 */
export function maintenanceMonthlyFill(
  canonicalKey: string | null | undefined,
  frequency: string | null | undefined,
  sourceLine: string | null | undefined,
  amount: number | null,
  feeName: string | null | undefined,
): "monthly" | null {
  if (canonicalKey !== "monthly_maintenance" || frequency != null || !sourceLine || amount == null) return null;
  if (!feePrices(sourceLine).some((price) => Math.abs(price - amount) < 0.005)) return null;
  const text = `${feeName ?? ""} | ${sourceLine}`;
  if (NOT_MONTHLY_MAINTENANCE.test(text) || namedBasis(sourceLine, amount)) return null;
  return OWN_MONTH.test(text) ? "monthly" : null;
}
