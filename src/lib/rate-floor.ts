/**
 * #1615: the floor of a percentage charge, not a flat price. Shared by Knox (it reads such a price
 * as the rate fee's `rate_min_amount`, never as a flat fee) and Darwin's live re-check
 * (`darwin/rate-floor-check.ts`). Pure: no database and no agent imports.
 *
 * A charge printed as "$5.00 or 3% of the amount of each cash advance, whichever is greater",
 * "Greater of $10 or 5% of Scheduled Pmt", "Merchant Check Cashing (Greater of 10% of Item or $10)" or
 * "Coin Sorting (or 10% Handling Fee, Whichever is Higher) | $6.50" costs the percentage; the dollar
 * figure is the least it can be. Read as a flat fee it sat in the benchmarks at the floor (Patriot FCU's
 * "5% of the monthly payment or $35.00, whichever is greater" went live as a flat $35 twice).
 *
 * Only the fee's own figure counts: the first figure at the fee's amount after the fee's name on the
 * line (or the line's first at that amount when the name is not on it). "Cash advance $10 or 3%,
 * whichever is greater | Overdraft $10" prices the overdraft at $10 on its own. The figure must be
 * joined to the percentage by "or", and the clause between them and the greater-of words must hold no
 * lesser-of words and no sentence end: "Late fee $15 or 5% whichever is less. Cash advance greater of
 * $15 or 2%" is a lesser-of cap for the late fee. "Account Closed ... $20.00 | Non-Member ... Greater of
 * 1% of Check or $10.00" keeps its $20; "ATM NSF Fee + | $29.50 | - 2% of each transfer or $20.00
 * whichever is greater" keeps its $29.50.
 */

const MONEY = /\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?|\.\d{1,2})(?![\d.,]\d)/g;
const PCT = String.raw`(\d{1,3}(?:\.\d{1,4})?)\s*(?:%|percent\b)`;
const GREATER_WORDS = /\bwhichever\s+is\s+(?:greater|higher|more)\b|\bgreater\s+of\b/i;
const LESSER_WORDS = /\bwhichever\s+is\s+(?:less|lesser|lower|smaller)\b|\blesser\s+of\b/i;
/** Dollar first: "$5 or 3% ...". */
const OR_RATE_AFTER = new RegExp(String.raw`^\s*,?\s*or\s+(?:the\s+)?${PCT}`, "i");
/** "greater of" right before the dollar figure: "Greater of / $25.00 or 1%", "the greater of either $5". */
const GREATER_OF_BEFORE = /\bgreater\s+of\s*[/:]?\s*(?:either\s+)?$/i;
/**
 * Percentage first: "Greater of 10% of Item or $10", "5% of payment or $30, whichever is greater". The
 * rate is the last one before the "or", never an earlier clause's.
 */
const RATE_OR_BEFORE = new RegExp(String.raw`${PCT}((?:(?!\d\s*(?:%|percent\b))[^|$]){0,60}?)\bor\s*$`, "i");
/** The clause states the rate and its floor before the price: "(or 10% Handling Fee, Whichever is Higher) | $6.50". */
const CLAUSE_BEFORE = new RegExp(String.raw`\bor\s+${PCT}([^|$]{0,60}?)\bwhichever\s+is\s+(?:greater|higher|more)\b[\s).,;:|…]*$`, "i");
const WHICHEVER_AFTER = /^([^|$]{0,60}?)\bwhichever\s+is\s+(?:greater|higher|more)\b/i;

export interface RateFloor {
  /** The percentage the floor bounds. */
  ratePercent: number;
  /** The fee's own dollar figure, the least the charge can be. */
  floor: number;
  /** The words that state it. */
  clause: string;
}

function moneyValue(token: string): number {
  return Number(token.replace(/,/g, ""));
}

function rate(value: string | undefined): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 100 ? parsed : null;
}

/**
 * True when the words between the rate clause and the greater-of words keep them one clause: no
 * lesser-of words and no sentence end with words after it ("... of payment. Whichever is greater"
 * stays one clause; "... whichever is less. Cash advance greater of" does not).
 */
function oneClause(between: string): boolean {
  if (LESSER_WORDS.test(between)) return false;
  return !/[.;!?]\)?\s+\S/.test(between.replace(/[\s.;!?)]+$/, ""));
}

/** Where the fee's own words end on the line: after its name when the name is on it, else the start. */
function ownStart(line: string, feeName: string | null | undefined): number {
  const name = (feeName ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!name) return 0;
  const at = line.toLowerCase().indexOf(name);
  return at < 0 ? 0 : at + name.length;
}

/** The floor the clause around this figure states, else null. */
function floorAt(line: string, money: RegExpExecArray | RegExpMatchArray, value: number): RateFloor | null {
  const start = money.index ?? 0;
  const end = start + money[0].length;
  const before = line.slice(Math.max(0, start - 120), start);
  const after = line.slice(end, end + 200);

  const rateAfter = OR_RATE_AFTER.exec(after);
  if (rateAfter) {
    const percent = rate(rateAfter[1]);
    const rest = after.slice(rateAfter[0].length);
    const tail = /^[^|$]{0,140}/.exec(rest)?.[0] ?? "";
    const greater = GREATER_WORDS.exec(tail);
    const stated = GREATER_OF_BEFORE.test(before) || (greater != null && oneClause(tail.slice(0, greater.index)));
    if (percent == null || !stated) return null;
    return { ratePercent: percent, floor: value, clause: line.slice(Math.max(0, start - 20), end + rateAfter[0].length + tail.length).trim() };
  }

  const rateBefore = RATE_OR_BEFORE.exec(before);
  if (rateBefore) {
    const percent = rate(rateBefore[1]);
    const lead = before.slice(0, rateBefore.index);
    const whichever = WHICHEVER_AFTER.exec(after);
    const stated = oneClause(rateBefore[2]) && (GREATER_OF_BEFORE.test(lead) || (whichever != null && oneClause(whichever[1])));
    if (percent == null || !stated) return null;
    const clauseStart = Math.max(0, start - (before.length - rateBefore.index) - 20);
    return { ratePercent: percent, floor: value, clause: line.slice(clauseStart, end + 40).trim() };
  }

  const clause = CLAUSE_BEFORE.exec(before);
  const percent = clause && oneClause(clause[2]) ? rate(clause[1]) : null;
  return percent == null ? null : { ratePercent: percent, floor: value, clause: `${clause![0]}${money[0]}`.trim() };
}

/**
 * The rate and floor when `text` prices `amount` as the floor of a percentage charge ("$5 or 3%,
 * whichever is greater"), else null. `text` is the fee's own line; `feeName`, when given, places the
 * fee's own figure on it (see the module note). The fee's own figure is the first at its amount after
 * its name; a repeat of that figure in the same cell, with no other price between, may state the clause
 * ("$5 or 2% (fee is $5 or 2% of face value, whichever is greater)").
 */
export function rateFloorOf(
  text: string | null | undefined,
  amount: number | string | null | undefined,
  feeName?: string | null,
): RateFloor | null {
  const value = Number(amount);
  if (!(value > 0) || !Number.isFinite(value)) return null;
  const line = (text ?? "").replace(/\s+/g, " ");
  if (!GREATER_WORDS.test(line)) return null;
  const from = ownStart(line, feeName);
  let own: number | null = null;
  for (const money of line.matchAll(MONEY)) {
    const at = money.index ?? 0;
    if (at < from) continue;
    const same = Math.abs(moneyValue(money[1]) - value) <= 0.001;
    if (own === null) {
      if (!same) continue;
      own = at;
    } else if (!same || line.slice(own, at).includes("|") || !oneClause(line.slice(own, at))) {
      return null;
    }
    const floor = floorAt(line, money, value);
    if (floor) return floor;
  }
  return null;
}

/** True when the figure is a percentage charge's floor on its own line (see `rateFloorOf`). */
export function pricesRateFloor(
  text: string | null | undefined,
  amount: number | string | null | undefined,
  feeName?: string | null,
): boolean {
  return rateFloorOf(text, amount, feeName) !== null;
}

/** The SQL prefilter (`~*`) for lines that could state such a floor; `rateFloorOf` decides. */
export const RATE_FLOOR_GREATER_SQL = String.raw`(whichever\s+is\s+(greater|higher|more)|greater\s+of)`;
export const RATE_FLOOR_PERCENT_SQL = String.raw`[0-9]\s*(%|percent)`;
