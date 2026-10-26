/**
 * A $0 that is one account tier's perk, not the bank's price (#1397). One large bank's live overdraft, NSF,
 * stop payment and wire fees all read $0 from one document, "The Example Premium Account Schedule
 * of Fees" (a private-banking account, $30 a month): every fee is waived for that tier, while
 * the bank's standard schedule charges $35 an overdraft and $30 a stop payment. A $0 published from
 * such a schedule, or named for such an account ("BankOn Checking Account Overdraft Fee $0"),
 * reads as the bank's own price on its profile and in peer comparisons.
 *
 * Only $0 is refused: a priced row on a premium schedule (the account's own $30 fee) is real.
 * A general schedule that lists a premium account among others is not a tier schedule: only its
 * address and its title (the first line, before any figure) are read. Pure.
 *
 * Rule v2 (2026-10-26, #1397): a tier's own document is often named for what it is rather than
 * "fees": a truth-in-savings disclosure ("Bank-On-Checking-TIS.pdf"), a terms and charges
 * disclosure ("premier_tcs.pdf") or a summary of fees ("BankOn_Summary_of_Fees.pdf"). Those
 * addresses now count. A file named for a premium account's "package" does not: one bank's
 * "PREMIUM-CHECKING-PACKAGE" PDF carries its general pricing guide for every account. And a $0 on a
 * tier's schedule stays when the schedule says the bank itself does not charge that fee ("The Bank
 * does not charge NSF fees"): that is every account's price, not the tier's perk.
 */
export const TIER_PERK_RULE_VERSION = 2;
const TIER_WORDS = "premium|premier|private|platinum|prestige|preferred|relationship|wealth|bank[\\s_-]?on";
const TIER_QUALIFIERS = "client|banking|account|checking|certified|services";
/**
 * An address naming a tier's own fee page: "/truth-in-savings/premium-account-fees",
 * "/private-banking/fees", "/sites/wealth/fee_schedule.pdf", "/bank-on-checking-tis.pdf",
 * "/premier_tcs.pdf", "/BankOn_Summary_of_Fees.pdf". Also read by Hamilton's
 * product-page conflict check in SQL (`TIER_PATH_SQL`), so it uses only syntax both engines share.
 */
const TIER_PATH_SOURCE = `(^|[/_-])(${TIER_WORDS})([/_-](${TIER_QUALIFIERS}))*[/_-]?(account[/_-])?(fees?|schedule|disclosures?|tis|tcs|terms|summary[/_-]of[/_-]fees)([^a-z]|$)`;
const TIER_PATH = new RegExp(TIER_PATH_SOURCE, "i");
/** A title naming a tier's own schedule: "The Example Premium Account Schedule of Fees", "Private Banking Fee Schedule". */
const TIER_TITLE = new RegExp(`\\b(?:${TIER_WORDS})\\b(?:\\s+(?:${TIER_QUALIFIERS}))*\\s+(?:schedule|fee schedule|fees|rate and fee schedule)\\b`, "i");
/** A fee named for a tier's account: "BankOn Checking Account Overdraft Fee", "Private Client Stop Payment". */
const TIER_NAME_WORDS = `(${TIER_WORDS})\\s+(client|banking|checking|account|plus)`;
const TIER_NAME = new RegExp(`\\b${TIER_NAME_WORDS}\\b`, "i");

/** Postgres forms (`~*`) of the address and name tests, for Hamilton's product-page conflict check. */
export const TIER_PATH_SQL = TIER_PATH_SOURCE;
export const TIER_NAME_SQL = `\\y${TIER_NAME_WORDS}\\y`;
/** The tier words alone, for a product page address ("/personal/checking/bankon"). */
export const TIER_WORDS_SQL = TIER_WORDS;

function pathOf(url: string | null | undefined): string {
  if (!url) return "";
  const path = url.replace(/^[a-z]+:\/\/[^/]+/i, "");
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/**
 * The document's title: its first non-empty line, cut at the first figure. Only the first line,
 * since a general schedule's second line is often a section heading ("Preferred Checking Fees");
 * cut at a figure, since PDF text often runs the title into the first row ("... Schedule of Fees
 * Monthly fee $30").
 */
function titleOf(text: string | null | undefined): string {
  const first = (text ?? "").split("\n").map((line) => line.trim()).find(Boolean) ?? "";
  const figure = first.search(/[$\d]/);
  return figure < 0 ? first : first.slice(0, figure);
}

/** True when the document is one account tier's own fee schedule. */
export function isTierSchedule(url: string | null | undefined, text: string | null | undefined): boolean {
  return TIER_PATH.test(pathOf(url)) || TIER_TITLE.test(titleOf(text));
}

/**
 * A clause where the bank says it charges no such fee at all: "The Bank does not charge NSF fees",
 * "We do not charge overdraft fees". Not one naming whom it spares ("for Premier customers"), which
 * is the tier's perk again, nor one with a figure or a condition ("on items of $5 or less", "for the
 * first two", "if you keep $500"), which is a waiver, not the bank's price (review of #2744).
 */
const BANK_NO_CHARGE = /\b(?:the bank|we)\s+(?:does|do)\s+not\s+(?:charge|assess|impose)\s+([^.\n]{1,80})/gi;
const NAMES_WHOM = new RegExp(`\\b(?:${TIER_WORDS}|customers?|clients?|members?|account ?holders?)\\b`, "i");
/** A clause with a figure or a condition ("on items of $5 or less", "the first two", "if you keep") is not "none at all". */
const CONDITIONAL_CLAUSE = /[$\d]|\b(?:if|unless|when|while|until|after|thereafter|first|on items?|or less|or more|up to|below|above|under|over|except|provided|waived)\b/i;
const NAME_FILLER = new Set(["fee", "fees", "the", "for", "each", "per", "item", "items", "and", "charge", "charges", "service"]);

function nameWords(feeName: string): string[] {
  return (feeName.toLowerCase().match(/[a-z]{3,}/g) ?? []).filter((word) => !NAME_FILLER.has(word));
}

/** True when the text says the bank charges none of this fee, for any account. */
export function bankChargesNone(text: string | null | undefined, feeName: string | null | undefined): boolean {
  const words = nameWords(feeName ?? "");
  if (!text || words.length === 0) return false;
  for (const match of text.matchAll(BANK_NO_CHARGE)) {
    const clause = match[1].toLowerCase();
    if (NAMES_WHOM.test(clause) || CONDITIONAL_CLAUSE.test(clause)) continue;
    // A plural on either side still names the fee: "payment" and "payments", "atm" and "ATMs".
    if (words.some((word) => new RegExp(`\\b${word.replace(/s$/, "")}s?\\b`).test(clause))) return true;
  }
  return false;
}

/**
 * The account's own price: a fee named for the account here ("Premier Checking", monthly
 * maintenance, "NONE (with no minimum balance or other requirements)") is that account's real
 * price, not a perk the account grants on another fee (#1574).
 */
const ACCOUNT_OWN_KEYS = new Set(["monthly_maintenance", "minimum_balance"]);

/**
 * True when a $0 fee is a tier's perk: read from a tier's own schedule, or named for a tier's
 * account. The name test is skipped for the account's own price (`ACCOUNT_OWN_KEYS`) when the
 * category is known; the schedule test still applies.
 */
export function tierPerkZero(
  amount: number | null,
  feeName: string | null | undefined,
  url: string | null | undefined,
  text: string | null | undefined,
  canonicalFeeKey?: string | null,
): boolean {
  if (amount == null || Math.abs(amount) >= 0.005) return false;
  const accountOwn = canonicalFeeKey != null && ACCOUNT_OWN_KEYS.has(canonicalFeeKey);
  if (!accountOwn && TIER_NAME.test(feeName ?? "")) return true;
  return isTierSchedule(url, text) && !bankChargesNone(text, feeName);
}
