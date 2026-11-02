import { checkFeeAgainstSource, sourceLines } from "@/lib/custom-report/source-check";

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
 *
 * Rule v3 (2026-11-02, #1397, PR #2744's sample): a $0 on a tier's schedule is that tier's perk
 * only when the bank's general schedule charges for the fee. The recheck compares it with the
 * institution's other stored documents (`generalSchedulePrice`): when a general schedule prints the
 * same $0 ("Online Banking/Bill Payment | No Fee" on Main Street Bank's Retail Summary of Fees, beside
 * the Bank On summary's same line), the $0 is every account's price and stays; when no general
 * schedule prices the fee (HSBC, whose only stored text is its Premier terms and charges), nothing
 * shows what the tier is spared, so nothing is taken down.
 */
export const TIER_PERK_RULE_VERSION = 3;
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
  return tierPerkZeroBy(amount, feeName, url, text, canonicalFeeKey) != null;
}

/**
 * Which test makes a $0 a tier's perk: `name` (named for a tier's account) or `schedule` (read from
 * a tier's own schedule), or null. The recheck reads a `schedule` perk against the bank's general
 * schedule before it fails it (`generalSchedulePrice`, rule v3). Pure.
 */
export function tierPerkZeroBy(
  amount: number | null,
  feeName: string | null | undefined,
  url: string | null | undefined,
  text: string | null | undefined,
  canonicalFeeKey?: string | null,
): "name" | "schedule" | null {
  if (amount == null || Math.abs(amount) >= 0.005) return null;
  const accountOwn = canonicalFeeKey != null && ACCOUNT_OWN_KEYS.has(canonicalFeeKey);
  if (!accountOwn && TIER_NAME.test(feeName ?? "")) return "name";
  return isTierSchedule(url, text) && !bankChargesNone(text, feeName) ? "schedule" : null;
}

/** One of the institution's other stored documents, as the recheck reads it for `generalSchedulePrice`. */
export interface GeneralScheduleText {
  sourceDocumentId: number;
  sourceUrl: string | null;
  text: string;
}

export type GeneralSchedulePrice =
  | { kind: "same_zero"; sourceDocumentId: number; line: string }
  | { kind: "charged"; sourceDocumentId: number; amount: number; line: string }
  | { kind: "none" };

/** A $0 printed as words or figures right after the fee's name: "No Fee", "Free", "None", "N/C", "$0.00". */
const ZERO_PRICE = /^(?:no\s+(?:fee|charge)s?\b|free\b|none\b|n\/c\b|\$\s?0(?:\.00)?(?![\d.,])|0\.00(?![\d.,]))/i;
/** A price right after the name: "$32.00", "32 00" (a PDF's dropped decimal point), "6.84", "$5". */
const AFTER_NAME_PRICE = /^\$?\s?(\d{1,3}(?:,\d{3})+|\d+)(?:(?:\.|\s)(\d{2}))?(?![\d%])/;
/** What may sit between the name and its price: cell bars, leaders, dashes and one parenthetical. */
const NAME_TO_PRICE = /^(?:[\s|.:…\-–—_]*\([^()]{0,60}\))?[\s|.:…\-–—_]*/;

/**
 * A price cell whose decimal point the PDF dropped, with no dollar sign: Main Street Bank's Retail
 * Summary prints "- Money Order | 3 00" and "Non-sufficient Funds | 32 00". The shared check's own
 * repair (`withDroppedDecimalPoints`) reads only "$3 00", so the cell is written "$3.00" before the
 * general schedule is read. Only a whole cell after a bar, ending the cell or the line.
 */
const CELL_PRICE_DROPPED_POINT = /(\|\s*)\$?(\d{1,4}) (\d{2})(?=\s*(?:\||\/|$))/gm;
function withCellPricePoints(text: string): string {
  return text.replace(CELL_PRICE_DROPPED_POINT, "$1$$$2.$3");
}

/** The prices a text prints right after the fee's own name, line by line. Pure. */
function pricesAfterName(text: string, feeName: string): number[] {
  const name = feeName.replace(/\s+/g, " ").trim().toLowerCase();
  if (name.length < 3) return [];
  const prices: number[] = [];
  for (const line of sourceLines(text)) {
    const lower = line.toLowerCase();
    for (let at = lower.indexOf(name); at >= 0; at = lower.indexOf(name, at + 1)) {
      // The name must start and end on a word edge ("Stop Payment", not "Stop Payments Online").
      if (at > 0 && /[a-z0-9]/.test(lower[at - 1])) continue;
      if (/[a-z0-9]/.test(lower[at + name.length] ?? "")) continue;
      const rest = line.slice(at + name.length).replace(NAME_TO_PRICE, "");
      if (ZERO_PRICE.test(rest)) { prices.push(0); continue; }
      const price = AFTER_NAME_PRICE.exec(rest);
      if (price) prices.push(Number(`${price[1].replace(/,/g, "")}.${price[2] ?? "00"}`));
    }
  }
  return prices;
}

/**
 * Rule v3 (#1397): what the bank's general schedules print for a fee a tier's schedule shows at $0.
 * `texts` are the institution's other stored documents that are not tier schedules. Each candidate
 * price is one printed right after the fee's own name and confirmed by the shared source check
 * (`checkFeeAgainstSource`) on that text. `same_zero` when any general schedule prints the same $0
 * (every account's price, so the $0 stays); else `charged` with the first confirmed price; else `none`
 * (no general price to compare against, so nothing comes down). Pure.
 */
export function generalSchedulePrice(
  texts: readonly GeneralScheduleText[],
  feeName: string | null | undefined,
  canonicalFeeKey?: string | null,
): GeneralSchedulePrice {
  const name = (feeName ?? "").trim();
  if (!name) return { kind: "none" };
  let charged: GeneralSchedulePrice = { kind: "none" };
  for (const general of texts) {
    if (isTierSchedule(general.sourceUrl, general.text)) continue;
    const text = withCellPricePoints(general.text);
    for (const amount of new Set(pricesAfterName(text, name))) {
      const traced = checkFeeAgainstSource(text, name, amount, ".", canonicalFeeKey);
      if (!traced.ok) continue;
      if (amount === 0) return { kind: "same_zero", sourceDocumentId: general.sourceDocumentId, line: traced.sourceLine };
      if (charged.kind === "none") charged = { kind: "charged", sourceDocumentId: general.sourceDocumentId, amount, line: traced.sourceLine };
    }
  }
  return charged;
}
