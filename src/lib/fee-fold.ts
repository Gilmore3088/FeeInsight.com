/**
 * The top-50 fold (James, Oct 8 2026: "do the top 50 and try to fit everything there";
 * "Use extensive and comprehensive text matching"). Sixteen categories left the taxonomy
 * (`FEE_FAMILIES`) and each of their fees is re-filed under one of the 50 by its own
 * wording, and for a bare name ("Balance Inquiry $1.00") by the section of the schedule it
 * sits in. A fee no rule can place has no home in the 50: Hamilton's fold step archives it
 * after a second look (never deleted, still in the log).
 *
 * The retired keys stay in `CANONICAL_KEY_MAP`, so Knox can keep hinting them and older
 * rows still read; `refileCategory` folds them on the way to Darwin and Hamilton.
 */

/**
 * James, Oct 15 2026 (#1398, decision card in the Data quality thread, 14:32 UTC: "Add both"):
 * excess withdrawals and returned mail get their own types, out of account research, where the
 * Oct 7 fold had put about 2,300 of its 5,268 live fees (research's median is $25; these are
 * per-item charges, typically $5). The whole change is dark while this is off: the two types are
 * not in `FEE_FAMILIES`, and every rule that would file a fee there (the fold's splits and
 * e-statement rule, the category guard's line re-file, the hand re-files, the taxonomy aliases)
 * keeps filing it under account research, as before, and the fold's paper statement and e-statement
 * rules match exactly as before (a "return to paper statements" charge included). Off, nothing
 * moves: Hamilton's fold step only reports what the research split would move
 * (`pendingResearchSplit` in its detail). On, new reads file there,
 * and live and verified fees under account research move by name (`EXCESS_WITHDRAWAL`,
 * `RETURNED_MAIL`; logged as `category_fold`, old category kept), each only when the new type's
 * guard and price range accept it. On (James, Oct 17 2026): Knox's own rules re-point with it
 * (Knox rules v77), and public pages list only the top 50 of the 52 types (`publicFeeTypes`).
 * Setting it back to false restores the 50-type taxonomy and account research filing.
 */
export const RESEARCH_SPLIT_LIVE = true;

/** The key a rule files under: the new type while `RESEARCH_SPLIT_LIVE` is on, account research while it is off. Pure. */
export function researchSplitTarget(key: "excess_withdrawal" | "returned_mail", live: boolean = RESEARCH_SPLIT_LIVE): string {
  return live ? key : "account_research";
}

/** A "return to paper statements" charge: a paper statement fee, never returned mail, once the research split is on. */
const RETURN_TO_PAPER = /\breturn(?:ing)?\s+to\s+paper/i;
/** Main's e-statement return rule, unchanged while the research split is off. */
const ESTATEMENT_RETURNED = /\breturn(?:ed)?\b|\bundeliverable\b|\b(?:incorrect|bad|invalid|wrong) e-?mail\b/i;

/**
 * The e-statement fold's return rules. Off, exactly main's one rule (a return, including a return to
 * paper, goes to account research); on, a return to paper is a paper statement fee and any other
 * return is returned mail. Pure.
 */
export function estatementReturnRules(live: boolean = RESEARCH_SPLIT_LIVE): { to: string; name: RegExp }[] {
  if (!live) return [{ to: "account_research", name: ESTATEMENT_RETURNED }];
  return [
    { to: "paper_statement", name: RETURN_TO_PAPER },
    { to: "returned_mail", name: new RegExp(String.raw`^(?![\s\S]*${RETURN_TO_PAPER.source})[\s\S]*(?:${ESTATEMENT_RETURNED.source})`, "i") },
  ];
}

/** A fold rule: the fee goes to `to` (null: no home in the 50) when its text matches. */
interface FoldRule {
  to: string | null;
  /** Tested against the fee's name. */
  name?: RegExp;
  /** Tested against the schedule text just before the fee's line, when it is known. */
  context?: RegExp;
  /** Like `context`, for a test a pattern cannot state. */
  contextTest?: (before: string) => boolean;
}

interface RetiredCategory {
  /** The family it sat in, so Knox's family readers keep spotting it before the fold. */
  family: string;
  /** First matching rule wins. */
  rules: FoldRule[];
  /** Where a fee no rule matches goes (null: no home). */
  otherwise: string | null;
}

/** An ATM or a shared ATM network, named on the line or in the section heading above it. */
const ATM_CUE =
  /\b(?:atms?(?!\s*deposit)|automated teller|machines?|terminals?|cajero|allpoint|shazam|co-?op network|moneypass|cirrus|network atm|atm network|(?:debit|check|atm) cards?)\b|\bnon[- ][\w'’ -]{1,30}\b(?:atms?|machines?)\b|\bforeign atm|\bother (?:banks?|institutions?)['’]? (?:atms?|machines?)/i;
/** A word before "ATM:" that makes it another bank's or network's machine. */
const OTHER_ATM_WORD = /^(?:non\b|non-|foreign|other|out-of|outside|shared|network|surcharge|international|domestic|all\b|any\b)/i;

/**
 * True when the nearest ATM heading above a fee is the bank's own machine: "Regions ATM:" over
 * "Balance Inquiry $0.00" (Regions, institution 27, Oct 9), "Our ATM:", "Proprietary ATM:". A
 * fee there is not what a customer pays at another network's ATM. "Non-Regions ATM:", "Foreign
 * ATM:" and a heading with no word before it ("ATM Fees") are not.
 */
export function ownAtmSection(before: string): boolean {
  const headings = [...before.matchAll(/(\S+)\s+(?:atms?|machines?)\s*:/gi)];
  const word = headings.at(-1)?.[1]?.replace(/^[^\w]+/, "");
  if (!word || OTHER_ATM_WORD.test(word)) return false;
  return /^(?:our|proprietary|in-network)$/i.test(word) || /^[A-Z][\w&'.]*$/.test(word);
}
/** A person, a phone line or a channel other than an ATM. */
const ASSISTED_CUE =
  /\b(?:tele?phone|phone|calls?|call center|representative|staff|employee|teller|member service|service center|assisted|audio|night owl|online|internet|web|mail|printout|in[- ]person|by person|shared branch|non[- ]?automated|manual)\b/i;

export const RETIRED_CATEGORIES: Readonly<Record<string, RetiredCategory>> = {
  // An inquiry at an ATM is an ATM fee; one made by phone or at the counter has no home.
  balance_inquiry: {
    family: "Account Services",
    rules: [
      // Not an inquiry at all ("Shared Branch Withdrawals", an overdraft transfer line).
      { to: null, name: /^(?![\s\S]*(?:\binquir|\binq\b|\bbalance check|\bsolicitud de balance))/i },
      { to: "atm_non_network", name: ATM_CUE },
      { to: null, name: ASSISTED_CUE },
      // A bare "Balance Inquiry" under the bank's own ATM heading has no home.
      { to: null, contextTest: ownAtmSection },
      // A bare "Balance Inquiry" under an ATM heading ("Foreign ATM Transactional Fees").
      { to: "atm_non_network", context: ATM_CUE },
    ],
    otherwise: null,
  },
  // One daily cap covers overdraft and NSF charges (James, Oct 8: "Merge caps"). A line about a
  // wire or a card limit is not a fee cap.
  nsf_daily_cap: {
    family: "Overdraft & NSF",
    rules: [{ to: null, name: /\bwires?\b|\bwithdrawal limit|\bpurchase limit/i }],
    otherwise: "od_daily_cap",
  },
  // A disputed card charge is billed as research into the account.
  card_dispute: {
    family: "ATM & Card",
    rules: [
      { to: null, name: /\bno (?:charge|fee)\b/i },
      { to: "account_research", name: /\bdisput|\bcharge[- ]?backs?\b|\bcharged back\b/i },
    ],
    otherwise: null,
  },
  // A returned e-statement is returned mail (its own type once `RESEARCH_SPLIT_LIVE` is on; account
  // research before, a "return to paper statements" charge included, as on main); once on, a "return
  // to paper statements" charge is a paper statement fee, never returned mail; a copy is a copy fee; a paper-and-electronic
  // charge is a paper statement; "Bill Pay (w/o ... e-statement)" is bill pay. A fee for the
  // e-statement itself, a free e-statement, and the waiver wording that names e-statements
  // have no home.
  estatement_fee: {
    family: "Account Maintenance",
    rules: [
      ...estatementReturnRules(),
      { to: "document_reproduction", name: /\bduplicate\b|\bcop(?:y|ies)\b|\breprints?\b/i },
      { to: "bill_pay", name: /^bill pay\b/i },
      { to: "paper_statement", name: /\bdual statement|\bboth (?:an? )?e-?statements? (?:&|and) paper\b|\bmultiple statements? \(mailable/i },
    ],
    otherwise: null,
  },
  // Zelle and other person-to-person payments sit with bill pay; research into a payment is
  // account research. Membership, security, dormancy and enrollment wording is not a Zelle fee.
  zelle_fee: {
    family: "Digital & Electronic",
    rules: [
      { to: "account_research", name: /\bresearch\b/i },
      {
        to: null,
        name: /\b(?:dormant|inactive|membership|entrance|security fee|compatib\w*|reinstat\w*|daily limits?|internet banking|epay|enrollment|trademarks?|cancell?ation|returns?|used monthly)\b|\bfast, safe\b|^\s*(?:or|once)\b/i,
      },
      { to: "bill_pay", name: /\bzelle|\bperson[- ]to[- ]person\b|\bp2p\b|\bsend (?:and receive )?money\b/i },
    ],
    otherwise: null,
  },
  // A prepaid, travel or reloadable card is bought or loaded like a gift card.
  prepaid_card_reload: {
    family: "Gift & Prepaid Cards",
    rules: [
      { to: "card_replacement", name: /\breplace(?:ment)?\b/i },
      {
        to: "gift_card_purchase",
        name: /\bpre-?\s?paid\b|\bre-?\s?load|\btravel\s?(?:money )?cards?\b|\btravelmoney\b|\bcu ?money\b|\beveryday (?:spend )?(?:prepaid )?(?:debit )?cards?\b|\bgift cards?\b|\baccess cards?\b/i,
      },
    ],
    otherwise: null,
  },
  // An overdraft line of credit is paid out as a transfer into the account.
  od_line_of_credit: {
    family: "Overdraft & NSF",
    rules: [{ to: "od_protection_transfer", name: /\btransfers?\b|\badvances?\b/i }],
    otherwise: null,
  },
  // Changing a loan's terms after it is made is another lending fee.
  mortgage_modification: {
    family: "Mortgage Servicing",
    rules: [
      // "Loan Modification Fee—1% of outstanding balance" read as $6 is a rate, not a price.
      { to: null, name: /\d\s?%/ },
      { to: "other_lending_fee", name: /\bmodif\w*|\bre-?\s?amorti[sz]\w*|\breamortizaci/i },
    ],
    otherwise: null,
  },
  // Releasing a lien or a deed of trust is another lending fee (James, Oct 8: Appraisal kept its
  // own type, so Mortgage Lien Release gave up its spot).
  mortgage_lien_release: { family: "Mortgage Servicing", rules: [], otherwise: "other_lending_fee" },
  reconveyance: { family: "Mortgage Servicing", rules: [], otherwise: "other_lending_fee" },
  mortgage_payoff: { family: "Mortgage Servicing", rules: [], otherwise: "other_lending_fee" },
  refinance_fee: { family: "Mortgage Servicing", rules: [], otherwise: "other_lending_fee" },
  duplicate_title: { family: "Vehicle & Title", rules: [], otherwise: "vehicle_title" },
  dmv_filing: { family: "Vehicle & Title", rules: [], otherwise: "vehicle_title" },
  // International ATM is its own type again (James, Oct 19, #2037: "Split"); it left this table.
  // A distribution closes out (part of) the IRA.
  ira_distribution: { family: "Retirement & IRA", rules: [], otherwise: "ira_termination" },
};

export const RETIRED_CATEGORY_KEYS: ReadonlySet<string> = new Set(Object.keys(RETIRED_CATEGORIES));

/**
 * A check or item sent to another bank for collection, or a foreign or Canadian check or item
 * handled for deposit ("Foreign Check Processing", "Canadian Item Deposit"), which banks send
 * for collection. Cashing a foreign check is check cashing and a returned one is a returned
 * item. A collection fee on a charged-off, past-due or negative-balance account, or a
 * collection call, is debt collection, not this.
 */
export const COLLECTION_ITEM =
  /^(?![\s\S]*(?:charged[- ]?off|past[- ]due|delinquen|\bcalls?\b|negative balance|overdrawn|\bdebts?\b|agenc))(?:[\s\S]*\bcollections?\b|(?![\s\S]*\b(?:cash\w*|returns?|returned)\b)[\s\S]*\b(?:foreign|canadian|international|non[- ]?u\.?s\.?)\s+(?:checks?|items?|drafts?)\b)/i;

/**
 * Guard v68: a foreign, Canadian, international or non-U.S. check or item that came back unpaid
 * ("Foreign Check Return Fee", "Returned Canadian Check", "Foreign Item Return Fee", "Foreign Check
 * per Item Processing: Returned"). It is a deposited or cashed item returned, the returned deposited
 * item fee, as the 14 live "Foreign Returned Deposited Item" fees already are; not check cashing. One
 * that names a collection stays a collection item (`COLLECTION_ITEM` is tried first), and a wire,
 * mail or statement return is another fee.
 */
export const FOREIGN_ITEM_RETURN =
  /^(?![\s\S]*\b(?:collections?|wires?|mail(?:ed|ing)?|statements?)\b)(?=[\s\S]*\b(?:foreign|canadian|international|non[- ]?u\.?s\b))(?=[\s\S]*\b(?:checks?|cheques?|items?|drafts?)\b)[\s\S]*\b(?:return(?:s|ed)?|unpaid|dishonou?red|charge[- ]?backs?)\b/i;

/**
 * Guard v69: `FOREIGN_ITEM_RETURN` for a fee filed as NSF. A row that also names domestic items or
 * insufficient or uncollected funds ("Domestic/Foreign – Incoming and Outgoing Returned Item for
 * Insufficient or Uncollected Funds") prices the member's own returned items too, so it stays NSF.
 * A price on top of a cost ("Foreign returned check fee (at cost plus)" $10, 22823) is not the fee's
 * whole price, so it never moves either.
 */
export const FOREIGN_DEPOSIT_RETURN = new RegExp(
  String.raw`^(?![\s\S]*\b(?:domestic|insufficient|nsf|non[- ]?sufficient|uncollected|cost)\b)` + FOREIGN_ITEM_RETURN.source.slice(1),
  "i",
);

/**
 * Guard v69: an IRA's own closing or termination charge ("Individual Retirement Account Closing Fee",
 * "IRA Closed within 18 Months of Opening", "Retirement/HSA Account Closing Fee") is the IRA
 * termination fee, where the live windowed IRA closures already are ("IRA Early Closure (Within 12
 * Months)", "IRA Account Closure (Within 90 Days)"); not a deposit account's early closure. A row
 * that prices other accounts too, or only mentions the IRA ("Account Closed within 90 days of opening
 * (including IRA's)", "Early Account Closing - DDA and Savings less than 3 months - IRA prior to 3
 * years", "... (except IRA accounts)"), stays early closure, as does a certificate's or a club's.
 */
export const IRA_CLOSING =
  /^(?![\s\S]*\b(?:includ\w*|except\w*|exclud\w*|not applicable|other than|dda|checking|savings|money market|cds?|certificates?|clubs?|loans?)\b)(?=[\s\S]*\b(?:iras?|roth|individual retirement|retirement)\b)[\s\S]*\b(?:clos\w*|close-?outs?|terminat\w*)\b/i;

/**
 * Guard v70 (James, Oct 17): skipping a loan payment ("Skip-a-Pay", "Skip A Payment Fee", "Loan
 * Extension (Skip-A-Pay)", "Holiday skip payment program") is a lending fee, not a late payment or a
 * loan origination: 409 of 441 live skip-a-pay fees were already other lending. A line that also
 * names an overdraft ("Auto overdraft from shares Loan Skip Payment fee") or says there is no fee
 * stays where it is.
 */
export const SKIP_A_PAY =
  /^(?![\s\S]*\b(?:overdraft|no[- ]fee|free)\b)[\s\S]*\bskip[- ]?(?:a[- ]?)?(?:loan[- ]?)?pay(?:ments?)?\b/i;

/**
 * Guard v72 (#1788, James's sample-report review, Oct 17): an ATM used outside the U.S. is
 * International ATM (`atm_international` since guard v76; International ATM & Card,
 * `card_foreign_txn`, before), not the non-network ATM fee: PNC's "Non-PNC Bank ATM
 * Fee (All Other Countries)" $5 sat beside its $3 U.S. fee. The name must name an ATM (or a cash
 * disbursement) and a place outside the U.S.: international, another or a foreign country, outside
 * the U.S., abroad or overseas. "Foreign ATM" alone is another bank's ATM at home and is not matched.
 * One price for domestic and international ATMs ("(International or Domestic)", "includes
 * international", "inside United States & internationally"), a line priced inside or within the U.S.
 * ("Non-IBC ATM locations (in the U.S.)"), "non-international" and a bank named International are
 * not matched either.
 */
export const INTERNATIONAL_ATM = new RegExp(
  String.raw`^(?![\s\S]*(?:\bdomestic\b|\bnon[- ]?international\b|\b(?:inside|within|in)\s+(?:the\s+)?(?:u\.?s\.?a?(?![a-z])|united states|us(?![a-z]))|\bincludes?\s+international\b|\bus,\s*canada\b|\binternationally\b))` +
    String.raw`(?=[\s\S]*\b(?:atms?|automated teller|cash disbursements?|machines?)\b)` +
    String.raw`[\s\S]*(?:\binternational\b(?!\s+bank\b)|\bintl\b|\bint['’]l\b|\b(?:other|foreign)\s+countr(?:y|ies)\b|\boutside\s+(?:of\s+)?(?:the\s+)?(?:u\.?s\.?a?(?![a-z])|united states|us(?![a-z]))|\babroad\b|\boverseas\b)`,
  "i",
);

/**
 * Guard v76 (James, Oct 19, #2037: "Split"): `INTERNATIONAL_ATM` with no card purchase in the name, so
 * an ATM used abroad that was filed as International ATM & Card ("International ATM Withdrawal Fee",
 * "Non–Wells Fargo ATMs outside the U.S.", "Non-IBC ATM locations (outside the U.S.): Withdrawal") is
 * International ATM again. One price for ATM and debit card use abroad ("International ATM/Debit
 * Card Transaction", "ATM/Visa Debit Foreign Transactions"), a POS or purchase line, and a credit
 * card's cash advance stay the card's foreign transaction fee, as does an ATM line naming no place
 * abroad ("ATM – Surcharge for Foreign Transactions").
 */
export const ATM_ABROAD = new RegExp(
  String.raw`^(?![\s\S]*\b(?:debit|pos|point of sale|purchases?|check ?cards?|credit cards?|cash advances?)\b)` + INTERNATIONAL_ATM.source.slice(1),
  "i",
);

/**
 * Guard v72 (#1788): an overdraft charged for staying overdrawn for days ("7 Day Overdraft Processing
 * Fee", "Overdraft Charge (First assessed on the 6th business day overdrawn)", "Cont OD Charge") is
 * the continuous overdraft fee, not the per-item overdraft fee. A daily cap or a per-day item limit
 * ("Max 5 per day") is not matched, nor a name that also prices each item paid ("fee assessed for each
 * item paid1 Continuous Overdraft Fee...", taken-down 14969: its $30 is the per-item fee).
 */
export const SUSTAINED_OVERDRAFT =
  /^(?![\s\S]*\b(?:(?:each|per)\s+(?:item|presentment)|items?\s+paid)\b)[\s\S]*(?:\bcont(?:inuous)?\.?\s+(?:od|overdraft|o\/d)\b|\b\d+(?:st|nd|rd|th)?[- ](?:business\s+|calendar\s+|banking\s+)?days?[- ](?:overdraft|overdrawn|negative|od)\b|\b\d+(?:st|nd|rd|th)\s+(?:business\s+|calendar\s+|banking\s+)?day\s+(?:overdrawn|negative|in overdraft)\b|\b(?:overdrawn|negative|in overdraft)\s+(?:for\s+)?(?:more than|over|after|beyond)\s+\d+\s+(?:\w+\s+)?days\b)/i;

/**
 * Guard v72 (#1788): a wire the member receives ("Domestic Wire Transfer Fee – In Coming", "Wire
 * Transfer (in-bound) Domestic", "Domestic Wire-In fee", "Domestic Wire: In", "Domestic Wire Deposit
 * Fee", "Income Wire Transfer (foreign)") filed under an outgoing wire type is the incoming wire fee.
 * A name that also names sending ("In/Out", "Wire Out / Wire In", "outbound/inbound") prices both or
 * another slot and is not matched; "in person", "in branch" and "in U.S. dollars" say how or where it
 * is sent.
 */
export const INCOMING_WIRE =
  /^(?![\s\S]*\b(?:out|outgoing|out[- ]going|outbound|out[- ]bound|send|sent|sending|withdrawals?)\b)(?=[\s\S]*\b(?:wires?|transfers?)\b)[\s\S]*(?:\bin[- ]?coming\b|\bin[- ]bound\b|\binbound\b|\breceiv\w*|\bwires?[- ]in\b|\b(?:domestic|international|foreign)[- ]in\b|:\s*in\s*$|\bincome wire\b|\bwire deposits?\b)/i;

/** A mortgage, lien or loan subordination; a wire line under a "Subordination Request" heading is not one. */
export const SUBORDINATION = /^(?![\s\S]*subordination request:\s*(?:incoming|outgoing))[\s\S]*\bsubordinat/i;

/** A copy of an item, not the item. */
export const ITEM_COPY = /\b(?:photo ?)?cop(?:y|ies)\b/i;

/** A lien release or satisfaction ("Duplicate Lien Satisfied") filed as legal process. */
const LENDING_LEGAL = /\blien (?:release|satisf)|\b(?:release|satisf\w*) of (?:the )?lien/i;

/**
 * James, Oct 15 2026 (#1026, reversing Oct 8): subordination fees file as legal process. New reads
 * do from this change on. Live and verified fees filed as other lending before it move when this
 * is on: Hamilton's fold step re-files them (logged as `category_fold`, old category kept), each
 * one only when legal process's guard and price range accept it. On since James's go, Oct 15
 * ("proceed with your recs", Audit thread).
 */
export const SUBORDINATION_REFILE_LIVE = true;

/**
 * Live subordination fees the switched re-file leaves where they are, by verified id, because the
 * bank's line does not support the fee as a subordination price (review of #1370, Oct 15):
 * - 138129 (live 116720, $20): sits under a "SUBORDINATION REQUEST & PARTIAL ... RELEASE - $250"
 *   heading; the $20 is another row's price.
 * - 154983 (live 134129, $10): no price on its line; the $10 is "Business | $10 per month" checking.
 */
export const SUBORDINATION_REFILE_HELD_VERIFIED_IDS: ReadonlySet<number> = new Set([138129, 154983]);

/** True when the switched subordination re-file must leave this fee where it is. Pure. */
export function subordinationRefileHeld(fromKey: string, toKey: string | null | undefined, feeVerifiedId: number): boolean {
  return fromKey === "other_lending_fee" && toKey === "legal_process" && SUBORDINATION_REFILE_HELD_VERIFIED_IDS.has(feeVerifiedId);
}

/** A night depository's key, bag or service. */
const NIGHT_DEPOSIT = /\bnight (?:deposit|drop)/i;

/**
 * A late charge on safe deposit box rent. Banks write it many ways ("Box Late Payment Fee",
 * "SDB Late payment", "Safe Box Late Fee", "Rental Late Fee"); a loan's late charge never
 * names a box or rent.
 */
const BOX_RENT = /\bbox(?:es)?\b|\bsdb\b|\bsafe(?:ty)? (?:deposit|box)|\brent(?:al)?\b/i;

/** An IRA moved out to another institution ("IRA Transfer (outgoing)", "IRA Transfer Closeout"). */
const IRA_TRANSFER_OUT = /^(?![\s\S]*\bincoming\b)(?=[\s\S]*\bira\b)[\s\S]*\btransfer/i;

/** Buying or reloading a prepaid card ("Reloadable ATM/Debit Card – Reload Fee"), not using one at an ATM. */
const PREPAID_BUY_OR_RELOAD =
  /^(?=[\s\S]*\b(?:pre-?paid|reloadable)\b)(?![\s\S]*\b(?:withdrawals?|inquiry|inquiries)\b)[\s\S]*\b(?:purchase|reload)\b/i;

/**
 * A charge for savings or money market activity past the free count ("Excess withdrawal fee
 * (MMDA)", "Savings account excess debit fee"), a Reg D-style fee: the excess withdrawal type
 * (James, Oct 15 2026, #1398; account research held them from Oct 7).
 */
const EXCESS_ACTIVITY = /\bexcess(?:ive)?\s+(?:withdrawals?|transactions?|transfers?|debits?|activity)\b/i;

/**
 * An excess withdrawal fee filed under account research ("Excess Transaction Fee", "Excessive
 * Withdrawal Fee (Share Account)", "Excess Savings Account Transaction", "Withdrawal Limit Fee",
 * "Over withdrawal limit", "Transfers in excess of 6 per month", "Withdrawals after 6 per month",
 * "Reg D violation"). A line that names research or reconciliation stays research, and so does
 * one about an ATM or another network, an overdraft, check cashing, a wire, a debit card or a
 * business account's item count ("Excess items"). A generic "Service charge" is never moved by
 * name. An IRA's excess withdrawal charge is IRA administration, a rule the account research
 * split tries first.
 */
export const EXCESS_WITHDRAWAL =
  /^(?![\s\S]*(?:\bresearch|\breconcil|\batms?\b|\bnon[- ]?network\b|\bforeign\b|\boverdraft|\bod\b|\bcheck cashing\b|\bwires?\b|\bbusiness\b|\bexcess(?:ive)?\s+(?:(?!(?:withdrawals?|transactions?|transfers?|debits?)\b)[\w/-]+\s+){0,2}items?\b|\bdebit cards?\b))(?!(?![\s\S]*\b(?:excess\w*|withdrawals?)\b)[\s\S]*\bitems?\s+(?:over|in excess|after)\b)(?:[\s\S]*\bexcess(?:ive)?\s+(?:[\w/-]+\s+){0,2}?(?:withdrawals?|transactions?|transfers?|debits?|activity)\b|[\s\S]*\bwithdrawal\s+limits?\b|[\s\S]*\b(?:withdrawals?|transactions?|transfers?|debits?)\s+(?:in\s+excess|over\s+\d|beyond|after\s+\d)|[\s\S]*\breg(?:ulation)?\.?\s?d\b)/i;

/**
 * Research or reconciliation words that keep a fee in account research. Research named for the
 * address itself ("Address Research return mail", "Incorrect Address Research Fee", "Locator
 * research fee") is returned mail; a run-on that also names reconciling ("Returned Mail Fee
 * Reconciling statements and research ...") stays research.
 */
const RESEARCH_WORD = String.raw`(?![\s\S]*\breconcil)(?![\s\S]*(?<!\b(?:address(?:es)?|locator|locate)\s+(?:[\w/-]+\s+)?)\bresearch)`;
/** Lines that name returned mail's words but another fee: a return to paper statements, a deposit, a returned check or draft, an address change, a re-enrollment, a branch or ATM locator. */
const NOT_RETURNED_MAIL = String.raw`(?![\s\S]*(?:\breturn(?:ing)?\s+to\s+paper|\bdeposit|\bdrafts?\b|\b(?:items?|checks?|drafts?)\s+returned\b|\breturn(?:ed)?\s+(?:checks?|items?|ach|payments?|loans?)\b|\bchange of address|\baddress change|\bre-?enroll|\b(?:branch|atm)\s+locat))`;

/**
 * Returned or undeliverable mail or statements, a bad or incorrect address, an address locator
 * ("Returned Statement Fee", "Return Mail Fee (no forwarding)", "Bad address fee", "Undeliverable
 * Mail / Locator fee"): the returned mail type (James, Oct 15 2026, #1398). A bare "invalid email
 * address" names no mail; "Returned Item" and "Returned check" are other fees.
 */
export const RETURNED_MAIL = new RegExp(
  String.raw`^${RESEARCH_WORD}${NOT_RETURNED_MAIL}[\s\S]*(?:\b(?:return(?:ed)?|undeliverable|undelivered|bad|invalid|incorrect|wrong|unknown|missing)\s+(?:mail(?:ing)?|address(?:es)?)\b|\b(?:return(?:ed)?|undeliverable|undelivered)\s+(?:of\s+)?(?:mail(?:ed)?\s+|paper\s+)?(?:e-?)?(?:statements?|stmts?)\b|\b(?:mail|statements?)\s+returned\b|\baddress\s+(?:correction|search|research|locat\w*)\b|\blocator\b)`,
  "i",
);

/** An IRA's charge for withdrawals past the free count ("IRA Excess Withdrawal Fee"), a charge on the IRA itself. */
const IRA_EXCESS_WITHDRAWAL = /^(?=[\s\S]*\bira\b)[\s\S]*\bexcess(?:ive)? withdrawals?\b/i;

/** Lines where "fax" is how something else is requested or sent, not a fax service. */
const FAX_AS_CHANNEL = String.raw`(?![\s\S]*\b(?:research|phone|telephone|e-?mail|in (?:branch|person)|initiated|wires?|transfers?|domestic|manual|verification|verify|request|clos\w*|pay-?offs?|loans?|mortgages?|real estate)\b|[\s\S]*\bcar ?fax)`;

/**
 * Sending or receiving a fax ("Fax (Outgoing)"), which document reproduction holds. Fax as the
 * way a wire, transfer or closing is requested, a verification or loan payoff sent by fax, a
 * Carfax report, and research priced with copies stay where they are. Knox reads fax lines
 * with this too (`FOLDED_PATTERNS`), so its reads and the fold agree.
 */
export const FAX_SERVICE = new RegExp(String.raw`^${FAX_AS_CHANNEL}[\s\S]*\bfax(?:es|ed|ing)?\b`, "i");

/** A fax or a document copy ("Copy of previous statement"), outside the same exceptions. */
const FAX_OR_COPY = new RegExp(String.raw`^${FAX_AS_CHANNEL}[\s\S]*(?:\bfax(?:es|ed|ing)?\b|\b(?:photo ?)?cop(?:y|ies)\b|\breproduc)`, "i");

/**
 * A copy charge priced by the page ("Account Research Copies (per page)", "Research Request - Per
 * Page Copied"), which document reproduction holds even when the copies come from research.
 * Research priced by the hour or with a minimum, copies extra, stays research. Knox reads these
 * lines with this too, ahead of its research pattern.
 */
export const PER_PAGE_COPY =
  /^(?![\s\S]*\b(?:hours?|hrs?|hourly|min(?:imum)?|mininum|postage)\b)(?=[\s\S]*\bcop(?:y|ies|ied|ying)\b)[\s\S]*(?:\bper (?:page|pg)\b|\/ ?(?:page|pg)\b)/i;

/**
 * A line led by the copy itself ("Document copies - greater than 1 year - Per item, may also be
 * subject to research fee", "Microfilm Copy (plus Account Research)"), or a member's own fax
 * ("Member personal fax request (in state)"): document reproduction, even where research is
 * named as a further charge. Research priced by the hour or with a minimum stays research.
 */
const COPY_LED = /^(?![\s\S]*\b(?:hours?|hrs?|hourly|min(?:imum)?|mininum|postage)\b)(?:(?:[\w-]+ ){0,2}(?:photo ?)?cop(?:y|ies)\b|[\s\S]*\bpersonal fax\b)/i;

/**
 * Balancing or reconciling a member's checkbook, usually priced by the hour ("Checkbook
 * Reconciliation (per hour)", "Balance Check Book"): reconciliation work, which account research
 * holds, not a check order; a line naming a check order, printing or style stays. Knox reads these lines with this too, ahead of its check printing rule.
 */
export const CHECKBOOK_RECONCILIATION =
  /^(?![\s\S]*\b(?:orders?|ordering|reorder\w*|printing|styles?|box(?:es)?)\b)[\s\S]*\b(?:reconcil\w*|balancing|balance (?:the |your |a |customer )?(?:check ?books?|statements?)|research)\b/i;

/**
 * A "Cross-Border Banking" bundle, package or account (RBC's U.S. Premium Checking "Cross-Border
 * Banking Bundle annual fee", $99.50 a year or $9.95 a month; TD and BMO use the name too) is an
 * account, so its fee is the account's maintenance fee, not the card's currency fee. A line naming
 * a transaction, purchase, conversion, currency, exchange, ATM, wire or a percentage stays the
 * card's. Knox reads these lines with this too, ahead of its currency fee rule.
 */
export const CROSS_BORDER_BUNDLE =
  /^(?![\s\S]*(?:%|\b(?:transactions?|purchases?|conversions?|currency|exchange|atms?|wires?)\b))[\s\S]*\bcross[- ]?border (?:banking|bundles?|packages?|accounts?)\b/i;

/**
 * Adjusting an ATM transaction ("ATM Adjustment" $5 at Wildfire, "ATM Adjustment Fee", "Special
 * Handling (i.e. ATM adjustment, etc.)"): correcting a deposit or dispute after the fact, which is
 * research work that account research holds, not a charge for using another network's ATM. A
 * limit change stays, and so does a line naming the deposit ("ATM Deposit Correction Adjustment"),
 * which the CA answer key files as a deposited item return. Knox reads these lines with this too,
 * ahead of its ATM rule.
 */
export const ATM_ADJUSTMENT = /^(?![\s\S]*\b(?:limits?|deposit\w*)\b)[\s\S]*\batm\b[\s\S]{0,20}\badjust(?:ment|ments|ed)?\b/i;

/**
 * A statement mailed back undelivered ("Returned Mailed Statement", "Return Statement Charge"), filed
 * as returned mail once the research split is on; then a "return to paper statements" charge stays a
 * paper statement fee. Off, main's pattern, which sends that charge to account research too.
 */
const RETURNED_STATEMENT_OFF = /\breturn(?:ed)?\b[\s\S]*\b(?:mail|statement)/i;
const RETURNED_STATEMENT = new RegExp(String.raw`^(?![\s\S]*${RETURN_TO_PAPER.source})[\s\S]*${RETURNED_STATEMENT_OFF.source}`, "i");

export interface SplitCategory {
  to: string;
  name: RegExp;
  /** Further rules for the same source key, tried in order when `name` does not match. */
  also?: ReadonlyArray<{ to: string; name: RegExp }>;
  /** A cheap SQL pre-filter (case-insensitive regex) for the rows the rule might move. */
  sqlPattern: string;
}


/** The account research split's switched rules, tried after its IRA, fax and copy rules. */
const RESEARCH_SPLIT_RULES: ReadonlyArray<{ to: string; name: RegExp }> = [
  { to: "excess_withdrawal", name: EXCESS_WITHDRAWAL },
  { to: "returned_mail", name: RETURNED_MAIL },
];
/** The SQL pre-filter for `RESEARCH_SPLIT_RULES` (Postgres `~*`). */
export const RESEARCH_SPLIT_SQL_PATTERN = "excess|withdrawal limit|(withdrawal|transaction|transfer|debit)s? (over|beyond|after)|regulation d|reg\\.? ?d|return|undeliver|address|locator|mail";
/** The account research split's SQL pre-filter without the switched rules. */
const RESEARCH_BASE_SQL_PATTERN = "\\mira\\M|fax|cop(y|ies|ied)|reproduc";

/**
 * Live categories part of which moved to a new type. James, Oct 8 2026: collection items get
 * their own type ("Own type"); Knox v26 had filed them under check cashing, where their $20
 * median sat beside check cashing's $5. A fee the rule does not match stays where it is.
 */
export function splitCategoriesFor(options: {
  subordinationRefileLive: boolean;
  /** `RESEARCH_SPLIT_LIVE`; off when not given. */
  researchSplitLive?: boolean;
}): Readonly<Record<string, SplitCategory>> {
  const research = options.researchSplitLive ?? false;
  return {
    // Guard v68: a returned foreign check or item is a returned deposited item, not check cashing.
    check_cashing: {
      to: "collection_item",
      name: COLLECTION_ITEM,
      also: [{ to: "deposited_item_return", name: FOREIGN_ITEM_RETURN }],
      sqlPattern: "collection|foreign|canadian|international|non[- ]?u\\.?s",
    },
    // Guard v69: a returned foreign, Canadian or international check or item is a returned
    // deposited item, not the member's own NSF item.
    nsf: { to: "deposited_item_return", name: FOREIGN_DEPOSIT_RETURN, sqlPattern: "foreign|canadian|international|non[- ]?u\\.?s" },
    // Guard v69: an IRA's own closing charge is the IRA termination fee, not an early closure.
    early_closure: { to: "ira_termination", name: IRA_CLOSING, sqlPattern: "\\mira|roth|retirement" },
    // Guard v72 (#1788): staying overdrawn for days is the continuous overdraft fee.
    overdraft: { to: "continuous_od", name: SUSTAINED_OVERDRAFT, sqlPattern: "cont|day" },
    // Guard v72 (#1788): a wire the member receives is the incoming wire fee.
    wire_domestic_outgoing: { to: "wire_domestic_incoming", name: INCOMING_WIRE, sqlPattern: "in|receiv|deposit" },
    wire_intl_outgoing: { to: "wire_intl_incoming", name: INCOMING_WIRE, sqlPattern: "in|receiv|deposit" },
    // A lien release is other lending (James, Oct 8: Lien Release gave up its spot). A subordination
    // stays legal process (James, Oct 15).
    legal_process: { to: "other_lending_fee", name: LENDING_LEGAL, sqlPattern: "lien" },
    // A copy of a money order or cashier's check is a check copy, not the money order itself.
    money_order: { to: "check_image", name: ITEM_COPY, sqlPattern: "cop(y|ies)" },
    // A night deposit or night drop key is the night depository's, not a safe deposit box's.
    safe_deposit_box: { to: "night_deposit", name: NIGHT_DEPOSIT, sqlPattern: "night (deposit|drop)" },
    // A late charge on box rent is a safe deposit box fee, not a loan's late payment.
    // A statement or item copy is document reproduction, not a late payment.
    // Guard v70: skipping a loan payment is a lending fee, not a late payment (James, Oct 17).
    late_payment: {
      to: "safe_deposit_box",
      name: BOX_RENT,
      also: [{ to: "document_reproduction", name: FAX_OR_COPY }, { to: "other_lending_fee", name: SKIP_A_PAY }],
      sqlPattern: "\\mbox|\\msdb\\M|\\msafe|\\mrent|fax|cop(y|ies)|skip",
    },
    // Guard v70: nor a loan origination ("Loan Extension (Skip-A-Pay)").
    loan_origination: { to: "other_lending_fee", name: SKIP_A_PAY, sqlPattern: "skip" },
    // Moving an IRA to another institution closes it here; it is not account research. An IRA's
    // excess withdrawal charge is a charge on the IRA itself, filed as IRA administration.
    // A fax or a document copy is document reproduction, not research, and so is a copy charged
    // by the page during research, or a line led by the copy (a member's own fax too).
    // An excess withdrawal fee and returned mail have their own types (James, Oct 15), moved only
    // while `RESEARCH_SPLIT_LIVE` is on.
    account_research: {
      to: "ira_termination",
      name: IRA_TRANSFER_OUT,
      also: [
        { to: "ira_administration", name: IRA_EXCESS_WITHDRAWAL },
        { to: "document_reproduction", name: FAX_OR_COPY },
        { to: "document_reproduction", name: PER_PAGE_COPY },
        { to: "document_reproduction", name: COPY_LED },
        ...(research ? RESEARCH_SPLIT_RULES : []),
      ],
      sqlPattern: research ? `${RESEARCH_BASE_SQL_PATTERN}|${RESEARCH_SPLIT_SQL_PATTERN}` : RESEARCH_BASE_SQL_PATTERN,
    },
    // Balancing or reconciling a checkbook is reconciliation work, not a check order.
    check_printing: { to: "account_research", name: CHECKBOOK_RECONCILIATION, sqlPattern: "reconcil|balanc|research" },
    // A cross-border banking bundle's fee is the account's maintenance fee, not a currency fee.
    // Guard v76: an ATM used abroad is International ATM, its own type again (James, Oct 19, #2037).
    card_foreign_txn: {
      to: "monthly_maintenance",
      name: CROSS_BORDER_BUNDLE,
      also: [{ to: "atm_international", name: ATM_ABROAD }],
      sqlPattern: "cross.?border|atm|automated teller|cash disburse|machine",
    },
    // Buying or reloading a prepaid card is the prepaid card's fee; its ATM use stays here.
    // Adjusting an ATM deposit or dispute is research work, not a network ATM fee.
    // Guard v72: an ATM used outside the U.S. is International ATM (#1788; International ATM & Card
    // until guard v76).
    atm_non_network: {
      to: "gift_card_purchase",
      name: PREPAID_BUY_OR_RELOAD,
      also: [{ to: "account_research", name: ATM_ADJUSTMENT }, { to: "atm_international", name: INTERNATIONAL_ATM }],
      sqlPattern: "prepaid|reload|adjust|internat|\\mintl\\M|int.l\\M|countr|outside|abroad|overseas",
    },
    // A statement mailed back undelivered is returned mail (its own type once the research split is
    // on; account research before).
    paper_statement: {
      to: researchSplitTarget("returned_mail", research),
      name: research ? RETURNED_STATEMENT : RETURNED_STATEMENT_OFF,
      sqlPattern: "return",
    },
    // Excess savings or money market activity is an excess withdrawal fee (account research while the
    // research split is off), not a lending fee. A
    // subordination is legal process (James, Oct 15), moved only while `SUBORDINATION_REFILE_LIVE` is on.
    other_lending_fee: options.subordinationRefileLive
      ? { to: researchSplitTarget("excess_withdrawal", research), name: EXCESS_ACTIVITY, also: [{ to: "legal_process", name: SUBORDINATION }], sqlPattern: "excess|subordinat" }
      : { to: researchSplitTarget("excess_withdrawal", research), name: EXCESS_ACTIVITY, sqlPattern: "excess" },
  };
}

/** The split table in force, as `SUBORDINATION_REFILE_LIVE` and `RESEARCH_SPLIT_LIVE` set it. */
export const SPLIT_CATEGORIES: Readonly<Record<string, SplitCategory>> = splitCategoriesFor({
  subordinationRefileLive: SUBORDINATION_REFILE_LIVE,
  researchSplitLive: RESEARCH_SPLIT_LIVE,
});

/**
 * The split table with the research split on. While `RESEARCH_SPLIT_LIVE` is off, Hamilton's fold
 * step dry-runs it and writes what turning the switch on would move to its detail.
 */
export const RESEARCH_SPLIT_PREVIEW: Readonly<Record<string, SplitCategory>> = splitCategoriesFor({
  subordinationRefileLive: SUBORDINATION_REFILE_LIVE,
  researchSplitLive: true,
});

/** The types the research split moves account research fees into. */
export const RESEARCH_SPLIT_KEYS: ReadonlySet<string> = new Set(RESEARCH_SPLIT_RULES.map((rule) => rule.to));

/**
 * Where the research split files an account research fee by its name once `RESEARCH_SPLIT_LIVE` is
 * on: `excess_withdrawal` or `returned_mail`; null when it stays research or the switch is off. For
 * hand-keyed answer keys keyed before the decision, so a read under the new type is graded right
 * once reads go there. Pure.
 */
export function researchSplitCategory(
  key: string | null | undefined,
  feeName: string | null | undefined,
  live: boolean = RESEARCH_SPLIT_LIVE,
): string | null {
  if (!live || key !== "account_research") return null;
  const to = splitLiveCategory(key, feeName, RESEARCH_SPLIT_PREVIEW)?.to;
  return to && RESEARCH_SPLIT_KEYS.has(to) ? to : null;
}

export const SPLIT_CATEGORY_KEYS: ReadonlySet<string> = new Set(Object.keys(SPLIT_CATEGORIES));

/** Where a live-category fee moves under `SPLIT_CATEGORIES`, or null when it stays. Pure. */
export function splitLiveCategory(
  key: string | null | undefined,
  feeName: string | null | undefined,
  table: Readonly<Record<string, SplitCategory>> = SPLIT_CATEGORIES,
): FoldResult | null {
  if (!key) return null;
  const split = table[key];
  if (!split) return null;
  const name = plain(feeName ?? "");
  const hit = [{ to: split.to, name: split.name }, ...(split.also ?? [])].find((rule) => rule.name.test(name));
  return hit ? { to: hit.to, rule: `${key}#split` } : null;
}

/** Bumped when a fold rule changes, so Hamilton's fold step re-reads what it left unplaced. */
// v15: a subordination stays legal process (James, Oct 15); legal process keeps only lien releases in its split.
// v16: the subordination re-file is on (`SUBORDINATION_REFILE_LIVE`, James, Oct 15).
// v17: excess withdrawals and returned mail have their own types (James, Oct 15, #1398), dark until
// `RESEARCH_SPLIT_LIVE` is on: then the paper statement, other lending and e-statement rules file
// there and account research's split moves its excess withdrawal and returned mail fees there.
// Once on, a "return to paper statements" charge is never returned mail: an e-statement one is a
// paper statement fee, and a paper statement one stays there. Off, every rule matches exactly as in
// v16, so the version stays 16 until the switch is on and the fold step re-reads nothing for it.
// v18: International ATM is its own type again (James, Oct 19, #2037): it leaves the retired table,
// and an ATM used abroad filed as the card's foreign transaction fee or the non-network ATM fee
// splits out to it, whether or not the research split is on.
export const FOLD_RULES_VERSION = 18;

/** The retired categories that sat in these families. */
export function retiredKeysInFamilies(families: readonly string[]): string[] {
  return Object.entries(RETIRED_CATEGORIES)
    .filter(([, retired]) => families.includes(retired.family))
    .map(([key]) => key);
}

export function isRetiredCategory(key: string | null | undefined): boolean {
  return !!key && RETIRED_CATEGORY_KEYS.has(key);
}

function plain(text: string): string {
  return text
    .replace(/[‘’ʼ`]/g, "'")
    .replace(/[.…_·•\-–—]{3,}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** Characters of schedule text before a fee's line that count as its section. */
export const FOLD_CONTEXT_CHARS = 200;

/**
 * The schedule text just before a fee's line (its section heading, in a table the row's
 * neighbours), or null when the name is not found in the text. Pure.
 */
export function foldContext(
  text: string | null | undefined,
  feeName: string | null | undefined,
  amount?: number | null,
): string | null {
  if (!text || !feeName) return null;
  const body = plain(text);
  const name = plain(feeName);
  if (name.length < 4) return null;
  const lower = body.toLowerCase();
  const needle = name.toLowerCase();
  let at = lower.indexOf(needle);
  if (at < 0) return null;
  // A name the schedule prints twice ("Regions ATM: ... Balance Inquiry $0.00", "Non-Regions
  // ATM: ... Balance Inquiry $3.00") takes the section of the copy priced at the fee's amount.
  if (amount != null && Number.isFinite(amount)) {
    for (let next = at; next >= 0; next = lower.indexOf(needle, next + 1)) {
      const price = body.slice(next + needle.length, next + needle.length + 60).match(/\$\s?(\d[\d,]*(?:\.\d+)?|\.\d+)/);
      if (price && Math.abs(Number(price[1].replace(/,/g, "")) - amount) < 0.005) {
        at = next;
        break;
      }
    }
  }
  return body.slice(Math.max(0, at - FOLD_CONTEXT_CHARS), at);
}

export interface FoldResult {
  /** The category among the 50, or null when the fee has no home there. */
  to: string | null;
  /** Which rule placed it: `<retired key>#<index>`, or `<retired key>#otherwise`. */
  rule: string;
}

/**
 * Where a fee filed under a retired category goes, by its name and (when known) the
 * schedule text before it. Null for a key that is not retired. Pure.
 */
export function foldRetiredCategory(
  key: string | null | undefined,
  feeName: string | null | undefined,
  context?: string | null,
): FoldResult | null {
  if (!key) return null;
  const retired = RETIRED_CATEGORIES[key];
  if (!retired) return null;
  const name = plain(feeName ?? "");
  const before = context ? plain(context) : null;
  for (const [index, rule] of retired.rules.entries()) {
    if (rule.name && !rule.name.test(name)) continue;
    if (rule.context && !(before && rule.context.test(before))) continue;
    if (rule.contextTest && !(before && rule.contextTest(before))) continue;
    return { to: rule.to, rule: `${key}#${index}` };
  }
  return { to: retired.otherwise, rule: `${key}#otherwise` };
}
