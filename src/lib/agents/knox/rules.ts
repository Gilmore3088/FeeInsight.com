import { CELL_SEPARATOR } from "@/lib/agents/rosetta/html-dom";
import { composableTail } from "@/lib/agents/knox/layout";
import { CANONICAL_KEY_MAP } from "@/lib/fee-taxonomy";

/**
 * Knox's deterministic extraction rules (`extract.rules`), pass 1. Pure: text in,
 * candidates out.
 *
 * Rosetta writes one fee per line, with table cells joined by " | ". Each line yields
 * either a fee Darwin can verify (an exact amount and a canonical hint) or a row held
 * for review: a $0/free fee, a range, a percentage, or a priced line no rule
 * recognizes. Held rows keep the evidence without sending Darwin anything it would
 * verify as an exact amount. Layouts the line rules cannot pair (a name on one line and
 * its price on the next, a PDF flattened to one long line) belong to the pass 2
 * specialists in `table-rows.ts` and `families.ts`.
 */

const MAX_SEGMENTS_PER_DOCUMENT = 150;
export const MAX_FEES_PER_DOCUMENT = 75;
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
  /** The specialist that found it, set when the free team's finds are merged. */
  strategy?: string;
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
 * overdraft fee, not monthly maintenance; a card replacement is not an ATM fee; a stop
 * payment on a cashier's check is a stop payment. Keys may be CANONICAL_KEY_MAP
 * synonyms (`fax_fee`, `returned_mail`), so every hint is an existing canonical key.
 *
 * v4 added the phrasings most often left unrecognized in a 150-text production sample:
 * courtesy pay, returned checks and payments, card-first replacements, lost cards and
 * PIN reissue, wires written "out" or "international outgoing", teller and bank checks,
 * counter checks, check copies, plural garnishments and levies, box sizes, fax,
 * returned mail, abandoned accounts, account-closure windows, club withdrawals,
 * skip-a-pay, Zelle, courier delivery and statement copies. A minimum-balance hint now
 * needs a fee word, so "Minimum balance to earn interest $25" is not a fee.
 *
 * v5 fixed the category mistakes found by scoring 26 Texas fee schedules against a
 * hand-built answer key: a copy of anything is a copy fee, money orders beat official
 * checks, "outside USA" wires are international, returned mail, fax, PIN-only and credit
 * card lines get no deposit-fee category, skip-a-pay and loan processing are lending
 * fees, and a price is named by the words nearest before it (never by words after it).
 */
export const FEE_PATTERNS: FeePattern[] = [
  // A copy of something is a copy fee, whatever it copies ("Photocopy of paid item",
  // "Reproduction of cashier's checks", "ATM card supporting documents photocopy").
  {
    key: "check_image",
    pattern: /\b(?:photo|fax )?cop(?:y|ies)\b.{0,20}\b(?:paid |cancell?ed |cleared )?(?:checks?|drafts?|items?)\b|\b(?:check|draft)s?\b[\s/()a-z]{0,12}\b(?:photo)?cop(?:y|ies)\b/i,
  },
  { key: "document_reproduction", pattern: /\b(?:reproduction|supporting documents?)\b/i },
  // A box size with three dimensions ("3"X10"X 21"") is a safe deposit box anywhere on the line.
  { key: "safe_deposit_box", pattern: /\b\d{1,2}\s?["”]?\s?[x×]\s?\d{1,2}\s?["”]?\s?[x×]\s?\d{1,2}\b/i },
  { key: "card_dispute", pattern: /\b(?:card|transaction) disputes?\b|\b(?:debit|credit|card)\b.{0,15}\bchargebacks?\b/i },
  {
    key: "continuous_od",
    pattern: /\b(continuous|sustained|extended|daily).{0,30}\boverdraft\b|\bdays? in overdraft\b|\boverdraft\b.{0,20}\b(continuous|sustained|extended)\b/i,
  },
  {
    key: "od_protection_transfer",
    pattern: /\b(overdraft protection|OD protection).{0,40}\b(transfer|from (savings|shares?))\b|\b(overdraft|OD)\b.{0,15}\b(transfer|sweep|from (savings|shares?))\b|^\W*overdraft protection\W*(?:\([^)]*\))?\W*$/i,
  },
  { key: "ach_return", pattern: /\bACH.{0,30}\b(return|returned)\b/i },
  {
    key: "deposited_item_return",
    pattern: /\b(deposited items? return(ed)?|returned deposit(ed)?|deposit(ed)? (items?|checks?) return(ed)?|return(ed)? deposit(ed)? (items?|checks?)|return(ed)? (check|item) deposits?|deposit return|third[- ]party return(ed)? items?|charge[- ]?backs?)\b/i,
  },
  { key: "overdraft", pattern: /\b(overdraft|courtesy pay|bounce(d)? (check )?protection)\b/i },
  {
    key: "nsf",
    pattern: /\b(NSF|non[-\s]?sufficient|insufficient funds|return(ed)? (checks?|items?|ach|drafts?))\b/i,
  },
  {
    key: "rush_card",
    pattern: /\b(rush|expedit\w*|overnight)\b.{0,30}\b(cards?|debit)\b|\b(cards?|debit)\b.{0,30}\b(rush|expedit\w*|overnight)\b/i,
  },
  {
    key: "card_replacement",
    pattern: /\b(replacement|replace|reissue|re-issue|lost|stolen)\b.{0,30}\b(cards?|debit)\b|\bcards?\b.{0,20}\b(replacement|replace|reissue|re-issue)\b/i,
  },
  {
    key: "atm_international",
    pattern: /\b(international|outside (?:the )?(?:U\.?S\.?|United States)).{0,30}\bATM\b|\bATM\b.{0,30}\b(international|outside (?:the )?(?:U\.?S\.?|United States))/i,
  },
  { key: "card_foreign_txn", pattern: /\b(foreign transaction|international transaction|currency conversion)\b/i },
  { key: "atm_non_network", pattern: /\b(ATM|non[-\s]?network|foreign ATM|out[-\s]?of[-\s]?network)\b/i },
  {
    key: "wire_intl_outgoing",
    pattern: /\b(international|foreign).{0,40}\b(outgoing|send|sent).{0,40}\bwire\b|\b(outgoing|send|sent).{0,40}\b(international|foreign).{0,40}\bwire\b|\bwires?\b.{0,40}\b(international|foreign|intl)\b.{0,20}\b(outgoing|out|sent|send)\b|\bwires?\b.{0,30}\b(outgoing|out)\b.{0,20}\b(international|foreign|intl)\b|\b(outgoing|send|sent)\b.{0,10}\bwires?\b.{0,30}\b(international|foreign|intl)\b/i,
  },
  {
    key: "wire_intl_incoming",
    pattern: /\b(international|foreign).{0,40}\b(incoming|receive|received).{0,40}\bwire\b|\b(incoming|receive|received).{0,40}\b(international|foreign).{0,40}\bwire\b|\bwires?\b.{0,40}\b(international|foreign|intl)\b.{0,20}\b(incoming|in|received)\b|\bwires?\b.{0,30}\b(incoming|in)\b.{0,20}\b(international|foreign|intl)\b|\b(incoming|receive|received)\b.{0,10}\bwires?\b.{0,30}\b(international|foreign|intl)\b/i,
  },
  {
    key: "wire_domestic_outgoing",
    pattern: /\b(domestic)?\s*(outgoing|send|sent).{0,40}\bwire\b|\bwires?\b.{0,30}\b(outgoing|sent|out)\b/i,
  },
  {
    key: "wire_domestic_incoming",
    pattern: /\b(domestic)?\s*(incoming|receive|received).{0,40}\bwire\b|\bwires?\b.{0,30}\b(incoming|received)\b/i,
  },
  { key: "stop_payment", pattern: /\bstop payments?\b/i },
  { key: "money_order", pattern: /\bmoney orders?\b/i },
  {
    key: "cashiers_check",
    pattern: /\b(cashier'?s?\s+checks?|official checks?|certified checks?|bank checks?|teller'?s?\s+checks?|corporate checks?|treasurer'?s?\s+checks?)\b/i,
  },
  { key: "counter_check", pattern: /\b(counter|temporary|starter) checks?\b/i },
  { key: "check_printing", pattern: /\b(check printing|checks order|order checks)\b/i },
  {
    key: "check_image",
    pattern: /\b(check image|check cop(y|ies)|cop(y|ies) of (a |paid |cancell?ed |cleared )?checks?|photocop(y|ies) of (a )?checks?|image of (a )?check)\b/i,
  },
  { key: "check_cashing", pattern: /\b(check cashing|cashing (on-us |an? )?checks?)\b/i },
  { key: "paper_statement", pattern: /\b(paper|mailed|printed) statements?\b/i },
  {
    key: "document_reproduction",
    pattern: /\b(statement cop(y|ies)|cop(y|ies) of (a )?statements?|duplicate statements?|statement reprints?|interim statements?|photocop(y|ies))\b/i,
  },
  { key: "estatement_fee", pattern: /\be[-\s]?statement\b/i },
  { key: "ach_origination", pattern: /\bACH.{0,30}\b(origination|batch)\b/i },
  { key: "bill_pay", pattern: /\bbill ?pay(ments?)?\b/i },
  { key: "mobile_deposit", pattern: /\bmobile deposit\b/i },
  { key: "zelle_fee", pattern: /\bzelle\b/i },
  { key: "coin_counting", pattern: /\bcoin (counting|processing)\b/i },
  { key: "cash_advance", pattern: /\bcash advance\b/i },
  { key: "night_deposit", pattern: /\b(night deposit|night depository|deposit bags?|zipper bags?)\b/i },
  { key: "courier_delivery", pattern: /\b(courier|fed ?ex|overnight (mail|delivery))\b/i },
  { key: "notary_fee", pattern: /\bnotary\b/i },
  {
    key: "safe_deposit_box",
    pattern: /\b(safe deposit|lock box|lost key|key replacement|replacement key|drill\w*)\b|^\W*(?:size:?\s*|box\s+|rental for\s+)?\d{1,2}\s?["”]?\s?[x×]\s?\d{1,2}\b/i,
  },
  { key: "garnishment_levy", pattern: /\b(garnish\w*|levy|levies|attachments?)\b/i },
  { key: "vehicle_title", pattern: /\btitle\b.{0,20}\blien\b|\blien\b.{0,20}\btitle\b|\bvehicle title\b/i },
  { key: "mortgage_lien_release", pattern: /\blien release|\brelease of (?:real estate |mortgage )?liens?\b/i },
  { key: "legal_process", pattern: /\b(legal process|subpoena|court order)\b/i },
  { key: "subordination", pattern: /\bsubordination\b/i },
  { key: "other_lending_fee", pattern: /\bloan application\b/i },
  { key: "account_verification", pattern: /\b(account verification|verification of (deposit|account)s?)\b/i },
  { key: "balance_inquiry", pattern: /\bbalance inquiry\b/i },
  { key: "mortgage_modification", pattern: /\bloan modification\b/i },
  { key: "other_lending_fee", pattern: /\bskip[- ]a[- ]pay(ment)?\b|\bloan (processing|extension)\b/i },
  { key: "late_payment", pattern: /\blate (payment|charge|fee)\b/i },
  { key: "loan_origination", pattern: /\bloan origination\b/i },
  { key: "appraisal_fee", pattern: /\bappraisal\b/i },
  { key: "ira_administration", pattern: /\bIRA.{0,30}\b(administration|annual|maintenance)\b/i },
  { key: "ira_termination", pattern: /\bIRA.{0,30}\b(termination|closing|closure|transfer)\b/i },
  { key: "gift_card_purchase", pattern: /\bgift cards?\b/i },
  { key: "prepaid_card_reload", pattern: /\bprepaid\b.{0,30}\bcard\b|\bcard\b.{0,15}\breload(?:s|ing)?\b|\breload(?:s|ing)? (?:fee|a card)\b/i },
  {
    key: "early_closure",
    pattern: /\b(early account closure|closed within|early closing)\b|\baccount clos(ed|ure|ing)\b.{0,40}\b(within|prior to|before|less than)\b|\bclub\b.{0,30}\bearly withdrawal\b/i,
  },
  { key: "dormant_account", pattern: /\b(dormant|inactive|escheat\w*|abandoned)\b/i },
  { key: "account_research", pattern: /\b(account research|research fee|reconciliation|account balancing)\b/i },
  {
    key: "monthly_maintenance",
    pattern: /\b(monthly (service|maintenance)|maintenance (fee|charge)|monthly (fee|charge)|account service (fee|charge)|service charge)\b/i,
  },
  { key: "minimum_balance", pattern: /\b(minimum balance|low balance|fall[- ]below)\b.{0,30}\b(fee|charge)\b/i },
];

/**
 * A dollar amount. Thousands need a comma group (`$1,500.00`) or no separator at all
 * (`$1500`); the old pattern matched `$150` out of `$1500`.
 */
export const AMOUNT_PATTERN = /\$\s*(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?|\.\d{2})(?![\d.]*\d)/g;
const PERCENT_PATTERN = /(\d{1,2}(?:\.\d{1,3})?)\s*%/;
export const RANGE_JOINER = /^\s*(?:-|–|—|to)\s*$/i;
export const ZERO_CELL = /^(?:free|no charge|no fee|none|waived|n\/c|\$\s*0(?:\.00)?)$/i;
const NEGATIVE_FEE_LANGUAGE = /\b(no (?:[a-z]+ ){0,2}(?:fee|charge)s?|free|not charged|without charge)\b/i;
export const WAIVER_LANGUAGE = /\bwaiv(?:e|ed|er|able)\b/i;
export const GENERIC_SCHEDULE_LANGUAGE = /\b(schedule of fees|fee schedule|truth in savings|effective date|member fdic)\b/i;
/**
 * Words just before an amount that make it a condition, not a price: a balance
 * threshold ("below $500"), a cap ("maximum of $175"), a rate base ("per $1,000").
 */
const CONDITION_BEFORE =
  /\b(below|above|over|under|less than|more than|greater than|at least|minimum(?: daily| average)?(?: balance| deposit)?(?: of)?|min\.?|maximum(?: fee)?(?: of)?|max\.?(?: fee)?|up to|exceeds?|exceeding|in excess of|negative|balances? of|deposits? of|totaling|first|cap of|limit of|between|per|and|or)\s*[-–(]?\s*$/i;
/** Words just after an amount that make it a threshold: "$500 or more". */
const CONDITION_AFTER = /^(?:\+|\s*(?:or more|and more|or less|and less|or higher|or greater|or above|and above|and up|and over|minimum|min\b|balance|in (?:deposits|balances)|on deposit))/i;

export interface AmountMatch {
  value: number;
  start: number;
  end: number;
}

export function normalizeSegment(value: string): string {
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

/** The FEE_PATTERNS key a fee name matches, before mapping to its canonical key. */
export function classifyPatternKey(value: string): string | null {
  // PDFs usually render the apostrophe in "Cashier's check" as a curly quote. A waiver
  // clause names other services ("(waived if enrolled in Mobile Deposit)"), never the fee.
  const text = value
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/\((?:[^()]*\bwaiv)[^()]*\)?/gi, " ")
    .replace(/\boutside (?:of )?(?:the )?(?:USA|U\.S\.A?\.?|US|United States)\b/gi, "international");
  const key = FEE_PATTERNS.find((entry) => entry.pattern.test(text))?.key ?? null;
  // Credit card fees are lending fees, not deposit-account card fees.
  if ((key === "card_replacement" || key === "rush_card") && /\bcredit cards?\b/i.test(text)) return null;
  // A book transfer inside the bank is not a wire.
  if (key?.startsWith("wire_") && /\bbook transfer\b/i.test(text)) return null;
  // Reopening a closed account is not an early-closure fee.
  if (key === "early_closure" && /\bre-?open/i.test(text)) return null;
  // "Overdrafts initiated by debit card will be declined at no cost" describes a decline,
  // not an overdraft fee.
  if (key === "overdraft" && /\bdeclin(?:e|ed|es)\b/i.test(text)) return null;
  // A PIN reissue is not a card replacement.
  if (key === "card_replacement" && /\bPIN\b/i.test(text)) return null;
  // What a non-member pays at this bank's own ATM is not a member's out-of-network fee.
  if (key === "atm_non_network" && /\bnon[-\s]?(?:member|customer)s?\b/i.test(text)) return null;
  // A card, loan or service's own monthly charge is not the account's maintenance fee.
  if (key === "monthly_maintenance" && /\b(cards?|loans?|bill ?pay|EDI|safe deposit|box)\b/i.test(text)) return null;
  return key;
}

/**
 * The fee a price belongs to is named right before it. In a flattened table row
 * ("STOP PAYMENT ORDER | NOTARY FEE | $6.00") the nearest cell names it, so cells are
 * tried nearest first, widening only when the nearest ones name no fee on their own
 * ("Wire Transfers | Outgoing Domestic | $25").
 */
export function nearestFeeText(prefix: string): string {
  const cells = prefix.split(CELL_SEPARATOR).filter((cell) => /[a-z]{3,}/i.test(cell));
  for (let start = cells.length - 1; start >= 0; start -= 1) {
    const text = cells.slice(start).join(CELL_SEPARATOR);
    // A cell that names a fee of its own owns the price, even when no rule knows it.
    if (classifyFeeText(text) || !composableTail(normalizeSegment(cells[start]))) return text;
  }
  return cells.join(CELL_SEPARATOR);
}

export function classifyNearest(prefix: string): string | null {
  return classifyFeeText(nearestFeeText(prefix));
}

export function classifyFeeText(value: string): string | null {
  const key = classifyPatternKey(value);
  return key ? CANONICAL_KEY_MAP[key] ?? null : null;
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

/** True when the amount at [start, end) is a threshold, cap or rate base, not a price. */
export function isConditionAmount(text: string, amount: Pick<AmountMatch, "start" | "end">): boolean {
  return CONDITION_BEFORE.test(text.slice(Math.max(0, amount.start - 40), amount.start)) ||
    CONDITION_AFTER.test(text.slice(amount.end, amount.end + 30));
}

export function detectFrequency(segment: string): string | null {
  if (/\b(monthly|per month|each month|a month)\b|\/\s*(month|mo)\b/i.test(segment)) return "monthly";
  if (/\b(annual|annually|per year|yearly|a year)\b|\/\s*(year|yr)\b/i.test(segment)) return "annual";
  if (/\b(per item|each item|per presentment|per check)\b|\/\s*(item|presentment|check)\b/i.test(segment)) return "per_item";
  if (/\b(per transaction|each transaction|per withdrawal)\b|\/\s*transaction\b/i.test(segment)) return "per_transaction";
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

export function nameFrom(value: string): string {
  return normalizeSegment(value.replace(AMOUNT_PATTERN, " ")).slice(0, 120).trim();
}

export function usableName(name: string): boolean {
  return name.length >= 3 && /[a-z]/i.test(name) && !/^\$/.test(name);
}

/** "$5.00 Monthly fee for paper statements": the words after an opening price name it only when they say it is a fee ("$5 gift cards" is a gift card worth $5). */
function priceFirstHint(after: string): string | null {
  // A price that ends its table cell ("... $1 | Overdraft Charge ....... $35") belongs
  // to the cell before it, never to the next cell's fee.
  if (after.includes(CELL_SEPARATOR.trim())) return null;
  return /\b(fee|charge|cost)s?\b/i.test(after) ? classifyFeeText(after) : null;
}

/**
 * "CUTX-owned or network ATM: No charge": a free ATM in the bank's own network is not a
 * $0 out-of-network ATM fee.
 */
export function ownNetworkAtm(hint: string, name: string): boolean {
  return hint === "atm_non_network" && !/\b(non[-\s]?\w+|foreign|other|out[-\s]?of[-\s]?network|surcharge)\b/i.test(name);
}

/**
 * A free row that is really an allowance ("Stop payments, two per year: Free") or a
 * free in-network ATM is not a $0 price for the fee.
 */
export function notAZeroPrice(hint: string, name: string): boolean {
  return ownNetworkAtm(hint, name) ||
    /\b(?:one|two|three|four|five|six|first|\d+)\b(?: free)?\s*(?:per|a|each)\s+(?:year|month|statement|cycle)\b/i.test(name);
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
  // Words after the price belong to the next fee, so they classify a line only when it
  // opens with its price ("$5.00 Monthly fee for paper statements").
  const priceFirst = firstAmount != null && !/[a-z]/i.test(prefix);
  let hint = firstAmount
    ? classifyNearest(prefix) ?? (priceFirst ? priceFirstHint(segment.slice(firstAmount.end, amounts[1]?.start ?? segment.length)) : null)
    : classifyFeeText(cells ? cells[0] : segment);

  // A free fee, written as a "Free"/"No charge" cell or as $0.
  if (hint && cells && cells.length >= 2 && !firstAmount && cells.slice(1).some((cell) => ZERO_CELL.test(cell)) && !notAZeroPrice(hint, cells[0])) {
    const zeroName = nameFrom(cells[0]);
    if (usableName(zeroName)) {
      result.held.push({ shape: "zero", feeName: zeroName, amount: 0, amountMax: null, percent: null, frequency, canonicalHint: hint, excerpt: segment });
    }
    return result;
  }
  if (hint && firstAmount?.value === 0 && usableName(name) && !notAZeroPrice(hint, name)) {
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

  // "$20.00 Wire Agreement Fee ......": in a dot-leader schedule split across lines, a
  // price that opens the line belongs to the name on the line above (pass 2 pairs it).
  if (!cells && !/[a-z]/i.test(prefix) && /(?:\.\s?){3,}\s*$|…\s*$/.test(segment)) return result;

  // "No fee with a $500 balance": the dollar figure is a condition, not a fee.
  if (NEGATIVE_FEE_LANGUAGE.test(prefix) || (NEGATIVE_FEE_LANGUAGE.test(segment) && !WAIVER_LANGUAGE.test(segment))) {
    return result;
  }

  // A waiver condition: only amounts before the waiver wording are fees. Thresholds
  // ("for balances below $2,500 ... $10") are conditions, never the fee.
  const waiver = segment.match(WAIVER_LANGUAGE);
  const waiverAt = waiver?.index ?? Number.POSITIVE_INFINITY;
  // "Overdraft Items - Negative from $50.01 and more | $35": when a later cell holds a
  // price, dollar figures in the first (label) cell are tiers or thresholds, never the fee.
  // The next cell must be a price cell ("$35", "$200+ attorney fees"), not another fee.
  const priceCell = cells?.[1] ?? "";
  const labelEnd = cells && /^\$\s?\d/.test(priceCell) && nameFrom(priceCell).split(" ").filter(Boolean).length <= 3
    ? segment.indexOf(CELL_SEPARATOR)
    : -1;
  const pricedLater = labelEnd >= 0 && amounts.some((amount) => amount.start > labelEnd && !isConditionAmount(segment, amount));
  // A label figure followed by another fee's name ("Copy $2.00 Lien Release fee | $35")
  // is the earlier fee's own price, from two rows run together.
  const namesNextFee = (amount: AmountMatch) => {
    const tail = nameFrom(segment.slice(amount.end, labelEnd));
    return usableName(tail) && tail.split(" ").length >= 2 && /\b(fee|charge)s?\b/i.test(tail) && classifyFeeText(tail) != null;
  };
  // "ACH Origination ...... $15.00 | $700": the label's only figure, ending it (or followed
  // only by how often it is charged), is the label's own price. "$25.01 to $50" is a tier.
  const endsLabel = (amount: AmountMatch) =>
    amounts.filter((other) => other.start < labelEnd).length === 1 &&
    /^\s*(?:\/?\s*(?:mo|month|monthly|each|ea|item|year|yr|annually|per \w+))?\.?\s*$/i.test(segment.slice(amount.end, labelEnd));
  const inLabel = (amount: AmountMatch) =>
    pricedLater && amount.start < labelEnd && !namesNextFee(amount) && !endsLabel(amount);
  const feeAmounts = amounts.filter((amount) => amount.start < waiverAt && !inLabel(amount) && !isConditionAmount(segment, amount));
  if (feeAmounts.length === 0) return result;
  const waivable = Number.isFinite(waiverAt);
  let feeName = usableName(nameFrom(segment.slice(0, feeAmounts[0].start))) ? nameFrom(segment.slice(0, feeAmounts[0].start)) : name;
  // A tiered label keeps its figures, so "$25 or less" and "$50.01 and more" stay apart,
  // and the whole label names the fee when the words before its first figure do not.
  if (cells && amounts.some(inLabel) && usableName(normalizeSegment(cells[0]))) {
    feeName = normalizeSegment(cells[0]).slice(0, 120);
    hint = classifyFeeText(feeName) ?? hint;
  }
  // "Late Payment Up to $29 ... Rush Card Replacement $25": when a condition amount comes
  // before the price and the words after it name a fee of their own, the price is theirs.
  const skipped = amounts.filter((amount) => amount.end <= feeAmounts[0].start && !inLabel(amount)).at(-1);
  if (skipped) {
    const tail = nameFrom(segment.slice(skipped.end, feeAmounts[0].start));
    const tailHint = usableName(tail) && tail.split(" ").length >= 2 ? classifyFeeText(tail) : null;
    if (tailHint) {
      feeName = tail;
      hint = tailHint;
    }
  }

  // A range ("$5 - $15"): kept for review with both ends.
  const second = feeAmounts[1];
  if (second && RANGE_JOINER.test(segment.slice(feeAmounts[0].end, second.start))) {
    if (usableName(feeName)) {
      result.held.push({
        shape: "range",
        feeName,
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
    if (/\b(fee|charge)s?\b/i.test(segment) && usableName(feeName) && feeAmounts[0].value <= MAX_REASONABLE_FEE_AMOUNT) {
      result.held.push({ shape: "unclassified", feeName, amount: feeAmounts[0].value, amountMax: null, percent: null, frequency, canonicalHint: null, excerpt: segment });
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
    const candidateName = index === 0 ? feeName : (chunk as string);
    const canonicalHint = index === 0 ? hint : (chunkHint as string);
    if (!usableName(candidateName) || amount.value <= 0 || amount.value > MAX_REASONABLE_FEE_AMOUNT) return;
    if (segment.slice(amount.end, amount.end + 3).includes("%")) return;
    result.candidates.push({
      feeName: candidateName,
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
