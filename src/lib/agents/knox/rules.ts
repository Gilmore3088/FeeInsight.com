import { CELL_SEPARATOR } from "@/lib/agents/rosetta/html-dom";
import { composableTail, passesDarwinChecks, titleTail } from "@/lib/agents/knox/layout";
import type { AccountLineup } from "@/lib/agents/knox/lineup";
import { CANONICAL_KEY_MAP } from "@/lib/fee-taxonomy";
import { stripPriceFootnoteMarks } from "@/lib/custom-report/source-check";

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
  /** Monthly maintenance only: the account's name, thresholds and waiver (`lineup.ts`). */
  lineup?: AccountLineup | null;
}

/** `untraced`: a read whose name and price don't trace to one row of the text (Knox's self-check). */
export type HeldShape = "zero" | "range" | "percentage" | "unclassified" | "untraced";

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

/** v34: a price change the bank says it made ("We've lowered ... fees from", "... were reduced from"). */
const FEE_CHANGED_FROM = /\b(?:lowered|reduced|decreased|raised|increased|changed)\s+(?:[\w-]+\s+){0,8}?from\s*$|\b(?:lowered|reduced|decreased|raised|increased|changed)\s+from\s*$/i;
const FUTURE_CHANGE = /\b(?:will|effective|beginning|starting|as of|going forward)\b/i;

/** "We've lowered Overdraft Paid Item fees from" -> "Overdraft Paid Item fees". */
export function changedFeeName(name: string): string {
  return name
    .replace(/^(?:we(?:'ve|\u2019ve| have)?|[a-z]+ bank has)\s+(?:lowered|reduced|decreased|raised|increased|changed)\s+/i, "")
    .replace(/\s+(?:(?:were|was|have been|has been)\s+)?(?:lowered|reduced|decreased|raised|increased|changed)?\s*from\s*$/i, "")
    .replace(/^([a-z])/, (first) => first.toUpperCase())
    .trim();
}

const BALANCE_REQUIREMENT = /\bbalance (?:requirement|required)\b|\brequired (?:minimum |daily |average )*balance\b/i;

interface FeePattern {
  key: string;
  pattern: RegExp;
}

/**
 * v26: the held groups James folded into existing categories (decision card, Oct 7 2026:
 * "Fold into existing"; anything beyond the ~50 tracked categories is not worth its own).
 * Each maps to the category the taxonomy already gives the fee (returned mail, fax and
 * excess-activity fees -> account research; collection items and foreign checks -> check
 * cashing; loan cancellation, credit reports and UCC filings -> loan origination, as the keys
 * file them; loan refinancing and document fees -> other lending). Returned statements stay
 * held: the keys file them as paper statements, a featured fee they would skew. The hand-checked answer keys file these
 * lines as "unmapped", so the gate re-files them with `foldedCategory` (answer-key-gate.ts).
 * Kept last in FEE_PATTERNS, so they only claim lines no other rule recognizes. Membership,
 * phone transfers, credit card and uncollected-funds fees have no right home and stay held.
 */
export const FOLDED_PATTERNS: FeePattern[] = [
  {
    key: "account_research",
    pattern:
      /\b(?:return(?:ed)?|undeliverable|bad|invalid|incorrect|wrong) (?:mail|address)\b|\baddress (?:correction|search|locat\w*)\b|\b(?:member |account holder )?locator fee\b|^(?![\s\S]*\btransfers?\b)[\s\S]*\bfax(?:es|ing)?\b/i,
  },
  {
    key: "account_research",
    pattern:
      /\bexcess(?:ive)? (?:withdrawals?|transactions?|activity|debits?|transfers?)\b|\bwithdrawal limit fee\b|\b(?:withdrawals?|transactions?) in excess of\b/i,
  },
  {
    key: "check_cashing",
    // A collection fee on a charged-off or past-due account, or a collection phone call,
    // is debt collection, not a check sent for collection (v30, from prod's first v26 pass).
    pattern:
      /^(?![\s\S]*\b(?:charged[- ]?off|past[- ]due|delinquen\w*|calls?)\b)[\s\S]*?\b(?:collection items?|items? (?:sent )?for collection|(?:outgoing |incoming )?(?:foreign|canadian|international) (?:check|item|draft)s?\b.{0,25}\bcollection|collection (?:fee|charge)s?|(?:foreign|canadian) (?:check|item)s?\b.{0,20}\b(?:fee|charge|processing|deposit))/i,
  },
  {
    key: "loan_origination",
    pattern: /\bloan cancell?ation\b|\bcredit report fee\b(?!.{0,20}\bopen)|\bUCC (?:filing|release|lien)\b|\buniform commercial code\b/i,
  },
  {
    key: "other_lending_fee",
    pattern: /\bloan (?:refinanc\w*|document(?:ation)? (?:prep\w*|fee))\b/i,
  },
];

/** The folded category for a line no earlier rule names, or null. */
export function foldedCategory(text: string): string | null {
  return FOLDED_PATTERNS.find((entry) => entry.pattern.test(text))?.key ?? null;
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
  // v25: so is a two-dimension size in inches ("OVERDRAFT AND NSF FEES 10.5x10.5 Inch", a box
  // row under the next section's heading in a one-line schedule).
  { key: "safe_deposit_box", pattern: /\b\d{1,2}(?:\.\d)?\s?["”]?\s?[x×]\s?\d{1,2}(?:\.\d)?\s?(?:["”]|inch(?:es)?\b)/i },
  { key: "card_dispute", pattern: /\b(?:card|transaction) disputes?\b|\b(?:debit|credit|card)\b.{0,15}\bchargebacks?\b/i },
  // v22: "Maximum daily Overdraft or Returned Item fees ..... $140.00" is the daily cap.
  { key: "od_daily_cap", pattern: /\b(?:maximum|max\.?)\s+daily\s+overdraft\b/i },
  {
    key: "continuous_od",
    // v33: "Consecutive Overdraft Daily Fee" (Wilson Bank & Trust).
    // v39: the "OD" abbreviation too ("Continued OD Charge", "Consecutive Day OD Fee").
    pattern: /\b(continuous|continued|sustained|extended|consecutive|daily).{0,30}\b(?:overdrafts?|OD|O\/D)\b|\bdays? in overdraft\b|\boverdrafts?\b.{0,20}\b(continuous|sustained|extended)\b/i,
  },
  {
    key: "od_protection_transfer",
    pattern: /\b(overdraft protection|OD protection).{0,40}\b(transfer|from (savings|shares?))\b|\b(overdraft|OD)\b.{0,15}\b(transfer|sweep|from (savings|shares?))\b|^\W*overdraft protection\W*(?:\([^)]*\))?\W*$|\b(?:insufficient|non[-\s]?sufficient) funds? transfers?\b|\b(?:account|savings|deposit)[-\s]link(?:ed)?\b.{0,25}\boverdraft protection\b|\blinked (?:account|savings)\b.{0,25}\boverdraft protection\b/i,
  },
  { key: "ach_return", pattern: /\bACH.{0,30}\b(return|returned)\b/i },
  {
    key: "deposited_item_return",
    pattern: /\b(deposited items? return(ed)?|returned deposit(ed)?|deposit(ed)? (items?|checks?) return(ed)?|deposited checks? \([^)]{0,30}\) return(ed)?|return(ed)? deposit(ed)? (items?|checks?)|return(ed)? (check|item) deposits?|deposit return|third[- ]party return(ed)? items?|charge[- ]?backs?)\b/i,
  },
  // v19: "Overdrafts Paid", "Overdrafts (OD)": the plural names the fee when it opens the
  // name or the fee follows it. Elsewhere ("transfer to cover overdrafts", "overdrafts up
  // to a total of $500") it describes another fee or a limit.
  // v39: "OD Privilege", "OD Item Fee": the abbreviation followed by the fee's own word
  // (GreenState's schedule; the line read as no fee at all).
  // v40: "Paid Item Fee" (Northeast Bank) is the fee for an item paid into overdraft. A
  // combined "NSF paid item fee/NSF returned item fee" stays with NSF.
  {
    key: "overdraft",
    pattern: /\b(overdraft|courtesy pay|privilege pay|bounce(d)? (check )?protection)\b|\boverdrawing\b|^\W*overdrafts\b|\boverdrafts\s+(?:paid|fees?\b|charges?\b|\((?:OD|per item)\))|\b(?:OD|O\/D)\s+(?:privilege|items?|fees?|paid|charges?)\b|\bpaid items?\s+(?:fees?|charges?)\b(?!\s*\/)/i,
  },
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
    pattern: /\b(international|outside (?:the )?(?:U\.?S\.?|United States)).{0,30}\bATMs?\b|\bATMs?\b.{0,30}\b(international|outside (?:the )?(?:U\.?S\.?|United States))/i,
  },
  // v21: plural "Foreign Transactions" (a bare "(international transactions)" is often a
  // neighbouring column's note), and the other names banks give the card's
  // currency fee ("International Point of Sale Fee", "Cross-Border", "International Service
  // Assessment", "Multi currency"). Buying foreign cash ("Foreign Currency Order") stays out.
  {
    key: "card_foreign_txn",
    pattern: /\b(foreign transactions?|international (?:transaction\b|purchases?|point of sale|pos|currency fee|service (?:assessment|fee))|currency conversion|cross[- ]border|(?:multi(?:ple)?|single)[- ]currency)\b/i,
  },
  { key: "atm_non_network", pattern: /\b(ATM|non[-\s]?network|foreign ATM|out[-\s]?of[-\s]?network)\b/i },
  {
    key: "wire_intl_outgoing",
    pattern: /\b(international|foreign).{0,40}\b(outgoing|send|sent).{0,40}\bwires?\b|\b(outgoing|send|sent).{0,40}\b(international|foreign).{0,40}\bwires?\b|\bwires?\b.{0,40}\b(international|foreign|intl)\b.{0,20}\b(outgoing|out|sent|send)\b|\bwires?\b.{0,30}\b(outgoing|out)\b.{0,20}\b(international|foreign|intl)\b|\b(outgoing|send|sent)\b.{0,10}\bwires?\b.{0,30}\b(international|foreign|intl)\b|\b(international|foreign|intl)\b.{0,10}\bwires?\b.{0,30}\b(out|outgoing)\b/i,
  },
  {
    key: "wire_intl_incoming",
    pattern: /\b(international|foreign).{0,40}\b(incoming|receive|received).{0,40}\bwires?\b|\b(incoming|receive|received).{0,40}\b(international|foreign).{0,40}\bwires?\b|\bwires?\b.{0,40}\b(international|foreign|intl)\b.{0,20}\b(incoming|in|received)\b|\bwires?\b.{0,30}\b(incoming|in)\b.{0,20}\b(international|foreign|intl)\b|\b(incoming|receive|received)\b.{0,10}\bwires?\b.{0,30}\b(international|foreign|intl)\b/i,
  },
  {
    key: "wire_domestic_outgoing",
    pattern: /\b(domestic)?\s*(outgoing|send|sent).{0,40}\bwires?\b|\bwires?\b.{0,30}\b(outgoing|sent|out)\b/i,
  },
  {
    key: "wire_domestic_incoming",
    pattern: /\b(domestic)?\s*(incoming|receive|received).{0,40}\bwires?\b|\bwires?\b.{0,30}\b(incoming|received)\b/i,
  },
  { key: "stop_payment", pattern: /\bstop payments?\b/i },
  { key: "money_order", pattern: /\bmoney orders?\b/i },
  {
    key: "cashiers_check",
    pattern: /\b(cashier'?s?\s+checks?|official checks?|certified checks?|bank checks?|teller'?s?\s+checks?|corporate checks?|treasurer'?s?\s+checks?)\b/i,
  },
  { key: "counter_check", pattern: /\b(counter|temporary|starter) checks?\b/i },
  // v16: "Checkbook Balancing" is account research, not check printing.
  { key: "account_research", pattern: /\bcheck ?book balanc\w*|\bbalanc\w* (?:your |a )?check ?book\b/i },
  { key: "check_printing", pattern: /\b(check printing|checks order|order checks|check ?books?)\b/i },
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
  // v21: "Coin Counter Fee", "Coin Machine", "Loose Coin", "Count and roll coins", Coinstar.
  { key: "coin_counting", pattern: /\b(coin (?:counting|processing|counter|machine|sorting|sorter)|loose coins?|count(?:ing)?(?: and roll)? coins?|coinstar)\b/i },
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
  { key: "legal_process", pattern: /\b(legal process(?:ing)?|subpoena|court order)\b/i },
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
  { key: "dormant_account", pattern: /\b(dorman(?:t|cy)|inactiv(?:e|ity)|escheat\w*|abandoned)\b/i },
  { key: "account_research", pattern: /\b(account research|research fee|reconciliation|account balancing)\b/i },
  {
    key: "monthly_maintenance",
    pattern: /\b(monthly (service|maintenance)|maintenance (fee|charge)|monthly (fee|charge)|account service (fee|charge)|service charge)\b/i,
  },
  { key: "minimum_balance", pattern: /\b(minimum balance|low balance|fall[- ]below)\b.{0,30}\b(fee|charge)\b/i },
  // v14: names the answer keys show Knox held as unclassified. Last, so they only claim
  // lines no rule above recognizes.
  {
    key: "early_closure",
    pattern: /\b(account clos(?:ing|ure) fee|(?:fee )?to close (?:an |the |your )?account|closed account fee)\b/i,
  },
  { key: "dormant_account", pattern: /(?<!\bcard )\breactivation fee\b/i },
  // A wire that says domestic but not which way is outgoing, unless it says "in".
  {
    key: "wire_domestic_incoming",
    pattern: /\bwires?\b(?: transfers?)?\s+in\b.{0,25}\bdomestic\b|\bdomestic\b.{0,25}\bwires?\b(?: transfers?)?\s+in\b/i,
  },
  { key: "wire_domestic_outgoing", pattern: /\bwires?\b.{0,25}\bdomestic\b|\bdomestic\b.{0,25}\bwires?\b/i },
  { key: "garnishment_levy", pattern: /\bchild support\b/i },
  { key: "legal_process", pattern: /\blegal (?:order|document)s?\b/i },
  { key: "continuous_od", pattern: /\bnegative balance fee\b/i },
  { key: "account_verification", pattern: /\baudit confirmations?\b/i },
  { key: "ira_administration", pattern: /\bIRA custodial\b/i },
  { key: "document_reproduction", pattern: /\b(document cop(?:y|ies)|copy fee)\b/i },
  // v18: a wire that says international but not which way is outgoing (the answer keys
  // file "International (each)" under wires that way).
  {
    key: "wire_intl_outgoing",
    pattern:
      /^(?!.*\b(?:in|incoming|inbound|received|receiving)\b).*(?:\b(?:international|foreign)\b.{0,25}\bwires?\b|\bwires?\b.{0,25}\b(?:international|foreign)\b)/i,
  },
  // v18: low-balance account rows ("Average Daily Balance below $2,500 | $10.00/month",
  // "Low-balance fee", "MININUM BALANCE FEE", "Below minimum balance ..... $1.00").
  {
    key: "minimum_balance",
    pattern:
      /\b(?:minimum|mininum|minumum) balance\b.{0,30}\b(?:fee|charge)\b|\blow[- ]balance\b.{0,30}\b(?:fee|charge)\b|\bbelow (?:the )?minimum(?: daily| average)? balance\b|\b(?:average|avg\.?|minimum|min\.?) (?:daily |monthly |ledger |collected )?balance\s*\(?\s*(?:falls? |drops? |is )?(?:below|under|less than)\b|\bless than (?:an? )?(?:avg\.?|average|minimum) (?:daily |monthly )?balance\b|\b(?:fee|charge) charged if (?:balance )?falls? below\b/i,
  },
  // v32: an account named with the balance it must keep ("Money Market Savings Account
  // (below $2,500) | $15/mo.", "Interest Checking (below $1,500)") is that account's
  // low-balance fee.
  {
    key: "minimum_balance",
    pattern:
      /\b(?:checking|savings|money market|share|account|club)\b[^|()]{0,30}\(\s*(?:(?:average|avg\.?|daily|minimum|min\.?)\s+)*(?:balances?\s+)?(?:below|under|less than)\b/i,
  },
  ...FOLDED_PATTERNS,
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
  // v18: a comparison sign ("min. average daily balance <$2,500.00") is a condition too.
  /(?:[<>≤≥]=?|&lt;|&gt;|\b(below|above|over|under|less than|more than|greater than|at least|minimum(?: daily| average)?(?: balance| deposit)?(?: of)?|min\.?|maximum(?: fee)?(?: of)?|max\.?(?: fee)?|up to|exceeds?|exceeding|in excess of|negative|balances? of|deposits? of|totaling|first|cap of|limit of|between|per|and|or))\s*[-–(]?\s*$/i;
/**
 * Words just after an amount that make it a threshold, limit or deposit, not a price:
 * "$500 or more", "Money Orders ($1,000 Limit)", "($300 THRESHOLD, fee per item)",
 * "$10.00 refundable key deposit". "Limits may apply" after a price does not count.
 */
const CONDITION_AFTER = /^(?:\+|\s*(?:or more|and more|or less|and less|or higher|or greater|or above|and above|and up|and over|minimum|min\b|balance|in (?:deposits|balances)|on deposit|limit\b|threshold\b|refundable\b|par\b|required\b))/i;

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
    .replace(/\s*(?:\.{2,}|…)[.…]*\s*$/, "")
    .trim();
}

function hasZeroCell(line: string): boolean {
  if (!line.includes(CELL_SEPARATOR)) return false;
  return line.split(CELL_SEPARATOR).slice(1).some((cell) => ZERO_CELL.test(cell.trim()));
}

/**
 * v22: a long line is cut into sentences and schedule rows. A period inside a dot leader
 * ("Overdraft Fee........ $30.00") does not end a sentence, and a leader row ends right
 * after its price ("……$36", "....... $35.00/presentment"), so a one-line PDF schedule
 * keeps each name with its price.
 */
const LONG_LINE_BREAK = /\s{2,}|(?<![.…])[.;](?![.…])\s+|(?<=(?:\.{3,}|…)\s*\$\s?\d[\d,]*(?:\.\d{2})?(?:\/[a-z]+)?)\s+/;
/** "Overdraft Fee Assessed when ... per day. | $36.00": the title that opens a long description row. */
const ROW_TITLE = /^((?:[A-Z][\w'’&/-]*\s+){0,5}(?:Fee|Charge)s?)\b/;

function longLineParts(line: string): string[] {
  const parts = line.split(LONG_LINE_BREAK).filter((part) => part != null);
  // A long description row whose last cell is only its price is named by the row's title.
  if (line.includes(CELL_SEPARATOR)) {
    const cells = line.split(CELL_SEPARATOR).map((cell) => cell.trim());
    const title = cells[0].match(ROW_TITLE)?.[1];
    const price = cells.at(-1) ?? "";
    if (cells.length === 2 && title && /^\$\s?\d[\d,]*(?:\.\d{1,2})?\s*$/.test(price)) parts.unshift(`${title}${CELL_SEPARATOR}${price}`);
  }
  return parts;
}

function candidateSegments(text: string): string[] {
  const seen = new Set<string>();
  const segments: string[] = [];
  for (const rawLine of text.split(/\n+/)) {
    const line = rawLine.replace(/\s+/g, " ").trim();
    if (!line.includes("$") && !PERCENT_PATTERN.test(line) && !hasZeroCell(line)) continue;
    const parts = line.length > MAX_SEGMENT_CHARS ? longLineParts(line) : [line];
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
    // v32: "(Outside U.S.)" ends on a dot, where \b does not match.
    .replace(/\boutside (?:of )?(?:the )?(?:USA|U\.S\.A?\.?|US|United States)(?!\w)/gi, "international")
    // v18: "Non-Domestic Wire" is an international wire; one price for "Domestic or
    // International" is the domestic one.
    .replace(/\bnon[-\s]?domestic\b/gi, "international")
    .replace(/\bdomestic\s*(?:or|\/|&|and)\s*international\b|\binternational\s*(?:or|\/|&|and)\s*domestic\b/gi, "domestic")
    // v16: "Int'l Wire Fee Out" and "Outgoing Wire Out of Country" are international
    // wires; one price for "domestic/int'l" stays domestic.
    .replace(/\bint'l\b\.?|\b(?:out of|outside(?: of)?)\s+(?:the\s+)?country\b/gi, (match, offset, whole: string) =>
      /\bdomestic\b/i.test(whole) ? match : "international");
  let key = FEE_PATTERNS.find((entry) => entry.pattern.test(text))?.key ?? null;
  // v20: "ATM Foreign Transaction Fee" is what a customer pays at another bank's ATM (a
  // "foreign ATM"), not a card's foreign transaction fee; "ATM/Debit Card International/
  // Foreign Transaction Fee" names the card and stays one.
  if (key === "card_foreign_txn" && /(?<!\/\s?)\bATM'?s?\b[^|/]{0,12}\bforeign transactions?\b/i.test(text)) {
    key = "atm_non_network";
  }
  // v24: "Overdraft Loan Late Fee" and "Late Payment fee (Overdraft L-O-C)" are a loan's
  // late payment fee, not an overdraft fee.
  if (key === "overdraft" && /\blate (?:payment|charge|fee)\b/i.test(text)) {
    key = "late_payment";
  }
  // Credit card fees are lending fees, not deposit-account card fees.
  if ((key === "card_replacement" || key === "rush_card") && /\bcredit cards?\b/i.test(text)) return null;
  // A book transfer inside the bank is not a wire.
  if (key?.startsWith("wire_") && /\bbook transfer\b/i.test(text)) return null;
  // Reopening a closed account is not an early-closure fee.
  if (key === "early_closure" && /\bre-?open/i.test(text)) return null;
  // "Overdrafts initiated by debit card will be declined at no cost" describes a decline,
  // not an overdraft fee.
  if (key === "overdraft" && /\bdeclin(?:e|ed|es)\b/i.test(text)) return null;
  // v16: a name that opens with NSF is the NSF fee when only a condition mentions an
  // overdraft ("NSF Fee (fee applies when overdraft is created)", "Insufficient Funds Fee
  // (when overdraft coverage is not available)"). A combined "NSF/Overdraft Fee" keeps
  // its overdraft category.
  if (
    key === "overdraft" &&
    /^\W*(?:NSF|non[-\s]?sufficient|insufficient funds)\b/i.test(text) &&
    !/\b(?:overdraft|courtesy|privilege|bounce|OD|paid)\b/i.test(text.replace(/\b(?:applies|when|if)\b[^)]{0,40}/gi, " "))
  ) {
    return "nsf";
  }
  // v22: "Overdrafts Returned" is an item the bank returns unpaid, so an NSF fee.
  if (key === "overdraft" && /\boverdrafts?\s+returned\b/i.test(text) && !/\bpaid\b/i.test(text)) return "nsf";
  // v43: one price for the paid and the returned item ("NSF Paid Item Fee/Returned Item Fee
  // (items over $10)", Pinnacle Bank Wyoming) is the overdraft price too, like "NSF/Overdraft".
  if (key === "nsf" && PAID_AND_RETURNED_ITEM.test(text)) return "overdraft";
  // v19: an insufficient-funds item the bank pays is an overdraft ("Insufficient Funds
  // Fee – Item Paid"); one it returns stays NSF.
  // v34: "Insufficient Funds Charge (Paid)" beside "(Returned)" (WaFd).
  // v42: "Paid nonsufficient funds (NSF)" (Saco & Biddeford) and "NSF Share Draft (Honored)"
  // (Bluestone FCU) are items the bank pays, as are "Paid Consumer & Business NSF Items" (NIH FCU).
  if (
    key === "nsf" &&
    /\b(?:items?|checks?)\s*[-–:]?\s*paid\b|\bpaid\s+(?:items?|checks?|non[-\s]?sufficient|insufficient|NSF)\b|\bpaid\s+(?:[\w&]+\s+){1,3}NSF\s+items?\b|\(\s*(?:paid|honou?red)\s*\)/i.test(text) &&
    !/\b(?:return(?:ed)?|unpaid)\b/i.test(text)
  ) {
    return "overdraft";
  }
  // A PIN reissue is not a card replacement, unless one price covers both ("Debit Card
  // (replacement or PIN)").
  if (key === "card_replacement" && /\bPIN\b/i.test(text) && !/\breplacement or PIN\b/i.test(text)) return null;
  // "At Wells Fargo ATMs" is the bank's own machines; "At non-Wells Fargo ATMs" is not.
  if (key === "atm_non_network" && /\bat (?:[A-Z][\w'&.]*\s){1,4}ATMs?\b/.test(text) && !/\b(?:non|other|another|not|out[-\s]of[-\s]network|foreign)\b/i.test(text)) return null;
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
  // v38: a cell holding only a threshold's comparison word, cut off from its figure
  // ("Courtesy Pay | Over $5 | Per occurrence | $32", Lighthouse), names no fee.
  while (cells.length > 1 && THRESHOLD_WORD_CELL.test(cells.at(-1) ?? "")) cells.pop();
  // v42: an overdraft row's last text cell that only lists the items it covers ("Courtesy Pay
  // for paid items | Checks (Share Drafts), Online Payments, & ACH", "Overdrawn/Courtesy Pay |
  // For Debit Card Transactions including ATM, POS", Los Angeles FCU) does not name the fee.
  while (cells.length > 1 && COVERAGE_CELL.test(cells.at(-1) ?? "") && classifyFeeText(cells.at(-2) ?? "") === "overdraft") cells.pop();
  for (let start = cells.length - 1; start >= 0; start -= 1) {
    const text = cells.slice(start).join(CELL_SEPARATOR);
    // A cell that names a fee of its own owns the price, even when no rule knows it.
    if (classifyFeeText(text) || !composableTail(normalizeSegment(cells[start]))) return text;
  }
  return cells.join(CELL_SEPARATOR);
}

const PAID_AND_RETURNED_ITEM = /\bpaid items?(?: fees?)?\s*\/\s*(?:nsf\s+)?return(?:ed)? items?\b|\breturn(?:ed)? items?(?: fees?)?\s*\/\s*(?:nsf\s+)?paid items?\b/i;
const COVERAGE_CELL = /^\s*(?:for|includes?|including)\b|,[^,]*,/i;
const THRESHOLD_WORD_CELL = /^\s*(?:over|under|above|below|(?:less|more)\s+than|up\s+to)\s*$/i;
const THRESHOLD_CELL = /^\s*(?:over|under|above|below|(?:less|more)\s+than)\s+\$\s?\d[\d,]*(?:\.\d{1,2})?\s*$/i;

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
/**
 * "$25 per return item ($50 maximum per day)": a figure named a maximum after an earlier
 * price or rate on the line is that fee's cap. A lone "$10.00 maximum" is the fee's own
 * (up-to) price.
 */
const MAX_AFTER = /^\s*(?:maximum|max\b)/i;
const EARLIER_PRICE = /\$\s?\d|\d\s*%/;

export function isConditionAmount(text: string, amount: Pick<AmountMatch, "start" | "end">): boolean {
  return CONDITION_BEFORE.test(text.slice(Math.max(0, amount.start - 40), amount.start)) ||
    CONDITION_AFTER.test(text.slice(amount.end, amount.end + 30)) ||
    (MAX_AFTER.test(text.slice(amount.end, amount.end + 12)) && EARLIER_PRICE.test(text.slice(0, amount.start)));
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
  return stripFootnoteMarks(normalizeSegment(value.replace(AMOUNT_PATTERN, " "))).slice(0, 120).trim();
}

/**
 * Footnote numbers a PDF glues to a word ("Outgoing domestic wire transfer3",
 * "Return Item fee2 (each)", "Overdraft Fee7,8") are not part of the fee's name. Only
 * digits right after a word ending in two lowercase letters, or after a closing
 * parenthesis, count, and only at the end of the name or before a parenthesis, so box
 * sizes ("10x10"), acronyms ("W2") and counts ("after 12 months") stay.
 */
export function stripFootnoteMarks(name: string): string {
  return name
    .replace(/([A-Za-z][a-z]{2}|\))\d{1,2}(?:,\d{1,2})*(?=\s*\(|\s*$)/g, "$1")
    .trim();
}

export function usableName(name: string): boolean {
  return name.length >= 3 && /[a-z]/i.test(name) && !/^\$/.test(name);
}

/** "$5.00 Monthly fee for paper statements": the words after an opening price name it only when they say it is a fee ("$5 gift cards" is a gift card worth $5). */
/**
 * An account's monthly service charge written as prose, named by the words right after its
 * price: "otherwise $8 service charge per statement cycle", "avoid the $10 monthly fee",
 * "a monthly $29 fee will be assessed". The price is the figure the wording names; balance
 * thresholds elsewhere on the line are conditions.
 */
const MAINTENANCE_PROSE =
  /(?:\$\s?(\d{1,3}(?:\.\d{1,2})?)(?![\d,])\s*(?:monthly\s+(?:service|maintenance)\s+(?:fee|charge)|monthly\s+(?:fee|charge)|(?:service|maintenance)\s+(?:fee|charge))|\bmonthly\s+\$\s?(\d{1,3}(?:\.\d{1,2})?)(?![\d,])\s+(?:(?:service|maintenance)\s+)?(?:fee|charge))s?\b/i;

export function maintenanceFromProse(segment: string, cells: string[] | null): ExtractedFeeCandidate | null {
  const match = segment.match(MAINTENANCE_PROSE);
  if (!match) return null;
  const amount = Number(match[1] ?? match[2]);
  if (!(amount > 0)) return null;
  // The whole line passes the maintenance guard: no savings, business, statement-copy,
  // card, loan or excess-withdrawal charge.
  if (!passesDarwinChecks("monthly_maintenance", segment.replace(/\$\s?[\d.,]+\s*/g, ""), amount)) return null;
  // A card, bill pay or safe deposit box charge is not the account's maintenance fee.
  if (/\b(cards?|bill ?pay|safe deposit|box)\b/i.test(segment)) return null;
  const label = cells ? normalizeSegment(cells[0]) : "";
  const account = /\b(checking|account)\b/i.test(label) && !/\$/.test(label) && label.length <= 80 ? `${label} ` : "";
  // v18: named in the bank's own words ("monthly maintenance fee"), so the shared accuracy
  // check finds the name on the line; a bare "service fee" keeps the generic name.
  const ownWords = normalizeSegment(match[0].replace(/\$\s?[\d.,]+/g, " ")).toLowerCase();
  const ownName = `${account}${ownWords.charAt(0).toUpperCase()}${ownWords.slice(1)}`;
  const feeName = passesDarwinChecks("monthly_maintenance", ownName, amount) ? ownName : `${account}Monthly service charge`;
  if (!passesDarwinChecks("monthly_maintenance", feeName, amount)) return null;
  return {
    feeName,
    amount,
    frequency: "monthly",
    canonicalHint: "monthly_maintenance",
    confidence: confidenceFor(segment),
    excerpt: segment,
    waivable: WAIVER_LANGUAGE.test(segment) || /\bavoid\b/i.test(segment),
  };
}

/**
 * A checking account's own monthly price, named by the account: "Opportunity Checking |
 * $10 per month", "Rewards Checking (CK06) | $6.00 per month", "Plu$ Checking | $10 per
 * month if average monthly balance falls below $7,500". The label names only the account
 * (no other fee, card, loan or opening deposit) and the price says it is charged monthly.
 */
const CHECKING_ACCOUNT_LABEL = /\b(checking|share draft)\b/i;
const OTHER_THAN_MAINTENANCE = /\b(fee|charge|cards?|loans?|overdraft|nsf|returned|items?|opening|open|minimum|deposit|order|checks|box|statements?|transfers?|wire|atm|savings|business|commercial)\b/i;
const PER_MONTH_AFTER = /^\s*(?:\/\s*mo\b|\/\s*month\b|per month\b|a month\b|monthly\b|mo\.?\s*$)/i;

export function maintenanceFromAccountRow(segment: string, firstAmount: AmountMatch): ExtractedFeeCandidate | null {
  const label = normalizeSegment(segment.slice(0, firstAmount.start).replace(/\|/g, " "));
  if (!CHECKING_ACCOUNT_LABEL.test(label) || OTHER_THAN_MAINTENANCE.test(label) || /(?:^|\s)\$|\d{3,}/.test(label)) return null;
  if (label.split(" ").length > 8) return null;
  const after = segment.slice(firstAmount.end);
  if (!PER_MONTH_AFTER.test(after)) return null;
  const amount = firstAmount.value;
  if (!(amount > 0)) return null;
  let feeName = `${label.slice(0, 80)} Monthly service charge`;
  if (!passesDarwinChecks("monthly_maintenance", feeName, amount)) {
    // v18: "Money Market Checking | $10.00 monthly for average balances below $1,000" is
    // the account's low-balance fee, named by the row's own condition.
    const condition = after.split(CELL_SEPARATOR.trim())[0].match(BALANCE_BELOW_CLAUSE)?.[0];
    if (!condition) return null;
    feeName = `${label.slice(0, 80)} (${normalizeSegment(condition)})`;
    if (!passesDarwinChecks("minimum_balance", feeName, amount)) return null;
    return {
      feeName,
      amount,
      frequency: "monthly",
      canonicalHint: "minimum_balance",
      confidence: confidenceFor(segment),
      excerpt: segment,
      waivable: true,
    };
  }
  return {
    feeName,
    amount,
    frequency: "monthly",
    canonicalHint: "monthly_maintenance",
    confidence: confidenceFor(segment),
    excerpt: segment,
    waivable: WAIVER_LANGUAGE.test(segment) || /\b(if|unless|avoid)\b/i.test(segment.slice(firstAmount.end)),
    lineup: accountRowLineup(label, after),
  };
}

/**
 * v33: the row's own lineup facts. The label names the product; a balance-below clause in
 * the price cell is the balance that avoids the fee, and the cell's condition ("if ...",
 * "waived when ...") is the waiver. Knox grounds these against the text before writing them.
 */
function accountRowLineup(label: string, after: string): AccountLineup {
  const cell = after.split(CELL_SEPARATOR.trim())[0].replace(/\s+/g, " ").trim();
  const balance = cell.match(BALANCE_BELOW_CLAUSE)?.[0];
  return {
    productName: label.slice(0, 80),
    minBalanceToAvoid: balance ? (amountsIn(balance)[0]?.value ?? null) : null,
    minOpeningDeposit: null,
    waiverText: cell.match(/\b(?:if|unless|waived?|avoid)\b.*$/i)?.[0] ?? null,
  };
}

/** "average balances below $1,000", "balance falls below $7,500": the condition of a low-balance fee. */
export const BALANCE_BELOW_CLAUSE =
  /\b(?:(?:average|avg\.?|minimum|min\.?|daily|monthly|ledger|collected|account|share)\s+){0,3}balances?\s+(?:(?:falls?|drops?|goes|is)\s+)?(?:below|under|less than)\s+\$\s?[\d,]+(?:\.\d{2})?/i;

/**
 * v18: a low-balance fee written as prose: "A club fee of $8.00 will be imposed every
 * statement cycle if the balance in the account falls below $3,000.00", "If your balance
 * falls below $750.00 ... we will impose a maintenance fee of $7.50", "$10/month service
 * fee if balance falls below $7,500". Named by the fee's own words and the condition; the
 * price is the figure the fee words name, never the balance.
 */
const FEE_OF_PRICE = /\b((?:[a-z]+[ -]){0,2}(?:fee|charge))\s+of\s+\$\s?(\d{1,3}(?:\.\d{1,2})?)(?![\d,])/i;
const PRICE_THEN_FEE = /\$\s?(\d{1,3}(?:\.\d{1,2})?)(?![\d,])\s*(?:\/\s*(?:month|mo)\b|per month\b|monthly\b)?\s*((?:[a-z]+[ -]){0,2}(?:fee|charge))\b/i;
const BALANCE_FALLS_BELOW = /\b(?:if|when|whenever)\b[^.;|]{0,60}?\bbalances?\b[^.;|]{0,40}?\b(?:falls?|drops?|goes|is)\s+(?:below|under|less than)\s+\$\s?[\d,]+(?:\.\d{2})?/i;

export function lowBalanceFeeFromProse(segment: string): ExtractedFeeCandidate | null {
  // The fee and its condition share one sentence: "There is an initial setup fee of $25.
  // The monthly minimum balance fee if ..." prices the setup fee, not the balance fee.
  const sentence = segment.split(/(?<=[a-z0-9)][.;])\s+(?=[A-Z])/).find((part) => BALANCE_FALLS_BELOW.test(part));
  if (!sentence) return null;
  const condition = sentence.match(BALANCE_FALLS_BELOW);
  if (!condition) return null;
  const named = sentence.match(FEE_OF_PRICE);
  const priced = named ? null : sentence.match(PRICE_THEN_FEE);
  const words = named?.[1] ?? priced?.[2];
  const amount = Number(named?.[2] ?? priced?.[1]);
  if (!words || !(amount > 0)) return null;
  // "a fee of": the fee words must say which fee it is.
  const feeWords = normalizeSegment(words.replace(/^(?:a|an|the|this|that|one)\s+/i, ""));
  if (!/[a-z]{3,}\s+(?:fee|charge)$/i.test(feeWords) && !/^(?:service|maintenance)\s/i.test(feeWords)) return null;
  if (/\b(?:overdraft|nsf|returned|transfer|wire|atm|card|loan|statement|withdrawal|transaction|item|check|dormant|inactiv|set-?up|opening|initial|closing)/i.test(feeWords)) return null;
  const clause = normalizeSegment(condition[0].replace(/^(?:if|when|whenever)\s+/i, "")).replace(/^(?:your|the)\s+/i, "");
  const feeName = `${feeWords.charAt(0).toUpperCase()}${feeWords.slice(1)} (${clause})`;
  if (!passesDarwinChecks("minimum_balance", feeName, amount)) return null;
  return {
    feeName,
    amount,
    frequency: detectFrequency(segment) ?? "monthly",
    canonicalHint: "minimum_balance",
    confidence: confidenceFor(segment),
    excerpt: segment,
    waivable: true,
  };
}

/**
 * v32: "You must maintain a daily balance ... of $2,500 each statement cycle to avoid a
 * minimum balance fee of $3.95": the fee is the figure "to avoid a ... fee of" names, never
 * the balance before it.
 */
const AVOID_FEE_OF = /\bto avoid (?:an?|the)\s+((?:[a-z]+[ -]){0,3}(?:fee|charge))\s+of\s+\$\s?(\d{1,3}(?:\.\d{1,2})?)(?![\d,])/i;

export function avoidFeeFromProse(segment: string): ExtractedFeeCandidate | null {
  const match = segment.match(AVOID_FEE_OF);
  if (!match) return null;
  const words = normalizeSegment(match[1]);
  const hint = classifyFeeText(words);
  if (hint !== "minimum_balance" && hint !== "monthly_maintenance") return null;
  const amount = Number(match[2]);
  const feeName = `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
  if (!(amount > 0) || !passesDarwinChecks(hint, feeName, amount)) return null;
  return {
    feeName,
    amount,
    frequency: detectFrequency(segment) ?? "monthly",
    canonicalHint: hint,
    confidence: confidenceFor(segment),
    excerpt: segment,
    waivable: true,
  };
}

/**
 * v32: "Deposits/Withdrawals $2 Per transaction, when performed at an ATM we do not own or
 * operate": the clause after the price says which fee it is, so it stays in the name.
 */
const WHERE_CLAUSE = /^\s*(?:(?:per|each)\s+[a-z]+\s*,?\s*)?(?:when|if)\s+(?:it is\s+|they are\s+)?(?:performed|used|made|conducted|done)\s+(at\s+[^.;|]{3,60})/i;

export function qualifiedByClause(segment: string, firstAmount: AmountMatch, name: string): ExtractedFeeCandidate | null {
  const clause = segment.slice(firstAmount.end).match(WHERE_CLAUSE)?.[1]?.trim();
  if (!clause || !usableName(name)) return null;
  const hint = classifyFeeText(clause);
  if (hint !== "atm_non_network") return null;
  const feeName = `${name} ${clause}`.slice(0, 120);
  // The category guard has the last word (it refuses "Deposits/Withdrawals ..." as an ATM
  // fee today); a refused name is not sent on to be refused again.
  if (!passesDarwinChecks(hint, feeName, firstAmount.value)) return null;
  return {
    feeName,
    amount: firstAmount.value,
    frequency: detectFrequency(segment),
    canonicalHint: hint,
    confidence: confidenceFor(segment),
    excerpt: segment,
    waivable: WAIVER_LANGUAGE.test(segment),
  };
}

/** A table cell holding only a price and how often it is charged: "$20.00", "$5 per hour". */
/** "We (will) charge a fee of", "you will be charged a fee of": the price's name comes after it. */
// v33: "We will charge you a fee of up to $35.00 each time we pay an overdraft" (the Reg E
// overdraft notice) states the fee.
// v34: "You still pay a fee of $35 per item for overdrawing your account" (Park National).
// v37: "We will charge you a one-time fee of $36 each time we pay an overdraft, not to exceed
// $180 per day" (Guaranty): a "one-time" or "per-item" fee, and a cap after the clause.
const CHARGE_A_FEE_OF = /\b(?:we|you|customers?|members?)\b[^.;|]{0,30}?\b(?:charge|charged|assess|assessed|impose|pay)\b[^.;|]{0,12}?\b(?:an?|the)\s+(?:(?:one[-\s]time|per[-\s]item|flat)\s+)?(?:fee|charge)\s+of(?:\s+up\s+to)?\s*$/i;
/** v40: "We may charge you a Paid Item Fee of", "you will be charged a Return Item Fee of". */
const CHARGE_A_NAMED_FEE_OF = /\b(?:[Ww]e|[Yy]ou)\b[^.;|]{0,30}?\b(?:charge|charged|assess|assessed|impose)\b[^.;|]{0,12}?\b(?:an?|the)\s+((?:[A-Z][\w'’/-]*\s+){1,4}(?:Fee|Charge))\s+of(?:\s+up\s+to)?\s*$/;
/** "You can only be assessed one overdraft fee per day". */
const ONE_PER_DAY = /\b(?:only|no more than|maximum of|limit of|up to)\s+(?:be\s+(?:assessed|charged)\s+)?one\b[^.;|]{0,30}?\bper\s+(?:business\s+)?day\b/i;

/**
 * v19: a fee written as a sentence ("We charge a fee of $37.00 each time we pay an
 * overdraft") is named by what the sentence charges for, never by "We charge a fee of".
 * A clause allowing one such fee per day stays in the name; the daily cap columns hold
 * dollars, and the sentence states none.
 */
export function sentenceFee(segment: string, firstAmount: AmountMatch): ExtractedFeeCandidate | null {
  if (!CHARGE_A_FEE_OF.test(segment.slice(0, firstAmount.start))) return null;
  const clause = (segment.slice(firstAmount.end).match(/^\s*((?:[^.;|]|\.(?=\d))+)/)?.[1] ?? "")
    .replace(/,\s+(?:but|and|so|not to exceed|up to a (?:maximum|total) of)\b[\s\S]*$/i, "")
    .replace(/^[\s*†‡]+/, "")
    .trim();
  const words = clause.split(/\s+/).filter(Boolean);
  if (words.length < 2 || words.length > 14 || /\$\s?\d/.test(clause)) return null;
  const patternKey = classifyPatternKey(clause);
  const hint = patternKey ? CANONICAL_KEY_MAP[patternKey] ?? null : null;
  if (!hint) return null;
  const subject = FEE_PATTERNS.find((entry) => entry.key === patternKey)?.pattern.exec(clause.replace(/[‘’ʼ`]/g, "'"))?.[0];
  if (!subject) return null;
  const limit = segment.slice(firstAmount.end).match(ONE_PER_DAY) ? "; one per day" : "";
  // "... for overdrawing your account" is the overdraft fee.
  const title = /^overdrawing$/i.test(subject) ? "Overdraft" : `${subject.charAt(0).toUpperCase()}${subject.slice(1).toLowerCase()}`;
  const feeName = `${title} fee (${clause}${limit})`;
  if (!usableName(feeName) || !passesDarwinChecks(hint, feeName, firstAmount.value)) return null;
  return {
    feeName,
    amount: firstAmount.value,
    frequency: detectFrequency(segment),
    canonicalHint: hint,
    confidence: confidenceFor(segment),
    excerpt: segment,
    waivable: WAIVER_LANGUAGE.test(segment),
  };
}

/** "... we will charge an additional $5.00 Consecutive Overdraft Daily Fee per business day". */
const TITLE_AFTER_PRICE = /^\s*((?:[A-Z][\w'’&/-]*\s+){1,5}(?:Fee|Charge))\b/;

/**
 * v33: a line no words before its price name, whose price is followed by a capitalized fee
 * title, is named by that title.
 */
export function titledAfterPrice(segment: string, firstAmount: AmountMatch): ExtractedFeeCandidate | null {
  const title = segment.slice(firstAmount.end).match(TITLE_AFTER_PRICE)?.[1];
  const hint = title ? classifyFeeText(title) : null;
  if (!title || !hint || !passesDarwinChecks(hint, title, firstAmount.value)) return null;
  return {
    feeName: title,
    amount: firstAmount.value,
    frequency: detectFrequency(segment),
    canonicalHint: hint,
    confidence: confidenceFor(segment),
    excerpt: segment,
    waivable: WAIVER_LANGUAGE.test(segment),
  };
}

const PRICE_ONLY_CELL = /^\$\s?\d[\d,]*(?:\.\d{1,2})?\s*(?:\/?\s*(?:each|ea|item|month|mo|hour|hr|year|yr|copy|page|check|request)|per \w+)?\.?\s*$/i;
/** "$500 | Minimum to open": an opening requirement is not a fee. */
const OPENING_REQUIREMENT = /\b(?:to open|opening|open(?:ing)? deposit|required|requirement|limit)\b/i;

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
 * A free row that is really an allowance ("Stop payments, two per year: Free"), a free
 * in-network ATM, or a condition ("2 free cashiers checks monthly", "Monthly Service
 * Charge if any of the following qualifications are met", "first 3 pgs for new acct
 * Free", "minimum daily balance to waive monthly maintenance fees") is not a $0 price
 * for the fee. "We do not charge a fee" and "Free bill pay" are.
 */
export function notAZeroPrice(hint: string, name: string): boolean {
  return ownNetworkAtm(hint, name) ||
    /\b(?:one|two|three|four|five|six|first|\d+)\b(?: free)?\s*(?:per|a|each)\s+(?:year|month|statement|cycle)\b/i.test(name) ||
    (ZERO_CONDITION.test(name) && !/\bdo(?:es)? not charge\b/i.test(name));
}

const ZERO_CONDITION =
  /\b(?:to waive|waived? (?:if|when|with)|if (?!requested\b)\w+|unless|qualifications?|eligible|first \d+|\d+\s+free|free (?:day|with new)|(?:won[’']?t|will not) be charged|not (?:available|charged) on)\b/i;

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
  // "$20.00 | Domestic outgoing wire": a two-cell row whose first cell is only the price
  // is named by its second cell.
  const rowName = priceFirst && cells?.length === 2 && amounts.length === 1 && PRICE_ONLY_CELL.test(cells[0]) &&
    !OPENING_REQUIREMENT.test(cells[1]) && !/\b(?:you|your|unless|are not|is not)\b/i.test(cells[1]) ? nameFrom(cells[1]) : null;
  let hint = firstAmount
    ? classifyNearest(prefix) ??
      (priceFirst ? priceFirstHint(segment.slice(firstAmount.end, amounts[1]?.start ?? segment.length)) : null) ??
      (rowName && usableName(rowName) ? classifyFeeText(rowName) : null)
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
  // The name is the words before the rate ("Cash Advance | 3% of each advance ($5.00 minimum)").
  // A dollar minimum after the rate leaves only the rate's own cell before it, so the words
  // before the rate classify it too.
  const rateName = percent ? nameFrom(segment.slice(0, percent.index ?? 0)) : "";
  const rateHint = hint ?? (percent && firstAmount && (percent.index ?? 0) < firstAmount.start ? classifyNearest(segment.slice(0, percent.index ?? 0)) : null);
  if (rateHint && percent && (!firstAmount || (percent.index ?? 0) < firstAmount.start) && (usableName(rateName) || usableName(name))) {
    result.held.push({
      shape: "percentage",
      feeName: rateName || name,
      amount: null,
      amountMax: null,
      percent: Number(percent[1]),
      frequency,
      canonicalHint: rateHint,
      excerpt: segment,
    });
    return result;
  }
  if (!firstAmount) return result;

  // v40: "We may charge you a Paid Item Fee of $30.00 if we pay an item ..." is named by
  // the fee's own title, not by the sentence around it.
  const namedFee = hint ? prefix.match(CHARGE_A_NAMED_FEE_OF)?.[1]?.trim() : undefined;
  if (hint && namedFee && classifyFeeText(namedFee) === hint && passesDarwinChecks(hint, namedFee, firstAmount.value)) {
    result.candidates.push({
      feeName: namedFee,
      amount: firstAmount.value,
      frequency: detectFrequency(segment),
      canonicalHint: hint,
      confidence: confidenceFor(segment),
      excerpt: segment,
      waivable: WAIVER_LANGUAGE.test(segment),
    });
    return result;
  }

  // v22: "Customers are charged a fee of $30 each time an overdraft transaction is paid" is
  // named by what the sentence charges for, even when words earlier on the line name a fee.
  if (hint && CHARGE_A_FEE_OF.test(prefix)) {
    const sentence = sentenceFee(segment, firstAmount);
    if (sentence) {
      result.candidates.push(sentence);
      return result;
    }
  }

  // A line no rule names by the words before its price may still state the account's
  // monthly service charge in prose, with the fee named after the price.
  if (!hint) {
    const maintenance =
      sentenceFee(segment, firstAmount) ??
      maintenanceFromProse(segment, cells) ?? maintenanceFromAccountRow(segment, firstAmount) ?? lowBalanceFeeFromProse(segment) ??
      avoidFeeFromProse(segment) ?? qualifiedByClause(segment, firstAmount, nameFrom(prefix)) ??
      titledAfterPrice(segment, firstAmount);
    if (maintenance) {
      result.candidates.push(maintenance);
      return result;
    }
  }

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
  // v38: a threshold in a cell of its own ("Courtesy Pay | Over $5 | Per occurrence | $32")
  // stays in the name with its figure: "Courtesy Pay (over $5)".
  const thresholdCell = cells?.find((cell, index) => index > 0 && THRESHOLD_CELL.test(cell));
  if (cells && thresholdCell && hint && usableName(nameFrom(cells[0])) && segment.indexOf(thresholdCell) < feeAmounts[0].start) {
    feeName = `${nameFrom(cells[0])} (${thresholdCell.trim().replace(/\s+/g, " ").toLowerCase()})`;
  }
  // v32: two fees' names in one row before one price ("Returned Check | Verification of
  // Deposit | $20", a two-column page): the price is the nearest name's, and so is the name.
  if (cells && hint && feeAmounts[0] === firstAmount) {
    const nearest = nearestFeeText(prefix);
    const earlier = prefix.slice(0, Math.max(0, prefix.lastIndexOf(nearest.split(CELL_SEPARATOR)[0]))).replace(/[\s|]+$/, "");
    const earlierHint = earlier && nearest !== prefix.trim() ? classifyFeeText(earlier) : null;
    if (earlierHint && earlierHint !== hint && usableName(nameFrom(nearest))) feeName = nameFrom(nearest);
  }
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

  // v34: "We've lowered Overdraft Paid Item fees from $38 to $30" (Pinnacle): a change the
  // bank has already made, so the later figure is today's price, not a range's top. A
  // change still to come ("will increase", "effective") stays held as a range.
  if (
    feeAmounts[1] &&
    FEE_CHANGED_FROM.test(feeName) &&
    /^\s*to\s*$/i.test(segment.slice(feeAmounts[0].end, feeAmounts[1].start)) &&
    !FUTURE_CHANGE.test(segment)
  ) {
    const changedName = changedFeeName(feeName);
    if (usableName(changedName)) {
      feeAmounts.shift();
      feeName = changedName;
      hint = hint ?? classifyFeeText(feeName);
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
    // v27: a balance an account requires ("Minimum Daily Balance Requirement | $1,000") is
    // not a fee, even beside one on the same line.
    if (/\b(fee|charge)s?\b/i.test(segment) && usableName(feeName) && !BALANCE_REQUIREMENT.test(feeName) && feeAmounts[0].value <= MAX_REASONABLE_FEE_AMOUNT) {
      result.held.push({ shape: "unclassified", feeName, amount: feeAmounts[0].value, amountMax: null, percent: null, frequency, canonicalHint: null, excerpt: segment });
    }
    return result;
  }

  // The first amount belongs to the line's fee. A later amount is another fee only when
  // the words just before it name one ("Stop payment $30; Wire, outgoing $25"); otherwise
  // it is a cap, a second account column, or a condition, and is ignored.
  feeAmounts.forEach((amount, index) => {
    const between = index === 0 ? null : nameFrom(segment.slice(feeAmounts[index - 1].end, amount.start));
    // v19: "$30.00 - fee assessed for each item paid1 Continuous Overdraft Fee ..... $5.00":
    // the lowercase words finish the earlier price's terms; the title that ends them is the name.
    const tail = between && /^[^A-Z]/.test(between) ? titleTail(between) : null;
    const chunk = tail && classifyFeeText(tail) ? tail : between;
    const chunkHint = chunk ? classifyFeeText(chunk) : null;
    if (index > 0 && (!chunk || !usableName(chunk) || !chunkHint)) return;
    // v22: "... you will be assessed a fee of $25.00 on the 7th day. This fee is in addition to
    // any Overdraft Fees assessed. | $25.00": the row's price cell repeats the price in its own cell.
    const priceCellAt = segment.lastIndexOf(CELL_SEPARATOR);
    if (index > 0 && cells && amount.value === feeAmounts[index - 1].value && amount.start > priceCellAt &&
      PRICE_ONLY_CELL.test(cells.at(-1) ?? "") && segment.lastIndexOf(CELL_SEPARATOR, priceCellAt - 1) < feeAmounts[index - 1].start) return;
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

/** A fee whose price depends on the item's amount, introduced as such. */
const ITEM_AMOUNT_HEADING = /^(.{0,80}?\b(?:overdraft|courtesy pay|nsf|non[-\s]?sufficient|insufficient funds|return(?:ed)? item)\b.{0,40}?)\s*:?\s*(?:fee\s+)?(?:is\s+)?based on (?:the )?(?:item|transaction|overdraft) amount\b/i;
const ITEM_VALUE_DESCRIPTION = /\bcharged a fee based on the (?:value|amount|size) of the (?:item|transaction|check)\b/i;
/** "$10.01 - $20.00:  $10.00 fee", "$30.01 or above:  $30.00 fee". */
const ITEM_AMOUNT_TIER =
  /^\s*(?:fee\s*)?((?:greater|more) than \$\s?[\d,]+(?:\.\d{2})?|\$\s?[\d,]+(?:\.\d{2})?\s*(?:-|–|to)\s*\$\s?[\d,]+(?:\.\d{2})?|\$\s?[\d,]+(?:\.\d{2})?\s*(?:or (?:above|more|over)|and (?:above|up|over)|\+))\s*[:|]?\s*\$\s?(\d{1,3}(?:\.\d{2})?)\s*(?:fee|charge)?\b/i;

/**
 * An overdraft or NSF fee tiered by the item's amount ("Overdraft Item Fee: based on item
 * amount", then "$10.01 - $20.00: $10.00 fee" rows). Each priced tier is its own fee,
 * named with its item range; the index counts overdraft at its highest tier.
 */
export function itemAmountTierFees(text: string): ExtractedFeeCandidate[] {
  const lines = text.split(/\n+/).map((line) => line.trim()).filter(Boolean);
  const found: ExtractedFeeCandidate[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const heading = lines[index].match(ITEM_AMOUNT_HEADING);
    // v19: a fee card ("Fee TypeCourtesy Pay Overdraft Fee" / "Description... Each overdraft
    // is charged a fee based on the value of the item." / "Fee$0.01-$5.00: $0") is named by
    // its fee type.
    const cardType = !heading && ITEM_VALUE_DESCRIPTION.test(lines[index])
      ? lines.slice(Math.max(0, index - 2), index).reverse().map((line) => line.match(/^Fee Type\s*(.{3,80})$/i)?.[1]).find(Boolean)
      : undefined;
    if (!heading && !cardType) continue;
    const name = nameFrom(heading ? heading[1] : (cardType as string));
    const hint = classifyFeeText(name);
    if (!usableName(name) || (hint !== "overdraft" && hint !== "nsf")) continue;
    let misses = 0;
    for (let next = index + 1; next < lines.length && misses <= 4; next += 1) {
      const tier = lines[next].match(ITEM_AMOUNT_TIER);
      if (!tier) {
        // Notes and the "Item amount | Fee Amount" header may sit between the heading and its rows.
        if (found.some((fee) => fee.excerpt.startsWith(name))) break;
        misses += 1;
        continue;
      }
      const amount = Number(tier[2]);
      const feeName = `${name} (items ${tier[1].replace(/\s+/g, " ").trim()})`;
      if (amount > 0 && passesDarwinChecks(hint, feeName, amount)) {
        found.push({
          feeName,
          amount,
          frequency: "per_item",
          canonicalHint: hint,
          confidence: confidenceFor(lines[next]),
          excerpt: `${name} / ${lines[next]}`.slice(0, 280),
          waivable: false,
        });
      }
    }
  }
  return found;
}

/**
 * A two-column PDF flattened to "left | right" lines splits a long fee name across lines in
 * its own column ("* Overdraft Fee, per item, per presentment (applies to" ... "withdrawal,
 * or other electronic means) ..... $30.00"). Rebuild each column as its own text and join a
 * name line with the lowercase lines that continue it up to its price. Only joined lines are
 * returned: single lines are already read by the line rules.
 */
export function columnContinuations(text: string): string[] {
  const lines = text.split(/\n+/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const split = lines.filter((line) => line.split(CELL_SEPARATOR).length === 2).length;
  if (split < 5) return [];
  const columns: string[][] = [[], []];
  for (const line of lines) {
    const cells = line.split(CELL_SEPARATOR);
    if (cells.length === 2) {
      columns[0].push(cells[0].trim());
      columns[1].push(cells[1].trim());
    } else {
      columns[0].push(line);
    }
  }
  const joined: string[] = [];
  for (const column of columns) {
    for (let index = 0; index < column.length; index += 1) {
      if (amountsIn(column[index]).length > 0 || !/[a-z]{3,}/i.test(column[index])) continue;
      let line = column[index];
      for (let next = index + 1; next < column.length && next <= index + 3; next += 1) {
        if (!/^[a-z(]/.test(column[next])) break;
        line = `${line} ${column[next]}`;
        if (amountsIn(column[next]).length > 0) {
          joined.push(line);
          break;
        }
      }
    }
  }
  return joined;
}

/**
 * v35: a fee name that wraps onto a second or third line, with its price alone on the line
 * after ("Overdraft Fee (per item, both returned or paid created by check, in person
 * withdrawal," / "ATM withdrawal, or other electronic means. Maximum of 6 fees per day.)" /
 * "$36.00", MVB). The name's first line must name a fee and open a note that the line above
 * the price closes; no line before the price may hold an amount. The fee is named by its
 * first line without the open note. Only these lines are returned: a price beside its name
 * is read by the line rules.
 */
export function wrappedNamePrices(text: string): string[] {
  const lines = text.split(/\n+/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const joined: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    if (!PRICE_ONLY_CELL.test(lines[index])) continue;
    // The earliest line that names a fee and opens a note the last line before the price
    // closes, with no amount from it to the price.
    for (let start = Math.max(0, index - 3); start < index - 1; start += 1) {
      const name = lines.slice(start, index);
      if (name.some((line) => amountsIn(line).length > 0 || !/[a-z]{3,}/i.test(line))) continue;
      if (!/^[A-Z]/.test(lines[start]) || classifyPatternKey(lines[start]) === null) continue;
      if (!/\([^()]*$/.test(lines[start]) || !/\)\s*\.?\s*$/.test(name.at(-1) ?? "")) continue;
      // The name is its first line; a note that runs on past it ("(per item, both ...") is
      // dropped, as a price beside a one-line name would read.
      const title = lines[start].replace(/\s*\([^)]*$/, "").trim();
      joined.push(`${title || name.join(" ")} ${lines[index]}`);
      break;
    }
  }
  return joined;
}

/**
 * v36: a two-line name cell with its price printed level with the gap between the lines
 * ("Overdraft Fee³ - All Checking and Savings Accounts" / "$33" / "(Including Money
 * Markets)", Starion). The line above the price must name a fee and the line below must only
 * finish its note: open a parenthesis the name line left closed, or close the one it opened.
 */
export function centeredNamePrices(text: string): string[] {
  const lines = text.split(/\n+/).map((line) => line.replace(/\s+/g, " ").trim()).filter(Boolean);
  const joined: string[] = [];
  for (let index = 1; index < lines.length - 1; index += 1) {
    if (!PRICE_ONLY_CELL.test(lines[index])) continue;
    const name = lines[index - 1];
    const tail = lines[index + 1];
    if (amountsIn(name).length > 0 || amountsIn(tail).length > 0 || name.includes(CELL_SEPARATOR)) continue;
    if (!/^[A-Z]/.test(name) || classifyPatternKey(name) === null) continue;
    const opens = /\([^()]*$/.test(name);
    const finishes = opens ? /^[^()]*\)\s*\.?$/.test(tail) : /^\([^()]*\)\s*\.?$/.test(tail);
    if (!finishes) continue;
    const title = name.replace(/\s*\([^)]*$/, "").replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰]/g, "").trim();
    joined.push(`${title} ${lines[index]}`);
  }
  return joined;
}

export function extractCandidatesFromText(raw: string): ExtractionRulesResult {
  const text = stripPriceFootnoteMarks(raw);
  const seen = new Set<string>();
  const result: ExtractionRulesResult = { candidates: [], held: [] };
  const joinedLines = [...columnContinuations(text), ...wrappedNamePrices(text), ...centeredNamePrices(text)];
  const continued = joinedLines.flatMap((line) => extractFromSegment(line).candidates);
  for (const candidate of [...itemAmountTierFees(text), ...continued]) {
    if (!passesDarwinChecks(candidate.canonicalHint, candidate.feeName, candidate.amount)) continue;
    const key = `fee:${candidate.canonicalHint}:${candidate.feeName.toLowerCase()}:${candidate.amount}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.candidates.push(candidate);
  }
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
