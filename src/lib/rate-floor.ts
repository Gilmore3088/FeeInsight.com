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
 * Only the fee's own figure counts, and only when "or" joins it to the percentage and the clause says
 * the greater one applies: "Account Closed ... $20.00 | Non-Member ... Greater of 1% of Check or $10.00"
 * prices the closure at $20 on its own, so the $20 stays; "ATM NSF Fee + | $29.50 | - 2% of each
 * transfer or $20.00 whichever is greater" keeps its $29.50; a lesser-of cap ("$30 or 5%, whichever is
 * less") is a different charge and is left alone.
 */

const MONEY = /\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?|\.\d{1,2})(?![\d.,]\d)/g;
const PCT = String.raw`(\d{1,3}(?:\.\d{1,4})?)\s*(?:%|percent\b)`;
const GREATER_WORDS = /\bwhichever\s+is\s+(?:greater|higher|more)\b|\bgreater\s+of\b/i;
/** Dollar first: "$5 or 3% ...". */
const OR_RATE_AFTER = new RegExp(String.raw`^\s*,?\s*or\s+(?:the\s+)?${PCT}`, "i");
/** "greater of" right before the dollar figure: "Greater of / $25.00 or 1%", "the greater of either $5". */
const GREATER_OF_BEFORE = /\bgreater\s+of\s*[/:]?\s*(?:either\s+)?$/i;
/** Percentage first: "Greater of 10% of Item or $10", "5% of payment or $30, whichever is greater". */
const RATE_OR_BEFORE = new RegExp(String.raw`${PCT}[^|$]{0,60}?\bor\s*$`, "i");
/** The clause states the rate and its floor before the price: "(or 10% Handling Fee, Whichever is Higher) | $6.50". */
const CLAUSE_BEFORE = new RegExp(String.raw`\bor\s+${PCT}[^|$]{0,60}?\bwhichever\s+is\s+(?:greater|higher|more)\b[\s).,;:|…]*$`, "i");
const WHICHEVER_AFTER = /^[^|$]{0,60}?\bwhichever\s+is\s+(?:greater|higher|more)\b/i;

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
 * The rate and floor when `text` prices `amount` as the floor of a percentage charge ("$5 or 3%,
 * whichever is greater"), else null. `text` is the fee's own line, or its name and line together.
 */
export function rateFloorOf(text: string | null | undefined, amount: number | string | null | undefined): RateFloor | null {
  const value = Number(amount);
  if (!(value > 0) || !Number.isFinite(value)) return null;
  const line = (text ?? "").replace(/\s+/g, " ");
  if (!GREATER_WORDS.test(line)) return null;
  for (const money of line.matchAll(MONEY)) {
    if (Math.abs(moneyValue(money[1]) - value) > 0.001) continue;
    const start = money.index ?? 0;
    const end = start + money[0].length;
    const before = line.slice(Math.max(0, start - 120), start);
    const after = line.slice(end, end + 200);

    const rateAfter = OR_RATE_AFTER.exec(after);
    if (rateAfter) {
      const percent = rate(rateAfter[1]);
      const rest = after.slice(rateAfter[0].length);
      const tail = /^[^|$]{0,140}/.exec(rest)?.[0] ?? "";
      if (percent != null && (GREATER_OF_BEFORE.test(before) || GREATER_WORDS.test(tail))) {
        return { ratePercent: percent, floor: value, clause: line.slice(Math.max(0, start - 20), end + rateAfter[0].length + tail.length).trim() };
      }
    }

    const rateBefore = RATE_OR_BEFORE.exec(before);
    if (rateBefore) {
      const percent = rate(rateBefore[1]);
      const lead = before.slice(0, rateBefore.index);
      if (percent != null && (GREATER_OF_BEFORE.test(lead) || WHICHEVER_AFTER.test(after))) {
        const from = Math.max(0, start - (before.length - rateBefore.index) - 20);
        return { ratePercent: percent, floor: value, clause: line.slice(from, end + 40).trim() };
      }
    }

    const clause = CLAUSE_BEFORE.exec(before);
    if (clause) {
      const percent = rate(clause[1]);
      if (percent != null) return { ratePercent: percent, floor: value, clause: `${clause[0]}${money[0]}`.trim() };
    }
  }
  return null;
}

/** True when the figure is a percentage charge's floor on its own line (see `rateFloorOf`). */
export function pricesRateFloor(text: string | null | undefined, amount: number | string | null | undefined): boolean {
  return rateFloorOf(text, amount) !== null;
}

/** The SQL prefilter (`~*`) for lines that could state such a floor; `rateFloorOf` decides. */
export const RATE_FLOOR_GREATER_SQL = String.raw`(whichever\s+is\s+(greater|higher|more)|greater\s+of)`;
export const RATE_FLOOR_PERCENT_SQL = String.raw`[0-9]\s*(%|percent)`;
