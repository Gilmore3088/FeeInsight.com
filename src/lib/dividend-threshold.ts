/**
 * Knox v170 (re-read backlog dry run 3, Nov 2): a rate disclosure's balance threshold is no fee. "If your
 * average daily balance is below $100.00 ($5.00 for accounts held by those under 18 years of age), no
 * dividends are earned" (Peninsula Community FCU 4447, doc 41842) says what balance earns a dividend;
 * Knox's low-balance rule read it as a $5 minimum balance fee, and an earlier copy of the same page is
 * live as 73916. The sentence that prints the amount says the account earns no dividends or interest
 * below it, and names no charge: nothing is charged.
 *
 * Shared by Knox (the read is dropped, `dividend_threshold`), Darwin's verify (refused) and Darwin's live
 * re-check (`darwin.not_account_fee_line`), all on Knox's own line. A sentence that prices a fee beside
 * the lost dividend ("If below $5,000, a $10 monthly fee will be assessed, and no dividends are earned")
 * names its charge and stays.
 */
const NO_EARNINGS =
  /\b(?:no|not|never)\s+(?:earn|receive|be\s+paid|pay|accrue)\w*\s+(?:a\s+|any\s+)?(?:dividends?|interest)\b|\bno\s+(?:dividends?|interest)\s+(?:is|are|will|shall|can)\b(?:\s+be)?\s+(?:earned|paid|credited|accrued?)\b|\b(?:dividends?|interest)\s+(?:is|are|will|shall)\s+not\s+(?:be\s+)?(?:earned|paid|credited|accrue)\w*|\bdoes\s+not\s+earn\s+(?:dividends?|interest)\b/i;
// A price per unit of time or item is a charge too ("$5.00 per month", "$5.00 each", "$3.00/month"; #2963 review).
const CHARGE_WORD = /\b(?:fees?|charges?|charged|assess\w*|impos\w*|penalt\w*|deduct\w*|debit\w*|cost)\b|\b(?:per|a)\s+(?:month|item|check|withdrawal|transaction|quarter|year)\b|\beach\b|\/\s*(?:mo|month|item|qtr|quarter|yr|year)\b/i;
const AMOUNT = /\$\s*\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*\.\d{2}\b/g;

function amountsOf(text: string): number[] {
  return [...text.matchAll(AMOUNT)].map((match) => Number(match[0].replace(/[$,\s]/g, ""))).filter(Number.isFinite);
}

/**
 * The sentences of a line: "." followed by a space and a capital, any ";", a spaced dash (" - ", " – "),
 * or a cell break ends one, so a fee and the no-dividend note after it ("Christmas Club early withdrawal
 * $5.00 - no dividends are paid if closed early") are judged apart.
 */
function sentences(line: string): string[] {
  return line.split(/(?<=[.!?])\s+(?=[A-Z(])|;\s+|\s+[-–—]\s+|\s+\|\s+/).map((part) => part.trim()).filter(Boolean);
}

/**
 * The sentence of `line` that prints `amount` and says no dividend or interest is earned, with no charge
 * word: the amount is a balance threshold, not a fee. Null otherwise.
 */
export function dividendThresholdSentence(line: string | null | undefined, amount: number | null | undefined): string | null {
  if (!line || amount == null || !NO_EARNINGS.test(line)) return null;
  for (const sentence of sentences(line.replace(/\s+/g, " "))) {
    if (!NO_EARNINGS.test(sentence) || CHARGE_WORD.test(sentence)) continue;
    if (amountsOf(sentence).some((value) => Math.abs(value - amount) < 0.005)) return sentence;
  }
  return null;
}

/** Postgres pre-filter on Knox's stored line: the no-earnings words. */
export const DIVIDEND_THRESHOLD_SQL = String.raw`(no|not|never)\s+(earn|receive|be\s+paid|pay|accrue)[a-z]*\s+(a\s+|any\s+)?(dividend|interest)|no\s+(dividends?|interest)\s+(is|are|will|shall|can)|(dividends?|interest)\s+(is|are|will|shall)\s+not\s+|does\s+not\s+earn\s+(dividend|interest)`;
