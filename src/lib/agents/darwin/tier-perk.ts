/**
 * A $0 that is one account tier's perk, not the bank's price (#1397). Frost's live overdraft, NSF,
 * stop payment and wire fees all read $0 from one document, "The Frost Premium Account Schedule
 * of Fees" (a private-banking account, $30 a month): every fee is waived for that tier, while
 * Frost's standard schedule charges $35 an overdraft and $30 a stop payment. A $0 published from
 * such a schedule, or named for such an account ("BankOn Checking Account Overdraft Fee $0"),
 * reads as the bank's own price on its profile and in peer comparisons.
 *
 * Only $0 is refused: a priced row on a premium schedule (the account's own $30 fee) is real.
 * A general schedule that lists a premium account among others is not a tier schedule: only its
 * address and its title (the opening lines before any price) are read. Pure.
 */
const TIER_WORDS = "premium|private|platinum|prestige|preferred|relationship|wealth|bank\\s?on";
/** An address naming a tier's own fee page: "/truth-in-savings/premium-account-fees". */
const TIER_PATH = new RegExp(`(?:^|[/_-])(?:${TIER_WORDS})(?:[_-](?:client|banking|account|checking))*[_-]?(?:account[_-])?(?:fees?|schedule|disclosure)`, "i");
/** A title naming a tier's own schedule: "The Frost Premium Account Schedule of Fees", "Private Banking Fee Schedule". */
const TIER_TITLE = new RegExp(`\\b(?:${TIER_WORDS})\\b(?:\\s+(?:client|banking|account|checking|services))*\\s+(?:schedule|fee schedule|fees|rate and fee schedule)\\b`, "i");
/** A fee named for a tier's account: "BankOn Checking Account Overdraft Fee", "Private Client Stop Payment". */
const TIER_NAME = new RegExp(`\\b(?:${TIER_WORDS})\\s+(?:client|banking|checking|account|plus)\\b`, "i");
const TITLE_LINES = 3;

function pathOf(url: string | null | undefined): string {
  if (!url) return "";
  const path = url.replace(/^[a-z]+:\/\/[^/]+/i, "");
  try {
    return decodeURIComponent(path);
  } catch {
    return path;
  }
}

/** The document's title: its first few non-empty lines, up to the first price. */
function titleOf(text: string | null | undefined): string {
  const lines: string[] = [];
  for (const raw of (text ?? "").split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (/\$\s*\d|\d+\.\d{2}\b/.test(line) || lines.length >= TITLE_LINES) break;
    lines.push(line);
  }
  return lines.join(" ");
}

/** True when the document is one account tier's own fee schedule. */
export function isTierSchedule(url: string | null | undefined, text: string | null | undefined): boolean {
  return TIER_PATH.test(pathOf(url)) || TIER_TITLE.test(titleOf(text));
}

/** True when a $0 fee is a tier's perk: read from a tier's own schedule, or named for a tier's account. */
export function tierPerkZero(
  amount: number | null,
  feeName: string | null | undefined,
  url: string | null | undefined,
  text: string | null | undefined,
): boolean {
  if (amount == null || Math.abs(amount) >= 0.005) return false;
  return TIER_NAME.test(feeName ?? "") || isTierSchedule(url, text);
}
