import type { PriceWindow } from "@/lib/agents/knox/families";

/**
 * v136 (#2064): a dollar cap on a day's overdraft or NSF fees, in the ways schedules print it
 * beyond "Maximum of $120.00 per day" right after the fee (the overdraft family's first cap rule):
 *  - named after its figure: "Paid Overdraft Charge: $30.00/item ($150.00 max daily)" (State key 10500);
 *  - its own line under the fee it caps: "Courtesy Pay | $30/item" over "4 item cap per day (max fee
 *    of $120/day)" (State key 8741), "Return Item Fee: $30" over "Limit of $120 per day" (Texas key
 *    2416), "Overdraft (OD) Fee $32.50" over "(Daily limit of $97.50 per" (Texas key 2425);
 *  - "Daily maximum" after the per-item price: "$32.00 per item/Daily maximum $96.00" (State key 2017);
 *  - a sentence that names the fees it caps: "Total overdraft charges/fees will not exceed $100.00
 *    per day" (live audit 2735), "There is a limit of $108 each day in total overdraft fees" (live 75).
 *
 * The words right before the figure, back to the clause's start, are only cap words, counts and fee
 * words ("4 item cap per day (max fee of", "Daily limit of", "Total overdraft charges/fees will not
 * exceed"): a limit on anything else ("Courtesy Pay limit of", "You may withdraw up to a maximum of",
 * "Maximum daily deposits limit is") is never a fee cap, and neither is one whose clause names an ATM,
 * card, deposit, transfer or loan. The cap belongs to the overdraft or NSF fee read on its line or the
 * line above, with no other fee's price between them, and is larger than that one fee (a "$32.50 daily
 * limit" beside a $32.50 NSF fee is one fee a day, a count); or to the overdraft or NSF fees its own
 * clause names. Admit-only: it reads figures no rule filed as a fee. Pure.
 */

export interface CapOwner {
  hint: string;
  feeName: string;
  lineIndex: number;
  windowIndex: number;
  amount: number;
}

export interface DailyCapRead {
  hint: "od_daily_cap" | "nsf_daily_cap";
  feeName: string;
}

const DAY_AFTER = /^\s*\)?\s*(?:\([^()$]{0,40}\)\s*)?(?:(?:per|a|each)\s+(?:business\s+|calendar\s+)?day\b|\/\s*day\b|daily\b)/i;
const NAMED_AFTER = /^\s*(?:max(?:imum)?|cap)\s+(?:(?:per|a|each)\s+(?:business\s+)?day\b|daily\b)/i;
const CAP_WORD = /\b(?:max(?:imum)?|cap(?:ped)?|limit(?:ed)?|exceed)\b/i;
const DAY_WORD = /\b(?:daily|per day|a day|each day)\b/i;
/** The only words a cap's clause may hold before its figure. */
const CLAUSE_WORDS = new Set(
  ("total item items cap capped per day daily business max maximum limit limited of fee fees charge charges the a an is " +
    "are there will not exceed to up note overdraft overdrafts od nsf returned return paid insufficient non sufficient " +
    "nonsufficient funds account each in")
    .split(" "),
);
const CLAUSE_START = /[.;|(!?](?=[^.;|(!?]*$)/;
const OTHER_SERVICE = /\b(atms?|pos|purchases?|withdraw(?:al)?s?|deposits?|transfers?|wires?|cards?|cash|zelle|teller|advances?|loans?)\b/i;
const OVERDRAFT_FEES = /\b(?:overdrafts?|overdraw(?:ing|n)|od|paid items?)\b/i;
const NSF_FEES = /\b(?:nsf|non-?sufficient|insufficient funds|returned items?)\b/i;
const FEE_WORD = /\b(fees?|charges?)\b/i;
/** How many lines above its cap the capped fee may be read. */
const OWNER_REACH = 1;

function clauseBefore(before: string): string {
  const start = before.search(CLAUSE_START);
  return start >= 0 ? before.slice(start + 1) : before;
}

/** True when the words before the figure are only cap, count and fee words, with a cap and a day said around it. */
function capWording(clause: string, after: string): boolean {
  const words = clause.toLowerCase().match(/[a-z]+/g) ?? [];
  if (!words.every((word) => CLAUSE_WORDS.has(word))) return false;
  if (NAMED_AFTER.test(after)) return true;
  return CAP_WORD.test(clause) && (DAY_WORD.test(clause) || DAY_AFTER.test(after));
}

/** The fees the clause itself names as capped ("total overdraft fees"), or null. */
function namedCappedFees(clause: string, afterClause: string): DailyCapRead | null {
  const words = `${clause} ${afterClause}`;
  const feeWord = words.match(FEE_WORD)?.[1];
  if (!feeWord) return null;
  if (OVERDRAFT_FEES.test(words)) return { hint: "od_daily_cap", feeName: `Overdraft ${feeWord.toLowerCase()} daily maximum` };
  if (NSF_FEES.test(words)) return { hint: "nsf_daily_cap", feeName: `NSF ${feeWord.toLowerCase()} daily maximum` };
  return null;
}

/**
 * The daily cap a price window states, or null. `owner` is the overdraft family's last overdraft or
 * NSF read; `windows` and `index` place the window among the document's other prices.
 */
export function dailyFeeCap(windows: readonly PriceWindow[], index: number, owner: CapOwner | null): DailyCapRead | null {
  const window = windows[index];
  if (window.zero || !(window.amount > 0)) return null;
  // The window keeps only 40 characters before its figure; its name holds the clause's whole start.
  const clause = clauseBefore(window.rawName.length > window.before.length ? window.rawName : window.before);
  if (!capWording(clause, window.after)) return null;
  const afterClause = window.after.split(/[.;|]/)[0];
  if (OTHER_SERVICE.test(clause) || OTHER_SERVICE.test(afterClause)) return null;

  if (owner && (owner.hint === "overdraft" || owner.hint === "nsf") && window.lineIndex - owner.lineIndex <= OWNER_REACH &&
      window.amount > owner.amount &&
      windows.slice(owner.windowIndex + 1, index).every((between) => between.lineIndex === owner.lineIndex)) {
    return { hint: owner.hint === "overdraft" ? "od_daily_cap" : "nsf_daily_cap", feeName: `${owner.feeName} daily maximum` };
  }
  return namedCappedFees(clause, afterClause);
}
