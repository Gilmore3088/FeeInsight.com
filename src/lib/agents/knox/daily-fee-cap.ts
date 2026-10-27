import type { PriceWindow } from "@/lib/agents/knox/families";
import { capFitsFee, countMatchesCap, refusesDailyCap, sentenceAfter } from "@/lib/daily-cap-wording";

/**
 * v136 (#2064): a dollar cap on a day's overdraft or NSF fees, in the ways schedules print it
 * beyond "Maximum of $120.00 per day" right after the fee (the overdraft family's first cap rule):
 *  - named after its figure: "Paid Overdraft Charge: $30.00/item ($150.00 max daily)" (State key 10500);
 *  - its own line under the fee it caps: "Courtesy Pay | $30/item" over "4 item cap per day (max fee
 *    of $120/day)" (State key 8741);
 *  - "Daily maximum" after the per-item price: "$32.00 per item/Daily maximum $96.00" (State key 2017);
 *  - a sentence that names the fees it caps: "Total overdraft charges/fees will not exceed $100.00
 *    per day" (live audit 2735), "There is a limit of $108 each day in total fees ... for overdrawing"
 *    (live audit 75).
 *
 * The words right before the figure, on its own line and back to the clause's start, are only cap
 * words, counts and fee words ("4 item cap per day (max fee of", "Total overdraft charges/fees will
 * not exceed"), and `refusesDailyCap` (shared with the source check) refuses another service's limit
 * (ATM, card, deposit or deposited item ...), a sustained or "after N days" charge, a per-item price,
 * and a limit no fee or charge word governs ("Overdraft Limit $500 per day", "Courtesy Pay limit of
 * $500"). The cap is sized for the fee it caps (`capFitsFee`: two to twelve of them), and belongs to:
 *  - the overdraft or NSF fee read on its line or the line right above, with no other price between
 *    them, the owner's own line included ("Overdraft Fee $35 Stop Payment Fee $30" / "Limit of $120"
 *    is not the overdraft's), unless the cap prints a count that times the fee's price is the cap
 *    ("4 item cap" at $30 is $120);
 *  - or the overdraft or NSF fees its own clause names, when such a fee is priced on its line or the
 *    three lines above (a cap with no fee above it is no cap), and it is larger than every one.
 * Admit-only: it reads figures no rule filed as a fee. Pure.
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
const OVERDRAFT_FEES = /\b(?:overdrafts?|overdraw(?:ing|n)|od|paid items?)\b/i;
const NSF_FEES = /\b(?:nsf|non-?sufficient|insufficient funds|returned items?)\b/i;
const FEE_WORD = /\b(fees?|charges?)\b/i;
/** A price window named as an overdraft or NSF fee, before its price or right after it ("$36 overdraft fee"). */
const OD_NSF_NAME = /\b(?:overdrafts?|od|nsf|non-?sufficient funds|insufficient funds|returned (?:check|item)s?|return item|courtesy pay|bounce|paid items?)\b/i;
/** An overdraft charge that is not the per-item fee a daily cap limits. */
const NOT_A_CAPPED_FEE = /\b(?:sustained|extended|continu\w*|consecutive|protection|transfers?|line of credit|daily|per day|negative balance)\b/i;
const OD_NSF_AFTER = /^\s*(?:overdraft|od|nsf|non-?sufficient funds|returned (?:check|item)|return item)\b[^.$|]{0,20}\b(?:fees?|charges?)\b/i;
/** How many lines above its cap the capped fee may be read. */
const OWNER_REACH = 1;
const CLAUSE_OWNER_REACH = 3;
/** The window keeps 40 characters before its figure; shorter, and they reach the line's start. */
const BEFORE_WINDOW = 40;
const NAME_TAIL = 40;

/** The words before the figure on its own line, back to the clause's start. */
function clauseOf(window: PriceWindow): string {
  const own = window.before.length < BEFORE_WINDOW ? window.before : window.rawName;
  const start = own.search(CLAUSE_START);
  return start >= 0 ? own.slice(start + 1) : own;
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

function namesOverdraftOrNsfFee(window: PriceWindow): boolean {
  if (window.condition || window.zero) return false;
  const name = window.rawName.slice(-NAME_TAIL);
  const after = sentenceAfter(window.after);
  if (NOT_A_CAPPED_FEE.test(name) || NOT_A_CAPPED_FEE.test(after)) return false;
  return OD_NSF_NAME.test(name) || OD_NSF_AFTER.test(after);
}

/** The cap line's text, for a printed count ("4 item cap per day (max fee of"). */
function capLineText(window: PriceWindow): string {
  return `${window.before} ${window.after}`;
}

function ownerRead(windows: readonly PriceWindow[], index: number, owner: CapOwner | null): DailyCapRead | null {
  const window = windows[index];
  if (!owner || !(owner.hint === "overdraft" || owner.hint === "nsf")) return null;
  if (window.lineIndex - owner.lineIndex > OWNER_REACH || !capFitsFee(window.amount, owner.amount)) return null;
  if (NOT_A_CAPPED_FEE.test(owner.feeName)) return null;
  const between = windows.slice(owner.windowIndex + 1, index).filter((other) => !other.zero);
  if (between.length > 0 && !countMatchesCap(capLineText(window), owner.amount, window.amount)) return null;
  return { hint: owner.hint === "overdraft" ? "od_daily_cap" : "nsf_daily_cap", feeName: `${owner.feeName} daily maximum` };
}

function clauseRead(windows: readonly PriceWindow[], index: number, clause: string, afterClause: string): DailyCapRead | null {
  const window = windows[index];
  const named = namedCappedFees(clause, afterClause);
  if (!named) return null;
  const capped = windows
    .slice(0, index)
    .filter((other) => window.lineIndex - other.lineIndex <= CLAUSE_OWNER_REACH && namesOverdraftOrNsfFee(other));
  if (capped.length === 0 || !capped.every((fee) => capFitsFee(window.amount, fee.amount))) return null;
  return named;
}

/**
 * The daily cap a price window states, or null. `owner` is the overdraft family's last overdraft or
 * NSF read; `windows` and `index` place the window among the document's other prices.
 */
export function dailyFeeCap(windows: readonly PriceWindow[], index: number, owner: CapOwner | null): DailyCapRead | null {
  const window = windows[index];
  if (window.zero || !(window.amount > 0)) return null;
  const clause = clauseOf(window);
  if (!capWording(clause, window.after)) return null;
  const afterClause = sentenceAfter(window.after);
  if (refusesDailyCap(clause, afterClause)) return null;
  return ownerRead(windows, index, owner) ?? clauseRead(windows, index, clause, afterClause);
}
