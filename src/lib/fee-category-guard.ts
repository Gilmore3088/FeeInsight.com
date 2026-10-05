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
 */

export type CategoryGuardCode = "name_contradicts" | "name_unsupported";

export type CategoryGuardVerdict =
  | { ok: true }
  | { ok: false; code: CategoryGuardCode; reason: string };

interface CategoryRule {
  /** The fee name must mention one of these to count as this category. */
  include: RegExp;
  /** A fee name matching this describes a different fee, whatever it was filed as. */
  exclude: RegExp;
}

const WIRE_CORRECTIONS = "trace|reversal|recall|amend|investigat|return";

export const CATEGORY_GUARD_RULES: Readonly<Record<string, CategoryRule>> = {
  monthly_maintenance: {
    include: /(maintenance|monthly service|service charge|monthly fee)/i,
    exclude:
      /(savings|money market|club|night deposit|safe deposit|box|annual|dormant|inactive|statement(?! cycle)|\bira\b|certificate|\bcd\b|loan|escheat|clos|research|excess|activity|withdrawal|saver|business|commercial|analysis|\bhsa\b|health|escrow|trust|address|fax|cop(y|ies))/i,
  },
  overdraft: {
    include: /(overdraft|overdrawn|\bod\b|o\/d|paid item|paid nsf|courtesy pay|bounce protection|privilege)/i,
    exclude:
      /(transfer|xfe?r\b|sweep|from (your |eligible |a )?(savings|shares?|loan|loc)\b|to loan|share to share|daily|continu|consecutive|extended|sustained|limit|line of credit|protection plan|\bcap\b|maximum|return|reduced to|not be (charged|assessed)|waive|night dep|notary|counter check|check images?|set ?up|dividend)/i,
  },
  nsf: {
    include:
      /(nsf|insufficient|non[- ]?sufficient|returned item|return(ed)? (check|item|ach|payment|draft)|returned unpaid|unpaid item)/i,
    exclude: /(deposit|\bcap\b|daily max|maximum|\bpaid\b|others|re-?present|credit card|loan|transfer|cover)/i,
  },
  atm_non_network: {
    include: /(atm|allpoint|network machine)/i,
    exclude: /(replace|deposit|statement|card fee|annual|\bpin\b|inquir|denied|declin)/i,
  },
  wire_domestic_outgoing: {
    include: /wire/i,
    exclude: new RegExp(`(incoming|receiv|international|foreign|intl|${WIRE_CORRECTIONS})`, "i"),
  },
  wire_intl_outgoing: {
    include: /wire/i,
    exclude: new RegExp(`(incoming|receiv|${WIRE_CORRECTIONS}|check|deposit|collection)`, "i"),
  },
  wire_domestic_incoming: {
    include: /wire/i,
    exclude: new RegExp(`(outgoing|send|sent|international|foreign|intl|${WIRE_CORRECTIONS})`, "i"),
  },
  stop_payment: {
    include: /stop/i,
    // "Cancel stop payment" removes a stop; "ACH Stop Payment/Cancellation" places one.
    exclude: /(release|cancel\w*\s+(of\s+)?(a\s+|the\s+)?stop|revoc|line of credit|heloc|loan|cashier|official)/i,
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
    exclude: /(check|statement|key|book|expedit|rush|overnight)/i,
  },
  deposited_item_return: {
    include: /(deposit(ed)? (item|check)|return(ed)? deposit|deposit return|chargeback)/i,
    exclude: /(night|safe|box|mobile deposit fee|remote|collection|correction)/i,
  },
};

export const GUARDED_CATEGORIES: readonly string[] = Object.keys(CATEGORY_GUARD_RULES);

/** Bump when the rules change, so Darwin re-evaluates rows an older version rejected. */
export const CATEGORY_GUARD_VERSION = 4;

export function checkFeeCategory(
  canonicalFeeKey: string | null | undefined,
  feeName: string | null | undefined,
): CategoryGuardVerdict {
  const rule = canonicalFeeKey ? CATEGORY_GUARD_RULES[canonicalFeeKey] : undefined;
  if (!rule) return { ok: true };
  const name = (feeName ?? "").trim();
  const excluded = name.match(rule.exclude);
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
