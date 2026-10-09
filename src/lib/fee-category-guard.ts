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

import { COLLECTION_ITEM, foldRetiredCategory, ITEM_COPY, SUBORDINATION } from "@/lib/fee-fold";

export type CategoryGuardCode = "name_contradicts" | "name_unsupported" | "rate_as_amount" | "schedule_contradicts" | "amount_implausible";

/** What a caller knows about the fee besides its name; enables the rate check. */
export interface CategoryGuardContext {
  amount?: number | string | null;
  conditions?: string | null;
  /** The highest NSF or insufficient-funds price elsewhere on the same schedule, when known. */
  document_nsf_amount?: number | string | null;
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

export const CATEGORY_GUARD_RULES: Readonly<Record<string, CategoryRule>> = {
  monthly_maintenance: {
    // v10: "Minimum daily balance of $500 required to avoid a $5.00 service fee" names the
    // account's monthly fee by the balance that waives it.
    // v57: a cross-border banking bundle's annual fee is the account's fee, paid yearly (RBC's
    // U.S. Premium Checking "Cross-Border Banking Bundle annual fee", $99.50 a year or $9.95 a month).
    include: /(maintenance|monthly service|service charge|monthly fee|(minimum|balance)\b.{0,80}\bavoid\b.{0,30}\bservice fee|\bcross[- ]?border (?:banking )?(?:bundles?|packages?|accounts?|banking) annual fee)/i,
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
    exclude:
      /(\bmerchant (capture|services?|processing|accounts?)\b|terminat|\boverdraft (privilege|courtesy)|paper (stmt|states|mailed)|\bstmt fee|is waived under|\|\s*na\s*\||transfer service charge|\bwire (manager|module)\b|\bmodule\b|treasury|cash management|\bapi\b|\bach\b|positive pay|paper mailed|cashier|^monthly fee \(per account\)|\batm\/debit card monthly fee|location|scanner|remote deposit|\brdc\b|lockbox|intrafi|\bics\b|^waiving\b|savings|money market|club|night deposit|safe deposit|box|(?<!\bcross[- ]?border (?:banking )?(?:bundles?|packages?|accounts?|banking) )annual|dormant|inactive|statement(?! cycle)|\bira\b|certificate|\bcd\b|loan|escheat|clos|research|excess|activity|withdrawal|saver|business|commercial|analysis|\bhsa\b|health|escrow|trust|address|fax|cop(y|ies)|(pos|pin[- ]based) transaction|for transactions|transaction service charge|earnings credit (is applied|available to offset))/i,
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
    include: /(overdraft|overdrawn|\bod\b|o\/d|paid item|items? paid|paid nsf|paid (?:non[-\s]?|in)sufficient|paid (?:[\w&]+ ){1,3}nsf items?|courtesy pay|bounce protection|privilege|(?:in|non[-\s]?)sufficient funds?\b.{0,25}\(\s*paid\s*\)|\(\s*honou?red\s*\)|(?:nsf|(?:in|non[-\s]?)sufficient)\b[^|]{0,30}?(?:(?<!\bnon)[-–]\s*|\(\s*(?:check\s+)?)paid\b(?!\s+(?:or|from|by)\b))/i,
    exclude:
      /(transfer|xfe?r\b|sweep|from (your |eligible |a )?(savings|shares?|loan|loc)\b|to loan|share to share|daily|continu|consecutive|extended(?! coverage)|sustained|limit|line of credit|protection plan|\bcap\b|maximum|reduced to|not be (charged|assessed)|\bwill not (charge|assess)|non[- ]?paid|waive|night dep|notary|counter check|check images?|set ?up|dividend|(savings|share|loan|link(ed)?) overdraft protection|overdraft protection ?[-–(]+ ?(savings|loan)|loan overdraft|covered by|per advance|advances? from|annual|collection|accrual|account closed|closed in overdraft|late repayment|\blate (payment|charge|fee)\b|recurring overdraft|every \d+|beginning|threshold|cushion|overdrawn by|overdraws your account by|with approval|options|\b\d+ ?x ?\d+\b|\bbox\b|outgoing|international|\bwires?\b|check printing|statement cop(y|ies)|photo ?cop(y|ies)|\bcopy fee|\bcop(y|ies) of\b|annual fee|or less\b|\bat least\b|or equal to|is positive|would not apply|otherwise would\b|from (your |eligible |an? |linked )?(checking|money market|statement savings)|pre-?authori[sz]ed automatic tran|\bwill honor\b|\bvia\s*:?\s*$|^.{0,20}\bfee on$|because your (available |current |ledger )?balance|\b(mon|tues|wednes|thurs|fri|satur|sun)day['’]s\b|unless the total|contact us|online statements|\bno overdraft checking\b|\bas overdraft protection\b|\bcharge(d)?[- ]?off\b)/i,
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
      /(nsf|insufficient|non[- ]?sufficient|returned item|return(ed)? (check|item|ach|payment|draft)|returned unpaid|unpaid item)/i,
    // v47: a business-only ACH return and a payment the payee sent back ("Payee-returned Check
    // Payment Due to Member Error") are not the member's NSF fee (Darwin eval, Oct 8).
    exclude:
      /(deposit|\bcap\b|daily max|maximum|\bpaid\b|\(\s*honou?red\s*\)|de minimis|after \d+ consecutive|\bsustained\b|\bcontinuous\b|others|re-?present|credit card|loan|transfer|cover|3rd party|third[- ]party|foreign|drawn on (an ?)?other|other inst|self[- ]to[- ]self|returned payment|payment returned|nsf payment|visa payment|re-?activation|card capture|converted|cancell?ation|returned ach origination|return ach origination|ach origination nsf|nsf ach origination|debit origination|reg d limit|\(reg d\)|sent for collection|presented multiple times|in the amount of|\bbox\b|check printing|statement cop(y|ies)|photo ?cop(y|ies)|\bcopy fee|\bcop(y|ies) of\b|written to you|re-?route|business only|payee[- ]returned|\b\d+ ?x ?\d+\b|\bmerchants?\b)/i, // v33: "03 x 10" is a worked sum; v39: a merchant presenting a member's NSF check is not the member's NSF fee
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
    exclude:
      /(replace|statement|card fee|annual|\bpin\b|denied|declin|re-?order|initial order|instant issue|enrollment|reactivat|\badjustments?\b|rebates?|^(?!.*(withdraw|w\/d|transaction|surcharg|\bnon\b|non-|foreign|other|network|usage|\bused?\b|inquir|transfer|\bat\b|\bpos\b|purchase))\s*atm\s*cards?\b|between accounts|(savings|share) withdrawal|\breg[- ]?d\b|\blobby\b|^\s*(?:atm|visa|debit|check|mastercard)\s*(?:card)?\s*(?:or|\/|&|and)\s*(?:visa\s*|mastercard\s*)?(?:debit|check|atm)?\s*cards?\s*\*?\s*$|tele?phone|\bphone\b|representative|(?<!automated )\bteller\b|call center|non[- ]?members?|\bnon[- ]?(?!owned\b)[\w.]+ (debit |atm )?cards?|non[- ]proprietary card|foreign cards? used|(?<!free )\bat our atm|(?<!of )\bour network|\bin[- ]network|(?<!\bnon[- ]?)\b(?!(non|other|foreign)\b)\w+[- ]owned atm)/i,
  },
  wire_domestic_outgoing: {
    include: /wire/i,
    exclude: new RegExp(`(incoming|receiv|international|foreign|intl|${INTL_ABBREV}|${WIRE_CORRECTIONS}|${BUSINESS_ONLY})`, "i"),
  },
  wire_intl_outgoing: {
    include: /wire/i,
    exclude: new RegExp(`(incoming|receiv|${WIRE_CORRECTIONS}|check|deposit|collection|${BUSINESS_ONLY})`, "i"),
  },
  // v44: guarded so Hamilton reads it for a paired price ("$20 / $30") in the wrong slot.
  wire_intl_incoming: { include: /\S/, exclude: new RegExp(BUSINESS_ONLY, "i") },
  wire_domestic_incoming: {
    include: /wire/i,
    exclude: new RegExp(`(outgoing|send|sent|international|foreign|intl|${INTL_ABBREV}|${WIRE_CORRECTIONS}|${BUSINESS_ONLY})`, "i"),
  },
  stop_payment: {
    include: /stop/i,
    // "Cancel stop payment" and "Stop Payment Removal" remove a stop; "ACH Stop
    // Payment/Cancellation" and "Stop Payments (to put on or remove)" place one.
    exclude:
      /(release|(cancel\w*|remov(e|al|ing))\s+(of\s+)?(a\s+|the\s+)?stop|stop\s+payments?\s+(fee\s+)?\(?removal|revoc|line of credit|heloc|loan|cashier|official)/i,
  },
  // v43: guarded so Hamilton reads them for names cut from another fee's note (noteTailOfAnotherFee).
  // v47: a bill payment's stop or cancel is the stop payment fee, and a membership fee is not
  // bill pay ("Bill Pay Stop/Cancel Payment" $25, "Lifetime Membership Fee" $5; Darwin eval).
  bill_pay: { include: /\S/, exclude: /(\breload fee\b|\bstop\b|cancel(l?ed)? payment|membership closure|lifetime membership)/i },
  // v47: researching, copying, replacing, mailing or reporting lost a money order is not the price
  // of buying one ("Money Order Research Fee" $10; Darwin eval).
  money_order: {
    include: /\S/,
    exclude: /(research|\b(photo ?)?cop(y|ies)\b|declaration of loss|replacement|abandoned|returned|delivery|mailing)/i,
  },
  ach_origination: { include: /\S/, exclude: /(?!)/ },
  cashiers_check: {
    include: /(cashier|official check|bank check|bank draft|corporate check|treasurer|certified|teller'?s? check)/i,
    exclude: /(cop(y|ies)|stop|replace|lost|research)/i,
  },
  od_protection_transfer: {
    include: /(overdraft|\bod\b|\bodp\b|o\/d|sweep|protection)/i,
    // v39: "Returned or Paid Checks (OD Privilege Fee/Insufficient Funds/...includes Electronic Funds
    // Transfer Debits)" $30, "Check-Overdraft/NSF/Return Fees" $30 and "Overdraft Fee-Exceeded
    // Reg D Transfers" $20 are the overdraft, NSF and excess withdrawal fees, not a transfer's fee.
    exclude:
      /(balance transfer|wire|telephone|phone|online|internal|\bach\b|external|book|set-?up|excess|money market|returned or paid checks|check-overdraft\/nsf|overdraft fee-exceeded reg d)/i,
  },
  // v39: wire fees read under a "Subordination Request" heading ("SUBORDINATION REQUEST: Incoming"
  // $10, "...: Outgoing Domestic" $25) are not the lien subordination fee.
  // v47: a mortgage or lien subordination is another lending fee, not legal process.
  legal_process: {
    include: /./,
    exclude: new RegExp(String.raw`subordination request:\s*(incoming|outgoing)|${SUBORDINATION.source}`, "i"),
  },
  paper_statement: {
    include: /statement/i,
    // An e-statement fee is excluded, but "Paper Statement (waived with e-Statements)" is not.
    exclude: /(cop(y|ies)|address|research|re-?print|duplicate|interim|special|photo|image|^(?!.*paper).*e-?statement)/i,
  },
  card_replacement: {
    include: /(replace|reissue|lost|stolen|duplicate card|card \(duplicate\)|card reorder)/i,
    // A "check card" is a debit card; checks, checkbooks and checking accounts are not. A PIN
    // reissue alone is not a card replacement, but "Debit Card (replacement or PIN)" is.
    // v35: express, priority or two-day delivery of a replacement card is the rush card fee
    // ("Replacement Card - Express Mail" $40, "Debit Card Replacement Priority Delivery" $40).
    exclude: new RegExp(
      `(check(?!\\s?card)|statement|key|book|expedit|rush|overnight|gift|${EXPRESS_CARD}|^(?!.*\\bcards?\\b[^|]{0,20}replace)(?!.*replace[^|]{0,20}\\bcards?\\b).*\\bpins?\\b|liabilit|closed account)`,
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
    include: /(gift|pre-?\s?paid|re-?\s?load|travel ?(money )?card|travelmoney|cu ?money|everyday spend|access card)/i,
    exclude: /(inactiv|dormant|non-?use|replac|lost|stolen|maintenance)/i,
  },
  // A chargeback on a deposited item or a loan is not a card dispute.
  card_dispute: {
    include: /(dispute|charge-?back|charged back)/i,
    exclude: /(charge-?back (on )?(loan|deposit)|charge-?back (items?|message)\b|return\/charge-?back)/i,
  },
  deposited_item_return: {
    include: /(deposit(ed)? (item|check|draft)|return(ed)? deposit|deposit return|charge[- ]?backs?\b|return(ed)? (item|check)s?\b.{0,20}\bwritten to you|^\s*return(ed)?\s+(check|item)s?(\s+(fee|charge)s?)?\s*:?\s*$)/i,
    exclude: /(night|safe|box|mobile deposit fee|remote|collection|correction|loan (item|payment)s? charge[- ]?back|charge[- ]?backs? on (a )?loan|unable|(\bcards?\b|visa)[^|]{0,25}charge[- ]?back|charge[- ]?back[^|]{0,25}(\bcards?\b|dispute)|dispute|research)/i,
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
  // Since v45 it is International ATM & Card: an ATM used outside the U.S. ("Non–Wells Fargo
  // ATMs outside the U.S.") is this fee too.
  card_foreign_txn: {
    include: /(foreign|international|currency|exchange|cross[- ]border|\bisa\b|outside (the )?u\.?s|abroad|overseas)/i,
    exclude:
      /((?<!\/\s?)\batm'?s?\b[^|\/]{0,12}\bforeign transactions?|\bwires?\b|low balance|cash exchange|currency (cash|order|ordered|exchange|purchase)|foreign currency (cash|order|exchange|purchase|delivery)|currency or checks?|check collection|\bmany\b|domestic)/i,
  },
  // Knox v26 folded collection items and foreign checks into check cashing (James, Oct 7
  // 2026); on Oct 8 he gave collection items their own type ("Own type"), so a check sent
  // for collection or a foreign check handled for deposit is a collection item. A collection
  // fee on a charged-off or past-due account, or a collection phone call, is debt collection;
  // every other name passes. v41 also catches "Charge off deposit collection fee" without the d.
  check_cashing: {
    include: /\S/,
    exclude: new RegExp(String.raw`(charge(d)?[- ]?off|past[- ]due|delinquen|\bcalls?\b)|${COLLECTION_ITEM.source}`, "i"),
  },
  collection_item: {
    include: COLLECTION_ITEM,
    exclude: /(?!)/,
  },
  // A credit report pulled to open a deposit account or membership is not a loan fee.
  loan_origination: {
    include: /\S/,
    exclude: /\bopen(ing)? (an |a |new |your )?(account|membership)\b/i,
  },
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
    exclude: /(:\s*(domestic |international |foreign |incoming |outgoing )?wire\b|\brush request|express shipping|\breinstat|\bpenalty of [a-z0-9 ]{0,24}\bdays?'?\s+(of\s+)?(dividends|interest)\b|\b(dividends|interest) will be (imposed|forfeited)\b|\bforfeit(ure|ed)? of\b)/i,
  },
  night_deposit: {
    include: /(night|depository|after[- ]hours|drop box)/i,
    exclude: /^(?!.*(lost|replac|per month|monthly|annual|rental)).*(\bbags?\b|zipper|pouch|wrapper|strap)/i,
  },
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
// v57: a cross-border banking bundle's annual fee is monthly maintenance (RBC; v56 is Accuracy's).
export const CATEGORY_GUARD_VERSION = 57;

/**
 * Categories whose fee is usually a rate ("1% of the transaction"). A dollar amount filed
 * under one, on a line that states a percent ("Debit Card Foreign Transaction 1% of the
 * U.S. dollar amount ... $7.00") or names a rate ("VISA Exchange Rate"), is the rate read
 * as dollars or a neighbouring figure. A rate itself is stored as a rate with no dollar
 * amount, so this never touches it.
 */
const RATE_CATEGORIES: ReadonlySet<string> = new Set(["card_foreign_txn"]);
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
  { from: "nsf", to: "deposited_item_return", when: /(deposit|written to you)/i },
  { from: "wire_domestic_outgoing", to: "wire_intl_outgoing", when: /(international|foreign|intl|\bint['’]l\b)/i, unless: /domestic/i },
  { from: "overdraft", to: "late_payment", when: /\blate (payment|charge|fee)\b/i },
  // v41: a charge-off processing fee sits with the other charge-off fees under account research.
  { from: "overdraft", to: "account_research", when: /\bcharge(d)?[- ]?off\b/i },
  { from: "check_cashing", to: "account_research", when: /\bcharge(d)?[- ]?off\b/i },
  { from: "deposited_item_return", to: "card_dispute", when: /((\bcards?\b|visa)[^|]{0,25}charge[- ]?back|charge[- ]?back[^|]{0,25}(\bcards?\b|dispute))/i },
  { from: "atm_non_network", to: "card_replacement", when: /(replace|reissue|lost|stolen)/i, unless: /\bpins?\b/i },
  { from: "check_printing", to: "counter_check", when: /\btemporar/i },
  { from: "check_cashing", to: "collection_item", when: COLLECTION_ITEM },
  { from: "legal_process", to: "other_lending_fee", when: SUBORDINATION },
  { from: "money_order", to: "check_image", when: ITEM_COPY },
  { from: "card_replacement", to: "rush_card", when: new RegExp(EXPRESS_CARD, "i") },
  { from: "minimum_balance", to: "early_closure", when: new RegExp(EARLY_CLOSE, "i") },
  { from: "minimum_balance", to: "dormant_account", when: new RegExp(INACTIVE, "i") },
  { from: "monthly_maintenance", to: "overdraft", when: /\boverdraft (privilege|courtesy)/i },
  { from: "card_foreign_txn", to: "atm_non_network", when: /(?<!\/\s?)\batm'?s?\b[^|\/]{0,12}\bforeign transactions?/i },
];

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
): CategoryGuardVerdict {
  const rule = canonicalFeeKey ? CATEGORY_GUARD_RULES[canonicalFeeKey] : undefined;
  if (!canonicalFeeKey) return { ok: true };
  const name = plainQuotes(feeName ?? "").trim();
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
  const excluded = (capOnly ? null : name.match(rule.exclude)) ?? softExcluded;
  if (excluded) {
    return {
      ok: false,
      code: "name_contradicts",
      reason: `"${name}" describes a different fee than ${canonicalFeeKey} ("${excluded[0]}")`,
    };
  }
  if (!rule.include.test(name)) {
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
