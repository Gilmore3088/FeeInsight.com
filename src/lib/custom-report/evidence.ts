/**
 * The evidence behind each amount in a Competitive Fee Position Report: one shared builder for
 * the report page's exhibit and the CSV, so both show the same records and the same basis.
 *
 * An institution can publish several prices for one fee line (one per account, or balance
 * tiers). The index counts one value per institution (`institutionValue` in fee-stats.ts: the
 * middle of its prices, the highest for overdraft), so a single quoted line cannot stand behind
 * that value. Each amount here carries its basis ("published price", "middle of 3 published
 * prices", "highest of 2 prices") and every record it was built from: the account or product,
 * the record's amount, the quoted line, its source and the day the schedule was read.
 *
 * A record whose evidence cannot reproduce its amount is left out of the report's analysis
 * (live fee rows are never changed here):
 *   - its quoted line does not state the amount (`checkFeeAgainstSource`, the one shared check,
 *     run on the quote itself); or
 *   - its source is an article or an educational page about fees in general rather than the
 *     institution's own schedule (TD's "$35 each occurrence is common", read from a
 *     /learning/money-management/ article), or its quote speaks of fees in general.
 * The amount is then rebuilt from the records that remain; when none remains, the institution
 * is left out of that line's comparison and the line's medians are worked out without it.
 */
import { HIGHEST_TIER_CATEGORIES, institutionValue } from "@/lib/fee-institution-value";
import type { MarketFeeLine, MarketFeeRecord } from "@/lib/data-store/custom-report-market";
import { isArticleLink } from "@/lib/agents/magellan/link-coverage";
import { checkFeeAgainstSource } from "./source-check";
import { FEE_LINE_RULES } from "./rules";

export type EvidenceProblem = "quote_without_amount" | "quote_names_other_fee" | "not_a_fee_schedule";

export interface EvidenceRecord {
  /** The published_fee_catalog row id, when the copy holds it. */
  record_id: number | null;
  /** The fee's published name, which names the account or product when the bank does. */
  product: string;
  amount: number;
  /** The line of the institution's own document that states the amount. */
  quote: string;
  source_url: string | null;
  read_on: string | null;
  /** Why the record was left out of the analysis; null when it is used. */
  problem: EvidenceProblem | null;
}

export interface AmountEvidence {
  /** The value compared for the institution, rebuilt from the usable records; null when none is usable. */
  amount: number | null;
  /** "published price", "midpoint of $10 and $15", "middle of 3 published prices" or "highest of 2 published prices"; null when excluded. */
  basis: string | null;
  /** The records the amount is built from, lowest first. */
  records: EvidenceRecord[];
  /** Records left out because their evidence does not show their amount. */
  excluded: EvidenceRecord[];
}

/** Folders of educational pages about fees in general, beyond Magellan's article folders. */
const EDUCATIONAL_PATH = /\/(learn(ing)?|education|advice|financial-(education|literacy|wellness)|money-management|money-tips)\//i;
/**
 * Credit unions often file their fee schedule under /learn/ ("/learn/fee-schedule",
 * "/learn/true-north-account-info/fees.html"); a path that names a fee document is kept.
 */
const FEE_PAGE_PATH =
  /(fee-?schedule|schedule-?of-?(fees|charges)|fees?-and-(charges|limits)|limits-and-fees|rates?-(and-)?fees|disclosures?|service-?(charges|fees)|\/fees?(\.html?|\/|$)|\.pdf$)/i;
/** A quote that describes fees in general instead of stating the institution's own price. */
const GENERAL_STATEMENT = /\b(is common|are common|commonly charged|is typically around|typically charges?|on average|national average|the amount for [a-z ]*fees varies)\b/i;

/** True for an article or educational page about fees in general, not an institution's schedule. */
export function educationalPage(url: string | null | undefined): boolean {
  if (!url) return false;
  if (isArticleLink(url)) return true;
  try {
    const path = decodeURIComponent(new URL(url).pathname);
    return EDUCATIONAL_PATH.test(path) && !FEE_PAGE_PATH.test(path);
  } catch {
    return false;
  }
}

/** "$10.00", "$ 25", "10.00": every dollar figure written in a quote. */
const FIGURE = /\$?\s?(\d{1,3}(?:,\d{3})*(?:\.\d{1,2})?)(?!\d)/g;
const NO_CHARGE = /\b(no (fee|charge)|free|eliminated)\b/i;

/** Whether the quote writes this amount as a figure (or, for $0, says there is no charge). */
export function quoteStatesFigure(quote: string, amount: number): boolean {
  if (amount === 0 && NO_CHARGE.test(quote)) return true;
  for (const match of quote.matchAll(FIGURE)) {
    if (Math.abs(Number(match[1].replace(/,/g, "")) - amount) < 0.005) return true;
  }
  return false;
}

const INCLUDE_BY_LINE = new Map(FEE_LINE_RULES.map((rule) => [rule.key, rule.include]));

// The report's fee-line rules (Postgres `~*`, \m and \M word boundaries) read as JavaScript, as
// whole words from their start: inside a fee name "nsf" may sit anywhere, but in a quoted label
// "nsf" in "transfer" or "clos" in "disclosure" is not a fee word.
const asRegex = (pattern: string) => new RegExp(`\\b(?:${pattern.replace(/\\[mM]/g, "\\b")})`, "i");
/** The line's own words from its label ("Outgoing international wire"), five letters or more. */
const labelWords = (label: string) =>
  [...new Set(label.toLowerCase().match(/[a-z]{5,}/g) ?? [])].map((word) => new RegExp(`\\b${word}`, "i"));
const LINE_TESTS = FEE_LINE_RULES.map((rule) => ({
  rule,
  include: asRegex(rule.include),
  exclude: asRegex(rule.exclude),
  words: labelWords(rule.label),
}));

/**
 * The words that label each place the quote writes the record's amount: the last cell, bullet or
 * sentence before the figure, back to the previous figure ("Paper statements" in "Paper
 * statements | $3 monthly fee"; "Outgoing" in "Incoming - $20.00 Outgoing - $20.00").
 */
export function amountLabels(quote: string, amount: number): string[] {
  const labels: string[] = [];
  let from = 0;
  for (const match of quote.matchAll(FIGURE)) {
    const start = match.index ?? 0;
    if (Math.abs(Number(match[1].replace(/,/g, "")) - amount) < 0.005) {
      const segments = quote.slice(from, start).split(/\s\|\s?|\|\s|•|[.;:](?:\s|$)/).map((part) => part.trim());
      const label = [...segments].reverse().find((part) => /[a-z]{3}/i.test(part));
      if (label) labels.push(label);
    }
    from = start + match[0].length;
  }
  return labels;
}

/**
 * Whether the labels on the record's amount name a different fee: a word the line's own rule
 * excludes ("statement" on monthly maintenance, "sustained" on overdraft, "incoming" on an
 * outgoing wire), or another line's fee words where the line's own are absent ("deposits" for an
 * ATM figure). Lines that share catalog categories (overdraft, NSF, returned deposits) do not
 * count against each other. Uses the rules in rules.ts, no other taxonomy.
 */
export function quoteNamesOtherFee(line: string, quote: string, amount: number): boolean {
  const own = LINE_TESTS.find((t) => t.rule.key === line);
  const labels = amountLabels(quote, amount);
  if (!own || labels.length === 0) return false;
  const namesOwn = (label: string) =>
    !own.exclude.test(label) && (own.include.test(label) || own.words.some((word) => word.test(label)));
  const namesOther = (label: string) =>
    own.exclude.test(label) ||
    (!namesOwn(label) &&
      LINE_TESTS.some((t) => t.rule.key !== line && !t.rule.sourceKeys.some((key) => own.rule.sourceKeys.includes(key)) && t.include.test(label)));
  // A label naming no fee ("Free for customers aged 60+, otherwise $3") settles nothing: the
  // record fails when some label names another fee and none names its own.
  return labels.some(namesOther) && !labels.some(namesOwn);
}

/** Why a record's evidence does not reproduce its amount, or null when it does. */
export function evidenceProblem(line: string, record: Pick<EvidenceRecord, "product" | "amount" | "quote" | "source_url">): EvidenceProblem | null {
  if (educationalPage(record.source_url) || GENERAL_STATEMENT.test(record.quote) || GENERAL_STATEMENT.test(record.product)) {
    return "not_a_fee_schedule";
  }
  // The quote alone often leaves out the heading that names the fee ("Self-Service Outgoing ...
  // $25.00" under "Domestic Wires"), so the shared check reads it under the record's own name:
  // what it tests here is that the quoted line states this record's amount as the fee.
  const check = checkFeeAgainstSource(`${record.product}: ${record.quote}`, record.product, record.amount, INCLUDE_BY_LINE.get(line) ?? "");
  // A row that prices several accounts side by side, or an eliminated fee, can fail the shared
  // check read on its own and still state the amount; then the figure must appear in the quote.
  if (!check.ok && !quoteStatesFigure(record.quote, record.amount)) return "quote_without_amount";
  // Either way the words labelling the amount must not name another fee: TD's "Paper statements |
  // $3 monthly fee", filed as a monthly maintenance fee, passes the shared check on its own.
  return quoteNamesOtherFee(line, record.quote, record.amount) ? "quote_names_other_fee" : null;
}

/**
 * "published price"; "midpoint of $10 and $15" for two prices; "middle of 3 published prices";
 * for overdraft, "highest of 2 published prices".
 */
export function amountBasis(line: string, amounts: number[]): string {
  if (new Set(amounts).size < 2) return "published price";
  if (HIGHEST_TIER_CATEGORIES.has(line)) return `highest of ${amounts.length} published prices`;
  if (amounts.length === 2) {
    const [low, high] = [...amounts].sort((a, b) => a - b);
    return `midpoint of ${dollars(low)} and ${dollars(high)}`;
  }
  return `middle of ${amounts.length} published prices`;
}

function dollars(value: number): string {
  return Number.isInteger(value) ? `$${value}` : `$${value.toFixed(2)}`;
}

/** The records behind a fee line: its tiers when it has several, otherwise the line itself. */
function recordsOf(fee: MarketFeeLine): MarketFeeRecord[] {
  if (fee.tiers && fee.tiers.length > 1) return fee.tiers;
  return [{ id: fee.id ?? null, amount: fee.amount, fee_name: fee.fee_name, source_line: fee.source_line, source_url: fee.source_url, schedule_read_on: fee.schedule_read_on }];
}

/** The evidence behind one institution's amount for one fee line. */
export function buildAmountEvidence(fee: MarketFeeLine): AmountEvidence {
  const all = recordsOf(fee).map((r): EvidenceRecord => {
    const record = {
      record_id: r.id ?? null,
      product: r.fee_name,
      amount: r.amount,
      quote: r.source_line,
      // Copies saved before each record kept its own source share the line's.
      source_url: r.source_url === undefined ? fee.source_url : r.source_url,
      read_on: r.schedule_read_on === undefined ? fee.schedule_read_on : r.schedule_read_on,
      problem: null,
    };
    return { ...record, problem: evidenceProblem(fee.line, record) };
  });
  const byAmount = (a: EvidenceRecord, b: EvidenceRecord) => a.amount - b.amount || (a.record_id ?? 0) - (b.record_id ?? 0);
  const records = all.filter((r) => r.problem === null).sort(byAmount);
  const excluded = all.filter((r) => r.problem !== null).sort(byAmount);
  if (records.length === 0) return { amount: null, basis: null, records, excluded };
  const amounts = records.map((r) => r.amount);
  return { amount: institutionValue(fee.line, amounts), basis: amountBasis(fee.line, amounts), records, excluded };
}

/** A report figure: the published line rebuilt from its usable records, with its evidence. */
export type ReportFigure = MarketFeeLine & { evidence?: AmountEvidence };

/** A figure's evidence, built from the figure itself when the analysis did not attach it. */
export function evidenceOf(figure: MarketFeeLine & { evidence?: AmountEvidence }): AmountEvidence {
  return figure.evidence ?? buildAmountEvidence(figure);
}

/**
 * The fee line as the report uses it: amount, quote and tiers from the usable records only.
 * Null when no record's evidence shows its amount.
 */
export function withEvidence(fee: MarketFeeLine): (ReportFigure & { evidence: AmountEvidence }) | null {
  const evidence = buildAmountEvidence(fee);
  if (evidence.amount === null) return null;
  const first = evidence.records[0];
  return {
    ...fee,
    id: first.record_id,
    amount: evidence.amount,
    fee_name: first.product,
    source_line: first.quote,
    source_url: first.source_url,
    schedule_read_on: first.read_on,
    tiers:
      evidence.records.length > 1
        ? evidence.records.map((r) => ({ id: r.record_id, amount: r.amount, fee_name: r.product, source_line: r.quote, source_url: r.source_url, schedule_read_on: r.read_on }))
        : undefined,
    evidence,
  };
}
