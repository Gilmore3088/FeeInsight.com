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
 * Two comparison rules keep a different charge out of a line the same way:
 *   - monthly maintenance leaves out an optional feature's charge (an add-on package, ATM
 *     surcharge refunds, rewards or identity protection; ADD_ON_FEATURE); and
 *   - the out-of-network ATM line leaves out withdrawals abroad (INTERNATIONAL_ATM), so PNC's $3
 *     domestic and $5 abroad never average into $4.
 * The amount is then rebuilt from the records that remain; when none remains, the institution
 * is left out of that line's comparison and the line's medians are worked out without it.
 */
import { HIGHEST_TIER_CATEGORIES, institutionValue } from "@/lib/fee-institution-value";
import type { MarketFeeLine, MarketFeeRecord } from "@/lib/data-store/custom-report-market";
import { isArticleLink } from "@/lib/agents/magellan/link-coverage";
import { checkFeeAgainstSource } from "./source-check";
import { FEE_LINE_RULES } from "./rules";

export type EvidenceProblem =
  | "quote_without_amount"
  | "quote_names_other_fee"
  | "not_a_fee_schedule"
  /** Monthly maintenance: an optional feature's charge (an add-on, ATM refunds, identity protection), not the account's fee. */
  | "add_on_feature"
  /** Out-of-network ATM: a withdrawal abroad; the line compares domestic withdrawals. */
  | "international_atm";

/**
 * Why a record was left out, by kind only: the fallback for a copy whose records carry no
 * `reason` (`problemReason` names what the quote describes and the fee it is not).
 */
export const PROBLEM_REASON: Record<EvidenceProblem, string> = {
  quote_without_amount: "the quote does not show the amount",
  quote_names_other_fee: "the quote gives the amount for a different fee",
  not_a_fee_schedule: "general article, not the institution's own fee schedule",
  add_on_feature: "optional add-on, not account maintenance",
  international_atm: "international ATM withdrawal, not domestic",
};

/** What each line compares, in the "X, not Y" reasons: "incoming wire, not outgoing domestic wire". */
const LINE_FEE: Record<string, string> = {
  monthly_maintenance: "account maintenance",
  overdraft: "per-item overdraft",
  nsf: "per-item NSF",
  atm_non_network: "out-of-network ATM",
  wire_domestic_outgoing: "outgoing domestic wire",
  wire_intl_outgoing: "outgoing international wire",
  wire_domestic_incoming: "incoming domestic wire",
  stop_payment: "stop payment",
  cashiers_check: "cashier's check",
  od_protection_transfer: "overdraft protection transfer",
  paper_statement: "paper statement",
  card_replacement: "debit card replacement",
  deposited_item_return: "deposited item return",
};
/** The noun a bare qualifier ("Incoming -") is read with: "incoming wire". */
const LINE_NOUN: Record<string, string> = {
  monthly_maintenance: "fee",
  overdraft: "overdraft",
  nsf: "NSF",
  atm_non_network: "ATM fee",
  wire_domestic_outgoing: "wire",
  wire_intl_outgoing: "wire",
  wire_domestic_incoming: "wire",
};

const lineFee = (line: string) => LINE_FEE[line] ?? (FEE_LINE_RULES.find((r) => r.key === line)?.label.toLowerCase() ?? line);

/** "Sustained Overdraft Fee of" -> "sustained overdraft"; "Incoming -" -> "incoming wire". */
function describedFee(line: string, label: string): string {
  const words = label
    .replace(/[.|•*\u2026]+/g, " ")
    .replace(/[\s\-–—:,(]+$/g, "")
    .replace(/^[\s\-–—:,)]+/g, "")
    .replace(/\b(fees?|charges?)(\s+(of|is|for|per))?\s*$/i, "")
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(-6);
  const text = words.join(" ").toLowerCase().replace(/\batm\b/g, "ATM").replace(/\bnsf\b/g, "NSF");
  if (!text) return "a different fee";
  const noun = LINE_NOUN[line];
  return words.length === 1 && noun && !text.includes(noun.toLowerCase()) ? `${text} ${noun}` : text;
}

/** What kind of add-on a record prices, for its reason. */
function addOnKind(text: string): string {
  if (/\b(?:refunds?|rebates?|reimburse\w*)\b/i.test(text) && /\b(?:atm|surcharges?)\b/i.test(text)) return "ATM surcharge-refund add-on";
  if (/\bid\s*theft|\bidentity\b/i.test(text)) return "identity-protection add-on";
  if (/\binsurance\b|\baccidental death/i.test(text)) return "insurance add-on";
  if (/\b(?:rewards?|perks?|benefits?)\b/i.test(text)) return "rewards or perks package";
  return "optional add-on";
}

/**
 * The reason a record was left out, naming what its quote describes and the fee the line compares:
 * "sustained overdraft, not per-item overdraft", "incoming wire, not outgoing domestic wire",
 * "ATM surcharge-refund add-on, not account maintenance", "international ATM withdrawal, not
 * domestic", "educational article, not the institution's own fee schedule". "The quote does not show the
 * amount" is kept for a quote where the amount is truly absent. Shared by the page and the CSV.
 */
export function problemReason(
  line: string,
  problem: EvidenceProblem,
  record: Pick<EvidenceRecord, "product" | "amount" | "quote" | "source_url">,
): string {
  switch (problem) {
    case "quote_without_amount":
      return "the quote does not show the amount";
    case "not_a_fee_schedule":
      return educationalPage(record.source_url)
        ? "educational article, not the institution's own fee schedule"
        : "general statement about fees, not the institution's own fee schedule";
    case "quote_names_other_fee": {
      const label = otherFeeLabel(line, record.quote, record.amount);
      return `${label ? describedFee(line, label) : "a different fee"}, not ${lineFee(line)}`;
    }
    case "add_on_feature":
      return `${addOnKind(`${record.product} ${amountWindow(record.quote, record.amount)}`)}, not account maintenance`;
    case "international_atm":
      return "international ATM withdrawal, not domestic";
  }
}

/** True for the problems that keep a different charge out of a line rather than doubting the evidence. */
export function isScopeProblem(problem: EvidenceProblem | null | undefined): boolean {
  return problem === "add_on_feature" || problem === "international_atm";
}

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
  /** The same in words, naming what the quote describes and the fee it is not (`problemReason`); null when used. */
  reason?: string | null;
}

export interface AmountEvidence {
  /** The value compared for the institution, rebuilt from the usable records; null when none is usable. */
  amount: number | null;
  /** "published price", "midpoint of $10 and $15", "middle of 3 published prices" or "highest of 2 published prices"; null when excluded. */
  basis: string | null;
  /** The records the amount is built from, lowest first. */
  records: EvidenceRecord[];
  /** Records left out: their evidence does not show their amount, or they price a different charge. */
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
  return otherFeeLabel(line, quote, amount) !== null;
}

/** The label on the record's amount that names a different fee (see quoteNamesOtherFee), or null. */
export function otherFeeLabel(line: string, quote: string, amount: number): string | null {
  const own = LINE_TESTS.find((t) => t.rule.key === line);
  const labels = amountLabels(quote, amount);
  if (!own || labels.length === 0) return null;
  const namesOwn = (label: string) =>
    !own.exclude.test(label) && (own.include.test(label) || own.words.some((word) => word.test(label)));
  const namesOther = (label: string) =>
    own.exclude.test(label) ||
    (!namesOwn(label) &&
      LINE_TESTS.some((t) => t.rule.key !== line && !t.rule.sourceKeys.some((key) => own.rule.sourceKeys.includes(key)) && t.include.test(label)));
  // A label naming no fee ("Free for customers aged 60+, otherwise $3") settles nothing: the
  // record fails when some label names another fee and none names its own.
  if (labels.some(namesOwn)) return null;
  return labels.find(namesOther) ?? null;
}

/**
 * Whether a label on the record's amount names the line's own fee and none names another
 * ("Overdraft Charge/Overdraft Fee (each item) | $36.00" on overdraft).
 */
export function quoteNamesOwnFee(line: string, quote: string, amount: number): boolean {
  const own = LINE_TESTS.find((t) => t.rule.key === line);
  if (!own) return false;
  const labels = amountLabels(quote, amount);
  return labels.some((label) => !own.exclude.test(label) && (own.include.test(label) || own.words.some((word) => word.test(label))));
}

/**
 * An optional feature sold beside a checking account, priced monthly: an add-on package, ATM
 * surcharge refunds, a rewards or perks package, identity protection or insurance. Its charge is
 * not the account's maintenance fee (First Commerce FCU's $2.99 "ATM Freedom add-on" for
 * unlimited surcharge refunds, beside its $3.99 Power Checking + CoverMe option). The identity,
 * insurance and package words are the category guard's own (fee-category-guard.ts v59), and the
 * refund words extend them; all of them are read in the fee's name. In the quoted line only an
 * add-on or optional feature that names itself counts (ADD_ON_IN_QUOTE): a premium account's
 * line often lists ATM refunds or identity protection among what the account itself includes,
 * and that account stays (the guard keeps "an account that comes with the insurance", 55988).
 */
export const ADD_ON_FEATURE =
  /\badd[- ]?ons?\b|\b(?:atm|surcharge)s?\b[^.|;]{0,30}\b(?:refunds?|rebates?|reimburse\w*)|\b(?:refunds?|rebates?|reimburse\w*)\b[^.|;]{0,30}\b(?:atm|surcharges?)\b|\bid\s*theft|\bidentity\s+(?:theft|protect|monitor|restor)|\baccidental death|\binsurance plan\b|\b(?:rewards?|perks?|benefits?) (?:package|bundle|upgrade)s?\b|\bpackage monthly fee|\boptional (?:feature|service|package|benefit)s?\b/i;

/**
 * An ATM withdrawal abroad (PNC's "$5.00 each at non-PNC Bank ATMs in all other countries",
 * Fifth Third's "International ATM Withdrawal: $5.00"). The out-of-network ATM line compares
 * domestic withdrawals; the fold rules file ATMs abroad under International ATM & Card
 * (fee-fold.ts, atm_international). A price for domestic and international ATMs together
 * ("ATMs inside United States & internationally") stays, as the fold rules keep it.
 */
export const INTERNATIONAL_ATM =
  /\b(?:international|internationally|intl|int['’]l|other countries|all other countries|foreign countr(?:y|ies)|outside (?:of )?(?:the )?(?:u\.?s\.?a?\b|united states|us\b|country)|abroad|overseas)/i;
/** An add-on or optional feature that names itself in the quoted line ("the ATM Freedom add-on"). */
export const ADD_ON_IN_QUOTE = /\badd[- ]?ons?\b|\boptional (?:feature|service|package|benefit)s?\b|\bpackage monthly fee/i;
const DOMESTIC_TOO = /\b(?:domestic|non[- ]?international|inside (?:the )?(?:u\.?s\.?|united states)|within (?:the )?(?:u\.?s\.?|united states)|in the (?:u\.?s\.?|united states)\b)/i;

/**
 * The quoted text that belongs to the record's amount: from the figure before it to the figure
 * after it, for each place the quote writes the amount; the whole quote when it writes no figure.
 */
export function amountWindow(quote: string, amount: number): string {
  const figures = [...quote.matchAll(FIGURE)];
  const parts: string[] = [];
  figures.forEach((match, index) => {
    if (Math.abs(Number(match[1].replace(/,/g, "")) - amount) >= 0.005) return;
    const prev = figures[index - 1];
    const next = figures[index + 1];
    const from = prev ? (prev.index ?? 0) + prev[0].length : 0;
    const to = next ? next.index ?? quote.length : quote.length;
    parts.push(quote.slice(from, to));
  });
  return parts.length > 0 ? parts.join(" … ") : quote;
}

/**
 * Whether the record prices a different charge than the line compares, read from its fee name and
 * the quoted text around its amount: an add-on on monthly maintenance, a withdrawal abroad on the
 * out-of-network ATM line. Null when it is in scope.
 */
export function scopeProblem(line: string, record: Pick<EvidenceRecord, "product" | "amount" | "quote">): EvidenceProblem | null {
  if (line === "monthly_maintenance") {
    return ADD_ON_FEATURE.test(record.product) || ADD_ON_IN_QUOTE.test(amountWindow(record.quote, record.amount)) ? "add_on_feature" : null;
  }
  if (line === "atm_non_network") {
    // The words labelling the amount, else the text around it ("International ATM Withdrawal: $5.00").
    const labels = amountLabels(record.quote, record.amount);
    const near = [record.product, ...(labels.length > 0 ? labels : [amountWindow(record.quote, record.amount)])];
    return near.some((text) => INTERNATIONAL_ATM.test(text) && !DOMESTIC_TOO.test(text)) ? "international_atm" : null;
  }
  return null;
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
  if (quoteNamesOtherFee(line, record.quote, record.amount)) return "quote_names_other_fee";
  // The evidence holds; the record may still price a different charge than the line compares.
  return scopeProblem(line, record);
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
      reason: null,
    };
    const problem = evidenceProblem(fee.line, record);
    return { ...record, problem, reason: problem ? problemReason(fee.line, problem, record) : null };
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

/** A left-out record's reason in words, from the record or, on older copies, its kind. */
export function reasonOf(record: Pick<EvidenceRecord, "problem" | "reason">): string {
  return record.reason ?? PROBLEM_REASON[record.problem ?? "quote_without_amount"];
}
