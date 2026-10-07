/**
 * Is this document actually a fee schedule? A deterministic, $0 check run on every
 * text Rosetta reads and on every page Magellan discovery considers.
 *
 * Calibrated on production texts (2026-10-03): of 439 HTML pages with no fee lines
 * and fewer than 3 dollar amounts, Knox found fees on only 3 (0.7%), while it found
 * none on 302. Pages that clearly list fees pass; everything in between is
 * "uncertain" and is still read, so the check only removes clear misses.
 */

export type FeePageVerdict = "fee_page" | "uncertain" | "wrong_document";

export interface FeePageScore {
  verdict: FeePageVerdict;
  /** Lines that pair a dollar amount with a fee word: the strongest single signal. */
  feeLines: number;
  dollarAmounts: number;
  rateTerms: number;
  reason: string;
}

/** Bump when the rules change, so earlier verdicts are re-checked. */
export const FEE_PAGE_CHECK_VERSION = 1;

/** "$35", "$ 35", "$.50", "75¢", "50 cents". */
const AMOUNT_SOURCE = String.raw`\$\s?\.?[0-9]|\b[0-9]+\s?(?:¢|cents?\b)`;
const DOLLAR = new RegExp(AMOUNT_SOURCE, "g");
const HAS_AMOUNT = new RegExp(AMOUNT_SOURCE);
const FEE_WORD = /(fee|charge|overdraft|nsf|insufficient|stop payment|wire|returned|statement|cashier|money order|dormant|inactive|research|safe deposit|replacement)/i;
const RATE_TERM = /(APY|APR|annual percentage)/g;
/**
 * A table cell holding a bare amount ("Canadian check fee, per check | 5.00"): a table
 * whose "Fee Amount" column drops the dollar sign (emb.bank's Schedule of Common Fees,
 * 30 such rows, was rejected as "only 1 dollar amount"). Counts toward fee lines only,
 * and only on a line with a fee word.
 */
const TABLE_CELL_AMOUNT = /(^|\s\|\s)\$?\s?[0-9]{1,4}\.[0-9]{2}\s*(\s\|\s|$)/;

/**
 * A news, press or investor-relations article (Chase's 2021 "avoid overdraft fees"
 * release) quotes fees but is never the bank's current schedule. A path that names the
 * schedule ("/news/fee-schedule.pdf") is still read.
 */
const ARTICLE_PATH = /\/(news|newsroom|press|press-releases?|pressroom|ir|investors?|investor-relations|blogs?)\//i;
const SCHEDULE_PATH = /(fee-?schedule|schedule-of-(fees|charges)|fee-?disclosure|service-charges|pricing)/i;

/** A path segment that is the bank's fee page: "/fees", "/account-fees", "/fees-and-charges". */
const FEE_PATH = /(^|[/_-])fees?([/_.-]|$)/i;

/**
 * Does the link itself say it is the fee page? Rosetta uses this to try the free
 * JavaScript fallbacks on such a page when its static text shows no fees.
 */
export function urlNamesFeePage(url: string | null | undefined): boolean {
  if (!url) return false;
  let path: string;
  try {
    path = decodeURIComponent(new URL(url).pathname);
  } catch {
    return false;
  }
  return SCHEDULE_PATH.test(path) || FEE_PATH.test(path);
}

export function isArticleUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  let path: string;
  try {
    path = new URL(url).pathname;
  } catch {
    return false;
  }
  return ARTICLE_PATH.test(path) && !SCHEDULE_PATH.test(path.split("/").filter(Boolean).pop() ?? "");
}

export function scoreFeePage(text: string, url?: string | null): FeePageScore {
  const dollarAmounts = (text.match(DOLLAR) ?? []).length;
  const rateTerms = (text.match(RATE_TERM) ?? []).length;
  let feeLines = 0;
  for (const line of text.split("\n")) {
    if ((HAS_AMOUNT.test(line) || TABLE_CELL_AMOUNT.test(line)) && FEE_WORD.test(line)) feeLines += 1;
  }

  if (isArticleUrl(url)) {
    return { verdict: "wrong_document", feeLines, dollarAmounts, rateTerms, reason: "A news or investor article, not the bank's fee schedule" };
  }

  if (feeLines >= 3) {
    return { verdict: "fee_page", feeLines, dollarAmounts, rateTerms, reason: `${feeLines} lines list a fee with an amount` };
  }
  if (feeLines === 0 && dollarAmounts < 3) {
    return {
      verdict: "wrong_document",
      feeLines,
      dollarAmounts,
      rateTerms,
      reason: `No fee lines and only ${dollarAmounts} dollar amount${dollarAmounts === 1 ? "" : "s"}: not a fee schedule`,
    };
  }
  return {
    verdict: "uncertain",
    feeLines,
    dollarAmounts,
    rateTerms,
    reason: `${feeLines} fee line${feeLines === 1 ? "" : "s"}, ${dollarAmounts} dollar amounts`,
  };
}

/** HTML to plain lines, for scoring pages before Rosetta has read them. */
export function htmlToScoringText(html: string): string {
  return html
    .replace(/<script\b[\s\S]*?<\/script>/gi, " ")
    .replace(/<style\b[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|li|tr|h[1-6]|section|article|table)>|<br\s*\/?>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&#36;|&dollar;/gi, "$")
    .replace(/[ \t]+/g, " ");
}
