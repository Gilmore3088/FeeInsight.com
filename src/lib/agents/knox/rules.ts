import { CELL_SEPARATOR } from "@/lib/agents/rosetta/html-dom";
import { CANONICAL_KEY_MAP } from "@/lib/fee-taxonomy";

/**
 * Knox's deterministic extraction rules (`extract.rules`). Pure: text in, candidates out.
 *
 * Rosetta writes one fee per line, with table cells joined by " | ". Each line yields
 * either a fee Darwin can verify (an exact amount and a canonical hint) or a row held
 * for review: a $0/free fee, a range, a percentage, or a priced line no rule
 * recognizes. Held rows keep the evidence without sending Darwin anything it would
 * verify as an exact amount.
 */

const MAX_SEGMENTS_PER_DOCUMENT = 150;
const MAX_FEES_PER_DOCUMENT = 75;
const MAX_HELD_PER_DOCUMENT = 40;
const MAX_UNCLASSIFIED_PER_DOCUMENT = 10;
const MAX_SEGMENT_CHARS = 280;
const MIN_SEGMENT_CHARS = 8;
export const MAX_REASONABLE_FEE_AMOUNT = 2_500;

export interface ExtractedFeeCandidate {
  feeName: string;
  amount: number;
  frequency: string | null;
  canonicalHint: string;
  confidence: number;
  excerpt: string;
  /** The fee is waived under a condition stated on the same line. */
  waivable: boolean;
}

export type HeldShape = "zero" | "range" | "percentage" | "unclassified";

export interface HeldFeeCandidate {
  shape: HeldShape;
  feeName: string;
  /** 0 for a free fee, the low end of a range, null for a percentage. */
  amount: number | null;
  amountMax: number | null;
  percent: number | null;
  frequency: string | null;
  canonicalHint: string | null;
  excerpt: string;
}

export interface ExtractionRulesResult {
  candidates: ExtractedFeeCandidate[];
  held: HeldFeeCandidate[];
}

interface FeePattern {
  key: string;
  pattern: RegExp;
}

/**
 * First match wins, so the most specific patterns come first and the generic ones
 * (monthly maintenance, minimum balance) last. An overdraft "service charge" is an
 * overdraft fee, not monthly maintenance.
 */
export const FEE_PATTERNS: FeePattern[] = [
  { key: "continuous_od", pattern: /\b(continuous|sustained|extended).{0,30}\boverdraft\b/i },
  { key: "od_protection_transfer", pattern: /\b(overdraft protection|OD protection).{0,40}\btransfer\b/i },
  { key: "ach_return", pattern: /\bACH.{0,30}\b(return|returned)\b/i },
  { key: "deposited_item_return", pattern: /\b(deposited item return|returned deposited item|deposit(?:ed)? item returned|chargeback)\b/i },
  { key: "overdraft", pattern: /\boverdraft\b/i },
  { key: "nsf", pattern: /\b(NSF|non[-\s]?sufficient|insufficient funds|returned item)\b/i },
  {
    key: "atm_international",
    pattern: /\b(international|outside (?:the )?(?:U\.?S\.?|United States)).{0,30}\bATM\b|\bATM\b.{0,30}\b(international|outside (?:the )?(?:U\.?S\.?|United States))/i,
  },
  { key: "card_foreign_txn", pattern: /\b(foreign transaction|international transaction|currency conversion)\b/i },
  { key: "atm_non_network", pattern: /\b(ATM|non[-\s]?network|foreign ATM|out[-\s]?of[-\s]?network)\b/i },
  { key: "rush_card", pattern: /\b(rush|expedited).{0,30}\b(card|debit)\b/i },
  { key: "card_replacement", pattern: /\b(replacement|replace).{0,30}\b(card|debit|PIN)\b/i },
  { key: "wire_intl_outgoing", pattern: /\b(international|foreign).{0,40}\b(outgoing|send|sent).{0,40}\bwire\b|\b(outgoing|send|sent).{0,40}\b(international|foreign).{0,40}\bwire\b/i },
  { key: "wire_intl_incoming", pattern: /\b(international|foreign).{0,40}\b(incoming|receive|received).{0,40}\bwire\b|\b(incoming|receive|received).{0,40}\b(international|foreign).{0,40}\bwire\b/i },
  { key: "wire_domestic_outgoing", pattern: /\b(domestic)?\s*(outgoing|send|sent).{0,40}\bwire\b|\bwire\b.{0,30}\b(outgoing|sent)\b/i },
  { key: "wire_domestic_incoming", pattern: /\b(domestic)?\s*(incoming|receive|received).{0,40}\bwire\b|\bwire\b.{0,30}\b(incoming|received)\b/i },
  { key: "cashiers_check", pattern: /\b(cashier'?s check|official check|certified check)\b/i },
  { key: "money_order", pattern: /\bmoney order\b/i },
  { key: "stop_payment", pattern: /\bstop payment\b/i },
  { key: "check_printing", pattern: /\b(check printing|checks order|order checks)\b/i },
  { key: "check_image", pattern: /\b(check image|check copy|copy of check)\b/i },
  { key: "check_cashing", pattern: /\bcheck cashing\b/i },
  { key: "paper_statement", pattern: /\b(paper statement|statement copy|mailed statement)\b/i },
  { key: "estatement_fee", pattern: /\be[-\s]?statement\b/i },
  { key: "ach_origination", pattern: /\bACH.{0,30}\b(origination|batch)\b/i },
  { key: "bill_pay", pattern: /\bbill pay\b/i },
  { key: "mobile_deposit", pattern: /\bmobile deposit\b/i },
  { key: "coin_counting", pattern: /\bcoin (counting|processing)\b/i },
  { key: "cash_advance", pattern: /\bcash advance\b/i },
  { key: "night_deposit", pattern: /\bnight deposit\b/i },
  { key: "notary_fee", pattern: /\bnotary\b/i },
  { key: "safe_deposit_box", pattern: /\b(safe deposit|lock box|lost key|drill)\b/i },
  { key: "garnishment_levy", pattern: /\b(garnishment|levy)\b/i },
  { key: "legal_process", pattern: /\b(legal process|subpoena|court order|lien release)\b/i },
  { key: "account_verification", pattern: /\baccount verification\b/i },
  { key: "balance_inquiry", pattern: /\bbalance inquiry\b/i },
  { key: "late_payment", pattern: /\blate (payment|charge|fee)\b/i },
  { key: "loan_origination", pattern: /\bloan (origination|processing|extension|modification)\b/i },
  { key: "appraisal_fee", pattern: /\bappraisal\b/i },
  { key: "ira_administration", pattern: /\bIRA.{0,30}\b(administration|annual|maintenance)\b/i },
  { key: "ira_termination", pattern: /\bIRA.{0,30}\b(termination|closing|closure)\b/i },
  { key: "gift_card_purchase", pattern: /\bgift card\b/i },
  { key: "prepaid_card_reload", pattern: /\b(prepaid|reload).{0,30}\bcard\b/i },
  { key: "early_closure", pattern: /\b(early account closure|closed within|early closing)\b/i },
  { key: "dormant_account", pattern: /\b(dormant|inactive|escheat)\b/i },
  { key: "account_research", pattern: /\b(account research|research fee|reconciliation|account balancing)\b/i },
  {
    key: "monthly_maintenance",
    pattern: /\b(monthly (service|maintenance)|maintenance (fee|charge)|monthly (fee|charge)|account service (fee|charge)|service charge)\b/i,
  },
  { key: "minimum_balance", pattern: /\bminimum balance\b/i },
];

/**
 * A dollar amount. Thousands need a comma group (`$1,500.00`) or no separator at all
 * (`$1500`); the old pattern matched `$150` out of `$1500`.
 */
const AMOUNT_PATTERN = /\$\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)(?![\d.]*\d)/g;
const PERCENT_PATTERN = /(\d{1,2}(?:\.\d{1,3})?)\s*%/;
const RANGE_JOINER = /^\s*(?:-|–|—|to)\s*$/i;
const ZERO_CELL = /^(?:free|no charge|no fee|none|waived|n\/c|\$\s*0(?:\.00)?)$/i;
const NEGATIVE_FEE_LANGUAGE = /\b(no (?:[a-z]+ ){0,2}(?:fee|charge)s?|free|not charged|without charge)\b/i;
const WAIVER_LANGUAGE = /\bwaiv(?:e|ed|er|able)\b/i;
const GENERIC_SCHEDULE_LANGUAGE = /\b(schedule of fees|fee schedule|truth in savings|effective date|member fdic)\b/i;

interface AmountMatch {
  value: number;
  start: number;
  end: number;
}

function normalizeSegment(value: string): string {
  return value
    .replace(/[•*·]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/^[\s\-–—|:;,.]+/, "")
    .replace(/[\s|:;,\-–—]+$/, "")
    .replace(/\s*\.{2,}\s*$/, "")
    .trim();
}

function hasZeroCell(line: string): boolean {
  if (!line.includes(CELL_SEPARATOR)) return false;
  return line.split(CELL_SEPARATOR).slice(1).some((cell) => ZERO_CELL.test(cell.trim()));
}

function candidateSegments(text: string): string[] {
  const seen = new Set<string>();
  const segments: string[] = [];
  for (const rawLine of text.split(/\n+/)) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line.includes("$") && !PERCENT_PATTERN.test(line) && !hasZeroCell(line)) continue;
    const parts = line.length > MAX_SEGMENT_CHARS ? line.split(/\s{2,}|[.;]\s+/) : [line];
    for (const part of parts) {
      const segment = part.trim();
      if (segment.length < MIN_SEGMENT_CHARS || segment.length > MAX_SEGMENT_CHARS || seen.has(segment)) continue;
      seen.add(segment);
      segments.push(segment);
      if (segments.length >= MAX_SEGMENTS_PER_DOCUMENT) return segments;
    }
  }
  return segments;
}

export function classifyFeeText(value: string): string | null {
  const match = FEE_PATTERNS.find((entry) => entry.pattern.test(value));
  if (!match) return null;
  return CANONICAL_KEY_MAP[match.key] ?? null;
}

export function amountsIn(segment: string): AmountMatch[] {
  const matches: AmountMatch[] = [];
  for (const match of segment.matchAll(AMOUNT_PATTERN)) {
    const value = Number(match[1].replace(/,/g, ""));
    if (!Number.isFinite(value)) continue;
    const start = match.index ?? 0;
    matches.push({ value: Math.round(value * 100) / 100, start, end: start + match[0].length });
  }
  return matches;
}

function detectFrequency(segment: string): string | null {
  if (/\b(monthly|per month|\/month|each month|a month)\b/i.test(segment)) return "monthly";
  if (/\b(annual|annually|per year|yearly|\/year)\b/i.test(segment)) return "annual";
  if (/\b(per item|each item|per presentment|per check)\b/i.test(segment)) return "per_item";
  if (/\b(per transaction|each transaction|per withdrawal)\b/i.test(segment)) return "per_transaction";
  if (/\b(per day|daily)\b/i.test(segment)) return "daily";
  return null;
}

export function confidenceFor(segment: string): number {
  let confidence = 0.82;
  if (/\bfee\b/i.test(segment)) confidence += 0.06;
  if (/\bcharge\b/i.test(segment)) confidence += 0.03;
  if (segment.length <= 120) confidence += 0.03;
  return Math.min(confidence, 0.94);
}

function nameFrom(value: string): string {
  return normalizeSegment(value.replace(AMOUNT_PATTERN, " ")).slice(0, 120).trim();
}

function usableName(name: string): boolean {
  return name.length >= 3 && /[a-z]/i.test(name) && !/^\$/.test(name);
}

/** Rules for one line. Exported for tests. */
export function extractFromSegment(segment: string): ExtractionRulesResult {
  const result: ExtractionRulesResult = { candidates: [], held: [] };
  if (GENERIC_SCHEDULE_LANGUAGE.test(segment)) return result;

  const cells = segment.includes(CELL_SEPARATOR) ? segment.split(CELL_SEPARATOR).map((cell) => cell.trim()) : null;
  const amounts = amountsIn(segment);
  const frequency = detectFrequency(segment);
  const firstAmount = amounts[0];
  const prefix = firstAmount ? segment.slice(0, firstAmount.start) : segment;
  const name = usableName(nameFrom(prefix)) ? nameFrom(prefix) : nameFrom(segment);
  const hint = classifyFeeText(prefix) ?? classifyFeeText(segment);

  // A free fee, written as a "Free"/"No charge" cell or as $0.
  if (hint && cells && cells.length >= 2 && !firstAmount && cells.slice(1).some((cell) => ZERO_CELL.test(cell))) {
    const zeroName = nameFrom(cells[0]);
    if (usableName(zeroName)) {
      result.held.push({ shape: "zero", feeName: zeroName, amount: 0, amountMax: null, percent: null, frequency, canonicalHint: hint, excerpt: segment });
    }
    return result;
  }
  if (hint && firstAmount?.value === 0 && usableName(name)) {
    result.held.push({ shape: "zero", feeName: name, amount: 0, amountMax: null, percent: null, frequency, canonicalHint: hint, excerpt: segment });
    return result;
  }

  // A percentage fee ("3% of the transaction"), with or without a dollar minimum after it.
  const percent = segment.match(PERCENT_PATTERN);
  if (hint && percent && (!firstAmount || (percent.index ?? 0) < firstAmount.start) && usableName(name)) {
    result.held.push({
      shape: "percentage",
      feeName: nameFrom(segment.slice(0, percent.index ?? 0)) || name,
      amount: null,
      amountMax: null,
      percent: Number(percent[1]),
      frequency,
      canonicalHint: hint,
      excerpt: segment,
    });
    return result;
  }
  if (!firstAmount) return result;

  // "No fee with a $500 balance": the dollar figure is a condition, not a fee.
  if (NEGATIVE_FEE_LANGUAGE.test(prefix) || (NEGATIVE_FEE_LANGUAGE.test(segment) && !WAIVER_LANGUAGE.test(segment))) {
    return result;
  }

  // A waiver condition: only amounts before the waiver wording are fees.
  const waiver = segment.match(WAIVER_LANGUAGE);
  const waiverAt = waiver?.index ?? Number.POSITIVE_INFINITY;
  const feeAmounts = amounts.filter((amount) => amount.start < waiverAt);
  if (feeAmounts.length === 0) return result;
  const waivable = Number.isFinite(waiverAt);

  // A range ("$5 - $15"): kept for review with both ends.
  const second = feeAmounts[1];
  if (second && RANGE_JOINER.test(segment.slice(feeAmounts[0].end, second.start))) {
    if (usableName(name)) {
      result.held.push({
        shape: "range",
        feeName: name,
        amount: Math.min(feeAmounts[0].value, second.value),
        amountMax: Math.max(feeAmounts[0].value, second.value),
        percent: null,
        frequency,
        canonicalHint: hint,
        excerpt: segment,
      });
    }
    return result;
  }

  if (!hint) {
    if (/\b(fee|charge)s?\b/i.test(segment) && usableName(name) && feeAmounts[0].value <= MAX_REASONABLE_FEE_AMOUNT) {
      result.held.push({ shape: "unclassified", feeName: name, amount: feeAmounts[0].value, amountMax: null, percent: null, frequency, canonicalHint: null, excerpt: segment });
    }
    return result;
  }

  // The first amount belongs to the line's fee. A later amount is another fee only when
  // the words just before it name one ("Stop payment $30; Wire, outgoing $25"); otherwise
  // it is a cap, a second account column, or a condition, and is ignored.
  feeAmounts.forEach((amount, index) => {
    const chunk = index === 0 ? null : nameFrom(segment.slice(feeAmounts[index - 1].end, amount.start));
    const chunkHint = chunk ? classifyFeeText(chunk) : null;
    if (index > 0 && (!chunk || !usableName(chunk) || !chunkHint)) return;
    const feeName = index === 0 ? name : (chunk as string);
    const canonicalHint = index === 0 ? hint : (chunkHint as string);
    if (!usableName(feeName) || amount.value <= 0 || amount.value > MAX_REASONABLE_FEE_AMOUNT) return;
    if (segment.slice(amount.end, amount.end + 3).includes("%")) return;
    result.candidates.push({
      feeName,
      amount: amount.value,
      frequency,
      canonicalHint,
      confidence: confidenceFor(segment),
      excerpt: segment,
      waivable,
    });
  });
  return result;
}

export function extractCandidatesFromText(text: string): ExtractionRulesResult {
  const seen = new Set<string>();
  const result: ExtractionRulesResult = { candidates: [], held: [] };
  let unclassified = 0;
  for (const segment of candidateSegments(text)) {
    const found = extractFromSegment(segment);
    for (const candidate of found.candidates) {
      const key = `fee:${candidate.canonicalHint}:${candidate.feeName.toLowerCase()}:${candidate.amount}`;
      if (seen.has(key) || result.candidates.length >= MAX_FEES_PER_DOCUMENT) continue;
      seen.add(key);
      result.candidates.push(candidate);
    }
    for (const held of found.held) {
      const key = `held:${held.shape}:${held.feeName.toLowerCase()}:${held.amount}:${held.percent}`;
      if (seen.has(key) || result.held.length >= MAX_HELD_PER_DOCUMENT) continue;
      if (held.shape === "unclassified" && unclassified >= MAX_UNCLASSIFIED_PER_DOCUMENT) continue;
      seen.add(key);
      if (held.shape === "unclassified") unclassified += 1;
      result.held.push(held);
    }
  }
  return result;
}
