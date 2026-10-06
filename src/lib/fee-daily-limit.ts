/**
 * A daily limit on how many overdraft or NSF fees a bank charges, as its schedule states
 * it: "Maximum 3 Overdraft fees per day", "we will charge no more than four (4) overdraft
 * or returned item fees per business day", "Overdraft Fee $35 per item (maximum of 3 per
 * day)". This is a count, not a dollar cap; a dollar cap ("Maximum of $120.00 per day")
 * is its own fee (`od_daily_cap`, `nsf_daily_cap`).
 *
 * Pure and deterministic. Hamilton reads it from the fee's own stored source text, so
 * the count always points back to the line that states it.
 */

export type DailyLimitScope = "overdraft" | "nsf" | "both";

export interface DailyFeeLimit {
  /** Fees charged at most per day. */
  count: number;
  /** Which fees the limit covers. */
  scope: DailyLimitScope;
  /** The sentence or row that states it (trimmed). */
  line: string;
}

const NUMBER_WORDS: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, twelve: 12,
};
const NUMBER = `(\\d{1,2}|${Object.keys(NUMBER_WORDS).join("|")})`;
const LIMIT_WORDS = "max(?:imum)?|limit(?:s|ed)?|no more than|not more than|up to|capped at|cap of|at most|only";
const DAY = "(?:per|a|each|in (?:a|one|any)|on any)\\s+(?:single\\s+)?(?:business\\s+|calendar\\s+|banking\\s+)?day\\b";
/**
 * Limit wording, then the count, then "per day", with only words between them (no other
 * figure or price): "maximum of 3 overdraft fees per day", "limited to six (6) per day",
 * "Maximum Charge (4) Per Day", "no more than 5 items each day".
 */
const LIMIT = new RegExp(
  `\\b(?:${LIMIT_WORDS})\\b([^$\\d\\n]{0,70}?)\\(?\\b${NUMBER}\\b\\)?(?:\\s*\\(\\s*\\d{1,2}\\s*\\))?([^$\\d\\n]{0,70}?)\\b${DAY}`,
  "gi",
);
const OVERDRAFT = /\b(overdrafts?|od|paid items?|items? paid|paid|courtesy pay|cp|bounce|privilege pay|overdraft privilege)\b/i;
const NSF = /\b(nsf|non-?sufficient|nonsufficient|insufficient|returned items?|items? returned|returned|return)\b/i;
/** A waiver or a tiered price, not a limit: "Waived for up to 2 fees per day", "$5 each (up to 2 per day, then $10". */
const NOT_A_LIMIT_BEFORE = /\bwaiv\w*\b[^.]{0,30}$/i;
const NOT_A_LIMIT_AFTER = /^[^.]{0,15}\bthen\b/i;
/** Other services with daily limits ("Limit of six ATM deposits per day"). */
const OTHER_SERVICE = /\b(atm|deposits?|withdrawals?|wires?|transfers?|zelle|statements?|checks? cashed|cash advance)\b/i;

function toCount(word: string): number | null {
  const n = /^\d+$/.test(word) ? Number(word) : NUMBER_WORDS[word.toLowerCase()];
  return n && n >= 1 && n <= 20 ? n : null;
}

function scopeOf(words: string): DailyLimitScope | null {
  const od = OVERDRAFT.test(words);
  const nsf = NSF.test(words);
  if (od && nsf) return "both";
  if (od) return "overdraft";
  if (nsf) return "nsf";
  return null;
}

/** Sentences and rows, short enough to name one limit each. */
function units(text: string): string[] {
  return text
    .split(/\r?\n|(?<=[.;])\s+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0);
}

/** Every daily fee-count limit the text states, in order. */
export function dailyFeeLimits(text: string | null | undefined): DailyFeeLimit[] {
  if (!text) return [];
  const out: DailyFeeLimit[] = [];
  const lines = units(text);
  lines.forEach((line, i) => {
    for (const match of line.matchAll(LIMIT)) {
      const start = match.index ?? 0;
      const end = start + match[0].length;
      const count = toCount(match[2]);
      if (!count) continue;
      if (NOT_A_LIMIT_BEFORE.test(line.slice(0, start)) || NOT_A_LIMIT_AFTER.test(line.slice(end))) continue;
      const between = `${match[1]} ${match[3]}`;
      // The fees it limits are named between the limit and "per day", or else on the row;
      // a row that opens with the limit ("Maximum Charge (4) Per Day: $100") belongs to the
      // fee named on the line above.
      const ownScope = scopeOf(between);
      if (!ownScope && OTHER_SERVICE.test(between)) continue;
      const rowScope = ownScope ?? scopeOf(line);
      const scope = rowScope ?? (start <= 12 ? scopeOf(lines[i - 1] ?? "") : null);
      if (!scope) continue;
      if (!ownScope && OTHER_SERVICE.test(line) && !OVERDRAFT.test(line) && !NSF.test(line)) continue;
      out.push({ count, scope, line: line.slice(0, 240) });
      break;
    }
  });
  return out;
}

/** The text's daily limit on one fee (overdraft or NSF), or null when it states none. */
export function dailyFeeLimitFor(text: string | null | undefined, feeCategory: string): DailyFeeLimit | null {
  const want: DailyLimitScope | null = feeCategory === "overdraft" ? "overdraft" : feeCategory === "nsf" ? "nsf" : null;
  if (!want) return null;
  return dailyFeeLimits(text).find((limit) => limit.scope === want || limit.scope === "both") ?? null;
}
