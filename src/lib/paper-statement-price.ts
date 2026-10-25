/**
 * #1947: a price whose own words on its line make it the paper statement charge.
 *
 * Knox named such a price by the generic words around it ("Monthly fee", "Service charge", "A
 * monthly fee of") and filed it as the account's monthly maintenance fee: TD's "Paper statements:
 * $3 monthly fee", "Service charge | $3.00 paper statement fee each statement cycle", "A $2 paper
 * statement fee applies if you are not enrolled in eStatements", "*A monthly fee of $3 applies if you
 * choose to receive paper statements". Knox's rules (v115) and the category guard (v91) read the
 * line with this one function, so the two never drift.
 *
 * The price is the paper statement charge when, on its own line:
 * - the words right after it name a paper statement fee ("$4.00 per month paper statement fee",
 *   "$2.00 monthly paper statement fee"), a charge per or for each paper statement ("$5 per paper
 *   statement", "$3.50 charge for each original paper statement", "$3 monthly service charge for
 *   paper statements"), or say so in brackets ("$1.00 per month (paper statement)");
 * - the words right after it charge it only for receiving paper statements ("applies if you choose
 *   to receive paper statements", "may be charged to accounts receiving a paper statement", "per
 *   month if member receives mailed, paper statements");
 * - the label right before it is a paper statement fee's ("Paper statements: $3 monthly fee",
 *   "Paper (mailed) Statement Fee **** | $2.00 Monthly Fee").
 *
 * It is not when the price is the account's own fee for paper holders beside an electronic price
 * ("$4 for paper statement or $3 for estatement", "$7 with paper statement; $5 with electronic
 * statement"): "with" and a bare "for" never count, and a line that prices an e-statement
 * alternative right after the price is the account's tiered fee.
 */

const PAPER = String.raw`(?:paper|printed|mailed)(?:\s*\(\s*mailed\s*\))?(?:,?\s+(?:paper|mailed|printed))?`;
const STATEMENT = String.raw`(?:statements?|stmts?|states)\b`;
const PERIOD_WORDS = String.raw`(?:(?:monthly|each|a\s+month|per\s+month|\/\s*month|per\s+(?:statement\s+)?cycle|each\s+statement\s+cycle)\s+)*`;

/** "$4.00 per month paper statement fee", "$5 per paper statement", "$3.50 charge for each original paper statement". */
const NAMED_AFTER = new RegExp(
  String.raw`^\s*\*{0,3}\s*${PERIOD_WORDS}(?:` +
    String.raw`${PAPER}\s+${STATEMENT}\s*(?:service\s+)?(?:fees?|charges?)\b` +
    String.raw`|(?:(?:service|maintenance)\s+)?(?:fees?|charges?)\s+(?:per\s+(?:statement\s+)?cycle(?:\s+period)?\s+)?(?:for|per)\s+(?:each\s+|every\s+)?(?:original\s+|requested\s+)?${PAPER}\s+${STATEMENT}` +
    String.raw`|per\s+(?:original\s+)?${PAPER}\s+${STATEMENT}` +
    String.raw`|\(\s*${PAPER}\s+${STATEMENT}\s*\)` +
    ")",
  "i",
);

/** "applies if you choose to receive paper statements", "may be charged to accounts receiving a paper statement". */
const ONLY_FOR_PAPER_AFTER = new RegExp(
  String.raw`^\s*\*{0,3}\s*${PERIOD_WORDS}(?:(?:service\s+)?(?:fees?|charges?)\s+)?(?:applies\s+|will\s+(?:be\s+)?(?:apply|charged|assessed)\s+|may\s+(?:be\s+)?(?:apply|charged|assessed)\s+)?` +
    String.raw`(?:if|when|to|for)\s+(?:you|the\s+member|members?|customers?|accounts?|account\s+holders?)\s+` +
    String.raw`(?:(?:choose|elect|opt|request|prefer)s?\s+(?:to\s+)?(?:receive\s+)?|receiv(?:e|es|ing)\s+|get(?:s|ting)?\s+)(?:a\s+|their\s+|your\s+)?(?:mailed,?\s+)?${PAPER}\s+${STATEMENT}`,
  "i",
);

/** A paper statement fee's own label right before the price ("Paper statements:", "Paper (mailed) Statement Fee **** |"). */
const LABEL_BEFORE = new RegExp(String.raw`(?:^|[|•·:;.]\s*|^\W*)${PAPER}\s+${STATEMENT}\s*(?:fees?|charges?)?\s*$`, "i");

/** The account's own price for paper holders beside an electronic price ("$4 for paper statement or $3 for estatement"). */
const ELECTRONIC_ALTERNATIVE = /^[^|$]{0,60}\b(?:or|;|,)\s*\$\s?\d[\d.,]*\s+(?:with|for|if)\s+(?:an?\s+)?(?:e-?statements?|electronic|online|paperless)/i;

function priceOnLine(amount: number): RegExp {
  const whole = Math.trunc(amount);
  const cents = Math.round((amount - whole) * 100);
  const centsPart = cents === 0 ? String.raw`(?:\.00)?` : String.raw`\.${String(cents).padStart(2, "0")}`;
  return new RegExp(String.raw`\$\s?${whole === 0 ? "0?" : whole}${centsPart}(?![\d,]|\.\d)`, "g");
}

function plain(text: string): string {
  return text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ");
}

/**
 * Pure: the words on `line` that make `amount` its paper statement charge, or null. Read for a fee
 * filed as monthly maintenance; `line` is the fee's own source line (Knox's segment, or the
 * `excerpt=` its conditions carry).
 */
export function paperStatementPriceOnLine(line: string | null | undefined, amount: number | string | null | undefined): string | null {
  const value = Number(amount);
  if (!line || amount == null || amount === "" || !Number.isFinite(value) || value <= 0) return null;
  const text = plain(line);
  if (!/\b(?:paper|printed|mailed)\b/i.test(text)) return null;
  const prices = priceOnLine(value);
  for (let match = prices.exec(text); match; match = prices.exec(text)) {
    const tail = text.slice(match.index + match[0].length);
    if (ELECTRONIC_ALTERNATIVE.test(tail)) continue;
    const ownTail = tail.split(/\$|\|/)[0];
    const after = ownTail.match(NAMED_AFTER) ?? ownTail.match(ONLY_FOR_PAPER_AFTER);
    if (after) return `${match[0]}${after[0]}`.trim();
    // The label is the price's own cell before it, or the cell before when the price opens its cell.
    const cells = text.slice(0, match.index).split("|");
    const own = cells[cells.length - 1].trim();
    const label = (own || cells.length < 2 ? own : cells[cells.length - 2]).replace(/[\s*.…_:–—-]+$/, "");
    const labelled = label.match(LABEL_BEFORE);
    if (labelled) return `${labelled[0].trim()} ${match[0]}`.trim();
  }
  return null;
}
