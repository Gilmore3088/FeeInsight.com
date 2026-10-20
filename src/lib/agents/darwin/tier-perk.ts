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
 */
const TIER_WORDS = "premium|premier|private|platinum|prestige|preferred|relationship|wealth|bank[\\s_-]?on";
const TIER_QUALIFIERS = "client|banking|account|checking|certified|services";
/**
 * An address naming a tier's own fee page: "/truth-in-savings/premium-account-fees",
 * "/private-banking/fees", "/sites/wealth/fee_schedule.pdf". Also read by Hamilton's
 * product-page conflict check in SQL (`TIER_PATH_SQL`), so it uses only syntax both engines share.
 */
const TIER_PATH_SOURCE = `(^|[/_-])(${TIER_WORDS})([/_-](${TIER_QUALIFIERS}))*[/_-]?(account[/_-])?(fees?|schedule|disclosures?)([^a-z]|$)`;
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
  return (!accountOwn && TIER_NAME.test(feeName ?? "")) || isTierSchedule(url, text);
}
