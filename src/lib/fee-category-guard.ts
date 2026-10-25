/**
 * Category guard: does a fee line's own name support the canonical category it was
 * filed under?
 *
 * The catalog's canonical_fee_key is assigned upstream and is sometimes wrong (an
 * "ATM withdrawal" filed as overdraft, a wire trace filed as an outgoing wire, a
 * savings account's monthly fee filed as checking maintenance). Darwin uses this guard
 * before verifying a row, Hamilton before publishing one, and the Hamilton
 * `category-guard` repair step to roll back live rows that fail it.
 *
 * Only the categories below are guarded; every other key passes. The name patterns
 * start from the report studio's rules (Reports/studio/pull-data.sql, rules v2) so the
 * reports, the catalog and the public pages agree on what counts as each fee.
 *
 * Amounts are not checked here: Darwin's per-category envelopes
 * (src/lib/agents/darwin/envelopes.ts) own the plausible range, and Hamilton's outlier
 * rollback applies them to live rows, so there is one definition of a plausible price.
 * The one exception is a dollar amount in a category that is usually a rate (below).
 */

import { boxSectionLateFee } from "@/lib/custom-report/box-section-late-fee";
import { collectionSectionReturn } from "@/lib/custom-report/collection-section-return";
import { namedForCheckingAccount } from "@/lib/checking-fee-name";
import { ATM_ABROAD, COLLECTION_ITEM, DRAFT_PROTECTION_FEE, foldRetiredCategory, FOREIGN_DEPOSIT_RETURN, FOREIGN_ITEM_RETURN, INCOMING_WIRE, INTERNATIONAL_ATM, IRA_CLOSING, ITEM_COPY, RESEARCH_SPLIT_LIVE, SKIP_A_PAY, SUSTAINED_OVERDRAFT } from "@/lib/fee-fold";

export type CategoryGuardCode = "name_contradicts" | "name_unsupported" | "rate_as_amount" | "schedule_contradicts" | "amount_implausible";

/** What a caller knows about the fee besides its name; enables the rate check. */
export interface CategoryGuardContext {
  amount?: number | string | null;
  conditions?: string | null;
  /** The highest NSF or insufficient-funds price elsewhere on the same schedule, when known. */
  document_nsf_amount?: number | string | null;
  /**
   * v84 (#1788): the line printed right above the fee's own line in its stored text
   * (`headingAboveExcerpt`), when the caller read it. Read only for a generic monthly charge.
   */
  heading_above?: string | null;
  /**
   * v87 (#1916): the fee's stored text prints it in a safe deposit box section (`boxSectionLateFee`),
   * when the caller read it (`withBoxSection`). Read only for a late payment.
   */
  box_section?: boolean | null;
  /**
   * v90 (#1912): the fee's stored text prints it in a foreign check or collection section
   * (`collectionSectionReturn`), when the caller read it (`withCollectionSection`). Read only for NSF.
   */
  collection_section?: boolean | null;
}

export type CategoryGuardVerdict =
  | { ok: true }
  | { ok: false; code: CategoryGuardCode; reason: string };

interface CategoryRule {
  /** The fee name must mention one of these to count as this category. */
  include: RegExp;
  /** A fee name matching this describes a different fee, whatever it was filed as. */
  exclude: RegExp;
  /**
   * Words that describe a different fee unless the name also matches `unless`. With `outsideNotes`,
   * `unless` reads the name without its notes: "Overdraft Return Item Fee (Fee applies to each
   * overdraft or returned item ...)" is the return item fee, whatever the note joins.
   */
  excludeUnless?: { pattern: RegExp; unless: RegExp; outsideNotes?: boolean };
  /**
   * A per-item fee whose own note states how many are charged a day ("Overdraft Item Fee
   * (Maximum of 5 Charged Per Day)") is that fee, not the daily cap: `exclude` words matching
   * `cap` are ignored inside a note when the name outside its notes matches `item` and nothing
   * in `exclude`, and the note counts items and names no dollar amount (v29).
   */
  capInNotes?: { cap: RegExp; item: RegExp };
  /**
   * v74: the `exclude` words count only when a re-file rule moves the fee to a category that
   * accepts it, so the rule re-files and never takes a fee down on its own (account research:
   * "Club Accounts - Excess Withdrawal Fee" has no other home and stays).
   */
  onlyIfRefiles?: boolean;
  /** v74: like `exclude`, but matched with case (an all-capitals abbreviation, `NAMED_OWN_ATM`). */
  excludeExact?: RegExp;
}

const RETURNED_ITEM = String.raw`(?:nsf\s+)?return(?:ed)?\s+(?:check|item)s?(?:\s+(?:fee|charge)s?)?`;
const OVERDRAFT_ITEM = String.raw`(?:(?:paid\s+)?(?:overdraft|\bod\b)(?:\s+(?:fee|charge|item)s?)?|(?:nsf\s+)?paid\s+items?(?:\s+(?:fee|charge)s?)?)`;
const JOINED = String.raw`\s*(?:\/|\bor\b|\band\b|&)\s*(?:an?\s+)?`;
// An insufficient or uncollected funds fee "Returned item/overdraft" is that fee, and "Other fees
// such as overdraft or returned item fees may apply" names no price.
const OVERDRAFT_AND_RETURNED = new RegExp(
  String.raw`^(?!\s*(?:insufficient|uncollected|other fees|effective)\b)(?!.*\bmay apply\b).*(?:` +
    `${RETURNED_ITEM}${JOINED}${OVERDRAFT_ITEM}|${OVERDRAFT_ITEM}${JOINED}${RETURNED_ITEM})`,
  "i",
);

// v47: "Foreign Wire Research" is account research, not a wire (Darwin eval, Oct 8).
/**
 * v53: a business or commercial account's wire price ("Business Wire Transfer Incoming (domestic)
 * | $20.00", 3Hill FCU 28215, shown as the consumer price in the sample report). A name that also
 * says consumer or personal covers both and stays; "business day" is a cut-off, not a payer.
 */
const BUSINESS_ONLY = String.raw`^(?!.*\b(consumer|personal|retail|individual)\b).*\b(business|commercial|corporate)\b(?!\s+days?\b)`;
const WIRE_CORRECTIONS = "trace|reversal|recall|amend|investigat|research|return";
// "Int'l Wire Fee Out" is an international wire; one price for "Domestic & Int'l" stays domestic.
const INTL_ABBREV = String.raw`^(?!.*\bdomestic\b).*\bint['’]l\b`;
/** Express, priority or two-day delivery of a card: the rush card fee, not the plain replacement. */
const EXPRESS_CARD = String.raw`\bexpress\b(?!\s*chip)|\bpriority\s+(deliver|ship|mail)|\bpriority\s*$|\b(two|2)[- ]day deliver|\bnext[- ]day\b`;
/** Closing an account soon after opening it: the early closure fee, not a balance fee. */
const EARLY_CLOSE = String.raw`\bearly (account )?(clos|terminat)|\bclos(e|ed|ing|ure)( of)? account|\baccount (clos|terminat)`;
/** A fee for an account with no activity: the dormant account fee, not a balance fee. */
const INACTIVE = String.raw`inactiv|no activity|dorman`;
/**
 * v63 (#1312): Spanish fee names. Puerto Rico credit unions publish their schedules in Spanish
 * (Puerto Rico FCU's "Sobregiros" $10, raw 262766; Vapr FCU's "Cheques devueltos" $20), and some
 * U.S. banks publish a Spanish copy beside the English one (General Electric Employees FCU,
 * Sound FCU, OnPoint). Each guarded category's name test reads the common Spanish words for its
 * fee, and the Spanish words for a different fee keep it out, as the English words do.
 */
const ES_INTL = "internacional|extranjer";
const ES_INCOMING = "entrante|recibid";
const ES_OUTGOING = "saliente|enviad";
/**
 * v88 (#1912): a book transfer moves money to another account at the same bank ("Transferencia
 * bancaria saliente a una cuenta en M&T (transferencia contable)" $16, M&T 145046, beside its $32
 * outgoing wire; "Outgoing Wire Transfer within IBC (Book Transfer)" $10). It is not a domestic wire
 * out of the bank, and pooled with one it pulls the bank's wire price down. A wire price that only
 * says it also covers book transfers ("incluidas las transferencias contables") stays.
 */
/**
 * v90 (#1912): a name that names the safe deposit box ("Safety Deposit Box-Late Fee", "Safe Box Late
 * Fee - Per Month after 3 months", "SDB Late Payment", "Late charge for safety deposit box rental
 * after 10 days"). A night deposit box is the night depository's, not this.
 */
const SAFE_DEPOSIT_BOX_NAME = /\bsafe(?:ty)?[\s-]*(?:deposit|box)|\bsdb\b|(?<!night[\s-])\bdeposit\s+box(?:es)?\b/i;
const BOOK_TRANSFER = String.raw`^(?![\s\S]*(?:\b(?:includ|incluid|exclud|excluy)\w*|\bincl\b|\bfree\b|\bwaiv\w*|\bno\s+charge|\bor\s+book))[\s\S]*(?:\bbook[- ]?(?:entry\s+)?transfers?\b|\btransferencias?\s+contables?\b)`;
/** "Transferencia bancaria" and "Giro bancario" are a wire in a Spanish schedule. */
const WIRE = /(wire|transferencias? (bancarias?|cablegr[aá]ficas?)|giros? bancarios?)/i;
/**
 * v71 (#1772): another institution's card named in more than one word after "non-": "ATM Non-STAR
 * Financial Credit Union card Surcharge" $5 (55200), "ATM Surcharge Fee (Non-Onomea FCU Cards)" $2
 * (125475), "Transactions at TFed ATM (Non-TFed Debit/ATM Card)" $3.50 (37295), "Non Co-Op Card ATM
 * Withdrawals at TLC" $3 (135353), "Non-WPCCU or Non-CO-OP Debit Card ATM withdrawal" $3 (52328),
 * "Non-AFCU Visa debit, credit card, or ... card ATM transactions will be assessed a" $2 (139525).
 * The words after "non-" may not reach an ATM or machine first ("Non-Allpoint ATM using your card" is
 * a non-network ATM), and "non-proprietary", "non-network" and "non-owned" never start one.
 */
const OUTSIDER_CARD_WORDS = String.raw`\bnon[- ](?!(?:proprietary|network|owned)\b)[\w.&',-]+(?:\s+(?!(?:atms?|machines?)\b)[\w.&',\/-]+){0,3}\s+(?:visa\s+)?(?:debit\s*(?:\/\s*atm\s*)?|atm\s*(?:\/\s*debit\s*)?|check\s+)?cards?\b`;
/**
 * v69: the surcharge an institution charges people who are not its customers for using its own
 * ATMs: a non-customer, non-client or non-account holder ("ATM Surcharge (non-customer)" $4,
 * 16809), another institution's card or cardholder ("Foreign Cards using our ATM" $5, 60777;
 * "ATM Surcharge Fee on WWFCU machines (non-credit union cards only)" $3.50, 125584; "Non First
 * Federal Cardholder at First Federal ATM" $3, 71466), or a card issued elsewhere ("... surcharge on
 * debit & credit cards issued by financial institutions other than MVFCU"). Its own customers never
 * pay it, and none of the 50 types holds it (#1196, 131129; Knox does not read it, rules.ts).
 * A bare "ATM Surcharge" names no payer and is not matched.
 */
const OUTSIDER_ATM = String.raw`\bnon[- ]?(?:customers?|clients?|account ?holders?|accountholders?|depositors?)\b|\bforeign\s+customers?\b|\bforeign\s+(?:bank\s+|debit\s*\/?\s*(?:atm\s+)?|atm\s*\/\s*debit\s+|atm\s+)?card(?:s|holders?)?\b|\bnon[- ][^|()]{0,30}?\bcard ?holders?\b|\bnon[- ]?(?:credit union|cu|bank)\s+(?:debit\s+|atm\s+)?cards?\b|\bcards?\s+(?:from|issued by)\s+(?:an?\s+)?(?:other|another|financial institutions? other)\b|\bissued by (?:other )?(?:financial institutions?|banks?|institutions?) other than\b|\bother (?:financial )?institution(?:'?s)? (?:debit\s+|atm\s+)?cards?\b|\bdebit cards? from (?:an?\s+)?(?:other|another)\b|\bout[- ]of[- ]network\s+(?:atm\s+)?card(?:s|holders?)\b|\b(?:using|use of)\s+our\s+(?:own\s+)?(?:\w+\s+)?atm|${OUTSIDER_CARD_WORDS}`;
/**
 * v74 (James's 20 live defects, Oct 19): a withdrawal at an ATM the name gives as one named
 * institution's own ("ATM Withdrawal Fee at JSFCU ATM" $2.50, Jersey Shore FCU 152758: its line is
 * the surcharge non-members pay there) is not a member's fee at another network's ATM. Only an
 * all-capitals abbreviation reads as the institution ("at JSFCU ATM", "at NCB ATM"); it is matched
 * case by case (`excludeExact`), so a word ("at Partner ATMs", "at Visa ATMs") and a network
 * acronym ("at NYCE ATMs", "at CU ATMs") never count, nor does a name written all in capitals
 * ("WITHDRAWAL AT FOREIGN ATM"), where every word looks like an abbreviation (#2024 review).
 */
const NAMED_OWN_ATM = /\b[Aa][Tt]\s+(?!(?:ATMS?|ANY|AN|ALL|THE|OUR|OTHER|ANOTHER|FOREIGN|NON\w*|NETWORK|CO|COOP|CU|CUS|CUSO|CU24|FCU|US|USA|PLUS|STAR|NYCE|MAC|SUM|ACCEL|AFFN|TYME|SHAZAM|PULSE|CIRRUS|MAESTRO|INTERLINK|PRESTO|ALLPOINT|MONEYPASS|VISA|MC|ATH|POS)\b)[A-Z][A-Z0-9&]{1,7}\s+(?:ATM|Atm|atm)[sS]?\b/;
/**
 * v74: a savings club's withdrawal ("Holiday Account Early Withdrawal" $10, 154134, 152985) is not
 * closing the account. None of the 50 types holds it, and 315 live fees read so (prod, read-only,
 * Oct 19), so the rule waited on James. v75 (#2023): James chose "Take down" (Oct 19, 01:42 UTC)
 * after a read-only check of 25 of the 313 still live against their stored text found every one a
 * per-withdrawal club charge ("Christmas Club early withdrawal | $20 per w/d"), none a closing fee.
 * James's two listed rows are hand takedowns (hand-takedowns.ts). Set false to stop refusing them.
 */
export const CLUB_WITHDRAWAL_LIVE = true;
// A name that also prices a certificate ("Christmas Club & CD Early Withdrawal Fee") keeps early closure's own fee.
export const CLUB_WITHDRAWAL = /^(?![\s\S]*\b(?:clos(?:e|ed|es|ing|ure)|cds?|certificates?)\b)(?:[\s\S]*\b(?:holiday|christmas|xmas|vacation|club|seasonal)\b[\s\S]*\bwithdraw|[\s\S]*\bwithdraw[\s\S]*\b(?:holiday|christmas|xmas|vacation)\b)/i;
/** v74: withdrawals over a count ("Excessive IRA Withdrawals" $15, 154163) are not the IRA's closing fee. */
const IRA_EXCESS_WITHDRAWALS = /\bexcess(?:ive)?\s+ira\s+withdrawals?\b|\bira\s+withdrawals?\s+(?:over|in\s+excess|beyond)\b/i;
/** v74: shipping or ordering foreign currency ("Foreign Currency – Expedited Shipping" $15, 154166) is not a rushed card. */
const CURRENCY_SERVICE = /\bcurrenc(?:y|ies)\b|\bforeign\s+cash\b/i;
/**
 * v77: a card that draws only on credit ("Credit Card Replacement" $25, "Replace a Visa Credit Card",
 * "HELOC Access Card Replacement") is a lending product, not the deposit account's card. A line that
 * also names a debit, ATM or check card ("Debit/Credit Card Replacement") is the deposit card's fee;
 * a credit union's own card ("Credit Union Membership Card") is not a credit card. "Credit" must sit
 * just before "card" (or in "Card Rush (Credit)"), so a refund ("$5 credit to your account if
 * fraud") on a deposit card line is not read as a credit card.
 */
const CREDIT_CARD_ONLY =
  /^(?![\s\S]*(?:debit|\batm\b|\bcheck\s?cards?\b|\bhsa\b|\btravel\s+cards?\b|\bprepaid\b|\bgift\b))(?:[\s\S]*\bcredit(?:\b|(?=cards?\b))(?![-\s]*unions?\b)(?:(?!\b(?:to|back|if|refund)\b)[^.;()$]){0,20}?cards?\b|[\s\S]*\bcards?\b[^.;$]{0,30}\(\s*credit\s*\)|[\s\S]*\btarjetas?\s+de\s+cr[eé]dito\b|(?=[\s\S]*\bcards?\b)[\s\S]*(?:\bheloc\b|\bhome\s+equity\b|\bline\s+of\s+credit\b))/i;
/**
 * v80 (#1912): text between "card" and "replace" that may not be a PIN standing on its own. "Debit
 * card PIN number replacement" $5 (Bank Plus 16535, beside its $10 card replacement) replaces the PIN;
 * "ATM Card/PIN Replacement" and "Card or PIN" join the PIN to the card and still replace the card.
 */
const NOT_A_LONE_PIN = String.raw`(?:(?!\bpins?\b)[^|]|(?<=\b(?:cards?|tarjetas?)\s*(?:\/|or|and|&|,)\s*)pins?\b)`;
/**
 * v80 (#1912): the price a non-customer or non-member pays ("Official Cashier Check-Non-Customer" $10,
 * First Bank of Pike 66152) is not the customer's cashier's check fee. Check cashing keeps such
 * names: its type is "often applied to non-customers" (fee-definitions.ts).
 *
 * Held by `NON_CUSTOMER_CASHIERS_CHECK_LIVE` for James: the Texas answer keys file a non-customer's
 * cashier's check as `cashiers_check` (TIDs 38, 2412, 2423, 2425), as #1912's reviewer does not, and
 * the read-only dry run (Oct 21 01:07 UTC) found 125 live fees it would take down. Off, the rule reads
 * nothing; on, they go to the second look, like the non-customer ATM surcharges (DECISIONS, Oct 17).
 */
export const NON_CUSTOMER_CASHIERS_CHECK_LIVE = false;
const NON_CUSTOMER_PRICE = /\bnon[-\s]?(?:customers?|members?|clients?|account ?holders?|depositors?)\b/i;
/**
 * v80: names that keep the customer's price: one that prices members too ("Cashier's Check
 * (Member/Non-Member)", "Official Checks - Members (after first check daily) or Non-Member"), a
 * check made out to a non-member ("Teller's Check (payable to non-members)", "Cashier Check to
 * Non-Member"), and a service closed to them ("Service not available to non-customers").
 */
const NON_CUSTOMER_PAYEE_OR_BOTH =
  /\b(?:members?|customers?|clients?)\b[^|]{0,40}?(?:\/|\bor\b|&)\s*(?:[\w-]+\s+){0,3}non[-\s]?(?:members?|customers?|clients?)\b|\b(?:payable|made|written|issued\s+payable)\s+(?:out\s+)?to\s+(?:an?\s+)?non|\b(?:check|checks|cheque)\s+to\s+(?:an?\s+)?non[-\s]?|\bnot\s+available\s+to\s+non/i;
/** The non-customer words in a cashier's check name, while the rule is live; null otherwise. Pure. */
export function nonCustomerCashiersCheck(canonicalFeeKey: string, name: string, live: boolean = NON_CUSTOMER_CASHIERS_CHECK_LIVE): string | null {
  if (!live || canonicalFeeKey !== "cashiers_check" || NON_CUSTOMER_PAYEE_OR_BOTH.test(name)) return null;
  return name.match(NON_CUSTOMER_PRICE)?.[0] ?? null;
}
/** v74: investigating or tracing a payment ("Online Bill Payment Investigation" $30, 154324) is research, not bill pay. */
const PAYMENT_INVESTIGATION = /\binvestigat|\bresearch\b|\btrac(?:e|er|ing)\b/i;
/**
 * v74: withdrawals over the monthly count ("service charge for each withdrawal over 6 per calendar
 * month" $2, First Dakota 152878) and returned mail ("Return Mail Fee", A.B.D. FCU 152834) are their
 * own types, not account research, unless the name also says research or reconciling.
 */
const NOT_RESEARCH_WITHDRAWAL = /\bwithdrawals?\s+(?:over|in\s+excess|beyond|after)\b|\bexcess(?:ive)?\s+(?:savings\s+|share\s+)?withdrawals?\b/i;
const NOT_RESEARCH_MAIL = /\breturn(?:ed|s)?\s+mail\b/i;
const RESEARCH_WORD = /\b(?:research|reconcil|investigat)/i;
/**
 * v78: guaranteeing a signature ("Medallion Signature Guarantee" $75, "Medallion Stamp" $10) verifies
 * no account. The answer keys leave it unmapped: none of the 50 types holds it.
 */
const SIGNATURE_GUARANTEE = /\bmedallion\b|\bsignature\s+guarant/i;
/** v74: a loan payment ("Foreign Returned Item | Varies | ACH Loan Payment on Website" $2, 153002) is not a deposited item coming back. */
// A loan payment line that names no deposit ("Returned Deposit/Loan Payment" prices both and stays).
const LOAN_PAYMENT = /^(?![\s\S]*\bdeposit)[\s\S]*\bloan\s+payments?\b/i;

/**
 * v69: a monthly ATM add-on or plan ("Power Checking +ATM Freedom" $2.99 a month, 114331; "Add ATM
 * Unlimited" $10 a month, 93629; "Unlimited ATM Usage" $3.25 a month) is a subscription that refunds
 * or waives ATM fees, not a charge for using another network's ATM. None of the 50 types holds an
 * optional ATM plan (#1753).
 */
const ATM_PLAN = String.raw`\bunlimited\s+(?:[\w.]+\s+){0,2}atms?\b|\batms?\s+(?:unlimited|freedom)\b|\badd\s+atm\b|\+\s*atm\b|\batm\s+add[- ]?ons?\b`;
/**
 * v70: an ATM-named line whose fee has another home: a bill payer service priced for members
 * without checking and a card ("e-Pay (Bill Payer Service) without Checking and Debit/ATM Card"
 * $6.95 a month, 147703: bill pay), and a card charge on closing the account early ("Account Closure
 * ATM/Debit Card - if account closed within 12 months" $10, 117628: early closure).
 */
const CARD_SERVICE_ELSEWHERE = String.raw`\bbill payer\b|\baccount clos\w*`;
/**
 * v69: a line that names an ATM but prices something other than using another network's ATM: a
 * dispute or a copy of a card sale (account research), a lost, stolen, blocked or replaced card, a
 * negative balance, a cashier's, treasurer's or official check, temporary checks, or a
 * cut-off-times sentence (#1736's market report, #1753). A balance inquiry at an ATM stays here:
 * balance_inquiry is retired and folds into this type (v25). v71: verifying an ATM transaction
 * ("Verification of ATM Transaction" $3, 96092) is research. A denied ATM transaction ("ATM
 * Denials", 12 live rows) is left for James: it may be the network ATM fee for a failed attempt.
 * v83 (#1690, held by Darwin's peer check): research or an investigation that lists ATM items
 * ("Account Investigation - Share / ATM / ACH (per item after 60 days)" $10, raw 750417) and ATM
 * photos ("ATM Photos at Credit Union" $10, raw 790236) are account research (`ATM_RESEARCH`); a
 * transaction that overdraws a share ("ATM Negative Share Transaction" $10, raw 790212) is a
 * negative balance; and an additional card ("Additional ATM/Debit Card" $10, raw 750400; "ATM/Debit:
 * Each Additional Card") prices the card. "Each additional ATM withdrawal" names no card and stays.
 */
const ATM_RESEARCH = String.raw`\binvestigat\w*|\bresearch\w*|\bphotos?\b(?!\s*(?:id|identification)\b)`;
const NOT_ATM_USE = String.raw`${ATM_RESEARCH}|\bnegative\s+(?:share|savings|account)\b|\badditional\s+(?:(?:atm|debit|visa|check|mastercard)\s*\/?\s*)*cards?\b(?!\s*-?\s*holders?\b)|\bdisput\w*|\b(?:photo ?)?cop(?:y|ies)\b|\bnegative\s+balance\b|\btreasurer|\bcashier|\bofficial\s+checks?\b|\btemporary\s+checks?\b|\bcut[- ]?off\s+times?\b|\blost\b|\bstolen\b|\b(?:un)?block(?:ed)?\s+cards?\b|\breplac|\bverification of\b`;

/**
 * v70 (#1765, card-product misfiles; #1690): a fee for the card itself is not a fee for using another
 * network's ATM, and a card's inactivity is not the account's dormancy. None of the 50 types holds
 * a card's monthly, annual or maintenance fee, its issue, activation or origination, a limit
 * increase, a reinstatement, a card's inactivity, or a point-of-sale purchase fee (`gift_card_purchase`
 * refuses inactivity; `card_replacement` is only a replacement), so a live fee failing this rule is
 * a takedown. Darwin and publish refuse new reads at once. James said yes on Oct 17 (10:47 UTC), so
 * the switch is on: the live sweep takes them down through the second look like any guard failure.
 * Switched off, it counts and samples the live fees that fail only this rule (`cardProductPending`
 * in the guard's result and the publish step's detail) and takes none down.
 */
export const CARD_PRODUCT_TAKEDOWN_LIVE = true;

/** v70: a word that makes an ATM-named line a charge for using an ATM or another network. */
const ATM_USE_WORD = String.raw`withdraw|\bw\/d\b|\binquir|\btransfers?\b|\bnon\b|\bnon-|foreign|\bother\b|network|surcharg|usage|\bused?\b|\bowned\b|terminal|\bmachines?\b|\bdenied\b|\bdenials?\b|declin|\bcash\b|international|deposit`;

/**
 * v70: a card-product fee filed as the non-network ATM fee (Oct 17, each read on its bank's stored
 * line): the card's monthly, annual, holder or maintenance fee ("ATM/Debit Card - Monthly Fee" $1,
 * "ATM Only Cardholder Fee (monthly)", "Visa Debit/ATM Card Maintenance" $5, "Monthly ATM Access
 * Charge" $1 "per account (only if you have a debit or ATM card)", "ATM savings account access
 * only" $5 a year), its issue, activation or origination ("ATM/Debit Card Issue Fee" $3, "ATM Debit
 * Card Activation Fee" $1), a reinstatement or limit increase, the card's inactivity ("Debit / ATM
 * Card Inactivity" $2 a month), and a point-of-sale purchase fee ("ATM POS Purchase" $1 per
 * transaction). A line that also names a withdrawal, an inquiry, a transfer, another network or
 * institution, a surcharge or a denial prices ATM use and is not matched; "ATM/POS Activity Charge"
 * names neither and stays.
 */
export const CARD_PRODUCT_FEE = new RegExp(
  String.raw`^(?![\s\S]*(?:${ATM_USE_WORD}|\btransactions?\b))[\s\S]*(?:\bcard\s*holders?\b|\bcardholders?\b|\bcards?\b[^|]{0,25}\b(?:monthly|annual(?:ly)?|yearly|per month|maint\w*)|\b(?:monthly|annual)\s+atm\s+(?:access|debit|cards?)\b|\batm\s+monthly\s+service\b|\batm\s+access\s+fee\s+with\b|\baccess\s+of\s+membership\b|\baccount\s+access\b|\baccess\s+only\b|\bissu(?:e|ance)\b(?!\s+by)|\bactivation\b|\borigination\b|\breinstat|\blimit\s+increase\b|\binactiv|\bdormant\b)` +
    String.raw`|^(?![\s\S]*(?:${ATM_USE_WORD}))[\s\S]*(?:\bpoint[- ]of[- ]sale\b|\bpos\s+(?:purchases?|fees?|w\/))`,
  "i",
);

/**
 * v70: a card's inactivity filed as a dormant account (Oct 17: "Inactive Debit Card" $5 a month,
 * "Debit Card Inactivity Fee", "Inactive Credit Card Per month", a gift card's "Card Inactivity Fee
 * (No activity within 12 months)"). A name that also says account ("Inactive Account (no debit card
 * activity)") is the account's own dormancy and stays.
 */
export const CARD_INACTIVITY =
  /^(?![\s\S]*\baccounts?\b)(?:[\s\S]*\bcards?\b[^|]{0,30}(?:\binactiv|\bdormant|\bnon-?\s?use)|[\s\S]*\b(?:inactiv\w*|dormant)\s+(?:visa®?\s+)?(?:debit\s+|credit\s+|atm\s+|check\s+|gift\s+|prepaid\s+)?cards?\b)/i;

/** v70: the start of a card-product failure's reason. */
export const CARD_PRODUCT_REASON = "card product";

/** v70: the card-product text a fee's name matches under its category, or null. Pure. */
export function cardProductMisfile(canonicalFeeKey: string | null | undefined, feeName: string | null | undefined): string | null {
  const name = plainQuotes(feeName ?? "").trim();
  if (canonicalFeeKey === "atm_non_network") return name.match(CARD_PRODUCT_FEE)?.[0] ?? null;
  if (canonicalFeeKey === "dormant_account") return name.match(CARD_INACTIVITY)?.[0] ?? null;
  return null;
}

/**
 * #1837: a direction borrowed from the wrong heading. A two-column schedule flattened row by row puts
 * one column's section heading over the other column's rows, so a bare direction row ("Incoming",
 * "Outgoing (domestic)", "Foreign Incoming") is read under a heading it never sat under: "Check
 * Printing: Incoming" $15 and "SAFE DEPOSIT BOXES15: Outgoing (domestic)" $25 are wires, "Stop
 * Payment: Incoming" a transfer. A name whose part after its last colon is only a direction (with
 * customer, unit and joining words), under a heading that names no direction, is that heading's fee
 * only in a category priced by direction (`DIRECTION_KEYS`, any `wire_` key) or, for a stop payment or a
 * research fee, a row naming a wire or transfer; in any other it is a misread
 * (48 live fees on Oct 17, nearly all a wire price from the next column), so a live fee failing the
 * rule goes to the second look and comes down.
 *
 * Held by `BORROWED_DIRECTION_LIVE`: off, the rule reads nothing (Knox, Darwin and publish). On since
 * James's yes (Oct 17) with guard v73: the catch-up sweep flags the live fees that fail it for the
 * second look and takes them down.
 */
export const BORROWED_DIRECTION_LIVE = true;
/** Categories a direction prices: wires, collections, ACH, faxes, transfers, foreign card use, delivery. */
export const DIRECTION_KEYS: ReadonlySet<string> = new Set([
  "wire_domestic_outgoing",
  "wire_domestic_incoming",
  "wire_intl_outgoing",
  "wire_intl_incoming",
  "collection_item",
  "ach_origination",
  "ach_return",
  "document_reproduction",
  "ira_termination",
  "card_foreign_txn",
  "atm_international",
  "rush_card",
  "courier_delivery",
  "cash_advance",
  "od_protection_transfer",
  "deposited_item_return",
  // A foreign ATM is the non-network ATM; a replacement card or returned mail is priced by where it ships.
  "atm_non_network",
  "card_replacement",
  "returned_mail",
]);
/** Categories where a wire or transfer row is a fee of its own (a wire's stop payment or trace). */
const WIRE_ROW_KEYS: ReadonlySet<string> = new Set(["stop_payment", "account_research"]);
const WIRE_ROW_WORD = /^(?:wires?|transfers?)$/;
const DIRECTION_WORD = /\b(?:incoming|outgoing|domestic|international|foreign|intl)\b/i;
/** The words a direction row is made of besides the direction itself. */
const DIRECTION_ROW_WORDS = new Set(
  "incoming outgoing domestic international foreign intl and or in out wire wires transfer transfers item items fee fees per each customer customers non nonmember member members business personal consumer only".split(" "),
);
export const BORROWED_DIRECTION_REASON = "borrowed direction";

/** #1837: the direction row a fee's name borrowed a heading for, outside a direction category, or null. Pure. */
export function borrowedDirection(
  canonicalFeeKey: string | null | undefined,
  feeName: string | null | undefined,
  live: boolean = BORROWED_DIRECTION_LIVE,
): string | null {
  if (!live || !canonicalFeeKey || DIRECTION_KEYS.has(canonicalFeeKey) || canonicalFeeKey.startsWith("wire_")) return null;
  const name = plainQuotes(feeName ?? "").trim();
  const at = name.lastIndexOf(":");
  if (at <= 0) return null;
  const heading = name.slice(0, at);
  const row = name.slice(at + 1).trim();
  if (!row || DIRECTION_WORD.test(heading) || !DIRECTION_WORD.test(row)) return null;
  const words = row.toLowerCase().split(/[^a-z]+/).filter((word) => word.length > 1);
  if (WIRE_ROW_KEYS.has(canonicalFeeKey) && words.some((word) => WIRE_ROW_WORD.test(word))) return null;
  return words.length > 0 && words.length <= 5 && words.every((word) => DIRECTION_ROW_WORDS.has(word)) ? row : null;
}

/**
 * v82 (#1662): what keeps a night deposit name that mentions a key deposit filed as the service.
 * v66 exempted lost, replac, service, per month, monthly, annual and rental anywhere in the name,
 * unanchored, so "Night Depository Services: Key Deposit" (a section header Knox carried in),
 * "... (refundable; service fee billed monthly)" and "... - Serviced Accounts" passed. Each word now
 * has to sit on what it qualifies, with word boundaries:
 * - a lost or replaced key: "lost" or "replac..." within a few words of "key";
 * - the service itself: "night deposit(ory) service(s)" or "night drop service", not a header
 *   ("Services:", "Services -") and not running straight into "Key" ("Night Deposit Service Key
 *   Deposit", where the key deposit is the item);
 * - a periodic fee: "monthly/annual/yearly fee or charge", "fee/charge per month/monthly/annually";
 * - the depository's rental or period: "night depository rental", "night deposit, annual".
 */
const NIGHT_DEPOSIT_NOUN = String.raw`(?:night\s+deposit(?:ory)?(?:\s+box)?|night\s+drop|depository|drop\s+box)`;
const NIGHT_DEPOSIT_KEY_DEPOSIT_EXEMPT = new RegExp(
  [
    String.raw`\b(?:lost|replac\w*)\b[^|]{0,15}\bkeys?\b`,
    String.raw`\bkeys?\b[^|]{0,15}\b(?:lost|replac\w*)\b`,
    String.raw`\b(?:night\s+deposit(?:ory)?|depository|night\s+drop)\s+services?\b(?!\s*[:\-–—|/,]|\s+keys?\b)`,
    String.raw`\b(?:monthly|annual|yearly)\s+(?:fee|charge|service\s+charge)\b`,
    String.raw`\b(?:fee|charge)\s+(?:per\s+month|per\s+year|monthly|annually|yearly)\b`,
    String.raw`\b${NIGHT_DEPOSIT_NOUN}\s+(?:rental|rent)\b`,
    String.raw`\b(?:monthly|annual|yearly)\s+${NIGHT_DEPOSIT_NOUN}\s+(?:fee|charge)\b`,
    String.raw`\$\s*\d[\d.,]*\s*\/\s*(?:mo|month|yr|year)\b`,
    String.raw`\b${NIGHT_DEPOSIT_NOUN}[\s,:-]*(?:per\s+month|monthly|annual(?:ly)?|per\s+year|yearly)\b`,
  ].join("|"),
  "i",
);

/**
 * v85 (#1831): a refundable safe deposit box key deposit is money the renter gets back when both
 * keys come home, not a charge for the box ("Safety Deposit Box Key Deposit at Account Opening (per
 * key)" $5, Central Bank 152139; "Key Deposit (refundable)" $100, "Safe Deposit Box Security Deposit
 * (paid at opening ..., refunded upon returning both keys)" $40). The name has to name the deposit
 * on the key: a key followed by "deposit" (not "Safe Deposit" or "Deposit Box") or "refund...", a
 * deposit for or on the key, a refundable deposit, or the box's security deposit. "Non-refundable"
 * is not a refund.
 */
const SAFE_DEPOSIT_KEY_DEPOSIT = new RegExp(
  [
    String.raw`\bkeys?\b[^|]{0,30}?(?:(?<!\bsafe\s)(?<!\bsafety\s)\bdeposit\b(?!\s*box)|(?<!\bnon-?)\brefund\w*)`,
    String.raw`\bdeposit\s+(?:for|on)\s+(?:the\s+|each\s+)?keys?\b`,
    String.raw`(?<!\bnon-?)\brefundable\s+(?:keys?|deposit)\b`,
    String.raw`\bsecurity\s+deposit\b`,
  ].join("|"),
  "i",
);
/**
 * v85 (#1831): what keeps a safe deposit box name that mentions a key deposit filed as the box fee.
 * Each word sits on what it qualifies (Darwin lesson issue-1662-exemption-sits-on-its-noun):
 * - a lost, replaced, duplicate, missing, damaged or stolen key, or the loss of a key: the lost-key
 *   and replacement fees stay safe deposit box fees ("Key Deposit/Lost Key", "Key Deposit / Replacement");
 * - drilling: the line prices drilling the box open ("Box Drilling / Lost Keys / Key Deposit" $200,
 *   "Safe deposit box - Drilling fee - Key deposit" $150, each the drilling price on its schedule);
 * - the box's annual or rental fee itself ("Annual Rental Fees (Key Deposit)" $25, the smallest
 *   box's rent on its schedule). A "Rental - Key Deposit" header is not a rental fee
 *   ("Safe Deposit Box Rental** - Key Deposit | $10.00" prices the key deposit).
 */
const SAFE_DEPOSIT_KEY_DEPOSIT_EXEMPT = new RegExp(
  [
    String.raw`\b(?:lost|replac\w*|duplicat\w*|missing|damaged|stolen)\b[^|]{0,15}\bkeys?\b`,
    String.raw`\bkeys?\b[^|]{0,15}\b(?:lost|replac\w*|duplicat\w*|missing|damaged|stolen)\b`,
    String.raw`\bloss\s+of\b[^|]{0,15}\bkeys?\b`,
    String.raw`\bdrill\w*`,
    String.raw`\b(?:annual|yearly|monthly)\s+(?:rental\s+)?(?:fees?|charges?|rent)\b`,
    String.raw`\brental\s+(?:fees?|charges?)\b`,
    // A deposit the bank keeps is a charge ("Key Deposit (non-refundable)", "Forfeited Key Deposit"),
    // and lock work prices the box's service ("Lock Change / Key Deposit", "Re-keying").
    String.raw`\bnon-?\s?refundable\b`,
    String.raw`\bforfeit\w*`,
    String.raw`\block\s+(?:change|replacement)\b`,
    String.raw`\bchange\s+of\s+locks?\b`,
    String.raw`\bre-?key\w*`,
  ].join("|"),
  "i",
);

export const CATEGORY_GUARD_RULES: Readonly<Record<string, CategoryRule>> = {
  monthly_maintenance: {
    // v10: "Minimum daily balance of $500 required to avoid a $5.00 service fee" names the
    // account's monthly fee by the balance that waives it.
    // v57: a cross-border banking bundle's annual fee is the account's fee, paid yearly (RBC's
    // U.S. Premium Checking "Cross-Border Banking Bundle annual fee", $99.50 a year or $9.95 a month).
    include: /(maintenance|monthly service|service charge|monthly fee|cargo (por |de )?(manejo|mantenimiento|servicio)|mantenimiento mensual|cargo mensual|(minimum|balance)\b.{0,80}\bavoid\b.{0,30}\bservice fee|\bcross[- ]?border (?:banking )?(?:bundles?|packages?|accounts?|banking) annual fee)/i,
    // A per-transaction charge or an earnings-credit note is not the account's monthly fee, nor a
    // business service's own monthly charge (remote deposit scanners, IntraFi/ICS sweeps, a fee per
    // location) or a sentence about waiving it ("Waiving the Monthly Service Fee") (v21).
    // v38: an "Overdraft Privilege Service Charge" ($20) is the overdraft fee; a paper statement
    // fee ("Maintenance Fee – Paper Stmt Fee"), a transfer service charge, a wire module's
    // monthly fee, an ATM card's monthly fee and table or waiver fragments are not it either.
    // v49: a treasury service's monthly charge (ACH or wire module, API service, Positive Pay,
    // cash management, "Monthly Fee (per account)" on BankUnited's treasury schedule) is not it.
    // v55: a merchant service's monthly charge ("Merchant Capture Monthly Service Charge") or an
    // early termination fee (ProGrowth's $49.95 "Monthly Service Fee Early Termination Fee",
    // Merchant Capture) is not it either; a bank named "First Merchants" still is.
    // v58: "... the balance requirement to avoid the monthly service charge is met. Otherwise, a fee
    // of" prices what the sentence waives, here a non-network ATM withdrawal (Westamerica 96164).
    // v59: an optional add-on's monthly charge is not the account's fee: identity-theft programs
    // (Harvest's "ID TheftSmart Fee" $2, 29713, 86782), accidental death insurance (70672, 85526)
    // and a perks package (88787). An account that comes with the insurance stays (55988).
    // v60: a sweep service's monthly charge (Security Federal's "Sweep maintenance charge (per
    // month)" $38.95, a ZBA or sweep transfer, a business sweep checking account) is not it either.
    // v61: a remote deposit capture service named as a product (Montecito's "CheckCapture
    // Maintenance Fee" $40, 76519) is not it either (#1196).
    // v62: a service charge for another service ("Stop & Reissue Service Charge", "Claims/Payment
    // Investigation Service Charge", "IRS Processing Service Charge", "ATM Service Charge", a
    // negative balance charge) or one priced per item, transfer, transaction, withdrawal or debit
    // ("Per Item Service Charge", "Service charge per transfer") is not it either (#1100). A
    // per-debit charge the account's fee carries on top ("Service charge + per debit item fee")
    // stays.
    // v72 (#1788): an optional add-on named as one ("Account \"Protect\" Add-On Monthly fee" $6,
    // 141761), or a charge for each additional membership in a package (95198), is not it either;
    // an add-on named only "Monthly fee" is read from its own source line (`addOnOnLine`).
    exclude:
    // v63: the same in Spanish: a debit card's monthly fee ("Cargo manejo mensual (Tarjeta de Débito
    // ATH)" $1, Puerto Rico FCU 262769), savings, a loan, a statement or an annual charge (#1312).
      /((?<!(?:\+|\bplus\b|\band\b)[^|]{0,20})\bper[- ]?(?:item|transfer|transaction|withdrawal|debit)s?\b|\bstop\b|re-?issue|investigat|\birs\b|negative balance|\batm service charge|\btarjeta|ahorros?\b|pr[eé]stamo|estados? de cuenta|\banual\b|\bsweep|\bid\s*theft|\bidentity\s+(theft|protect|monitor|restor)|^\s*accidental death|\binsurance plan\b|\badd[- ]?ons?\b|\beach additional\b[^|]{0,40}\bmemberships?\b|\bpackage monthly fee|otherwise,? a fee of\s*$|\bmerchant (capture|services?|processing|accounts?)\b|terminat|\boverdraft (privilege|courtesy)|paper (stmt|states|mailed)|\bstmt fee|is waived under|\|\s*na\s*\||transfer service charge|\bwire (manager|module)\b|\bmodule\b|treasury|cash management|\bapi\b|\bach\b|positive pay|paper mailed|cashier|^monthly fee \(per account\)|\batm\/debit card monthly fee|location|scanner|remote deposit|\bcheck\s*capture\b|\brdc\b|lockbox|intrafi|\bics\b|^waiving\b|savings|money market|club|night deposit|safe deposit|box|(?<!\bcross[- ]?border (?:banking )?(?:bundles?|packages?|accounts?|banking) )annual|dormant|inactive|statement(?! cycle)|\bira\b|certificate|\bcd\b|loan|escheat|clos|research|excess|activity|withdrawal|saver|business|commercial|analysis|\bhsa\b|health|escrow|trust|address|fax|cop(y|ies)|(pos|pin[- ]based) transaction|for transactions|transaction service charge|earnings credit (is applied|available to offset))/i,
  },
  // "at least" is a balance or a statistic, and a short name ending in "fee on" is a
  // line cut mid-sentence ("Overdraft Fee on" $60), never the overdraft fee itself (v17).
  // A worked example ("the Bank will honor that final payment request and not charge an Overdraft
  // Fee that otherwise would be" $40, Provident) and a column header cut before its options
  // ("Overdraft Protection Via" beside a $50 safe deposit box, OceanFirst) are not the fee (v30).
  // An overdraft protection transfer "from Checking, Money Market, or Statement Savings accounts
  // (per pre-authorized automatic transfer)" $5 (BankGloucester) is the transfer fee (v30).
  overdraft: {
    // v42: "Overdraft Privilege Standard or Extended Coverage" (Coastal1) names the coverage, not an
    // extended overdraft fee. "NSF Fee Charge - Paid (per item)" (TBK), "Nonsufficient Funds Fee-Paid" (Cornerstone) and
    // "Insufficient Funds Charge (Check Paid, Per Item)" (River Bank) are the item the bank pays.
    // v29: "Insufficient Funds Charge (Paid)" beside "(Returned)" (WaFd) is the paid item.
    // v34: "Paid nonsufficient funds (NSF)" (Saco & Biddeford) and "NSF Share Draft (Honored)"
    // (Bluestone FCU) are items the bank pays, as are "Paid Consumer & Business NSF Items" (NIH FCU).
    // v41: "Overdraft Charge-off negative balance account $50 per charged off account" (Tri City)
    // is the charge-off processing fee, not the overdraft fee.
    // v33: a worked example ("a $29 Overdraft Fee will be charged for Wednesday's Overdraft Item
    // (the $50 check paid)", "...because your Available Balance was not sufficient"), a waiver
    // threshold ("unless the total overdraft is $50 or less"), page navigation, an account name
    // and a credit card or savings account "as overdraft protection" are not the fee.
    // v89 (#1877): a credit union's "Draft Protection Fee (Paid) per presentment" is the paid-overdraft fee
    // (`DRAFT_PROTECTION_FEE`, shared with Knox v112).
    include: new RegExp(`${DRAFT_PROTECTION_FEE.source}|` + /(overdraft|overdrawn|\bod\b|o\/d|sobregir|pago de cortes[ií]a|partidas? pagadas?|paid item|items? paid|paid nsf|paid (?:non[-\s]?|in)sufficient|paid (?:[\w&]+ ){1,3}nsf items?|courtesy pay|bounce protection|privilege|(?:in|non[-\s]?)sufficient funds?\b.{0,25}\(\s*paid\s*\)|\(\s*honou?red\s*\)|(?:nsf|(?:in|non[-\s]?)sufficient)\b[^|]{0,30}?(?:(?<!\bnon)[-–]\s*|\(\s*(?:check\s+)?)paid\b(?!\s+(?:or|from|by)\b))/.source, "i"),
    // v72 (#1788): staying overdrawn for days is the continuous overdraft fee (`SUSTAINED_OVERDRAFT`).
    exclude: new RegExp(String.raw`${SUSTAINED_OVERDRAFT.source}|` +
      /(transfer|transferencia|traspaso|máxim|por d[ií]a|diari|xfe?r\b|sweep|from (your |eligible |a )?(savings|shares?|loan|loc)\b|to loan|share to share|daily|continu|consecutive|extended(?! coverage)|sustained|limit|line of credit|protection plan|\bcap\b|maximum|reduced to|not be (charged|assessed)|\bwill not (charge|assess)|non[- ]?paid|waive|night dep|notary|counter check|check images?|set ?up|dividend|(savings|share|loan|link(ed)?) overdraft protection|overdraft protection ?[-–(]+ ?(savings|loan)|loan overdraft|covered by|per advance|advances? from|annual|collection|accrual|account closed|closed in overdraft|late repayment|\blate (payment|charge|fee)\b|recurring overdraft|every \d+|beginning|threshold|cushion|overdrawn by|overdraws your account by|with approval|options|\b\d+ ?x ?\d+\b|\bbox\b|outgoing|international|\bwires?\b|check printing|statement cop(y|ies)|photo ?cop(y|ies)|\bcopy fee|\bcop(y|ies) of\b|annual fee|or less\b|\bat least\b|or equal to|is positive|would not apply|otherwise would\b|from (your |eligible |an? |linked )?(checking|money market|statement savings)|pre-?authori[sz]ed automatic tran|\bwill honor\b|\bvia\s*:?\s*$|^.{0,20}\bfee on$|because your (available |current |ledger )?balance|\b(mon|tues|wednes|thurs|fri|satur|sun)day['’]s\b|unless the total|contact us|online statements|\bno overdraft checking\b|\bas overdraft protection\b|\bcharge(d)?[- ]?off\b)/.source, "i"),
    // A returned item is the NSF fee, unless one name prices both: "Return check/overdraft
    // charges" (First Horizon), "Overdraft or Returned Item fee", like "NSF/Overdraft" (v19).
    excludeUnless: { pattern: /return/i, unless: OVERDRAFT_AND_RETURNED, outsideNotes: true },
    capInNotes: {
      cap: /^(daily|maximum|limit|\bcap\b)$/i,
      item: /(\b(overdraft|od|courtesy pay)\b\W*(paid\s+|per\s+)?(fee|charge|item)s?\b|\bpaid item)/i,
    },
  },
  // A sustained charge "after 5 consecutive days" and a "De Minimis" waiver line are not the
  // per-item NSF fee (v27, Oct 8).
  nsf: {
    include:
      /(nsf|insufficient|non[- ]?sufficient|returned item|return(ed)? (check|item|ach|payment|draft)|returned unpaid|unpaid item|fondos insuficientes|cheques? devuelt[oa]s?|art[ií]culos? devuelt[oa]s?|partidas? devuelt[oa]s?|devoluci[oó]n por fondos)/i,
    // v63: in Spanish, a deposited check ("depositado", "depósito"), a credit card, a loan, a
    // returned payment ("Pago por cheque o ACH devuelto", Puerto Rico FCU 262771), an outgoing ACH,
    // a transfer or a return for another reason ("motivo distinto a fondos insuficientes") is not it.
    // v47: a business-only ACH return and a payment the payee sent back ("Payee-returned Check
    // Payment Due to Member Error") are not the member's NSF fee (Darwin eval, Oct 8).
    // v69: a returned Canadian or international check or item ("International Returned Item" $50,
    // 92115; "Canadian Returned Checks (per check)" $45, 117427; `FOREIGN_DEPOSIT_RETURN`) is a deposited
    // item coming back, not the member's own NSF item ("foreign" was already out).
    exclude: new RegExp(String.raw`${FOREIGN_DEPOSIT_RETURN.source}|` +
      /(deposit|dep[oó]sit|tarjeta de cr[eé]dito|pr[eé]stamo|\bpagos?\b|saliente|transferencia|distint[oa]|otr[oa]s? (motivo|raz[oó]n)|máxim|\bcap\b|daily max|maximum|\bpaid\b|\(\s*honou?red\s*\)|de minimis|after \d+ consecutive|\bsustained\b|\bcontinuous\b|others|re-?present|credit card|loan|transfer|cover|3rd party|third[- ]party|foreign|drawn on (an ?)?other|other inst|self[- ]to[- ]self|returned payment|payment returned|nsf payment|visa payment|re-?activation|card capture|converted|cancell?ation|returned ach origination|return ach origination|ach origination nsf|nsf ach origination|debit origination|reg d limit|\(reg d\)|sent for collection|presented multiple times|in the amount of|\bbox\b|check printing|statement cop(y|ies)|photo ?cop(y|ies)|\bcopy fee|\bcop(y|ies) of\b|written to you|re-?route|business only|payee[- ]returned|\b\d+ ?x ?\d+\b|\bmerchants?\b|\bbonds?\b|\bcoupons?\b)/.source, "i"), // v33: "03 x 10" is a worked sum; v39: a merchant presenting a member's NSF check is not the member's NSF fee
    // v35: "NSF Returned Item(s) Charge (NSF charge maximum of $100 per day)" $25 (First State Bank
    // of Rosemount) is the per-item fee; its note states the daily cap.
    capInNotes: {
      cap: /^(daily max|maximum|\bcap\b)$/i,
      item: /\b(nsf|insufficient|non[- ]?sufficient|returned item)/i,
    },
  },
  // The surcharge a bank charges other banks' customers at its own ATMs ("Non-Member ATM
  // Fee", "Non-OMNI Card used at OMNI ATM") and use of its own or in-network ATMs are not
  // what its own customer pays at another network's ATM.
  // A deposit or an inquiry is its own fee, except in one row that also prices withdrawals or
  // transfers at an ATM the bank does not own ("Deposits/Withdrawals at an ATM we do not own
  // or operate", "Inquiries/Transfers at an ATM we do not own"; Pathfinder, Oct 7).
  // v25 (top-50 fold): a balance inquiry at an ATM is filed here, so "Balance Inquiry" under an
  // ATM heading passes; one by phone or with a person does not.
  atm_non_network: {
    include: /(atm|allpoint|network machine|machines?\b|shazam|cajero|balance inquir)/i,
    excludeExact: NAMED_OWN_ATM,
    excludeUnless: {
      pattern: /deposit/i,
      unless:
        /^(?=.*(\b(deposit|inquir)\w*\s*(\/|&|\band\b|\bor\b)\s*(withdraw|w\/d|transfer|transaction)|\b(withdraw|w\/d|transfer|transaction)\w*\s*(\/|&|\band\b|\bor\b)\s*(balance\s+)?(deposit|inquir)))(?=.*(do(es)?\s+not\s+(own|operate)|don['’]t\s+(own|operate)|not\s+owned|\bnon[- ]?[\w.]+([- ]owned)?\s+atms?\b|\bnon[- ]?proprietary\s+atms?\b|\bforeign\s+atms?\b|\batms?\s+foreign\b|\b(all\s+)?other\s+networks?\b|\bother\s+(banks?|institutions?|financial\s+institutions?)['’]?\s+atms?\b|out[- ]of[- ](our\s+)?network|not\s+(in|within)\s+(our\s+)?network))/i,
    },
    // A bare card name ("ATM or Debit Card" $5, "ATM/Debit Cards" $10) is the card's replacement,
    // monthly or annual fee in 14 of 16 live rows, not an ATM network fee (v27).
    // A savings withdrawal over the monthly limit ("ATM Share Savings Withdrawal (over 3x per
    // month)", "Reg-D Savings Withdrawal Fee") and a branch "Lobby ATM" are not network fees (v26).
    // v31: a lone "ATM Card" ($10 "New and Replacement", $3 "per month", $10 "per card per
    // year"; 9 of 9 live rows checked) prices the card itself, as do its order, issue,
    // enrollment and reactivation; an adjustment, or a rebate the bank pays back, is not a fee.
    // v69: what a non-customer pays at the institution's own ATMs (`OUTSIDER_ATM`) is out too.
    // A monthly ATM add-on or plan (`ATM_PLAN`) is not a per-use fee either.
    // v72 (#1788): an ATM used outside the U.S. (`INTERNATIONAL_ATM`) is International ATM.
    // v74: a withdrawal at one named institution's own ATM (`NAMED_OWN_ATM`) is out too.
    // v91 (#1905): a share withdrawal at an ATM the bank does not own or another network's ("Share
    // withdrawal at Non-Navy Federal/Non-CO-OP Network ATM", an ATM network table's row) is the
    // network fee; only the savings-limit charge stays out.
    exclude: new RegExp(String.raw`${OUTSIDER_ATM}|${ATM_PLAN}|${NOT_ATM_USE}|${CARD_SERVICE_ELSEWHERE}|${INTERNATIONAL_ATM.source}|` +
      /(replace|statement|card fee|annual|\bpin\b|denied|declin|re-?order|initial order|instant issue|enrollment|reactivat|\badjustments?\b|rebates?|^(?!.*(withdraw|w\/d|transaction|surcharg|\bnon\b|non-|foreign|other|network|usage|\bused?\b|inquir|transfer|\bat\b|\bpos\b|purchase))\s*atm\s*cards?\b|between accounts|(savings|share) withdrawal(?!.*\bat\s+(?:an?\s+)?(?:non[- ]|other\b|foreign\b|out[- ]of[- ]network\b)[^|()]*\batms?\b)|\breg[- ]?d\b|\blobby\b|^\s*(?:atm|visa|debit|check|mastercard)\s*(?:card)?\s*(?:or|\/|&|and)\s*(?:visa\s*|mastercard\s*)?(?:debit|check|atm)?\s*cards?\s*\*?\s*$|tele?phone|\bphone\b|representative|(?<!automated )\bteller\b|call center|non[- ]?members?|\bnon[- ]?(?!owned\b)[\w.]+ (debit |atm )?cards?|non[- ]proprietary card|foreign cards? used|(?<!free )\bat our atm|(?<!of )\bour network|\bin[- ]network|(?<!\bnon[- ]?)\b(?!(non|other|foreign)\b)\w+[- ]owned atm)/.source, "i"),
  },
  // v72 (#1788): a wire the member receives (`INCOMING_WIRE`: "– In Coming", "(in-bound)", "Wire-In")
  // is not an outgoing wire.
  // v88 (#1912): a book transfer to another account at the same bank (`BOOK_TRANSFER`) is not one either.
  wire_domestic_outgoing: {
    include: WIRE,
    exclude: new RegExp(`${INCOMING_WIRE.source}|${BOOK_TRANSFER}|(incoming|receiv|international|foreign|intl|${ES_INTL}|${ES_INCOMING}|${INTL_ABBREV}|${WIRE_CORRECTIONS}|${BUSINESS_ONLY})`, "i"),
  },
  wire_intl_outgoing: {
    include: WIRE,
    exclude: new RegExp(`${INCOMING_WIRE.source}|(incoming|receiv|${ES_INCOMING}|${WIRE_CORRECTIONS}|check|deposit|collection|${BUSINESS_ONLY})`, "i"),
  },
  // v44: guarded so Hamilton reads it for a paired price ("$20 / $30") in the wrong slot.
  wire_intl_incoming: { include: /\S/, exclude: new RegExp(BUSINESS_ONLY, "i") },
  wire_domestic_incoming: {
    include: WIRE,
    exclude: new RegExp(`${BOOK_TRANSFER}|(outgoing|send|sent|international|foreign|intl|${ES_INTL}|${ES_OUTGOING}|${INTL_ABBREV}|${WIRE_CORRECTIONS}|${BUSINESS_ONLY})`, "i"),
  },
  stop_payment: {
    // v63: Spanish "Suspensión de pago", "Orden de no pago", "Detener pago" or "Parar cheques".
    include: /(stop|suspension of payment|suspensi[oó]n de(l)? pagos?|suspender (un |el )?pagos?|[oó]rden(es)? de no pago|detener (el |un )?pagos?|parar (el |un )?(pagos?|cheques?))/i,
    // "Cancel stop payment" and "Stop Payment Removal" remove a stop; "ACH Stop
    // Payment/Cancellation" and "Stop Payments (to put on or remove)" place one.
    // v63: a stop on a cashier's or official check is the stop payment fee ("Cashier's Check Stop
    // Payments" $20, Community First Guam FCU 327099; "Suspensión de Pago Cheque Oficial", Vapr
    // FCU 262792); a cashier's check named without a stop is not.
    exclude:
      // v80 (#1905): a home equity line's check ("Stop payment of Home Equity Line check" $20, Navy
      // Federal 122368) is a loan fee, like a HELOC's; one that also names a checking or other
      // deposit account ("Stop Payment Order - Checking Account / Home Equity Lines of Credit") stays.
      /(release|(cancel\w*|remov(e|al|ing))\s+(of\s+)?(a\s+|the\s+)?stop|stop\s+payments?\s+(fee\s+)?\(?removal|revoc|prohibited|first business day|discounted fees|perks|monthly service fee|line of credit|heloc|^(?!.*\b(checking|savings|share|deposit)\b).*\b(home\s+equity|equity\s+lines?)\b|loan|pr[eé]stamo|^(?!.*(\bstop\b|suspensi[oó]n|suspender|detener|parar)).*(cashier|official|oficial))/i,
  },
  // v43: guarded so Hamilton reads them for names cut from another fee's note (noteTailOfAnotherFee).
  // v47: a bill payment's stop or cancel is the stop payment fee, and a membership fee is not
  // bill pay ("Bill Pay Stop/Cancel Payment" $25, "Lifetime Membership Fee" $5; Darwin eval).
  // v74: investigating or tracing a payment is account research (`PAYMENT_INVESTIGATION`).
  bill_pay: { include: /\S/, exclude: new RegExp(String.raw`${PAYMENT_INVESTIGATION.source}|` + /(\breload fee\b|\bstop\b|cancel(l?ed)? payment|membership closure|lifetime membership)/.source, "i") },
  // v47: researching, copying, replacing, mailing or reporting lost a money order is not the price
  // of buying one ("Money Order Research Fee" $10; Darwin eval).
  money_order: {
    include: /\S/,
    exclude: /(research|\b(photo ?)?cop(y|ies)\b|declaration of loss|replacement|abandoned|returned|delivery|mailing)/i,
  },
  ach_origination: { include: /\S/, exclude: /(?!)/ },
  cashiers_check: {
    // v63: "Cheques de gerente" (Puerto Rico FCU 262772), "Cheques oficiales", "Cheques de cajero".
    include: /(cashier|official check|bank check|bank draft|corporate check|treasurer|certified|teller'?s? check|cheques? (de gerente|oficial(es)?|de caja|de cajero|certificados?))/i,
    // v80 (#1912): what a non-customer pays is read by `nonCustomerCashiersCheck`, held by its switch.
    exclude: /(cop(y|ies)|stop|replace|lost|research|copia|suspensi[oó]n|suspender|detener|parar|no pago|reemplaz|perdid)/i,
  },
  od_protection_transfer: {
    // v63: "Transferencia(s) por sobregiro(s)" (Puerto Rico FCU 262767, Sound FCU 274044).
    include: /(overdraft|\bod\b|\bodp\b|o\/d|sweep|protection|sobregir)/i,
    // v39: "Returned or Paid Checks (OD Privilege Fee/Insufficient Funds/...includes Electronic Funds
    // Transfer Debits)" $30, "Check-Overdraft/NSF/Return Fees" $30 and "Overdraft Fee-Exceeded
    // Reg D Transfers" $20 are the overdraft, NSF and excess withdrawal fees, not a transfer's fee.
    exclude:
      /(balance transfer|wire|telephone|phone|online|internal|\bach\b|external|book|set-?up|excess|money market|returned or paid checks|check-overdraft\/nsf|overdraft fee-exceeded reg d)/i,
  },
  // v39: wire fees read under a "Subordination Request" heading ("SUBORDINATION REQUEST: Incoming"
  // $10, "...: Outgoing Domestic" $25) are not the lien subordination fee.
  // v64: a mortgage or lien subordination is legal process again (James, Oct 15, reversing v47).
  legal_process: {
    include: /./,
    exclude: /subordination request:\s*(incoming|outgoing)/i,
  },
  paper_statement: {
    // v63: "Cargo por estado de cuenta en papel", "Envío estado de cuenta por correo postal".
    include: /(statement|estados? de cuenta)/i,
    // An e-statement fee is excluded, but "Paper Statement (waived with e-Statements)" is not.
    exclude: /(cop(y|ies)|address|research|re-?print|duplicate|interim|special|photo|image|^(?!.*paper).*e-?statement|copia|fax|duplicad|reimpres|interin|^(?!.*(papel|correo|postal|paper)).*electr[oó]nico)/i,
  },
  card_replacement: {
    // "Re-issuance" and "Reissuance" are the reissue fee too ("ATM/Check Card Re-issuance" $10).
    // v63: "Reemplazo de tarjeta", "Tarjeta de reemplazo", "Sustitución de tarjeta" (Spanish).
    include: /(replace|reissue|re-?issu|lost|stolen|duplicate card|card \(duplicate\)|card reorder|reemplaz|sustituci[oó]n de (la )?tarjeta|reposici[oó]n de (la )?tarjeta)/i,
    // A "check card" is a debit card; checks, checkbooks and checking accounts are not. A PIN
    // reissue alone is not a card replacement, but "Debit Card (replacement or PIN)" is.
    // v35: express, priority or two-day delivery of a replacement card is the rush card fee
    // ("Replacement Card - Express Mail" $40, "Debit Card Replacement Priority Delivery" $40).
    exclude: new RegExp(
      `${CREDIT_CARD_ONLY.source}|(check(?!\\s?card)|statement|key|book|expedit|rush|overnight|gift|${EXPRESS_CARD}|^(?!.*\\b(cards?|tarjetas?)\\b${NOT_A_LONE_PIN}{0,20}(replace|reemplaz))(?!.*(replace|reemplaz)[^|]{0,20}\\b(cards?|tarjetas?)\\b).*\\bpins?\\b|liabilit|closed account|chequera|llave|estado de cuenta|regalo|expr[eé]s\\b|urgente)`,
      "i",
    ),
  },
  // The fee charged when a balance falls below the minimum, not the minimum itself. "Minimum
  // balance to open", "to earn APY" and "to avoid the fee" lines state a balance, so their
  // amount is not a fee; "...required to avoid a minimum balance fee of" ends on the fee.
  minimum_balance: {
    include: /(minimum|min\.?\b|low balance|below|falls|drops|less than|under)/i,
    // v37: closing an account within months of opening it ("Closed Account (less than 6 months)",
    // 9 live rows) is the early closure fee and an inactive-account fee is the dormant fee;
    // "No minimum balance... Monthly service charge is", "You must maintain a minimum balance
    // of", "Membership requires... a minimum balance of" and "Minimum Balance Transfer" are not it.
    exclude: new RegExp(
      `^(?!.*\\b(fee|charge) of\\s*$).*(to open|to obtain|to earn|\\bapy\\b|annual percentage yield|requirements?\\b(?! fee)|balance required|required to|you must deposit|to avoid)|${EARLY_CLOSE}|${INACTIVE}|\\bno minimum balance\\b|\\bmust maintain a minimum balance of( at least)?\\s*$|^membership requires|\\btransfer\\s*$`,
      "i",
    ),
  },
  // Buying or loading a gift, prepaid or travel card (v25: reloads folded in from the retired
  // prepaid-reload category). Its replacement and inactivity fees are other fees.
  gift_card_purchase: {
    include: /(gift|pre-?\s?paid|re-?\s?load|travel ?(money )?card|travelmoney|cu ?money|everyday spend|access card|tarjetas? de regalo|tarjetas? prepagadas?)/i,
    exclude: /(inactiv|dormant|non-?use|replac|lost|stolen|maintenance|reemplaz|perdid|robad)/i,
  },
  // A chargeback on a deposited item or a loan is not a card dispute.
  card_dispute: {
    include: /(dispute|charge-?back|charged back)/i,
    exclude: /(charge-?back (on )?(loan|deposit)|charge-?back (items?|message)\b|return\/charge-?back)/i,
  },
  deposited_item_return: {
    // v58: a returned bond or coupon is a deposited item coming back ("Bond return items",
    // "Bond/Coupon Returned Item Fee"; Darwin 883's dry read).
    // v68: a returned foreign, Canadian or international check or item ("Foreign Check Return Fee",
    // "Returned Canadian Check"; `FOREIGN_ITEM_RETURN`) is a deposited item coming back too.
    include: new RegExp(String.raw`${FOREIGN_ITEM_RETURN.source}|` + /(\b(bonds?|coupons?)\b[^|]{0,30}\breturn|\breturn(ed|s)?\b[^|]{0,30}\b(bonds?|coupons?)\b|deposit(ed)? (item|check|draft)|deposit(ed)? return(ed)? (item|check)s?|return(ed)? deposit|return(ed)? (check|item) deposits?\b(?!\s+(?:bags?|accounts?|slips?)\b)|deposit return|(cheques?|art[ií]culos?|partidas?) depositad[oa]s? devuelt|dep[oó]sitos? (en|de) cheques? devuelt|devoluci[oó]n de dep[oó]sito|charge[- ]?backs?\b|return(ed)? (item|check)s?\b.{0,20}\bwritten to you|^\s*return(ed)?\s+(check|item)s?(\s+(fee|charge)s?)?\s*:?\s*$)/.source, "i"),
    // v81: "Returned Check Deposit" / "Returned Item Deposit" is a deposited item coming back (shadow
    // lab answer keys, #2536). The new pattern skips a deposit bag; no exclusion is added, so no fee
    // that passes today fails.
    // v74: a loan payment (`LOAN_PAYMENT`) is other lending.
    exclude: /(^(?![\s\S]*\bdeposit)[\s\S]*\bloan\s+payments?\b|night|safe|box|unresolved|membership|mobile deposit fee|remote|collection|correction|loan (item|payment)s? charge[- ]?back|charge[- ]?backs? on (a )?loan|unable|(\bcards?\b|visa)[^|]{0,25}charge[- ]?back|charge[- ]?back[^|]{0,25}(\bcards?\b|dispute)|dispute|research)/i,
  },
  // A bank selling zipper or locking deposit bags is pricing a supply, not charging a
  // fee for the night deposit service ("Zipper Bags $3.00" is not a night deposit fee).
  // A lost or replaced key, a bag rental and a monthly or annual charge per bag are fees.
  // A card's foreign transaction fee. "ATM Foreign Transaction Fee" is what a customer
  // pays at another bank's ATM (a "foreign ATM"); a wire, a foreign currency or check
  // service and a neighbouring cell joined into the name ("... | Premium Checking Low
  // Balance Fee", "... : WIRE TRANSFERS") are other fees. "Debit/ATM Foreign Transaction"
  // names the card. A rate's name is often a sentence ("you will be charged a foreign
  // transaction fee of"), so sentences are checked only on dollar amounts (below).
  // From v45 to v75 it was International ATM & Card and held ATMs used abroad too. v76 (James,
  // Oct 19, #2037: "Split"): an ATM used abroad with no card purchase in the name (`ATM_ABROAD`) is
  // International ATM again; one price for ATM and debit card use abroad stays here.
  card_foreign_txn: {
    include: /(foreign|international|currency|exchange|cross[- ]border|\bisa\b|outside (of )?(the )?(u\.?s|united states)|\bcountr(y|ies)\b|abroad|overseas)/i,
    exclude: new RegExp(
      String.raw`${ATM_ABROAD.source}|` +
        /((?<!\/\s?)\batm'?s?\b[^|\/]{0,12}\bforeign transactions?|\bwires?\b|low balance|cash exchange|currency (cash|order|ordered|exchange|purchase)|foreign currency (cash|order|exchange|purchase|delivery)|currency or checks?|check collection|\bmany\b|domestic)/.source,
      "i",
    ),
  },
  // v76 (James, Oct 19, #2037): an ATM used outside the U.S. (`INTERNATIONAL_ATM`: an ATM or cash
  // disbursement and a place abroad). One price for domestic and international ATMs, or a line
  // inside the U.S., is not matched and re-files to the non-network ATM fee; an ATM and debit card
  // or purchase line re-files to the card's foreign transaction fee. A reimbursement cap ("up to
  // $10.00 per transaction, ... ATMs outside U.S. excluded") and a bank's own partner network
  // ("Allpoint ATM Transactions" $0 at SoFi) are no fee here (the Oct 9 review the retired fold
  // rule recorded).
  atm_international: {
    include: INTERNATIONAL_ATM,
    exclude:
      /(\b(?:debit|pos|point of sale|purchases?|check ?cards?|credit cards?|cash advances?|wires?)\b|outside (?:the )?u\.?s\.?a?\.? excluded|^\s*allpoint\b)/i,
  },
  // Knox v26 folded collection items and foreign checks into check cashing (James, Oct 7
  // 2026); on Oct 8 he gave collection items their own type ("Own type"), so a check sent
  // for collection or a foreign check handled for deposit is a collection item. A collection
  // fee on a charged-off or past-due account, or a collection phone call, is debt collection;
  // every other name passes. v41 also catches "Charge off deposit collection fee" without the d.
  // v68: a returned foreign check or item ("Foreign Check Return Fee" $30, 93859; "Foreign Check per
  // Item Processing: Returned" $35, 93400) is a returned deposited item, not check cashing.
  check_cashing: {
    include: /\S/,
    exclude: new RegExp(String.raw`(charge(d)?[- ]?off|past[- ]due|delinquen|\bcalls?\b)|${COLLECTION_ITEM.source}|${FOREIGN_ITEM_RETURN.source}`, "i"),
  },
  collection_item: {
    include: COLLECTION_ITEM,
    exclude: /(?!)/,
  },
  // A credit report pulled to open a deposit account or membership is not a loan fee.
  loan_origination: {
    include: /\S/,
    // v70: skipping a loan payment is other lending (`SKIP_A_PAY`, James, Oct 17).
    exclude: new RegExp(String.raw`${SKIP_A_PAY.source}|` + /\bopen(ing)? (an |a |new |your )?(account|membership)\b/.source, "i"),
  },
  // v70: skipping a loan payment ("Skip-A-Pay Fee" $25) is other lending, not a late payment
  // (James, Oct 17). The price ceiling below still applies.
  // v90 (#1912): a late charge whose name names the safe deposit box (`SAFE_DEPOSIT_BOX_NAME`:
  // "Safety Deposit Box-Late Fee", "SDB Late Payment") is the box's late rent charge.
  late_payment: { include: /\S/, exclude: new RegExp(`${SKIP_A_PAY.source}|${SAFE_DEPOSIT_BOX_NAME.source}`, "i") },
  // A dormant fee names inactivity. Other lines filed here ("Money Market Savings Account
  // (below )" $15 beside Space Coast's real $5 dormant fee, "Telephone transfers") are
  // neighbouring fees or fragments (v18).
  dormant_account: {
    include:
      /(dorman|inac|abandon|escheat|unclaimed|no (\w+ )?(transaction |member |customer |owner |depositor )?activity|limited activity|under[- ]?utiliz|reactivat|idle|unused|non-?use)/i,
    exclude: /(?!)/, // nothing is excluded; the include decides
  },
  // A coin fee names coins, currency or the counting; an ACH return names the payment or its
  // return ("Consumer Negative Balance Fee" $20 and "Hold Mail Request" $12 were filed here, v27).
  coin_counting: {
    include: /(coin|currency|cash|counting|\brolls?\b|wrap|machine|sort)/i,
    exclude: /(?!)/, // nothing is excluded; the include decides
  },
  ach_return: {
    include: /(\bach\b|electronic|e-?check|\beft\b|debit|return|reversal|unauthori|payment|redeposit)/i,
    exclude: /(?!)/, // nothing is excluded; the include decides
  },
  // A cash advance names the cash or the advance; "Remote Online Notary" $25, "VISA Credit Card
  // Payment by Phone" and "Express Issuance/Replacement Credit Card" were filed here (v28).
  cash_advance: {
    include: /(cash|advance|adelanto|efectivo|withdraw|teller|counter)/i,
    exclude: /(?!)/, // nothing is excluded; the include decides
  },
  // Check printing names the checks or the order. Temporary checks are counter checks, and
  // "ACH Payment" or "Domestic Transfer Outgoing" are other fees entirely (v28).
  check_printing: {
    include: /(check|draft|order|print|book|style|box|design|cheque)/i,
    exclude: /\btemporar/i,
  },
  // v46: a fee printed under a "closed within 90 days" heading is that heading's own fee only
  // when the row names no other: Koin's "Accounts closed within 90 days: International Wire" $45
  // (closure is $30), a rush card shipment, a reinstatement. A club's early withdrawal is filed
  // here on purpose (fee-taxonomy.ts).
  early_closure: {
    include: /\S/,
    // v51: a certificate penalty paid in dividends ("A penalty of seven days dividends will be
    // imposed", Y-12 FCU 59002) has no dollar price; the figure beside it is a forfeited reward.
    // v69: an IRA's own closing charge ("Individual Retirement Account Closing Fee" $50, 90972;
    // `IRA_CLOSING`) is the IRA termination fee.
    // v74: a savings club's withdrawal (`CLUB_WITHDRAWAL`) is not closing the account.
    exclude: new RegExp(String.raw`${IRA_CLOSING.source}|${CLUB_WITHDRAWAL_LIVE ? `${CLUB_WITHDRAWAL.source}|` : ""}` + /(:\s*(domestic |international |foreign |incoming |outgoing )?wire\b|\brush request|express shipping|\breinstat|\bpenalty of [a-z0-9 ]{0,24}\bdays?'?\s+(of\s+)?(dividends|interest)\b|\b(dividends|interest) will be (imposed|forfeited)\b|\bforfeit(ure|ed)? of\b)/.source, "i"),
  },
  night_deposit: {
    // v60: a lost or replaced night deposit bag or its key ("Replacement Key for Bag", "Bag
    // Replacement/Lost Key" under Night Depository Services) is the night deposit fee too.
    include: /(night|depository|after[- ]hours|drop box|\bbags?\b.{0,20}\b(lost|replac\w*)|\b(lost|replac\w*)\b.{0,20}\bbags?\b)/i,
    // v66 (James, Oct 16, #1099 option A; #1605): a deposit paid for the depository key ("Night
    // Depository Key Deposit", "Night Deposit Box Key (Refundable Deposit)", "Deposit for Receptacle
    // Key") is a key charge, not the service. A lost or replaced key stays the night deposit fee, and so
    // does a service, monthly, annual or rental line that names a key deposit (as for bags).
    // v82 (#1662): those exemptions are tied to the key or the night deposit noun
    // (`NIGHT_DEPOSIT_KEY_DEPOSIT_EXEMPT`), so a section header ("Night Depository Services: Key
    // Deposit") or an unrelated clause ("service fee billed monthly", "customer service hours")
    // no longer lets a key deposit through.
    exclude: new RegExp(String.raw`(^(?!.*(lost|replac|per month|monthly|annual|rental)).*(\bbags?\b|zipper|pouch|wrapper|strap)|^(?!.*(?:${NIGHT_DEPOSIT_KEY_DEPOSIT_EXEMPT.source})).*(\bkeys?\b[^|]{0,30}?\b(deposit|refundable)\b|\bdeposit for\b[^|]{0,30}\bkeys?\b|\bsecurity deposit\b[^|]{0,30}\bkeys?\b))`, "i"),
  },
  // v60: a night deposit bag, its key or a bag bundle is not a safe deposit box fee (UAT 104666,
  // "Deposit Bags & Night Deposit Drop Box: Disposable 9" x 12" bundle" $15; 6/6 on source, Oct 9).
  // v85 (#1831): a refundable key deposit (`SAFE_DEPOSIT_KEY_DEPOSIT`) is not a charge for the box,
  // as v66 has it for the night deposit. A lost, replaced or duplicate key, drilling and the box's
  // annual or rental fee stay here (`SAFE_DEPOSIT_KEY_DEPOSIT_EXEMPT`); so do late fees.
  safe_deposit_box: {
    include: /\S/,
    exclude: new RegExp(
      String.raw`(\bbags?\b|zipper|pouch|depository|night deposit|drop box)|^(?![\s\S]*(?:${SAFE_DEPOSIT_KEY_DEPOSIT_EXEMPT.source}))[\s\S]*(?:${SAFE_DEPOSIT_KEY_DEPOSIT.source})`,
      "i",
    ),
  },
  // v65: excess withdrawals and returned mail are their own types (James, Oct 15, #1398; nothing is
  // filed there until `RESEARCH_SPLIT_LIVE` is on). An excess withdrawal row is often named only
  // "Service charge" with its limit on its own line (`refileFromLine`), so the name must name excess
  // withdrawals, transactions, transfers, debits or activity, a withdrawal limit, activity over or
  // after a count, or Reg D, or be a bare (savings, money market or share) service charge or fee; a
  // transaction, transfer or debit fee, a credit limit or a monthly or business service charge is
  // not one. A bare (savings, money market or share) service charge or fee counts only when its own
  // source line charges it per savings, money market or share withdrawal, transfer or debit over a
  // limit (`savingsOverLimitLine`), the line `refileFromLine` re-files by; Knox filing a bare
  // "Service charge" here without that line is refused. And it must not name another fee: research, an IRA, returned mail, a copy, an ATM or a foreign or
  // international charge, an early withdrawal penalty, an overdraft or NSF, a returned item, an
  // official check, a statement, a wire, a club, a certificate, a point-of-sale or teller charge, a
  // business account's item count, maintenance or a minimum balance, check printing or cashing, a
  // safe deposit box, a loan, a card, a collection, a subordination, escheatment or a legal fee.
  excess_withdrawal: {
    include:
      /(\bexcess(?:ive)?\s+(?:[\w/-]+\s+){0,2}?(?:withdrawals?|transactions?|transfers?|debits?|activity)\b|\bwithdrawal\s+limits?\b|\b(?:withdrawals?|transactions?|transfers?|debits?)\s+(?:in\s+excess|over\s+\d|beyond|after\s+\d)|\breg(?:ulation)?\.?\s?d\b)/i,
    exclude:
      /(maintenance|minimum balance|printing|safe deposit|\bloans?\b|\bcards?\b|collection|subordinat|escheat|\blegal\b|check cashing|research|reconcil|\bira\b|\breturn(?:ed)?\s+(?:mail|statements?|items?|checks?|deposits?)\b|undeliver|\baddress|\bfax|\b(?:photo ?)?cop(?:y|ies)\b|\bwires?\b|stop pay|dorman|inactiv|\batms?\b|non[- ]?network|foreign|international|\bearly\b|penalt|overdraft|\bnsf\b|cashier|\bstatements?\b(?!\s+(?:savings|cycle|period))|\bclubs?\b|certificate|\bcds?\b|\bpos\b|\bteller\b(?!\s+withdrawals?\b)|\bbusiness\b|\bexcess(?:ive)?\s+(?:(?!(?:withdrawals?|transactions?|transfers?|debits?)\b)[\w/-]+\s+){0,2}items?\b|^(?![\s\S]*\b(?:excess\w*|withdrawals?)\b)[\s\S]*\bitems?\s+(?:over|in excess|after)\b|debit cards?)/i,
  },
  // Returned mail names returned mail, statements or an address, undeliverable mail, the bad, invalid
  // or unknown address, an address correction, search or locator, or a forwarding charge; a bare
  // "address", or a return of anything else (an item, a card, a coin wrapper, collateral, a bill
  // payment), does not. Research for the address
  // itself ("Incorrect Address Research Fee") is returned mail; other research, reconciling, an
  // excess withdrawal, a copy, a deposit, a returned check, item, draft or payment, an address
  // change, a return to paper statements or a re-enrollment is a different fee.
  returned_mail: {
    include:
      /(\breturn(?:ed|s)?\b[\s\S]*\b(?:mail(?:ed|ing)?|statements?|stmts?|address(?:es)?)\b|\b(?:mail(?:ed|ing)?|statements?|stmts?)\s+returned\b|\bundeliver|\b(?:bad|invalid|incorrect|wrong|unknown|missing)\s+(?:mail(?:ing)?|address(?:es)?)\b|\baddress\s+(?:correction|search|research|locat)|\blocator\b|forwarding|e-?statements?\b[\s\S]*\b(?:incorrect|bad|invalid|wrong)\s+e-?mail|\b(?:incorrect|bad|invalid|wrong)\s+e-?mail\b[\s\S]*\be-?statements?)/i,
    exclude:
      /(reconcil|(?<!\b(?:address(?:es)?|locator|locate)\s+(?:[\w/-]+\s+)?)\bresearch|excess|\bwires?\b|\b(?:photo ?)?cop(?:y|ies)\b|\breturn(?:ed)?\s+(?:checks?|items?|deposits?|ach|payments?|loans?|drafts?)\b|\bnsf\b|\bdeposit\w*|\bdrafts?\b|\b(?:items?|checks?|drafts?)\s+returned\b|change of address|address change|\breturn(?:ing)?\s+to\s+paper|\bre-?enroll|\b(?:branch|atm)\s+locat)/i,
  },
  // v78 (#2449, Oct 20): account verification names a verification, a confirmation or certification,
  // a VOD, a bank or credit reference, proof of funds, an audit or a letter about the account. A
  // name with none of those (a checking account, a positive pay service, a bare wire) does not count,
  // a signature guarantee, a letter of credit, a payoff or a collection letter is a different fee,
  // and research or reconciling is account research unless the name also verifies ("Account
  // reconciliation/research/verification of deposit fee" stays).
  account_verification: {
    include: /(verif|confirm|certif|cer\W?fic|\bvods?\b|\bcartas?\b|\bletters?\b|\breferences?\b|proof of (?:funds|deposits?)|\baudit)/i,
    exclude: new RegExp(`${SIGNATURE_GUARANTEE.source}|\\bletters?\\s+of\\s+credit\\b|\\bpay-?offs?\\b|\\bcollection\\b`, "i"),
    excludeUnless: { pattern: RESEARCH_WORD, unless: /verif|confirm/i },
  },
  // v74 (James's 20 live defects, Oct 19): research is checked by name too. Withdrawals over a
  // count and returned mail are their own types (re-filed below); the name still counts as research
  // when it says research, reconciling or investigating.
  account_research: {
    include: /\S/,
    exclude: new RegExp(String.raw`^(?![\s\S]*${RESEARCH_WORD.source})[\s\S]*(?:${NOT_RESEARCH_WITHDRAWAL.source}|${NOT_RESEARCH_MAIL.source})`, "i"),
    onlyIfRefiles: true,
  },
  // v74: shipping foreign currency is a delivery charge, not a rushed card (`CURRENCY_SERVICE`).
  // v77: a credit card's rushed replacement is a lending fee (`CREDIT_CARD_ONLY`).
  rush_card: { include: /\S/, exclude: new RegExp(`${CURRENCY_SERVICE.source}|${CREDIT_CARD_ONLY.source}`, "i") },
  // v74: an IRA's withdrawals over a count are an IRA charge, not its closing fee (`IRA_EXCESS_WITHDRAWALS`).
  ira_termination: { include: /\S/, exclude: IRA_EXCESS_WITHDRAWALS },
};

/** Categories with only a price ceiling (`PRICE_CEILINGS`), checked by the live sweep too. */
const CEILING_ONLY_CATEGORIES = ["counter_check", "document_reproduction", "late_payment", "notary_fee", "safe_deposit_box"];
export const GUARDED_CATEGORIES: readonly string[] = [...new Set([...Object.keys(CATEGORY_GUARD_RULES), ...CEILING_ONLY_CATEGORIES])];

/** Bump when the rules change, so Darwin re-evaluates rows an older version rejected. */
// v36: PRs 665 and 668 both shipped v35; v36 re-checks rows rejected between their deploys.
// v42: v40 and v41 are Accuracy's (PR 682).
// v43: PR 682's rules ship after Magellan's v42 (PR 684): v40 cheap overdraft protection, v41
// charge-off fees, and names cut from another fee's note plus a reload fee filed as bill pay.
// v44: a paired wire price ("In/Out | $10/$35") in the wrong slot.
// v45: collection items leave check cashing for their own type; ATMs abroad are International
// ATM & Card (Top 50, PR 701).
// v46: a spaced paired wire label ("Wire Out / Wire Out Foreign"), and a wire, card shipment or
// reinstatement fee filed as early closure under a "closed within 90 days" heading.
// v47: Darwin's Oct 8 eval rows: bill pay stops and membership fees, money order research,
// copies and replacements, wire research, business-only and payee-returned NSF rows, and a
// per-item "Overdraft Protection" fee priced like courtesy pay.
// v48: subordination leaves legal process for other lending; a money order copy is a check copy.
// v49: treasury service monthly charges filed as monthly maintenance (Darwin eval 94121).
// v50: "Photocopy of Money Order" is a check copy too (v49 is Accuracy's).
// v51: a certificate penalty paid in dividends, or a forfeited reward, filed as early closure.
// v52: price ceilings for copies, counter checks, late payment, notary and lost keys.
// v53: a business or commercial account's wire price leaves the consumer wire categories.
// v54: a free ATM line naming no other bank or network is the bank's own machine, not a non-network fee;
// a safe deposit box late fee above $250.
// v55: a merchant service's monthly charge or an early termination fee is not monthly maintenance.
// v56: one product priced differently on two current pages keeps the newer page's price
// (`hamilton/cross-page-conflict.ts`; a publish-step check, not a name rule here).
// v57: a cross-border banking bundle's annual fee is monthly maintenance (RBC; v56 is Accuracy's).
// v58: a returned bond or coupon filed as NSF is a returned deposited item (Darwin 883; raw 246460,
// 277863); a waiver sentence's "Otherwise, a fee of" is not monthly maintenance (96164).
// v59: an optional identity-theft, insurance or perks-package add-on is not monthly maintenance (47183).
// v60: a night deposit bag, its key or a bag bundle is not a safe deposit box fee; a lost or
// replaced bag or bag key is the night deposit fee (104666, 32631, 37193, 94606); a sweep
// service's monthly charge is not monthly maintenance (95769).
// v61: a remote deposit capture product ("CheckCapture Maintenance Fee", 76519) is not monthly maintenance (#1196).
// v62: a monthly maintenance row whose own source line charges its price per withdrawal, debit,
// transaction, transfer or item is an activity charge, not the account's fee; one charged for each
// of those over a limit is re-filed to account research, where the top-50 fold files excess
// withdrawal fees (`activityChargeOnLine`, `refileFromLine`); a service charge named for another
// service or priced per item is not monthly maintenance either (#1100).
// v63: Spanish fee names for the guarded categories (#1312); "Deposited Return Items" filed as NSF,
// an international incoming wire filed as domestic and a stop on a cashier's check are re-filed.
// v64: subordination is legal process again (James, Oct 15): legal process accepts it and the v48
// re-file to other lending is gone. Other lending still accepts it, so live fees there stay until
// the fold's switched re-file (`SUBORDINATION_REFILE_LIVE` in fee-fold.ts) moves them.
// v65: excess withdrawals and returned mail are their own types (James, Oct 15, #1398): each has a
// guard rule, and research filed under either goes back to research. Once `RESEARCH_SPLIT_LIVE` is
// on, an excess activity charge on a monthly maintenance row's own line that names savings, money
// market or share withdrawals, transfers or debits re-files to excess withdrawals; every other one,
// and every one while the switch is off, still re-files to account research. While the switch is off
// the guard reads every live fee exactly as v64 did, so the version stays 64 and Hamilton's catch-up
// sweep and Darwin's re-read of older category rejections run once, at switch-on.
// v66 (switch off) / v67 (switch on): v64 and v65 plus one night deposit rule (James, Oct 16, #1099
// option A; #1605): a deposit for the night depository key ("Night Depository Key Deposit", "Night
// Deposit Box Key (Refundable Deposit)", "Deposit for Receptacle Key") is a key charge, not the
// service; a lost or replaced key stays night deposit. 10 live fees, each a key deposit on its own
// schedule, fail it (#1605). A key bought for the depository is out too under option A, but the 43
// live key purchases are a large batch for James, so this version does not refuse them yet.
// v68 (Oct 17; the research split is on since #1748, so this follows v67): a returned foreign,
// Canadian or international check or item (`FOREIGN_ITEM_RETURN` in fee-fold.ts) leaves check
// cashing for the returned deposited item fee, by guard, re-file rule and fold split (10 live fees,
// 93859 and 93400 among them). And bill pay refuses a row that is the overdraft (courtesy pay) or NSF
// fee by its own name or by the heading just before it on its source line (#1304; 8 live fees). The
// v68 rules do not depend on the switch; turning the research split off again needs its own version.
// v69 (Oct 17): a returned Canadian or international item filed as NSF (`FOREIGN_DEPOSIT_RETURN`)
// is a returned deposited item (6 live fees; 92115 "International Returned Item" among them), and an
// IRA's own closing charge filed as an early closure (`IRA_CLOSING`) is the IRA termination fee (12
// live fees; 90972 among them), each by guard, re-file rule and fold split. And the non-network ATM
// fee refuses what non-customers pay at the institution's own ATMs (`OUTSIDER_ATM`; 58 live fees,
// flagged for the second look, then taken down; 125584 is the hand-taken-down example), and a monthly
// ATM add-on or plan (`ATM_PLAN`; 5 live fees, 114331 "Power Checking +ATM Freedom" among them).
// It also refuses ATM-named lines that price something else (`NOT_ATM_USE`; 16 live fees): an ATM
// dispute or a copy of a card sale moves to account research and a lost or stolen card to card
// replacement (4, re-filed after the second look), and 12 with no home or a live twin come down.
// An ATM balance inquiry stays (balance_inquiry is retired and folds here).
// v70 (Oct 17, #1765): a card-product fee filed as the non-network ATM fee (`CARD_PRODUCT_FEE`: the
// card's monthly, annual or maintenance fee, issue, activation, inactivity, a limit increase or a
// point-of-sale purchase fee) and a card's inactivity filed as a dormant account (`CARD_INACTIVITY`)
// fail the guard. None of the 50 types holds them, so their live takedowns wait on
// `CARD_PRODUCT_TAKEDOWN_LIVE` (on since James's yes, Oct 17; off: counted, none taken down). An ATM-named bill payer service
// re-files to bill pay and a card charge on early account closure to early closure. Skipping a loan
// payment (`SKIP_A_PAY`, James, Oct 17) leaves late payment and loan origination for other lending,
// by guard, re-file rule and fold split, and the taxonomy's skip-a-pay aliases point there too.
// v71 (Oct 17, #1772, #1773): the non-network ATM fee also refuses another institution's card named
// in more than one word after "non-" (`OUTSIDER_CARD_WORDS` in `OUTSIDER_ATM`; 8 live fees, 8 of 8
// non-customer surcharges on their stored line, flagged for the second look, then taken down), and
// re-files an ATM transaction verification to account research (`NOT_ATM_USE`; 96092). The bare
// "ATM Surcharge" lines the name cannot place, and in-network $0s and sentence fragments, are hand
// takedowns held by `ATM_SURCHARGE_TAKEDOWN_LIVE` (hand-takedowns.ts; 28, on since James's yes, Oct 17).
// v72 (Oct 17, #1788, James's sample-report review): an ATM used outside the U.S. filed as the
// non-network ATM fee (`INTERNATIONAL_ATM` in fee-fold.ts: "Non-PNC Bank ATM Fee (All Other
// Countries)" $5, 13164) is International ATM & Card, by guard, re-file rule and fold split (5 live
// fees; 4 move, 14348 has a live twin at its bank and price and goes to the second look). And monthly
// maintenance refuses an optional add-on: by name ("Add-On", each additional membership) or by its own
// source line (`addOnOnLine`: "First Commerce offers the ATM Freedom add-on ... For a monthly fee of
// $2.99", 114333). None of the 50 types holds an add-on, so the 5 live fees it fails go to the second
// look and come down. Staying overdrawn for days filed as the per-item overdraft fee
// (`SUSTAINED_OVERDRAFT` by name, `sustainedOverdraftOnLine` by its own line) is the continuous
// overdraft fee (4 live; 3 move, 98702 has a live twin), and a wire the member receives filed as an
// outgoing wire (`INCOMING_WIRE`) is the matching incoming wire fee (7 live, all move).
// v73 (Oct 17, #1837, James's yes): `borrowedDirection` switched on. A bare direction row read under
// the other column's heading ("Check Printing: Incoming" $15, a wire price) fails outside the
// categories a direction prices; 48 live fees (read-only dry run, Oct 17) go to the second look.
// v74 (Oct 19, James's 20 live defects): category rules for research, rushed cards and IRA
// termination, and new refusals for bill pay, non-network ATM, deposited item return and early
// closure; see each rule's v74 note. Counts in the PR (#1026 ledger).
// v75 (Oct 19, #2023, James's "Take down"): `CLUB_WITHDRAWAL_LIVE` on, so a club or holiday account's
// withdrawal fails early closure; the live ones go to the second look and come down.
// v76 (Oct 19, #2037, James's "Split"): International ATM is its own type again. An ATM used abroad
// filed as International ATM & Card (`ATM_ABROAD`) or as the non-network ATM fee re-files to
// `atm_international`, which gets its own rule; the card's type is Foreign Transaction again. Counts
// in the PR (#1026 ledger).
// v77 (Oct 19, W43 live check): a card that draws only on credit (`CREDIT_CARD_ONLY`) fails the
// replacement and rushed card rules; a credit card is a lending product. Counts in the PR.
// v78 (Oct 20, #2449): account verification is guarded by name. Research re-files to
// account research and a domestic wire to the outgoing wire fee (on Darwin's path; the live sweep
// re-files only `RESTORE_REFILES`); a signature guarantee (unmapped in the answer keys), a checking
// or spending account or a positive pay name fails and goes to the second look, and once the
// category is guarded the borrowed-direction rule also fails a verification glued to a wire's
// direction row ("Account Verification NC: Domestic"). Counts in the PR.
// v79 (Oct 20, #1830): bill pay also refuses a name whose own source line puts a stop payment just
// before it ("Stop Payment (includes ACH, Bill Pay) | $10.00" read as "ACH, Bill Pay"): it is the stop
// payment fee. 9 live fees on Oct 20, each with a live stop payment twin at its bank and price, go to
// the second look and come down. A fax-led line is document reproduction by the fold (v19, #1829).
// v80 (Oct 20, #1912, #1905): a PIN replacement fails card replacement (`NOT_A_LONE_PIN`), a home
// equity line's stop payment fails stop payment, a cash advance read from an ATM network table row
// fails (`cashAdvanceFromAtmTable`), and a $0 joined onto a cut lead-in fails (`bandFloorAsPrice`).
// Read-only dry run, Oct 21 01:17 UTC: 13 live fees at 10 institutions go to the second look. A
// non-customer's cashier's check (`nonCustomerCashiersCheck`) waits on James behind
// `NON_CUSTOMER_CASHIERS_CHECK_LIVE` (off; 125 more live fees when on).
// v81 (Oct 22): "Returned Check Deposit" / "Returned Item Deposit" names a returned deposited item
// (the shadow lab's answer keys, #2536: $5 and $32 refused before). It only admits names; no fee that
// passes today fails. Rows rejected as category_mismatch under an older guard are judged once more.
// v82 (Oct 25, #1662): the night deposit key-deposit refusal's exemptions are tied to the key or the
// night deposit noun (`NIGHT_DEPOSIT_KEY_DEPOSIT_EXEMPT`), with word boundaries, so a "Services:"
// header or an unrelated "service"/"monthly" clause no longer keeps a key deposit filed as the
// service. Read-only dry run (Oct 25): none of the 142 live night deposit names that name a key
// changes verdict; the guard catch-up re-checks every live fee once.
// v83 (Oct 25, #1690): the non-network ATM fee refuses research, investigation and photo names
// (re-filed to account research on Darwin's path), an ATM transaction that overdraws a share, and an
// additional card (`NOT_ATM_USE`). Read-only dry run, Oct 25: 4 of 2,290 live atm_non_network fees
// fail and go to the second look; the live sweep's restore list is unchanged.
// v84 (Oct 25, #1788): a monthly maintenance fee named only as a monthly fee or service charge
// (`genericMonthlyCharge`) fails when the cell before its name on its own line, or the heading its
// stored text prints above it (`heading_above`, `headingAboveExcerpt`), names another service:
// Positive Pay, ACH, bill pay, online banking, an ATM, debit or gift card, paper statements, a
// benefits package (`otherServiceMonthlyCharge`). Florida Capital's Positive Pay rows (56683, 56684)
// and TD's paper statement fee (152525, already down for #1774) are the cases. A line that says how
// to avoid the fee, and a heading inside a feature list, keep it. A line printed more than once is
// read under a heading only when every place's heading names another service. Read-only dry run,
// Oct 25: 23 of the 1,951 live generic monthly charges fail, each read on its stored text; Darwin's verify and
// Hamilton's live guard (with its takedown restore) read the heading from the stored text.
// v85 (Oct 25, #1831): a refundable safe deposit box key
// deposit (`SAFE_DEPOSIT_KEY_DEPOSIT`) fails the safe deposit box rule, as v66 does for the night
// deposit; a lost, replaced or duplicate key, drilling and the box's annual or rental fee stay
// (`SAFE_DEPOSIT_KEY_DEPOSIT_EXEMPT`). No type holds a key deposit, so the live ones go to the second
// look and come down. Dry-run count in the PR.
// v86 (Oct 25, #1918): monthly maintenance also admits a checking account's own named fee ("MAX
// Checking Fee (per month)", "Jumpstart Checking Account Fee", Bellco FCU's $3.95), read by the
// pattern Knox files it with (`namedForCheckingAccount`, `@/lib/checking-fee-name`), so the two never
// drift. The pattern keeps out opening, setup and reopening charges, business accounts, other fees'
// words and a period other than the month. It only admits names; no fee that passes today fails.
// Read-only dry run (Oct 25): only a name containing "checking (account) fee|charge" can change
// verdict; of the 38 live fees and 2 guard takedowns with one, none changes verdict, re-file or restore.
// v87 (Oct 25, #1916): a late payment its stored text prints in a safe deposit box
// section (`box_section`, read by `withBoxSection` with `boxSectionLateFee`: "Safe Deposit Box Fees" /
// "Late Payment (per month) | $10.00", U.S. Bank 75926; "page | Safe Deposit Box 30 Day" over
// "Courtesy Pay Coverage | Late Payment (by credit union | $10", Advia FCU 142240) is the box's late
// rent charge: it fails late_payment and re-files to safe_deposit_box (`refileFromLine`), in place on
// Hamilton's live guard with its own name and price. Where the bank already has a live box late fee
// at that price (or a second copy moves in the same sweep), the copy is not moved and goes to the second
// look. Read-only dry run, Oct 25: of 410 live late_payment fees whose text names a safe deposit box,
// 299 pass; 111 at 110 institutions fail, 99 re-file in place, 11 have a live box late fee twin (142240
// beside 139815, ...) and 1 is the second copy at its bank (35992 beside 9785): those 12 come down.
// v88 (Oct 25, #1912): a book transfer (`BOOK_TRANSFER`) fails both domestic wire categories, and a
// cash advance whose own line prices it at another bank's ATMs (`cashAdvanceAtOtherAtm`) fails cash
// advance. Read-only dry run, Oct 25: 5 live fees go to the second look (M&T 145046 and 68601; IBC's
// book transfers 26125, 35171, 121267). None re-files.
// v89 (Oct 25, #1877): a credit union's "Draft Protection
// Fee" is its paid-overdraft fee and the overdraft rule accepts the name (`DRAFT_PROTECTION_FEE`, shared
// with Knox v112). Abbey FCU's own "Draft Protection Fee (Paid) per presentment" $30 was set aside by
// Knox and would be refused as name_unsupported, so its "Overdraft at teller window" line stood in as
// its overdraft fee. A channel-specific overdraft (ATM, debit card, in-person or teller) stays
// overdraft, as about 300 live rows already are; the institution value is its highest overdraft amount
// (DECISIONS, tiered overdraft). It only admits names; no fee that passes today fails. Read-only dry
// run (Oct 25): 1 live fee matches the wording ("Overdraft Paid by Over Draft Protection (OD)", already
// overdraft, verdict unchanged); 0 live fees are held, re-filed or taken down.
// v90 (Oct 25, #1912): a plain return charge ("Returned Check Fee", "Return Items") its stored text
// prints in a foreign check or collection section (`collection_section`, read by
// `withCollectionSection` with `collectionSectionReturn`: U.S. Bank 75929 under "Foreign Check
// Collection (incoming/outgoing)" after "Tracer Fee | $50.00"; BankUnited 56558 under "COLLECTIONS" and
// 109208 under "FOREIGN CHECK CLEARING") is a deposited item coming back unpaid: it fails NSF and re-files
// to deposited_item_return (`refileFromLine`), only where that type accepts the name. And a late charge
// whose name names the safe deposit box (`SAFE_DEPOSIT_BOX_NAME`: "Safety Deposit Box-Late Fee" 36020,
// "SDB Late Payment" 159317) fails late_payment and re-files to safe_deposit_box. Read-only dry run,
// Oct 25: of 4,002 live NSF fees, 3 fail (75929 re-files in place; 56558 and 109208 have a live
// "Return Items" $25 twin, 157215, so they go to the second look); of 1,102 live late payments, 5 fail
// (159317 re-files in place; 152482, 153210 and 155092 each have their own live box late twin, and
// 36020's $1 is below the box type's $5 floor, so those 4 go to the second look). None of the 2,975
// live domestic outgoing wires changes: the book transfer refusal shipped in v88.
// v91 (Oct 25, #1905): a share withdrawal at an ATM the bank does not own or another network's ("Share
// withdrawal at Non-Navy Federal/Non-CO-OP Network ATM", read by Knox v114 from an ATM network table)
// passes the non-network ATM fee; the savings-limit charge ("ATM Share Savings Withdrawal (over 3x per
// month)") stays out. It only admits names. Read-only dry run (Oct 25): 0 live and 0 raw rows carry
// the wording, so no fee is held, re-filed or taken down.
export const CATEGORY_GUARD_VERSION = 91;

/** v87 (#1916): where a late charge printed in a safe deposit box section is filed. */
export const BOX_LATE_TARGET = "safe_deposit_box";
/** v90 (#1912): where a return charge printed in a foreign check or collection section is filed. */
export const COLLECTION_RETURN_TARGET = "deposited_item_return";

function collectionSectionReason(name: string): string {
  return `"${name}" is printed in a foreign check or collection section of its schedule: a deposited item coming back unpaid, not the member's NSF fee`;
}

/** v90 (#1912): the fee's stored text prints it in a collection section, and the returned deposited item type accepts it. */
function collectionReturn(canonicalFeeKey: string, name: string, context: CategoryGuardContext | undefined): boolean {
  return canonicalFeeKey === "nsf" && context?.collection_section === true && checkFeeCategory(COLLECTION_RETURN_TARGET, name, context).ok;
}

/**
 * v90 (#1912): the guard context with `collection_section` read from the fee's stored text, for an
 * NSF fee only (every other fee is returned as it is, so no text is needed for it). Darwin's verify,
 * Hamilton's live guard and its takedown restore call it with each such fee's stored text.
 */
export function withCollectionSection<T extends CategoryGuardContext>(
  canonicalFeeKey: string | null | undefined,
  feeName: string | null | undefined,
  context: T,
  text: string | null | undefined,
): T {
  if (canonicalFeeKey !== "nsf" || !text || !feeName) return context;
  const amount = context.amount == null || context.amount === "" ? null : Number(context.amount);
  return { ...context, collection_section: collectionSectionReturn(text, feeName, amount != null && Number.isFinite(amount) ? amount : null) };
}

function boxSectionReason(name: string): string {
  return `"${name}" is printed in a safe deposit box section of its schedule: the box's late rent charge, not a loan's late payment`;
}

/**
 * v87 (#1916): the guard context with `box_section` read from the fee's stored text, for a late
 * payment only (every other fee is returned as it is, so no text is needed for it). Hamilton's live
 * guard and its takedown restore call it with each such fee's stored text.
 */
export function withBoxSection<T extends CategoryGuardContext>(
  canonicalFeeKey: string | null | undefined,
  feeName: string | null | undefined,
  context: T,
  text: string | null | undefined,
): T {
  if (canonicalFeeKey !== "late_payment" || !text || !feeName) return context;
  const amount = context.amount == null || context.amount === "" ? null : Number(context.amount);
  return { ...context, box_section: boxSectionLateFee(text, feeName, amount != null && Number.isFinite(amount) ? amount : null) };
}

/**
 * Categories whose fee is usually a rate ("1% of the transaction"). A dollar amount filed
 * under one, on a line that states a percent ("Debit Card Foreign Transaction 1% of the
 * U.S. dollar amount ... $7.00") or names a rate ("VISA Exchange Rate"), is the rate read
 * as dollars or a neighbouring figure. A rate itself is stored as a rate with no dollar
 * amount, so this never touches it.
 */
const RATE_CATEGORIES: ReadonlySet<string> = new Set(["card_foreign_txn", "atm_international"]);
// "Currency conversion fees will be assessed when ..." quotes a rate stated elsewhere.
const RATE_IN_NAME = /(\d\s*%|percent|\brates?\b|\b(will|may) be (assessed|charged)\b)/i;
const RATE_IN_CONDITIONS = /(\d\s*%|percent)/i;

function statesRate(
  canonicalFeeKey: string,
  name: string,
  context: CategoryGuardContext | undefined,
): string | null {
  if (!context || !RATE_CATEGORIES.has(canonicalFeeKey)) return null;
  if (context.amount == null || context.amount === "") return null;
  // Knox's provenance note quotes the whole table row, whose other cells may hold rates
  // for other fees ("| Balance Transfer Fee | 3% of amt"); only the stated terms count.
  const terms = context.conditions?.replace(/\bexcerpt=[\s\S]*$/, "");
  return name.match(RATE_IN_NAME)?.[0] ?? terms?.match(RATE_IN_CONDITIONS)?.[0] ?? null;
}

/**
 * A fee Knox filed under a neighbouring category whose own name says which one it is: an
 * "Overdraft Transfer from Savings" filed as overdraft, an "International Wire - Outgoing"
 * filed as a domestic wire, an "ATM/Debit Card Replacement" filed as an ATM fee, a "Paid NSF
 * Item" filed as NSF. Darwin re-files such a row instead of rejecting a real fee, but only
 * when the new category's own guard accepts the name, so the guard is never loosened.
 */
const REFILE_RULES: ReadonlyArray<{ from: string; to: string; when: RegExp; unless?: RegExp }> = [
  {
    from: "overdraft",
    to: "od_protection_transfer",
    // "Account Link Overdraft Protection" (Spencer Savings) is the linked-account transfer, not the overdraft fee.
    when: /(transfer|xfe?r\b|sweep|from (your |a |linked |eligible )?(savings|shares?|account|loan|line)|\blink(ed)? overdraft protection|account link)/i,
  },
  { from: "nsf", to: "od_protection_transfer", when: /(transfer|xfe?r\b|sweep)/i },
  { from: "nsf", to: "overdraft", when: /(paid nsf|paid (?:[\w&]+ ){1,3}nsf items?|nsf[- ]paid|items? paid|\(\s*paid\s*\)|paid (?:non[-\s]?|in)sufficient|\(\s*honou?red\s*\)|(?:nsf|(?:in|non[-\s]?)sufficient)\b[^|]{0,30}?(?:(?<!\bnon)[-–]\s*|\(\s*(?:check\s+)?)paid\b(?!\s+(?:or|from|by)\b))/i },
  // "Returned Item fee (written to you)" is a check the customer deposited coming back.
  // v63: "Deposited Return Items" (Community First Guam FCU 327091) and "Depósito en cheque devuelto".
  { from: "nsf", to: "deposited_item_return", when: /(deposit|dep[oó]sit|written to you|\bbonds?\b|\bcoupons?\b)/i },
  { from: "safe_deposit_box", to: "night_deposit", when: /(\bbags?\b|depository|night deposit)/i },
  { from: "wire_domestic_outgoing", to: "wire_intl_outgoing", when: /(international|foreign|intl|\bint['’]l\b|internacional|extranjer)/i, unless: /(domestic|dom[eé]stic|\bnacional)/i },
  // v63: "International wire transfer (Incoming)" $40 filed as a domestic incoming wire (Coast360 FCU 462933).
  // One price for domestic and international, or for both directions, stays where it is, as do a
  // check collection, a currency cell joined into the name, a cut-off sentence and an account name.
  {
    from: "wire_domestic_incoming",
    to: "wire_intl_incoming",
    when: /^(?=.*(wire|transferencias? bancarias?)).*(international|foreign|intl|\bint['’]l\b|internacional|extranjer)/i,
    unless: /(domestic|dom[eé]stic|\bnacional|outgoing|outbound|\bsend|\bsent\b|saliente|collection|currency|must be|not accepting|\belite\b)/i,
  },
  // v63: a stop on a cashier's check filed as the cashier's check ("Suspension of payment on a Cashier's Checks").
  { from: "cashiers_check", to: "stop_payment", when: /(\bstop\b|suspensi[oó]n|suspender|detener|parar)/i },
  { from: "overdraft", to: "late_payment", when: /\blate (payment|charge|fee)\b/i },
  // v72 (#1788): staying overdrawn for days is the continuous overdraft fee, and a wire the member
  // receives filed as an outgoing wire is the incoming wire fee (domestic or international by its name).
  { from: "overdraft", to: "continuous_od", when: SUSTAINED_OVERDRAFT },
  { from: "wire_domestic_outgoing", to: "wire_domestic_incoming", when: INCOMING_WIRE },
  { from: "wire_domestic_outgoing", to: "wire_intl_incoming", when: INCOMING_WIRE },
  { from: "wire_intl_outgoing", to: "wire_intl_incoming", when: INCOMING_WIRE },
  // v41: a charge-off processing fee sits with the other charge-off fees under account research.
  { from: "overdraft", to: "account_research", when: /\bcharge(d)?[- ]?off\b/i },
  { from: "check_cashing", to: "account_research", when: /\bcharge(d)?[- ]?off\b/i },
  // v65: research or reconciliation filed as an excess withdrawal or returned mail is account research.
  { from: "excess_withdrawal", to: "account_research", when: /\bresearch|\breconcil/i },
  // An IRA's excess withdrawal charge is a charge on the IRA itself (`IRA_EXCESS_WITHDRAWAL` in fee-fold.ts).
  { from: "excess_withdrawal", to: "ira_administration", when: /\bira\b/i },
  { from: "returned_mail", to: "account_research", when: /\bresearch|\breconcil/i },
  { from: "deposited_item_return", to: "card_dispute", when: /((\bcards?\b|visa)[^|]{0,25}charge[- ]?back|charge[- ]?back[^|]{0,25}(\bcards?\b|dispute))/i },
  // v69: lost or stolen cards ("Lost/Stolen ATM/MasterCard®"); a blocked card is not a replacement.
  { from: "atm_non_network", to: "card_replacement", when: /(replac|reissue|re-?issu|lost|stolen)/i, unless: /\bpins?\b|\bblock/i },
  // v69: an ATM dispute or a copy of a card sale is research.
  // v71: verifying an ATM transaction is research too (96092, #1773).
  { from: "atm_non_network", to: "account_research", when: /\bdisput|\b(?:photo ?)?cop(?:y|ies) of\b|\bverification of\b/i },
  // v83 (#1690): an investigation or research listing ATM items, and ATM photos, are research too.
  // A card's own research or film fee ("ATM Card Research/Film Fee" $75, Rally FCU, keyed as the
  // retired card dispute type) is not re-filed: the fold gives a card dispute without a dispute word
  // no home (`card_dispute` in fee-fold.ts), so it fails and is not read.
  { from: "atm_non_network", to: "account_research", when: new RegExp(ATM_RESEARCH, "i"), unless: /\bcards?\b/i },
  // v70: an ATM-named bill payer service is bill pay, and a card charge on closing the account early
  // is an early closure (`CARD_SERVICE_ELSEWHERE`).
  { from: "atm_non_network", to: "bill_pay", when: /\bbill payer\b/i },
  // v72 (#1788): an ATM used outside the U.S. is International ATM (International ATM & Card until v76).
  { from: "atm_non_network", to: "atm_international", when: INTERNATIONAL_ATM },
  // v76 (#2037): and so is one filed as the card's foreign transaction fee. An international ATM
  // line that also prices debit card use or purchases is the card's fee, and one priced for domestic
  // and international ATMs together, or inside the U.S., is the non-network ATM fee.
  { from: "card_foreign_txn", to: "atm_international", when: ATM_ABROAD },
  { from: "atm_international", to: "card_foreign_txn", when: /\b(?:debit|pos|point of sale|purchases?|check ?cards?)\b/i },
  { from: "atm_international", to: "atm_non_network", when: /\bdomestic\b|\bnon[- ]?international\b|\binternationally\b|\b(?:inside|within)\s+(?:the\s+)?(?:u\.?s\.?a?(?![a-z])|united states)/i },
  { from: "atm_non_network", to: "early_closure", when: new RegExp(EARLY_CLOSE, "i") },
  // v70: skipping a loan payment is other lending, not a late payment or a loan origination.
  { from: "late_payment", to: "other_lending_fee", when: SKIP_A_PAY },
  // v90 (#1912): a late charge named for the safe deposit box is the box's (as the fold's split has it).
  { from: "late_payment", to: BOX_LATE_TARGET, when: SAFE_DEPOSIT_BOX_NAME },
  { from: "loan_origination", to: "other_lending_fee", when: SKIP_A_PAY },
  { from: "check_printing", to: "counter_check", when: /\btemporar/i },
  { from: "check_cashing", to: "collection_item", when: COLLECTION_ITEM },
  // v68: a returned foreign check or item filed as check cashing is a returned deposited item.
  { from: "check_cashing", to: "deposited_item_return", when: FOREIGN_ITEM_RETURN },
  // v69: a returned foreign check or item filed as NSF is a returned deposited item too, and an
  // IRA's own closing charge filed as an early closure is the IRA termination fee.
  { from: "nsf", to: "deposited_item_return", when: FOREIGN_DEPOSIT_RETURN },
  { from: "early_closure", to: "ira_termination", when: IRA_CLOSING },
  { from: "money_order", to: "check_image", when: ITEM_COPY },
  { from: "card_replacement", to: "rush_card", when: new RegExp(EXPRESS_CARD, "i") },
  { from: "minimum_balance", to: "early_closure", when: new RegExp(EARLY_CLOSE, "i") },
  { from: "minimum_balance", to: "dormant_account", when: new RegExp(INACTIVE, "i") },
  { from: "monthly_maintenance", to: "overdraft", when: /\boverdraft (privilege|courtesy)/i },
  { from: "card_foreign_txn", to: "atm_non_network", when: /(?<!\/\s?)\batm'?s?\b[^|\/]{0,12}\bforeign transactions?/i },
  // v74 (James's 20 live defects, Oct 19): a payment investigation is research, withdrawals over a
  // count or returned mail filed as research go to their own types, an IRA's excess withdrawals to
  // IRA administration, foreign currency shipping to courier and delivery, and a loan payment filed
  // as a returned deposited item to other lending.
  { from: "bill_pay", to: "account_research", when: PAYMENT_INVESTIGATION },
  { from: "account_research", to: "excess_withdrawal", when: NOT_RESEARCH_WITHDRAWAL },
  { from: "account_research", to: "returned_mail", when: NOT_RESEARCH_MAIL },
  { from: "ira_termination", to: "ira_administration", when: IRA_EXCESS_WITHDRAWALS },
  { from: "rush_card", to: "courier_delivery", when: CURRENCY_SERVICE },
  { from: "deposited_item_return", to: "other_lending_fee", when: LOAN_PAYMENT },
  // v78: research filed as account verification is account research, and a wire is the wire fee its name states.
  { from: "account_verification", to: "account_research", when: RESEARCH_WORD },
  { from: "account_verification", to: "wire_domestic_outgoing", when: /\bwires?\b/i, unless: /incoming|receiv|international|foreign|\bintl\b/i },
];

/** v74: a re-file rule from `canonicalFeeKey` matches the name and its target's guard accepts it (`onlyIfRefiles`). */
function refileTargetAccepts(canonicalFeeKey: string, name: string): boolean {
  return REFILE_RULES.some(
    (rule) => rule.from === canonicalFeeKey && rule.when.test(name) && !rule.unless?.test(name) && checkFeeCategory(rule.to, name).ok,
  );
}

/** Categories fees filed under `canonicalFeeKey` are re-filed to when their name says so. */
export function neighbourCategories(canonicalFeeKey: string): string[] {
  return [...new Set(REFILE_RULES.filter((rule) => rule.from === canonicalFeeKey).map((rule) => rule.to))];
}

/** The category a fee belongs in: its own, or the one its name re-files it to. */
// PDFs and web pages write "Teller’s Check" and "ATM’s" with curly quotes; the rules use '.
function plainQuotes(name: string): string {
  return name.replace(/[‘’ʼ`]/g, "'");
}

export function refileCategory(
  canonicalFeeKey: string | null | undefined,
  feeName: string | null | undefined,
  /** Schedule text just before the fee's line (`foldContext`), when the caller has it. */
  context?: string | null,
): string | null {
  if (!canonicalFeeKey) return null;
  return foldedInto(refiledCategory(canonicalFeeKey, feeName), feeName, context);
}

function refiledCategory(canonicalFeeKey: string, feeName: string | null | undefined): string {
  if (checkFeeCategory(canonicalFeeKey, feeName).ok) return canonicalFeeKey;
  const name = plainQuotes(feeName ?? "");
  const rule = REFILE_RULES.find(
    (candidate) =>
      candidate.from === canonicalFeeKey &&
      candidate.when.test(name) &&
      !candidate.unless?.test(name) &&
      checkFeeCategory(candidate.to, name).ok,
  );
  return rule ? rule.to : canonicalFeeKey;
}

/**
 * A fee under a category retired by the top-50 fold goes where its wording places it
 * (`fee-fold.ts`), when that category's guard accepts the name. One with no home keeps
 * the retired key, which Hamilton never publishes.
 */
function foldedInto(key: string, feeName: string | null | undefined, context?: string | null): string {
  const target = foldRetiredCategory(key, feeName, context)?.to;
  return target && checkFeeCategory(target, feeName).ok ? target : key;
}

export const PLAIN_RETURNED_ITEM = /^\s*return(?:ed)?\s+(?:check|item)s?(?:\s+(?:fee|charge)s?)?\s*:?\s*$/i;
/** The schedule's NSF fee must be at least this, and above the returned check's own price. */
const SCHEDULE_NSF_MIN = 15;

/**
 * v40: an "Overdraft Protection Fee" of $15 or less that names no paid item is the linked-account
 * transfer's fee, not the overdraft fee: First Pioneers' $5 "Overdraft Protection Fee" sits beside
 * its $25 Courtesy Pay (Darwin hand check, Oct 8). Of 83 live overdraft fees named "overdraft
 * protection", the 41 at $15 or less are mostly transfers or $0 notes; most at $20 or more are
 * the overdraft fee itself, so the amount decides.
 */
const OVERDRAFT_PROTECTION_MAX = 15;
const PAID_ITEM_WORDS = /(courtesy|\bpaid\b|opt|privilege|bounce|presentment|honou?r|\bitems?\b|\bnsf\b)/i;

function cheapOverdraftProtection(canonicalFeeKey: string, name: string, context: CategoryGuardContext | undefined): string | null {
  if (canonicalFeeKey !== "overdraft" || context?.amount == null || context.amount === "") return null;
  const amount = Number(context.amount);
  if (!Number.isFinite(amount) || amount > OVERDRAFT_PROTECTION_MAX) return null;
  if (!/overdraft protection/i.test(name) || PAID_ITEM_WORDS.test(name)) return null;
  return `"${name}" at $${amount.toFixed(2)} is an overdraft protection transfer's fee, not the overdraft fee`;
}

/**
 * v47: an "Overdraft Protection" fee charged per item at an overdraft fee's price ("Free with
 * Overdraft Protection, $25.00 per item", "Overdraft Protection - if opted in $29.00 each item")
 * is courtesy pay, the overdraft fee, when its row names no transfer (Darwin eval, Oct 8).
 */
const PER_ITEM_OVERDRAFT_MIN = 20;
function perItemOverdraftProtection(canonicalFeeKey: string, name: string, context: CategoryGuardContext | undefined): string | null {
  if (canonicalFeeKey !== "od_protection_transfer" || context?.amount == null || context.amount === "") return null;
  const amount = Number(context.amount);
  const excerpt = context.conditions?.match(/\bexcerpt=([\s\S]*)$/)?.[1] ?? "";
  if (!Number.isFinite(amount) || amount < PER_ITEM_OVERDRAFT_MIN || /transfer|sweep|advance|from (your )?(savings|share|line|credit)/i.test(`${name} ${excerpt}`)) return null;
  if (!/\$\s?\d+(\.\d\d)?\s*(?:(?:per|each|\/)\s*item\b|each\b)/i.test(excerpt)) return null;
  return `"${name}" at $${amount.toFixed(2)} per item is the overdraft (courtesy pay) fee, not a transfer's fee`;
}

/**
 * A plain "Returned Check Fee" filed as NSF, on a schedule whose NSF or insufficient-funds fee is
 * a separate, higher price, is the return deposited item (RDI) fee: Dean Co-operative Bank's
 * "Returned Check Fee $7" beside "Insufficient Funds Fee (Paid or Returned) $35.00" (v22, Oct 8).
 * v23 drops v22's $10 ceiling: 130 live "returned check" NSF fees sat beside a higher NSF fee, 115
 * of them at $10 or more. One at the NSF fee's own price is that fee under another name, and one
 * on a schedule with no NSF line is left alone.
 */
function returnBesideNsf(canonicalFeeKey: string, name: string, context: CategoryGuardContext | undefined): string | null {
  if (canonicalFeeKey !== "nsf" || !context || !PLAIN_RETURNED_ITEM.test(name)) return null;
  const amount = Number(context.amount);
  const nsf = Number(context.document_nsf_amount);
  if (context.amount == null || context.document_nsf_amount == null || !Number.isFinite(amount) || !Number.isFinite(nsf)) return null;
  if (amount <= 0 || nsf < SCHEDULE_NSF_MIN || nsf <= amount) return null;
  return `"${name}" at $${amount.toFixed(2)} sits on a schedule whose NSF fee is $${nsf.toFixed(2)}, so it is the return deposited item fee`;
}

const COUNT_IN_NOTE = /(\b\d{1,2}\b|\b(one|two|three|four|five|six|seven|eight|nine|ten)\b)/i;

/** True when every `exclude` word in the name is a daily-count cap inside a per-item fee's note. */
function capOnlyInNotes(rule: CategoryRule, name: string, context: CategoryGuardContext | undefined): boolean {
  const capped = rule.capInNotes;
  if (!capped) return false;
  const notes = name.match(/\([^()]*(?:\)|$)/g);
  if (!notes) return false;
  const outside = name.replace(/\([^()]*(?:\)|$)/g, " ");
  if (rule.exclude.test(outside) || !capped.item.test(outside)) return false;
  const noteText = notes.join(" ");
  // The note must count the items ("Maximum of 5", "4 per day"); "(maximum charge per day)"
  // prices the cap itself. A dollar figure in the note may be the cap's amount, unless the row's
  // own price is known and below it: "(maximum of $100 per day)" beside $25 is the item's cap (v35).
  const dollars = [...noteText.matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)/g)].map((m) => Number(m[1].replace(/,/g, "")));
  const amount = context?.amount == null ? NaN : Number(context.amount);
  const capAboveItem = dollars.length > 0 && amount > 0 && dollars.every((cap) => cap > amount);
  if (dollars.length > 0 ? !capAboveItem : !COUNT_IN_NOTE.test(noteText)) return false;
  const words = noteText.match(new RegExp(rule.exclude.source, "gi")) ?? [];
  return words.length > 0 && words.every((word) => capped.cap.test(word));
}

export function checkFeeCategory(
  canonicalFeeKey: string | null | undefined,
  feeName: string | null | undefined,
  context?: CategoryGuardContext,
  /**
   * `cardProducts: false` reads the fee without the v70 card-product rule (`cardProductMisfile`);
   * `borrowedDirection` overrides `BORROWED_DIRECTION_LIVE` (the dry-run count and tests).
   */
  options?: { cardProducts?: boolean; borrowedDirection?: boolean; nonCustomerCashiersCheck?: boolean },
): CategoryGuardVerdict {
  const rule = canonicalFeeKey ? CATEGORY_GUARD_RULES[canonicalFeeKey] : undefined;
  if (!canonicalFeeKey) return { ok: true };
  const name = plainQuotes(feeName ?? "").trim();
  const direction = borrowedDirection(canonicalFeeKey, name, options?.borrowedDirection ?? BORROWED_DIRECTION_LIVE);
  if (direction) {
    return {
      ok: false,
      code: "name_contradicts",
      reason: `${BORROWED_DIRECTION_REASON}: "${name}" is a direction row ("${direction}") read under a heading it did not sit under; ${canonicalFeeKey} is not priced by direction`,
    };
  }
  if (!rule) {
    const ceilingReason = aboveCeiling(canonicalFeeKey, name, context);
    return ceilingReason ? { ok: false, code: "amount_implausible", reason: ceilingReason } : { ok: true };
  }
  const rate = statesRate(canonicalFeeKey, name, context);
  if (rate) {
    return {
      ok: false,
      code: "rate_as_amount",
      reason: `"${name}" states a rate ("${rate}"), so its dollar amount is not the ${canonicalFeeKey} fee`,
    };
  }
  const soft = rule.excludeUnless;
  // A note runs to its closing parenthesis, or to the end of a name cut mid-note.
  const softName = soft?.outsideNotes ? name.replace(/\([^()]*(?:\)|$)/g, " ") : name;
  const capOnly = capOnlyInNotes(rule, name, context);
  // v35: a daily-cap note may name the other fee it shares the cap with: "Overdraft Fee - each
  // debit or check presentment paid (Consumer Accts: 5 max total OD or Returned Item fees daily)".
  const softExcluded = soft && !soft.unless.test(softName) ? (capOnly ? softName : name).match(soft.pattern) : null;
  const matched = (capOnly ? null : name.match(rule.exclude)) ?? softExcluded ?? (rule.excludeExact && /[a-z]/.test(name) ? name.match(rule.excludeExact) : null);
  const excluded = matched && rule.onlyIfRefiles && !refileTargetAccepts(canonicalFeeKey, name) ? null : matched;
  if (excluded) {
    return {
      ok: false,
      code: "name_contradicts",
      reason: `"${name}" describes a different fee than ${canonicalFeeKey} ("${excluded[0]}")`,
    };
  }
  const outsider = nonCustomerCashiersCheck(canonicalFeeKey, name, options?.nonCustomerCashiersCheck ?? NON_CUSTOMER_CASHIERS_CHECK_LIVE);
  if (outsider) {
    return { ok: false, code: "name_contradicts", reason: `"${name}" is the price non-customers pay ("${outsider}"), not the ${canonicalFeeKey} fee` };
  }
  const cardProduct = options?.cardProducts === false ? null : cardProductMisfile(canonicalFeeKey, name);
  if (cardProduct) {
    return {
      ok: false,
      code: "name_contradicts",
      reason: `${CARD_PRODUCT_REASON}: "${name}" prices the card itself, not ${canonicalFeeKey} ("${cardProduct}")`,
    };
  }
  if (!rule.include.test(name) && !(canonicalFeeKey === "excess_withdrawal" && GENERIC_SERVICE_CHARGE.test(name) && savingsOverLimitLine(name, context)) &&
      !(canonicalFeeKey === "monthly_maintenance" && namedForCheckingAccount(name))) {
    return {
      ok: false,
      code: "name_unsupported",
      reason: `"${name}" does not name a ${canonicalFeeKey} fee`,
    };
  }
  const scheduleReason = returnBesideNsf(canonicalFeeKey, name, context);
  if (scheduleReason) return { ok: false, code: "schedule_contradicts", reason: scheduleReason };
  const protectionReason = cheapOverdraftProtection(canonicalFeeKey, name, context);
  if (protectionReason) return { ok: false, code: "name_contradicts", reason: protectionReason };
  const courtesyReason = perItemOverdraftProtection(canonicalFeeKey, name, context);
  if (courtesyReason) return { ok: false, code: "name_contradicts", reason: courtesyReason };
  const noteReason = noteTailOfAnotherFee(canonicalFeeKey, name, context);
  if (noteReason) return { ok: false, code: "name_contradicts", reason: noteReason };
  const billPayReason = overdraftOrNsfBillPay(canonicalFeeKey, name, context);
  if (billPayReason) return { ok: false, code: billPayReason.code, reason: billPayReason.reason };
  const activityReason = activityChargeOnLine(canonicalFeeKey, context);
  if (activityReason) return { ok: false, code: "schedule_contradicts", reason: activityReason.reason };
  if (canonicalFeeKey === "late_payment" && context?.box_section === true) {
    return { ok: false, code: "schedule_contradicts", reason: boxSectionReason(name) };
  }
  if (collectionReturn(canonicalFeeKey, name, context)) {
    return { ok: false, code: "schedule_contradicts", reason: collectionSectionReason(name) };
  }
  const addOnReason = addOnOnLine(canonicalFeeKey, context);
  if (addOnReason) return { ok: false, code: "schedule_contradicts", reason: addOnReason };
  const serviceReason = otherServiceMonthlyCharge(canonicalFeeKey, name, context);
  if (serviceReason) return { ok: false, code: "schedule_contradicts", reason: serviceReason };
  const sustainedReason = sustainedOverdraftOnLine(canonicalFeeKey, context);
  if (sustainedReason) return { ok: false, code: "schedule_contradicts", reason: sustainedReason };
  const atmTableReason = cashAdvanceFromAtmTable(canonicalFeeKey, context) ?? cashAdvanceAtOtherAtm(canonicalFeeKey, context);
  if (atmTableReason) return { ok: false, code: "schedule_contradicts", reason: atmTableReason };
  const bandReason = bandFloorAsPrice(context);
  if (bandReason) return { ok: false, code: "schedule_contradicts", reason: bandReason };
  const slotReason = pairedPriceSlot(canonicalFeeKey, context);
  if (slotReason) return { ok: false, code: "schedule_contradicts", reason: slotReason };
  const ownAtmReason = freeAtOwnAtm(canonicalFeeKey, name, context);
  if (ownAtmReason) return { ok: false, code: "name_unsupported", reason: ownAtmReason };
  const ceilingReason = aboveCeiling(canonicalFeeKey, name, context);
  if (ceilingReason) return { ok: false, code: "amount_implausible", reason: ceilingReason };
  return { ok: true };
}

/**
 * v52: prices no bank charges for these fees. A scan that dropped the decimal point prints
 * "$200" for $2.00 (Central Bank's document 4422: temporary checks $200, photocopy $200, notary
 * $500, lost key $1000, safe deposit late fee $1000, beside "$5.00" and "$100.00" on the same
 * page). The fee is flagged for the second look, never re-priced.
 */
const PRICE_CEILINGS: ReadonlyArray<{ key: string; max: number; when?: RegExp }> = [
  { key: "counter_check", max: 100 },
  { key: "document_reproduction", max: 100 },
  { key: "late_payment", max: 250 },
  { key: "notary_fee", max: 300 },
  // A lost key with rekeying runs up to about $250; drilling the box open ($250-$500) is not capped.
  { key: "safe_deposit_box", max: 300, when: /^(?!.*drill).*\b(lost|replace\w*|duplicate)\s+keys?\b/i },
  // v54: a late payment on the box (Central Bank's "$1000", fee 23863, read from "$10.00").
  { key: "safe_deposit_box", max: 250, when: /^(?!.*drill).*\blate\b/i },
];

function aboveCeiling(canonicalFeeKey: string, name: string, context: CategoryGuardContext | undefined): string | null {
  const amount = Number(context?.amount);
  if (!Number.isFinite(amount)) return null;
  const ceiling = PRICE_CEILINGS.find((entry) => entry.key === canonicalFeeKey && (!entry.when || entry.when.test(name)));
  if (!ceiling || amount <= ceiling.max) return null;
  return `$${amount.toFixed(2)} is above any ${canonicalFeeKey} price ($${ceiling.max} ceiling); a scan may have dropped its decimal point`;
}

/** Words that place an ATM fee at another bank's or network's machine. */
const OTHER_NETWORK_CUE =
  /\b(non|foreign|others?|another|network|surcharg\w*|outside|out[- ]of|not\s+(own|operate)|do(es)?\s+not|don['’]t|any|nationwide|national|shared|co-?op|allpoint|moneypass|cirrus|plus|star|pulse|presto|international|third[- ]party|refund\w*|rebate\w*)\b/i;

/**
 * v54: a free ATM line that names no other bank or network is the bank's own machine ("MidFirst
 * ATM $0", "Transactions at Orrstown Bank ATMs | No charge", Regions' "Balance Inquiry $0.00"
 * under "Regions ATM:") or a card's own fee ("ATM Enrollment | No Charge"), not what a customer
 * pays at another network's ATM. 41 live rows on Oct 9; a priced line is left alone.
 */
function freeAtOwnAtm(canonicalFeeKey: string, name: string, context: CategoryGuardContext | undefined): string | null {
  if (canonicalFeeKey !== "atm_non_network" || context?.amount == null || context.amount === "") return null;
  const amount = Number(context.amount);
  if (!Number.isFinite(amount) || amount !== 0 || OTHER_NETWORK_CUE.test(name)) return null;
  return `"${name}" is free and names no other bank's or network's ATM, so it is not the atm_non_network fee`;
}

const PAIRED_PRICES = /\$\s?(\d[\d,]*(?:\.\d{2})?)\s*\/\s*\$\s?(\d[\d,]*(?:\.\d{2})?)/;
const SLASH_PAIR = /([A-Za-z'’]+)\s*\/\s*([A-Za-z'’]+)/g;
const WIRE_SIDES: ReadonlyArray<{ pattern: RegExp; value: string }> = [
  { pattern: /^(international|foreign|intl|int['’]l)$/i, value: "intl" },
  { pattern: /^domestic$/i, value: "domestic" },
  { pattern: /^(out|outgoing|outbound)$/i, value: "out" },
  { pattern: /^(in|incoming|inbound)$/i, value: "in" },
];
const WIRE_DIMENSIONS: Record<string, ReadonlyArray<string>> = { geo: ["intl", "domestic"], dir: ["out", "in"] };

/**
 * v44: a wire row that prints two prices for two named wires ("Wire International In/Out |
 * $10/$35", "Outgoing Domestic/Foreign | $25.00/$45.00") takes the price in its own slot.
 * Darwin's eval found the first price filed under the second wire's name; 11 of 15 live paired
 * wire rows had it. The words either side of a slash in the excerpt name the slots; a side that
 * names nothing on that dimension is the other value ("Bank Wire Transfers/International").
 */
function pairedPriceSlot(canonicalFeeKey: string, context: CategoryGuardContext | undefined): string | null {
  if (!canonicalFeeKey.startsWith("wire_") || context?.amount == null || context.amount === "") return null;
  const excerpt = context.conditions?.match(/\bexcerpt=([\s\S]*)$/)?.[1];
  const prices = excerpt?.match(PAIRED_PRICES);
  if (!excerpt || !prices) return null;
  const first = Number(prices[1].replace(/,/g, ""));
  const second = Number(prices[2].replace(/,/g, ""));
  const amount = Number(context.amount);
  if (first === second || Math.abs(amount - first) >= 0.005) return null;
  const words = excerpt.replace(prices[0], " ");
  const keyValues = [canonicalFeeKey.includes("_intl_") ? "intl" : "domestic", canonicalFeeKey.endsWith("_outgoing") ? "out" : "in"];
  // v46: a spaced slash between two named wires ("Wire Out / Wire Out Foreign | $25.00 /
  // $45.00") names each slot by its whole phrase; the word next to the slash ("Out") is shared.
  const phrasePairs = words
    .split(/[|:–—]/)
    .map((cell) => cell.split(/\s\/\s/))
    .filter((sides) => sides.length === 2 && sides.every((side) => /[A-Za-z]/.test(side)))
    .map((sides) => ({ text: sides.join(" / ").trim(), sides: sides.map((side) => side.match(/[A-Za-z'’]+/g) ?? []) }));
  const pairs = phrasePairs.length > 0
    ? phrasePairs
    : [...words.matchAll(SLASH_PAIR)].map((pair) => ({ text: pair[0], sides: [[pair[1]], [pair[2]]] }));
  for (const pair of pairs) {
    const named = pair.sides.map((side) => side.map((word) => WIRE_SIDES.find((wire) => wire.pattern.test(word))?.value).filter(Boolean) as string[]);
    const dimensions = Object.values(WIRE_DIMENSIONS)
      .map((values) => named.map((found) => {
        const hits = [...new Set(found.filter((value) => values.includes(value)))];
        return hits.length === 1 ? hits[0] : null;
      }))
      .map(([l, r], index) => ({ l, r, values: Object.values(WIRE_DIMENSIONS)[index] }))
      .filter(({ l, r }) => l !== r)
      // A dimension both sides name decides before one only a side names.
      .sort((a, b) => Number(b.l != null && b.r != null) - Number(a.l != null && a.r != null));
    const decider = dimensions[0];
    if (!decider) continue;
    const own = keyValues.find((value) => decider.values.includes(value))!;
    const slot = decider.l === own || (decider.l == null && decider.r !== own) ? 1 : 2;
    return slot === 2 ? `"${pair.text}" prices this wire second ($${prices[2]}), not $${prices[1]}` : null;
  }
  return null;
}

/**
 * v62 (#1100): the row's own price on its source line, followed by the unit it is charged per.
 * "Service charge of $2 per debit in excess of 6 withdrawals per quarter", "A service charge of
 * $3.00 will be charged for each withdrawal in excess of six", "$25.00/Item" and "a $10.00 service
 * charge each time you withdraw money" price an activity, not the account's monthly fee. The first
 * time the price appears on the line decides: a later copy of it in another cell prices another fee
 * ("Monthly Maintenance Fee: $1.00 | ... | Check Image Fee : $1 per item"). Whichever comes first
 * after the price wins: a month, statement cycle, quarter or fee period makes it the periodic fee
 * ("$9 per item charge after 3 withdrawals per month" is the item charge). A per-check charge the
 * fee carries on top ("$10.00 per month and $.35 per debit", "$8.00 plus .50¢ per check") belongs to
 * the other figure, so the text after the price stops at the next price, cell, "plus", "and" or
 * "&". Read from Knox's excerpt of the line; with no excerpt or no amount the check does not apply.
 */
const ACTIVITY_UNIT = String.raw`(?:share\s+|debit\s+|posted\s+)?(?:debit|withdrawal|transaction|transfer|check|draft|item)s?\b(?!\s*:)`;
/** Up to six words after the price; a word may sit in parentheses ("Service Charge (Per Check Charge)"). */
const WORDS_AFTER_PRICE = String.raw`^\s*(?:[\w'’()-]+\s+){0,6}?\(?`;
const ACTIVITY_AFTER_PRICE = new RegExp(
  String.raw`${WORDS_AFTER_PRICE}(?:(?:for\s+)?(?:each|every|per)\s+${ACTIVITY_UNIT}|\/\s*${ACTIVITY_UNIT}|(?:each|every)\s+time\s+(?:you|a member)\s+(?:withdraw|make|transfer))`,
  "i",
);
const PERIOD_AFTER_PRICE = new RegExp(
  String.raw`${WORDS_AFTER_PRICE}(?:(?:per|a|each|every|for each)\s+(?:calendar\s+|monthly\s+)?(?:month|statement|cycle|quarter|fee period|year)|monthly|quarterly|\/\s*(?:mo|month)\b)`,
  "i",
);
/** Words that put a count limit on the activity: the excess withdrawal fee (its own type since Oct 15, #1398). */
const OVER_LIMIT = /\b(in excess of|over\s+(?:\d+|one|two|three|four|five|six|seven|eight|nine|ten|twelve|fifteen|twenty)\b|after\s+(?:\d+|one|two|three|four|five|six|ten)\b|more than|exceed(?:s|ed|ing)?\b|limit(?:ation)?s?\b)/i;
/** A bare service charge or fee, maybe naming a savings, money market or share account. */
const GENERIC_SERVICE_CHARGE = /^\W*(?:(?:savings|money market|mmdas?|share)\s+(?:accounts?\s+)?)?service\s+(?:charges?|fees?)\W*$/i;

/** The fee's own source line charges it per savings, money market or share withdrawal, transfer or debit over a limit. */
function savingsOverLimitLine(name: string, context: CategoryGuardContext | undefined): boolean {
  const reading = activityChargeOnLine("monthly_maintenance", context);
  return Boolean(reading?.overLimit) && SAVINGS_WITHDRAWAL_LINE.test(`${name} | ${reading?.line ?? ""}`);
}

/**
 * Withdrawals, transfers or debits from a savings, money market or share account: the excess
 * withdrawal fee. A line about checks, items, drafts or debit card purchases is another activity.
 */
const SAVINGS_WITHDRAWAL_LINE =
  /^(?![\s\S]*\b(?:checks?|items?|drafts?|debit cards?|pos|point of sale|purchases?)\b)(?=[\s\S]*\b(?:savings|money market|mmdas?|shares?)\b)[\s\S]*\b(?:withdrawals?|transfers?|debits?)\b/i;

function priceOnLine(amount: number): RegExp {
  const whole = Math.trunc(amount);
  const cents = Math.round((amount - whole) * 100);
  const centsPart = cents === 0 ? String.raw`(?:\.00)?` : String.raw`\.${String(cents).padStart(2, "0")}`;
  return new RegExp(String.raw`\$\s?${whole === 0 ? "0?" : whole}${centsPart}(?![\d,]|\.\d)`, "g");
}

interface ActivityReading {
  reason: string;
  /** The line limits the activity ("in excess of six"), so it is an excess activity fee. */
  overLimit: boolean;
  /** The source line, quotes made plain. */
  line: string;
}

function activityChargeOnLine(canonicalFeeKey: string, context: CategoryGuardContext | undefined): ActivityReading | null {
  if (canonicalFeeKey !== "monthly_maintenance" || context?.amount == null || context.amount === "") return null;
  const amount = Number(context.amount);
  const excerpt = context.conditions?.match(/\bexcerpt=([\s\S]*)$/)?.[1];
  if (!excerpt || !Number.isFinite(amount) || amount <= 0) return null;
  const line = plainQuotes(excerpt).replace(/^["\s]+|["\s]+$/g, "");
  const match = priceOnLine(amount).exec(line);
  if (!match) return null;
  const start = match.index + match[0].length;
  const tail = line.slice(start, start + 160).split(/\$|\||&|\+|\bplus\b|\band\b/i)[0];
  const activity = ACTIVITY_AFTER_PRICE.exec(tail);
  const period = PERIOD_AFTER_PRICE.exec(tail);
  if (!activity || (period && period[0].length <= activity[0].length)) return null;
  const before = line.slice(line.lastIndexOf("|", match.index) + 1, match.index);
  const unit = tail.trim().split(/\s+/).slice(0, 8).join(" ");
  return {
    reason: `the source line charges $${amount.toFixed(2)} ${unit}, an activity charge, not the account's monthly maintenance fee`,
    overLimit: OVER_LIMIT.test(tail) || OVER_LIMIT.test(before),
    line,
  };
}

/**
 * The category a fee's own source line places it in, when that differs from the one it was filed
 * under; null otherwise. v62: a monthly maintenance row the line charges per withdrawal, debit or
 * transaction over a limit is the excess activity fee, filed under account research by the top-50
 * fold (James, Oct 8: "fold into existing"). Guard v65 (James, Oct 15, #1398): once
 * `RESEARCH_SPLIT_LIVE` is on, one whose line or name names savings, money market or share
 * withdrawals, transfers or debits (`SAVINGS_WITHDRAWAL_LINE`) goes to excess withdrawals instead.
 * Other activity charges are not re-filed: a transfer or an item charge has no one home. Pure;
 * Darwin and Hamilton's live guard both use it.
 */
export function refileFromLine(
  canonicalFeeKey: string | null | undefined,
  feeName: string | null | undefined,
  context: CategoryGuardContext | undefined,
  live: boolean = RESEARCH_SPLIT_LIVE,
): string | null {
  if (!canonicalFeeKey) return null;
  // v87 (#1916): a late charge its stored text prints in a safe deposit box section is the box's.
  if (canonicalFeeKey === "late_payment" && context?.box_section === true) {
    return checkFeeCategory(BOX_LATE_TARGET, feeName, context).ok ? BOX_LATE_TARGET : null;
  }
  // v90 (#1912): a return charge its stored text prints in a collection section is a returned deposited item.
  if (collectionReturn(canonicalFeeKey, feeName ?? "", context)) return COLLECTION_RETURN_TARGET;
  // v72 (#1788): an overdraft row whose own line charges it for staying overdrawn is the continuous
  // overdraft fee.
  if (sustainedOverdraftOnLine(canonicalFeeKey, context)) {
    return checkFeeCategory("continuous_od", feeName, context).ok ? "continuous_od" : null;
  }
  const reading = activityChargeOnLine(canonicalFeeKey, context);
  if (!reading?.overLimit) return null;
  const targets = live && SAVINGS_WITHDRAWAL_LINE.test(`${feeName ?? ""} | ${reading.line}`) ? ["excess_withdrawal", "account_research"] : ["account_research"];
  return targets.find((target) => checkFeeCategory(target, feeName, context).ok) ?? null;
}

/**
 * v72 (#1788): the fee's own source line sells an optional add-on to an account, not the account
 * itself: "First Commerce offers the ATM Freedom add-on for the Power Checking account. For a monthly
 * fee of $2.99" (114333), "Add ID Protect® to your account for a $5.00 monthly service charge"
 * (85794), "For a low, $5 monthly fee you can add Lifestyle Benefits to any checking account"
 * (65349). An ATM surcharge refund, identity theft protection or a benefits package bought on top of
 * an account has no home among the 50 types, so the fee fails. Read from Knox's excerpt of the line;
 * with no excerpt the check does not apply. On Oct 17 it matched these 3 of 4,201 live monthly
 * maintenance fees and nothing else.
 */
const ADD_ON_LINE = /\badd[- ]?ons?\b|\badd\s+(?:[\w®™'".&-]+\s+){1,4}to\s+(?:your|any)\b[^|.]{0,30}\baccounts?\b/i;

function addOnOnLine(canonicalFeeKey: string, context: CategoryGuardContext | undefined): string | null {
  if (canonicalFeeKey !== "monthly_maintenance") return null;
  const excerpt = context?.conditions?.match(/\bexcerpt=([\s\S]*)$/)?.[1];
  const named = excerpt ? plainQuotes(excerpt).match(ADD_ON_LINE) : null;
  return named ? `the source line sells an optional add-on ("${named[0]}"), not the account's monthly maintenance fee` : null;
}

/**
 * v84 (#1788): a monthly charge whose name says only that it is a monthly fee or service charge
 * ("Monthly fee", "Service charge for six or more accounts") is named by what its schedule prints
 * around it, and Knox kept only the generic words. TD's "Paper statements | $3 monthly fee" (152525)
 * went live as "Monthly fee", and Florida Capital's Positive Pay rows ("POSITIVE PAY for ACH and
 * Checks" over "Service charge for one up to five accounts | $25 per month" and "Service charge for
 * six or more accounts | $5 per month per account", 56683 and 56684) went live as monthly maintenance.
 * Two readings place such a fee under another service:
 * - the cell right before its name on its own line (`excerpt=`) names the service ("Paper
 *   statements", "Lifestyle Benefits");
 * - the heading printed on the line right above it in the stored text (`heading_above`, read by
 *   `headingAboveExcerpt`) names the service ("Positive Pay", "ACH Origination", "BILL PAY",
 *   "ATM / Debit Card Fees", "Visa® Gift Card").
 * A name that says anything more ("Perks Checking Monthly service charge", "Bill Payer (monthly fee)")
 * is read by its own words, as before. A service line must open with the service, so a feature list
 * ("Debit card available", "Free Online Banking", "Card Management in our mobile banking app") never
 * names one. None of the 50 types holds a Positive Pay, ACH, scanner, bill pay, card, paper statement
 * or benefits package charge, so the fee fails rather than moving.
 */
const GENERIC_MONTHLY_CHARGE =
  /^[\W_]*(?:(?:monthly|quarterly|account|maintenance|service)\s+){0,3}(?:fees?|charges?|maintenance|service)(?:\s*\(?\s*(?:per|a|each)\s+(?:month|statement(?:\s+cycle)?|cycle|account(?:\s+number)?)\s*\)?)?(?:\s+for\s+(?:[\w-]+\s+){0,4}accounts?)?[\W_]*$/i;
const GENERIC_MONTHLY_WORD = /\b(?:monthly|quarterly|maintenance|service)\b/i;
/** A name that says which account, card, plan or service it is for names more than a monthly charge. */
const NAMES_ITS_OWNER = /\b(?:checking|savings|share|draft|money\s+market|club|now|dda|business|personal|consumer|student|senior|card|bill|plan|program)\b/i;
/** A service with its own monthly charge, named at the start of a heading or cell. */
const OTHER_SERVICE_START = new RegExp(
  String.raw`^(?:(?:business|personal|consumer|commercial|retail|fee\s+schedule\s+for|the)\s+){0,2}(?:` +
    [
      String.raw`positive\s*pay\b`,
      String.raw`ach\b`,
      String.raw`remote\s+deposit`,
      String.raw`merchant\b`,
      String.raw`(?:(?:internet|online)\s+)?bill\s*pay(?:er|ments?)?\b`,
      String.raw`(?:internet|online|mobile)\s+banking\b`,
      String.raw`(?:(?:atm|debit|check|gift|prepaid|credit|visa|master\s*card)[®™]?\s*(?:or|and|&|\/)?\s*){1,3}cards?\b(?!\s+(?:purchases?|transactions?|usage|activity))`,
      String.raw`paper\s+(?:statements?|stmts?)\b`,
      String.raw`returned?\s+mail\b`,
      String.raw`lockbox\b`,
      String.raw`sweeps?\b`,
      String.raw`zero\s+balance\b`,
      String.raw`treasury\b`,
      String.raw`cash\s+management\b`,
      String.raw`safe\s+deposit\b`,
      String.raw`night\s+deposit\b`,
      String.raw`lifestyle\s+benefits\b`,
      String.raw`identity\s+(?:theft|protection)\b`,
    ].join("|") +
    ")",
  "i",
);
/** Words that make a short line a feature or a condition, not a heading. */
const FEATURE_LINE = /\b(?:free|no\s+(?:charge|fee|cost|monthly)|included|includes?|available|unlimited|rewards?|privileges?|with|waive[ds]?|requires?|required|enroll(?:ed)?|must|opt|avoid|discount(?:ed)?|reinstated|eligible)\b|[?.!]\s*$/i;
const MAX_SERVICE_HEADING_WORDS = 8;

/** A short line or cell that opens by naming another service, or null. */
function serviceHeading(line: string | null | undefined): string | null {
  const plain = plainQuotes(line ?? "").replace(/^[\s\-–—•·*#>›]+|[\s*|:]+$/g, "").trim();
  if (!plain || /[$|]|\d/.test(plain) || plain.length > 80) return null;
  if (plain.split(/\s+/).length > MAX_SERVICE_HEADING_WORDS || FEATURE_LINE.test(plain)) return null;
  return OTHER_SERVICE_START.test(plain) ? plain : null;
}

/** Pure: the fee is a monthly maintenance fee named only as a monthly fee or service charge. */
export function genericMonthlyCharge(canonicalFeeKey: string | null | undefined, feeName: string | null | undefined): boolean {
  const name = plainQuotes(feeName ?? "").trim();
  return canonicalFeeKey === "monthly_maintenance" && GENERIC_MONTHLY_WORD.test(name) && !NAMES_ITS_OWNER.test(name) && GENERIC_MONTHLY_CHARGE.test(name);
}

/** A priced row whose label is itself a generic monthly charge: a sibling row under the same heading. */
function genericSiblingRow(line: string): boolean {
  if (!/\$|\bfree\b|\bno charge\b/i.test(line)) return false;
  const label = line.split(/\||\$/)[0].replace(/[.…_\s:]+$/, "");
  return GENERIC_MONTHLY_WORD.test(label) && GENERIC_MONTHLY_CHARGE.test(label);
}

/** A short unpriced line that is itself a service or a feature: part of a list, not over one. */
function listLine(line: string | undefined): boolean {
  const plain = plainQuotes(line ?? "").replace(/^[\s\-–—•·*#>›]+|[\s*|:]+$/g, "").trim();
  if (!plain || /[$|]/.test(plain) || plain.split(/\s+/).length > MAX_SERVICE_HEADING_WORDS) return false;
  return OTHER_SERVICE_START.test(plain) || FEATURE_LINE.test(plain);
}

/**
 * Pure: the heading over a fee's own line, from the lines printed above it (nearest last). Up to three
 * sibling rows priced as generic monthly charges are passed over ("Service charge for one up to five
 * accounts | $25 per month" between Florida Capital's "POSITIVE PAY for ACH and Checks" and 56684).
 * A line that sits under another short service or feature line is part of a list ("ATM debit card /
 * Online banking / Online bill pay / $5.00 Service Charge per statement cycle", a product page's
 * features over the account's own charge), so no heading is read. Null when no line is in reach.
 */
export function headingFromLinesAbove(linesAbove: readonly string[]): string | null {
  const lines = linesAbove.map((line) => line.trim()).filter(Boolean);
  let index = lines.length - 1;
  for (let skipped = 0; index >= 0 && skipped < 3 && genericSiblingRow(lines[index]); skipped += 1) index -= 1;
  const heading = lines[index];
  if (!heading || heading.length > 80 || listLine(lines[index - 1])) return null;
  return heading;
}

/**
 * Pure: the heading printed above the fee's own line (`excerpt=` in its conditions) in its stored
 * text (`headingFromLinesAbove`); null when the excerpt is not found on the text, or is printed more
 * than once and not every place's heading names another service. The guard reads it
 * only for a generic monthly charge (`genericMonthlyCharge`).
 */
export function headingAboveExcerpt(text: string | null | undefined, conditions: string | null | undefined): string | null {
  const excerpt = conditions?.match(/\bexcerpt=([\s\S]*)$/)?.[1];
  if (!text || !excerpt) return null;
  const probe = excerpt.replace(/^["\s]+|["\s]+$/g, "").slice(0, 60).trim();
  if (probe.length < 8) return null;
  const places: number[] = [];
  for (let at = text.indexOf(probe); at !== -1; at = text.indexOf(probe, at + 1)) places.push(at);
  if (places.length === 0 || places[0] <= 0) return null;
  if (places.length === 1) return headingAtPlace(text, places[0]);
  // The same line printed more than once (under a checking section and a Positive Pay section) has
  // no one heading: a heading is read only when every place's heading names another service (123617,
  // "Monthly Fee | None" under two card headings), so a real maintenance fee never comes down for it.
  const headings = places.map((at) => headingAtPlace(text, at));
  return headings.every((heading) => serviceHeading(heading)) ? headings[0] : null;
}

function headingAtPlace(text: string, at: number): string | null {
  const lines = text.slice(Math.max(0, at - 600), at).split(/\n+/);
  // The excerpt may start mid-line: the text before it on its own line is not a line above.
  return lines.length < 2 ? null : headingFromLinesAbove(lines.slice(0, -1));
}

/**
 * Pure: the guard context with `heading_above` read from the fee's stored text, for a generic monthly
 * charge only (every other fee is returned as it is, so no text is needed for it). Darwin's verify
 * and Hamilton's live guard both call it with the document text they hold.
 */
export function withHeadingAbove<T extends CategoryGuardContext>(
  canonicalFeeKey: string | null | undefined,
  feeName: string | null | undefined,
  context: T,
  text: string | null | undefined,
): T {
  if (!genericMonthlyCharge(canonicalFeeKey, feeName) || !text) return context;
  return { ...context, heading_above: headingAboveExcerpt(text, context.conditions) };
}

/**
 * The fee's own line says how to avoid it (a balance, "In order to avoid the $5 monthly maintenance
 * fee, your 10 debit card purchases must settle", 104536 under "Debit Card Purchases"): the account's
 * own monthly fee, whatever is printed above it.
 */
const ACCOUNT_WAIVER_ON_LINE = /\b(?:balances?|minimum|min\.|avoid(?:ed)?|waive[ds]?|waiver)\b/i;

function otherServiceMonthlyCharge(canonicalFeeKey: string, name: string, context: CategoryGuardContext | undefined): string | null {
  if (!genericMonthlyCharge(canonicalFeeKey, name)) return null;
  const excerpt = context?.conditions?.match(/\bexcerpt=([\s\S]*)$/)?.[1];
  if (excerpt && ACCOUNT_WAIVER_ON_LINE.test(excerpt)) return null;
  if (excerpt && name.length >= 3) {
    const cells = plainQuotes(excerpt).replace(/^["\s]+|["\s]+$/g, "").split("|");
    const at = cells.findIndex((cell) => cell.toLowerCase().includes(name.toLowerCase().replace(/^[\W_]+|[\W_]+$/g, "")));
    const cell = at > 0 ? serviceHeading(cells[at - 1]) : null;
    if (cell) return `the source line prices "${name}" in the row of "${cell}", that service's charge, not the account's monthly maintenance fee`;
  }
  const heading = serviceHeading(context?.heading_above);
  return heading ? `the source prints "${name}" under "${heading}", that service's charge, not the account's monthly maintenance fee` : null;
}

/**
 * v72 (#1788): an overdraft row whose own source line, right after its price, charges it for staying
 * overdrawn: "Courtesy Pay Negative Balance Fee . . . $30 (if negative balance is not paid within 20
 * days, fee may be assessed ...)" (141704), "7 Day Overdraft Processing Fee ... $25.00 (assessed after
 * 7 consecutive calendar days)" (16869). That is the continuous overdraft fee, not the per-item one.
 * Text after the next price or cell belongs to another fee ("$30 per item, additional $30 per item
 * after 10 days unpaid" stays). Read from Knox's excerpt; with no excerpt it does not apply.
 */
const SUSTAINED_AFTER_PRICE =
  /^[^|]{0,40}?\(?\s*(?:if\b[^|]{0,40}?\b(?:not (?:re)?paid|remains? (?:overdrawn|negative))\b[^|]{0,20}?\b(?:within|after|for)\s+\d+\s+(?:consecutive\s+)?(?:business\s+|calendar\s+|banking\s+)?days\b|assessed\s+after\s+\d+\s+(?:consecutive\s+)?(?:business\s+|calendar\s+|banking\s+)?days\b)/i;

function sustainedOverdraftOnLine(canonicalFeeKey: string, context: CategoryGuardContext | undefined): string | null {
  if (canonicalFeeKey !== "overdraft" || context?.amount == null || context.amount === "") return null;
  const amount = Number(context.amount);
  const excerpt = context.conditions?.match(/\bexcerpt=([\s\S]*)$/)?.[1];
  if (!excerpt || !Number.isFinite(amount) || amount <= 0) return null;
  const line = plainQuotes(excerpt);
  const match = priceOnLine(amount).exec(line);
  if (!match) return null;
  const start = match.index + match[0].length;
  const tail = line.slice(start, start + 160).split("$")[0];
  const sustained = SUSTAINED_AFTER_PRICE.exec(tail);
  return sustained
    ? `the source line charges $${amount.toFixed(2)} for staying overdrawn ("${sustained[0].trim()}"), the continuous overdraft fee, not the per-item overdraft fee`
    : null;
}

/**
 * v80 (#1905): a cash advance read from a row of an ATM network table, whose cells price each
 * network and add the ATM owner's surcharge: "Credit card cash advance§ | None | $0.50 | $1.00 plus
 * ATM owner fees | Not applicable" (Navy Federal 28173 took the CO-OP column's $0.50; its own column
 * says "None"). The figure is one network's ATM price, not the institution's cash advance fee. Read
 * from Knox's excerpt; with no excerpt it does not apply.
 */
const ATM_NETWORK_ROW = /\bplus\s+(?:the\s+)?atm\s+(?:owner|operator)(?:'?s)?\s+(?:fees?|surcharges?)\b|\|\s*(?:none|free|no\s+charge)\s*\|[^|]*\$[^|]*\|[^|]*\batm\s+(?:owner|operator)/i;

function cashAdvanceFromAtmTable(canonicalFeeKey: string, context: CategoryGuardContext | undefined): string | null {
  if (canonicalFeeKey !== "cash_advance") return null;
  const excerpt = context?.conditions?.match(/\bexcerpt=([\s\S]*)$/)?.[1];
  const named = excerpt ? plainQuotes(excerpt).match(ATM_NETWORK_ROW) : null;
  return named ? `the source line is an ATM network table row ("${named[0].trim()}"), so the price is one network's ATM fee, not the cash advance fee` : null;
}

/**
 * v88 (#1912): a cash advance whose own price is stated for another bank's ATMs ("Cash Advance or |
 * $3.00 for Non M&T Bank ATMs located in the United States.", M&T 68601) was cut from a wrapped cell
 * ("ATM Cash Withdrawal, / Cash Advance or / Account ..."): the price is the non-network ATM
 * withdrawal fee, not a cash advance fee. Only a price followed at once by "for" or "at" another
 * institution's or network's ATMs counts, read from Knox's excerpt; "$1.00 cash advance fee on credit
 * cards at foreign ATMs" and "$15.00 at counter; $0 at ATM" do not match.
 */
const PRICE_FOR_OTHER_ATM =
  /\$\s?\d[\d,]*(?:\.\d{2})?\s+(?:each\s+)?(?:for|at)\s+(?:any\s+|all\s+)?(?:non(?![- ]?(?:teller|branch))[- ]?[\w&.'’ -]{0,30}?|foreign|other\s+(?:banks?|institutions?|financial\s+institutions?)'?s?|out[- ]of[- ]network|third[- ]party)\s*atms?\b/i;

function cashAdvanceAtOtherAtm(canonicalFeeKey: string, context: CategoryGuardContext | undefined): string | null {
  if (canonicalFeeKey !== "cash_advance") return null;
  const excerpt = context?.conditions?.match(/\bexcerpt=([\s\S]*)$/)?.[1];
  if (!excerpt || context?.amount == null || context.amount === "") return null;
  // Only the fee's own price counts: another price on the line may be the non-network ATM fee.
  const named = [...plainQuotes(excerpt).matchAll(new RegExp(PRICE_FOR_OTHER_ATM.source, "gi"))]
    .find((match) => Number(match[0].match(/\d[\d,]*(?:\.\d{2})?/)?.[0].replace(/,/g, "")) === Number(context.amount));
  return named ? `the source line prices it at another bank's ATMs ("${named[0].trim()}"), so the price is the non-network ATM fee, not the cash advance fee` : null;
}

/**
 * v80 (#1912): a $0 joined onto a lead-in that trails off ("Non-customer check cashing - for
 * checks... / $0.00", Bank Plus 91880) is the first figure of the band list that follows ("$0.00 to
 * $99.99 | $3.00 ... $1,000.00 & over | $20.00"), not the fee. A band that only says which balances
 * or checks the fee covers ("Check Cashing ($0.00 – $300.00) | N/C", "$0 - $1,500.00 | Monthly
 * Maintenance Fee ... No Charge") does not count: those fees are free. Read from Knox's excerpt; on
 * Oct 20 only 91880 among live $0 fees matched.
 */
const BAND_FLOOR = /(?:\.\.\.|…)\s*\/\s*\$\s?0(?:\.00)?"?\s*$/;

function bandFloorAsPrice(context: CategoryGuardContext | undefined): string | null {
  if (context?.amount == null || context.amount === "" || Number(context.amount) !== 0) return null;
  const excerpt = context.conditions?.match(/\bexcerpt=([\s\S]*)$/)?.[1];
  const band = excerpt ? plainQuotes(excerpt).match(BAND_FLOOR) : null;
  return band ? `the $0.00 follows a lead-in cut short on the source line ("${band[0]}"), the first figure of a band list, not the fee` : null;
}

const NOTE_HEAD_FEES: ReadonlyArray<readonly [RegExp, string]> = [
  [/\bstop pay/i, "stop_payment"],
  [/(?:\bin|\bnon[-\s]?)sufficient|\bnsf\b/i, "nsf"],
  [/\boverdraft (?:protection )?transfers?\b/i, "od_protection_transfer"],
];

/**
 * v43: a name cut from the end of another fee's note ("Bill Pay)" from "Stop Payment
 * (includes ACH, Bill Pay) | $10.00"; "ACH or ATM)" from "Overdraft protection transfers (to
 * cover check, ACH or ATM) | $5.00") was filed by the note's last word. The row's excerpt
 * shows the fee the note belongs to.
 */
function noteTailOfAnotherFee(canonicalFeeKey: string, name: string, context: CategoryGuardContext | undefined): string | null {
  if (!/^[^(]*\)\s*$/.test(name)) return null;
  const excerpt = context?.conditions?.match(/\bexcerpt=([\s\S]*)$/)?.[1];
  const tail = name.replace(/\)\s*$/, "").trim();
  if (!excerpt || tail.length < 3) return null;
  const at = excerpt.toLowerCase().indexOf(tail.toLowerCase());
  const open = at < 0 ? -1 : excerpt.lastIndexOf("(", at);
  if (open < 0) return null;
  const head = excerpt.slice(excerpt.lastIndexOf("|", open) + 1, open).trim();
  const owner = NOTE_HEAD_FEES.find(([pattern, key]) => key !== canonicalFeeKey && pattern.test(head));
  return owner ? `"${name}" ends a note on "${head}", a ${owner[1]} fee, not ${canonicalFeeKey}` : null;
}

/** Words that make a charge the overdraft (courtesy pay) or NSF fee. */
const OVERDRAFT_OR_NSF = /courtesy\s*pay|\bpaid\s+nsf\b|\bnsf\b|\boverdraft|\b(?:in|non[-\s]?)sufficient\b|\bbounce/i;
/** Payment channels a courtesy pay or NSF row lists in its cell ("Check/ACH/Bill Pay Payment"). */
const PAYMENT_CHANNEL = /\b(?:checks?|ach|bill\s*pay(?:ments?)?|share\s+drafts?|drafts?|debit(?:\s+cards?)?|atm|electronic|recurring|pre-?authori[sz]ed|pos)\b/gi;

/**
 * v68 (#1304): a bill payment priced as the overdraft (courtesy pay) or NSF fee is that fee, not
 * the bill pay service. Knox names a row by the cell after its heading, so "Courtesy Pay (Paid NSF)
 * Check/ACH/Bill Pay Payment | $32.00/item" was filed as bill pay under the name "Check/ACH/Bill Pay
 * Payment" (live 88513, since re-filed by hand). Bill pay refuses a name that itself names courtesy
 * pay, an overdraft, NSF or insufficient funds, and a row whose own source line puts such a heading
 * just before the name: in the same cell ("Nonsufficient funds (NSF) Bill Pay | $35.00"), or, for a
 * name that lists two or more payment channels, in the cell before it ("Non-Sufficient Funds |
 * Check, ACH, Bill Pay, recurring debit card transaction, / $30.00"). Text before the last price
 * belongs to another fee, and a heading two cells back over a single service ("Non-Sufficient Funds
 * (NSF) | Same Day Bill Payment | $ 9.95") does not count. Pure.
 */
function overdraftOrNsfBillPay(
  canonicalFeeKey: string,
  name: string,
  context: CategoryGuardContext | undefined,
): { code: CategoryGuardCode; reason: string } | null {
  if (canonicalFeeKey !== "bill_pay") return null;
  const named = name.match(OVERDRAFT_OR_NSF);
  if (named) return { code: "name_contradicts", reason: `"${name}" names "${named[0]}", the overdraft or NSF fee, not bill pay` };
  const excerpt = context?.conditions?.match(/\bexcerpt=([\s\S]*)$/)?.[1];
  if (!excerpt || name.length < 3) return null;
  const line = plainQuotes(excerpt);
  const at = line.toLowerCase().indexOf(name.toLowerCase());
  if (at <= 0) return null;
  const sincePrice = line.slice(0, at).split(/\$\s?\d[\d,]*(?:\.\d+)?|\$\s?\.\d+/).at(-1) ?? "";
  const cells = sincePrice.split("|");
  const channels = new Set((name.match(PAYMENT_CHANNEL) ?? []).map((word) => word.toLowerCase().replace(/\s+/g, " ")));
  const heading = (channels.size >= 2 ? cells.slice(-2) : cells.slice(-1)).join("|");
  const words = heading.match(OVERDRAFT_OR_NSF);
  if (words) {
    return {
      code: "schedule_contradicts",
      reason: `the source line prices "${name}" under "${heading.replace(/^["\s|]+|[\s|]+$/g, "")}", the overdraft or NSF fee, not bill pay`,
    };
  }
  // v79 (#1830): a stop payment that lists what it stops ("Stop payment order (one free per calendar
  // year) Bill Payment, ACH, or Check | $35.00", "Stop Payment (includes ACH, Bill Pay) | $10.00") is
  // the stop payment fee, however Knox cut the name. Read within the name's cell or the one before it.
  const stopped = cells.slice(-2).join("|").match(STOP_PAYMENT_HEAD);
  return stopped
    ? {
        code: "schedule_contradicts",
        reason: `the source line prices "${name}" under "${stopped[0].trim()}", the stop payment fee, not bill pay`,
      }
    : null;
}

/** v79 (#1830): a stop payment heading before a bill pay name on its own line. */
const STOP_PAYMENT_HEAD = /\bstop[\s-]*pay(?:ments?)?\b(?:\s+(?:orders?|fees?))?/i;
