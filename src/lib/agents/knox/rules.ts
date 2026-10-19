import { scopedFeeStatements, type FeeApplicability } from "@/lib/fee-audience";
import { CELL_SEPARATOR } from "@/lib/agents/rosetta/html-dom";
import { composableTail, passesDarwinChecks, titleTail } from "@/lib/agents/knox/layout";
import type { AccountLineup } from "@/lib/agents/knox/lineup";
import type { AncillaryProduct } from "@/lib/agents/knox/ancillary-product";
import { CANONICAL_KEY_MAP } from "@/lib/fee-taxonomy";
import { ATM_ADJUSTMENT, CHECKBOOK_RECONCILIATION, CROSS_BORDER_BUNDLE, FAX_SERVICE, PER_PAGE_COPY, researchSplitTarget } from "@/lib/fee-fold";
import { joinWrappedLeaderNames, parenBalance, stripPriceFootnoteMarks, withDroppedDecimalPoints } from "@/lib/custom-report/source-check";

// Shared with the source check since #1334; Knox's tests and callers keep importing it from here.
export { withDroppedDecimalPoints };
import { newestColumnText } from "@/lib/fee-change-columns";
import { feeBullets, withoutFeeBullets } from "@/lib/custom-report/fee-bullets";

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
// v76: unpriced rows ("Bill Payment ..... No Charge", "Check printing | Varies") have caps of their
// own, so they never push a priced line past the segment cap or a priced hold past the held cap.
const MAX_UNPRICED_SEGMENTS_PER_DOCUMENT = 40;
const MAX_UNCLASSIFIED_PER_DOCUMENT = 10;

/** v76: a $0 or "prices vary" hold, which takes the unpriced half of the held cap. */
export function isUnpricedHeldShape(shape: HeldShape): boolean {
  return shape === "zero" || shape === "varies";
}
const MAX_SEGMENT_CHARS = 280;
const MAX_NAME_CHARS = 120;
const MIN_SEGMENT_CHARS = 8;
export const MAX_REASONABLE_FEE_AMOUNT = 2_500;

export interface ExtractedFeeCandidate extends Partial<FeeApplicability> {
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
  /** Explicit primary-document ownership, independent of monthly balance/waiver fields. */
  ancillaryProduct?: AncillaryProduct;
  /** v82: the second fee a shared priced line carries (`twin:nsf`), part of the raw dedupe key. */
  lineShare?: string;
  /** Complete bounded own-bullet evidence; retain its conditions beyond the legacy excerpt cap. */
  ownedBullet?: true;
  /** Bounded, explicitly referenced context; never read as the price's charging unit. */
  linkedConditions?: string;
}

/** `untraced`: a read whose name and price don't trace to one row of the text (Knox's self-check). */
export type HeldShape = "zero" | "range" | "percentage" | "unclassified" | "untraced" | "varies";

export interface HeldFeeCandidate extends Partial<FeeApplicability> {
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
  /**
   * v68: priced lines no rule names that were not held, by reason (`DroppedLineReason`). The
   * extract step writes the totals to the run ledger, so no priced line leaves silently.
   */
  dropped?: Partial<Record<DroppedLineReason, number>>;
  /** v68, one line's read only: a `label | price` row no rule names, held only in a fee schedule. */
  tableHeld?: HeldFeeCandidate[];
}

/**
 * Why a priced line no rule names was not held (v68). The first five are the non-fee guards:
 * a balance an account requires, an opening deposit or minimum, a rate or yield line, a limit
 * or loan size, and a figure over the largest reasonable fee.
 */
export type DroppedLineReason =
  | "balance_requirement"
  | "opening_or_minimum"
  | "rate_line"
  | "limit_or_loan_size"
  | "over_max_amount"
  | "no_name"
  | "no_fee_word_not_table_row"
  | "not_fee_schedule"
  | "unclassified_cap"
  | "wrapped_bullet_unresolved";

function countDrop(result: ExtractionRulesResult, reason: DroppedLineReason, count = 1): void {
  result.dropped ??= {};
  result.dropped[reason] = (result.dropped[reason] ?? 0) + count;
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
 * Each maps to the category the taxonomy already gives the fee (returned mail and
 * excess-activity fees -> account research; fax -> document reproduction since Oct 9; collection items and foreign checks -> collection
 * items since Oct 8, check cashing before; loan cancellation, credit reports and UCC filings -> loan origination, as the keys
 * file them; loan refinancing and document fees -> other lending). Returned statements stay
 * held: the keys file them as paper statements, a featured fee they would skew. The hand-checked answer keys file these
 * lines as "unmapped", so the gate re-files them with `foldedCategory` (answer-key-gate.ts).
 * Kept last in FEE_PATTERNS but for v75's recall families, so they only claim lines no other
 * rule recognizes. Membership,
 * phone transfers, credit card and uncollected-funds fees have no right home and stay held.
 */
export const FOLDED_PATTERNS: FeePattern[] = [
  // A fax service is document reproduction since Oct 9 (one home for fax and copies, as the
  // fold has it); fax as the way a wire, payoff or closing is sent stays below.
  { key: "document_reproduction", pattern: FAX_SERVICE },
  { key: "document_reproduction", pattern: /\bstatement\s*print[- ]?outs?\b|\bspecial statement (?:fee|request)s?\b|\bhard copy print[- ]?outs?\b/i },
  // v77 (#1398): returned mail and excess withdrawals file under their own types while
  // `RESEARCH_SPLIT_LIVE` is on (`researchSplitTarget`), account research while it is off.
  {
    key: researchSplitTarget("returned_mail"),
    pattern:
      /\b(?:return(?:ed)?|undeliverable|bad|invalid|incorrect|wrong) (?:mail|address)\b|\baddress (?:correction|search|locat\w*)\b|\b(?:member |account holder )?locator fee\b/i,
  },
  {
    // A fax charge outside a transfer stays account research (it was in the returned-mail rule above until v77).
    key: "account_research",
    pattern: /^(?![\s\S]*\btransfers?\b)[\s\S]*\bfax(?:es|ing)?\b/i,
  },
  {
    key: researchSplitTarget("excess_withdrawal"),
    pattern:
      /\bexcess(?:ive)? (?:withdrawals?|transactions?|activity|debits?|transfers?)\b|\bwithdrawal limit fee\b|\b(?:withdrawals?|transactions?) in excess of\b/i,
  },
  {
    // Collection items got their own type on Oct 8 (James, "Own type"); v26 filed them under
    // check cashing. A collection fee on a charged-off or past-due account, or a collection
    // phone call, is debt collection, not a check sent for collection (v30, from prod's first
    // v26 pass).
    key: "collection_item",
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

/**
 * A loan's or a certificate's early closure is not a deposit account's, and neither is one with a
 * window longer than a year ("within 36 months of opening it ... $750 plus any mortgage ... taxes").
 */
const NOT_AN_ACCOUNT_CLOSURE = String.raw`^(?!.*\b(?:loans?|heloc|line of credit|mortgage|equit(?:y|ies)|lease|certificates?|CDs?|IRA|terminate|refinanc\w*)\b)(?!.*\b(?:(?:1[3-9]|[2-9]\d)\s*months?|(?:[2-9]|\d{2})\s*years?)\b)`;
/** A closure window of a year or less: "within 90 days", "less than 6 months", "(Open < 3 months)". */
const SHORT_WINDOW = String.raw`(?:\b(?:less than|within|before|prior to)|\bw\/in|<)\s*(?:(?:\d{1,3}|thirty|sixty|ninety)\s*-?\s*days?|(?:[1-9]|1[0-2]|one|two|three|six|nine|twelve)\s*-?\s*months?|(?:1|one)\s*-?\s*years?)\b`;

/**
 * v75: the recurring name families the 62-bank answer key showed held as unclassified or not read
 * (Knox recall diagnosis, 17 Oct 2026, `knox-recall-misses-2026-10-17.md`). Each files under one of
 * the 50 types: a family the key files under a retired key (mortgage payoff, reconveyance, lien
 * release, IRA distribution) takes that key's fold home (`RETIRED_CATEGORIES` in
 * fee-fold.ts), never the retired key. Kept after every other name rule (see FEE_PATTERNS).
 * Returned statements stay held (James's call since v26), and so does a bare "Wire Transfer Fee":
 * about 1 in 5 such lines say incoming or international after the price, which a name rule cannot see.
 * A family the Texas or seven-state gate keys leave unfiled (printouts, instant-issue cards, travel
 * and reloadable cards, loan coupon books, remote deposit capture) stays held too, so the gates add
 * no wrong read.
 */
export const RECALL_FAMILY_PATTERNS: FeePattern[] = [
  // Rush shipping of a card or PIN: "Expedited PIN Only (by mail)", "Express Shipping (domestic U.S.
  // only)", "Expedited shipping fee", "Rush Fee". A rushed check order, check payment, wire or
  // statement is not a card's rush delivery. Left held: a bare "Expedited Delivery" (two keys file it
  // as courier delivery, one as a rush card) and "Instant Issue" cards (the Texas and seven-state keys
  // leave them unfiled).
  {
    key: "rush_card",
    pattern:
      /^(?![\s\S]*\b(?:checks?|payments?|bill ?pay\w*|wires?|statements?|loans?)\b)[\s\S]*(?:\b(?:expedit\w*|rush(?:ed)?)\s+(?:shipping|order|fees?|charges?|pin)\b|\bexpress shipping\b)/i,
  },
  // A mortgage's payoff demand, its satisfaction or lien release, and its reconveyance: the fold
  // files mortgage_payoff, mortgage_lien_release and reconveyance as other lending.
  {
    key: "other_lending_fee",
    pattern:
      /\bsatisf(?:ied|action)\b[^|$]{0,25}\b(?:mortgages?|liens?|deeds? of trust)\b|\b(?:mortgages?|liens?)\b[^|$]{0,25}\bsatisf(?:ied|action)\b|\bpay-?offs?\b[^|$]{0,25}\b(?:demands?|requests?|statements?|quotes?|letters?)\b|\b(?:demand|request)\w*\b[^|$]{0,25}\bpay-?offs?\b|\breconvey\w*/i,
  },
  // A mortgage's own processing, underwriting and funding charges are what it costs to make it.
  { key: "loan_origination", pattern: /\bmortgage\s+(?:processing|underwriting|funding)\b/i },
  // A holiday or Christmas club's early withdrawal or close ("Holiday Club Withdrawal", "Early
  // Christmas Account Withdrawal", "Christmas club early close fee"). A line that says when
  // withdrawals are free ("Christmas Club (withdrawals free Oct.1 – Jan.1) | $2.50") stays held: the
  // Texas key leaves it unfiled.
  {
    key: "early_closure",
    pattern: /^(?![\s\S]*\bfree\b)[\s\S]*\b(?:christmas|xmas|holiday|vacation|club)\b[^|$]{0,25}\b(?:withdrawals?|early clos\w*|close-?outs?)\b/i,
  },
  // An account, savings or membership closed inside a window of a year or less ("Cancel Membership
  // < 180 days", "Closed account during first 90 days", "Account closing (90 days from open date)").
  // A loan's, a certificate's or an IRA's closure is not one (NOT_AN_ACCOUNT_CLOSURE).
  {
    key: "early_closure",
    pattern: new RegExp(
      NOT_AN_ACCOUNT_CLOSURE +
        String.raw`(?=.*\b(?:accounts?|savings|shares?|membership|checking)\b).*\b(?:clos(?:e|ed|ing|ure)|cancel\w*)\b.{0,40}(?:` +
        SHORT_WINDOW +
        String.raw`|\b(?:within|during|in)\s+(?:the\s+)?first\s+(?:\d{1,3}\s*days?|year|(?:[1-9]|1[0-2]|one|three|six|nine|twelve)\s*months?)\b|\b\d{1,3}\s*days?\s+(?:from|of|after)\s+(?:the\s+)?open)`,
      "i",
    ),
  },
  // A savings or share account's own closure fee, as v14 files "Account Closing Fee".
  { key: "early_closure", pattern: /^\W*(?:(?:share|primary|regular)\s+)?(?:savings|share|checking)\s+(?:account\s+)?closure\b/i },
  // A wire sent within the U.S. is a domestic wire ("Wire Transfer Fee - Within U.S.A. (per item)").
  {
    key: "wire_domestic_outgoing",
    pattern: /^(?![\s\S]*\b(?:in|incoming|inbound|receiv\w*)\b)[\s\S]*\bwires?\b[^|$]{0,30}\bwithin\s+(?:the\s+)?(?:U\.?S\.?A?\.?|United States)(?!\w)/i,
  },
  // An IRA's withdrawal, distribution, transfer out or closing closes out (part of) it; the fold
  // files ira_distribution as IRA termination.
  { key: "ira_termination", pattern: /\bIRA\b[^|$]{0,40}\b(?:withdrawals?|distributions?|transferr?ed|closed|close-?outs?)\b/i },
  // A loan payment made with a person's help is the loan's own servicing fee ("Agent-Supported Loan
  // Payment Fee", "Bank Assisted Loan Payment Funds Transfer"). Coupon books stay held: the
  // seven-state key leaves "Loan Coupon Book Fee" unfiled.
  {
    key: "other_lending_fee",
    pattern: /\b(?:bank|agent|staff|teller|employee|branch)[- ](?:assisted|supported)\b[^|$]{0,20}\bloan payments?\b/i,
  },
  // "Skip Payment Fee", "Loan Skip Payment Fee", "Skip Payment for each Loan" (the v5 rule reads
  // "skip-a-pay"). "Skip-a-Loan payment" stays out: one key files it as a late fee.
  { key: "other_lending_fee", pattern: /\bskip[- ]payments?\b/i },
  // Mobile deposit under its other names ("Mobile Check Deposit", "deposit via mobile"). Remote
  // deposit capture stays held: a business service the seven-state key leaves unfiled.
  { key: "mobile_deposit", pattern: /\bmobile check deposits?\b|\bdeposits? (?:by|via|through|using) mobile\b/i },
];

/**
 * v78: the next name families the 62-bank answer key showed held as unclassified at v77 (Knox recall
 * round 3, 17 Oct 2026). Kept after v75's, so they only claim names no rule above recognizes.
 */
export const V78_RECALL_PATTERNS: FeePattern[] = [
  { key: "cashiers_check", pattern: /^(?![\s\S]*\breturn)[\s\S]*\bbank drafts?\b/i },
  { key: "check_cashing", pattern: /\bchecking cashing\b/i },
  { key: "wire_domestic_incoming", pattern: /^(?![\s\S]*\b(?:international|foreign|intl)\b)[\s\S]*\binbound wires?\b/i },
  { key: "wire_domestic_outgoing", pattern: /^(?![\s\S]*\b(?:international|foreign|intl)\b)[\s\S]*\boutbound wires?\b/i },
  { key: "atm_non_network", pattern: /\bnon[-\s]?[\w-]+(?:\s+owned)?(?:\s*\/\s*affiliated)?\s+(?:ATMs|machines?)\b/i },
  // v80: a bank's name of two or three capitalised words before "ATMs" ("non-Beacon Bank ATMs").
  { key: "atm_non_network", pattern: /\b[Nn]on[-\s]?[\w-]+(?:\s+[A-Z][\w&-]*){1,2}\s+(?:ATMs|ATMS)\b/ },
  { key: "deposited_item_return", pattern: /\bdeposited items? returns\b/i },
  { key: "check_image", pattern: /\bimage cop(?:y|ies)\b/i },
  { key: "estatement_fee", pattern: /^\W*electronic statements?\W*$/i },
  // A service fee named for its checking or savings accounts ("Service Fee for Business Checking
  // Accounts"). A bare "Service Fee" or "Checking Fee" stays unnamed: as a row label under a heading
  // ("Cashier's Checks:" / "Performance Checking") it would take the row from the heading.
  { key: "monthly_maintenance", pattern: /^\W*(?:(?:monthly|account|maintenance)\s+)?service (?:fee|charge)s?\s+for\s+[\w\s]{0,30}\b(?:checking|savings)\s+accounts?\W*$/i },
  { key: "courier_delivery", pattern: /\b(?:UPS|DHL)\b/i },
  { key: "other_lending_fee", pattern: /\bredraw (?:of )?documents?\b/i },
  { key: "ach_origination", pattern: /\bsame[- ]day ACH\b|\bACH same[- ]day\b/i },
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
  // v68: inch marks may print as primes ("03″x05″x22″").
  { key: "safe_deposit_box", pattern: /\b\d{1,2}\s?["”″]?\s?[x×]\s?\d{1,2}\s?["”″]?\s?[x×]\s?\d{1,2}\b/i },
  // v25: so is a two-dimension size in inches ("OVERDRAFT AND NSF FEES 10.5x10.5 Inch", a box
  // row under the next section's heading in a one-line schedule).
  { key: "safe_deposit_box", pattern: /\b\d{1,2}(?:\.\d)?\s?["”]?\s?[x×]\s?\d{1,2}(?:\.\d)?\s?(?:["”]|inch(?:es)?\b)/i },
  { key: "card_dispute", pattern: /\b(?:card|transaction) disputes?\b|\b(?:debit|credit|card)\b.{0,15}\bchargebacks?\b/i },
  // v22: "Maximum daily Overdraft or Returned Item fees ..... $140.00" is the daily cap.
  // #1291: and "Maximum Daily OD/NSF Fees $210 per day" (#1291 re-file check, raw 406368).
  { key: "od_daily_cap", pattern: /\b(?:maximum|max\.?)\s+daily\s+(?:overdraft|OD|O\/D)\b/i },
  {
    key: "continuous_od",
    // v33: "Consecutive Overdraft Daily Fee" (Wilson Bank & Trust).
    // v39: the "OD" abbreviation too ("Continued OD Charge", "Consecutive Day OD Fee").
    pattern: /\b(continuous|continued|sustained|extended|consecutive|daily).{0,30}\b(?:overdrafts?|OD|O\/D)\b|\bdays? in overdraft\b|\boverdrafts?\b.{0,20}\b(continuous|sustained|extended)\b/i,
  },
  {
    key: "od_protection_transfer",
    pattern: /\b(overdraft protection|OD protection).{0,40}\b(transfer|from (savings|shares?))\b|\b(overdraft|OD)\b.{0,15}\b(transfer|sweep|from (savings|shares?))\b|^\W*overdraft protection\W*(?:\([^)]*\))?\W*$|\b(?:insufficient|non[-\s]?sufficient) funds? transfers?\b|\b(?:account|savings|deposit)[-\s]link(?:ed)?\b.{0,25}\boverdraft protection\b|\blinked (?:account|savings)\b.{0,25}\boverdraft protection\b|\b(?:overdrafts?|OD)\b.{0,30}\bcovered by\b.{0,25}\btransfers?\b|\bcourtesy transfers?\b/i,
    // #1291: "Overdrafts Covered by Courtesy Transfer | $5.00 per item" is the transfer, not the
    // overdraft fee the same page prints on its own line (#1291 re-file check, raw 158607).
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
    // v68: "Rushed Debit Card Request", "Rush Plastic Order (2-day)", "Visa CHECKCARD".
    pattern: /\b(rush(?:ed)?|expedit\w*|overnight)\b.{0,30}\b(cards?|debit|plastics?|check ?cards?)\b|\b(cards?|debit|plastics?|check ?cards?)\b.{0,30}\b(rush(?:ed)?|expedit\w*|overnight)\b/i,
  },
  {
    key: "card_replacement",
    // v68: "Visa CHECKCARD Replacement", "Replace Lost or Stolen VISA", "Debit Card Reorder".
    pattern: /\b(replacement|replace|reissue|re-issue|lost|stolen)\b.{0,30}\b(cards?|debit|check ?cards?|visa)\b|\b(?:cards?|check ?cards?)\b.{0,20}\b(replacement|replace|reissue|re-issue|re-?order)\b/i,
  },
  {
    key: "atm_international",
    pattern: /\b(international|outside (?:the )?(?:U\.?S\.?|United States)).{0,30}\bATMs?\b|\bATMs?\b.{0,30}\b(international|outside (?:the )?(?:U\.?S\.?|United States))/i,
  },
  // v59: a cross-border banking bundle or package is an account; its fee is the account's (`CROSS_BORDER_BUNDLE`).
  { key: "monthly_maintenance", pattern: CROSS_BORDER_BUNDLE },
  // v21: plural "Foreign Transactions" (a bare "(international transactions)" is often a
  // neighbouring column's note), and the other names banks give the card's
  // currency fee ("International Point of Sale Fee", "Cross-Border", "International Service
  // Assessment", "Multi currency"). Buying foreign cash ("Foreign Currency Order") stays out.
  {
    key: "card_foreign_txn",
    pattern: /\b(foreign transactions?|international (?:transaction\b|purchases?|point of sale|pos|currency fee|service (?:assessment|fee))|currency conversion|cross[- ]border|(?:multi(?:ple)?|single)[- ]currency)\b/i,
  },
  // v61: adjusting an ATM deposit or dispute is account research (`ATM_ADJUSTMENT`).
  { key: "account_research", pattern: ATM_ADJUSTMENT },
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
  // v56: balancing or reconciling a checkbook is account research, not a check order (`CHECKBOOK_RECONCILIATION`).
  { key: "account_research", pattern: new RegExp(String.raw`^(?=[\s\S]*\bcheck ?books?\b)[\s\S]*` + CHECKBOOK_RECONCILIATION.source, "i") },
  { key: "check_printing", pattern: /\b(check printing|checks order|order checks|check ?books?|check re-?orders?)\b/i },
  {
    key: "check_image",
    pattern: /\b(check images?|check cop(y|ies)|cop(y|ies) of (a |paid |cancell?ed |cleared )?checks?|photocop(y|ies) of (a )?checks?|image of (a )?check)\b/i,
  },
  { key: "check_cashing", pattern: /\b(check cashing|cashing (on-us |an? )?checks?)\b/i },
  { key: "paper_statement", pattern: /\b(paper|mailed|printed) statements?\b/i },
  {
    key: "document_reproduction",
    pattern: /\b(statement cop(y|ies)|cop(y|ies) of (a )?statements?|duplicate statements?|statement reprints?|interim statements?|photocop(y|ies))\b/i,
  },
  { key: "estatement_fee", pattern: /\be[-\s]?statement\b/i },
  { key: "ach_origination", pattern: /\bACH.{0,30}\b(origination|batch)\b/i },
  { key: "bill_pay", pattern: /\bbill[- ]?pay(ments?)?\b/i },
  { key: "mobile_deposit", pattern: /\bmobile deposit\b/i },
  { key: "zelle_fee", pattern: /\bzelle\b/i },
  // v21: "Coin Counter Fee", "Coin Machine", "Loose Coin", "Count and roll coins", Coinstar.
  { key: "coin_counting", pattern: /\b(coin (?:counting|processing|counter|machine|sorting|sorter)|loose coins?|count(?:ing)?(?: and roll)? coins?|coinstar)\b/i },
  { key: "cash_advance", pattern: /\bcash advance\b/i },
  { key: "night_deposit", pattern: /\b(night deposit|night depository|night drop|deposit bags?|zipper bags?)\b/i },
  { key: "courier_delivery", pattern: /\b(courier|fed ?ex|overnight (mail|delivery))\b/i },
  // v68: "notarization", "notarial acts".
  { key: "notary_fee", pattern: /\bnotar(?:y|ial|i[sz]ation|i[sz]ed?)\b/i },
  {
    key: "safe_deposit_box",
    pattern: /\b(safe deposit|lock box|lost key|key replacement|replacement key|drill\w*)\b|^\W*(?:size:?\s*|box\s+|rental for\s+)?\d{1,2}\s?["”]?\s?[x×]\s?\d{1,2}\b/i,
  },
  { key: "garnishment_levy", pattern: /\b(garnish\w*|levy|levies|attachments?)\b/i },
  { key: "vehicle_title", pattern: /\btitle\b.{0,20}\blien\b|\blien\b.{0,20}\btitle\b|\bvehicle title\b/i },
  { key: "mortgage_lien_release", pattern: /\blien release|\brelease of (?:real estate |mortgage )?liens?\b/i },
  { key: "legal_process", pattern: /\b(legal process(?:ing)?|legal proceedings?|subpoenas?|court orders?)\b/i },
  { key: "subordination", pattern: /\bsubordination\b/i },
  { key: "other_lending_fee", pattern: /\bloan application\b/i },
  { key: "account_verification", pattern: /\b(account verification|verification of (deposit|account)s?)\b/i },
  { key: "balance_inquiry", pattern: /\bbalance inquiry\b/i },
  { key: "mortgage_modification", pattern: /\bloan modification\b/i },
  { key: "other_lending_fee", pattern: /\bskip[- ]a[- ]pay(ment)?\b|\bloan (processing|extension)\b/i },
  // #1099 (Deming's answer-key misses, Oct 15): a loan's own servicing fees. A returned payment
  // is a loan fee only when the line names the loan, lease or mortgage; a bare "returned payment"
  // or "returned item" stays NSF / returned-item.
  {
    key: "other_lending_fee",
    pattern:
      /\b(?:loan|lease|mortgage)s?\b[^|$]{0,25}\bpayments?\b[^|$]{0,30}\b(?:by|via|using|over the)\s+(?:tele)?phone\b|\b(?:loan|lease|mortgage)s?\b[^|$]{0,25}\bpayments?\b[^|$]{0,30}\b(?:by|via|using|with)\s+(?:a\s+)?(?:debit|credit)(?: or (?:debit|credit))?\s*card|\b(?:loan|lease|mortgage)s?\b[^|$]{0,25}\bpayments?\b[^|$]{0,30}\b(?:by|via|using)\s+ACH\b|\breturned (?:check (?:for|on) )?(?:loan|lease|mortgage) payments?\b|\breturned (?:loan|lease|mortgage) (?:check|payment)s?\b/i,
  },
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
  // v54: a copy charged by the page is document reproduction, even under research (`PER_PAGE_COPY`).
  { key: "document_reproduction", pattern: PER_PAGE_COPY },
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
  // v68 (#1102): fee-schedule labels with no "fee" or "charge" in them, which Knox dropped
  // (the 62-bank answer key, 15 Oct 2026: 240 missed key lines in our own stored text had no row
  // and no fee word). Each is a service's own name at several banks. Last, so they only claim lines
  // no rule above recognizes.
  {
    // "Research (per hour)", "Record Research", "Account/Statement Research", "Research Bank
    // Records", "Account Reconcilement", "Reconciling/Research", "Balancing (per hour)".
    key: "account_research",
    pattern:
      /^\W*-?\s*research\s*(?:\(|\/|,|-|per\b)|\b(?:account|record|records|statement|transaction|item)s?(?:\s*\/\s*\w+)?\s+research\b|\bresearch\s+(?:of\s+)?(?:bank\s+|account\s+)?records?\b|\breconcil\w*|^\W*-?\s*balancing\b|\bresearch\s*\/\s*balancing\b/i,
  },
  {
    // "Duplicate Key", "Key Deposit / Replacement", "Box Inventory", and a box size after the
    // word that rents it ("Annual Rent Size 3×5", "Annual Fee 5 x 5").
    key: "safe_deposit_box",
    pattern:
      /\bduplicate (?:\d+\s+)?keys?\b|\bkey (?:deposit|replacement)\b|\bbox inventory\b|\b(?:annual|yearly|rent(?:al)?|size|box(?:es)?)\b[^|$]{0,15}?\b\d{1,2}\s?["”″]?\s?[x×]\s?\d{1,2}\b/i,
  },
  {
    // "Additional Monthly Statements", "Duplicate Annual Interest Statement", "Copy of Sales
    // Slip". Printouts stay out: the seven-state keys leave "Account Activity Printout" unfiled.
    // A copy of a title is a title fee.
    key: "document_reproduction",
    pattern: /\b(?:additional|duplicate|extra)\b[^|]{0,25}\bstatements?\b|\bcop(?:y|ies) of\b(?![^|]{0,25}\btitles?\b)/i,
  },
  {
    // "Verification Forms", "Deposit Verification Printout", "Employment Verification".
    key: "account_verification",
    pattern: /\b(?:deposit|employment|account|balance) verifications?\b|\bverification (?:forms?|letters?)\b/i,
  },
  {
    // A loan's due date change. A skipped payment stays with the v5 rule above ("skip-a-pay"):
    // the keys file the other wordings as late fees. A loan payment by phone, card or ACH is the
    // #1099 rule above (the production answer key files it as a lending fee).
    key: "other_lending_fee",
    pattern: /\bdue date change|\bchange (?:of |in )?(?:the )?(?:loan |payment )?due date\b/i,
  },
  {
    // "Sweep Transfers", "OD Protection Transaction Fee", "transfer from Savings to Checking".
    key: "od_protection_transfer",
    pattern:
      /^\W*sweep transfers?\b|\b(?:overdraft|OD|account) protection\b.{0,20}\b(?:transfers?|transactions?|advances?)\b|\btransfers? from (?:savings|shares?) to (?:checking|share draft)/i,
  },
  { key: "continuous_od", pattern: /\b(?:continuous|continued|daily|sustained)\s+negative balance\b/i },
  { key: "nsf", pattern: /\binsufficient items?\b/i },
  ...FOLDED_PATTERNS,
  // v75: the recurring name families the 62-bank answer key showed held as unclassified or not
  // read at all (Knox recall diagnosis, 17 Oct 2026). Each files under one of the 50 types (a
  // retired key's fold home, never the retired key). Last, after the fold too, so they only claim
  // lines no rule above names: a club's excess withdrawals and a faxed payoff request stay where
  // the fold files them. Returned statements stay held (James's call since v26).
  ...RECALL_FAMILY_PATTERNS,
  ...V78_RECALL_PATTERNS,
];

/**
 * #1102 (K9): names Knox holds as unclassified that say their own category, at many banks
 * (production, 14 Oct 2026: "Stop Pay Fee | $30.00", "Reconveyance Fee $ 25.00", "Early Closure
 * Fee", "Christmas Club Withdrawal Fee", "Returned Statement Fee", "IRA Closeout Fee"). Tried
 * after every rule above, so they only claim names no rule recognizes. A bare "Wire Transfer
 * Fee" is left out: about 1 in 5 such lines say incoming or international after the price.
 *
 * Off until James switches it on (`KNOX_HELD_NAME_RULES_LIVE`, with a rules version bump in the
 * same change): on, new reads file these names, the held re-check sends the held lines to
 * Darwin (`knox_promoted_from_held`, plus `knox_held_name_rule`), and Hamilton's rules re-check
 * reads them the same way. Off, only the extract step's read-only preview applies them.
 */
export const KNOX_HELD_NAME_RULES_LIVE = false;

export const HELD_NAME_PATTERNS: FeePattern[] = [
  { key: "stop_payment", pattern: /\bstop[- ]?pay\b(?![- ]?ments?)|\bstop p(?:y)?mts?\b/i },
  { key: "reconveyance", pattern: /\breconvey(?:ance|ances)?\b/i },
  // A bare "Early Closure Fee" row (with its note), a club's withdrawal, or a closure inside a
  // short window. A sentence's "Early closure fee of $500 may apply" names no account: on Great
  // Southern Bank's page it is the HELOC's.
  {
    key: "early_closure",
    pattern: new RegExp(
      NOT_AN_ACCOUNT_CLOSURE +
        String.raw`(?:^\W*(?:an?\s+|the\s+)?early\s+(?:account\s+)?(?:clos(?:e|ure|ing)|close-?out)(?:\s*(?:\/|or)\s*account)?(?:\s+(?:fees?|charges?))?(?:\s*[(,–-].*)?\W*$|.*\bclubs?\b.{0,25}\b(?:withdrawals?|close|closing)\b(?=.{0,25}\b(?:fees?|charges?)\b)|.*\b(?:clos(?:e|ed|ing|ure)|close-?out)\b.{0,40}` +
        SHORT_WINDOW +
        String.raw`)`,
      "i",
    ),
  },
  // A statement mailed back undelivered is returned mail: its own type while `RESEARCH_SPLIT_LIVE`
  // is on (v77), account research while it is off (`SPLIT_CATEGORIES.paper_statement` in
  // fee-fold.ts). Returned mail on its own stays unclassified (v14).
  { key: researchSplitTarget("returned_mail"), pattern: /\b(?:return(?:ed)?|undeliverable|undelivered)\s+(?:mail(?:ed)?\s+)?statements?\b/i },
  { key: "paper_statement", pattern: /\b(?:paper|mailed|printed)\s+(?:member|account|monthly|quarterly|periodic)\s+statements?\b/i },
  { key: "ira_termination", pattern: /\bIRA\b.{0,30}\bclose[- ]?outs?\b/i },
  { key: "ira_distribution", pattern: /\bIRA\b.{0,30}\b(?:withdrawals?|distributions?)\b/i },
];

let heldNameRulesOn = KNOX_HELD_NAME_RULES_LIVE;

/** Runs `read` with the held-name rules on or off. Synchronous reads only. */
export function withHeldNameRules<T>(on: boolean, read: () => T): T {
  const before = heldNameRulesOn;
  heldNameRulesOn = on;
  try {
    return read();
  } finally {
    heldNameRulesOn = before;
  }
}

/**
 * Prime marks written as inches in a box size ("3″x5″ Rental | $35.00 annual charge"), which the
 * box-size rules never read. A footnote number glued to a name ("1Paper statement charge") is
 * left alone: undone, it also files sentences whose figure is a threshold ("5Monthly fee applied
 * to share accounts with less than a $100 avg. monthly balance").
 */
function heldNameText(text: string): string {
  return text.replace(/″/g, '"').replace(/′/g, "'");
}

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

/** A table row with a zero cell after its first ("Wire Transfer | $0.00 | Free"), read before v76. */
function hasZeroCell(line: string): boolean {
  if (!line.includes(CELL_SEPARATOR)) return false;
  return line.split(CELL_SEPARATOR).slice(1).some((cell) => ZERO_CELL.test(cell.trim()));
}

/** v76: a free or "prices vary" row that only the v76 rules read (`hasZeroCell` rows were read before). */
function hasUnpricedFeeRow(line: string): boolean {
  if (freeRowName(line) || variesRowName(line)) return true;
  return line.includes(CELL_SEPARATOR) && line.split(CELL_SEPARATOR).some((cell) => freeCellName(cell.trim()));
}

/**
 * v76 (Knox recall, 62-bank answer key: 90 of 833 misses were free lines): a schedule row whose
 * price is a free word, in the shapes the line rules never read.
 *
 *   "Inquiry ........................ FREE"            a dot leader to the free word
 *   "| Notary Service | Free |"                         a markdown row with its outer bars
 *   "Digital deposits | No Cost", "NOTARY PUBLIC | Free to Members"
 *   "Notary Services (customers only): no fee"          a label, a colon and the free word
 *   "No charge for notarization of Bank documents."     a sentence that says what is free
 *
 * The name is the row's label (or what the sentence says is free). A row of several account
 * columns ("Stop Payment | FREE | $25") is not one of these: the line rules read it already.
 * Null when the line is not such a row. Whether the label names a fee, and whether the free word is
 * an allowance or a condition rather than a $0 price (`notAZeroPrice`), is decided by the caller.
 */
const FREE_PRICE = String.raw`(?:free|no charge|no fees?|no cost|none|n\/c|\$\s*0(?:\.00)?)(?:\s+(?:to|for)\s+(?:all\s+)?(?:[\w'’&-]+\s+){0,4}(?:members?|customers?|clients?))?`;
const FREE_CELL = new RegExp(`^${FREE_PRICE}\\.?$`, "i");
const FREE_LEADER_ROW = new RegExp(`^(.{3,80}?)\\s*(?:\\.{2,}|…)[.…\\s]*${FREE_PRICE}\\.?$`, "i");
const FREE_COLON_ROW = new RegExp(`^([^:|$]{3,60}?)\\s*:\\s*${FREE_PRICE}\\.?$`, "i");
const NO_CHARGE_FOR = /^(?:there (?:is|are) )?no (?:charge|fees?|cost)s? (?:for|per|on|to receive) (?:the |a |an |your |each |any )?([a-z][\w'’ -]{2,50}?)\.?$/i;

/**
 * v76 (Knox recall: 55 of 833 misses): a fee the schedule prices by what the customer picks, with
 * no figure ("Check printing prices vary depending on style selected", "Check Orders | Varies by
 * style", "Safe deposit box – call for quotes", "Standard HPCU Share Draft ... | Inquire for
 * pricing"). Knox never writes an amount for it: it is held for review as `varies` (amount null,
 * `knox_review:varies`, no `needs_darwin_verification`), as AGENTS.md holds every price no rule can
 * read as one exact amount. The name is the row's label, or the words before the varying price.
 */
export const VARIES_PRICE =
  /\b(?:(?:prices?|pricing|fees?|charges?|costs?)\s+)?(?:may\s+|will\s+)?var(?:y|ies)\b|\b(?:fee|charge|price|cost)s?\s+(?:is\s+|are\s+)?(?:depends?|dependent|depending|based)\s+(?:up)?on\b|\b(?:call|ask|inquire)\s+for\s+(?:current\s+)?(?:pricing|quotes?|prices?)\b|\bprinter[’']?s\s+current\s+price\b/i;

/**
 * An order of checks priced by style is check printing: "Check Orders | Varies by style",
 * "PERSONALIZED CHECKS | Prices Vary", "Supply of Checks | Printer's Current Price". Read only on a
 * varies row, where nothing else on the line can be the check order's price.
 */
const CHECK_ORDER_NAME = /^(?:(?:check|share draft)s?\s+(?:orders?|ordering|printing)|(?:personali[sz]ed|custom|order(?:ing)?|supply of|re-?order(?:ing)?)\s+(?:of\s+)?(?:\w+\s+)?(?:checks|share drafts)|checks|(?:check|share draft)(?:\s*\/\s*(?:check|share draft))?\s+printing)\b/i;

export function variesCategory(name: string): string | null {
  return unpricedRowCategory(name) ?? (CHECK_ORDER_NAME.test(name.trim()) ? "check_printing" : null);
}

/**
 * The category of a row with no figure (free or varying), read with a plural name as its singular
 * ("eStatements | FREE", "Account Balance inquiries | FREE"). Only these rows: on a priced line a
 * plural "eStatements" is usually a condition ("Bill Pay (free with eStatements) | $5.95").
 */
export function unpricedRowCategory(name: string): string | null {
  return (
    classifyFeeText(name) ??
    classifyFeeText(name.replace(/\b(e[-\s]?statement)s\b/gi, "$1").replace(/\binquiries\b/gi, "inquiry")) ??
    (FREE_CHECKING_ROW.test(name) ? "monthly_maintenance" : null)
  );
}

/**
 * v78: a checking account's own free row ("Free Checking (CK02) | Free", "Student Checking (CK07) |
 * FREE") is its monthly fee at $0. Only a free row: a priced one is the account expert's to read,
 * and one named "... Checking Account" in a column of services it gets free ("Power Protected
 * Checking Account | Free" under official checks) is not the account's own fee.
 */
const FREE_CHECKING_ROW = /^(?![\s\S]*\b(?:re-?open\w*|clos\w*|balanc\w*|research|order\w*|return\w*|overdraft|transfer\w*)\b)\W*(?:[A-Z][\w'’&+-]*\s+){1,3}checking(?:\s*\([A-Z]{2}\d{2}\))?\W*$/i;

export function variesRowName(line: string): string | null {
  const row = line.replace(/^\s*\|\s*/, "").replace(/(?:\s*\|)+\s*$/, "").trim();
  if (!row || row.length > 160 || /\$\s*\d|\d\s*%/.test(row)) return null;
  const varies = row.match(VARIES_PRICE);
  if (!varies || varies.index == null) return null;
  // The varying cell's own words name it ("Safe Deposit Drill & Lock Replacement......Fee varies by
  // service"), else the cell before it ("Check Orders | Varies by style").
  const cells = row.split(/\s*\|\s*/);
  const at = cells.findIndex((cell) => VARIES_PRICE.test(cell));
  const own = cells[at].slice(0, cells[at].search(VARIES_PRICE)).replace(/[(\-–—:.,…\s]+$/, "");
  // Only the last sentence before the varying price ("... order checks from us. Check Printing").
  const ownLabel = own.split(/[.;:!?]\s+/).at(-1) ?? "";
  const label = ownLabel.replace(/[^a-z]/gi, "").length >= 3 ? ownLabel : at > 0 ? cells[at - 1] : "";
  const name = label.replace(/\s*(?:\.{2,}|…)[.…]*\s*/g, " ").trim();
  return name.length >= 3 && !RATE_LINE.test(name) ? name : null;
}

export function freeRowName(line: string): string | null {
  const row = line.replace(/^\s*\|\s*/, "").replace(/\s*\|\s*$/, "").trim();
  if (!row || /\$\s*[1-9]|\$\s*0*\.\d*[1-9]|\d\s*%/.test(row)) return null;
  const cells = row.split(/\s*\|\s*/);
  if (cells.length === 2 && FREE_CELL.test(cells[1])) return cells[0].trim() || null;
  if (cells.length !== 1) return null;
  return freeCellName(row);
}

/** One cell that is a whole free row on its own: a dot leader or a colon to the free word, or a sentence. */
function freeCellName(row: string): string | null {
  const leader = row.match(FREE_LEADER_ROW)?.[1]?.trim() ?? row.match(FREE_COLON_ROW)?.[1]?.trim();
  if (leader) return leader;
  // A sentence of a paragraph ("... There are no fees for pre-authorized recurring bill pays.").
  for (const sentence of row.split(/(?<=[.;])\s+(?=[A-Z])/)) {
    const free = sentence.trim().match(NO_CHARGE_FOR)?.[1]?.trim();
    if (free) return free;
  }
  return null;
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

/**
 * v46: a paragraph wrapped across lines is read as its sentences. Read line by line, "we will
 * charge you an overdrawn account fee of $10.00 on the 5th consecutive" named the $10 by the
 * line above it ("overdrafts created by check, in-person withdrawal ...", Origin Bank) and
 * "overdrawn $5 / or less" lost the words that make $5 a threshold. A line joins the one above
 * when neither is a table row, the one above is long and ends mid-sentence, and it starts in
 * lower case; the joined line is then cut into sentences like any long line.
 */
const MIN_WRAPPED_LINE_CHARS = 40;
const ENDS_SENTENCE = /[.:;!?)]\s*$/;
const STARTS_LOWER = /^[a-z]/;

export function joinWrappedProse(lines: string[]): string[] {
  const joined: string[] = [];
  for (const line of lines) {
    const previous = joined.at(-1);
    if (
      previous != null &&
      !previous.includes(CELL_SEPARATOR) &&
      !line.includes(CELL_SEPARATOR) &&
      previous.length >= MIN_WRAPPED_LINE_CHARS &&
      !ENDS_SENTENCE.test(previous) &&
      STARTS_LOWER.test(line) &&
      // v76: a free schedule row ("Download account information ...... FREE") ends its line.
      !freeRowName(previous)
    ) {
      joined[joined.length - 1] = `${previous} ${line}`;
    } else {
      joined.push(line);
    }
  }
  return joined;
}

/**
 * v69: a short line with no price that names a fee ("Monthly service fee:", "Wire Transfers",
 * "Deposited Items Fees") heads the priced lines under it, for up to `HEADING_REACH_LINES`
 * lines. Another short unpriced line ends it ("Certificates", "Account Options"), so a rate or
 * account table is never read under the fee heading above it.
 */
const HEADING_REACH_LINES = 4;
const FEE_FAMILY_HEADING = /\bwire(?:s|\s+transfers?)?\b/i;
const MAX_HEADING_WORDS = 4;
/** v80: footnote numbers printed onto the end of a heading's last word ("Cashier’s Check1,4", "Money Orders1,4"). */
const GLUED_HEADING_FOOTNOTES = /([A-Za-z’')])\d{1,2}(?:\s*,\s*\d{1,2})*(\s*:?)\s*$/;
/**
 * v80: a one-word line under a wire heading names the wires below it ("Wire Transfers" /
 * "Domestic" / "Incoming ... $15.00"; Beacon Bank & Trust, doc 37581): the rows read under
 * "Domestic Wire Transfers", then "International Wire Transfers".
 */
const WIRE_SUBHEADING = /^(Domestic|International|Foreign)$/i;
const WIRE_SUBHEADING_WORD = /^(?:Domestic|International|Foreign)\s+/i;

export function headingName(rawLine: string): string | null | undefined {
  const unmarked = rawLine.replace(GLUED_HEADING_FOOTNOTES, "$1$2");
  // Only a line that heads a fee once its marks are off reads differently ("Checking Plus1" stays a figure line).
  if (unmarked !== rawLine) return plainHeadingName(unmarked) || undefined;
  return plainHeadingName(rawLine);
}

function plainHeadingName(line: string): string | null | undefined {
  if (line.includes("$") || PERCENT_PATTERN.test(line) || /\d/.test(line.replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰]/g, ""))) return undefined;
  const name = normalizeSegment(line.replace(/[¹²³⁴⁵⁶⁷⁸⁹⁰]/g, ""));
  const words = name.split(" ").filter(Boolean);
  if (words.length === 0 || words.length > MAX_HEADING_WORDS) return undefined;
  if (LABEL_SENTENCE.test(name) || !/^[A-Z]/.test(name)) return undefined;
  // One fee's own row with its price in another column ("Dormant Account Processing Fee") is no
  // section heading; "Monthly service fee:" with its colon, or "Deposited Items Fees", is.
  if (/\b(?:fee|charge)\b/i.test(name) && !/:\s*$/.test(line)) return null;
  // "Wire Transfers" names no fee alone until a row under it gives the direction.
  return classifyPatternKey(name) === null && !FEE_FAMILY_HEADING.test(name) ? null : name;
}

const GLUED_HEADING_AFTER_PRICE = /\$\s?\d[\d,]*(?:\.\d{2})?[^$|]*?\b((?:[A-Z][a-z']+\s+){1,4}[A-Z][a-z']+)\s*$/;

/**
 * v76: a dollar sign in a cell of its own before its figure ("Return Mail (per month) | $ | 5.00 |
 * 3 x 5 | $ 55.00", a two-column PDF table) is one price: read apart, the row's only priced
 * figure was the neighbouring box's $55.
 */
const SPLIT_DOLLAR_CELL = /\$\s*\|\s*(?=\d[\d,]*\.\d{2}(?!\d))/g;

interface HeadedSegment {
  segment: string;
  /** v69: the fee heading above the segment's line, when one is in reach, and the heading's line. */
  heading: string | null;
  headingAt: number | null;
  /** v76: the line is the first under a heading that ends in a colon ("Excessive withdrawals, each:"), a row that qualifies it. */
  headingOpensRows: boolean;
  /**
   * v78: how many heading-like lines (short, no figure, named fee or not: "Loan Fees") came
   * before the segment, so a row can tell whether a new section began since the row above it.
   */
  section: number;
}

function candidateSegments(text: string): HeadedSegment[] {
  const seen = new Set<string>();
  const segments: HeadedSegment[] = [];
  const lines = joinWrappedProse(joinWrappedLeaderNames(text.split(/\n+/).map((line) => line.replace(/\s+/g, " ").trim())));
  let heading: { name: string; at: number } | null = null;
  let section = 0;
  let priced = 0;
  let unpriced = 0;
  for (const [index, rawLine] of lines.entries()) {
    const line = rawLine.replace(/\s+/g, " ").replace(SPLIT_DOLLAR_CELL, "$").trim();
    const asHeading = headingName(line);
    const wireSub: string | undefined =
      asHeading === null && heading && index - heading.at <= HEADING_REACH_LINES && FEE_FAMILY_HEADING.test(heading.name) ? line.match(WIRE_SUBHEADING)?.[1] : undefined;
    if (wireSub && heading) heading = { name: `${wireSub} ${heading.name.replace(WIRE_SUBHEADING_WORD, "")}`, at: index };
    else if (asHeading !== undefined) heading = asHeading ? { name: asHeading, at: index } : null;
    if (asHeading !== undefined) section += 1;
    const isPriced = line.includes("$") || PERCENT_PATTERN.test(line) || hasZeroCell(line);
    if (!isPriced && !hasUnpricedFeeRow(line)) continue;
    const inReach = heading && index - heading.at <= HEADING_REACH_LINES ? heading : null;
    if (!isPriced && unpriced >= MAX_UNPRICED_SEGMENTS_PER_DOCUMENT) continue;
    // A next section's heading glued after a row's price ("$0.50 ea. in excess of 10 Night Deposit
    // Bag", Commerce Bank) heads the lines after it.
    const glued = line.match(GLUED_HEADING_AFTER_PRICE)?.[1];
    if (glued) heading = headingName(glued) ? { name: headingName(glued) as string, at: index } : null;
    const parts = line.length > MAX_SEGMENT_CHARS ? longLineParts(line) : [line];
    for (const part of parts) {
      const segment = part.trim();
      if (segment.length < MIN_SEGMENT_CHARS || segment.length > MAX_SEGMENT_CHARS || seen.has(segment)) continue;
      seen.add(segment);
      segments.push({ segment, heading: inReach?.name ?? null, headingAt: inReach?.at ?? null, headingOpensRows: inReach ? index === inReach.at + 1 && /:\s*$/.test(lines[inReach.at]) : false, section });
      if (isPriced) priced += 1;
      else unpriced += 1;
      if (priced >= MAX_SEGMENTS_PER_DOCUMENT) return segments;
    }
  }
  return segments;
}

/**
 * v69: a priced line no rule names, read again under the fee heading above it ("Monthly service
 * fee:" / "$12 or waived"; "Wire Transfers" / "Incoming - International | $20"). Only a short
 * label or price line, never a sentence, a rate or a figure a non-fee guard names, and only a
 * read that names a fee and passes Darwin's checks; the line otherwise stays dropped.
 */
const MAX_HEADED_LINE_WORDS = 10;
const MAX_HEADED_LABEL_WORDS = 4;
const WIRE_ROW_LABEL = /^(?:(?:USD|U\.?S\.?\s+Dollars?|Foreign\s+Currency|FX)\s+)?(?:Incoming|Outgoing|Inbound|Outbound)$/i;

/** v80: footnote numbers printed onto a row's label before its dot leader ("Incoming1,2 ....$15.00"). */
const GLUED_LABEL_FOOTNOTES = /(?!(?<=\d\s?)[xX×])([A-Za-z’')])\d{1,2}(?:,\d{1,2})*(?=\s*(?:\.{2,}|…))/;

export function readUnderHeading(segment: string, heading: string): ExtractedFeeCandidate[] {
  const line = normalizeSegment(segment).replace(GLUED_LABEL_FOOTNOTES, "$1");
  const amounts = amountsIn(line);
  if (amounts.length !== 1 || line.split(" ").length > MAX_HEADED_LINE_WORDS || PERCENT_PATTERN.test(line)) return [];
  const label = normalizeSegment(line.slice(0, amounts[0].start).replace(/(?:\.{2,}|…)[.…]*/g, " "));
  const after = line.slice(amounts[0].end).replace(/(?:\.{2,}|…)[.…]*/g, " ");
  // A sentence, a long label of its own, or another column after the price ("| $5.00 | INSTANT
  // PAYMENTS") is not a row of this heading's table.
  if (LABEL_SENTENCE.test(`${label} ${after}`) || label.split(" ").filter(Boolean).length > MAX_HEADED_LABEL_WORDS) return [];
  // A label with its own colon, or a title of three or more capitalized words ("Picture Check
  // Card:", "RBD Scanner Replacement"), is another fee's row, not a row of this heading.
  if (/:\s*$/.test(line.slice(0, amounts[0].start).replace(/[\s|]+$/, ""))) return [];
  // v80: a wire's currency and direction is a row of its wire heading ("Foreign Currency Outgoing").
  const wireRow = FEE_FAMILY_HEADING.test(heading) && WIRE_ROW_LABEL.test(label);
  if (!wireRow && (label.replace(/\([^)]*\)/g, " ").match(/\b[A-Z][\w'’&/-]*/g) ?? []).length > 2) return [];
  if (after.includes(CELL_SEPARATOR) && /[a-z]{3,}/i.test(after.slice(after.indexOf(CELL_SEPARATOR)))) return [];
  // Under one fee's own heading ("Monthly service fee:") the line only qualifies its price ("$12
  // or waived", "$15 per item"); a capitalized label there is another fee's row in a second column.
  if (/\b(?:fee|charge)\b/i.test(heading) && /[A-Z]/.test(label)) return [];
  // A label that names a fee of its own ("Picture Check Card:", "Same-Day ACH (per item)") is
  // that fee's row in a column beside the heading, not a row of it.
  const own = label ? classifyPatternKey(`${label} fee`) ?? classifyPatternKey(label) : null;
  // Named as the table pass names a row under its heading ("Return item: Consumer account").
  const title = heading.replace(/\s*:\s*$/, "");
  return extractFromSegment(`${heading} ${line}`).candidates
    .map((candidate) => ({ ...candidate, feeName: label ? `${title}: ${label}` : title }))
    .filter((candidate) =>
      (own === null || own === classifyPatternKey(`${heading} ${label}`)) &&
      passesDarwinChecks(candidate.canonicalHint, candidate.feeName, candidate.amount),
    );
}

/** v78 (#1304): words that make a charge the overdraft (courtesy pay) fee or the NSF fee. */
const OVERDRAFT_WORDS = /courtesy\s*pay|\boverdraft|\bpaid\s+nsf\b|\bbounce/i;
const NSF_WORDS = /\bnsf\b|\b(?:in|non[-\s]?)sufficient\b/i;
/** Payment channels an overdraft or NSF row lists in its cell ("Check/ACH/Bill Pay Payment"). */
const PAYMENT_CHANNEL = /\b(?:checks?|ach|bill\s*pay(?:ments?)?|share\s+drafts?|drafts?|debit(?:\s+cards?)?|atm|electronic|recurring|pre-?authori[sz]ed|pos)\b/gi;

function overdraftOrNsf(text: string): "overdraft" | "nsf" | null {
  if (OVERDRAFT_WORDS.test(text)) return "overdraft";
  return NSF_WORDS.test(text) ? "nsf" : null;
}

/**
 * v78 (#1304, the Knox half of guard v68): a bill payment priced under an overdraft (courtesy pay)
 * or NSF heading is that fee, not the bill pay service. Knox named the row by the cell after its
 * heading and filed "Courtesy Pay (Paid NSF) Check/ACH/Bill Pay Payment | $32.00/item" as bill pay
 * under "Check/ACH/Bill Pay Payment" (live 88513). A bill pay read is filed by its heading when the
 * name itself says courtesy pay, overdraft or NSF; when its own line puts such a heading just before
 * the name, in the same cell or, for a name listing two or more payment channels, in the cell before
 * it (the same reading as guard v68's `overdraftOrNsfBillPay`); or when the heading line above it
 * (`heading`) is one ("Courtesy Pay:" over "Check/ACH/Bill Pay Payment | $32.00"). Text before an
 * earlier price on the line belongs to another fee. The read keeps its price and takes the heading
 * into its name; one that would not pass Darwin's checks under the heading's category is dropped,
 * never filed as bill pay. Every other read passes through unchanged. Pure.
 */
export function billPayByHeading(candidate: ExtractedFeeCandidate, heading?: string | null): ExtractedFeeCandidate | null {
  if (candidate.canonicalHint !== "bill_pay") return candidate;
  const refile = (category: "overdraft" | "nsf", name: string): ExtractedFeeCandidate | null =>
    passesDarwinChecks(category, name, candidate.amount) ? { ...candidate, canonicalHint: category, feeName: name } : null;
  const own = overdraftOrNsf(candidate.feeName);
  if (own) return refile(own, candidate.feeName);
  const line = normalizeSegment(candidate.excerpt ?? "").replace(/[‘’]/g, "'");
  const at = line.toLowerCase().indexOf(candidate.feeName.toLowerCase());
  if (at > 0) {
    const sincePrice = line.slice(0, at).split(/\$\s?\d[\d,]*(?:\.\d+)?|\$\s?\.\d+/).at(-1) ?? "";
    const cells = sincePrice.split("|");
    const channels = new Set((candidate.feeName.match(PAYMENT_CHANNEL) ?? []).map((word) => word.toLowerCase().replace(/\s+/g, " ")));
    const before = normalizeSegment((channels.size >= 2 ? cells.slice(-2) : cells.slice(-1)).join(" "));
    const kind = before ? overdraftOrNsf(before) : null;
    if (kind) return refile(kind, normalizeSegment(`${before} ${candidate.feeName}`));
  }
  const headed = heading ? overdraftOrNsf(heading) : null;
  if (headed) return refile(headed, `${heading!.replace(/\s*:\s*$/, "")}: ${candidate.feeName}`);
  return candidate;
}

/**
 * v78: a bare late fee on a safe deposit box's lines ("Box Drilling: $125.00" / "Late Payment:
 * $5.00/month"; "Safe Deposit Box 10x10 | $125" / "Late Payment (Over 90 Days) | $10") is the box's
 * late rental charge, not a loan's late payment. Only a name that is just the late fee, read right
 * after a safe deposit box read; a late fee naming a loan, card or payment kind stays a late payment.
 */
const BARE_LATE_FEE = /^\W*late\s+(?:payment|fee|charge)s?(?:\s+(?:fee|charge))?\s*(?:\([^)]*\))?\W*$/i;

export function boxLateFee(candidate: ExtractedFeeCandidate, previousKind: string | null): ExtractedFeeCandidate {
  if (candidate.canonicalHint !== "late_payment" || previousKind !== "safe_deposit_box" || !BARE_LATE_FEE.test(candidate.feeName)) return candidate;
  // The name stays the page's own, so the self-check still traces it to its row.
  return passesDarwinChecks("safe_deposit_box", candidate.feeName, candidate.amount) ? { ...candidate, canonicalHint: "safe_deposit_box" } : candidate;
}

/** The FEE_PATTERNS key a fee name matches, before mapping to its canonical key. */
export function classifyPatternKey(value: string): string | null {
  // PDFs usually render the apostrophe in "Cashier's check" as a curly quote. A waiver
  // clause names other services ("(waived if enrolled in Mobile Deposit)"), never the fee.
  const text = (heldNameRulesOn ? heldNameText(value) : value)
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
  let key = FEE_PATTERNS.find((entry) => entry.pattern.test(text))?.key ??
    (heldNameRulesOn ? HELD_NAME_PATTERNS.find((entry) => entry.pattern.test(text))?.key : null) ??
    null;
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
  // v75: one price for a debit or credit card ("Debit Card or Credit Card Replacement") is the debit card's too.
  if ((key === "card_replacement" || key === "rush_card") && /\bcredit cards?\b/i.test(text) && !/\bdebit\b/i.test(text)) return null;
  // v76: an interim statement printed at an ATM or branch ("Interim statement (ATM/Branch)") is a
  // statement copy, not an ATM fee.
  if (key === "atm_non_network" && /\binterim statements?\b/i.test(text)) key = "document_reproduction";
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
  // #1291: an NSF-led name for an item returned or paid ("NSF Return/Paid Item Fee for Chkg. & Sav",
  // Kewanee, raw 131332, whose page prints its own "Overdraft Fee") is the NSF fee; v43 below still
  // files one price written "Paid Item Fee/Returned Item Fee" as the overdraft price.
  if (key === "overdraft" && /^\W*(?:NSF|non[-\s]?sufficient|insufficient funds)\b[^|]{0,20}\breturn(?:ed)?\s*(?:\/|or|&)\s*paid items?\b/i.test(text)) {
    key = "nsf";
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
const BOX_SIZE_NAME = /^\d{1,2}(?:\.\d)?\s?["”″]?\s?[x×]\s?\d{1,2}\s?["”″]?(?:\s?[x×]\s?\d{1,2}\s?["”″]?)?$/i;

export function nearestFeeText(prefix: string): string {
  // v68: a box size alone in its cell ("RESEARCH | 5 x 10 | $ 100.00", "3×10 | $55.00",
  // "2” x 5” $45.00") names the box it prices, though it has no word.
  // v78: and so does one followed by its dot leader ("... | 3 x 10.......$30.00 per year").
  const cells = prefix.split(CELL_SEPARATOR).filter((cell) => /[a-z]{3,}/i.test(cell) || BOX_SIZE_NAME.test(cell.trim().replace(/[\s.…_]+$/, "")));
  // v38: a cell holding only a threshold's comparison word, cut off from its figure
  // ("Courtesy Pay | Over $5 | Per occurrence | $32", Lighthouse), names no fee.
  while (cells.length > 1 && THRESHOLD_WORD_CELL.test(cells.at(-1) ?? "")) cells.pop();
  // v68: a free cell of another account column ("Stop Payment | FREE | $25") names no fee.
  while (cells.length > 1 && ZERO_CELL.test((cells.at(-1) ?? "").trim())) cells.pop();
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

/** v68: a transfer's step ("made in increments of $50", "in multiples of $100") is never the fee. */
const INCREMENT_BEFORE = /\b(?:increments?|multiples?)\s+of\s*\$?\s*$/i;

/**
 * v70 (#1100): "minimum" that closes the figure before it ("Monthly Service Charge Below $500.00
 * minimum $5.00 per Month") belongs to that figure, and a figure after "low balance" ("Low balance
 * $ 5.00 per month") is the low-balance fee; the shared source check reads both the same way.
 */
const PRICE_AFTER_BALANCE_WORDS = /\$\s*\d+(?:,\d{3})*(?:\.\d{2})?\s+min(?:imum|\.)?\s*$|\blow[- ]balance(?:\s+(?:fee|charge))?\s*:?\s*\$?\s*$/i;

/** v70 (#1100): "Minimum Balance $4.95/Month if the minimum ... is not met" charges $4.95 a month. */
const MINIMUM_BALANCE_FEE_BEFORE = /\bminimum balance\s*[-–:]?\s*\$?\s*$/i;
const BY_THE_MONTH_AFTER = /^\s*(?:\/\s*(?:mo|month)\b|per month\b)/i;
/**
 * Never a price after those words (#1392 review): a cap ("$15.00 Minimum $30.00 Maximum" on a 1%
 * late charge), a balance that is averaged ("Minimum Balance $100/Month average", "$100 min. $1,500
 * avg balance"), a figure followed by a fee word and another figure ("Low balance $1,000 fee $5"),
 * or a figure of $100 or more ("Low balance $1,000 per month").
 */
export const STILL_A_BALANCE_AFTER = /^\s*max(?:imum)?\b|^\s*(?:\/\s*(?:mo|month)\b|per\s+month\b|monthly\b)?\s*(?:avg|average|daily balance)\b|^[^|$]{0,12}\b(?:fee|charge)s?\b[^|$]{0,12}\$\s?\d/i;
export const BALANCE_WORD_PRICE_LIMIT = 100;

export function isConditionAmount(text: string, amount: Pick<AmountMatch, "start" | "end">): boolean {
  const before = text.slice(Math.max(0, amount.start - 40), amount.start);
  const after = text.slice(amount.end, amount.end + 40);
  const value = Number(text.slice(amount.start, amount.end).replace(/[^\d.]/g, ""));
  const feeSized = Number.isFinite(value) && value < BALANCE_WORD_PRICE_LIMIT && !STILL_A_BALANCE_AFTER.test(after);
  if (feeSized && ((PRICE_AFTER_BALANCE_WORDS.test(before) && !CONDITION_AFTER.test(after)) || (MINIMUM_BALANCE_FEE_BEFORE.test(before) && BY_THE_MONTH_AFTER.test(after)))) {
    return false;
  }
  return INCREMENT_BEFORE.test(text.slice(Math.max(0, amount.start - 40), amount.start)) ||
    CONDITION_BEFORE.test(text.slice(Math.max(0, amount.start - 40), amount.start)) ||
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

/** v60: a parenthetical that states a threshold of the fee ("($10,000.01 and Over)", "(below $500)", "($25 minimum)"). */
const THRESHOLD_PARENTHETICAL =
  /\b(?:below|under|over|above|than|up to|exceed(?:s|ing)?|least|min(?:imum)?|max(?:imum)?|limit|greater|less|or more|and up)\b|[<>]/i;

export function nameFrom(value: string): string {
  // v60: a figure in a threshold parenthetical stays in the name; every other figure is the price.
  const kept: string[] = [];
  const masked = value.replace(/\([^()]*\$\s*\d[^()]*\)/g, (group) => {
    if (!THRESHOLD_PARENTHETICAL.test(group.replace(AMOUNT_PATTERN, " "))) return group;
    kept.push(group);
    return `\u0000${kept.length - 1}\u0000`;
  });
  const stripped = masked.replace(AMOUNT_PATTERN, " ").replace(/\u0000(\d+)\u0000/g, (_, index: string) => kept[Number(index)]);
  return stripFootnoteMarks(normalizeSegment(stripped)).slice(0, MAX_NAME_CHARS).trim();
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

/**
 * v74: a footnote number glued to the front of a name, where the page prints a footnote as its own
 * line ("1Monthly fee of $5.95 applies when ...", "3Automated Overdraft item fee of $32.00",
 * "2Monthly fee of $10 is waived ..." under "requirements2"). Never a box size ("3x10", "5X 6"),
 * an ordinal ("1st", "2nd", "3rd party", "1ST"), a time or period ("24hr", "24 Hour", "12 Months"),
 * one capital standing alone ("3D Secure", but "1A dormant fee" is a mark on "A"), or a single digit
 * on exactly two capitals ("2FA Token Fee"). The bank's own text decides the rest: the glued token
 * ("3Hill") must open a line or a table cell wherever the text prints it, never sit inside a line
 * ("Call 3Hill CU for Details": 3Hill CU is the credit union's name). With no text, nothing is cut.
 */
const LEADING_FOOTNOTE_MARK = /^(\d{1,2})([A-Za-z][A-Za-z'’\-]*)/;
const NOT_A_LEADING_MARK =
  /^(?:\d+\s*[x×]\s*\d|\d+(?:hrs?|hours?|days?|mos?|months?|yrs?|years?|wks?|weeks?|mins?|minutes?)\b)/i;
/**
 * Case matters here: an ordinal in lower case needs no break after it ("1st", "3rdParty"), one in
 * capitals does ("1ST", but "1Statement fee" is a mark on "Statement"); one capital alone ("3D
 * Secure") or exactly two ("2FA") is a name, "1A dormant fee" is not; and a count of a plural noun
 * per period is a count ("2Checks per month").
 */
const CAPITALS_NAME =
  /^(?:\d+(?:st|nd|rd|th)(?![a-z])|\d+(?:ST|ND|RD|TH)\b|\d[A-Z](?![A-Za-z])(?!\s+[a-z])|\d[A-Z]{2}(?![A-Za-z])|\d{1,2}[A-Za-z][a-z]*s\s+(?:per|each|a|every)\s+(?:month|statement|cycle|quarter|year|day|week)\b)/;

/** True when every place the text prints `token` opens a line or a "|" cell. */
function printedAsLineStart(token: string, texts: readonly string[]): boolean {
  let seen = false;
  for (const text of texts) {
    let index = text.indexOf(token);
    while (index >= 0) {
      const before = text.slice(text.lastIndexOf("\n", index - 1) + 1, index);
      // A longer number ("13Hill" for "3Hill") or a letter right before it is another token.
      const previous = index > 0 ? text[index - 1] : "";
      if (!/[0-9A-Za-z]/.test(previous)) {
        if (!(before.trim() === "" || /\|\s*$/.test(before))) return false;
        seen = true;
      }
      index = text.indexOf(token, index + token.length);
    }
  }
  return seen;
}

/** True when the name opens the way a glued footnote number does, before the page is read. Pure. */
export function hasLeadingFootnoteShape(name: string): boolean {
  const trimmed = name.trim();
  return LEADING_FOOTNOTE_MARK.test(trimmed) && !NOT_A_LEADING_MARK.test(trimmed) && !CAPITALS_NAME.test(trimmed);
}

/** True when the token opens the bank's own name ("5Star Bank", "4Front FCU", "3Hill CU"), spaces aside. */
function opensInstitutionName(token: string, institutionName: string | null | undefined): boolean {
  if (!institutionName) return false;
  return institutionName.replace(/\s+/g, "").toLowerCase().startsWith(token.toLowerCase());
}

/**
 * The name without its leading footnote number, or null when it has none (see above). A token
 * that opens the bank's own name is the bank's brand, never a mark. Pure.
 */
export function withoutLeadingFootnoteMark(name: string, texts: readonly string[], institutionName?: string | null): string | null {
  const trimmed = name.trim();
  const match = trimmed.match(LEADING_FOOTNOTE_MARK);
  if (!match || !hasLeadingFootnoteShape(trimmed)) return null;
  if (opensInstitutionName(`${match[1]}${match[2]}`, institutionName)) return null;
  if (!printedAsLineStart(`${match[1]}${match[2]}`, texts)) return null;
  const rest = trimmed.slice(match[1].length).trim();
  if (!usableName(rest)) return null;
  // A mark on a lower-case word leaves the name opening in lower case ("1monthly minimum balance fee").
  return rest.replace(/^[a-z]/, (letter) => letter.toUpperCase());
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

/**
 * v57: "Go green with eStatements to avoid $3 paper statement fee": the price comes first and
 * the words after it name the fee the reader avoids.
 */
const AVOID_PRICE_FEE = /\bto avoid (?:an?\s+|the\s+)?\$\s?(\d{1,3}(?:\.\d{1,2})?)(?![\d,])\s+((?:[a-z]+[ -]){0,3}(?:fee|charge))s?\b/i;

function avoidPriceFirst(segment: string): ExtractedFeeCandidate | null {
  const match = segment.match(AVOID_PRICE_FEE);
  if (!match) return null;
  const words = normalizeSegment(match[2]);
  const hint = classifyFeeText(words);
  const amount = Number(match[1]);
  const feeName = `${words.charAt(0).toUpperCase()}${words.slice(1)}`;
  if (!hint || !(amount > 0) || !passesDarwinChecks(hint, feeName, amount)) return null;
  return {
    feeName,
    amount,
    frequency: detectFrequency(segment),
    canonicalHint: hint,
    confidence: confidenceFor(segment),
    excerpt: segment,
    waivable: true,
  };
}

export function avoidFeeFromProse(segment: string): ExtractedFeeCandidate | null {
  const match = segment.match(AVOID_FEE_OF);
  if (!match) return avoidPriceFirst(segment);
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

/**
 * v68: what a label with no "fee" or "charge" names when it is not a fee: a balance or
 * minimum an account requires or opens with, a rate or yield, a limit or loan size, or a
 * figure larger than any fee. Null when none applies.
 */
// Run-together labels too ("MinimumOpeningDeposit").
const OPENING_OR_MINIMUM = /\b(?:to open|opening|open(?:ing)? deposit|minimum|min\.|required|requirement|deposit to)\b|minimum ?(?:opening|balance|deposit)|opening ?deposit/i;
const RATE_LINE = /\b(?:APY|APR|annual percentage|interest|dividends?|rates?|yield|earn(?:s|ings)?)\b/i;
const LIMIT_OR_LOAN_SIZE = /\b(?:limits?|maximum|max\.?|up to|loan amounts?|line amounts?|credit lines?|loans? (?:of|over|under)|amount financed|purchase price)\b|\bbalances?\b(?!\s+inquir)|\bexample\b|\btotal\b/i;

export function nonFeeReason(label: string, amount: number): DroppedLineReason | null {
  if (BALANCE_REQUIREMENT.test(label)) return "balance_requirement";
  if (OPENING_OR_MINIMUM.test(label)) return "opening_or_minimum";
  if (RATE_LINE.test(label)) return "rate_line";
  if (LIMIT_OR_LOAN_SIZE.test(label)) return "limit_or_loan_size";
  if (amount > MAX_REASONABLE_FEE_AMOUNT) return "over_max_amount";
  return null;
}

/**
 * v68: a table row of a short label and its prices, every cell after the label a price ("$5",
 * "$22.00 each", "$20.00 per hour") or a free cell, and the label no sentence ("Notary Service |
 * $5", "Night Drop Bag & Keys | $22", "Statement Printout | $2.00 | $2.00").
 */
const LABEL_SENTENCE = /\b(?:you|your|we|our|will|is|are|be|if|when|unless|may|must|per\s+\$)\b|[.;:]\s+\S/i;

export function labelPriceRow(cells: string[]): boolean {
  const [label, ...rest] = cells;
  if (!label || rest.length === 0 || amountsIn(label).length > 0) return false;
  const words = normalizeSegment(label).split(" ").filter(Boolean);
  if (words.length === 0 || words.length > 8 || LABEL_SENTENCE.test(label)) return false;
  return rest.every((cell) => PRICE_ONLY_CELL.test(cell) || ZERO_CELL.test(cell)) && rest.some((cell) => PRICE_ONLY_CELL.test(cell));
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
  // "$20.00 | Domestic outgoing wire": a two-cell row whose first cell is only the price
  // is named by its second cell.
  const rowName = priceFirst && cells?.length === 2 && amounts.length === 1 && PRICE_ONLY_CELL.test(cells[0]) &&
    !OPENING_REQUIREMENT.test(cells[1]) && !/\b(?:you|your|unless|are not|is not)\b/i.test(cells[1]) ? nameFrom(cells[1]) : null;
  let hint = firstAmount
    ? classifyNearest(prefix) ??
      (priceFirst ? priceFirstHint(segment.slice(firstAmount.end, amounts[1]?.start ?? segment.length)) : null) ??
      (rowName && usableName(rowName) ? classifyFeeText(rowName) : null)
    : classifyFeeText(cells ? cells[0] : segment);
  // v57: a markdown table row is named by its first cell when its details cell names nothing
  // ("| Stop Payment Order | Initial order or a renewal | $30.00 | per item |", Arvest).
  const titleCell = cells?.[0]?.replace(/^\|\s*/, "").trim() ?? "";
  if (!hint && firstAmount && /^\s*\|/.test(segment) && (cells?.filter(Boolean).length ?? 0) >= 3 && !amountsIn(titleCell).length) {
    hint = classifyFeeText(titleCell);
  }
  // v62: "Domestic Outgoing (client only) ........ $25.00 per wire" (Northern Trust) names its
  // fee only together with the noun after the price; the name keeps that noun.
  // The name must say which way the wire goes: "Domestic | $20.00 per wire" under an
  // "Incoming" heading names no direction of its own.
  const perWire = !hint && firstAmount != null && !priceFirst && usableName(name) &&
    /\b(?:incoming|outgoing|inbound|outbound|send|sent|receive|received)\b/i.test(name) &&
    /^\s*per\s+wire(?:\s+transfer)?\b/i.test(segment.slice(firstAmount.end)) && !/\bwires?\b/i.test(name);
  if (perWire) hint = classifyFeeText(`${name} wire`);
  // #1291: a bare "Overdrafts" priced per transfer is the share transfer that covers them ("Share
  // Transfer for\nOverdrafts - $2.00 per transfer", raw 112570), not the overdraft fee itself.
  if (hint === "overdraft" && firstAmount != null && /^\W*overdrafts?\W*$/i.test(name) && /^\s*per\s*transfers?\b/i.test(segment.slice(firstAmount.end))) {
    hint = "od_protection_transfer";
  }

  // v76: a free schedule row the shapes below never read (`freeRowName`), held at $0 like them.
  const freeLabel = firstAmount ? null : freeRowName(segment);
  if (freeLabel) {
    const zeroName = nameFrom(freeLabel);
    const zeroHint = usableName(zeroName) ? unpricedRowCategory(zeroName) : null;
    if (zeroHint && !notAZeroPrice(zeroHint, `${zeroName} ${segment}`)) {
      result.held.push({ shape: "zero", feeName: zeroName, amount: 0, amountMax: null, percent: null, frequency, canonicalHint: zeroHint, excerpt: segment });
      return result;
    }
  }

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

  // v76: a price that varies with what the customer picks is held with no amount (`variesRowName`).
  const variesLabel = firstAmount ? null : variesRowName(segment);
  if (variesLabel) {
    const variesName = nameFrom(variesLabel);
    const variesHint = usableName(variesName) ? variesCategory(variesName) : null;
    if (variesHint) {
      result.held.push({ shape: "varies", feeName: variesName, amount: null, amountMax: null, percent: null, frequency, canonicalHint: variesHint, excerpt: segment });
      return result;
    }
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
  if (!firstAmount) {
    // v76: free rows side by side in a two-column page ("• Maintenance Fee: No Maintenance Fee |
    // • Maintenance Fee: No Maintenance Fee"), each cell a free row of its own.
    for (const cell of cells ?? []) {
      const free = freeCellName(cell);
      const zeroName = free ? nameFrom(free) : "";
      const zeroHint = usableName(zeroName) ? unpricedRowCategory(zeroName) : null;
      if (zeroHint && !notAZeroPrice(zeroHint, `${zeroName} ${cell}`) && !result.held.some((held) => held.feeName === zeroName)) {
        result.held.push({ shape: "zero", feeName: zeroName, amount: 0, amountMax: null, percent: null, frequency, canonicalHint: zeroHint, excerpt: segment });
      }
    }
    if (result.held.length > 0) return result;
    // v68: "Inquiry | FREE": a label no rule names beside a free cell is held at $0 in a fee
    // schedule, as a priced label row is.
    const label = cells ? nameFrom(cells[0]) : "";
    if (!hint && cells && cells.length >= 2 && cells.slice(1).every((cell) => ZERO_CELL.test(cell)) && usableName(label)) {
      const nonFee = nonFeeReason(label, 0);
      if (nonFee) countDrop(result, nonFee);
      else result.tableHeld = [{ shape: "unclassified", feeName: label, amount: 0, amountMax: null, percent: null, frequency, canonicalHint: null, excerpt: segment }];
    }
    return result;
  }

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
  // v68: a "FREE" cell of its own in a row of account columns ("Notary Service | FREE | $10 |
  // $10 | FREE", "Copy of Cleared Check | FREE | $5") is one column's price, not a condition:
  // the row's priced columns are read, and its free column is held at $0 below.
  const freeColumns = Boolean(hint && cells && cells.length >= 3 && cells.slice(1).every((cell) => ZERO_CELL.test(cell) || PRICE_ONLY_CELL.test(cell)) &&
    cells.slice(1).some((cell) => ZERO_CELL.test(cell)) && !NEGATIVE_FEE_LANGUAGE.test(cells[0]));
  // v76: a second fee's own "name | Free" pair after this row's price ("External Transfer | $20.00 |
  // Overdraft Protection Transfer from Shares | Free", a two-column table) is held at $0, and its
  // free word is no condition on the row's priced fee.
  // A cell that is a free row of its own ("E-Statements ......FREE | Money Order ...... $1.50") is
  // held at $0 the same way.
  const trailingFree = cells && cells.length >= 4 && !freeColumns && amountsIn(cells.at(-2) ?? "").length === 0 &&
    amountsIn(cells.at(-3) ?? "").length > 0 ? freeRowName(cells.slice(-2).join(CELL_SEPARATOR)) : null;
  const freeCells = cells && !freeColumns ? cells.map((cell) => (amountsIn(cell).length === 0 ? freeCellName(cell) : null)) : [];
  for (const free of [trailingFree, ...freeCells]) {
    if (!free) continue;
    const zeroName = nameFrom(free);
    const zeroHint = usableName(zeroName) ? unpricedRowCategory(zeroName) : null;
    if (zeroHint && !notAZeroPrice(zeroHint, zeroName) && !result.held.some((held) => held.feeName === zeroName)) {
      result.held.push({ shape: "zero", feeName: zeroName, amount: 0, amountMax: null, percent: null, frequency: null, canonicalHint: zeroHint, excerpt: segment });
    }
  }
  const conditionText = freeColumns
    ? cells!.filter((cell) => !ZERO_CELL.test(cell)).join(CELL_SEPARATOR)
    : trailingFree || freeCells.some(Boolean)
      ? cells!.filter((cell, index) => !freeCells[index] && !(trailingFree && index >= cells!.length - 2)).join(CELL_SEPARATOR)
      : segment;
  if (NEGATIVE_FEE_LANGUAGE.test(freeColumns ? cells![0] : prefix) || (NEGATIVE_FEE_LANGUAGE.test(conditionText) && !WAIVER_LANGUAGE.test(conditionText))) {
    return result;
  }
  if (freeColumns && hint && !notAZeroPrice(hint, cells![0]) && usableName(nameFrom(cells![0]))) {
    result.held.push({ shape: "zero", feeName: nameFrom(cells![0]), amount: 0, amountMax: null, percent: null, frequency, canonicalHint: hint, excerpt: segment });
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
  // v68: the free column is not part of the name ("Stop Payment | FREE | $25" is "Stop Payment").
  if (freeColumns && usableName(nameFrom(cells![0]))) feeName = nameFrom(cells![0]);
  // v68: a box size row priced per year ("2×5 | $ 25/Year") is named by its size: the unit
  // left after the price ("/Year") is not a name.
  if (cells && BOX_SIZE_NAME.test(cells[0].trim()) && cells.slice(1).every((cell) => PRICE_ONLY_CELL.test(cell.trim()))) {
    feeName = cells[0].trim();
  }
  if (perWire && !/\bwires?\b/i.test(feeName)) feeName = `${feeName} wire`;
  // v62: a name cut at its length limit inside a parenthesis ("... Nonsufficient Funds (includes
  // but not limited to overdrafts created by check, in-") is named by the words before it.
  const cutParen = feeName.length >= MAX_NAME_CHARS - 2 && parenBalance(feeName) > 0 ? feeName.slice(0, feeName.lastIndexOf("(")).trim() : "";
  if (usableName(cutParen)) feeName = cutParen;
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
    // A line that says "fee" or "charge" keeps its v27 guards; one that does not must also pass
    // the other non-fee guards (`nonFeeReason`).
    const feeWord = /\b(fee|charge)s?\b/i.test(segment);
    const nonFee = feeWord
      ? BALANCE_REQUIREMENT.test(feeName) ? "balance_requirement" : feeAmounts[0].value > MAX_REASONABLE_FEE_AMOUNT ? "over_max_amount" : null
      : nonFeeReason(feeName, feeAmounts[0].value);
    if (!usableName(feeName)) {
      countDrop(result, "no_name");
    } else if (nonFee) {
      countDrop(result, nonFee);
    } else if (feeWord) {
      result.held.push({ shape: "unclassified", feeName, amount: feeAmounts[0].value, amountMax: null, percent: null, frequency, canonicalHint: null, excerpt: segment });
    } else if (cells && labelPriceRow(cells)) {
      // v68: "Notary Service | $5", "Night Drop Bag & Keys | $22": a label and its price in a
      // table row are held for review in a fee schedule (`extractCandidatesFromText` decides).
      result.tableHeld = [{ shape: "unclassified", feeName, amount: feeAmounts[0].value, amountMax: null, percent: null, frequency, canonicalHint: null, excerpt: segment }];
    } else {
      countDrop(result, "no_fee_word_not_table_row");
    }
    return result;
  }

  // v76: one row naming a price for each variant of its fee ("Domestic Outbound Wires
  // (Online/Manual) | $35/$60", "-Notary FL/GA $10.00/$2.00"), or a box size priced in two
  // columns, reads every price.
  // The rest of the row (another fee's cell after them) is read as before.
  const paired = pairedPriceCandidates(segment, feeAmounts, feeName, hint, frequency, waivable);
  if (paired) result.candidates.push(...paired.reads);

  // The first amount belongs to the line's fee. A later amount is another fee only when
  // the words just before it name one ("Stop payment $30; Wire, outgoing $25"); otherwise
  // it is a cap, a second account column, or a condition, and is ignored.
  feeAmounts.forEach((amount, index) => {
    if (paired?.consumed.includes(amount)) return;
    // #1196: the unit right after the earlier price is that price's ("Dormant accounts |
    // $15.00 per month Nonsufficient funds | $35.00"), not the next fee's name or period.
    const unitAfterPrevious = index === 0 ? null : segment.slice(feeAmounts[index - 1].end, amount.start).match(PRICE_UNIT_AFTER);
    const ownStart = index === 0 ? 0 : feeAmounts[index - 1].end + (unitAfterPrevious?.[0].length ?? 0);
    const between = index === 0 ? null : nameFrom(segment.slice(ownStart, amount.start));
    const ownFrequency = unitAfterPrevious ? detectFrequency(segment.slice(ownStart)) : frequency;
    // v19: "$30.00 - fee assessed for each item paid1 Continuous Overdraft Fee ..... $5.00":
    // the lowercase words finish the earlier price's terms; the title that ends them is the name.
    const tail = between && /^[^A-Z]/.test(between) ? titleTail(between) : null;
    const chunk = tail && classifyFeeText(tail) ? tail : between;
    const chunkHint = chunk ? classifyFeeText(chunk) : null;
    if (index > 0 && (!chunk || !usableName(chunk) || !chunkHint)) return;
    // v22: "... you will be assessed a fee of $25.00 on the 7th day. This fee is in addition to
    // any Overdraft Fees assessed. | $25.00": the row's price cell repeats the price in its own cell.
    const priceCellAt = segment.lastIndexOf(CELL_SEPARATOR);
    // #1196: not when the earlier price ends on its own unit ("$25.00/hr Wire message | $25.00").
    if (index > 0 && !unitAfterPrevious && cells && amount.value === feeAmounts[index - 1].value && amount.start > priceCellAt &&
      PRICE_ONLY_CELL.test(cells.at(-1) ?? "") && segment.lastIndexOf(CELL_SEPARATOR, priceCellAt - 1) < feeAmounts[index - 1].start) return;
    const candidateName = index === 0 ? feeName : (chunk as string);
    const canonicalHint = index === 0 ? hint : (chunkHint as string);
    if (!usableName(candidateName) || amount.value <= 0 || amount.value > MAX_REASONABLE_FEE_AMOUNT) return;
    if (segment.slice(amount.end, amount.end + 3).includes("%")) return;
    result.candidates.push({
      feeName: candidateName,
      amount: amount.value,
      frequency: ownFrequency,
      canonicalHint,
      confidence: confidenceFor(segment),
      excerpt: segment,
      waivable,
    });
  });
  return result;
}

/**
 * v76 (Knox recall, 62-bank answer key): a row that prices each variant of its fee, or its first
 * unit and each unit after it. Read line by line, only the first price was the fee and the rest
 * were dropped as "a cap, a second account column, or a condition" (112 of the key's 833 misses).
 *
 *   "Domestic Outbound Wires (Online/Manual) | $35/$60"  Online $35, Manual $60
 *   "Wire Transfers – Foreign Incoming / Outgoing | $15 / $40"  incoming $15, outgoing $40
 *   "-Notary FL/GA $10.00/$2.00"  FL $10, GA $2
 *   "Debit Card Replacement Fee | $10.00 / $50 expedited delivery"  $10, and $50 expedited
 *   "2” x 5” $45.00 $65.00"  a box size priced in two columns: both are the box's prices
 *
 * A first-unit price and an add-on ("$3 first page, $1 each additional page") stay one read: the
 * shared source check reads an add-on as no fee's own price while the row prints another.
 *
 * Each variant takes the category its own name reads as (incoming and outgoing wires part), or
 * the row's when it names none, and must pass Darwin's checks. The variant count must equal the
 * price count; a slash pair with no variants in the name and no words after the second price
 * ("Courtesy Pay | $35/$35") keeps today's read of the first price. Null when the row is not one
 * of these shapes, so the line rules read it as before.
 */
const SLASH_JOINER = /^\s*\/\s*$/;
const NAME_VARIANTS = /([A-Za-z][\w'’-]*)\s*\/\s*([A-Za-z][\w'’-]*)(?:\s*\/\s*([A-Za-z][\w'’-]*))?/g;
/** Words after the last price of a slash pair that name the second variant ("expedited delivery"). */
const VARIANT_QUALIFIER = /^\s*((?:[A-Za-z][\w'’-]*\s*){1,3})(?=$|\|)/;
const BOX_PRICE_JOINER = /^\s*(?:\|\s*)?$/;
const BOX_PRICE_AFTER = /^\s*(?:\/?\s*(?:year|yr|annually|annual|per year|a year))?\s*$/i;

function slashVariantNames(feeName: string, count: number, qualifierText: string): string[] | null {
  const variants = [...feeName.matchAll(NAME_VARIANTS)].filter((match) => match.slice(1).filter(Boolean).length === count);
  // The variants nearest the prices: "Wire Transfers – Foreign Incoming / Outgoing" splits its last pair.
  const match = variants.at(-1);
  if (match && match.index != null) {
    const parts = match.slice(1).filter(Boolean);
    // Not a fee named by a joined word ("24/7", "w/o", "and/or", "N/A").
    if (parts.some((part) => /^(?:or|o|a|and|7)$/i.test(part))) return null;
    return parts.map((part) => `${feeName.slice(0, match.index)}${part}${feeName.slice(match.index! + match[0].length)}`.replace(/\(\s*([^()]*?)\s*\)/g, "($1)"));
  }
  if (count !== 2) return null;
  const qualifier = qualifierText.match(VARIANT_QUALIFIER)?.[1]?.trim();
  if (!qualifier || LABEL_SENTENCE.test(qualifier) || /^(?:each|ea|per|item|month|mo|year|yr|hour|hr|copy|page|check|request|fee|charge)s?\b/i.test(qualifier)) return null;
  return [feeName, `${feeName} ${qualifier}`];
}

function pairedPriceCandidates(
  segment: string,
  feeAmounts: AmountMatch[],
  feeName: string,
  hint: string,
  frequency: string | null,
  waivable: boolean,
): { reads: ExtractedFeeCandidate[]; consumed: AmountMatch[] } | null {
  const [first, second] = feeAmounts;
  if (!first || !second || !usableName(feeName)) return null;
  const between = segment.slice(first.end, second.start);
  const read = (name: string, amount: number, canonicalHint: string): ExtractedFeeCandidate | null =>
    usableName(name) && amount > 0 && amount <= MAX_REASONABLE_FEE_AMOUNT && passesDarwinChecks(canonicalHint, name, amount)
      ? { feeName: name, amount, frequency, canonicalHint, confidence: confidenceFor(segment), excerpt: segment, waivable }
      : null;

  if (SLASH_JOINER.test(between)) {
    const run = [first, second];
    for (const next of feeAmounts.slice(2)) {
      if (!SLASH_JOINER.test(segment.slice(run.at(-1)!.end, next.start))) break;
      run.push(next);
    }
    if (run.length > 3 || segment.slice(run.at(-1)!.end, run.at(-1)!.end + 3).includes("%")) return null;
    const names = slashVariantNames(feeName, run.length, segment.slice(run.at(-1)!.end));
    if (!names) return null;
    const reads = names.map((name, index) => read(name, run[index].value, classifyFeeText(name) ?? hint));
    return reads.every(Boolean) ? { reads: reads as ExtractedFeeCandidate[], consumed: run } : null;
  }

  if (hint === "safe_deposit_box" && feeAmounts.length === 2 && BOX_SIZE_NAME.test(feeName.replace(/["”″]/g, "").trim()) &&
    BOX_PRICE_JOINER.test(between) && BOX_PRICE_AFTER.test(segment.slice(second.end))) {
    const reads = [read(feeName, first.value, hint), read(feeName, second.value, hint)];
    return reads.every(Boolean) ? { reads: reads as ExtractedFeeCandidate[], consumed: [first, second] } : null;
  }
  return null;
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

/**
 * v63: a safe deposit box size and its rent printed in the next column ("Return Item Fee | 03 x
 * 10….....$45", doc 20570, UAT Oct 9) is the box table's row, not the fee's price: the $45 went
 * live as the return item fee (73956). The size cell starts its own line, so it reads as a box
 * rent and the fee's own line carries no price.
 */
const GLUED_BOX_SIZE_CELL = /\s*\|\s*(\d{1,2}\s?[x×]\s?\d{1,2}(?![\d.])[\s.…_-]*\$\s?\d)/gi;
/** Text before the cell that is the box table's own heading ("Safe Deposit Box Rental | 3 x 5 - $20"). */
const BOX_HEADING = /\b(safe|safety|deposit|box(es)?|rental|rent|sizes?)\b/i;

export function withBoxSizeCellsSplit(text: string): string {
  return text
    .split("\n")
    .map((line) => line.replace(GLUED_BOX_SIZE_CELL, (match, cell: string, offset: number) =>
      BOX_HEADING.test(line.slice(0, offset)) ? match : `\n${cell}`))
    .join("\n");
}

/**
 * v64: a box table printed sideways, a row of sizes over a row of prices ("... | 3x5 | 5x5 | 3x10
 * | 5x10 | 10x10" over "... | $60 | $80 | $90 | $110 | $185", SCCU 8109). Knox read the first price
 * as the neighbouring cell's fee and the rest not at all. Each size and the price under it become
 * their own "size | price" line after the pair ("×" written as "x"); the cells before the run stay
 * on their lines.
 */
const BOX_SIZE_ONLY_CELL = /^\d{1,2}(?:\.\d)?\s?[x×]\s?\d{1,2}(?:\s?[x×]\s?\d{1,2})?$/i;
const BARE_PRICE_CELL = /^\$\s?\d[\d,]*(?:\.\d{2})?$/;
const SIDEWAYS_BOX_MIN = 2;

function trailingRun(cells: string[], test: (cell: string) => boolean): number {
  let count = 0;
  while (count < cells.length && test(cells[cells.length - 1 - count])) count += 1;
  return count;
}

export function withSidewaysBoxTable(text: string): string {
  const lines = text.split("\n");
  const out: string[] = [];
  for (let index = 0; index < lines.length; index += 1) {
    const sizes = lines[index].split("|").map((cell) => cell.trim());
    // One blank line may sit between the two rows ("Size | 2 × 5 | ..." / "" / "Cost | $17.50 | ...").
    const priceIndex = lines[index + 1]?.trim() === "" ? index + 2 : index + 1;
    const prices = (lines[priceIndex] ?? "").split("|").map((cell) => cell.trim());
    const run = trailingRun(sizes, (cell) => BOX_SIZE_ONLY_CELL.test(cell));
    if (run < SIDEWAYS_BOX_MIN || trailingRun(prices, (cell) => BARE_PRICE_CELL.test(cell)) !== run) {
      out.push(lines[index]);
      continue;
    }
    const sizeLead = sizes.slice(0, sizes.length - run).filter(Boolean).join(" | ");
    const priceLead = prices.slice(0, prices.length - run).filter(Boolean).join(" | ");
    if (sizeLead) out.push(sizeLead);
    if (priceLead) out.push(priceLead);
    for (let cell = 0; cell < run; cell += 1) {
      out.push(`${sizes[sizes.length - run + cell].replace(/\s?×\s?/g, " x ")} | ${prices[prices.length - run + cell]}`);
    }
    index = priceIndex;
  }
  return out.join("\n");
}

/**
 * v62: a fee whose name carries a footnote mark ("Overdraft - Insufficient Funds / Uncollected2
 * $40.00") is a business price when that footnote says so ("2 Created by check, ... Only
 * applicable to business accounts. This fee is not charged to consumer accounts.", ConnectOne
 * 135). Its line is left out, so the consumer page never shows it.
 */
const BUSINESS_ONLY_NOTE =
  /\b(?:only (?:applicable|applies) to business(?: accounts?)?|not (?:charged|assessed) (?:to|on) (?:consumer|personal) accounts?)\b/i;
const FOOTNOTE_LINE = /^\s*(\d{1,2})\s+[A-Z]/;
const GLUED_MARK = /[a-z)](\d{1,2})(?=\s*(?:\||\$|\.{3,}|$))/gi;

export function withoutBusinessOnlyFees(text: string): string {
  if (!BUSINESS_ONLY_NOTE.test(text)) return text;
  const lines = text.split("\n");
  // A note may wrap onto the next line, unless that line is the next note.
  const businessNote = (index: number) => {
    const next = lines[index + 1] ?? "";
    return BUSINESS_ONLY_NOTE.test(FOOTNOTE_LINE.test(next) ? lines[index] : `${lines[index]} ${next}`);
  };
  // A mark points at the first note with its number below the fee: a schedule whose pages each
  // carry their own notes numbers them again from 1 (Ameris).
  const noteBelow = (index: number, mark: string) => {
    for (let below = index + 1; below < lines.length; below += 1) {
      if (lines[below].match(FOOTNOTE_LINE)?.[1] === mark) return below;
    }
    return -1;
  };
  return lines
    .filter((line, index) => {
      if (FOOTNOTE_LINE.test(line)) return true;
      return ![...line.matchAll(GLUED_MARK)].some((mark) => {
        const note = noteBelow(index, mark[1]);
        return note >= 0 && businessNote(note);
      });
    })
    .join("\n");
}

/** #1196: a price's own unit right after it ("$15.00 per month", "$25.00/hr", "$5.00/statement", "$10.00 each"). */
const PRICE_UNIT_AFTER = /^\s*(?:\/\s*(?:statement|stmt|hr|hour|item|month|mo|sheet|check|year|yr|day|page|copy|request)\b|per\s+(?:month|item|year|statement|check|hour|sheet|day|page|copy|request)\b|each\b|ea\b\.?)/i;


/** Only labels the existing taxonomy recognizes leave the legacy fragment readers. */
export function recognizedFeeBullets(text: string) {
  return feeBullets(text).filter((row) => classifyFeeText(row.title) != null);
}

export function extractCandidatesFromText(input: string): ExtractionRulesResult {
  const raw = withDroppedDecimalPoints(input);
  // v48: a fee-change notice's row is read at its newest column ("Money Orders | $2.00 | $5.00").
  const scoped = scopedFeeStatements(raw);
  const handledLines = new Set(scoped.map((fee) => fee.excerpt));
  const remaining = raw.split("\n").filter((line) => !handledLines.has(line.trim())).join("\n");
  const text = withoutBusinessOnlyFees(stripPriceFootnoteMarks(newestColumnText(remaining)));
  const seen = new Set<string>();
  const result: ExtractionRulesResult = {
    candidates: scoped.map((fee) => ({ ...fee, frequency: null, confidence: 0.98, waivable: false })),
    held: [],
  };
  const owned = recognizedFeeBullets(text);
  const legacyText = withoutFeeBullets(text, owned);
  for (const row of owned) {
    if (row.problem || row.price == null || row.priceText == null) {
      countDrop(result, "wrapped_bullet_unresolved");
      continue;
    }
    // Existing price/category guards read a bounded primary label and its own price.
    // Full conditions remain in the excerpt and the shared own-row source witness.
    const read = extractFromSegment(`${row.title} | ${row.priceText}`);
    for (const candidate of read.candidates) {
      if (!passesDarwinChecks(candidate.canonicalHint, row.title, candidate.amount)) continue;
      result.candidates.push({ ...candidate, feeName: row.title, excerpt: row.compactText, ownedBullet: true,
        ...(row.linkedConditions ? { linkedConditions: row.linkedConditions } : {}),
        frequency: detectFrequency(row.text), waivable: WAIVER_LANGUAGE.test(row.text) });
    }
  }
  const joinedLines = [...columnContinuations(legacyText), ...wrappedNamePrices(legacyText), ...centeredNamePrices(legacyText)];
  const continued = joinedLines.flatMap((line) => extractFromSegment(line).candidates);
  for (const candidate of [...itemAmountTierFees(legacyText), ...continued]) {
    if (!passesDarwinChecks(candidate.canonicalHint, candidate.feeName, candidate.amount)) continue;
    const key = `fee:${candidate.canonicalHint}:${candidate.feeName.toLowerCase()}:${candidate.amount}`;
    if (seen.has(key)) continue;
    seen.add(key);
    result.candidates.push(candidate);
  }
  let unclassified = 0;
  const tableHeld: HeldFeeCandidate[] = [];
  const keep = (held: HeldFeeCandidate): void => {
    const key = `held:${held.shape}:${held.feeName.toLowerCase()}:${held.amount}:${held.percent}`;
    if (seen.has(key)) return;
    const unpricedHold = isUnpricedHeldShape(held.shape);
    const sameHalf = result.held.filter((row) => isUnpricedHeldShape(row.shape) === unpricedHold).length;
    if (sameHalf >= MAX_HELD_PER_DOCUMENT || (held.shape === "unclassified" && unclassified >= MAX_UNCLASSIFIED_PER_DOCUMENT)) {
      if (held.shape === "unclassified") countDrop(result, "unclassified_cap");
      return;
    }
    seen.add(key);
    if (held.shape === "unclassified") unclassified += 1;
    result.held.push(held);
  };
  // v69: a heading whose rows read as another kind of fee is a column beside a second table
  // ("Non-Ameris Bank ATM Usage:" over "ACH File Fee | $15.00"), so it names none of the rows under it.
  const crossedHeadings = new Set<number>();
  // v78: the kind of the last read above, in the same section: a bare late fee takes the box's
  // kind only while no heading line (a "Loan Fees" title) has come between them.
  let previousKind: string | null = null;
  let previousSection = -1;
  for (const { segment, heading, headingAt, headingOpensRows, section } of candidateSegments(legacyText)) {
    if (section !== previousSection) previousKind = null;
    previousSection = section;
    let found = extractFromSegment(segment);
    const crossedBefore = headingAt != null && crossedHeadings.has(headingAt);
    const headingKey = heading ? classifyPatternKey(heading) : null;
    // v76: a free line under a fee heading whose own read is another kind of fee is a row of the
    // heading's table ("Excessive withdrawals, each:" over "ATM or counter | None" and
    // "3rd party/Telephonic | $5.00"): no $0 fee of its own, and it never crosses the heading.
    // Only the first row under a heading that opens its rows with a colon: under a plain section
    // title ("Official Checks/Money Orders" over "Official Check Payable to Account Holder | No
    // charge"), or further down ("Check copy, up to 5 checks per month | No charge"), a free row is
    // its own fee, as before v76.
    const headingKind = heading ? classifyFeeText(heading) : null;
    if (heading && headingKey && headingAt != null && headingOpensRows && !/[$%]/.test(segment)) {
      found = { ...found, held: found.held.filter((read) => read.shape !== "zero" || read.canonicalHint === headingKind) };
    }
    // v78: under another fee's heading, a checking product's free row is a column of that fee's
    // table ("Cashier's Checks" over "Performance Select Checking ... No charge"), not the account's
    // own monthly fee, and it never crosses the heading.
    if (headingKind && headingKind !== "monthly_maintenance") {
      found = { ...found, held: found.held.filter((read) => !(read.canonicalHint === "monthly_maintenance" && FREE_CHECKING_ROW.test(read.feeName))) };
    }
    // A row that names its own fee and no category ("ACH File Fee (per file) | $15.00") crosses it too.
    const readKinds = [...found.candidates, ...found.held].map((read) => read.canonicalHint).filter(Boolean);
    const ownFeeRow = found.held.some((read) => read.canonicalHint == null && /\b(?:fee|charge)s?\b/i.test(read.feeName));
    if (headingAt != null && (ownFeeRow || (headingKey && readKinds.some((kind) => kind !== classifyFeeText(heading as string))))) {
      crossedHeadings.add(headingAt);
    }
    // v69: a line dropped for naming no fee is read under the fee heading above it.
    if (heading && headingAt != null && !crossedHeadings.has(headingAt) && found.candidates.length === 0 && found.held.length === 0 && (found.tableHeld?.length || found.dropped?.no_fee_word_not_table_row)) {
      const headed = readUnderHeading(segment, heading);
      if (headed.length > 0) found = { candidates: headed, held: [] };
    }
    for (const read of found.candidates) {
      // v78: a bill pay read under an overdraft or NSF heading is that fee (#1304); a bare late fee
      // right after a safe deposit box read is the box's.
      const headed = billPayByHeading(read, crossedBefore ? null : heading);
      if (!headed) continue;
      const candidate = boxLateFee(headed, headingKind === "safe_deposit_box" && !crossedBefore ? headingKind : previousKind);
      const key = `fee:${candidate.canonicalHint}:${candidate.feeName.toLowerCase()}:${candidate.amount}`;
      if (seen.has(key) || result.candidates.length >= MAX_FEES_PER_DOCUMENT) continue;
      seen.add(key);
      result.candidates.push(candidate);
    }
    const lastKind = [...found.candidates, ...found.held].map((read) => read.canonicalHint).filter(Boolean).at(-1);
    if (lastKind) previousKind = lastKind;
    for (const held of found.held) keep(held);
    tableHeld.push(...(found.tableHeld ?? []));
    for (const [reason, count] of Object.entries(found.dropped ?? {})) countDrop(result, reason as DroppedLineReason, count);
  }
  // v68: label-and-price rows no rule names are held only in a fee schedule (one that names
  // itself so or where the rules read five fees), after the lines that say "fee", so they never
  // crowd those out of the per-document cap.
  const feeSchedule = result.candidates.length >= FEE_SCHEDULE_MIN_FEES || FEE_SCHEDULE_TITLE.test(text);
  for (const held of tableHeld) {
    if (feeSchedule) keep(held);
    else countDrop(result, "not_fee_schedule");
  }
  return result;
}

const FEE_SCHEDULE_MIN_FEES = 5;
const FEE_SCHEDULE_TITLE = /\b(?:schedule of (?:fees|charges|service charges)|fee schedule|(?:fees?|service charges?) (?:and|&) (?:charges|fees)|truth in savings)\b/i;
