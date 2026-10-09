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

/** A fold rule: the fee goes to `to` (null: no home in the 50) when its text matches. */
interface FoldRule {
  to: string | null;
  /** Tested against the fee's name. */
  name?: RegExp;
  /** Tested against the schedule text just before the fee's line, when it is known. */
  context?: RegExp;
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
  // A returned e-statement is returned mail; a copy is a copy fee; a paper-and-electronic
  // charge is a paper statement; "Bill Pay (w/o ... e-statement)" is bill pay. A fee for the
  // e-statement itself, a free e-statement, and the waiver wording that names e-statements
  // have no home.
  estatement_fee: {
    family: "Account Maintenance",
    rules: [
      { to: "account_research", name: /\breturn(?:ed)?\b|\bundeliverable\b|\b(?:incorrect|bad|invalid|wrong) e-?mail\b/i },
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
  // Using an ATM abroad and using a card abroad are one type, International ATM & Card (James,
  // Oct 8: Foreign Transaction gave up its spot). The survivor keeps the card_foreign_txn key,
  // which holds the rates and the spotlight guide. A line priced for any domestic ATM, or for
  // domestic and international ATMs together, is the network ATM fee ("ATMs inside United States
  // & internationally" $3 under "Not at North Shore Bank or MoneyPass network"). A reimbursement
  // cap ("up to $10.00 per transaction, ... ATMs outside U.S. excluded") and a bank's own partner
  // network ("Allpoint ATM Transactions" $0 at SoFi) have no home (Oct 9 review of the last 4).
  atm_international: {
    family: "ATM & Card",
    rules: [
      { to: null, name: /outside (?:the )?u\.?s\.?a?\.? excluded|^allpoint\b/i },
      { to: "atm_non_network", name: /\bnon[- ]?international\b|\binside (?:the )?united states\b/i },
    ],
    otherwise: "card_foreign_txn",
  },
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

/** A mortgage, lien or loan subordination; a wire line under a "Subordination Request" heading is not one. */
export const SUBORDINATION = /^(?![\s\S]*subordination request:\s*(?:incoming|outgoing))[\s\S]*\bsubordinat/i;

/** A copy of an item, not the item. */
export const ITEM_COPY = /\b(?:photo ?)?cop(?:y|ies)\b/i;

/** A subordination or a lien release filed as legal process. */
const LENDING_LEGAL = new RegExp(String.raw`${SUBORDINATION.source}|\blien release`, "i");

/** A night depository's key, bag or service. */
const NIGHT_DEPOSIT = /\bnight (?:deposit|drop)/i;

/** A late charge on safe deposit box rent. */
const BOX_RENT = /\bbox rent|\bsafe(?:ty)? deposit box/i;

/** An IRA moved out to another institution ("IRA Transfer (outgoing)", "IRA Transfer Closeout"). */
const IRA_TRANSFER_OUT = /^(?![\s\S]*\bincoming\b)(?=[\s\S]*\bira\b)[\s\S]*\btransfer/i;

/** Buying or reloading a prepaid card ("Reloadable ATM/Debit Card – Reload Fee"), not using one at an ATM. */
const PREPAID_BUY_OR_RELOAD =
  /^(?=[\s\S]*\b(?:pre-?paid|reloadable)\b)(?![\s\S]*\b(?:withdrawals?|inquiry|inquiries)\b)[\s\S]*\b(?:purchase|reload)\b/i;

/** A statement mailed back undelivered ("Returned Mailed Statement"). */
const RETURNED_STATEMENT = /\breturned\b[\s\S]*\b(?:mail|statement)/i;

interface SplitCategory {
  to: string;
  name: RegExp;
  /** A cheap SQL pre-filter (case-insensitive regex) for the rows the rule might move. */
  sqlPattern: string;
}

/**
 * Live categories part of which moved to a new type. James, Oct 8 2026: collection items get
 * their own type ("Own type"); Knox v26 had filed them under check cashing, where their $20
 * median sat beside check cashing's $5. A fee the rule does not match stays where it is.
 */
export const SPLIT_CATEGORIES: Readonly<Record<string, SplitCategory>> = {
  check_cashing: { to: "collection_item", name: COLLECTION_ITEM, sqlPattern: "collection|foreign|canadian|international|non[- ]?u\\.?s" },
  // A mortgage or lien subordination is a lending service (median $150), not legal process like
  // a levy or garnishment (median $50). Wire lines under a "Subordination Request" heading stay.
  // A lien release is other lending too (James, Oct 8: Lien Release gave up its spot).
  legal_process: { to: "other_lending_fee", name: LENDING_LEGAL, sqlPattern: "subordinat|lien release" },
  // A copy of a money order or cashier's check is a check copy, not the money order itself.
  money_order: { to: "check_image", name: ITEM_COPY, sqlPattern: "cop(y|ies)" },
  // A night deposit or night drop key is the night depository's, not a safe deposit box's.
  safe_deposit_box: { to: "night_deposit", name: NIGHT_DEPOSIT, sqlPattern: "night (deposit|drop)" },
  // A late charge on box rent is a safe deposit box fee, not a loan's late payment.
  late_payment: { to: "safe_deposit_box", name: BOX_RENT, sqlPattern: "box rent|deposit box" },
  // Moving an IRA to another institution closes it here; it is not account research.
  account_research: { to: "ira_termination", name: IRA_TRANSFER_OUT, sqlPattern: "\\mira\\M" },
  // Buying or reloading a prepaid card is the prepaid card's fee; its ATM use stays here.
  atm_non_network: { to: "gift_card_purchase", name: PREPAID_BUY_OR_RELOAD, sqlPattern: "prepaid|reload" },
  // A statement mailed back undelivered is returned mail, which account research holds.
  paper_statement: { to: "account_research", name: RETURNED_STATEMENT, sqlPattern: "return" },
};

export const SPLIT_CATEGORY_KEYS: ReadonlySet<string> = new Set(Object.keys(SPLIT_CATEGORIES));

/** Where a live-category fee moves under `SPLIT_CATEGORIES`, or null when it stays. Pure. */
export function splitLiveCategory(key: string | null | undefined, feeName: string | null | undefined): FoldResult | null {
  if (!key) return null;
  const split = SPLIT_CATEGORIES[key];
  if (!split || !split.name.test(plain(feeName ?? ""))) return null;
  return { to: split.to, rule: `${key}#split` };
}

/** Bumped when a fold rule changes, so Hamilton's fold step re-reads what it left unplaced. */
export const FOLD_RULES_VERSION = 8;

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
export function foldContext(text: string | null | undefined, feeName: string | null | undefined): string | null {
  if (!text || !feeName) return null;
  const body = plain(text);
  const name = plain(feeName);
  if (name.length < 4) return null;
  const at = body.toLowerCase().indexOf(name.toLowerCase());
  if (at < 0) return null;
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
    return { to: rule.to, rule: `${key}#${index}` };
  }
  return { to: retired.otherwise, rule: `${key}#otherwise` };
}
