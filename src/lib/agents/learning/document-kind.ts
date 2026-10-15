/**
 * What kind of document a stored text is (#1094): a fee schedule, a Truth in Savings
 * disclosure, an account agreement, a product page, or other. Free and deterministic, no
 * model call. Rosetta decides it from the content when it reads the document and stores it
 * with the text (`agent_source_texts.document_kind`); Knox and the scorecard only read it.
 *
 * Magellan's first guess from the link (DECISIONS, 2026-10-12) is a separate step. Where the
 * two disagree, Rosetta's read of the content is the one stored here.
 *
 * Calibrated on 40 production texts (seeded sample, 2026-10-15): navigation and footer links
 * ("Privacy Policy", "Terms & Conditions", "Disclosures", "Services") sit on nearly every page,
 * and product pages carry short priced lines ("Monthly Service Fee: $15"), so a heading counts
 * only when it is a document title with no amount in it.
 */
import { isProductPageUrl, PRODUCT_PAGE_MIN_FEE_LINES, productPageScore, scoreFeePage, urlNamesFeePage } from "./fee-page";

export const DOCUMENT_KINDS = ["fee_schedule", "truth_in_savings", "account_agreement", "product_page", "other"] as const;
export type DocumentKind = (typeof DOCUMENT_KINDS)[number];

/** Bump when the rules change, so a later read decides the kind again. */
export const DOCUMENT_KIND_VERSION = 1;

const HEADING_SCAN_CHARS = 6000;
const HEADING_MAX_CHARS = 80;
/** A title is a few words: "This charge is identified in our most recent fee schedule" is a sentence. */
const TITLE_MAX_WORDS = 8;
/** A line with a price is a fee line, not a title: "Monthly Service Fee: $15". */
const HAS_PRICE = /\$\s?\.?[0-9]|\b[0-9]+\.[0-9]{2}\b|\b[0-9]+\s?%/;

const SCHEDULE_TITLE =
  /\b(?:schedule of (?:service )?(?:fees|charges)|(?:consumer |personal |business )?fee schedule|schedule of charges|fees (?:and|&) (?:service )?charges|service charge (?:listing|schedule)|fee (?:brochure|disclosure)|miscellaneous fees(?: and charges)?|common fees)\b/i;
const TIS_TITLE = /\b(?:truth[- ]in[- ]savings|disclosure of account terms|deposit (?:account|product) disclosures?|account disclosures? and (?:rates|fees))\b/i;
const AGREEMENT_TITLE =
  /\b(?:(?:deposit|account|membership|depositor|member|share)(?: and account)? (?:account )?agreement|(?:internet|online|mobile|digital|e-?) ?banking (?:agreement|disclosure|terms)|debit card agreement|electronic funds? transfers? (?:agreement|disclosure)|regulation e\b|e-?sign(?:ature)? (?:consent|disclosure|agreement)|funds availability (?:policy|disclosure))/i;
/** Truth in Savings and rate-page content: yields, dividends and balances. */
const YIELD_TERMS = /\b(?:annual percentage yield|APY|minimum balance to (?:open|obtain)|dividend rate|interest rate)\b/gi;

export interface DocumentKindInput {
  text: string;
  url?: string | null;
  /** True when the text is offered as the bank's fee link, not a companion account page. */
  feeSchedule?: boolean;
}

export interface DocumentKindResult {
  kind: DocumentKind;
  reason: string;
}

/** Short lines with no price near the top, split into table cells ("Bank address | Schedule of Fees"). */
function titles(text: string): string[] {
  return text
    .slice(0, HEADING_SCAN_CHARS)
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter((line) => line.length > 0 && line.length <= HEADING_MAX_CHARS && !HAS_PRICE.test(line))
    .flatMap((line) => line.split("|").map((cell) => cell.trim()))
    .filter((cell) => cell.length > 0 && cell.split(" ").length <= TITLE_MAX_WORDS);
}

/**
 * The kind, in this order:
 * 1. the bank's fee link at a product address with few fee lines and no schedule title is a
 *    product page (the shared rule, `productPageScore`, #1053);
 * 2. a Truth in Savings title with few fee lines is a disclosure, even when it names "Fees
 *    and Charges" (a section that points to the fee page);
 * 3. any text at a product address is a product page when it has few fee lines or quotes
 *    yields, whatever its titles say: account pages carry a "Fee Schedule" or "Fees & Charges"
 *    link in their menus (4 of 30 in the second sample, 2026-10-15);
 * 4. a schedule title ("Schedule of Fees and Charges") makes it a fee schedule, even inside a
 *    disclosure, since the fee table is what Knox reads;
 * 5. an agreement title (membership, deposit account, online banking, Reg E, e-sign, funds
 *    availability) makes it an account agreement;
 * 6. a Truth in Savings title makes it a Truth in Savings disclosure;
 * 7. a page of yields with few fee lines is a disclosure, or a rates page (other);
 * 8. many fee lines, or a link that names the fee page with some, make it a fee schedule;
 * 9. otherwise other.
 */
export function documentKind(input: DocumentKindInput): DocumentKindResult {
  const text = input.text ?? "";
  const score = scoreFeePage(text, input.url);
  const feeLines = score.feeLines;
  const yields = (text.match(YIELD_TERMS) ?? []).length;
  if (input.feeSchedule) {
    const product = productPageScore(text, input.url, feeLines, score.dollarAmounts, score.rateTerms);
    if (product) return { kind: "product_page", reason: product.reason };
  }
  const lines = titles(text);
  const tis = lines.find((line) => TIS_TITLE.test(line));
  if (tis && feeLines < 5) return { kind: "truth_in_savings", reason: `Disclosure title: "${tis}", ${feeLines} fee lines` };
  if (isProductPageUrl(input.url) && (feeLines < PRODUCT_PAGE_MIN_FEE_LINES || yields >= 3)) {
    return { kind: "product_page", reason: `An account or product address with ${feeLines} fee line${feeLines === 1 ? "" : "s"} and ${yields} yield terms` };
  }
  const schedule = lines.find((line) => SCHEDULE_TITLE.test(line));
  if (schedule) return { kind: "fee_schedule", reason: `Schedule title: "${schedule}"` };
  const agreement = lines.find((line) => AGREEMENT_TITLE.test(line));
  if (agreement) return { kind: "account_agreement", reason: `Agreement title: "${agreement}"` };
  if (tis) return { kind: "truth_in_savings", reason: `Disclosure title: "${tis}"` };
  if (yields >= 10 && yields >= 2 * feeLines) return { kind: "other", reason: `A rates page: ${yields} yield terms, ${feeLines} fee lines` };
  if (yields >= 3 && feeLines < 5) return { kind: "truth_in_savings", reason: `${yields} yield and balance terms, ${feeLines} fee lines` };
  if (feeLines >= PRODUCT_PAGE_MIN_FEE_LINES) return { kind: "fee_schedule", reason: `${feeLines} fee lines` };
  if (feeLines >= 3 && urlNamesFeePage(input.url)) return { kind: "fee_schedule", reason: `The link names the fee page; ${feeLines} fee lines` };
  if (feeLines >= 5) return { kind: "fee_schedule", reason: `${feeLines} fee lines` };
  return { kind: "other", reason: `${feeLines} fee line${feeLines === 1 ? "" : "s"} and no schedule, disclosure or agreement title` };
}
