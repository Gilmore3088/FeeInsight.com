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

export type CategoryGuardCode = "name_contradicts" | "name_unsupported" | "rate_as_amount";

/** What a caller knows about the fee besides its name; enables the rate check. */
export interface CategoryGuardContext {
  amount?: number | string | null;
  conditions?: string | null;
}

export type CategoryGuardVerdict =
  | { ok: true }
  | { ok: false; code: CategoryGuardCode; reason: string };

interface CategoryRule {
  /** The fee name must mention one of these to count as this category. */
  include: RegExp;
  /** A fee name matching this describes a different fee, whatever it was filed as. */
  exclude: RegExp;
  /** Words that describe a different fee unless the name also matches `unless`. */
  excludeUnless?: { pattern: RegExp; unless: RegExp };
}

const WIRE_CORRECTIONS = "trace|reversal|recall|amend|investigat|return";
// "Int'l Wire Fee Out" is an international wire; one price for "Domestic & Int'l" stays domestic.
const INTL_ABBREV = String.raw`^(?!.*\bdomestic\b).*\bint['’]l\b`;

export const CATEGORY_GUARD_RULES: Readonly<Record<string, CategoryRule>> = {
  monthly_maintenance: {
    // v10: "Minimum daily balance of $500 required to avoid a $5.00 service fee" names the
    // account's monthly fee by the balance that waives it.
    include: /(maintenance|monthly service|service charge|monthly fee|(minimum|balance)\b.{0,80}\bavoid\b.{0,30}\bservice fee)/i,
    // A per-transaction charge or an earnings-credit note is not the account's monthly fee.
    exclude:
      /(savings|money market|club|night deposit|safe deposit|box|annual|dormant|inactive|statement(?! cycle)|\bira\b|certificate|\bcd\b|loan|escheat|clos|research|excess|activity|withdrawal|saver|business|commercial|analysis|\bhsa\b|health|escrow|trust|address|fax|cop(y|ies)|(pos|pin[- ]based) transaction|for transactions|transaction service charge|earnings credit (is applied|available to offset))/i,
  },
  overdraft: {
    include: /(overdraft|overdrawn|\bod\b|o\/d|paid item|items? paid|paid nsf|courtesy pay|bounce protection|privilege)/i,
    exclude:
      /(transfer|xfe?r\b|sweep|from (your |eligible |a )?(savings|shares?|loan|loc)\b|to loan|share to share|daily|continu|consecutive|extended|sustained|limit|line of credit|protection plan|\bcap\b|maximum|return|reduced to|not be (charged|assessed)|waive|night dep|notary|counter check|check images?|set ?up|dividend|(savings|share|loan|link(ed)?) overdraft protection|overdraft protection ?[-–(]+ ?(savings|loan)|loan overdraft|covered by|per advance|advances? from|annual|collection|accrual|account closed|closed in overdraft|late repayment|\blate (payment|charge|fee)\b|recurring overdraft|every \d+|beginning|threshold|cushion|overdrawn by|overdraws your account by|with approval|options|\b\d+ ?x ?\d+\b|\bbox\b|outgoing|international|\bwires?\b|check printing|annual fee|or less\b)/i,
  },
  nsf: {
    include:
      /(nsf|insufficient|non[- ]?sufficient|returned item|return(ed)? (check|item|ach|payment|draft)|returned unpaid|unpaid item)/i,
    exclude:
      /(deposit|\bcap\b|daily max|maximum|\bpaid\b|others|re-?present|credit card|loan|transfer|cover|3rd party|third[- ]party|foreign|drawn on (an ?)?other|other inst|self[- ]to[- ]self|returned payment|payment returned|nsf payment|visa payment|re-?activation|card capture|converted|cancell?ation|returned ach origination|return ach origination|ach origination nsf|nsf ach origination|debit origination|reg d limit|\(reg d\)|sent for collection|presented multiple times|in the amount of|\bbox\b|check printing)/i,
  },
  // The surcharge a bank charges other banks' customers at its own ATMs ("Non-Member ATM
  // Fee", "Non-OMNI Card used at OMNI ATM") and use of its own or in-network ATMs are not
  // what its own customer pays at another network's ATM.
  // A deposit or an inquiry is its own fee, except in one row that also prices withdrawals or
  // transfers at an ATM the bank does not own ("Deposits/Withdrawals at an ATM we do not own
  // or operate", "Inquiries/Transfers at an ATM we do not own"; Pathfinder, Oct 7).
  atm_non_network: {
    include: /(atm|allpoint|network machine)/i,
    excludeUnless: {
      pattern: /(deposit|inquir)/i,
      unless:
        /^(?=.*(\b(deposit|inquir)\w*\s*(\/|&|\band\b|\bor\b)\s*(withdraw|w\/d|transfer|transaction)|\b(withdraw|w\/d|transfer|transaction)\w*\s*(\/|&|\band\b|\bor\b)\s*(balance\s+)?(deposit|inquir)))(?=.*(do(es)?\s+not\s+(own|operate)|don['’]t\s+(own|operate)|not\s+owned|\bnon[- ]?[\w.]+([- ]owned)?\s+atms?\b|\bnon[- ]?proprietary\s+atms?\b|\bforeign\s+atms?\b|\batms?\s+foreign\b|\b(all\s+)?other\s+networks?\b|\bother\s+(banks?|institutions?|financial\s+institutions?)['’]?\s+atms?\b|out[- ]of[- ](our\s+)?network|not\s+(in|within)\s+(our\s+)?network))/i,
    },
    exclude:
      /(replace|statement|card fee|annual|\bpin\b|denied|declin|between accounts|non[- ]?members?|\bnon[- ]?(?!owned\b)[\w.]+ (debit |atm )?cards?|non[- ]proprietary card|foreign cards? used|(?<!free )\bat our atm|(?<!of )\bour network|\bin[- ]network|(?<!\bnon[- ]?)\b(?!(non|other|foreign)\b)\w+[- ]owned atm)/i,
  },
  wire_domestic_outgoing: {
    include: /wire/i,
    exclude: new RegExp(`(incoming|receiv|international|foreign|intl|${INTL_ABBREV}|${WIRE_CORRECTIONS})`, "i"),
  },
  wire_intl_outgoing: {
    include: /wire/i,
    exclude: new RegExp(`(incoming|receiv|${WIRE_CORRECTIONS}|check|deposit|collection)`, "i"),
  },
  wire_domestic_incoming: {
    include: /wire/i,
    exclude: new RegExp(`(outgoing|send|sent|international|foreign|intl|${INTL_ABBREV}|${WIRE_CORRECTIONS})`, "i"),
  },
  stop_payment: {
    include: /stop/i,
    // "Cancel stop payment" and "Stop Payment Removal" remove a stop; "ACH Stop
    // Payment/Cancellation" and "Stop Payments (to put on or remove)" place one.
    exclude:
      /(release|(cancel\w*|remov(e|al|ing))\s+(of\s+)?(a\s+|the\s+)?stop|stop\s+payments?\s+(fee\s+)?\(?removal|revoc|line of credit|heloc|loan|cashier|official)/i,
  },
  cashiers_check: {
    include: /(cashier|official check|bank check|bank draft|corporate check|treasurer|certified|teller'?s? check)/i,
    exclude: /(cop(y|ies)|stop|replace|lost|research)/i,
  },
  od_protection_transfer: {
    include: /(overdraft|\bod\b|\bodp\b|o\/d|sweep|protection)/i,
    exclude:
      /(balance transfer|wire|telephone|phone|online|internal|\bach\b|external|book|set-?up|excess|money market)/i,
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
    exclude: /(check(?!\s?card)|statement|key|book|expedit|rush|overnight|gift|^(?!.*\bcards?\b[^|]{0,20}replace)(?!.*replace[^|]{0,20}\bcards?\b).*\bpins?\b|liabilit|closed account)/i,
  },
  // The fee charged when a balance falls below the minimum, not the minimum itself. "Minimum
  // balance to open", "to earn APY" and "to avoid the fee" lines state a balance, so their
  // amount is not a fee; "...required to avoid a minimum balance fee of" ends on the fee.
  minimum_balance: {
    include: /(minimum|min\.?\b|low balance|below|falls|drops|less than|under)/i,
    exclude:
      /^(?!.*\b(fee|charge) of\s*$).*(to open|to obtain|to earn|\bapy\b|annual percentage yield|requirements?\b(?! fee)|balance required|required to|you must deposit|to avoid)/i,
  },
  // Buying a gift or prepaid card. Its reload, replacement and inactivity fees are other fees.
  gift_card_purchase: {
    include: /(gift|prepaid|reloadable|travel card)/i,
    exclude: /(inactiv|dormant|monthly|non-?use|replac|lost|stolen|reload(?!able)|maintenance)/i,
  },
  // A chargeback on a deposited item or a loan is not a card dispute.
  card_dispute: {
    include: /(dispute|charge-?back|charged back)/i,
    exclude: /(charge-?back (on )?(loan|deposit)|charge-?back (items?|message)\b|return\/charge-?back)/i,
  },
  deposited_item_return: {
    include: /(deposit(ed)? (item|check|draft)|return(ed)? deposit|deposit return|charge[- ]?backs?\b)/i,
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
  card_foreign_txn: {
    include: /(foreign|international|currency|exchange|cross[- ]border|\bisa\b)/i,
    exclude:
      /((?<!\/\s?)\batm'?s?\b[^|\/]{0,12}\bforeign transactions?|\bwires?\b|low balance|cash exchange|currency (cash|order|ordered|exchange|purchase)|foreign currency (cash|order|exchange|purchase|delivery)|currency or checks?|check collection|\bmany\b|domestic)/i,
  },
  // Knox v26 folded collection items and foreign checks into check cashing (James, Oct 7
  // 2026). A collection fee on a charged-off or past-due account, or a collection phone
  // call, is debt collection; every other name passes.
  check_cashing: {
    include: /\S/,
    exclude: /(charged[- ]?off|past[- ]due|delinquen|\bcalls?\b)/i,
  },
  // A credit report pulled to open a deposit account or membership is not a loan fee.
  loan_origination: {
    include: /\S/,
    exclude: /\bopen(ing)? (an |a |new |your )?(account|membership)\b/i,
  },
  night_deposit: {
    include: /(night|depository|after[- ]hours|drop box)/i,
    exclude: /^(?!.*(lost|replac|per month|monthly|annual|rental)).*(\bbags?\b|zipper|pouch|wrapper|strap)/i,
  },
};

export const GUARDED_CATEGORIES: readonly string[] = Object.keys(CATEGORY_GUARD_RULES);

/** Bump when the rules change, so Darwin re-evaluates rows an older version rejected. */
export const CATEGORY_GUARD_VERSION = 16;

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
    when: /(transfer|xfe?r\b|sweep|from (your |a |linked |eligible )?(savings|shares?|account|loan|line))/i,
  },
  { from: "nsf", to: "od_protection_transfer", when: /(transfer|xfe?r\b|sweep)/i },
  { from: "nsf", to: "overdraft", when: /(paid nsf|nsf[- ]paid|items? paid)/i },
  { from: "nsf", to: "deposited_item_return", when: /deposit/i },
  { from: "wire_domestic_outgoing", to: "wire_intl_outgoing", when: /(international|foreign|intl|\bint['’]l\b)/i, unless: /domestic/i },
  { from: "overdraft", to: "late_payment", when: /\blate (payment|charge|fee)\b/i },
  { from: "deposited_item_return", to: "card_dispute", when: /((\bcards?\b|visa)[^|]{0,25}charge[- ]?back|charge[- ]?back[^|]{0,25}(\bcards?\b|dispute))/i },
  { from: "atm_non_network", to: "card_replacement", when: /(replace|reissue|lost|stolen)/i, unless: /\bpins?\b/i },
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
): string | null {
  if (!canonicalFeeKey) return null;
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

export function checkFeeCategory(
  canonicalFeeKey: string | null | undefined,
  feeName: string | null | undefined,
  context?: CategoryGuardContext,
): CategoryGuardVerdict {
  const rule = canonicalFeeKey ? CATEGORY_GUARD_RULES[canonicalFeeKey] : undefined;
  if (!canonicalFeeKey || !rule) return { ok: true };
  const name = plainQuotes(feeName ?? "").trim();
  const rate = statesRate(canonicalFeeKey, name, context);
  if (rate) {
    return {
      ok: false,
      code: "rate_as_amount",
      reason: `"${name}" states a rate ("${rate}"), so its dollar amount is not the ${canonicalFeeKey} fee`,
    };
  }
  const softExcluded = rule.excludeUnless && !rule.excludeUnless.unless.test(name) ? name.match(rule.excludeUnless.pattern) : null;
  const excluded = name.match(rule.exclude) ?? softExcluded;
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
  return { ok: true };
}
