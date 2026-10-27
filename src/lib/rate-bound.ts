/**
 * #2067: the minimum or maximum of a percentage charge, not a flat price. Shared by Knox (it holds
 * such a read as the percentage, so the rate pass files the bound as the rate fee's
 * `rate_min_amount` / `rate_max_amount`, never a flat fee) and the shared source check
 * (`checkFeeAgainstSource`, reason `rate_bound`). Pure: no database and no agent imports.
 *
 * A charge printed as "7% Research Fee (Minimum charge $5.00", "Cash advance transaction fee 4% of
 * advance (min. of $5", "1% of check amount ($2.00 minimum / $15.00 maximum)", "Non-Member ($10 Max) |
 * 5% of Total" or "2% of amount - minimum fee $10.00" costs the percentage; the dollar figure is the
 * least or most it can be. Read as a flat fee it sat in the dollar benchmarks at the bound. Greater-of
 * floors ("$5 or 3%, whichever is greater") are `rate-floor.ts`'s (#1615).
 *
 * Only the fee's own figure counts: the first figure at the fee's amount after the fee's name on the
 * line (or the line's first at that amount when the name is not on it), as in `rateFloorOf`. The figure
 * must carry min/max wording right before it ("minimum charge of $15", "with max of $25", "(Minimum of
 * $3.00)", "(or minimum of) | $3.00") or right after it ("$5 min", "($50 maximum)"), never a balance or
 * payment ("$1,500 minimum balance", "Minimum payment: 3.00% or $20.00"), and a percentage must sit in
 * the same clause: within 120 characters, across at most one cell break, with no other price between
 * them unless that price is the other bound ("Minimum charge of $50.00, maximum charge of $100.00)
 * 10.000%"). An interest rate (APR, APY, dividend, LTV) is no charge's percentage. "Wire | $20.00 |
 * Visa Cash Advance | 2%, min $3" keeps the wire's $20; "... (minimum $5.00, maximum $50.00) and $5.00
 * checking account overdraft fee" keeps the overdraft's $5, which follows its own name.
 */

const MONEY = /\$\s?(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?|\.\d{1,2})(?![\d.,]\d)/g;
const PERCENT = /(?<!\d|\d\.)(\d{1,3}(?:\.\d{1,4})?)\s*(?:%|percent\b)/gi;
const BOUND_WORDS = /\b(?:min|minimum|max|maximum)\b/i;
/** Min/max wording right before the figure: "minimum charge of ", "with max of ", "(or minimum of) | ". */
const BOUND_BEFORE = /\b(min(?:imum)?|max(?:imum)?)\.?(?:\s+(?:charge|fee|amount))?(?:\s+of)?[\s:)(|–-]*$/i;
/** Min/max wording right after the figure: "$5 min", "($50 maximum)", "$2.00 min" — never a balance or payment. */
const BOUND_AFTER =
  /^\s*\.?\s*(min(?:imum)?|max(?:imum)?)\b\.?(?!\s*(?:daily|average|monthly|opening|collected|ledger)?\s*(?:balance|deposit|payment|term|credit|to open|required|apr|ltv|loan|amount financed|purchase))/i;
/** A figure before the bound word that it states something else about: "minimum balance", "minimum payment". */
const NOT_A_CHARGE_BOUND = /\b(?:min(?:imum)?|max(?:imum)?)\.?\s+(?:daily\s+|average\s+|monthly\s+|opening\s+)?(?:balance|deposit|payment|term|credit|apr|ltv|loan)\b[^$]*$/i;
/**
 * A percentage that is a rate earned, a reward or interest, not a fee's percentage: "Earn 1.00% of the
 * monthly debit card spend ... up to a maximum of $10", "4% cash back ... A maximum of $10.00 cash back".
 */
const INTEREST_NEAR = /\b(?:apr|apy|annual percentage|interest|dividend|ltv|yield|earns?|cash\s*back|rewards?|rebates?|refunds?|reimburse\w*|discount)\b/i;
const WINDOW = 120;

export type RateBoundKind = "min" | "max";

export interface RateBound {
  /** The percentage the figure bounds. */
  ratePercent: number;
  /** The fee's own dollar figure: the least ("min") or most ("max") the charge can be. */
  bound: number;
  kind: RateBoundKind;
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

/** Where the fee's own words end on the line: after its name when the name is on it, else the start. */
function ownStart(line: string, feeName: string | null | undefined): number {
  const name = (feeName ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  if (!name) return 0;
  const at = line.toLowerCase().indexOf(name);
  return at < 0 ? 0 : at + name.length;
}

/** "min" or "max" when the figure at [start, end) carries min/max wording, else null. */
function boundKindAt(line: string, start: number, end: number): RateBoundKind | null {
  const before = line.slice(Math.max(0, start - 40), start);
  const after = line.slice(end, end + 40);
  const word = BOUND_BEFORE.exec(before)?.[1] ?? BOUND_AFTER.exec(after)?.[1] ?? null;
  if (!word) return null;
  if (BOUND_BEFORE.test(before) && NOT_A_CHARGE_BOUND.test(before)) return null;
  return /^min/i.test(word) ? "min" : "max";
}

/** True when the words between a bound and its percentage keep them one clause. */
function sameClause(line: string, from: number, to: number): boolean {
  const between = line.slice(from, to);
  if (between.length > WINDOW || (between.match(/\|/g) ?? []).length > 1) return false;
  if (/[.;!?]\s+[A-Z][a-z]+\s+[A-Za-z]/.test(between.replace(/\b(?:min|max)\.\s/gi, "min "))) return false;
  // Any other price between them must itself be a bound of the same charge.
  for (const money of between.matchAll(MONEY)) {
    const at = from + (money.index ?? 0);
    if (!boundKindAt(line, at, at + money[0].length)) return false;
  }
  return true;
}

/**
 * The rate and bound when `text` prices `amount` as the minimum or maximum of a percentage charge on
 * the fee's own line, else null. `feeName`, when given, places the fee's own figure on it (see the
 * module note).
 */
export function rateBoundOf(
  text: string | null | undefined,
  amount: number | string | null | undefined,
  feeName?: string | null,
): RateBound | null {
  const value = Number(amount);
  if (!(value > 0) || !Number.isFinite(value)) return null;
  const line = (text ?? "").replace(/\s+/g, " ");
  if (!BOUND_WORDS.test(line) || !/\d\s*(?:%|percent\b)/i.test(line)) return null;
  const from = ownStart(line, feeName);
  const own = [...line.matchAll(MONEY)].find((money) => (money.index ?? 0) >= from && Math.abs(moneyValue(money[1]) - value) <= 0.001);
  if (!own) return null;
  const start = own.index ?? 0;
  const end = start + own[0].length;
  const kind = boundKindAt(line, start, end);
  if (!kind) return null;
  let best: { percent: number; at: number; distance: number; matchEnd: number } | null = null;
  for (const pct of line.matchAll(PERCENT)) {
    const at = pct.index ?? 0;
    const matchEnd = at + pct[0].length;
    const percent = rate(pct[1]);
    if (percent == null) continue;
    if (INTEREST_NEAR.test(line.slice(Math.max(0, at - 20), Math.min(line.length, matchEnd + 20)))) continue;
    const ok = at >= end ? sameClause(line, end, at) : matchEnd <= start ? sameClause(line, matchEnd, start) : false;
    if (!ok) continue;
    const distance = at >= end ? at - end : start - matchEnd;
    if (!best || distance < best.distance) best = { percent, at, distance, matchEnd };
  }
  if (!best) return null;
  const clauseStart = Math.max(0, Math.min(start, best.at) - 20);
  const clauseEnd = Math.min(line.length, Math.max(end, best.matchEnd) + 20);
  return { ratePercent: best.percent, bound: value, kind, clause: line.slice(clauseStart, clauseEnd).trim() };
}

/** True when the figure is a percentage charge's minimum or maximum on its own line (see `rateBoundOf`). */
export function pricesRateBound(
  text: string | null | undefined,
  amount: number | string | null | undefined,
  feeName?: string | null,
): boolean {
  return rateBoundOf(text, amount, feeName) !== null;
}

/** The SQL prefilters (`~*`) for lines that could state such a bound; `rateBoundOf` decides. */
export const RATE_BOUND_WORDS_SQL = String.raw`\y(min|minimum|max|maximum)\y`;
export const RATE_BOUND_PERCENT_SQL = String.raw`[0-9]\s*(%|percent)`;
