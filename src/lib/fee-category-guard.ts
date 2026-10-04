/**
 * Category guard: does a fee line's own name and amount support the canonical
 * category it was filed under?
 *
 * The catalog's canonical_fee_key is assigned upstream and is sometimes wrong (an
 * "ATM withdrawal" filed as overdraft, a wire trace filed as an outgoing wire, a
 * savings account's monthly fee filed as checking maintenance). Darwin uses this guard
 * before verifying a row, Hamilton before publishing one, and the Hamilton
 * `category-guard` repair step to roll back live rows that fail it.
 *
 * Only the categories below are guarded; every other key passes. The name patterns
 * start from the report studio's rules (Reports/studio/pull-data.sql, rules v2) so the
 * reports, the catalog and the public pages agree on what counts as each fee. The
 * amount bands are wider than the reports' comparison bands: the catalog keeps real
 * $0 prices and expensive-but-genuine lines; the guard only removes the implausible.
 */

export type CategoryGuardCode = "name_contradicts" | "name_unsupported" | "amount_out_of_range";

export type CategoryGuardVerdict =
  | { ok: true }
  | { ok: false; code: CategoryGuardCode; reason: string };

interface CategoryRule {
  /** The fee name must mention one of these to count as this category. */
  include: RegExp;
  /** A fee name matching this describes a different fee, whatever it was filed as. */
  exclude: RegExp;
  /** Plausible per-item price band for a positive amount, in dollars. */
  min: number;
  max: number;
  /** $0 is a real price for this category (e.g. free checking, free incoming wires). */
  allowZero: boolean;
}

const WIRE_CORRECTIONS = "trace|reversal|recall|amend|investigat|return";

export const CATEGORY_GUARD_RULES: Readonly<Record<string, CategoryRule>> = {
  monthly_maintenance: {
    include: /(maintenance|monthly service|service charge|monthly fee)/i,
    exclude:
      /(savings|money market|club|night deposit|safe deposit|box|annual|dormant|inactive|statement(?! cycle)|\bira\b|certificate|\bcd\b|loan|escheat|clos|research|excess|activity|withdrawal|saver|business|commercial|analysis|\bhsa\b|health|escrow|trust|address|fax|cop(y|ies))/i,
    min: 0,
    max: 30,
    allowZero: true,
  },
  overdraft: {
    include: /(overdraft|overdrawn|\bod\b|o\/d|paid item|paid nsf|courtesy pay|bounce protection|privilege)/i,
    exclude:
      /(transfer|sweep|daily|continuous|extended|sustained|limit|line of credit|protection plan|\bcap\b|maximum|return)/i,
    min: 5,
    max: 45,
    allowZero: true,
  },
  nsf: {
    include:
      /(nsf|insufficient|non[- ]?sufficient|returned item|return(ed)? (check|item|ach|payment|draft)|returned unpaid|unpaid item)/i,
    exclude: /(deposit|\bcap\b|daily max|maximum|\bpaid\b|others|re-?present|credit card|loan|transfer|cover)/i,
    min: 5,
    max: 45,
    allowZero: true,
  },
  atm_non_network: {
    include: /(atm|allpoint|network machine)/i,
    exclude: /(replace|deposit|statement|card fee|annual|\bpin\b|inquir|denied|declin)/i,
    min: 0.5,
    max: 10,
    allowZero: false,
  },
  wire_domestic_outgoing: {
    include: /wire/i,
    exclude: new RegExp(`(incoming|receiv|international|foreign|intl|${WIRE_CORRECTIONS})`, "i"),
    min: 5,
    max: 50,
    allowZero: false,
  },
  wire_intl_outgoing: {
    include: /wire/i,
    exclude: new RegExp(`(incoming|receiv|${WIRE_CORRECTIONS}|check|deposit|collection)`, "i"),
    min: 15,
    max: 100,
    allowZero: false,
  },
  wire_domestic_incoming: {
    include: /wire/i,
    exclude: new RegExp(`(outgoing|send|sent|international|foreign|intl|${WIRE_CORRECTIONS})`, "i"),
    min: 0,
    max: 30,
    allowZero: true,
  },
  stop_payment: {
    include: /stop/i,
    exclude: /(release|cancel|revoc|line of credit|heloc|loan|cashier|official)/i,
    min: 10,
    max: 50,
    allowZero: false,
  },
  cashiers_check: {
    include: /(cashier|official check|bank check|bank draft|corporate check|treasurer|certified|teller'?s? check)/i,
    exclude: /(cop(y|ies)|stop|replace|lost|research)/i,
    min: 1,
    max: 25,
    allowZero: false,
  },
  od_protection_transfer: {
    include: /(overdraft|\bod\b|\bodp\b|o\/d|sweep|protection)/i,
    exclude:
      /(balance transfer|wire|telephone|phone|online|internal|\bach\b|external|book|set-?up|excess|money market)/i,
    min: 1,
    max: 20,
    allowZero: true,
  },
  paper_statement: {
    include: /statement/i,
    exclude: /(cop(y|ies)|address|research|re-?print|duplicate|interim|special|photo|image|e-?statement)/i,
    min: 0.5,
    max: 10,
    allowZero: false,
  },
  card_replacement: {
    include: /(replace|reissue|lost|stolen|duplicate card|card \(duplicate\)|card reorder)/i,
    exclude: /(check|statement|key|book|expedit|rush|overnight)/i,
    min: 1,
    max: 30,
    allowZero: true,
  },
  deposited_item_return: {
    include: /(deposit(ed)? (item|check)|return(ed)? deposit|deposit return|chargeback)/i,
    exclude: /(night|safe|box|mobile deposit fee|remote|collection|correction)/i,
    min: 3,
    max: 40,
    allowZero: false,
  },
};

export const GUARDED_CATEGORIES: readonly string[] = Object.keys(CATEGORY_GUARD_RULES);

/** Bump when the rules change, so Darwin re-evaluates rows an older version rejected. */
export const CATEGORY_GUARD_VERSION = 1;

function formatAmount(amount: number): string {
  return `$${amount.toFixed(2)}`;
}

export function checkFeeCategory(
  canonicalFeeKey: string | null | undefined,
  feeName: string | null | undefined,
  amount: number | string | null | undefined,
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
  if (amount == null || amount === "") return { ok: true };
  const value = Number(amount);
  if (!Number.isFinite(value)) return { ok: true };
  if (value === 0 ? !rule.allowZero : value < rule.min || value > rule.max) {
    return {
      ok: false,
      code: "amount_out_of_range",
      reason: `${formatAmount(value)} is outside the ${formatAmount(rule.min)}–${formatAmount(rule.max)} range for ${canonicalFeeKey}`,
    };
  }
  return { ok: true };
}
