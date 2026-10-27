/**
 * v136 (#2064): the words that make a dollar figure a daily cap on overdraft or NSF fees, and the
 * words that make it something else. Shared by Knox's cap reader (`knox/daily-fee-cap.ts`) and the
 * shared source check's widened cap trace (`statesDailyCap`, `capLineUnder`), so both refuse the
 * same lines. Pure.
 *
 * A figure is refused as a cap when the words around it name:
 *  - another service's limit: an ATM, POS, card, cash, deposit or deposited item, transfer, wire,
 *    teller, advance or loan ("maximum $120 per day for returned deposited items");
 *  - a sustained or extended overdraft charge ("for sustained overdrafts", "after 5 days",
 *    "Continuous overdraft", "per day overdrawn");
 *  - a per-item price ("Daily maximum $35 per item");
 *  - a limit with no fee or charge word governing it ("Overdraft Limit $500 per day", "Total limit
 *    of $750", "Courtesy Pay limit of $500"): that is how far the bank covers an overdraft, not a cap
 *    on the fees. "max fee of $120/day" and "a limit of $108 each day in total fees" keep theirs.
 *
 * Off switch: `DAILY_CAP_LINES_LIVE` is false, so the shared check traces caps exactly as it did
 * before v136 on every path (Knox's self-check, Darwin's verify and live re-check, release-held,
 * lost-recheck restore, the rules re-check). Tests and the shadow lab's `daily-cap-lines`
 * experiment pass `dailyCapLines: true`. Before it is switched on, James runs the live dry run:
 * od_daily_cap and nsf_daily_cap rows whose check goes from not-ok to ok.
 */
export const DAILY_CAP_LINES_LIVE = false;

export const CAP_OTHER_SERVICE =
  /\b(atms?|pos|purchases?|withdraw(?:al)?s?|deposit(?:s|ed)?|transfers?|wires?|cards?|cash|zelle|teller|advances?|loans?)\b/i;
const SUSTAINED =
  /\b(?:sustained|extended|continu\w*|consecutive|overdrawn|negative balance)\b|\bafter\s+(?:the\s+)?(?:\d+\w*|day|one|two|three|four|five|six|seven|ten)\b/i;
const PER_ITEM_AFTER =
  /^\s*\)?\s*(?:(?:per|each|a|\/)\s*(?:item|check|presentment|occurrence|transaction|overdraft|nsf|returned item)s?\b|each\b(?!\s+(?:business\s+|calendar\s+)?day\b))/i;
const LIMIT_WORD = /\blimit(?:s|ed)?\b/i;
const FEE_WORD = /\b(?:fees?|charges?)\b/i;
/** "4 item cap per day ($120/day)": a printed count of the capped fee. */
const PRINTED_COUNT = /\b(\d{1,2})\s+(?:items?|overdrafts?|fees?|nsfs?|times?)\b/gi;

/**
 * True when the clause before a figure (back to its clause's start) or the rest of its sentence
 * after it says the figure is not a cap on the day's overdraft or NSF fees.
 */
export function refusesDailyCap(clauseBefore: string, afterSentence: string): boolean {
  if (CAP_OTHER_SERVICE.test(clauseBefore) || CAP_OTHER_SERVICE.test(afterSentence)) return true;
  if (SUSTAINED.test(clauseBefore) || SUSTAINED.test(afterSentence)) return true;
  if (PER_ITEM_AFTER.test(afterSentence)) return true;
  return LIMIT_WORD.test(clauseBefore) && !FEE_WORD.test(clauseBefore) && !FEE_WORD.test(afterSentence);
}

/** True when the line prints a count of fees that times the fee's price is the cap ("4 item cap" at $30 is $120). */
export function countMatchesCap(line: string, feePrice: number, cap: number): boolean {
  for (const match of line.matchAll(PRINTED_COUNT)) {
    if (Math.abs(Number(match[1]) * feePrice - cap) < 0.005) return true;
  }
  return false;
}

/** The figure's sentence after it: up to a full stop, semicolon or cell mark. */
export function sentenceAfter(after: string): string {
  return after.split(/[.;|](?:\s|$)|\|/)[0];
}

/** A daily cap lets at least two of the fee it caps through, and no more than this many. */
const MIN_FEES_UNDER_CAP = 2;
const MAX_FEES_UNDER_CAP = 12;

/**
 * True when a cap is sized for the fee it caps: at least two of them ("Max $35 each day" beside a
 * $30 NSF fee is one fee a day) and at most twelve ("Maximum of $1,000 per day" beside a $35 fee is
 * how far the bank covers an overdraft, not a cap on the fees).
 */
export function capFitsFee(cap: number, feePrice: number): boolean {
  return feePrice > 0 && cap >= MIN_FEES_UNDER_CAP * feePrice - 0.005 && cap <= MAX_FEES_UNDER_CAP * feePrice + 0.005;
}
